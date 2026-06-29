<?php

namespace App\Support\Indicators;

use App\Models\IndicatorSubmission;
use App\Models\IndicatorSubmissionItem;
use App\Models\User;
use App\Support\Auth\UserRoleResolver;
use App\Support\Domain\FormSubmissionStatus;

final class TargetsMetReportBuilder
{
    private const NOT_SUBMITTED_REASON = 'Scope has not been submitted for monitor review.';

    private const MISSING_VALUE_REASON = 'Value is missing.';

    public function __construct(
        private readonly TargetsMetReportDefinition $definition,
        private readonly SubmissionScopeProgressResolver $scopeProgressResolver,
    ) {
    }

    /**
     * @param array<string, mixed> $options
     * @return array<string, mixed>
     */
    public function build(IndicatorSubmission $submission, ?User $viewer = null, array $options = []): array
    {
        $submission->loadMissing([
            'school:id,school_code,name,type',
            'academicYear:id,name',
            'items.metric:id,code,name,category,framework,data_type,input_schema,unit,sort_order',
            'scopeSubmissions:id,indicator_submission_id,scope_id,scope_type,submitted_by,submitted_at',
            'scopeReviews:id,indicator_submission_id,scope_id,scope_type,decision,reviewed_by,reviewed_at,updated_at',
        ]);

        $selectedYear = trim((string) ($options['selectedYear'] ?? $submission->academicYear?->name ?? ''));
        $isMonitor = UserRoleResolver::has($viewer, UserRoleResolver::MONITOR);
        $status = $this->statusValue($submission->status);
        $visibleScopes = $this->visibleScopesForViewer($submission, $isMonitor);
        $items = $submission->items;

        $schoolAchievementsVisible = ! $isMonitor
            || in_array(TargetsMetReportDefinition::SCHOOL_ACHIEVEMENTS_SCOPE, $visibleScopes, true);
        $keyPerformanceVisible = ! $isMonitor
            || in_array(TargetsMetReportDefinition::KEY_PERFORMANCE_SCOPE, $visibleScopes, true);

        return [
            'submissionId' => (string) $submission->id,
            'school' => [
                'id' => (string) $submission->school_id,
                'name' => $submission->school?->name,
                'schoolCode' => $submission->school?->school_code,
                'type' => $submission->school?->type,
            ],
            'academicYear' => [
                'id' => $submission->academic_year_id ? (string) $submission->academic_year_id : null,
                'name' => $submission->academicYear?->name,
            ],
            'status' => $status,
            'scopeVisibility' => [
                'schoolAchievements' => $schoolAchievementsVisible,
                'keyPerformance' => $keyPerformanceVisible,
            ],
            'schoolAchievements' => $this->buildSchoolAchievementRows(
                $items,
                $selectedYear,
                $schoolAchievementsVisible,
                $this->sourceForScope($submission, $status, $isMonitor, TargetsMetReportDefinition::SCHOOL_ACHIEVEMENTS_SCOPE, $visibleScopes),
            ),
            'keyPerformanceIndicators' => $this->buildKpiRows(
                $items,
                $selectedYear,
                $keyPerformanceVisible,
                $this->sourceForScope($submission, $status, $isMonitor, TargetsMetReportDefinition::KEY_PERFORMANCE_SCOPE, $visibleScopes),
            ),
            'metadata' => [
                'submittedAt' => optional($submission->submitted_at)->toISOString(),
                'reviewedAt' => optional($submission->reviewed_at)->toISOString(),
                'generatedAt' => now()->toISOString(),
                'generatedBy' => $viewer ? [
                    'id' => (string) $viewer->id,
                    'name' => $viewer->name,
                    'role' => UserRoleResolver::has($viewer, UserRoleResolver::MONITOR)
                        ? UserRoleResolver::MONITOR
                        : (UserRoleResolver::has($viewer, UserRoleResolver::SCHOOL_HEAD) ? UserRoleResolver::SCHOOL_HEAD : null),
                ] : null,
            ],
        ];
    }

    /**
     * @param iterable<int, IndicatorSubmissionItem> $items
     * @return list<array<string, mixed>>
     */
    private function buildSchoolAchievementRows(
        iterable $items,
        string $selectedYear,
        bool $scopeVisible,
        ?string $source,
    ): array {
        $rows = [];

        foreach ($this->definition->schoolAchievementRows() as $row) {
            $item = $this->resolveItemForRow($items, $row);
            if (! $scopeVisible) {
                $rows[] = $this->hiddenSchoolAchievementRow($row);
                continue;
            }

            $actual = $this->resolveReportValue($item, 'actual', $selectedYear, false);
            $hasActual = $this->valueIsPresent($actual);

            $rows[] = [
                'key' => $row['key'],
                'code' => $row['code'],
                'label' => $row['label'],
                'actual' => $hasActual ? $this->formatReportValue($actual, $item) : null,
                'visible' => true,
                'source' => $source,
                'missingReason' => $hasActual ? null : self::MISSING_VALUE_REASON,
            ];
        }

        return $rows;
    }

