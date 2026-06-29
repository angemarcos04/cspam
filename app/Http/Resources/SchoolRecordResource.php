<?php

namespace App\Http\Resources;

use App\Models\School;
use App\Models\User;
use App\Support\Auth\UserRoleResolver;
use App\Support\Domain\FormSubmissionStatus;
use App\Support\Domain\AccountStatus;
use App\Support\Indicators\SubmissionScopeProgressResolver;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Schema;

/** @mixin School */
class SchoolRecordResource extends JsonResource
{
    private static ?bool $accountSetupTokensTableExistsCache = null;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $studentCount = isset($this->students_count)
            ? (int) $this->students_count
            : (int) $this->reported_student_count;

        return [
            'id' => (string) $this->id,
            'schoolId' => $this->school_code,
            'schoolCode' => $this->school_code,
            'schoolName' => $this->name,
            'level' => $this->level,
            'district' => $this->district,
            'address' => $this->address ?? $this->district,
            'type' => $this->type,
            'studentCount' => (int) $studentCount,
            'teacherCount' => (int) $this->reported_teacher_count,
            'region' => $this->region,
            'status' => $this->status,
            'submittedBy' => $this->submittedBy?->name ?? 'Unassigned',
            'lastUpdated' => ($this->submitted_at ?? $this->updated_at)?->toISOString(),
            'deletedAt' => $this->deleted_at?->toISOString(),
            'schoolHeadAccount' => $this->serializeSchoolHeadAccount(),
            'hasReminderRecipient' => $this->hasReminderRecipient(),
            'reminderRecipientStatus' => $this->reminderRecipientStatus(),
            'latestReminder' => $this->serializeLatestReminder(),
            'indicatorLatest' => $this->serializeIndicatorLatest($request),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function serializeIndicatorLatest(Request $request): ?array
    {
        $monitorRelevantLoaded = $this->relationLoaded('latestMonitorRelevantIndicatorSubmission');
        $latestLoaded = $this->relationLoaded('latestIndicatorSubmission');

        if (! $monitorRelevantLoaded && ! $latestLoaded) {
            return null;
        }

        $submission = $monitorRelevantLoaded
            ? ($this->latestMonitorRelevantIndicatorSubmission ?? null)
            : null;

        if (! $submission && $latestLoaded) {
            $submission = $this->latestIndicatorSubmission;
        }

        if (! $submission) {
            return null;
        }

        $status = $submission->status;
        $statusValue = $status instanceof FormSubmissionStatus
            ? $status->value
            : (is_string($status) && $status !== '' ? $status : null);
        $reviewedAt = $submission->reviewed_at;

        if ($request->user() instanceof User && UserRoleResolver::has($request->user(), UserRoleResolver::MONITOR)) {
            [$statusValue, $reviewedAt] = $this->monitorEffectiveIndicatorStatus($submission, $statusValue, $reviewedAt);
        }

        return [
            'id' => (string) $submission->id,
            'status' => $statusValue,
            'submittedAt' => $submission->submitted_at?->toISOString(),
            'reviewedAt' => $reviewedAt?->toISOString(),
            'createdAt' => $submission->created_at?->toISOString(),
            'updatedAt' => $submission->updated_at?->toISOString(),
        ];
    }

    /**
     * @return array{0:string|null,1:\Carbon\CarbonInterface|null}
     */
    private function monitorEffectiveIndicatorStatus($submission, ?string $statusValue, $reviewedAt): array
    {
        if (in_array($statusValue, [
            FormSubmissionStatus::SUBMITTED->value,
            FormSubmissionStatus::VALIDATED->value,
            FormSubmissionStatus::RETURNED->value,
        ], true)) {
            return [$statusValue, $reviewedAt];
        }

        /** @var SubmissionScopeProgressResolver $scopeProgressResolver */
        $scopeProgressResolver = app(SubmissionScopeProgressResolver::class);
        $scopeProgress = $scopeProgressResolver->buildScopeProgressForSubmission($submission);
        $submittedScopeIds = is_array($scopeProgress['submittedScopeIds'] ?? null)
            ? array_values(array_filter(array_map(
                static fn (mixed $scopeId): string => strtolower(trim((string) $scopeId)),
                $scopeProgress['submittedScopeIds'],
            )))
            : [];

        if ($submittedScopeIds !== []) {
            $reviews = $submission->scopeReviews()
                ->whereIn('scope_id', $submittedScopeIds)
                ->get(['scope_id', 'decision', 'reviewed_at'])
                ->keyBy(static fn ($review): string => strtolower(trim((string) $review->scope_id)));

            $allSentScopesVerified = true;
            $latestReviewedAt = $reviewedAt;

            foreach ($submittedScopeIds as $scopeId) {
                $review = $reviews->get($scopeId);
                if (! $review || strtolower(trim((string) $review->decision)) !== 'verified') {
                    $allSentScopesVerified = false;
                }

                if ($review?->reviewed_at && (! $latestReviewedAt || $review->reviewed_at->gt($latestReviewedAt))) {
                    $latestReviewedAt = $review->reviewed_at;
                }
            }

            return [
                $allSentScopesVerified ? FormSubmissionStatus::VALIDATED->value : FormSubmissionStatus::SUBMITTED->value,
                $latestReviewedAt,
            ];
        }

        $returnedReview = $submission->scopeReviews()
            ->where('decision', 'returned')
            ->latest('reviewed_at')
            ->first(['decision', 'reviewed_at']);

        if ($returnedReview) {
            return [FormSubmissionStatus::RETURNED->value, $returnedReview->reviewed_at ?? $reviewedAt];
        }

        return [$statusValue, $reviewedAt];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function serializeSchoolHeadAccount(): ?array
    {
        if (! $this->relationLoaded('schoolHeadAccounts')) {
            return null;
        }

        // Keep resource resolution aligned with SchoolHeadAccountController:
        // when legacy duplicate School Head rows exist for one school, the
        // dashboard surfaces the newest linked account deterministically.
        /** @var User|null $account */
        $account = $this->schoolHeadAccounts
            ->sortByDesc(static fn (User $candidate): int => (int) $candidate->id)
            ->first();

        if (! $account) {
            return null;
        }

        $status = $account->accountStatus();
        $setupToken = null;

        if ($this->accountSetupTokensTableExists() && $account->relationLoaded('latestAccountSetupToken')) {
            $setupToken = $account->latestAccountSetupToken;
        }
        $setupLinkExpiresAt = null;

        if ($setupToken && $setupToken->used_at === null && $setupToken->expires_at !== null && $setupToken->expires_at->isFuture()) {
            $setupLinkExpiresAt = $setupToken->expires_at->toISOString();
        }

        $temporaryPasswordIssuedAt = $account->temporary_password_issued_at?->toISOString();
        $temporaryPasswordExpiry = $this->temporaryPasswordExpiresAt($account);
        $temporaryPasswordExpiresAt = $temporaryPasswordExpiry?->toISOString();
        $temporaryPasswordExpired = $temporaryPasswordExpiry?->lte(CarbonImmutable::now()) ?? false;
        $lifecycleState = $this->lifecycleState($account, $status);

        return [
            'id' => (string) $account->id,
            'name' => $account->name,
            'email' => $account->email,
            'emailVerifiedAt' => $account->email_verified_at?->toISOString(),
            'lastLoginAt' => $account->last_login_at?->toISOString(),
            'accountStatus' => $status->value,
            'mustResetPassword' => (bool) $account->must_reset_password,
            'onboardingFlow' => $this->onboardingFlow($account, $status),
            'lifecycleState' => $lifecycleState,
            'lifecycleStateLabel' => $this->lifecycleStateLabel($lifecycleState),
            'recommendedAction' => $this->recommendedAction($lifecycleState),
            'temporaryPasswordIssuedAt' => $temporaryPasswordIssuedAt,
            'temporaryPasswordExpiresAt' => $temporaryPasswordExpiresAt,
            'temporaryPasswordExpired' => $temporaryPasswordExpired,
            'temporaryPasswordDisplay' => $this->monitorVisibleTemporaryPassword($account),
            'verifiedAt' => $account->verified_at?->toISOString(),
            'verifiedByUserId' => $account->verified_by_user_id ? (string) $account->verified_by_user_id : null,
            'verifiedByName' => $account->relationLoaded('verifiedBy') ? $account->verifiedBy?->name : null,
            'verificationNotes' => $account->verification_notes,
            'flagged' => $account->flagged_at !== null,
            'flaggedAt' => $account->flagged_at?->toISOString(),
            'flagReason' => $account->flagged_reason,
            'deleteRecordFlagged' => $account->delete_record_flagged_at !== null,
            'deleteRecordFlaggedAt' => $account->delete_record_flagged_at?->toISOString(),
            'deleteRecordReason' => $account->delete_record_flag_reason,
            'setupLinkExpiresAt' => $setupLinkExpiresAt,
        ];
    }

    private function hasReminderRecipient(): bool
    {
        if (! $this->relationLoaded('schoolHeadAccounts')) {
            return false;
        }

        return $this->schoolHeadAccounts
            ->contains(static fn (User $account): bool => $account->canAuthenticate());
    }

    private function reminderRecipientStatus(): string
    {
        if (! $this->relationLoaded('schoolHeadAccounts') || $this->schoolHeadAccounts->isEmpty()) {
            return 'missing';
        }

        return $this->hasReminderRecipient() ? 'available' : 'inactive';
    }

    /**
     * @return array<string, mixed>|null
     */
    private function serializeLatestReminder(): ?array
    {
        if (! $this->relationLoaded('latestReminder') || ! $this->latestReminder) {
            return null;
        }

        $reminder = $this->latestReminder;

        return [
            'id' => (string) $reminder->id,
            'remindedAt' => $reminder->created_at?->toISOString(),
            'sentByName' => $reminder->relationLoaded('sentBy') ? $reminder->sentBy?->name : null,
            'recipientCount' => (int) $reminder->recipient_count,
            'dashboardStatus' => (string) $reminder->dashboard_status,
            'emailStatus' => (string) $reminder->email_status,
            'deliveryMode' => (string) $reminder->delivery_mode,
            'deliveryStatus' => (string) $reminder->delivery_status,
            'deliveryWarning' => $reminder->delivery_warning,
            'emailWarning' => $reminder->email_warning,
        ];
    }

    private function monitorVisibleTemporaryPassword(User $account): ?string
    {
        if (
            ! $account->must_reset_password
            || $account->temporary_password_issued_at === null
        ) {
            return null;
        }

        $displayPassword = $account->temporary_password_display;

        return is_string($displayPassword) && $displayPassword !== ''
            ? $displayPassword
            : null;
    }

    private function onboardingFlow(User $account, AccountStatus $status): string
    {
        // These statuses belong to the older setup-link onboarding lifecycle.
        // They should stay distinct from the Add School temp-password bootstrap flow.
        if (in_array($status, [AccountStatus::PENDING_SETUP, AccountStatus::PENDING_VERIFICATION], true)) {
            return 'setup_link';
        }

        // Active + must_reset_password + a temp-password issue timestamp means the
        // account is on the immediate-login bootstrap path introduced by Add School
        // creation and by monitor-side temporary password regeneration.
        if ($status === AccountStatus::ACTIVE && $account->must_reset_password && $account->temporary_password_issued_at !== null) {
            return 'temporary_password';
        }

        return 'standard';
    }

    private function lifecycleState(User $account, AccountStatus $status): string
    {
        if ($status === AccountStatus::PENDING_SETUP) {
            return 'pending_setup';
        }

        if ($status === AccountStatus::PENDING_VERIFICATION) {
            return 'pending_verification';
        }

        if ($status === AccountStatus::ACTIVE && $account->must_reset_password && $account->temporary_password_issued_at !== null) {
            if ($account->temporaryPasswordExpired()) {
                return 'temporary_password_expired';
            }

            return 'temporary_password_active';
        }

        // An active account that still requires a password reset without a temp
        // password timestamp is using the standard reset-link path, not the
        // bootstrap temp-password lifecycle.
        if ($status === AccountStatus::ACTIVE && $account->must_reset_password) {
            return 'password_reset_required';
        }

        if ($status === AccountStatus::ACTIVE && ! $account->must_reset_password) {
            return 'active_ready';
        }

        return $status->value;
    }

    private function lifecycleStateLabel(string $state): string
    {
        return match ($state) {
            'temporary_password_active' => 'Temporary password active',
            'temporary_password_expired' => 'Temporary password expired',
            'pending_setup' => 'Pending setup',
            'pending_verification' => 'Pending verification',
            'password_reset_required' => 'Password change required',
            'active_ready' => 'Active',
            default => str_replace('_', ' ', $state),
        };
    }

    private function recommendedAction(string $state): string
    {
        return match ($state) {
            'pending_setup' => 'send_setup_link',
            'pending_verification' => 'activate_account',
            'temporary_password_expired' => 'regenerate_temporary_password',
            'password_reset_required' => 'send_password_reset_link',
            default => 'none',
        };
    }

    private function temporaryPasswordExpiresAt(User $account): ?CarbonImmutable
    {
        return $account->temporaryPasswordExpiresAt();
    }

    private function accountSetupTokensTableExists(): bool
    {
        if (app()->runningUnitTests()) {
            return Schema::hasTable('account_setup_tokens');
        }

        if (self::$accountSetupTokensTableExistsCache === null) {
            self::$accountSetupTokensTableExistsCache = Schema::hasTable('account_setup_tokens');
        }

        return self::$accountSetupTokensTableExistsCache;
    }
}
