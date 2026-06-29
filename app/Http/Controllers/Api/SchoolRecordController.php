<?php

namespace App\Http\Controllers\Api;

use App\Events\CspamsUpdateBroadcast;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\BulkImportSchoolRecordsRequest;
use App\Http\Requests\Api\UpsertSchoolRecordRequest;
use App\Http\Resources\SchoolRecordResource;
use App\Models\AuditLog;
use App\Models\FormSubmissionHistory;
use App\Models\IndicatorSubmission;
use App\Models\School;
use App\Models\SchoolReminder;
use App\Models\Section;
use App\Models\Student;
use App\Models\User;
use App\Notifications\SchoolSubmissionReminderMailNotification;
use App\Notifications\SchoolSubmissionReminderNotification;
use App\Services\FilterService;
use App\Support\Auth\ApiUserResolver;
use App\Support\Auth\UserRoleResolver;
use App\Support\Domain\AccountStatus;
use App\Support\Domain\FormSubmissionStatus;
use App\Support\Domain\SchoolStatus;
use App\Support\Domain\StudentStatus;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

class SchoolRecordController extends Controller
{
    private static ?bool $usersHaveDeleteRecordFlagsCache = null;

    private static ?bool $usersHaveAccountTypeColumnCache = null;

    private static ?bool $sessionsTableExistsCache = null;

    private static ?bool $accountSetupTokensTableExistsCache = null;

    public function __construct(
        private readonly FilterService $filterService,
    ) {
    }