    /**
     * @param iterable<int, IndicatorSubmissionItem> $items
     * @return list<array<string, mixed>>
     */
    private function buildKpiRows(
        iterable $items,
        string $selectedYear,
        bool $scopeVisible,
        ?string $source,
    ): array {
        $rows = [];

        foreach ($this->definition->kpiRows() as $row) {
            $item = $this->resolveItemForRow($items, $row);
            if (! $scopeVisible) {
                $rows[] = $this->hiddenKpiRow($row);
                continue;
            }

            $target = $this->resolveReportValue($item, 'target', $selectedYear, true);
            $actual = $this->resolveReportValue($item, 'actual', $selectedYear, true);
            $hasTarget = $this->valueIsPresent($target);
            $hasActual = $this->valueIsPresent($actual);

            $rows[] = [
                'key' => $row['key'],
                'code' => $row['code'],
                'label' => $row['label'],
                'target' => $hasTarget ? $this->formatReportValue($target, $item) : null,
                'actual' => $hasActual ? $this->formatReportValue($actual, $item) : null,
                'status' => $this->computeKpiStatus($item, $target, $actual),
                'visible' => true,
                'source' => $source,
                'missingReason' => $hasTarget && $hasActual ? null : self::MISSING_VALUE_REASON,
            ];
        }

        return $rows;
    }

    /**
     * @param array{key:string,code:string,label:string,aliases?:list<string>} $row
     * @return array<string, mixed>
     */
    private function hiddenSchoolAchievementRow(array $row): array
    {
        return [
            'key' => $row['key'],
            'code' => $row['code'],
            'label' => $row['label'],
            'actual' => null,
            'visible' => false,
            'source' => 'not_submitted',
            'missingReason' => self::NOT_SUBMITTED_REASON,
        ];
    }

    /**
     * @param array{key:string,code:string,label:string,aliases?:list<string>} $row
     * @return array<string, mixed>
     */
    private function hiddenKpiRow(array $row): array
    {
        return [
            'key' => $row['key'],
            'code' => $row['code'],
            'label' => $row['label'],
            'target' => null,
            'actual' => null,
            'status' => 'Not submitted',
            'visible' => false,
            'source' => 'not_submitted',
            'missingReason' => self::NOT_SUBMITTED_REASON,
        ];
    }

    /**
     * @param iterable<int, IndicatorSubmissionItem> $items
     * @param array{key:string,code:string,label:string,aliases?:list<string>} $row
     */
    private function resolveItemForRow(iterable $items, array $row): ?IndicatorSubmissionItem
    {
        $expectedCodes = [$this->normalizeMetricLookupKey($row['code']) => true];
        foreach ($row['aliases'] ?? [] as $alias) {
            $normalizedAlias = $this->normalizeMetricLookupKey($alias);
            if ($normalizedAlias !== '') {
                $expectedCodes[$normalizedAlias] = true;
            }
        }

        $matches = [];
        foreach ($items as $item) {
            $metricCode = $this->normalizeMetricLookupKey($item->metric?->code);
            if ($metricCode !== '' && isset($expectedCodes[$metricCode])) {
                $matches[] = $item;
            }
        }

        if ($matches === []) {
            return null;
        }

        usort($matches, fn (IndicatorSubmissionItem $left, IndicatorSubmissionItem $right): int => (
            $this->itemCompletenessScore($right) <=> $this->itemCompletenessScore($left)
        ) ?: ((int) $left->id <=> (int) $right->id));

        return $matches[0] ?? null;
    }

    private function itemCompletenessScore(IndicatorSubmissionItem $item): int
    {
        $score = 0;
        if ($this->valueHasDisplayContent($item->actual_typed_value)) {
            $score += 8;
        }
        if ($this->valueHasDisplayContent($item->actual_display)) {
            $score += 4;
        }
        if ($this->valueHasDisplayContent($item->actual_value)) {
            $score += 2;
        }
        if ($this->valueHasDisplayContent($item->target_typed_value)) {
            $score += 4;
        }
        if ($this->valueHasDisplayContent($item->target_display)) {
            $score += 2;
        }
        if ($this->valueHasDisplayContent($item->target_value)) {
            $score += 1;
        }

        return $score;
    }

