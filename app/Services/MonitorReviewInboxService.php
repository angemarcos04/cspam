<?php

namespace App\Services;

use App\Models\IndicatorSubmission;
use App\Models\School;
use App\Models\User;
use App\Support\Domain\FormSubmissionStatus;
use App\Support\Schools\SchoolCoverage;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

class MonitorReviewInboxService
{
    /**
     * @param array<string, mixed> $filters
     * @return array{data: array<int, array<string, mixed>>, meta: array<string, mixed>, filters: array<string, mixed>}
     */
    public function build(array $filters): array
    {
        $page = max(1, (int) ($filters['page'] ?? 1));
        $perPage = min(100, max(1, (int) ($filters['per_page'] ?? 10)));
        $academicYearId = $this->positiveIntegerOrNull($filters['academic_year_id'] ?? null);

        $schools = $this->baseSchoolQuery($filters, $academicYearId)->get();
        $baseRows = $schools
            ->map(fn (School $school): array => $this->buildRow($school))
            ->filter(static fn (array $row): bool => ($row['schoolKey'] ?? 'unknown') !== 'unknown')
            ->values();

        $filteredRows = $this->applyRowFilters($baseRows, $filters);
        $actionRows = $filteredRows
            ->filter(static fn (array $row): bool => (
                (int) ($row['missingCount'] ?? 0) > 0
                || (int) ($row['awaitingReviewCount'] ?? 0) > 0
                || ($row['indicatorStatus'] ?? null) === FormSubmissionStatus::RETURNED->value
            ))
            ->values();

        $displayRows = $filteredRows
            ->filter(fn (array $row): bool => $this->matchesLane($row, (string) ($filters['lane'] ?? 'all')))
            ->sort($this->sortRows(...))
            ->values();

        $total = $displayRows->count();
        $lastPage = max(1, (int) ceil($total / $perPage));
        $safePage = min($page, $lastPage);
        $offset = ($safePage - 1) * $perPage;
        $pageRows = $displayRows->slice($offset, $perPage)->values();

        return [
            'data' => $pageRows
                ->map(static function (array $row): array {
                    unset($row['searchText']);

                    return $row;
                })
                ->all(),
            'meta' => [
                'currentPage' => $safePage,
                'lastPage' => $lastPage,
                'perPage' => $perPage,
                'total' => $total,
                'from' => $total > 0 ? $offset + 1 : null,
                'to' => $total > 0 ? $offset + $pageRows->count() : null,
                'hasMorePages' => $safePage < $lastPage,
                'requirementCounts' => $this->requirementCounts($baseRows),
                'workflowStatusCounts' => $this->workflowStatusCounts($baseRows),
                'schoolStatusCounts' => $this->schoolStatusCounts($baseRows),
                'queueLaneCounts' => $this->queueLaneCounts($actionRows),
                'schoolPresetCounts' => $this->schoolPresetCounts($filteredRows),
                'schoolCategoryCounts' => $this->schoolCategoryCounts($baseRows),
                'needsActionCount' => $actionRows->count(),
            ],
            'filters' => $this->serializeFilters($filters),
        ];
    }

    /**
     * @param array<string, mixed> $filters
     */
    private function baseSchoolQuery(array $filters, ?int $academicYearId): Builder
    {
        $query = School::query()
            ->with('submittedBy:id,name')
            ->with('latestReminder.sentBy:id,name')
            ->with([
                'schoolHeadAccounts',
                'latestMonitorRelevantIndicatorSubmission' => fn ($query) => $this->scopeLatestSubmission($query, $academicYearId),
                'latestIndicatorSubmission' => fn ($query) => $this->scopeLatestSubmission($query, $academicYearId),
            ])
            ->orderBy('name');

        $schoolId = $this->positiveIntegerOrNull($filters['school_id'] ?? null);
        if ($schoolId !== null) {
            $query->whereKey($schoolId);
        }

        $status = (string) ($filters['status'] ?? '');
        if (in_array($status, ['active', 'inactive', 'pending'], true)) {
            $query->where('status', $status);
        }

        return $query;
    }

