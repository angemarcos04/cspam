<?php

namespace App\Http\Resources;

use App\Models\IndicatorSubmission;
use App\Support\Auth\ApiUserResolver;
use App\Support\Auth\UserRoleResolver;
use App\Support\Domain\FormSubmissionStatus;
use App\Support\Indicators\GroupBWorkspaceDefinition;
use App\Support\Indicators\SubmissionFileDefinition;
use App\Support\Indicators\SubmissionFileRequirementResolver;
use App\Support\Indicators\SubmissionScopeProgressResolver;
use Illuminate\Support\Collection;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin IndicatorSubmission */
class IndicatorSubmissionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $itemCollection = $this->relationLoaded('items') ? $this->items : collect();
        /** @var SubmissionFileRequirementResolver $requirementResolver */
        $requirementResolver = app(SubmissionFileRequirementResolver::class);
        $hasImeta = $this->hasImetaFormData();
        $hasBmef = $this->hasBmefFile();
        $hasSmea = $this->hasSmeaFile();
        $uploadedFileTypes = $this->uploadedSubmissionFileTypes();
        $requiredFileTypes = $requirementResolver->requiredTypesForSubmission($this->resource);
        $missingFileTypes = $requirementResolver->missingTypesForSubmission($this->resource);
        $secondaryHistoricalFileTypes = $requirementResolver->secondaryHistoricalTypesForSubmission($this->resource);
        /** @var SubmissionScopeProgressResolver $scopeProgressResolver */
        $scopeProgressResolver = app(SubmissionScopeProgressResolver::class);
        $scopeProgress = $scopeProgressResolver->buildScopeProgressForSubmission($this->resource);
        $viewer = ApiUserResolver::fromRequest($request);
        $redactUnsentMonitorData = $this->shouldRedactUnsentMonitorData(UserRoleResolver::has($viewer, UserRoleResolver::MONITOR));
        $visibleItemCollection = $this->visibleItemsForViewer($itemCollection, $scopeProgress, $redactUnsentMonitorData);
        $completion = $this->buildCompletionPayload(
            $hasImeta,
            $hasBmef,
            $hasSmea,
            $requirementResolver->isSubmissionComplete($this->resource),
            $requiredFileTypes,
            $uploadedFileTypes,
            $missingFileTypes,
            $scopeProgress,
            $visibleItemCollection,
            $redactUnsentMonitorData,
        );
        $totalIndicators = $visibleItemCollection->count();
        $metIndicators = $visibleItemCollection->where('compliance_status', 'met')->count();
        $belowTargetIndicators = $visibleItemCollection->where('compliance_status', 'below_target')->count();
        $recordedIndicators = $visibleItemCollection->where('compliance_status', 'recorded')->count();
        $comparableIndicators = $metIndicators + $belowTargetIndicators;
        $complianceRate = $comparableIndicators > 0
            ? round(($metIndicators / $comparableIndicators) * 100, 2)
            : 0.0;
        $visibleSecondaryHistoricalFileTypes = $redactUnsentMonitorData
            ? array_values(array_intersect($secondaryHistoricalFileTypes, $this->monitorVisibleScopeSet($scopeProgress)))
            : $secondaryHistoricalFileTypes;

        return [
            'id' => (string) $this->id,
            'formType' => IndicatorSubmission::FORM_TYPE,
            'status' => $this->statusValue($this->status),
            'statusLabel' => $this->statusLabel($this->status),
            'reportingPeriod' => $this->reporting_period,
            'version' => (int) $this->version,
            'schoolId' => (string) $this->school_id,
            'schoolType' => $this->school?->type,
            'school' => $this->when(
                $this->relationLoaded('school') && $this->school,
                fn (): array => [
                    'id' => (string) $this->school->id,
                    'schoolCode' => $this->school->school_code,
                    'name' => $this->school->name,
                    'type' => $this->school->type,
                ],
            ),
            'academicYear' => $this->when(
                $this->relationLoaded('academicYear') && $this->academicYear,
                fn (): array => [
                    'id' => (string) $this->academicYear->id,
                    'name' => $this->academicYear->name,
                ],
            ),
            'notes' => $this->notes,
            'reviewNotes' => $this->review_notes,
            'summary' => [
                'totalIndicators' => $totalIndicators,
                'metIndicators' => $metIndicators,
                'belowTargetIndicators' => $belowTargetIndicators,
                'recordedIndicators' => $recordedIndicators,
                'complianceRatePercent' => $complianceRate,
            ],
            'files' => $this->buildSubmissionFiles($scopeProgress, $redactUnsentMonitorData),
            // Legacy completion flags remain for compatibility. School Head package
            // presentation should prefer the normalized presentation.* contract below.
            'completion' => $completion,
            // Canonical School Head package meaning. Active/private-vs-public screens
            // should use these normalized fields instead of inferring from raw history.
            'presentation' => [
                'activeFileTypes' => $requiredFileTypes,
                'activeReportFileTypes' => $requiredFileTypes,
                'activeWorkspaceFileTypes' => $requiredFileTypes,
                'secondaryHistoricalFileTypes' => $visibleSecondaryHistoricalFileTypes,
            ],
            'scopeProgress' => $scopeProgress,
            'scopeReviews' => $this->when(
                $this->relationLoaded('scopeReviews'),
                fn () => $this->scopeReviews->map(static fn ($review): array => [
                    'id' => (string) $review->id,
                    'scopeId' => $review->scope_id,
                    'scopeType' => $review->scope_type,
                    'decision' => $review->decision,
                    'notes' => $review->notes,
                    'reviewedBy' => $review->relationLoaded('reviewedBy') && $review->reviewedBy
                        ? [
                            'id' => (string) $review->reviewedBy->id,
                            'name' => $review->reviewedBy->name,
                            'email' => $review->reviewedBy->email,
                        ]
                        : null,
                    'reviewedAt' => optional($review->reviewed_at)->toISOString(),
                    'updatedAt' => optional($review->updated_at)->toISOString(),
                ])->values()->all(),
            ),
            'indicators' => IndicatorSubmissionItemResource::collection($visibleItemCollection),
            'createdBy' => $this->when(
                $this->relationLoaded('createdBy') && $this->createdBy,
                fn (): array => [
                    'id' => (string) $this->createdBy->id,
                    'name' => $this->createdBy->name,
                    'email' => $this->createdBy->email,
                ],
            ),
            'submittedBy' => $this->when(
                $this->relationLoaded('submittedBy') && $this->submittedBy,
                fn (): array => [
                    'id' => (string) $this->submittedBy->id,
                    'name' => $this->submittedBy->name,
                    'email' => $this->submittedBy->email,
                ],
            ),
            'reviewedBy' => $this->when(
                $this->relationLoaded('reviewedBy') && $this->reviewedBy,
                fn (): array => [
                    'id' => (string) $this->reviewedBy->id,
                    'name' => $this->reviewedBy->name,
                    'email' => $this->reviewedBy->email,
                ],
            ),
            'submittedAt' => optional($this->submitted_at)->toISOString(),
            'reviewedAt' => optional($this->reviewed_at)->toISOString(),
            'createdAt' => optional($this->created_at)->toISOString(),
            'updatedAt' => optional($this->updated_at)->toISOString(),
        ];
    }

    private function statusValue(mixed $status): ?string
    {
        if ($status instanceof FormSubmissionStatus) {
            return $status->value;
        }

        return is_string($status) && $status !== '' ? $status : null;
    }

    private function statusLabel(mixed $status): ?string
    {
        $value = $this->statusValue($status);
        if (! $value) {
            return null;
        }

        return FormSubmissionStatus::options()[$value] ?? ucfirst(str_replace('_', ' ', $value));
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function buildSubmissionFiles(array $scopeProgress, bool $redactUnsentMonitorData): array
    {
        $files = [];
        $monitorVisibleScopes = $this->monitorVisibleScopeSet($scopeProgress);

        foreach (SubmissionFileDefinition::types() as $type) {
            $uploaded = $this->hasSubmissionFileType($type);
            $visible = ! $redactUnsentMonitorData || in_array($type, $monitorVisibleScopes, true);
            $visibleUploaded = $uploaded && $visible;
            $files[$type] = [
                'type' => $type,
                'uploaded' => $visibleUploaded,
                'path' => $visibleUploaded ? $this->submissionFilePathForType($type) : null,
                'originalFilename' => $visibleUploaded ? $this->submissionFileOriginalNameForType($type) : null,
                'sizeBytes' => $visibleUploaded ? $this->submissionFileSizeForType($type) : null,
                'uploadedAt' => $visibleUploaded ? optional($this->submissionFileUploadedAtForType($type))->toISOString() : null,
                'downloadUrl' => $visibleUploaded ? "/api/submissions/{$this->id}/download/{$type}" : null,
                'viewUrl' => $visibleUploaded ? "/api/submissions/{$this->id}/view/{$type}" : null,
            ];
        }

        return $files;
    }

    /**
     * @param list<string> $requiredFileTypes
     * @param list<string> $uploadedFileTypes
     * @param list<string> $missingFileTypes
     * @param Collection<int, mixed> $visibleItems
     * @return array<string, mixed>
     */
    private function buildCompletionPayload(
        bool $hasImeta,
        bool $hasBmef,
        bool $hasSmea,
        bool $isComplete,
        array $requiredFileTypes,
        array $uploadedFileTypes,
        array $missingFileTypes,
        array $scopeProgress,
        Collection $visibleItems,
        bool $redactUnsentMonitorData,
    ): array {
        if (! $redactUnsentMonitorData) {
            return [
                'hasImetaFormData' => $hasImeta,
                'hasBmefFile' => $hasBmef,
                'hasSmeaFile' => $hasSmea,
                'isComplete' => $isComplete,
                'requiredFileTypes' => $requiredFileTypes,
                'uploadedFileTypes' => $uploadedFileTypes,
                'missingFileTypes' => $missingFileTypes,
            ];
        }

        $visibleScopes = $this->monitorVisibleScopeSet($scopeProgress);
        $visibleUploadedFileTypes = array_values(array_filter(
            $uploadedFileTypes,
            static fn (string $type): bool => in_array($type, $visibleScopes, true),
        ));
        $visibleMissingFileTypes = array_values(array_diff($requiredFileTypes, $visibleUploadedFileTypes));

        return [
            'hasImetaFormData' => $hasImeta && $visibleItems->isNotEmpty(),
            'hasBmefFile' => $hasBmef && in_array('bmef', $visibleScopes, true),
            'hasSmeaFile' => $hasSmea && in_array('smea', $visibleScopes, true),
            'isComplete' => $visibleItems->isNotEmpty() && $visibleMissingFileTypes === [],
            'requiredFileTypes' => $requiredFileTypes,
            'uploadedFileTypes' => $visibleUploadedFileTypes,
            'missingFileTypes' => $visibleMissingFileTypes,
        ];
    }

    private function shouldRedactUnsentMonitorData(bool $isMonitorViewer): bool
    {
        if (! $isMonitorViewer) {
            return false;
        }

        return in_array($this->statusValue($this->status), [
            FormSubmissionStatus::DRAFT->value,
            FormSubmissionStatus::RETURNED->value,
        ], true);
    }

    /**
     * @param Collection<int, mixed> $items
     * @return Collection<int, mixed>
     */
    private function visibleItemsForViewer(Collection $items, array $scopeProgress, bool $redactUnsentMonitorData): Collection
    {
        if (! $redactUnsentMonitorData || $items->isEmpty()) {
            return $items;
        }

        $visibleScopes = $this->monitorVisibleScopeSet($scopeProgress);
        if ($visibleScopes === []) {
            return $items->filter(static fn (): bool => false)->values();
        }

        $scopeByMetricCode = $this->scopeByMetricCode();

        return $items
            ->filter(static function ($item) use ($scopeByMetricCode, $visibleScopes): bool {
                $metricCode = strtoupper(trim((string) ($item->metric?->code ?? '')));
                if ($metricCode === '') {
                    return false;
                }

                $scope = $scopeByMetricCode[$metricCode] ?? null;

                return $scope !== null && in_array($scope, $visibleScopes, true);
            })
            ->values();
    }

    /**
     * @return list<string>
     */
    private function monitorVisibleScopeSet(array $scopeProgress): array
    {
        $submittedScopeIds = $scopeProgress['submittedScopeIds'] ?? [];
        if (! is_array($submittedScopeIds)) {
            return [];
        }

        return array_values(array_unique(array_filter(
            array_map(static fn (mixed $scope): string => trim((string) $scope), $submittedScopeIds),
            static fn (string $scope): bool => $scope !== '',
        )));
    }

    /**
     * @return array<string, string>
     */
    private function scopeByMetricCode(): array
    {
        $scopeByMetricCode = [];

        foreach ([GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS, GroupBWorkspaceDefinition::KEY_PERFORMANCE] as $scope) {
            foreach (GroupBWorkspaceDefinition::metricCodesFor($scope) as $metricCode) {
                $scopeByMetricCode[strtoupper($metricCode)] = $scope;
            }
        }

        return $scopeByMetricCode;
    }
}