    private function resolveReportValue(
        ?IndicatorSubmissionItem $item,
        string $kind,
        string $selectedYear,
        bool $strictSelectedYear,
    ): mixed {
        if (! $item) {
            return null;
        }

        $typed = $kind === 'target' ? $item->target_typed_value : $item->actual_typed_value;
        $typed = is_array($typed) ? $typed : null;

        $yearValue = $this->typedYearRawValue($typed, $selectedYear, ! $strictSelectedYear);
        if ($this->valueIsPresent($yearValue)) {
            return $yearValue;
        }

        if ($strictSelectedYear) {
            return null;
        }

        $display = $kind === 'target' ? $item->target_display : $item->actual_display;
        $displayValue = $this->selectedYearDisplaySegment($display, $selectedYear);
        if ($this->valueIsPresent($displayValue)) {
            return $displayValue;
        }

        $typedScalar = $this->typedScalarRawValue($typed);
        if ($this->valueIsPresent($typedScalar)) {
            return $typedScalar;
        }

        return $kind === 'target' ? $item->target_value : $item->actual_value;
    }

    /**
     * @param array<string, mixed>|null $payload
     */
    private function typedYearRawValue(?array $payload, string $selectedYear, bool $allowSingleValueFallback): mixed
    {
        $values = is_array($payload['values'] ?? null) ? $payload['values'] : null;
        if (! $values) {
            return null;
        }

        if ($selectedYear !== '' && array_key_exists($selectedYear, $values)) {
            return $values[$selectedYear];
        }

        $normalizedSelectedYear = $this->normalizeSchoolYearLabel($selectedYear);
        if ($normalizedSelectedYear !== null) {
            foreach ($values as $year => $value) {
                if ($this->normalizeSchoolYearLabel((string) $year) === $normalizedSelectedYear) {
                    return $value;
                }
            }
        }

        if ($allowSingleValueFallback) {
            $defined = array_values(array_filter(
                $values,
                fn (mixed $value): bool => $this->valueIsPresent($value),
            ));

            if (count($defined) === 1) {
                return $defined[0];
            }
        }

        return null;
    }

    /**
     * @param array<string, mixed>|null $payload
     */
    private function typedScalarRawValue(?array $payload): mixed
    {
        if (! $payload) {
            return null;
        }

        foreach (['value', 'scalar_value', 'raw_value', 'amount'] as $key) {
            if (array_key_exists($key, $payload) && $this->valueIsPresent($payload[$key])) {
                return $payload[$key];
            }
        }

        return null;
    }

    private function selectedYearDisplaySegment(mixed $display, string $selectedYear): string
    {
        $displayText = trim((string) ($display ?? ''));
        if ($displayText === '' || $selectedYear === '') {
            return $displayText;
        }

        $normalizedSelectedYear = $this->normalizeSchoolYearLabel($selectedYear);
        $segments = array_values(array_filter(
            array_map('trim', explode('|', $displayText)),
            static fn (string $segment): bool => $segment !== '',
        ));

        foreach ($segments as $segment) {
            if (str_starts_with($segment, "{$selectedYear}:")) {
                return trim(substr($segment, strlen($selectedYear) + 1));
            }

            if ($normalizedSelectedYear !== null && $this->normalizeSchoolYearLabel($segment) === $normalizedSelectedYear) {
                return trim((string) preg_replace('/^\d{4}\D+\d{4}\s*:?\s*/', '', $segment));
            }
        }

        return count($segments) === 1 ? $segments[0] : $displayText;
    }

    private function formatReportValue(mixed $value, ?IndicatorSubmissionItem $item): ?string
    {
        if (! $this->valueIsPresent($value)) {
            return null;
        }

        $schema = is_array($item?->metric?->input_schema) ? $item->metric->input_schema : [];
        $valueType = strtolower(trim((string) ($schema['valueType'] ?? '')));

        if ($valueType === 'yes_no') {
            return $this->formatBooleanValue($value);
        }

        if ($valueType === 'text' || $valueType === 'enum') {
            return trim((string) $value);
        }

        $number = $this->comparableNumber($value);
        if ($number === null) {
            return trim((string) $value);
        }

        return match ($valueType) {
            'currency' => trim((string) ($schema['currency'] ?? 'PHP')) . ' ' . number_format($number, 2),
            'percentage' => number_format($number, 2) . '%',
            'integer' => number_format($number, 0),
            default => floor($number) === $number ? number_format($number, 0) : number_format($number, 2),
        };
    }