    public function index(Request $request): AnonymousResourceCollection|JsonResponse
    {
        $user = ApiUserResolver::fromRequest($request);
        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], Response::HTTP_UNAUTHORIZED);
        }

        $isSchoolHead = UserRoleResolver::has($user, UserRoleResolver::SCHOOL_HEAD);
        $isMonitor = UserRoleResolver::has($user, UserRoleResolver::MONITOR);
        $filters = $this->filterService->extract($request);
        // FIX: schools are not year-bound, so selected-year dashboard data must scope related records explicitly.
        $academicYearId = $this->resolveAcademicYearFilterId($filters);

        $scope = $isSchoolHead ? 'school' : 'division';
        $scopeKey = $scope === 'division' ? 'division:all' : 'school:unassigned';
        $baseQuery = School::query();

        if ($isSchoolHead) {
            if ($user->school_id) {
                $scopeKey = 'school:' . $user->school_id;
                $baseQuery->whereKey($user->school_id);
            } else {
                $baseQuery->whereRaw('1 = 0');
            }
        } elseif (! $isMonitor) {
            return response()->json(['message' => 'Forbidden.'], Response::HTTP_FORBIDDEN);
        }

        $this->filterService->apply($baseQuery, $filters, [
            'school_column' => 'id',
            'date_column' => 'submitted_at',
            'search_columns' => ['school_code', 'name', 'level', 'district', 'address', 'region', 'type'],
        ]);
        $scopeKey .= '|' . $this->filterService->buildCacheKey($filters);

        $syncFingerprint = $this->buildSyncFingerprint(clone $baseQuery, $academicYearId);
        $recordCount = $syncFingerprint['recordCount'];
        $latestAt = $syncFingerprint['latestAt'];
        $etag = $this->buildSyncEtag($scope, $scopeKey, $syncFingerprint);
        $requestedPerPage = $request->integer('per_page');
        $shouldPaginate = $request->boolean('paginate') || $requestedPerPage > 0;
        $perPage = $this->resolvePerPage($request);

        $incomingEtag = trim((string) $request->header('If-None-Match'));
        if ($incomingEtag !== '' && trim($incomingEtag, '"') === $etag) {
            return $this->buildNotModifiedResponse($etag, $scope, $scopeKey, $recordCount, $latestAt);
        }

        $query = (clone $baseQuery)
            ->with('submittedBy:id,name')
            ->with(['latestMonitorRelevantIndicatorSubmission' => function ($query) use ($academicYearId): void {
                $this->applyAcademicYearFilter($query, $academicYearId);
                $query->select([
                    'id',
                    'indicator_submissions.school_id',
                    'indicator_submissions.academic_year_id',
                    'status',
                    'submitted_at',
                    'reviewed_at',
                    'created_at',
                    'updated_at',
                ]);
            }])
            ->with(['latestIndicatorSubmission' => function ($query) use ($academicYearId): void {
                $this->applyAcademicYearFilter($query, $academicYearId);
                $query->select([
                    'id',
                    'indicator_submissions.school_id',
                    'indicator_submissions.academic_year_id',
                    'status',
                    'submitted_at',
                    'reviewed_at',
                    'created_at',
                    'updated_at',
                ]);
            }])
            ->with('latestReminder.sentBy:id,name')
            ->with(['schoolHeadAccounts' => fn ($query) => $this->applyDashboardSchoolHeadAccountQuery($query)])
            ->withCount([
                'students' => fn (Builder $query) => $this->applyAcademicYearFilter($query, $academicYearId),
            ])
            ->orderByDesc('submitted_at')
            ->orderByDesc('updated_at');

        $records = collect();
        $paginationMeta = null;

        if ($shouldPaginate) {
            $paginator = $query->paginate($perPage)->appends($request->query());
            $records = collect($paginator->items());
            $paginationMeta = [
                'currentPage' => $paginator->currentPage(),
                'lastPage' => $paginator->lastPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'from' => $paginator->firstItem(),
                'to' => $paginator->lastItem(),
                'hasMorePages' => $paginator->hasMorePages(),
            ];
        } else {
            $records = $query->get();
        }

        $this->hydrateYearScopedIndicatorLatest($records, $academicYearId);

        $targetsMet = $this->buildTargetsMetSummary(clone $baseQuery, $academicYearId);
        $syncAlerts = $this->buildSyncAlerts($targetsMet);
        $syncedAt = now()->toISOString();

        $resource = SchoolRecordResource::collection($records)->additional([
            'meta' => [
                'syncedAt' => $syncedAt,
                'scope' => $scope,
                'scopeKey' => $scopeKey,
                'recordCount' => $recordCount,
                'pagination' => $paginationMeta,
                'targetsMet' => $targetsMet,
                'alerts' => $syncAlerts,
            ],
        ]);

        return $this->applySyncHeaders(
            $resource->response(),
            $etag,
            $scope,
            $scopeKey,
            $recordCount,
            $latestAt,
            $syncedAt,
        );
    }

    public function store(UpsertSchoolRecordRequest $request): JsonResponse
    {
        $user = $this->requireAuthenticatedUser($request);

        if (UserRoleResolver::has($user, UserRoleResolver::MONITOR)) {
            return $this->storeAsMonitor($request, $user);
        }

        if (! UserRoleResolver::has($user, UserRoleResolver::SCHOOL_HEAD)) {
            return response()->json(['message' => 'Forbidden.'], Response::HTTP_FORBIDDEN);
        }

        if (! $user->school_id) {
            return response()->json(
                ['message' => 'Your account is not linked to any school.'],
                Response::HTTP_UNPROCESSABLE_ENTITY,
            );
        }

        /** @var School|null $school */
        $school = School::query()->find($user->school_id);
        if (! $school) {
            return response()->json(
                ['message' => 'Assigned school record is missing.'],
                Response::HTTP_UNPROCESSABLE_ENTITY,
            );
        }

        $this->applyPayload($school, $request, $user);

        return $this->buildMutationResponse($school, $user);
    }

    public function update(UpsertSchoolRecordRequest $request, School $school): JsonResponse
    {
        $user = $this->requireAuthenticatedUser($request);
        $isMonitor = UserRoleResolver::has($user, UserRoleResolver::MONITOR);
        $isSchoolHead = UserRoleResolver::has($user, UserRoleResolver::SCHOOL_HEAD);

        if (! $isMonitor && ! $isSchoolHead) {
            return response()->json(['message' => 'Forbidden.'], Response::HTTP_FORBIDDEN);
        }

        if ($isSchoolHead && ! $isMonitor && (int) $user->school_id !== (int) $school->id) {
            return response()->json(
                ['message' => 'You can only update your assigned school record.'],
                Response::HTTP_FORBIDDEN,
            );
        }

        $this->applyPayload($school, $request, $user);

        return $this->buildMutationResponse($school, $user);
    }

    public function destroy(Request $request, School $school): JsonResponse
    {
        $user = $this->requireMonitor($request);
        $deletePreview = $this->buildDeletePreview($school);
        $linkedSchoolHeadAccounts = $school
            ->schoolHeadAccounts()
            ->with('roles')
            ->get();

        $deletedRecord = [
            'id' => (string) $school->id,
            'schoolId' => $school->school_code,
            'schoolName' => $school->name,
            'dependencies' => $deletePreview,
        ];

        $linkedAccountIds = $linkedSchoolHeadAccounts
            ->map(static fn (User $account): int => (int) $account->id)
            ->values()
            ->all();

        DB::transaction(function () use ($school, $linkedSchoolHeadAccounts, $linkedAccountIds): void {
            foreach ($linkedSchoolHeadAccounts as $account) {
                $account->forceFill([
                    'account_status' => AccountStatus::ARCHIVED->value,
                ])->save();
            }

            if ($linkedAccountIds !== []) {
                PersonalAccessToken::query()
                    ->where('tokenable_type', User::class)
                    ->whereIn('tokenable_id', $linkedAccountIds)
                    ->delete();

                if ($this->sessionsTableExists()) {
                    DB::table('sessions')
                        ->whereIn('user_id', $linkedAccountIds)
                        ->delete();
                }

                if (Schema::hasTable('account_setup_tokens')) {
                    DB::table('account_setup_tokens')
                        ->whereIn('user_id', $linkedAccountIds)
                        ->delete();
                }
            }

            $school->delete();
        });

        $syncMeta = $this->buildSyncMetadataForUser($user);
        $targetsMetBundle = $this->buildTargetsMetAndAlertsForUser($user);
        $syncedAt = now()->toISOString();

        $response = response()->json([
            'data' => $deletedRecord,
            'meta' => [
                'syncedAt' => $syncedAt,
                'scope' => $syncMeta['scope'],
                'scopeKey' => $syncMeta['scopeKey'],
                'recordCount' => $syncMeta['recordCount'],
                'targetsMet' => $targetsMetBundle['targetsMet'],
                'alerts' => $targetsMetBundle['alerts'],
            ],
        ]);

        event(new CspamsUpdateBroadcast([
            'entity' => 'dashboard',
            'eventType' => 'school_records.deleted',
            'schoolId' => (string) $school->id,
            'alertsCount' => count($targetsMetBundle['alerts']),
            'pendingSchools' => (int) ($targetsMetBundle['targetsMet']['pendingSchools'] ?? 0),
        ]));

        return $this->applySyncHeaders(
            $response,
            $syncMeta['etag'],
            $syncMeta['scope'],
            $syncMeta['scopeKey'],
            $syncMeta['recordCount'],
            $syncMeta['latestAt'],
            $syncedAt,
        );
    }

    public function deletePreview(Request $request, School $school): JsonResponse
    {
        $this->requireMonitor($request);

        return response()->json([
            'data' => [
                'id' => (string) $school->id,
                'schoolId' => (string) $school->school_code,
                'schoolName' => (string) $school->name,
                'dependencies' => $this->buildDeletePreview($school),
            ],
        ]);
    }

    public function archived(Request $request): JsonResponse
    {
        $this->requireMonitor($request);

        $records = School::onlyTrashed()
            ->with('submittedBy:id,name')
            ->with('latestReminder.sentBy:id,name')
            ->with(['schoolHeadAccounts' => fn ($query) => $this->applyDashboardSchoolHeadAccountQuery($query)])
            ->withCount('students')
            ->orderByDesc('deleted_at')
            ->get();

        return response()->json([
            'data' => SchoolRecordResource::collection($records)->resolve(),
            'meta' => [
                'count' => $records->count(),
            ],
        ]);
    }

    public function restore(Request $request, string $school): JsonResponse
    {
        $user = $this->requireMonitor($request);

        $record = School::withTrashed()->find($school);
        if (! $record || ! $record->trashed()) {
            return response()->json(
                ['message' => 'Archived school record not found.'],
                Response::HTTP_NOT_FOUND,
            );
        }

        $record->restore();

        return $this->buildMutationResponse($record, $user);
    }

    public function permanentlyDestroy(Request $request, string $school): JsonResponse
    {
        $monitor = $this->requireMonitor($request);

        /** @var School|null $record */
        $record = School::withTrashed()->find($school);
        if (! $record) {
            return response()->json(
                ['message' => 'Archived school record not found.'],
                Response::HTTP_NOT_FOUND,
            );
        }

        if (! $record->trashed()) {
            return response()->json(
                ['message' => 'Archive the school record before permanently deleting it.'],
                Response::HTTP_UNPROCESSABLE_ENTITY,
            );
        }

        $dependencies = $this->buildDeletePreview($record);
        $linkedUsers = User::query()
            ->where('school_id', $record->id)
            ->with('roles')
            ->get();

        $linkedUserIds = $linkedUsers
            ->map(static fn (User $user): int => (int) $user->id)
            ->values()
            ->all();
        $linkedUserEmails = $linkedUsers
            ->map(static fn (User $user): string => (string) $user->email)
            ->values()
            ->all();

        $tokenRevocationsByUserId = collect();
        if ($linkedUserIds !== []) {
            $tokenRevocationsByUserId = PersonalAccessToken::query()
                ->where('tokenable_type', User::class)
                ->whereIn('tokenable_id', $linkedUserIds)
                ->selectRaw('tokenable_id, COUNT(*) as aggregate_count')
                ->groupBy('tokenable_id')
                ->pluck('aggregate_count', 'tokenable_id');
        }

        $sessionRevocationsByUserId = collect();
        if ($this->sessionsTableExists() && $linkedUserIds !== []) {
            $sessionRevocationsByUserId = DB::table('sessions')
                ->whereIn('user_id', $linkedUserIds)
                ->selectRaw('user_id, COUNT(*) as aggregate_count')
                ->groupBy('user_id')
                ->pluck('aggregate_count', 'user_id');
        }

        DB::transaction(function () use ($record, $linkedUsers, $linkedUserIds): void {
            if ($linkedUserIds !== []) {
                PersonalAccessToken::query()
                    ->where('tokenable_type', User::class)
                    ->whereIn('tokenable_id', $linkedUserIds)
                    ->delete();

                if ($this->sessionsTableExists()) {
                    DB::table('sessions')
                        ->whereIn('user_id', $linkedUserIds)
                        ->delete();
                }

                if ($this->accountSetupTokensTableExists()) {
                    DB::table('account_setup_tokens')
                        ->whereIn('user_id', $linkedUserIds)
                        ->delete();
                }
            }

            foreach ($linkedUsers as $linkedUser) {
                $linkedUser->syncPermissions([]);
                $linkedUser->syncRoles([]);
                $linkedUser->delete();
            }

            $record->forceDelete();
        });

        AuditLog::query()->create([
            'user_id' => $monitor->id,
            'action' => 'school.permanently_deleted',
            'auditable_type' => School::class,
            'auditable_id' => $record->id,
            'metadata' => [
                'category' => 'school_management',
                'outcome' => 'success',
                'actor_role' => UserRoleResolver::MONITOR,
                'school_id' => (string) $record->id,
                'school_code' => (string) $record->school_code,
                'school_name' => (string) $record->name,
                'dependencies' => $dependencies,
                'removed_user_ids' => $linkedUserIds,
                'removed_emails' => $linkedUserEmails,
                'revocations' => collect($linkedUserIds)
                    ->map(static function (int $userId) use ($tokenRevocationsByUserId, $sessionRevocationsByUserId): array {
                        return [
                            'user_id' => $userId,
                            'revoked_tokens' => (int) ($tokenRevocationsByUserId->get($userId, 0)),
                            'revoked_web_sessions' => (int) ($sessionRevocationsByUserId->get($userId, 0)),
                        ];
                    })
                    ->values()
                    ->all(),
            ],
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'created_at' => now(),
        ]);

        return response()->json([
            'data' => [
                'id' => (string) $record->id,
                'schoolId' => (string) $record->school_code,
                'schoolName' => (string) $record->name,
                'deletedUsers' => count($linkedUserIds),
                'dependencies' => $dependencies,
                'message' => 'School record and linked account data permanently deleted.',
            ],
        ]);
    }

    public function sendReminder(Request $request, School $school): JsonResponse
    {
        $monitor = $this->requireMonitor($request);
        $notes = trim((string) $request->input('notes', ''));

        if (strlen($notes) > 500) {
            return response()->json(
                ['message' => 'Reminder note must be 500 characters or less.'],
                Response::HTTP_UNPROCESSABLE_ENTITY,
            );
        }

        $schoolHeads = $school
            ->schoolHeadAccounts()
            ->with('roles')
            ->get()
            ->filter(static fn (User $user): bool => $user->canAuthenticate())
            ->values();

        if ($schoolHeads->isEmpty()) {
            return response()->json(
                ['message' => 'No active School Head account is linked to this school.'],
                Response::HTTP_UNPROCESSABLE_ENTITY,
            );
        }

        $normalizedNotes = $notes !== '' ? $notes : null;
        $deliveryMode = $this->schoolReminderDeliveryMode();
        $dashboardStatus = 'sent';
        $emailStatus = $deliveryMode === 'sync' ? 'sent' : 'queued';
        $deliveryStatus = $deliveryMode === 'sync' ? 'sent' : 'queued';
        $deliveryWarning = null;
        $emailWarning = null;
        $dashboardNotification = new SchoolSubmissionReminderNotification(
            $school,
            $monitor,
            $normalizedNotes,
        );
        $emailNotification = new SchoolSubmissionReminderMailNotification(
            $school,
            $monitor,
            $normalizedNotes,
        );

        try {
            $this->logSchoolReminderDelivery('School reminder dashboard notification delivery starting.', $school, $schoolHeads, $deliveryMode);
            Notification::sendNow($schoolHeads, $dashboardNotification, ['database']);
            $this->logSchoolReminderDelivery('School reminder dashboard notification delivery succeeded.', $school, $schoolHeads, $deliveryMode);
        } catch (\Throwable $exception) {
            report($exception);
            $dashboardStatus = 'failed';
            $emailStatus = 'skipped';
            $deliveryStatus = 'failed';
            $deliveryWarning = 'Unable to create the School Head dashboard notification.';
            $emailWarning = 'Email was skipped because the dashboard notification failed.';
            $reminder = $this->recordSchoolReminder(
                $school,
                $monitor,
                $normalizedNotes,
                $schoolHeads,
                $deliveryMode,
                $dashboardStatus,
                $emailStatus,
                $deliveryStatus,
                $deliveryWarning,
                $emailWarning,
            );
            $this->auditSchoolReminder($request, $school, $monitor, $schoolHeads, $reminder, $normalizedNotes, $deliveryMode, $dashboardStatus, $emailStatus, $deliveryStatus);
            $this->logSchoolReminderDelivery('School reminder dashboard notification delivery failed.', $school, $schoolHeads, $deliveryMode, $exception);

            return response()->json([
                'message' => 'Unable to create School Head dashboard notification.',
                'data' => [
                    'schoolId' => (string) $school->school_code,
                    'schoolName' => (string) $school->name,
                    'recipientCount' => $schoolHeads->count(),
                    'recipientEmails' => $schoolHeads->pluck('email')->values(),
                    'remindedAt' => $reminder?->created_at?->toISOString() ?? now()->toISOString(),
                    'deliveryMode' => $deliveryMode,
                    'deliveryStatus' => $deliveryStatus,
                    'deliveryWarning' => $deliveryWarning,
                    'dashboardStatus' => $dashboardStatus,
                    'emailStatus' => $emailStatus,
                    'emailWarning' => $emailWarning,
                    'latestReminder' => $reminder ? $this->serializeReminderSummary($reminder) : null,
                ],
            ], Response::HTTP_INTERNAL_SERVER_ERROR);
        }

        if ($deliveryMode === 'sync') {
            try {
                $this->logSchoolReminderDelivery('School reminder email delivery starting.', $school, $schoolHeads, $deliveryMode);
                Notification::sendNow($schoolHeads, $emailNotification, ['mail']);
                $this->logSchoolReminderDelivery('School reminder email delivery succeeded.', $school, $schoolHeads, $deliveryMode);
            } catch (\Throwable $exception) {
                report($exception);
                $emailStatus = 'failed';
                $deliveryStatus = 'partial';
                $deliveryWarning = 'Dashboard notification was sent, but email delivery failed. Check mail provider/domain settings.';
                $emailWarning = 'Email delivery failed. Check mail provider/domain settings.';
                $this->logSchoolReminderDelivery('School reminder email delivery failed.', $school, $schoolHeads, $deliveryMode, $exception);
            }
        } else {
            try {
                $this->logSchoolReminderDelivery('School reminder email queued.', $school, $schoolHeads, $deliveryMode);
                Notification::send($schoolHeads, $emailNotification);
            } catch (\Throwable $exception) {
                report($exception);
                $emailStatus = 'failed';
                $deliveryStatus = 'partial';
                $deliveryWarning = 'Dashboard notification was sent, but email delivery failed. Check mail provider/domain settings.';
                $emailWarning = 'Email delivery failed. Check mail provider/domain settings.';
                $this->logSchoolReminderDelivery('School reminder email queueing failed.', $school, $schoolHeads, $deliveryMode, $exception);
            }
        }

        $reminder = $this->recordSchoolReminder(
            $school,
            $monitor,
            $normalizedNotes,
            $schoolHeads,
            $deliveryMode,
            $dashboardStatus,
            $emailStatus,
            $deliveryStatus,
            $deliveryWarning,
            $emailWarning,
        );
        $this->auditSchoolReminder($request, $school, $monitor, $schoolHeads, $reminder, $normalizedNotes, $deliveryMode, $dashboardStatus, $emailStatus, $deliveryStatus);

        $remindedAt = $reminder->created_at?->toISOString() ?? now()->toISOString();

        event(new CspamsUpdateBroadcast([
            'entity' => 'dashboard',
            'eventType' => 'school_records.reminder_sent',
            'schoolId' => (string) $school->id,
            'schoolCode' => (string) $school->school_code,
            'schoolName' => (string) $school->name,
            'recipientCount' => $schoolHeads->count(),
            'remindedAt' => $remindedAt,
        ]));

        return response()->json([
            'data' => [
                'schoolId' => (string) $school->school_code,
                'schoolName' => (string) $school->name,
                'recipientCount' => $schoolHeads->count(),
                'recipientEmails' => $schoolHeads->pluck('email')->values(),
                'remindedAt' => $remindedAt,
                'deliveryMode' => $deliveryMode,
                'deliveryStatus' => $deliveryStatus,
                'deliveryWarning' => $deliveryWarning,
                'dashboardStatus' => $dashboardStatus,
                'emailStatus' => $emailStatus,
                'emailWarning' => $emailWarning,
                'latestReminder' => $this->serializeReminderSummary($reminder),
            ],
        ]);
    }

    private function schoolReminderDeliveryMode(): string
    {
        $mode = strtolower(trim((string) config('cspams.school_reminders.delivery_mode', 'queued')));

        return $mode === 'sync' ? 'sync' : 'queued';
    }

    /**
     * @param Collection<int, User> $schoolHeads
     */
    private function recordSchoolReminder(
        School $school,
        User $monitor,
        ?string $notes,
        Collection $schoolHeads,
        string $deliveryMode,
        string $dashboardStatus,
        string $emailStatus,
        string $deliveryStatus,
        ?string $deliveryWarning,
        ?string $emailWarning,
    ): SchoolReminder {
        return SchoolReminder::query()->create([
            'school_id' => $school->id,
            'sent_by' => $monitor->id,
            'notes' => $notes,
            'recipient_count' => $schoolHeads->count(),
            'recipient_domains' => $this->maskedEmailDomains($schoolHeads),
            'dashboard_status' => $dashboardStatus,
            'email_status' => $emailStatus,
            'delivery_mode' => $deliveryMode,
            'delivery_status' => $deliveryStatus,
            'delivery_warning' => $deliveryWarning,
            'email_warning' => $emailWarning,
        ]);
    }

    /**
     * @param Collection<int, User> $schoolHeads
     */
    private function auditSchoolReminder(
        Request $request,
        School $school,
        User $monitor,
        Collection $schoolHeads,
        ?SchoolReminder $reminder,
        ?string $notes,
        string $deliveryMode,
        string $dashboardStatus,
        string $emailStatus,
        string $deliveryStatus,
    ): void {
        AuditLog::query()->create([
            'user_id' => $monitor->id,
            'action' => 'school.reminder_sent',
            'auditable_type' => School::class,
            'auditable_id' => $school->id,
            'metadata' => [
                'reminder_id' => $reminder ? (string) $reminder->id : null,
                'school_id' => (string) $school->id,
                'school_code' => (string) $school->school_code,
                'school_name' => (string) $school->name,
                'recipient_count' => $schoolHeads->count(),
                'recipient_domains' => $this->maskedEmailDomains($schoolHeads),
                'has_notes' => $notes !== null,
                'notes_length' => $notes !== null ? strlen($notes) : 0,
                'delivery_mode' => $deliveryMode,
                'dashboard_status' => $dashboardStatus,
                'email_status' => $emailStatus,
                'delivery_status' => $deliveryStatus,
            ],
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'created_at' => now(),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeReminderSummary(SchoolReminder $reminder): array
    {
        $reminder->loadMissing('sentBy:id,name');

        return [
            'id' => (string) $reminder->id,
            'remindedAt' => $reminder->created_at?->toISOString(),
            'sentByName' => $reminder->sentBy?->name,
            'recipientCount' => (int) $reminder->recipient_count,
            'dashboardStatus' => (string) $reminder->dashboard_status,
            'emailStatus' => (string) $reminder->email_status,
            'deliveryMode' => (string) $reminder->delivery_mode,
            'deliveryStatus' => (string) $reminder->delivery_status,
            'deliveryWarning' => $reminder->delivery_warning,
            'emailWarning' => $reminder->email_warning,
        ];
    }

    /**
     * @param \Illuminate\Support\Collection<int, User> $schoolHeads
     */
    private function logSchoolReminderDelivery(
        string $message,
        School $school,
        \Illuminate\Support\Collection $schoolHeads,
        string $deliveryMode,
        ?\Throwable $exception = null,
    ): void {
        $context = [
            'delivery_mode' => $deliveryMode,
            'school_id' => (string) $school->id,
            'school_code' => (string) $school->school_code,
            'recipient_count' => $schoolHeads->count(),
            'recipient_domains' => $schoolHeads
                ->pluck('email')
                ->map(fn (mixed $email): ?string => $this->maskedEmailDomain((string) $email))
                ->filter()
                ->unique()
                ->values()
                ->all(),
            'mailer' => (string) config('mail.default', ''),
            'from' => (string) config('mail.from.address', ''),
        ];

        if ($exception !== null) {
            $context['exception_class'] = $exception::class;
            $context['exception_message'] = $exception->getMessage();
        }

        logger()->info($message, $context);
        error_log($message . ' ' . json_encode($context));
    }

    private function maskedEmailDomain(string $email): ?string
    {
        $parts = explode('@', strtolower(trim($email)));
        $domain = $parts[1] ?? '';

        if ($domain === '') {
            return null;
        }

        $domainParts = explode('.', $domain);
        $root = $domainParts[0] ?? '';
        $suffix = count($domainParts) > 1 ? '.' . implode('.', array_slice($domainParts, 1)) : '';

        if (strlen($root) <= 1) {
            return '*' . $suffix;
        }

        return substr($root, 0, 1) . str_repeat('*', min(3, max(1, strlen($root) - 1))) . $suffix;
    }

    /**
     * @param Collection<int, User> $schoolHeads
     *
     * @return array<int, string>
     */
    private function maskedEmailDomains(Collection $schoolHeads): array
    {
        return $schoolHeads
            ->pluck('email')
            ->map(fn (mixed $email): ?string => $this->maskedEmailDomain((string) $email))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    public function bulkImport(BulkImportSchoolRecordsRequest $request): JsonResponse
    {
        $user = $this->requireMonitor($request);

        /** @var array<int, array<string, mixed>> $rows */
        $rows = $request->validated('rows', []);
        $updateExisting = $request->boolean('options.updateExisting', true);
        $restoreArchived = $request->boolean('options.restoreArchived', true);

        $created = 0;
        $updated = 0;
        $restored = 0;
        $skipped = 0;
        $failed = 0;
        $results = [];
        $upsertRows = [];
        $accountRequests = [];
        $accountStats = [
            'created' => 0,
            'unchanged' => 0,
            'skipped_existing_account' => 0,
            'failed' => 0,
            'none' => 0,
        ];

        $normalizedSchoolCodes = [];
        foreach ($rows as $row) {
            $candidate = trim((string) ($row['schoolId'] ?? ''));
            if (preg_match('/^\d{6}$/', $candidate) === 1) {
                $normalizedSchoolCodes[strtolower($candidate)] = true;
            }
        }

        $existingSchoolsByCode = collect();
        if ($normalizedSchoolCodes !== []) {
            $existingSchoolsByCode = School::withTrashed()
                ->whereIn('school_code_normalized', array_keys($normalizedSchoolCodes))
                ->get()
                ->keyBy(static fn (School $school): string => (string) $school->school_code_normalized);
        }

        foreach ($rows as $index => $row) {
            try {
                $schoolCode = $this->normalizeSchoolCode((string) ($row['schoolId'] ?? ''));
                $school = $existingSchoolsByCode->get(strtolower($schoolCode));
                $schoolHeadName = trim((string) ($row['schoolHeadName'] ?? ''));
                $schoolHeadEmail = strtolower(trim((string) ($row['schoolHeadEmail'] ?? '')));
                $hasAccountRequest = $schoolHeadName !== '' && $schoolHeadEmail !== '';

                $action = 'created';
                if ($school) {
                    if ($school->trashed()) {
                        if (! $restoreArchived) {
                            $skipped++;
                            $accountStats['none']++;
                            $results[] = [
                                'row' => $index + 1,
                                'schoolId' => $schoolCode,
                                'action' => 'skipped',
                                'accountAction' => 'none',
                                'message' => 'School is archived and restore is disabled.',
                            ];
                            continue;
                        }

                        $restored++;
                        $action = 'restored';
                    } elseif (! $updateExisting) {
                        $skipped++;
                        $accountStats['none']++;
                        $results[] = [
                            'row' => $index + 1,
                            'schoolId' => $schoolCode,
                            'action' => 'skipped',
                            'accountAction' => 'none',
                            'message' => 'School already exists and update is disabled.',
                        ];
                        continue;
                    } else {
                        $updated++;
                        $action = 'updated';
                    }
                } else {
                    $school = new School();
                    $created++;
                }

                $upsertRows[$schoolCode] = $this->schoolAttributesFromArrayPayload(
                    $row,
                    $user,
                    $school?->getRawOriginal('created_at'),
                );

                if ($hasAccountRequest) {
                    $accountRequests[$schoolCode] = [
                        'name' => $schoolHeadName,
                        'email' => $schoolHeadEmail,
                    ];
                } else {
                    $accountStats['none']++;
                }

                $results[] = [
                    'row' => $index + 1,
                    'schoolId' => $schoolCode,
                    'schoolName' => (string) ($upsertRows[$schoolCode]['name'] ?? ''),
                    'action' => $action,
                    'accountAction' => 'none',
                ];
            } catch (\Throwable $exception) {
                $failed++;
                $accountStats['none']++;
                $results[] = [
                    'row' => $index + 1,
                    'schoolId' => (string) ($row['schoolId'] ?? 'N/A'),
                    'action' => 'failed',
                    'accountAction' => 'none',
                    'message' => $exception->getMessage(),
                ];
            }
        }

        if ($upsertRows !== []) {
            DB::transaction(function () use (
                $upsertRows,
                $accountRequests,
                $user,
                $request,
                $created,
                $updated,
                $restored,
                $skipped,
                $failed,
                &$results,
                &$accountStats,
                $updateExisting,
                $restoreArchived,
            ): void {
                School::query()->upsert(
                    array_values($upsertRows),
                    ['school_code_normalized'],
                    [
                        'school_code',
                        'name',
                        'level',
                        'type',
                        'address',
                        'district',
                        'region',
                        'status',
                        'submitted_by',
                        'submitted_at',
                        'deleted_at',
                        'updated_at',
                    ],
                );

                if ($accountRequests !== []) {
                    $schoolsByCode = School::query()
                        ->with(['schoolHeadAccounts' => fn ($query) => $this->applyDashboardSchoolHeadAccountQuery($query)])
                        ->whereIn(
                            'school_code_normalized',
                            array_map(static fn (string $code): string => strtolower($code), array_keys($accountRequests)),
                        )
                        ->get()
                        ->keyBy(static fn (School $school): string => (string) $school->school_code_normalized);

                    foreach ($results as $resultIndex => $result) {
                        $schoolCode = (string) ($result['schoolId'] ?? '');
                        $accountRequest = $accountRequests[$schoolCode] ?? null;
                        if (! is_array($accountRequest)) {
                            continue;
                        }

                        /** @var School|null $school */
                        $school = $schoolsByCode->get(strtolower($schoolCode));
                        if (! $school) {
                            $accountStats['failed']++;
                            $results[$resultIndex]['accountAction'] = 'failed';
                            $results[$resultIndex]['warning'] = 'School Head account was not created because the imported school could not be resolved.';
                            continue;
                        }

                        /** @var User|null $existingAccount */
                        $existingAccount = $school->schoolHeadAccounts->first();
                        if ($existingAccount) {
                            $requestedName = trim((string) ($accountRequest['name'] ?? ''));
                            $requestedEmail = strtolower(trim((string) ($accountRequest['email'] ?? '')));
                            $existingName = trim((string) $existingAccount->name);
                            $existingEmail = strtolower(trim((string) $existingAccount->email));

                            $results[$resultIndex]['schoolHeadEmail'] = $existingEmail;
                            if ($requestedName === $existingName && $requestedEmail === $existingEmail) {
                                $accountStats['unchanged']++;
                                $results[$resultIndex]['accountAction'] = 'unchanged';
                                continue;
                            }

                            $accountStats['skipped_existing_account']++;
                            $results[$resultIndex]['accountAction'] = 'skipped_existing_account';
                            $results[$resultIndex]['warning'] = 'School imported, but the existing School Head account was not changed. Use the Accounts panel because account email changes require verification.';
                            continue;
                        }

                        $email = strtolower(trim((string) ($accountRequest['email'] ?? '')));
                        if (User::query()->where('email_normalized', $email)->exists()) {
                            $accountStats['failed']++;
                            $results[$resultIndex]['accountAction'] = 'failed';
                            $results[$resultIndex]['schoolHeadEmail'] = $email;
                            $results[$resultIndex]['warning'] = 'School imported, but the School Head account was not created because that email is already used.';
                            continue;
                        }

                        try {
                            $accountMeta = $this->createTemporaryPasswordSchoolHeadAccount(
                                $school,
                                $user,
                                trim((string) ($accountRequest['name'] ?? '')),
                                $email,
                                'Provisioned by Division Monitor through school CSV import.',
                                $request,
                            );

                            $accountStats['created']++;
                            $results[$resultIndex]['accountAction'] = 'created';
                            $results[$resultIndex]['schoolHeadEmail'] = $email;
                            $results[$resultIndex]['temporaryPassword'] = $accountMeta['temporaryPassword'];
                            $results[$resultIndex]['message'] = 'School Head account created with a temporary password.';
                        } catch (\Throwable $exception) {
                            Log::warning('Bulk import School Head account creation failed.', [
                                'school_id' => (string) $school->id,
                                'school_code' => (string) $school->school_code,
                                'school_head_email_domain' => str_contains($email, '@') ? substr(strrchr($email, '@') ?: '', 1) : null,
                                'exception' => $exception::class,
                            ]);

                            $accountStats['failed']++;
                            $results[$resultIndex]['accountAction'] = 'failed';
                            $results[$resultIndex]['schoolHeadEmail'] = $email;
                            $results[$resultIndex]['warning'] = 'School imported, but the School Head account could not be created.';
                        }
                    }
                }

                AuditLog::query()->create([
                    'user_id' => $user->id,
                    'action' => 'school.bulk_imported',
                    'auditable_type' => School::class,
                    'auditable_id' => null,
                    'metadata' => [
                        'category' => 'school_records',
                        'outcome' => $failed > 0 ? 'partial' : 'success',
                        'created' => $created,
                        'updated' => $updated,
                        'restored' => $restored,
                        'skipped' => $skipped,
                        'failed' => $failed,
                        'accounts' => $accountStats,
                        'options' => [
                            'updateExisting' => $updateExisting,
                            'restoreArchived' => $restoreArchived,
                        ],
                        'schools' => array_map(static fn (array $result): array => [
                            'school_id' => $result['schoolId'] ?? null,
                            'action' => $result['action'] ?? null,
                            'account_action' => $result['accountAction'] ?? null,
                        ], $results),
                    ],
                    'ip_address' => $request->ip(),
                    'user_agent' => $request->userAgent(),
                    'created_at' => now(),
                ]);
            });
        } else {
            AuditLog::query()->create([
                'user_id' => $user->id,
                'action' => 'school.bulk_imported',
                'auditable_type' => School::class,
                'auditable_id' => null,
                'metadata' => [
                    'category' => 'school_records',
                    'outcome' => $failed > 0 ? 'partial' : 'success',
                    'created' => $created,
                    'updated' => $updated,
                    'restored' => $restored,
                    'skipped' => $skipped,
                    'failed' => $failed,
                    'accounts' => $accountStats,
                    'options' => [
                        'updateExisting' => $updateExisting,
                        'restoreArchived' => $restoreArchived,
                    ],
                    'schools' => array_map(static fn (array $result): array => [
                        'school_id' => $result['schoolId'] ?? null,
                        'action' => $result['action'] ?? null,
                        'account_action' => $result['accountAction'] ?? null,
                    ], $results),
                ],
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'created_at' => now(),
            ]);
        }

        $syncMeta = $this->buildSyncMetadataForUser($user);
        $targetsMetBundle = $this->buildTargetsMetAndAlertsForUser($user);
        $syncedAt = now()->toISOString();

        $response = response()->json([
            'data' => [
                'created' => $created,
                'updated' => $updated,
                'restored' => $restored,
                'skipped' => $skipped,
                'failed' => $failed,
                'accounts' => [
                    'created' => $accountStats['created'],
                    'unchanged' => $accountStats['unchanged'],
                    'skippedExistingAccount' => $accountStats['skipped_existing_account'],
                    'failed' => $accountStats['failed'],
                    'none' => $accountStats['none'],
                ],
                'results' => $results,
            ],
            'meta' => [
                'syncedAt' => $syncedAt,
                'scope' => $syncMeta['scope'],
                'scopeKey' => $syncMeta['scopeKey'],
                'recordCount' => $syncMeta['recordCount'],
                'targetsMet' => $targetsMetBundle['targetsMet'],
                'alerts' => $targetsMetBundle['alerts'],
            ],
        ]);

        event(new CspamsUpdateBroadcast([
            'entity' => 'dashboard',
            'eventType' => 'school_records.bulk_imported',
            'created' => $created,
            'updated' => $updated,
            'restored' => $restored,
            'failed' => $failed,
            'alertsCount' => count($targetsMetBundle['alerts']),
        ]));

        return $this->applySyncHeaders(
            $response,
            $syncMeta['etag'],
            $syncMeta['scope'],
            $syncMeta['scopeKey'],
            $syncMeta['recordCount'],
            $syncMeta['latestAt'],
            $syncedAt,
        );
    }

    private function requireAuthenticatedUser(Request $request): User
    {
        $user = ApiUserResolver::fromRequest($request);
        abort_if(! $user, Response::HTTP_UNAUTHORIZED, 'Unauthenticated.');

        return $user;
    }

    private function requireMonitor(Request $request): User
    {
        $user = $this->requireAuthenticatedUser($request);
        abort_if(
            ! UserRoleResolver::has($user, UserRoleResolver::MONITOR),
            Response::HTTP_FORBIDDEN,
            'Only Division Monitors can modify division school records.',
        );

        return $user;
    }

    private function storeAsMonitor(UpsertSchoolRecordRequest $request, User $user): JsonResponse
    {
        $schoolCode = $this->normalizeSchoolCode($request->string('schoolId')->toString());

        $existing = School::withTrashed()
            ->where('school_code_normalized', strtolower($schoolCode))
            ->first();

        if ($existing && ! $existing->trashed()) {
            throw ValidationException::withMessages([
                'schoolId' => 'School code already exists in active records.',
            ]);
        }

        $school = $existing ?? new School();
        if ($existing?->trashed()) {
            $existing->restore();
        }

        $school->school_code = $schoolCode;

        $this->applyPayload($school, $request, $user);

        $schoolHeadAccountMeta = $this->createSchoolHeadAccountIfRequested($school, $request);

        return $this->buildMutationResponse(
            $school,
            $user,
            $schoolHeadAccountMeta ? ['schoolHeadAccount' => $schoolHeadAccountMeta] : [],
        );
    }

    private function applyPayload(School $school, UpsertSchoolRecordRequest $request, User $user): void
    {
        $currentStatus = is_string($school->status) && $school->status !== ''
            ? $school->status
            : SchoolStatus::ACTIVE->value;

        $school->fill([
            'status' => $request->filled('status')
                ? $request->string('status')->toString()
                : $currentStatus,
            'submitted_by' => $user->id,
            'submitted_at' => now(),
        ]);

        if ($request->has('teacherCount')) {
            $school->reported_teacher_count = $request->integer('teacherCount');
        } elseif (! $school->exists && $school->reported_teacher_count === null) {
            $school->reported_teacher_count = 0;
        }

        $isSchoolHead = UserRoleResolver::has($user, UserRoleResolver::SCHOOL_HEAD);

        // School identity fields are division-managed. School Heads can submit
        // compliance counts/status, but cannot rewrite profile metadata.
        if (! $isSchoolHead) {
            if ($request->filled('schoolId')) {
                $school->school_code = $this->normalizeSchoolCode($request->string('schoolId')->toString());
            }

            if ($request->filled('schoolName')) {
                $school->name = $request->string('schoolName')->toString();
            }

            if ($request->filled('level')) {
                $school->level = $request->string('level')->toString();
            }

            if ($request->filled('type')) {
                $school->type = strtolower($request->string('type')->toString());
            }

            if ($request->filled('address')) {
                $school->address = $request->string('address')->toString();
                if (! $request->filled('district')) {
                    $school->district = $this->deriveDistrictFromAddress($school->address);
                }
            }

            if ($request->filled('district')) {
                $school->district = $request->string('district')->toString();
            }

            if ($request->filled('region')) {
                $school->region = $request->string('region')->toString();
            } elseif ($request->filled('address')) {
                $school->region = $this->deriveRegionFromAddress($school->address);
            }
        }

        $school->save();
        $this->syncSchoolStudentCount($school);
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function applyArrayPayload(School $school, array $payload, User $user, bool $syncStudentCount = true): void
    {
        $this->fillSchoolFromArrayPayload($school, $payload, $user);
        $school->save();

        if ($syncStudentCount) {
            $this->syncSchoolStudentCount($school);
        }
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function fillSchoolFromArrayPayload(School $school, array $payload, User $user): void
    {
        $schoolCode = $this->normalizeSchoolCode((string) ($payload['schoolId'] ?? ''));
        $schoolName = trim((string) ($payload['schoolName'] ?? ''));
        $level = trim((string) ($payload['level'] ?? ''));
        $type = strtolower(trim((string) ($payload['type'] ?? 'public')));
        $address = trim((string) ($payload['address'] ?? ''));
        $district = trim((string) ($payload['district'] ?? ''));
        $region = trim((string) ($payload['region'] ?? ''));
        $status = trim((string) ($payload['status'] ?? 'active'));

        $school->school_code = $schoolCode;
        $school->name = $schoolName;
        $school->level = $level;
        $school->type = $type;
        $school->address = $address;
        $school->district = $district !== '' ? $district : $this->deriveDistrictFromAddress($address);
        $school->region = $region !== '' ? $region : $this->deriveRegionFromAddress($address);
        $school->status = $status;
        $school->submitted_by = $user->id;
        $school->submitted_at = now();
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return array<string, mixed>
     */
    private function schoolAttributesFromArrayPayload(array $payload, User $user, mixed $createdAt = null): array
    {
        $school = new School();
        $this->fillSchoolFromArrayPayload($school, $payload, $user);
        $timestamp = now();
        $schoolCode = (string) $school->school_code;

        return [
            'school_code' => $schoolCode,
            'school_code_normalized' => strtolower($schoolCode),
            'name' => (string) $school->name,
            'level' => (string) $school->level,
            'type' => (string) $school->type,
            'address' => (string) $school->address,
            'district' => (string) $school->district,
            'region' => (string) $school->region,
            'status' => (string) $school->status,
            'submitted_by' => $user->id,
            'submitted_at' => $school->submitted_at,
            'deleted_at' => null,
            'created_at' => $createdAt ?? $timestamp,
            'updated_at' => $timestamp,
        ];
    }

    private function createSchoolHeadAccountIfRequested(School $school, UpsertSchoolRecordRequest $request): ?array
    {
        if (! $request->filled('schoolHeadAccount')) {
            return null;
        }

        $monitor = $this->requireAuthenticatedUser($request);
        if (! UserRoleResolver::has($monitor, UserRoleResolver::MONITOR)) {
            return null;
        }

        /** @var array{name?: string, email?: string}|null $payload */
        $payload = $request->input('schoolHeadAccount');
        if (! is_array($payload)) {
            return null;
        }

        $name = trim((string) ($payload['name'] ?? ''));
        $email = strtolower(trim((string) ($payload['email'] ?? '')));
        if ($name === '' || $email === '') {
            return null;
        }

        if (User::query()->where('email_normalized', $email)->exists()) {
            throw ValidationException::withMessages([
                'schoolHeadAccount.email' => 'A user account with this email already exists.',
            ]);
        }

        $duplicateQuery = $this->schoolHeadCandidatesQuery()
            ->where('school_id', $school->id);

        if ($duplicateQuery->exists()) {
            throw ValidationException::withMessages([
                'schoolHeadAccount' => 'A School Head account is already linked to this school. Update it instead of creating a new one.',
            ]);
        }

        return $this->createTemporaryPasswordSchoolHeadAccount(
            $school,
            $monitor,
            $name,
            $email,
            'Provisioned by Division Monitor with a one-time temporary password.',
            $request,
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function createTemporaryPasswordSchoolHeadAccount(
        School $school,
        User $monitor,
        string $name,
        string $email,
        string $verificationNotes,
        Request $request,
    ): array {
        $account = new User();
        $account->name = $name;
        $account->email = $email;
        $temporaryPassword = $this->generateTemporaryPassword();
        $account->password = Hash::make($temporaryPassword);
        // Add School uses an immediate-login bootstrap password, not the pending-setup
        // link flow. The account is active, but the first successful sign-in must
        // transition through the existing required-password-reset path.
        $account->must_reset_password = true;
        $account->password_changed_at = now();
        $account->temporary_password_issued_at = now();
        $account->temporary_password_display = $temporaryPassword;
        $account->account_status = AccountStatus::ACTIVE->value;
        $account->school_id = $school->id;
        $account->email_verified_at = now();
        $account->verified_by_user_id = $monitor->id;
        $account->verified_at = now();
        $account->verification_notes = $verificationNotes;
        if ($this->usersHaveAccountTypeColumn()) {
            $account->account_type = UserRoleResolver::SCHOOL_HEAD;
        }
        $account->save();
        $account->assignRole(UserRoleResolver::SCHOOL_HEAD);

        AuditLog::query()->create([
            'user_id' => $monitor->id,
            'action' => 'account.temporary_password_issued',
            'auditable_type' => User::class,
            'auditable_id' => $account->id,
            'metadata' => [
                'category' => 'account_management',
                'outcome' => 'success',
                'target_user_id' => $account->id,
                'target_email' => $account->email,
                'target_role' => UserRoleResolver::SCHOOL_HEAD,
                'account_status' => $account->accountStatus()->value,
                'school_id' => (string) $school->id,
                'school_code' => (string) $school->school_code,
                'reason' => 'account_created',
            ],
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'created_at' => now(),
        ]);

        return [
            'id' => (string) $account->id,
            'name' => $account->name,
            'email' => $account->email,
            'mustResetPassword' => true,
            'accountStatus' => $account->accountStatus()->value,
            'onboardingFlow' => 'temporary_password',
            'lifecycleState' => $account->temporaryPasswordExpired() ? 'temporary_password_expired' : 'temporary_password_active',
            'lifecycleStateLabel' => $account->temporaryPasswordExpired() ? 'Temporary password expired' : 'Temporary password active',
            'recommendedAction' => $account->temporaryPasswordExpired() ? 'regenerate_temporary_password' : 'none',
            'temporaryPasswordIssuedAt' => $account->temporary_password_issued_at?->toISOString(),
            'temporaryPasswordExpiresAt' => $this->temporaryPasswordExpiresAt($account)?->toISOString(),
            'temporaryPasswordExpired' => $account->temporaryPasswordExpired(),
            'temporaryPasswordDisplay' => $temporaryPassword,
            'temporaryPassword' => $temporaryPassword,
        ];
    }

    private function generateTemporaryPassword(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
        $maxIndex = strlen($alphabet) - 1;
        $password = '';

        for ($index = 0; $index < 8; $index++) {
            $password .= $alphabet[random_int(0, $maxIndex)];
        }

        return $password;
    }

    private function temporaryPasswordExpiresAt(User $account): ?CarbonImmutable
    {
        return $account->temporaryPasswordExpiresAt();
    }

    private function schoolHeadCandidatesQuery(): Builder
    {
        $query = User::query()->orderByDesc('id');

        if ($this->usersHaveAccountTypeColumn()) {
            return $query->where('account_type', UserRoleResolver::SCHOOL_HEAD);
        }

        $aliases = UserRoleResolver::roleAliases(UserRoleResolver::SCHOOL_HEAD);

        return $query->whereHas('roles', static function ($builder) use ($aliases): void {
            $builder->whereIn('name', $aliases);
        });
    }

    private function normalizeSchoolCode(string $value): string
    {
        $normalized = trim($value);

        if (preg_match('/^\d{6}$/', $normalized) !== 1) {
            throw ValidationException::withMessages([
                'schoolId' => 'School code must be exactly 6 digits.',
            ]);
        }

        return $normalized;
    }

    private function deriveDistrictFromAddress(string $address): string
    {
        $segments = array_values(
            array_filter(
                array_map(static fn (string $segment): string => trim($segment), explode(',', $address)),
                static fn (string $segment): bool => $segment !== '',
            ),
        );

        return $segments[0] ?? 'N/A';
    }

    private function deriveRegionFromAddress(string $address): string
    {
        $segments = array_values(
            array_filter(
                array_map(static fn (string $segment): string => trim($segment), explode(',', $address)),
                static fn (string $segment): bool => $segment !== '',
            ),
        );

        if (count($segments) >= 2) {
            return implode(', ', array_slice($segments, -2));
        }

        return $segments[0] ?? 'N/A';
    }

    /**
     * @param array<string, mixed> $extraMeta
     */
    private function buildMutationResponse(School $school, User $user, array $extraMeta = []): JsonResponse
    {
        $syncMeta = $this->buildSyncMetadataForUser($user);
        $targetsMetBundle = $this->buildTargetsMetAndAlertsForUser($user);
        $syncedAt = now()->toISOString();

        $response = response()->json([
            'data' => (new SchoolRecordResource($school->load([
                'submittedBy:id,name',
                'latestMonitorRelevantIndicatorSubmission' => function ($query): void {
                    $query->select([
                        'id',
                        'indicator_submissions.school_id',
                        'status',
                        'submitted_at',
                        'reviewed_at',
                        'created_at',
                        'updated_at',
                    ]);
                },
                'latestIndicatorSubmission' => function ($query): void {
                    $query->select([
                        'id',
                        'indicator_submissions.school_id',
                        'status',
                        'submitted_at',
                        'reviewed_at',
                        'created_at',
                        'updated_at',
                    ]);
                },
                'latestReminder.sentBy:id,name',
                'schoolHeadAccounts' => fn ($query) => $this->applyDashboardSchoolHeadAccountQuery($query),
            ])))->resolve(),
            'meta' => array_merge([
                'syncedAt' => $syncedAt,
                'scope' => $syncMeta['scope'],
                'scopeKey' => $syncMeta['scopeKey'],
                'recordCount' => $syncMeta['recordCount'],
                'targetsMet' => $targetsMetBundle['targetsMet'],
                'alerts' => $targetsMetBundle['alerts'],
            ], $extraMeta),
        ]);

        event(new CspamsUpdateBroadcast([
            'entity' => 'dashboard',
            'eventType' => 'school_records.updated',
            'schoolId' => (string) $school->id,
            'status' => (string) $school->status,
            'alertsCount' => count($targetsMetBundle['alerts']),
            'pendingSchools' => (int) ($targetsMetBundle['targetsMet']['pendingSchools'] ?? 0),
        ]));

        return $this->applySyncHeaders(
            $response,
            $syncMeta['etag'],
            $syncMeta['scope'],
            $syncMeta['scopeKey'],
            $syncMeta['recordCount'],
            $syncMeta['latestAt'],
            $syncedAt,
        );
    }

    /**
     * @return array{
     *     students: int,
     *     sections: int,
     *     indicatorSubmissions: int,
     *     histories: int,
     *     linkedUsers: int
     * }
     */
    private function buildDeletePreview(School $school): array
    {
        return [
            'students' => Student::query()->where('school_id', $school->id)->count(),
            'sections' => Section::query()->where('school_id', $school->id)->count(),
            'indicatorSubmissions' => $school->indicatorSubmissions()->count(),
            'histories' => FormSubmissionHistory::query()->where('school_id', $school->id)->count(),
            'linkedUsers' => User::query()->where('school_id', $school->id)->count(),
        ];
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

    /**
     * @return array{
     *     scope: string,
     *     scopeKey: string,
     *     recordCount: int,
     *     latestAt: ?Carbon,
     *     etag: string
     * }
     */
    private function buildSyncMetadataForUser(User $user): array
    {
        $isSchoolHead = UserRoleResolver::has($user, UserRoleResolver::SCHOOL_HEAD);
        $isMonitor = UserRoleResolver::has($user, UserRoleResolver::MONITOR);

        $scope = $isSchoolHead ? 'school' : 'division';
        $scopeKey = $scope === 'division' ? 'division:all' : 'school:unassigned';
        $baseQuery = School::query();

        if ($isSchoolHead) {
            if ($user->school_id) {
                $scopeKey = 'school:' . $user->school_id;
                $baseQuery->whereKey($user->school_id);
            } else {
                $baseQuery->whereRaw('1 = 0');
            }
        } elseif (! $isMonitor) {
            abort(Response::HTTP_FORBIDDEN, 'Forbidden.');
        }

        $syncFingerprint = $this->buildSyncFingerprint(clone $baseQuery);
        $recordCount = $syncFingerprint['recordCount'];
        $latestAt = $syncFingerprint['latestAt'];
        $etag = $this->buildSyncEtag($scope, $scopeKey, $syncFingerprint);

        return [
            'scope' => $scope,
            'scopeKey' => $scopeKey,
            'recordCount' => $recordCount,
            'latestAt' => $latestAt,
            'etag' => $etag,
        ];
    }

    /**
     * @param array<string, mixed> $filters
     */
    private function resolveAcademicYearFilterId(array $filters): ?int
    {
        $value = $filters['academic_year_id'] ?? null;

        if (! is_numeric($value)) {
            return null;
        }

        $academicYearId = (int) $value;

        return $academicYearId > 0 ? $academicYearId : null;
    }

    private function applyAcademicYearFilter(Builder|Relation $query, ?int $academicYearId): void
    {
        if ($academicYearId !== null) {
            $query->where('academic_year_id', $academicYearId);
        }
    }

    /**
     * @param Collection<int, School> $schools
     */
    private function hydrateYearScopedIndicatorLatest(Collection $schools, ?int $academicYearId): void
    {
        if ($academicYearId === null || $schools->isEmpty()) {
            return;
        }

        $schoolIds = $schools
            ->pluck('id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->filter(static fn (int $id): bool => $id > 0)
            ->unique()
            ->values();

        if ($schoolIds->isEmpty()) {
            return;
        }

        $columns = [
            'id',
            'school_id',
            'academic_year_id',
            'status',
            'submitted_at',
            'reviewed_at',
            'created_at',
            'updated_at',
        ];

        $latestBySchoolId = IndicatorSubmission::query()
            ->whereIn('school_id', $schoolIds)
            ->where('academic_year_id', $academicYearId)
            ->select($columns)
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->get()
            ->unique('school_id')
            ->keyBy('school_id');

        $monitorRelevantStatuses = [
            FormSubmissionStatus::SUBMITTED->value,
            FormSubmissionStatus::VALIDATED->value,
            FormSubmissionStatus::RETURNED->value,
        ];

        $monitorRelevantBySchoolId = IndicatorSubmission::query()
            ->whereIn('school_id', $schoolIds)
            ->where('academic_year_id', $academicYearId)
            ->where(function (Builder $query) use ($monitorRelevantStatuses): void {
                $query->whereIn('status', $monitorRelevantStatuses)
                    ->orWhereHas('scopeSubmissions');
            })
            ->select($columns)
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->get()
            ->unique('school_id')
            ->keyBy('school_id');

        $schools->each(static function (School $school) use ($latestBySchoolId, $monitorRelevantBySchoolId): void {
            $schoolId = (int) $school->id;

            $school->setRelation('latestMonitorRelevantIndicatorSubmission', $monitorRelevantBySchoolId->get($schoolId));
            $school->setRelation('latestIndicatorSubmission', $latestBySchoolId->get($schoolId));
        });
    }

    /**
     * @return array{
     *     targetsMet: array<string, int|float|null|string>,
     *     alerts: array<int, array<string, int|float|string|null>>
     * }
     */
    private function buildTargetsMetAndAlertsForUser(User $user): array
    {
        $isSchoolHead = UserRoleResolver::has($user, UserRoleResolver::SCHOOL_HEAD);
        $isMonitor = UserRoleResolver::has($user, UserRoleResolver::MONITOR);
        $baseQuery = School::query();

        if ($isSchoolHead) {
            if ($user->school_id) {
                $baseQuery->whereKey($user->school_id);
            } else {
                $baseQuery->whereRaw('1 = 0');
            }
        } elseif (! $isMonitor) {
            abort(Response::HTTP_FORBIDDEN, 'Forbidden.');
        }

        $targetsMet = $this->buildTargetsMetSummary($baseQuery);

        return [
            'targetsMet' => $targetsMet,
            'alerts' => $this->buildSyncAlerts($targetsMet),
        ];
    }

    /**
     * @return array<string, int|float|null|string>
     */
    private function buildTargetsMetSummary(Builder $baseQuery, ?int $academicYearId = null): array
    {
        $schools = (clone $baseQuery)
            ->select(['id', 'status', 'reported_student_count', 'reported_teacher_count'])
            ->get();

        $schoolIds = $schools->pluck('id');
        $totalSchools = (int) $schools->count();
        $activeSchools = (int) $schools->where('status', 'active')->count();
        $pendingSchools = (int) $schools->where('status', 'pending')->count();
        $inactiveSchools = (int) $schools->where('status', 'inactive')->count();

        $reportedTeachers = (int) $schools->sum('reported_teacher_count');

        $sectionCount = 0;
        $statusCounts = collect();

        if ($schoolIds->isNotEmpty()) {
            $sectionCount = (int) Section::query()
                ->whereIn('school_id', $schoolIds)
                ->when($academicYearId !== null, fn (Builder $query) => $query->where('academic_year_id', $academicYearId))
                ->count();

            $statusCounts = Student::query()
                ->selectRaw('status, COUNT(*) as aggregate_count')
                ->whereIn('school_id', $schoolIds)
                ->when($academicYearId !== null, fn (Builder $query) => $query->where('academic_year_id', $academicYearId))
                ->groupBy('status')
                ->pluck('aggregate_count', 'status')
                ->map(static fn ($value): int => (int) $value);
        }

        $trackedLearners = (int) $statusCounts->sum();
        $enrolledLearners = (int) ($statusCounts->get('enrolled', 0) + $statusCounts->get('returning', 0));
        $atRiskLearners = (int) $statusCounts->get('at_risk', 0);
        $dropoutLearners = (int) $statusCounts->get('dropped_out', 0);
        $completerLearners = (int) ($statusCounts->get('completer', 0) + $statusCounts->get('graduated', 0));
        $transfereeLearners = (int) $statusCounts->get('transferee', 0);
        $retainedLearners = max($trackedLearners - $dropoutLearners, 0);
        $reportedStudents = $trackedLearners;

        return [
            'generatedAt' => now()->toISOString(),
            'schoolsMonitored' => $totalSchools,
            'activeSchools' => $activeSchools,
            'pendingSchools' => $pendingSchools,
            'inactiveSchools' => $inactiveSchools,
            'reportedStudents' => $reportedStudents,
            'reportedTeachers' => $reportedTeachers,
            'trackedLearners' => $trackedLearners,
            'enrolledLearners' => $enrolledLearners,
            'atRiskLearners' => $atRiskLearners,
            'dropoutLearners' => $dropoutLearners,
            'completerLearners' => $completerLearners,
            'transfereeLearners' => $transfereeLearners,
            'studentTeacherRatio' => $reportedTeachers > 0 ? round($reportedStudents / $reportedTeachers, 2) : null,
            'studentClassroomRatio' => $sectionCount > 0 ? round($reportedStudents / $sectionCount, 2) : null,
            'enrollmentRatePercent' => $this->calculatePercentage($enrolledLearners, $trackedLearners),
            'retentionRatePercent' => $this->calculatePercentage($retainedLearners, $trackedLearners),
            'dropoutRatePercent' => $this->calculatePercentage($dropoutLearners, $trackedLearners),
            'completionRatePercent' => $this->calculatePercentage($completerLearners, $trackedLearners),
            'atRiskRatePercent' => $this->calculatePercentage($atRiskLearners, $trackedLearners),
            'transitionRatePercent' => $this->calculatePercentage($transfereeLearners + $completerLearners, $trackedLearners),
        ];
    }

    private function syncSchoolStudentCount(School $school): void
    {
        if (! $school->exists) {
            return;
        }

        $studentCount = Student::query()
            ->where('school_id', $school->id)
            ->count();

        if ((int) $school->reported_student_count === $studentCount) {
            return;
        }

        $school->reported_student_count = $studentCount;
        $school->saveQuietly();
    }

    /**
     * @param array<int, int|string> $schoolIds
     */
    private function syncSchoolStudentCounts(array $schoolIds): void
    {
        $normalizedIds = collect($schoolIds)
            ->map(static fn (mixed $id): int => (int) $id)
            ->filter(static fn (int $id): bool => $id > 0)
            ->unique()
            ->values();

        if ($normalizedIds->isEmpty()) {
            return;
        }

        $countsBySchoolId = Student::query()
            ->selectRaw('school_id, COUNT(*) as aggregate_count')
            ->whereIn('school_id', $normalizedIds->all())
            ->groupBy('school_id')
            ->pluck('aggregate_count', 'school_id');

        $normalizedIds->chunk(100)->each(function ($chunk) use ($countsBySchoolId): void {
            $cases = [];
            $bindings = [];
            $chunkIds = $chunk->all();

            foreach ($chunkIds as $schoolId) {
                $cases[] = 'WHEN ? THEN ?';
                $bindings[] = $schoolId;
                $bindings[] = (int) $countsBySchoolId->get($schoolId, 0);
            }

            $placeholders = implode(', ', array_fill(0, count($chunkIds), '?'));
            foreach ($chunkIds as $schoolId) {
                $bindings[] = $schoolId;
            }

            DB::update(
                'UPDATE schools SET reported_student_count = CASE id '
                . implode(' ', $cases)
                . ' END WHERE id IN (' . $placeholders . ')',
                $bindings,
            );
        });
    }

    /**
     * @param array<string, int|float|null|string> $targetsMet
     *
     * @return array<int, array<string, int|float|string|null>>
     */
    private function buildSyncAlerts(array $targetsMet): array
    {
        $alerts = [];

        $dropoutRate = (float) ($targetsMet['dropoutRatePercent'] ?? 0);
        if ($dropoutRate >= 4.0) {
            $alerts[] = [
                'id' => 'dropout-rate',
                'level' => $dropoutRate >= 8.0 ? 'critical' : 'warning',
                'title' => 'Dropout rate exceeds TARGETS-MET watch threshold',
                'message' => "Current dropout rate is {$dropoutRate}%. Initiate technical assistance for affected schools.",
                'metric' => 'dropoutRatePercent',
                'value' => $dropoutRate,
                'threshold' => 4.0,
            ];
        }

        $atRiskRate = (float) ($targetsMet['atRiskRatePercent'] ?? 0);
        $atRiskLearners = (int) ($targetsMet['atRiskLearners'] ?? 0);
        if ($atRiskLearners > 0) {
            $alerts[] = [
                'id' => 'at-risk-learners',
                'level' => $atRiskRate >= 10.0 ? 'warning' : 'info',
                'title' => 'At-risk learners detected',
                'message' => "{$atRiskLearners} learner(s) are tagged at risk. Prioritize intervention planning.",
                'metric' => 'atRiskLearners',
                'value' => $atRiskLearners,
                'threshold' => 1,
            ];
        }

        $studentTeacherRatio = (float) ($targetsMet['studentTeacherRatio'] ?? 0);
        if ($studentTeacherRatio > 45) {
            $alerts[] = [
                'id' => 'student-teacher-ratio',
                'level' => 'warning',
                'title' => 'Student-teacher ratio is above recommended range',
                'message' => "Current ratio is {$studentTeacherRatio}:1. Review staffing and load balancing.",
                'metric' => 'studentTeacherRatio',
                'value' => $studentTeacherRatio,
                'threshold' => 45,
            ];
        }

        $pendingSchools = (int) ($targetsMet['pendingSchools'] ?? 0);
        if ($pendingSchools > 0) {
            $alerts[] = [
                'id' => 'pending-school-records',
                'level' => 'info',
                'title' => 'Pending school submissions',
                'message' => "{$pendingSchools} school(s) are still marked pending. Follow up for compliance.",
                'metric' => 'pendingSchools',
                'value' => $pendingSchools,
                'threshold' => 0,
            ];
        }

        if ($alerts === []) {
            $alerts[] = [
                'id' => 'no-critical-alerts',
                'level' => 'success',
                'title' => 'No critical TARGETS-MET alerts',
                'message' => 'Current synchronized indicators are within watch thresholds.',
                'metric' => null,
                'value' => null,
                'threshold' => null,
            ];
        }

        return $alerts;
    }

    private function calculatePercentage(int $numerator, int $denominator): float
    {
        if ($denominator <= 0) {
            return 0.0;
        }

        return round(($numerator / $denominator) * 100, 2);
    }

    private function applySyncHeaders(
        JsonResponse $response,
        string $etag,
        string $scope,
        string $scopeKey,
        int $recordCount,
        ?Carbon $latestAt,
        string $syncedAt,
    ): JsonResponse {
        $response->setEtag($etag);
        if ($latestAt) {
            $response->setLastModified($latestAt);
        }

        $response->headers->set('X-Sync-Scope', $scope);
        $response->headers->set('X-Sync-Scope-Key', $scopeKey);
        $response->headers->set('X-Sync-Record-Count', (string) $recordCount);
        $response->headers->set('X-Sync-Etag', $etag);
        $response->headers->set('X-Synced-At', $syncedAt);

        return $response;
    }

    private function buildNotModifiedResponse(string $etag, string $scope, string $scopeKey, int $recordCount, ?Carbon $latestAt): JsonResponse
    {
        $response = response()->json(null, Response::HTTP_NOT_MODIFIED);

        return $this->applySyncHeaders(
            $response,
            $etag,
            $scope,
            $scopeKey,
            $recordCount,
            $latestAt,
            now()->toISOString(),
        );
    }

    /**
     * @return array{
     *     recordCount: int,
     *     sectionCount: int,
     *     studentCount: int,
     *     indicatorSubmissionCount: int,
     *     studentStatusSignature: string,
     *     latestAt: ?Carbon
     * }
     */
    private function buildSyncFingerprint(Builder $baseQuery, ?int $academicYearId = null): array
    {
        $schoolProbe = (clone $baseQuery)
            ->selectRaw('COUNT(*) as aggregate_count')
            ->selectRaw('MAX(updated_at) as latest_updated_at')
            ->selectRaw('MAX(submitted_at) as latest_submitted_at')
            ->first();

        $recordCount = (int) ($schoolProbe?->aggregate_count ?? 0);
        $schoolIds = (clone $baseQuery)->pluck('id');

        $sectionCount = 0;
        $studentCount = 0;
        $indicatorSubmissionCount = 0;
        $studentStatusSignature = '';
        $latestSectionUpdatedAt = null;
        $latestStudentUpdatedAt = null;
        $latestStudentStatusAt = null;
        $latestIndicatorUpdatedAt = null;
        $latestIndicatorSubmittedAt = null;
        $latestIndicatorReviewedAt = null;

        if ($schoolIds->isNotEmpty()) {
            $sectionProbe = Section::query()
                ->whereIn('school_id', $schoolIds)
                ->when($academicYearId !== null, fn (Builder $query) => $query->where('academic_year_id', $academicYearId))
                ->selectRaw('COUNT(*) as aggregate_count')
                ->selectRaw('MAX(updated_at) as latest_updated_at')
                ->first();

            $sectionCount = (int) ($sectionProbe?->aggregate_count ?? 0);
            $latestSectionUpdatedAt = $sectionProbe?->latest_updated_at;

            $studentProbe = Student::query()
                ->whereIn('school_id', $schoolIds)
                ->when($academicYearId !== null, fn (Builder $query) => $query->where('academic_year_id', $academicYearId))
                ->selectRaw('COUNT(*) as aggregate_count')
                ->selectRaw('MAX(updated_at) as latest_updated_at')
                ->selectRaw('MAX(last_status_at) as latest_status_changed_at')
                ->first();

            $studentCount = (int) ($studentProbe?->aggregate_count ?? 0);
            $latestStudentUpdatedAt = $studentProbe?->latest_updated_at;
            $latestStudentStatusAt = $studentProbe?->latest_status_changed_at;
            $studentStatusSignature = Student::query()
                ->whereIn('school_id', $schoolIds)
                ->when($academicYearId !== null, fn (Builder $query) => $query->where('academic_year_id', $academicYearId))
                ->selectRaw('status, COUNT(*) as aggregate_count')
                ->groupBy('status')
                ->orderBy('status')
                ->get()
                ->map(static function (object $row): string {
                    $status = $row->status;
                    $statusValue = $status instanceof StudentStatus ? $status->value : (string) $status;

                    return sprintf('%s:%d', $statusValue, (int) $row->aggregate_count);
                })
                ->implode(',');

            $indicatorProbe = IndicatorSubmission::query()
                ->whereIn('school_id', $schoolIds)
                ->when($academicYearId !== null, fn (Builder $query) => $query->where('academic_year_id', $academicYearId))
                ->selectRaw('COUNT(*) as aggregate_count')
                ->selectRaw('MAX(updated_at) as latest_updated_at')
                ->selectRaw('MAX(submitted_at) as latest_submitted_at')
                ->selectRaw('MAX(reviewed_at) as latest_reviewed_at')
                ->first();

            $indicatorSubmissionCount = (int) ($indicatorProbe?->aggregate_count ?? 0);
            $latestIndicatorUpdatedAt = $indicatorProbe?->latest_updated_at;
            $latestIndicatorSubmittedAt = $indicatorProbe?->latest_submitted_at;
            $latestIndicatorReviewedAt = $indicatorProbe?->latest_reviewed_at;
        }

        $latestAt = $this->resolveLatestTimestamp(
            $schoolProbe?->latest_updated_at,
            $schoolProbe?->latest_submitted_at,
            $latestSectionUpdatedAt,
            $latestStudentUpdatedAt,
            $latestStudentStatusAt,
            $latestIndicatorUpdatedAt,
            $latestIndicatorSubmittedAt,
            $latestIndicatorReviewedAt,
        );

        return [
            'recordCount' => $recordCount,
            'sectionCount' => $sectionCount,
            'studentCount' => $studentCount,
            'indicatorSubmissionCount' => $indicatorSubmissionCount,
            'studentStatusSignature' => $studentStatusSignature,
            'latestAt' => $latestAt,
        ];
    }

    /**
     * @param array{
     *     recordCount: int,
     *     sectionCount: int,
     *     studentCount: int,
     *     indicatorSubmissionCount: int,
     *     studentStatusSignature: string,
     *     latestAt: ?Carbon
     * } $syncFingerprint
     */
    private function buildSyncEtag(string $scope, string $scopeKey, array $syncFingerprint): string
    {
        return sha1(implode('|', [
            $scope,
            $scopeKey,
            (string) $syncFingerprint['recordCount'],
            (string) $syncFingerprint['sectionCount'],
            (string) $syncFingerprint['studentCount'],
            (string) $syncFingerprint['indicatorSubmissionCount'],
            (string) $syncFingerprint['studentStatusSignature'],
            $syncFingerprint['latestAt']?->format('U.u') ?? '0',
        ]));
    }

    private function resolvePerPage(Request $request, int $default = 50, int $max = 200): int
    {
        $perPage = $request->integer('per_page');

        if ($perPage <= 0) {
            return $default;
        }

        return min($perPage, $max);
    }

    private function usersHaveDeleteRecordFlags(): bool
    {
        if (app()->runningUnitTests()) {
            return Schema::hasColumn('users', 'delete_record_flagged_at');
        }

        if (self::$usersHaveDeleteRecordFlagsCache === null) {
            self::$usersHaveDeleteRecordFlagsCache = Schema::hasColumn('users', 'delete_record_flagged_at');
        }

        return self::$usersHaveDeleteRecordFlagsCache;
    }

    private function applyDashboardSchoolHeadAccountQuery($query): void
    {
        $columns = [
            'id',
            'name',
            'email',
            'email_verified_at',
            'must_reset_password',
            'temporary_password_issued_at',
            'temporary_password_display',
            'last_login_at',
            'account_status',
            'school_id',
            'verified_at',
            'verified_by_user_id',
            'verification_notes',
            'flagged_at',
            'flagged_reason',
        ];

        if ($this->usersHaveDeleteRecordFlags()) {
            $columns[] = 'delete_record_flagged_at';
            $columns[] = 'delete_record_flag_reason';
        }

        $query->select($columns)
            ->with('verifiedBy:id,name');

        if ($this->accountSetupTokensTableExists()) {
            $query->with(['latestAccountSetupToken' => function ($setupTokenQuery): void {
                $setupTokenQuery->select([
                    'account_setup_tokens.id',
                    'account_setup_tokens.user_id',
                    'account_setup_tokens.expires_at',
                    'account_setup_tokens.used_at',
                ]);
            }]);
        }
    }

    private function usersHaveAccountTypeColumn(): bool
    {
        if (app()->runningUnitTests()) {
            return Schema::hasColumn('users', 'account_type');
        }

        if (self::$usersHaveAccountTypeColumnCache === null) {
            self::$usersHaveAccountTypeColumnCache = Schema::hasColumn('users', 'account_type');
        }

        return self::$usersHaveAccountTypeColumnCache;
    }

    private function sessionsTableExists(): bool
    {
        if (app()->runningUnitTests()) {
            return Schema::hasTable('sessions');
        }

        if (self::$sessionsTableExistsCache === null) {
            self::$sessionsTableExistsCache = Schema::hasTable('sessions');
        }

        return self::$sessionsTableExistsCache;
    }

    private function resolveLatestTimestamp(?string ...$rawTimestamps): ?Carbon
    {
        $timestamps = [];
        foreach ($rawTimestamps as $rawTimestamp) {
            if (! $rawTimestamp) {
                continue;
            }

            $timestamps[] = Carbon::parse($rawTimestamp);
        }

        if ($timestamps === []) {
            return null;
        }

        usort(
            $timestamps,
            static fn (Carbon $a, Carbon $b): int => $b->greaterThan($a) ? 1 : ($a->equalTo($b) ? 0 : -1),
        );

        return $timestamps[0];
    }
}