    private function scopeLatestSubmission($query, ?int $academicYearId): void
    {
        if ($academicYearId !== null) {
            $query->where('academic_year_id', $academicYearId);
        }

        $query->with([
            'scopeSubmissions:id,indicator_submission_id,scope_id',
            'scopeReviews:id,indicator_submission_id,scope_id,decision,reviewed_at,updated_at',
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function buildRow(School $school): array
    {
        $submission = $school->latestMonitorRelevantIndicatorSubmission ?: $school->latestIndicatorSubmission;
        $indicatorStatus = $this->monitorEffectiveIndicatorStatus($submission);
        $hasActivePackageSubmission = in_array($indicatorStatus, [
            FormSubmissionStatus::SUBMITTED->value,
            FormSubmissionStatus::VALIDATED->value,
            FormSubmissionStatus::RETURNED->value,
        ], true);
        $awaitingReviewCount = $indicatorStatus === FormSubmissionStatus::SUBMITTED->value ? 1 : 0;
        $missingCount = $hasActivePackageSubmission ? 0 : 1;
        $lastActivityAt = $this->latestTimestamp(
            $school->submitted_at?->toISOString(),
            $school->updated_at?->toISOString(),
            $submission?->updated_at?->toISOString(),
            $submission?->submitted_at?->toISOString(),
            $submission?->created_at?->toISOString(),
            $submission?->reviewed_at?->toISOString(),
        );

        $schoolType = $this->normalizeSchoolType($school->type);
        $hasReminderRecipient = $school->relationLoaded('schoolHeadAccounts')
            && $school->schoolHeadAccounts->contains(static fn (User $account): bool => $account->canAuthenticate());

        return [
            'schoolKey' => $this->schoolKey($school),
            'schoolId' => (string) $school->id,
            'schoolCode' => trim((string) $school->school_code) !== '' ? (string) $school->school_code : 'N/A',
            'schoolName' => trim((string) $school->name) !== '' ? (string) $school->name : 'Unknown School',
            'region' => trim((string) $school->region) !== '' ? (string) $school->region : 'N/A',
            'schoolStatus' => $school->status,
            'schoolType' => $school->type,
            'schoolLevel' => $school->level,
            'packageSchoolType' => $schoolType,
            'requirementModeLabel' => $schoolType === 'private'
                ? 'Active package requirements: FM-QAD uploads only.'
                : 'Active package requirements: BMEF and SMEA.',
            'activePackageLabel' => $schoolType === 'private' ? 'FM-QAD uploads only' : 'BMEF and SMEA',
            'hasComplianceRecord' => true,
            'indicatorStatus' => $indicatorStatus,
            'hasActivePackageSubmission' => $hasActivePackageSubmission,
            'hasAnySubmitted' => $hasActivePackageSubmission,
            'isComplete' => $missingCount === 0,
            'awaitingReviewCount' => $awaitingReviewCount,
            'missingCount' => $missingCount,
            'lastActivityAt' => $lastActivityAt,
            'lastActivityTime' => $lastActivityAt !== null ? CarbonImmutable::parse($lastActivityAt)->getTimestampMs() : 0,
            'hasReminderRecipient' => $hasReminderRecipient,
            'reminderRecipientStatus' => $school->schoolHeadAccounts->isEmpty()
                ? 'missing'
                : ($hasReminderRecipient ? 'available' : 'inactive'),
            'latestReminder' => $this->latestReminderPayload($school),
            'searchText' => $this->searchText($school),
        ];
    }

    private function monitorEffectiveIndicatorStatus(?IndicatorSubmission $submission): ?string
    {
        if (! $submission) {
            return null;
        }

        $status = $submission->status instanceof FormSubmissionStatus
            ? $submission->status->value
            : strtolower(trim((string) $submission->status));

        if (in_array($status, [
            FormSubmissionStatus::SUBMITTED->value,
            FormSubmissionStatus::VALIDATED->value,
            FormSubmissionStatus::RETURNED->value,
        ], true)) {
            return $status;
        }

        $submittedScopeIds = $submission->scopeSubmissions
            ->pluck('scope_id')
            ->map(static fn (mixed $scopeId): string => strtolower(trim((string) $scopeId)))
            ->filter()
            ->values();

        if ($submittedScopeIds->isNotEmpty()) {
            $reviews = $submission->scopeReviews
                ->keyBy(static fn ($review): string => strtolower(trim((string) $review->scope_id)));

            $allSentScopesVerified = $submittedScopeIds->every(static fn (string $scopeId): bool => (
                strtolower(trim((string) ($reviews->get($scopeId)?->decision ?? ''))) === 'verified'
            ));

            return $allSentScopesVerified
                ? FormSubmissionStatus::VALIDATED->value
                : FormSubmissionStatus::SUBMITTED->value;
        }

        $hasReturnedReview = $submission->scopeReviews
            ->contains(static fn ($review): bool => strtolower(trim((string) $review->decision)) === 'returned');

        if ($hasReturnedReview) {
            return FormSubmissionStatus::RETURNED->value;
        }

        return in_array($status, ['draft'], true) ? $status : null;
    }

    /**
     * @param Collection<int, array<string, mixed>> $rows
     * @param array<string, mixed> $filters
     * @return Collection<int, array<string, mixed>>
     */
    private function applyRowFilters(Collection $rows, array $filters): Collection
    {
        $searchTerms = $this->searchTerms((string) ($filters['search'] ?? $filters['q'] ?? ''));
        $workflow = (string) ($filters['workflow'] ?? 'all');
        $preset = (string) ($filters['preset'] ?? 'all');
        $sector = (string) ($filters['sector'] ?? 'all');
        $level = (string) ($filters['level'] ?? 'all');
        $fromTime = $this->dateBoundary((string) ($filters['date_from'] ?? ''), 'start');
        $toTime = $this->dateBoundary((string) ($filters['date_to'] ?? ''), 'end');

        return $rows
            ->filter(fn (array $row): bool => $this->matchesWorkflow($row, $workflow))
            ->filter(fn (array $row): bool => $this->matchesPreset($row, $preset))
            ->filter(fn (array $row): bool => $this->matchesSector($row, $sector))
            ->filter(fn (array $row): bool => $this->matchesLevel($row, $level))
            ->filter(fn (array $row): bool => $fromTime === null || ((int) ($row['lastActivityTime'] ?? 0) >= $fromTime))
            ->filter(fn (array $row): bool => $toTime === null || ((int) ($row['lastActivityTime'] ?? 0) <= $toTime))
            ->filter(fn (array $row): bool => $this->matchesSearch($row, $searchTerms))
            ->values();
    }

    private function resolveWorkflowStatus(array $row): string
    {
        if ((int) ($row['missingCount'] ?? 0) > 0) {
            return 'missing';
        }

        if (($row['indicatorStatus'] ?? null) === FormSubmissionStatus::RETURNED->value) {
            return 'returned';
        }

        if ((int) ($row['awaitingReviewCount'] ?? 0) > 0 || ($row['indicatorStatus'] ?? null) === FormSubmissionStatus::SUBMITTED->value) {
            return 'waiting';
        }

        if (($row['indicatorStatus'] ?? null) === FormSubmissionStatus::VALIDATED->value) {
            return 'validated';
        }

        if (($row['hasAnySubmitted'] ?? false) === true) {
            return 'submitted';
        }

        return 'missing';
    }

    private function matchesWorkflow(array $row, string $workflow): bool
    {
        return $workflow === 'all' || $this->resolveWorkflowStatus($row) === $workflow;
    }

    private function matchesLane(array $row, string $lane): bool
    {
        return match ($lane) {
            'urgent' => (int) ($row['missingCount'] ?? 0) > 0 || ($row['indicatorStatus'] ?? null) === FormSubmissionStatus::RETURNED->value,
            'returned' => ($row['indicatorStatus'] ?? null) === FormSubmissionStatus::RETURNED->value,
            'for_review' => (int) ($row['awaitingReviewCount'] ?? 0) > 0,
            'waiting_data' => (int) ($row['missingCount'] ?? 0) > 0,
            default => true,
        };
    }

    private function matchesPreset(array $row, string $preset): bool
    {
        return match ($preset) {
            'pending' => (int) ($row['awaitingReviewCount'] ?? 0) > 0 || ($row['indicatorStatus'] ?? null) === FormSubmissionStatus::SUBMITTED->value,
            'missing' => (int) ($row['missingCount'] ?? 0) > 0,
            'returned' => ($row['indicatorStatus'] ?? null) === FormSubmissionStatus::RETURNED->value,
            'no_submission' => ($row['hasComplianceRecord'] ?? false) === false && ($row['hasAnySubmitted'] ?? false) === false,
            default => true,
        };
    }

    private function matchesSector(array $row, string $sector): bool
    {
        return $sector === 'all' || $this->normalizeSchoolType($row['schoolType'] ?? null) === $sector;
    }

    private function matchesLevel(array $row, string $level): bool
    {
        if ($level === 'all') {
            return true;
        }

        $schoolLevel = $row['schoolLevel'] ?? null;
        if ($level === 'legacy_high_school' || $level === 'high_school') {
            return SchoolCoverage::isLegacyHighSchool($schoolLevel);
        }

        return SchoolCoverage::hasToken($schoolLevel, $level);
    }

    /**
     * @param list<string> $terms
     */
    private function matchesSearch(array $row, array $terms): bool
    {
        if ($terms === []) {
            return true;
        }

        $searchText = strtolower((string) ($row['searchText'] ?? ''));

        foreach ($terms as $term) {
            if (! str_contains($searchText, $term)) {
                return false;
            }
        }

        return true;
    }

    private function sortRows(array $a, array $b): int
    {
        $priorityDiff = $this->queuePriorityScore($a) <=> $this->queuePriorityScore($b);
        if ($priorityDiff !== 0) {
            return $priorityDiff;
        }

        $missingDiff = (int) ($b['missingCount'] ?? 0) <=> (int) ($a['missingCount'] ?? 0);
        if ($missingDiff !== 0) {
            return $missingDiff;
        }

        $waitingDiff = (int) ($b['awaitingReviewCount'] ?? 0) <=> (int) ($a['awaitingReviewCount'] ?? 0);
        if ($waitingDiff !== 0) {
            return $waitingDiff;
        }

        $activityDiff = (int) ($b['lastActivityTime'] ?? 0) <=> (int) ($a['lastActivityTime'] ?? 0);
        if ($activityDiff !== 0) {
            return $activityDiff;
        }

        return strcasecmp((string) ($a['schoolName'] ?? ''), (string) ($b['schoolName'] ?? ''));
    }

    private function queuePriorityScore(array $row): int
    {
        if (($row['indicatorStatus'] ?? null) === FormSubmissionStatus::RETURNED->value) {
            return 0;
        }

        if ((int) ($row['missingCount'] ?? 0) > 0) {
            return 1;
        }

        if ((int) ($row['awaitingReviewCount'] ?? 0) > 0) {
            return 2;
        }

        return 3;
    }

    /**
     * @param Collection<int, array<string, mixed>> $rows
     * @return array<string, int>
     */
    private function requirementCounts(Collection $rows): array
    {
        return [
            'total' => $rows->count(),
            'submittedAny' => $rows->filter(static fn (array $row): bool => ($row['hasAnySubmitted'] ?? false) === true)->count(),
            'complete' => $rows->filter(static fn (array $row): bool => ($row['isComplete'] ?? false) === true)->count(),
            'awaitingReview' => $rows->filter(static fn (array $row): bool => (int) ($row['awaitingReviewCount'] ?? 0) > 0)->count(),
            'missing' => $rows->filter(static fn (array $row): bool => (int) ($row['missingCount'] ?? 0) > 0)->count(),
            'returned' => $rows->filter(static fn (array $row): bool => ($row['indicatorStatus'] ?? null) === FormSubmissionStatus::RETURNED->value)->count(),
        ];
    }

    /**
     * @param Collection<int, array<string, mixed>> $rows
     * @return array<string, int>
     */
    private function workflowStatusCounts(Collection $rows): array
    {
        $counts = ['all' => $rows->count(), 'missing' => 0, 'waiting' => 0, 'returned' => 0, 'submitted' => 0, 'validated' => 0];

        foreach ($rows as $row) {
            $counts[$this->resolveWorkflowStatus($row)]++;
        }

        return $counts;
    }

    /**
     * @param Collection<int, array<string, mixed>> $rows
     * @return array<string, int>
     */
    private function schoolStatusCounts(Collection $rows): array
    {
        $counts = ['all' => $rows->count(), 'active' => 0, 'inactive' => 0, 'pending' => 0];

        foreach ($rows as $row) {
            $status = (string) ($row['schoolStatus'] ?? '');
            if (array_key_exists($status, $counts)) {
                $counts[$status]++;
            }
        }

        return $counts;
    }

    /**
     * @param Collection<int, array<string, mixed>> $rows
     * @return array<string, int>
     */
    private function queueLaneCounts(Collection $rows): array
    {
        return [
            'all' => $rows->count(),
            'urgent' => $rows->filter(fn (array $row): bool => $this->matchesLane($row, 'urgent'))->count(),
            'returned' => $rows->filter(fn (array $row): bool => $this->matchesLane($row, 'returned'))->count(),
            'for_review' => $rows->filter(fn (array $row): bool => $this->matchesLane($row, 'for_review'))->count(),
            'waiting_data' => $rows->filter(fn (array $row): bool => $this->matchesLane($row, 'waiting_data'))->count(),
        ];
    }

    /**
     * @param Collection<int, array<string, mixed>> $rows
     * @return array<string, int>
     */
    private function schoolPresetCounts(Collection $rows): array
    {
        return [
            'all' => $rows->count(),
            'pending' => $rows->filter(fn (array $row): bool => $this->matchesPreset($row, 'pending'))->count(),
            'missing' => $rows->filter(fn (array $row): bool => $this->matchesPreset($row, 'missing'))->count(),
            'returned' => $rows->filter(fn (array $row): bool => $this->matchesPreset($row, 'returned'))->count(),
            'no_submission' => $rows->filter(fn (array $row): bool => $this->matchesPreset($row, 'no_submission'))->count(),
        ];
    }

    /**
     * @param Collection<int, array<string, mixed>> $rows
     * @return array<string, int>
     */
    private function schoolCategoryCounts(Collection $rows): array
    {
        $counts = [
            'total' => 0,
            'public' => 0,
            'private' => 0,
            'publicElementary' => 0,
            'publicJuniorHigh' => 0,
            'publicSeniorHigh' => 0,
            'publicLegacyHighSchool' => 0,
            'privateElementary' => 0,
            'privateJuniorHigh' => 0,
            'privateSeniorHigh' => 0,
            'privateLegacyHighSchool' => 0,
        ];

        foreach ($rows as $row) {
            $counts['total']++;
            $sector = $this->normalizeSchoolType($row['schoolType'] ?? null);
            $coverage = SchoolCoverage::parse($row['schoolLevel'] ?? null);
            $hasValidExplicitCoverage = $coverage['unknownLabel'] === null && ! $coverage['legacyHighSchool'];
            if ($sector === 'public') {
                $counts['public']++;
                if ($hasValidExplicitCoverage && in_array('elementary', $coverage['tokens'], true)) {
                    $counts['publicElementary']++;
                }
                if ($hasValidExplicitCoverage && in_array('junior_high', $coverage['tokens'], true)) {
                    $counts['publicJuniorHigh']++;
                }
                if ($hasValidExplicitCoverage && in_array('senior_high', $coverage['tokens'], true)) {
                    $counts['publicSeniorHigh']++;
                }
                if ($coverage['legacyHighSchool'] && $coverage['tokens'] === []) {
                    $counts['publicLegacyHighSchool']++;
                }
            }
            if ($sector === 'private') {
                $counts['private']++;
                if ($hasValidExplicitCoverage && in_array('elementary', $coverage['tokens'], true)) {
                    $counts['privateElementary']++;
                }
                if ($hasValidExplicitCoverage && in_array('junior_high', $coverage['tokens'], true)) {
                    $counts['privateJuniorHigh']++;
                }
                if ($hasValidExplicitCoverage && in_array('senior_high', $coverage['tokens'], true)) {
                    $counts['privateSeniorHigh']++;
                }
                if ($coverage['legacyHighSchool'] && $coverage['tokens'] === []) {
                    $counts['privateLegacyHighSchool']++;
                }
            }
        }

        return $counts;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function latestReminderPayload(School $school): ?array
    {
        if (! $school->relationLoaded('latestReminder') || ! $school->latestReminder) {
            return null;
        }

        $reminder = $school->latestReminder;

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

    private function schoolKey(School $school): string
    {
        $code = strtolower(trim((string) $school->school_code));
        if ($code !== '') {
            return 'code:' . $code;
        }

        $name = strtolower(trim((string) $school->name));
        if ($name !== '') {
            return 'name:' . $name;
        }

        return 'unknown';
    }

    private function searchText(School $school): string
    {
        $accounts = $school->relationLoaded('schoolHeadAccounts')
            ? $school->schoolHeadAccounts
                ->flatMap(static fn (User $account): array => [$account->name, $account->email])
                ->filter()
                ->implode(' ')
            : '';

        return strtolower(implode(' ', array_filter([
            $school->name,
            $school->school_code,
            $school->region,
            $school->level,
            $school->type,
            $school->address,
            $school->district,
            $school->submittedBy?->name,
            $accounts,
        ])));
    }

    private function normalizeSchoolType(mixed $value): string
    {
        $normalized = strtolower(trim((string) $value));

        return $normalized === 'private' ? 'private' : 'public';
    }

    private function latestTimestamp(?string ...$values): ?string
    {
        $latestMs = 0;
        $latest = null;

        foreach ($values as $value) {
            if (! $value) {
                continue;
            }

            $parsedMs = CarbonImmutable::parse($value)->getTimestampMs();
            if ($parsedMs > $latestMs) {
                $latestMs = $parsedMs;
                $latest = CarbonImmutable::createFromTimestampMs($parsedMs)->toISOString();
            }
        }

        return $latest;
    }

    /**
     * @return list<string>
     */
    private function searchTerms(string $value): array
    {
        $terms = preg_split('/\s+/', strtolower(trim($value))) ?: [];

        return array_values(array_filter($terms, static fn (string $term): bool => $term !== ''));
    }

    private function dateBoundary(string $value, string $boundary): ?int
    {
        $normalized = trim($value);
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $normalized)) {
            return null;
        }

        $suffix = $boundary === 'start' ? ' 00:00:00' : ' 23:59:59.999';

        return CarbonImmutable::parse($normalized . $suffix)->getTimestampMs();
    }

    private function positiveIntegerOrNull(mixed $value): ?int
    {
        if (! is_numeric($value)) {
            return null;
        }

        $integer = (int) $value;

        return $integer > 0 ? $integer : null;
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<string, mixed>
     */
    private function serializeFilters(array $filters): array
    {
        return [
            'search' => (string) ($filters['search'] ?? ''),
            'status' => (string) ($filters['status'] ?? 'all'),
            'workflow' => (string) ($filters['workflow'] ?? 'all'),
            'lane' => (string) ($filters['lane'] ?? 'all'),
            'preset' => (string) ($filters['preset'] ?? 'all'),
            'sector' => (string) ($filters['sector'] ?? 'all'),
            'level' => (string) ($filters['level'] ?? 'all'),
            'schoolId' => isset($filters['school_id']) ? (string) $filters['school_id'] : null,
            'dateFrom' => (string) ($filters['date_from'] ?? ''),
            'dateTo' => (string) ($filters['date_to'] ?? ''),
            'academicYearId' => isset($filters['academic_year_id']) ? (string) $filters['academic_year_id'] : null,
        ];
    }
}