    private function computeKpiStatus(?IndicatorSubmissionItem $item, mixed $target, mixed $actual): string
    {
        if (! $this->valueIsPresent($target) || ! $this->valueIsPresent($actual)) {
            return 'Missing value';
        }

        $comparison = strtolower(trim((string) ($item?->metric?->input_schema['comparison'] ?? 'greater_or_equal')));
        $targetNumber = $this->comparableNumber($target);
        $actualNumber = $this->comparableNumber($actual);

        if ($comparison === 'equal') {
            if ($targetNumber !== null && $actualNumber !== null) {
                return $actualNumber === $targetNumber ? 'Met' : 'Not met';
            }

            return strcasecmp(trim((string) $actual), trim((string) $target)) === 0 ? 'Met' : 'Not met';
        }

        if ($targetNumber === null || $actualNumber === null) {
            return 'Not met';
        }

        $isMet = $comparison === 'less_or_equal'
            ? $actualNumber <= $targetNumber
            : $actualNumber >= $targetNumber;

        return $isMet ? 'Met' : 'Not met';
    }

    /**
     * @return list<string>
     */
    private function visibleScopesForViewer(IndicatorSubmission $submission, bool $isMonitor): array
    {
        if (! $isMonitor) {
            return [
                TargetsMetReportDefinition::SCHOOL_ACHIEVEMENTS_SCOPE,
                TargetsMetReportDefinition::KEY_PERFORMANCE_SCOPE,
            ];
        }

        $scopeProgress = $this->scopeProgressResolver->buildScopeProgressForSubmission($submission);
        $submittedScopeIds = $scopeProgress['submittedScopeIds'] ?? [];

        return is_array($submittedScopeIds)
            ? array_values(array_unique(array_map(static fn (mixed $scope): string => (string) $scope, $submittedScopeIds)))
            : [];
    }

    /**
     * @param list<string> $visibleScopes
     */
    private function sourceForScope(
        IndicatorSubmission $submission,
        ?string $status,
        bool $isMonitor,
        string $scope,
        array $visibleScopes,
    ): ?string {
        if ($isMonitor && ! in_array($scope, $visibleScopes, true)) {
            return 'not_submitted';
        }

        if (in_array($status, [FormSubmissionStatus::SUBMITTED->value, FormSubmissionStatus::VALIDATED->value], true)) {
            return 'submitted';
        }

        if ($isMonitor) {
            return 'sent_scope';
        }

        return in_array($status, [FormSubmissionStatus::DRAFT->value, FormSubmissionStatus::RETURNED->value], true)
            ? 'workspace'
            : 'submitted';
    }

    private function statusValue(mixed $status): ?string
    {
        if ($status instanceof FormSubmissionStatus) {
            return $status->value;
        }

        $value = strtolower(trim((string) $status));

        return $value !== '' ? $value : null;
    }

    private function valueIsPresent(mixed $value): bool
    {
        if ($value === null) {
            return false;
        }

        if (is_string($value)) {
            return trim($value) !== '';
        }

        if (is_numeric($value) || is_bool($value)) {
            return true;
        }

        if (is_array($value)) {
            foreach ($value as $entry) {
                if ($this->valueIsPresent($entry)) {
                    return true;
                }
            }
        }

        return false;
    }

    private function valueHasDisplayContent(mixed $value): bool
    {
        return $this->valueIsPresent($value);
    }

    private function comparableNumber(mixed $value): ?float
    {
        if (is_int($value) || is_float($value)) {
            return is_finite((float) $value) ? (float) $value : null;
        }

        $normalized = preg_replace('/[^0-9.\-]+/', '', trim((string) $value));
        if ($normalized === null || $normalized === '' || ! is_numeric($normalized)) {
            return null;
        }

        return (float) $normalized;
    }

    private function formatBooleanValue(mixed $value): string
    {
        if (is_bool($value)) {
            return $value ? 'Yes' : 'No';
        }

        return match (strtolower(trim((string) $value))) {
            '1', 'true', 'yes', 'y' => 'Yes',
            '0', 'false', 'no', 'n' => 'No',
            default => trim((string) $value),
        };
    }

    private function normalizeMetricLookupKey(mixed $value): string
    {
        $normalized = strtolower(trim((string) $value));
        $normalized = (string) preg_replace('/[_\/]+/', ' ', $normalized);
        $normalized = (string) preg_replace('/[^a-z0-9]+/', ' ', $normalized);

        return trim((string) preg_replace('/\s+/', ' ', $normalized));
    }

    private function normalizeSchoolYearLabel(string $value): ?string
    {
        if (preg_match('/(\d{4})\D+(\d{4})/', $value, $matches) !== 1) {
            return null;
        }

        $start = (int) $matches[1];
        $end = (int) $matches[2];

        return $end === $start + 1 ? "{$start}-{$end}" : null;
    }
}
