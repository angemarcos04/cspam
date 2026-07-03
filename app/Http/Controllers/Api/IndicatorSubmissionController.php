<?php

namespace App\Http\Controllers\Api;

use App\Events\CspamsUpdateBroadcast;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\ReviewIndicatorSubmissionRequest;
use App\Http\Requests\Api\ReviewIndicatorSubmissionScopeRequest;
use App\Http\Requests\Api\UpsertIndicatorSubmissionRequest;
use App\Http\Resources\FormSubmissionHistoryResource;
use App\Http\Resources\IndicatorSubmissionResource;
use App\Models\AcademicYear;
use App\Models\FormSubmissionHistory;
use App\Models\IndicatorSubmission;
use App\Models\IndicatorSubmissionScopeReview;
use App\Models\IndicatorSubmissionScopeSubmission;
use App\Models\PerformanceMetric;
use App\Models\User;
use App\Notifications\IndicatorReviewOutcomeNotification;
use App\Notifications\IndicatorScopeReviewOutcomeNotification;
use App\Notifications\IndicatorSubmissionReceivedNotification;
use App\Services\FilterService;
use App\Support\Auth\ApiUserResolver;
use App\Support\Auth\UserRoleResolver;
use App\Support\Audit\WorkflowAuditLogger;
use App\Support\Domain\FormSubmissionStatus;
use App\Support\Domain\MetricDataType;
use App\Support\Forms\FormSubmissionHistoryLogger;
use App\Support\Indicators\GroupBWorkspaceDefinition;
use App\Support\Indicators\SubmissionFileDefinition;
use App\Support\Indicators\SubmissionFileBlobStorage;
use App\Support\Indicators\SubmissionFileRequirementResolver;
use App\Support\Indicators\SubmissionFileStorage;
use App\Support\Indicators\SubmissionScopeProgressResolver;
use App\Support\Indicators\TargetsMetAutoCalculator;
use App\Support\Indicators\TargetsMetReportBuilder;
use Carbon\Carbon;
use Illuminate\Contracts\Cache\LockProvider;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

class IndicatorSubmissionController extends Controller
{
    private const ROLLING_YEAR_SYNC_CACHE_KEY = 'cspams.indicators.rolling_year_window.last_sync';

    private const ROLLING_YEAR_SYNC_TTL_MINUTES = 30;

    private const ROLLING_YEAR_SYNC_LOCK_KEY = 'cspams.indicators.rolling_year_window.sync_lock';

    private const ROLLING_YEAR_SYNC_LOCK_TTL_SECONDS = 25;

    private static ?bool $usersHasAccountTypeColumn = null;

    public function __construct(
        private readonly FilterService $filterService,
    ) {
    }

    public function academicYears(Request $request): JsonResponse
    {
        $this->requireUser($request);

        $years = AcademicYear::query()
            ->orderByDesc('is_current')
            ->orderByDesc('start_date')
            ->get(['id', 'name', 'is_current']);

        return response()->json([
            'data' => $years->map(static fn (AcademicYear $year): array => [
                'id' => (string) $year->id,
                'name' => $year->name,
                'isCurrent' => (bool) $year->is_current,
            ])->values(),
        ]);
    }

    public function metrics(Request $request): JsonResponse
    {
        $this->requireUser($request);
        $autoMetricCodes = array_flip(app(TargetsMetAutoCalculator::class)->supportedCodes());

        $metrics = PerformanceMetric::query()
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->orderBy('category')
            ->orderBy('code')
            ->get(['id', 'code', 'name', 'category', 'framework', 'data_type', 'input_schema', 'unit', 'sort_order']);

        return response()->json([
            'data' => $metrics->map(fn (PerformanceMetric $metric): array => [
                'id' => (string) $metric->id,
                'code' => $metric->code,
                'name' => $metric->name,
                'category' => is_string($metric->category)
                    ? $metric->category
                    : $metric->category->value,
                'framework' => (string) $metric->framework,
                'dataType' => $metric->data_type instanceof MetricDataType
                    ? $metric->data_type->value
                    : (string) $metric->data_type,
                'inputSchema' => $metric->input_schema,
                'unit' => $metric->unit,
                'sortOrder' => (int) ($metric->sort_order ?? 0),
                'isAutoCalculated' => isset($autoMetricCodes[strtoupper((string) $metric->code)]),
            ])->values(),
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $user = $this->requireUser($request);
        $filters = $this->buildIndicatorFilters($request);

        $scope = $this->isSchoolHead($user) ? 'school' : 'division';
        $baseScopeKey = $scope === 'school'
            ? ($user->school_id ? 'school:' . $user->school_id : 'school:unassigned')
            : 'division:all';
        $filtersKey = $this->filterService->buildCacheKey(
            $filters,
            ['school_id', 'school_code', 'academic_year_id', 'status', 'category', 'date_from', 'date_to', 'search', 'reporting_period'],
        );
        $scopeKey = $baseScopeKey . '|' . $filtersKey;

        $baseQuery = IndicatorSubmission::query();
        $this->applyVisibilityScope($baseQuery, $user);
        $this->applyIndicatorFilters($baseQuery, $filters);

        $perPage = $this->resolvePerPage($request);
        $page = max(1, $request->integer('page', 1));

        $syncFingerprint = $this->buildSyncFingerprint(clone $baseQuery);
        $recordCount = $syncFingerprint['recordCount'];
        $latestAt = $syncFingerprint['latestAt'];
        $etag = $this->buildSyncEtag($scope, $scopeKey, $page, $perPage, $recordCount, $latestAt);

        $incomingEtag = trim((string) $request->header('If-None-Match'));
        if ($incomingEtag !== '' && trim($incomingEtag, '"') === $etag) {
            return $this->buildNotModifiedResponse($etag, $scope, $scopeKey, $recordCount, $latestAt);
        }

        $query = (clone $baseQuery)
            ->with([
                'school:id,school_code,name,type',
                'academicYear:id,name',
                'items.metric:id,code,name,category,framework,data_type,input_schema,unit,sort_order',
                'submissionFiles:id,indicator_submission_id,type,path,original_filename,size_bytes,uploaded_at',
                'scopeSubmissions:id,indicator_submission_id,scope_id,scope_type,submitted_by,submitted_at',
                'scopeReviews.reviewedBy:id,name,email',
                'createdBy:id,name,email',
                'submittedBy:id,name,email',
                'reviewedBy:id,name,email',
            ])
            ->orderByRaw('COALESCE(submitted_at, updated_at, created_at) DESC')
            ->orderByDesc('version')
            ->orderByDesc('id');

        $syncedAt = now()->toISOString();
        $resource = IndicatorSubmissionResource::collection(
            $query->paginate($perPage)->appends($request->query()),
        );

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

    public function show(Request $request, IndicatorSubmission $submission): JsonResponse
    {
        $user = $this->requireUser($request);
        $this->assertCanView($user, $submission->school_id);

        $submission->load([
            'school:id,school_code,name,type',
            'academicYear:id,name',
            'items.metric:id,code,name,category,framework,data_type,input_schema,unit,sort_order',
            'submissionFiles:id,indicator_submission_id,type,path,original_filename,size_bytes,uploaded_at',
            'scopeSubmissions:id,indicator_submission_id,scope_id,scope_type,submitted_by,submitted_at',
            'scopeReviews.reviewedBy:id,name,email',
            'createdBy:id,name,email',
            'submittedBy:id,name,email',
            'reviewedBy:id,name,email',
        ]);

        return response()->json([
            'data' => (new IndicatorSubmissionResource($submission))->resolve(),
        ]);
    }

    public function targetsMetReport(Request $request, IndicatorSubmission $submission): JsonResponse
    {
        $user = $this->requireUser($request);
        $this->assertCanView($user, $submission->school_id);

        return response()->json([
            'data' => app(TargetsMetReportBuilder::class)->build($submission, $user),
        ]);
    }

    public function reportViewed(Request $request, IndicatorSubmission $submission): JsonResponse
    {
        $user = $this->requireUser($request);
        $this->assertCanReview($user);
        $this->assertCanView($user, $submission->school_id);

        /** @var SubmissionScopeProgressResolver $scopeProgressResolver */
        $scopeProgressResolver = app(SubmissionScopeProgressResolver::class);

        $validated = $request->validate([
            'scopeId' => ['required', 'string'],
        ]);

        $scopeIds = $scopeProgressResolver->normalizeScopeIds($submission, [(string) $validated['scopeId']]);
        if ($scopeIds === []) {
            throw ValidationException::withMessages([
                'scopeId' => 'Select a valid report section.',
            ]);
        }

        $scopeId = $scopeIds[0];
        if (SubmissionFileDefinition::isValidType($scopeId)) {
            throw ValidationException::withMessages([
                'scopeId' => 'Use file preview for uploaded file requirements.',
            ]);
        }

        $status = $this->statusValue($submission->status);
        if (! in_array($status, [
            FormSubmissionStatus::SUBMITTED->value,
            FormSubmissionStatus::VALIDATED->value,
        ], true)) {
            $scopeProgress = $scopeProgressResolver->buildScopeProgressForSubmission($submission);
            $submittedScopeIds = is_array($scopeProgress['submittedScopeIds'] ?? null)
                ? $scopeProgress['submittedScopeIds']
                : [];

            if (! in_array($scopeId, $submittedScopeIds, true)) {
                throw ValidationException::withMessages([
                    'scopeId' => 'Only sent report sections can be viewed by the monitor.',
                ]);
            }
        }

        $this->auditSubmissionEvent($request, 'monitor.report_viewed', $submission, $user, [
            'status' => $status,
            'scope_id' => $scopeId,
            'scope_type' => 'section',
            'scope_label' => $scopeProgressResolver->scopeLabel($scopeId),
        ]);

        return response()->json([
            'data' => [
                'logged' => true,
            ],
        ]);
    }

    public function store(UpsertIndicatorSubmissionRequest $request): JsonResponse
    {
        $user = $this->requireUser($request);
        $this->assertSchoolHead($user);
        abort_if(! $user->school_id, Response::HTTP_FORBIDDEN, 'School Head account is missing school assignment.');

        $schoolId = (int) $user->school_id;
        $academicYearId = $request->integer('academic_year_id');
        $reportingPeriod = $request->filled('reporting_period')
            ? $request->string('reporting_period')->toString()
            : null;
        $notes = $request->filled('notes')
            ? trim($request->string('notes')->toString())
            : null;
        $indicatorRows = $this->buildIndicatorRows($request, $schoolId);
        $this->assertSchoolYearScopesAreNotVerified($schoolId, $academicYearId, $this->auditScopeIdsForRows($indicatorRows));

        /** @var IndicatorSubmission $submission */
        $submission = DB::transaction(function () use (
            $schoolId,
            $academicYearId,
            $reportingPeriod,
            $notes,
            $user,
            $indicatorRows,
        ): IndicatorSubmission {
            $submission = IndicatorSubmission::query()->create([
                'school_id' => $schoolId,
                'academic_year_id' => $academicYearId,
                'reporting_period' => $reportingPeriod,
                'version' => $this->nextVersion($schoolId, $academicYearId, $reportingPeriod),
                'status' => FormSubmissionStatus::DRAFT->value,
                'notes' => $notes,
                'created_by' => $user->id,
            ]);

            $submission->items()->createMany($indicatorRows->all());

            app(FormSubmissionHistoryLogger::class)->log(
                formType: IndicatorSubmission::FORM_TYPE,
                submissionId: $submission->id,
                schoolId: $submission->school_id,
                academicYearId: $submission->academic_year_id,
                action: 'generated',
                fromStatus: null,
                toStatus: FormSubmissionStatus::DRAFT,
                actorId: $user->id,
                notes: 'Indicator compliance package encoded for monitor review.',
                metadata: [
                    'indicator_count' => $indicatorRows->count(),
                    'met_count' => $indicatorRows->where('compliance_status', 'met')->count(),
                    'below_target_count' => $indicatorRows->where('compliance_status', 'below_target')->count(),
                ],
            );

            event(new CspamsUpdateBroadcast(
                $this->indicatorBroadcastPayload($submission, 'indicators.generated', [
                    'status' => FormSubmissionStatus::DRAFT->value,
                ]),
            ));

            return $submission;
        });

        $submission->load([
            'school:id,school_code,name,type',
            'academicYear:id,name',
            'items.metric:id,code,name,category,framework,data_type,input_schema,unit,sort_order',
            'submissionFiles:id,indicator_submission_id,type,path,original_filename,size_bytes,uploaded_at',
            'createdBy:id,name,email',
            'submittedBy:id,name,email',
            'reviewedBy:id,name,email',
        ]);

        $submission->load([
            'school:id,school_code,name,type',
            'academicYear:id,name',
            'items.metric:id,code,name,category,framework,data_type,input_schema,unit,sort_order',
            'submissionFiles:id,indicator_submission_id,type,path,original_filename,size_bytes,uploaded_at',
            'createdBy:id,name,email',
            'submittedBy:id,name,email',
            'reviewedBy:id,name,email',
        ]);

        $this->auditSubmissionEvent($request, 'workspace.section_saved', $submission, $user, [
            'old_status' => null,
            'new_status' => FormSubmissionStatus::DRAFT->value,
            'scope_ids' => $this->auditScopeIdsForRows($indicatorRows),
            'indicator_count' => $indicatorRows->count(),
        ]);

        return response()->json([
            'data' => (new IndicatorSubmissionResource($submission))->resolve(),
        ], Response::HTTP_CREATED);
    }

    public function bootstrap(Request $request): JsonResponse
    {
        $user = $this->requireUser($request);
        $this->assertSchoolHead($user);
        abort_if(! $user->school_id, Response::HTTP_FORBIDDEN, 'School Head account is missing school assignment.');

        $validated = $request->validate([
            'academic_year_id' => ['required', 'integer', 'exists:academic_years,id'],
            'reporting_period' => ['nullable', 'string', 'max:50'],
            'notes' => ['nullable', 'string'],
        ]);

        $schoolId = (int) $user->school_id;
        $academicYearId = (int) $validated['academic_year_id'];
        $reportingPeriod = array_key_exists('reporting_period', $validated) && is_string($validated['reporting_period'])
            ? trim($validated['reporting_period']) ?: null
            : null;
        $notes = array_key_exists('notes', $validated) && is_string($validated['notes'])
            ? trim($validated['notes']) ?: null
            : null;

        /** @var IndicatorSubmission $submission */
        $submission = DB::transaction(function () use (
            $schoolId,
            $academicYearId,
            $reportingPeriod,
            $notes,
            $user,
        ): IndicatorSubmission {
            $submission = IndicatorSubmission::query()->create([
                'school_id' => $schoolId,
                'academic_year_id' => $academicYearId,
                'reporting_period' => $reportingPeriod,
                'version' => $this->nextVersion($schoolId, $academicYearId, $reportingPeriod),
                'status' => FormSubmissionStatus::DRAFT->value,
                'notes' => $notes,
                'created_by' => $user->id,
            ]);

            app(FormSubmissionHistoryLogger::class)->log(
                formType: IndicatorSubmission::FORM_TYPE,
                submissionId: $submission->id,
                schoolId: $submission->school_id,
                academicYearId: $submission->academic_year_id,
                action: 'bootstrapped',
                fromStatus: null,
                toStatus: FormSubmissionStatus::DRAFT,
                actorId: $user->id,
                notes: 'Indicator compliance package draft bootstrapped for file upload.',
                metadata: [
                    'indicator_count' => 0,
                    'met_count' => 0,
                    'below_target_count' => 0,
                ],
            );

            event(new CspamsUpdateBroadcast(
                $this->indicatorBroadcastPayload($submission, 'indicators.bootstrapped', [
                    'status' => FormSubmissionStatus::DRAFT->value,
                ]),
            ));

            return $submission;
        });

        $submission->load([
            'school:id,school_code,name,type',
            'academicYear:id,name',
            'items.metric:id,code,name,category,framework,data_type,input_schema,unit,sort_order',
            'submissionFiles:id,indicator_submission_id,type,path,original_filename,size_bytes,uploaded_at',
            'createdBy:id,name,email',
            'submittedBy:id,name,email',
            'reviewedBy:id,name,email',
        ]);

        return $this->lightweightSubmissionResponse($submission, Response::HTTP_CREATED);
    }

    public function update(UpsertIndicatorSubmissionRequest $request, IndicatorSubmission $submission): JsonResponse
    {
        $user = $this->requireUser($request);
        $this->assertCanSubmit($user, $submission->school_id);

        $currentStatus = $this->statusValue($submission->status);
        if (! in_array($currentStatus, [
            FormSubmissionStatus::DRAFT->value,
            FormSubmissionStatus::RETURNED->value,
        ], true)) {
            throw ValidationException::withMessages([
                'submission' => 'Only draft or returned indicator submissions can be updated.',
            ]);
        }

        $academicYearId = $request->integer('academic_year_id');
        $reportingPeriod = $request->filled('reporting_period')
            ? $request->string('reporting_period')->toString()
            : null;
        $notes = $request->filled('notes')
            ? trim($request->string('notes')->toString())
            : null;
        $workspaceSection = strtolower(trim((string) $request->input('workspace_section', '')));
        $mode = strtolower(trim((string) $request->input('mode', '')));
        $shouldReplaceMissing = $request->boolean('replace_missing')
            || $mode === 'full_replace';
        $indicatorRows = $this->buildIndicatorRows($request, (int) $submission->school_id);
        $mutationScopeIds = GroupBWorkspaceDefinition::isMetricWorkspace($workspaceSection)
            ? [$workspaceSection]
            : $this->auditScopeIdsForRows($indicatorRows);
        $this->assertScopesAreNotVerified($submission, $mutationScopeIds);

        DB::transaction(function () use (
            $submission,
            $user,
            $academicYearId,
            $reportingPeriod,
            $notes,
            $workspaceSection,
            $indicatorRows,
            $currentStatus,
            $shouldReplaceMissing,
        ): void {
            $submission->forceFill([
                'academic_year_id' => $academicYearId,
                'reporting_period' => $reportingPeriod,
                'notes' => $notes,
            ])->save();

            // Sync by metric ID to avoid full delete+recreate writes on every update.
            $existingItemsByMetricId = $submission->items()
                ->get()
                ->keyBy(static fn ($item): int => (int) $item->performance_metric_id);
            $incomingMetricIds = [];

            foreach ($indicatorRows as $indicatorRow) {
                $metricId = (int) ($indicatorRow['performance_metric_id'] ?? 0);
                if ($metricId <= 0) {
                    continue;
                }

                $incomingMetricIds[] = $metricId;
                $existingItem = $existingItemsByMetricId->get($metricId);

                if ($existingItem) {
                    $existingItem->fill($indicatorRow);
                    if ($existingItem->isDirty()) {
                        $existingItem->save();
                    }

                    continue;
                }

                $submission->items()->create($indicatorRow);
            }

            $deletedCount = 0;
            if ($shouldReplaceMissing) {
                $metricsToDelete = $existingItemsByMetricId
                    ->keys()
                    ->diff(collect($incomingMetricIds)->unique()->values());
                if ($metricsToDelete->isNotEmpty()) {
                    $deletedCount = (int) $submission->items()
                        ->whereIn('performance_metric_id', $metricsToDelete->all())
                        ->delete();
                }
            }

            app(FormSubmissionHistoryLogger::class)->log(
                formType: IndicatorSubmission::FORM_TYPE,
                submissionId: $submission->id,
                schoolId: $submission->school_id,
                academicYearId: $submission->academic_year_id,
                action: 'updated',
                fromStatus: $currentStatus,
                toStatus: $currentStatus,
                actorId: $user->id,
                notes: 'Indicator package draft updated by school head.',
                metadata: [
                    'indicator_count' => $indicatorRows->count(),
                    'met_count' => $indicatorRows->where('compliance_status', 'met')->count(),
                    'below_target_count' => $indicatorRows->where('compliance_status', 'below_target')->count(),
                    'replace_missing' => $shouldReplaceMissing,
                    'deleted_indicator_count' => $deletedCount,
                    'touchedScopes' => GroupBWorkspaceDefinition::isMetricWorkspace($workspaceSection)
                        ? [$workspaceSection]
                        : [],
                ],
            );

            if (GroupBWorkspaceDefinition::isMetricWorkspace($workspaceSection)) {
                $this->removeSubmittedScopes($submission, [$workspaceSection]);
            }

            event(new CspamsUpdateBroadcast(
                $this->indicatorBroadcastPayload($submission, 'indicators.updated', [
                    'status' => $currentStatus,
                    'touchedScopes' => GroupBWorkspaceDefinition::isMetricWorkspace($workspaceSection)
                        ? [$workspaceSection]
                        : [],
                ]),
            ));
        });

        $auditScopeIds = GroupBWorkspaceDefinition::isMetricWorkspace($workspaceSection)
            ? [$workspaceSection]
            : $this->auditScopeIdsForRows($indicatorRows);

        $this->auditSubmissionEvent($request, 'workspace.section_saved', $submission, $user, [
            'old_status' => $currentStatus,
            'new_status' => $currentStatus,
            'scope_id' => count($auditScopeIds) === 1 ? $auditScopeIds[0] : null,
            'scope_ids' => $auditScopeIds,
            'indicator_count' => $indicatorRows->count(),
        ]);

        return $this->lightweightSubmissionResponse($submission);
    }

    public function uploadFile(Request $request, IndicatorSubmission $submission): JsonResponse
    {
        $user = $this->requireUser($request);
        $this->assertCanSubmit($user, $submission->school_id);

        $currentStatus = $this->statusValue($submission->status);
        if (! in_array($currentStatus, [
            FormSubmissionStatus::DRAFT->value,
            FormSubmissionStatus::RETURNED->value,
        ], true)) {
            throw ValidationException::withMessages([
                'submission' => 'Only draft or returned indicator submissions can upload or replace files.',
            ]);
        }

        $maxKb = max(1, (int) config('cspams.submission_file_max_kb', 2048));

        $validated = $request->validate([
            'type' => ['required', 'string', Rule::in(SubmissionFileDefinition::types())],
            'file' => ['required', 'file', 'max:' . $maxKb, 'mimes:pdf,docx,xlsx'],
        ]);

        $fileType = strtolower(trim((string) $validated['type']));
        $this->assertScopesAreNotVerified($submission, [$fileType]);
        $file = $request->file('file');
        if (! $file) {
            throw ValidationException::withMessages([
                'file' => 'A file upload is required.',
            ]);
        }

        $existingPath = $this->filePathForType($submission, $fileType);
        $blobStorage = app(SubmissionFileBlobStorage::class);
        $path = $blobStorage->makePath($submission, $fileType);

        $sizeBytes = max(0, (int) $file->getSize());
        $originalFilename = trim((string) $file->getClientOriginalName());
        $storedFilename = $originalFilename !== '' ? $originalFilename : "{$fileType}-upload.bin";
        $uploadedAt = now();

        try {
            DB::transaction(function () use (
                $blobStorage,
                $submission,
                $fileType,
                $file,
                $path,
                $storedFilename,
                &$sizeBytes,
                &$uploadedAt,
            ): void {
                $blob = $blobStorage->put($submission, $fileType, $file, $storedFilename);
                $sizeBytes = (int) $blob->size_bytes;
                $uploadedAt = $blob->uploaded_at ?? now();

                if ($fileType === 'bmef') {
                    $submission->forceFill([
                        'bmef_file_path' => $path,
                        'bmef_original_filename' => $storedFilename,
                        'bmef_uploaded_at' => $uploadedAt,
                        'bmef_file_size' => $sizeBytes,
                    ])->save();
                } elseif ($fileType === 'smea') {
                    $submission->forceFill([
                        'smea_file_path' => $path,
                        'smea_original_filename' => $storedFilename,
                        'smea_uploaded_at' => $uploadedAt,
                        'smea_file_size' => $sizeBytes,
                    ])->save();
                } else {
                    $submission->submissionFiles()->updateOrCreate(
                        ['type' => $fileType],
                        [
                            'path' => $path,
                            'original_filename' => $storedFilename,
                            'size_bytes' => $sizeBytes,
                            'uploaded_at' => $uploadedAt,
                        ],
                    );
                }

                $this->removeSubmittedScopes($submission, [$fileType]);
            });
        } catch (\Throwable $e) {
            report($e);

            if (! is_string($existingPath) || trim($existingPath) !== $path) {
                $blobStorage->deleteForPath($path);
            }

            throw ValidationException::withMessages([
                'file' => 'The uploaded file could not be persisted. Please try again or contact the administrator.',
            ]);
        }

        if (
            is_string($existingPath)
            && trim($existingPath) !== ''
            && $existingPath !== $path
        ) {
            if ($blobStorage->isDatabasePath($existingPath)) {
                $blobStorage->deleteForPath($existingPath);
            } elseif ($this->submissionFilePathExists($existingPath)) {
                $this->submissionFileDisk()->delete($existingPath);
            }
        }

        app(FormSubmissionHistoryLogger::class)->log(
            formType: IndicatorSubmission::FORM_TYPE,
            submissionId: $submission->id,
            schoolId: $submission->school_id,
            academicYearId: $submission->academic_year_id,
            action: "{$fileType}_uploaded",
            fromStatus: $currentStatus,
            toStatus: $currentStatus ?? FormSubmissionStatus::DRAFT->value,
            actorId: $user->id,
            notes: SubmissionFileDefinition::shortLabelFor($fileType) . ' file uploaded or replaced.',
            metadata: [
                'type' => $fileType,
                'path' => $path,
                'filename' => $storedFilename,
                'size_bytes' => $sizeBytes,
                'touchedScopes' => [$fileType],
            ],
        );

        $this->auditSubmissionEvent($request, 'workspace.file_saved', $submission, $user, [
            'old_status' => $currentStatus,
            'new_status' => $currentStatus ?? FormSubmissionStatus::DRAFT->value,
            'scope_id' => $fileType,
            'scope_type' => 'file',
            'file_type' => $fileType,
            'original_filename' => $storedFilename,
            'file_size_bytes' => $sizeBytes,
        ]);

        event(new CspamsUpdateBroadcast(
            $this->indicatorBroadcastPayload($submission, 'indicators.file_uploaded', [
                'fileType' => $fileType,
                'touchedScopes' => [$fileType],
            ]),
        ));

        return $this->lightweightSubmissionResponse($submission);
    }

    public function downloadFile(Request $request, IndicatorSubmission $submission, string $type)
    {
        $user = $this->requireUser($request);

        $fileType = strtolower(trim($type));
        if (! SubmissionFileDefinition::isValidType($fileType)) {
            throw ValidationException::withMessages([
                'type' => 'Download type is invalid.',
            ]);
        }
        $this->assertCanViewFile($user, $submission, $fileType);

        $path = $this->filePathForType($submission, $fileType);
        $originalFilename = $this->fileOriginalNameForType($submission, $fileType);
        if (! $this->submissionFilePathExists($path)) {
            abort(Response::HTTP_NOT_FOUND, 'Requested file was not found.');
        }

        if ($this->isMonitor($user)) {
            $this->auditSubmissionEvent($request, 'monitor.file_downloaded', $submission, $user, [
                'scope_id' => $fileType,
                'scope_type' => 'file',
                'file_type' => $fileType,
                'original_filename' => $originalFilename,
            ]);
        }

        if (app(SubmissionFileBlobStorage::class)->isDatabasePath($path)) {
            return $this->databaseFileResponse($submission, $fileType, true);
        }

        $downloadFilename = $this->safeDownloadFilename($originalFilename, basename((string) $path));

        return $this->submissionFileDisk()->download($path, $downloadFilename);
    }

    public function viewFile(Request $request, IndicatorSubmission $submission, string $type)
    {
        $user = $this->requireUser($request);

        $fileType = strtolower(trim($type));
        if (! SubmissionFileDefinition::isValidType($fileType)) {
            throw ValidationException::withMessages([
                'type' => 'View type is invalid.',
            ]);
        }
        $this->assertCanViewFile($user, $submission, $fileType);

        $path = $this->filePathForType($submission, $fileType);
        $originalFilename = $this->fileOriginalNameForType($submission, $fileType);
        if (! $this->submissionFilePathExists($path)) {
            abort(Response::HTTP_NOT_FOUND, 'Requested file was not found.');
        }

        if ($this->isMonitor($user)) {
            $this->auditSubmissionEvent($request, 'monitor.file_previewed', $submission, $user, [
                'scope_id' => $fileType,
                'scope_type' => 'file',
                'file_type' => $fileType,
                'original_filename' => $originalFilename,
            ]);
        }

        if (app(SubmissionFileBlobStorage::class)->isDatabasePath($path)) {
            return $this->databaseFileResponse($submission, $fileType, false);
        }

        $absolutePath = $this->submissionFileDisk()->path($path);
        $filename = $this->safeDownloadFilename($originalFilename, basename((string) $path));
        $mimeType = $this->submissionFileDisk()->mimeType($path) ?: 'application/octet-stream';

        return response()->file($absolutePath, [
            'Content-Type' => $mimeType,
            'Content-Disposition' => 'inline; filename="' . $filename . '"',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function databaseFileResponse(IndicatorSubmission $submission, string $fileType, bool $download)
    {
        $blobStorage = app(SubmissionFileBlobStorage::class);
        $blob = $blobStorage->findForSubmission($submission, $fileType);
        if (! $blob) {
            abort(Response::HTTP_NOT_FOUND, 'Requested file was not found.');
        }

        $filename = $this->safeDownloadFilename(
            $blob->original_filename ?: $this->fileOriginalNameForType($submission, $fileType),
            $fileType . '.bin',
        );

        $mimeType = trim((string) $blob->mime_type);
        if ($mimeType === '') {
            $mimeType = 'application/octet-stream';
        }

        return response($blobStorage->contentAsString($blob), Response::HTTP_OK, [
            'Content-Type' => $mimeType,
            'Content-Disposition' => ($download ? 'attachment' : 'inline') . '; filename="' . $filename . '"',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function safeDownloadFilename(?string $filename, string $fallback): string
    {
        $fallback = $this->sanitizeResponseFilename($fallback);
        if ($fallback === '') {
            $fallback = 'download.bin';
        }

        $candidate = $this->sanitizeResponseFilename($filename);

        return $candidate !== '' ? $candidate : $fallback;
    }

    private function sanitizeResponseFilename(?string $filename): string
    {
        $sanitized = trim((string) ($filename ?? ''));
        if ($sanitized === '') {
            return '';
        }

        $sanitized = preg_replace('/[\x00-\x1F\x7F]+/', '', $sanitized) ?? '';
        $sanitized = str_replace(['/', '\\'], '-', $sanitized);
        $sanitized = str_replace('"', '', $sanitized);
        $sanitized = preg_replace('/\s+/', ' ', $sanitized) ?? '';

        return trim($sanitized);
    }

    public function submit(Request $request, IndicatorSubmission $submission): JsonResponse
    {
        $user = $this->requireUser($request);
        $this->assertCanSubmit($user, $submission->school_id);
        /** @var SubmissionFileRequirementResolver $requirementResolver */
        $requirementResolver = app(SubmissionFileRequirementResolver::class);

        $fromStatus = $this->statusValue($submission->status);
        $this->assertSubmissionHasNoVerifiedScopes($submission);
        if (! in_array($fromStatus, [
            FormSubmissionStatus::DRAFT->value,
            FormSubmissionStatus::RETURNED->value,
        ], true)) {
            throw ValidationException::withMessages([
                'submission' => 'Only draft or returned indicator submissions can be submitted.',
            ]);
        }

        $missingRequirements = $requirementResolver->missingRequirementLabelsForSubmission($submission);

        if ($missingRequirements !== []) {
            throw ValidationException::withMessages([
                'submission' => 'Submission is incomplete. Missing: ' . implode(', ', $missingRequirements) . '.',
            ]);
        }

        $submission->forceFill([
            'status' => FormSubmissionStatus::SUBMITTED->value,
            'submitted_by' => $user->id,
            'submitted_at' => now(),
            'reviewed_by' => null,
            'reviewed_at' => null,
            'review_notes' => null,
        ])->save();

        app(FormSubmissionHistoryLogger::class)->log(
            formType: IndicatorSubmission::FORM_TYPE,
            submissionId: $submission->id,
            schoolId: $submission->school_id,
            academicYearId: $submission->academic_year_id,
            action: 'submitted',
            fromStatus: $fromStatus,
            toStatus: FormSubmissionStatus::SUBMITTED,
            actorId: $user->id,
            notes: 'Indicator package submitted to monitor.',
        );

        $this->auditSubmissionEvent($request, 'submission.final_submitted', $submission, $user, [
            'old_status' => $fromStatus,
            'new_status' => FormSubmissionStatus::SUBMITTED->value,
            'submitted_scope_count' => count(app(SubmissionScopeProgressResolver::class)->buildScopeProgressForSubmission($submission)['requiredScopeIds'] ?? []),
        ]);

        $this->notifyMonitorsOfSubmissionReceived(
            $submission,
            $user,
            $fromStatus === FormSubmissionStatus::RETURNED->value
                ? 'indicator_package_resubmitted'
                : 'indicator_package_submitted',
        );

        event(new CspamsUpdateBroadcast(
            $this->indicatorBroadcastPayload($submission, 'indicators.submitted', [
                'status' => FormSubmissionStatus::SUBMITTED->value,
            ]),
        ));

        return $this->fullSubmissionResponse($submission);
    }

    public function submitScopes(Request $request, IndicatorSubmission $submission): JsonResponse
    {
        $user = $this->requireUser($request);
        $this->assertCanSubmit($user, $submission->school_id);
        /** @var SubmissionScopeProgressResolver $scopeProgressResolver */
        $scopeProgressResolver = app(SubmissionScopeProgressResolver::class);

        $fromStatus = $this->statusValue($submission->status);
        if (! in_array($fromStatus, [
            FormSubmissionStatus::DRAFT->value,
            FormSubmissionStatus::RETURNED->value,
        ], true)) {
            throw ValidationException::withMessages([
                'submission' => 'Only draft or returned indicator submissions can submit individual scopes.',
            ]);
        }

        $validated = $request->validate([
            'targets' => ['required', 'array', 'min:1'],
            'targets.*' => ['required', 'string'],
        ]);

        $targets = $scopeProgressResolver->normalizeScopeIds(
            $submission,
            array_map(static fn (mixed $value): string => (string) $value, (array) ($validated['targets'] ?? [])),
        );

        if ($targets === []) {
            throw ValidationException::withMessages([
                'targets' => 'Select at least one valid submission scope.',
            ]);
        }
        $this->assertScopesAreNotVerified($submission, $targets);

        $missingRequirements = $scopeProgressResolver->missingRequirementLabelsForScopes($submission, $targets);
        if ($missingRequirements !== []) {
            throw ValidationException::withMessages([
                'targets' => 'Submission scope is incomplete. Missing: ' . implode(', ', $missingRequirements) . '.',
            ]);
        }

        $this->upsertSubmittedScopes($submission, $targets, $user);

        app(FormSubmissionHistoryLogger::class)->log(
            formType: IndicatorSubmission::FORM_TYPE,
            submissionId: $submission->id,
            schoolId: $submission->school_id,
            academicYearId: $submission->academic_year_id,
            action: 'scope_submitted',
            fromStatus: $fromStatus,
            toStatus: $fromStatus ?? FormSubmissionStatus::DRAFT->value,
            actorId: $user->id,
            notes: 'Submission scopes sent for monitor review: ' . implode(', ', array_map(
                [$scopeProgressResolver, 'scopeLabel'],
                $targets,
            )) . '.',
            metadata: [
                'targets' => $targets,
            ],
        );

        $scopeLabelsById = [];
        $hasReturnedTarget = false;
        $returnedTargets = [];
        foreach ($targets as $target) {
            $previousDecision = $this->latestScopeDecisionForAudit($submission, $target);
            $isResend = $previousDecision === 'returned';
            $hasReturnedTarget = $hasReturnedTarget || $isResend;
            if ($isResend) {
                $returnedTargets[] = $target;
            }
            $scopeType = $this->scopeTypeFor($target);
            $scopeLabel = $scopeProgressResolver->scopeLabel($target);
            $scopeLabelsById[$target] = $scopeLabel;
            $this->auditSubmissionEvent(
                $request,
                $isResend
                    ? ($scopeType === 'file' ? 'submission.file_resent' : 'submission.scope_resent')
                    : ($scopeType === 'file' ? 'submission.file_sent' : 'submission.scope_sent'),
                $submission,
                $user,
                [
                    'old_status' => $fromStatus,
                    'new_status' => $fromStatus ?? FormSubmissionStatus::DRAFT->value,
                    'scope_id' => $target,
                    'scope_type' => $scopeType,
                    'scope_label' => $scopeLabel,
                    'file_type' => $scopeType === 'file' ? $target : null,
                    'previous_decision' => $previousDecision,
                ],
            );
        }

        $this->clearReturnedScopeReviews($submission, $returnedTargets);

        $this->notifyMonitorsOfSubmissionReceived(
            $submission,
            $user,
            $hasReturnedTarget ? 'indicator_scope_resent' : 'indicator_scope_submitted',
            $targets,
            array_values($scopeLabelsById),
        );

        event(new CspamsUpdateBroadcast(
            $this->indicatorBroadcastPayload($submission, 'indicators.scopes_submitted', [
                'targets' => $targets,
                'touchedScopes' => $targets,
            ]),
        ));

        return $this->lightweightSubmissionResponse($submission);
    }

    public function review(ReviewIndicatorSubmissionRequest $request, IndicatorSubmission $submission): JsonResponse
    {
        $user = $this->requireUser($request);
        $this->assertCanReview($user);
        $this->assertCanView($user, $submission->school_id);

        $fromStatus = $this->statusValue($submission->status);
        if ($fromStatus !== FormSubmissionStatus::SUBMITTED->value) {
            throw ValidationException::withMessages([
                'submission' => 'Only submitted indicator packages can be validated or returned.',
            ]);
        }

        $decision = $request->string('decision')->toString();
        $notes = $request->filled('notes')
            ? trim($request->string('notes')->toString())
            : null;

        $submission->forceFill([
            'status' => $decision,
            'reviewed_by' => $user->id,
            'reviewed_at' => now(),
            'review_notes' => $notes,
        ])->save();

        if ($decision === FormSubmissionStatus::RETURNED->value) {
            $deletedScopeCount = $submission->scopeSubmissions()->delete();
            if ($deletedScopeCount > 0) {
                $this->touchSubmissionScopeState($submission);
            }
        }

        app(FormSubmissionHistoryLogger::class)->log(
            formType: IndicatorSubmission::FORM_TYPE,
            submissionId: $submission->id,
            schoolId: $submission->school_id,
            academicYearId: $submission->academic_year_id,
            action: $decision === FormSubmissionStatus::VALIDATED->value ? 'validated' : 'returned',
            fromStatus: $fromStatus,
            toStatus: $decision,
            actorId: $user->id,
            notes: $notes,
        );

        $this->auditSubmissionEvent(
            $request,
            $decision === FormSubmissionStatus::VALIDATED->value ? 'monitor.package_validated' : 'monitor.package_returned',
            $submission,
            $user,
            [
                'old_status' => $fromStatus,
                'new_status' => $decision,
                'decision' => $decision,
                'has_note' => $notes !== null && $notes !== '',
            ],
        );

        $schoolHeadsQuery = User::query()
            ->with('roles')
            ->where('school_id', $submission->school_id);

        if ($this->usersHaveAccountTypeColumn()) {
            $schoolHeadsQuery->where('account_type', UserRoleResolver::SCHOOL_HEAD);
        } else {
            $aliases = UserRoleResolver::roleAliases(UserRoleResolver::SCHOOL_HEAD);
            $schoolHeadsQuery->whereHas('roles', static function ($builder) use ($aliases): void {
                $builder->whereIn('name', $aliases);
            });
        }

        $schoolHeads = $schoolHeadsQuery->get();

        Notification::sendNow($schoolHeads, new IndicatorReviewOutcomeNotification(
            $submission,
            $user,
            $decision,
            $notes,
        ), ['database']);

        event(new CspamsUpdateBroadcast(
            $this->indicatorBroadcastPayload(
                $submission,
                $decision === FormSubmissionStatus::VALIDATED->value ? 'indicators.validated' : 'indicators.returned',
                [
                    'status' => $decision,
                    'notes' => $notes,
                ],
            ),
        ));

        return $this->fullSubmissionResponse($submission);
    }

    public function reviewScope(ReviewIndicatorSubmissionScopeRequest $request, IndicatorSubmission $submission): JsonResponse
    {
        $user = $this->requireUser($request);
        $this->assertCanReview($user);
        $this->assertCanView($user, $submission->school_id);

        /** @var SubmissionScopeProgressResolver $scopeProgressResolver */
        $scopeProgressResolver = app(SubmissionScopeProgressResolver::class);
        $scopeId = strtolower(trim($request->string('scopeId')->toString()));
        $normalizedScopeIds = $scopeProgressResolver->normalizeScopeIds($submission, [$scopeId]);

        if ($normalizedScopeIds === []) {
            throw ValidationException::withMessages([
                'scopeId' => 'Select a valid requirement from this submission package.',
            ]);
        }

        $scopeId = $normalizedScopeIds[0];
        $decision = $request->string('decision')->toString();
        $currentReview = IndicatorSubmissionScopeReview::query()
            ->where('indicator_submission_id', $submission->id)
            ->where('scope_id', $scopeId)
            ->first();
        $previousDecision = trim((string) ($currentReview?->decision ?? '')) ?: null;

        if ($decision === 'unverified' && $previousDecision !== 'verified') {
            throw ValidationException::withMessages([
                'decision' => 'Only verified requirements can be unverified.',
            ]);
        }

        $scopeType = $this->scopeTypeFor($scopeId);
        $fromStatus = $this->statusValue($submission->status);
        $scopeProgress = $scopeProgressResolver->buildScopeProgressForSubmission($submission);
        $submittedScopeIds = is_array($scopeProgress['submittedScopeIds'] ?? null)
            ? $scopeProgress['submittedScopeIds']
            : [];
        if ($decision !== 'unverified' && ! in_array($scopeId, $submittedScopeIds, true)) {
            throw ValidationException::withMessages([
                'submission' => 'Only sent indicator scopes can be reviewed.',
            ]);
        }

        if ($decision !== 'unverified') {
            if ($scopeType === 'file' && $this->submissionFileMissingFromStorage($submission, $scopeId)) {
                throw ValidationException::withMessages([
                    'scopeId' => 'This submitted file is missing from storage. Ask the School Head to re-upload and resend it before review.',
                ]);
            }

            if (! $scopeProgressResolver->isScopeComplete($submission, $scopeId)) {
                throw ValidationException::withMessages([
                    'scopeId' => 'Only submitted file or data requirements can be reviewed.',
                ]);
            }
        }

        $notes = $request->filled('notes')
            ? trim($request->string('notes')->toString())
            : null;
        $scopeLabel = $scopeProgressResolver->scopeLabel($scopeId);

        $historyAction = match ($decision) {
            'verified' => 'scope_verified',
            'unverified' => 'scope_unverified',
            default => 'scope_returned',
        };
        $auditAction = match ($decision) {
            'verified' => 'monitor.scope_verified',
            'unverified' => 'monitor.scope_unverified',
            default => 'monitor.scope_returned',
        };
        $broadcastEvent = match ($decision) {
            'verified' => 'indicators.scope_verified',
            'unverified' => 'indicators.scope_unverified',
            default => 'indicators.scope_returned',
        };

        $review = IndicatorSubmissionScopeReview::query()->updateOrCreate(
            [
                'indicator_submission_id' => $submission->id,
                'scope_id' => $scopeId,
            ],
            [
                'scope_type' => $scopeType,
                'decision' => $decision,
                'notes' => $decision === 'returned' ? $notes : null,
                'reviewed_by' => $user->id,
                'reviewed_at' => now(),
            ],
        );

        if ($decision === 'returned') {
            $this->removeSubmittedScopes($submission, [$scopeId]);
        }

        app(FormSubmissionHistoryLogger::class)->log(
            formType: IndicatorSubmission::FORM_TYPE,
            submissionId: $submission->id,
            schoolId: $submission->school_id,
            academicYearId: $submission->academic_year_id,
            action: $historyAction,
            fromStatus: $fromStatus,
            toStatus: $fromStatus,
            actorId: $user->id,
            notes: $decision === 'returned' ? $notes : null,
            metadata: [
                'scopeId' => $scopeId,
                'scopeLabel' => $scopeLabel,
                'decision' => $decision,
                'previousDecision' => $previousDecision,
                'touchedScopes' => [$scopeId],
                'scopeReviewId' => (string) $review->id,
            ],
        );

        $this->auditSubmissionEvent(
            $request,
            $auditAction,
            $submission,
            $user,
            [
                'old_status' => $fromStatus,
                'new_status' => $fromStatus,
                'scope_id' => $scopeId,
                'scope_type' => $scopeType,
                'scope_label' => $scopeLabel,
                'file_type' => $scopeType === 'file' ? $scopeId : null,
                'decision' => $decision,
                'previous_decision' => $previousDecision,
                'has_note' => $decision === 'returned' && $notes !== null && $notes !== '',
            ],
        );

        $schoolHeads = $this->schoolHeadsForSubmission($submission);
        Notification::sendNow($schoolHeads, new IndicatorScopeReviewOutcomeNotification(
            $submission,
            $user,
            $scopeId,
            $scopeLabel,
            $decision,
            $notes,
        ), ['database']);

        event(new CspamsUpdateBroadcast(
            $this->indicatorBroadcastPayload(
                $submission,
                $broadcastEvent,
                [
                    'scopeId' => $scopeId,
                    'scopeLabel' => $scopeLabel,
                    'decision' => $decision,
                    'previousDecision' => $previousDecision,
                    'scopeReviewId' => (string) $review->id,
                    'status' => $this->statusValue($submission->status),
                    'touchedScopes' => [$scopeId],
                ],
            ),
        ));

        return $this->fullSubmissionResponse($submission);
    }

    public function resetWorkspace(Request $request, IndicatorSubmission $submission): JsonResponse
    {
        $user = $this->requireUser($request);
        $this->assertCanSubmit($user, $submission->school_id);

        $fromStatus = $this->statusValue($submission->status);
        if (! in_array($fromStatus, [
            FormSubmissionStatus::DRAFT->value,
            FormSubmissionStatus::RETURNED->value,
        ], true)) {
            throw ValidationException::withMessages([
                'submission' => 'Only draft or returned indicator submissions can reset a workspace.',
            ]);
        }

        $validated = $request->validate([
            'workspace' => [
                'required',
                'string',
                Rule::in(GroupBWorkspaceDefinition::resetTargets()),
            ],
        ]);

        $workspace = strtolower(trim((string) $validated['workspace']));
        $this->assertScopesAreNotVerified($submission, [$workspace]);

        $metadata = DB::transaction(function () use ($submission, $workspace): array {
            if (GroupBWorkspaceDefinition::isMetricWorkspace($workspace)) {
                return $this->resetWorkspaceIndicatorRows($submission, $workspace);
            }

            if (SubmissionFileDefinition::isValidType($workspace)) {
                return $this->resetWorkspaceFile($submission, $workspace);
            }

            return ['workspace' => $workspace];
        });

        $this->removeSubmittedScopes($submission, [$workspace]);

        app(FormSubmissionHistoryLogger::class)->log(
            formType: IndicatorSubmission::FORM_TYPE,
            submissionId: $submission->id,
            schoolId: $submission->school_id,
            academicYearId: $submission->academic_year_id,
            action: GroupBWorkspaceDefinition::historyActionFor($workspace),
            fromStatus: $fromStatus,
            toStatus: $fromStatus ?? FormSubmissionStatus::DRAFT->value,
            actorId: $user->id,
            notes: $this->historyNoteForWorkspaceReset($workspace),
            metadata: [
                ...$metadata,
                'touchedScopes' => [$workspace],
            ],
        );

        $this->auditSubmissionEvent(
            $request,
            SubmissionFileDefinition::isValidType($workspace) ? 'workspace.file_reset' : 'workspace.section_reset',
            $submission,
            $user,
            [
                'old_status' => $fromStatus,
                'new_status' => $fromStatus ?? FormSubmissionStatus::DRAFT->value,
                'scope_id' => $workspace,
                'scope_type' => SubmissionFileDefinition::isValidType($workspace) ? 'file' : 'section',
                'file_type' => SubmissionFileDefinition::isValidType($workspace) ? $workspace : null,
            ],
        );

        event(new CspamsUpdateBroadcast(
            $this->indicatorBroadcastPayload($submission, 'indicators.workspace_reset', [
                'workspace' => $workspace,
                'status' => $fromStatus,
                'touchedScopes' => [$workspace],
            ]),
        ));

        return $this->lightweightSubmissionResponse($submission);
    }

    public function history(Request $request, IndicatorSubmission $submission): AnonymousResourceCollection
    {
        $user = $this->requireUser($request);
        $this->assertCanView($user, $submission->school_id);

        $history = FormSubmissionHistory::query()
            ->with('actor:id,name,email')
            ->where('form_type', IndicatorSubmission::FORM_TYPE)
            ->where('submission_id', $submission->id)
            ->orderByDesc('created_at')
            ->get();

        return FormSubmissionHistoryResource::collection($history);
    }

    private function lightweightSubmissionResponse(IndicatorSubmission $submission, int $status = 200): JsonResponse
    {
        $submission->refresh()->loadMissing([
            'school:id,school_code,name,type',
            'submissionFiles:id,indicator_submission_id,type,path,original_filename,size_bytes,uploaded_at',
            'scopeSubmissions:id,indicator_submission_id,scope_id,scope_type,submitted_by,submitted_at',
            'scopeReviews.reviewedBy:id,name,email',
        ]);
        /** @var SubmissionFileRequirementResolver $requirementResolver */
        $requirementResolver = app(SubmissionFileRequirementResolver::class);
        $hasImetaFormData = $submission->hasImetaFormData();
        $hasBmefFile = $submission->hasBmefFile();
        $hasSmeaFile = $submission->hasSmeaFile();
        $uploadedFileTypes = $submission->uploadedSubmissionFileTypes();
        $requiredFileTypes = $requirementResolver->requiredTypesForSubmission($submission);
        $missingFileTypes = $requirementResolver->missingTypesForSubmission($submission);
        $secondaryHistoricalFileTypes = $requirementResolver->secondaryHistoricalTypesForSubmission($submission);
        /** @var SubmissionScopeProgressResolver $scopeProgressResolver */
        $scopeProgressResolver = app(SubmissionScopeProgressResolver::class);
        $scopeProgress = $scopeProgressResolver->buildScopeProgressForSubmission($submission);

        // Keep mutation payloads small by returning state-only fields (no items.metric eager loading).
        return response()->json([
            'data' => [
                'id' => (string) $submission->id,
                'schoolId' => (string) $submission->school_id,
                'schoolType' => $submission->school?->type,
                'academicYearId' => (string) $submission->academic_year_id,
                'academicYear' => [
                    'id' => (string) $submission->academic_year_id,
                    'name' => null,
                ],
                'reportingPeriod' => $submission->reporting_period,
                'status' => $this->statusValue($submission->status),
                'version' => (int) $submission->version,
                'notes' => $submission->notes,
                'submittedAt' => optional($submission->submitted_at)->toISOString(),
                'reviewedAt' => optional($submission->reviewed_at)->toISOString(),
                'updatedAt' => optional($submission->updated_at)->toISOString(),
                'completion' => [
                    'hasImetaFormData' => $hasImetaFormData,
                    'hasBmefFile' => $hasBmefFile,
                    'hasSmeaFile' => $hasSmeaFile,
                    'isComplete' => $requirementResolver->isSubmissionComplete($submission),
                    'requiredFileTypes' => $requiredFileTypes,
                    'uploadedFileTypes' => $uploadedFileTypes,
                    'missingFileTypes' => $missingFileTypes,
                ],
                'presentation' => [
                    'activeFileTypes' => $requiredFileTypes,
                    'activeReportFileTypes' => $requiredFileTypes,
                    'activeWorkspaceFileTypes' => $requiredFileTypes,
                    'secondaryHistoricalFileTypes' => $secondaryHistoricalFileTypes,
                ],
                'scopeProgress' => $scopeProgress,
                'scopeReviews' => $this->buildScopeReviewsPayload($submission),
                'files' => $this->buildSubmissionFilesPayload($submission, false),
            ],
        ], $status);
    }

    private function fullSubmissionResponse(IndicatorSubmission $submission, int $status = 200): JsonResponse
    {
        $submission->refresh()->load([
            'school:id,school_code,name,type',
            'academicYear:id,name',
            'items.metric:id,code,name,category,framework,data_type,input_schema,unit,sort_order',
            'submissionFiles:id,indicator_submission_id,type,path,original_filename,size_bytes,uploaded_at',
            'scopeSubmissions:id,indicator_submission_id,scope_id,scope_type,submitted_by,submitted_at',
            'scopeReviews.reviewedBy:id,name,email',
            'createdBy:id,name,email',
            'submittedBy:id,name,email',
            'reviewedBy:id,name,email',
        ]);

        return response()->json([
            'data' => (new IndicatorSubmissionResource($submission))->resolve(),
        ], $status);
    }

    private function scopeTypeFor(string $scopeId): string
    {
        if (SubmissionFileDefinition::isValidType($scopeId)) {
            return 'file';
        }

        if (GroupBWorkspaceDefinition::isMetricWorkspace($scopeId)) {
            return 'section';
        }

        return 'unknown';
    }

    /**
     * @param list<string> $scopeIds
     * @return list<string>
     */
    private function normalizedScopeIdsForSubmission(IndicatorSubmission $submission, array $scopeIds): array
    {
        /** @var SubmissionScopeProgressResolver $scopeProgressResolver */
        $scopeProgressResolver = app(SubmissionScopeProgressResolver::class);

        return $scopeProgressResolver->normalizeScopeIds($submission, $scopeIds);
    }

    /**
     * @return list<string>
     */
    private function verifiedScopeIdsForSubmission(IndicatorSubmission $submission): array
    {
        return IndicatorSubmissionScopeReview::query()
            ->where('decision', 'verified')
            ->whereHas('submission', static function ($query) use ($submission): void {
                $query
                    ->where('school_id', $submission->school_id)
                    ->where('academic_year_id', $submission->academic_year_id);
            })
            ->pluck('scope_id')
            ->map(static fn (mixed $scopeId): string => strtolower(trim((string) $scopeId)))
            ->filter(static fn (string $scopeId): bool => $scopeId !== '')
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @param list<string> $scopeIds
     */
    private function assertSchoolYearScopesAreNotVerified(int $schoolId, int $academicYearId, array $scopeIds): void
    {
        $normalizedScopeIds = array_values(array_filter(
            array_map(static fn (mixed $scopeId): string => strtolower(trim((string) $scopeId)), $scopeIds),
            static fn (string $scopeId): bool => $scopeId !== '',
        ));
        if ($normalizedScopeIds === []) {
            return;
        }

        $hasVerifiedScope = IndicatorSubmissionScopeReview::query()
            ->where('decision', 'verified')
            ->whereIn('scope_id', $normalizedScopeIds)
            ->whereHas('submission', static function ($query) use ($schoolId, $academicYearId): void {
                $query
                    ->where('school_id', $schoolId)
                    ->where('academic_year_id', $academicYearId);
            })
            ->exists();

        if ($hasVerifiedScope) {
            throw ValidationException::withMessages([
                'submission' => 'This file or indicator has been verified.',
            ]);
        }
    }

    /**
     * @param list<string> $scopeIds
     */
    private function assertScopesAreNotVerified(IndicatorSubmission $submission, array $scopeIds): void
    {
        $normalizedScopeIds = $this->normalizedScopeIdsForSubmission($submission, $scopeIds);
        if ($normalizedScopeIds === []) {
            return;
        }

        if (array_intersect($normalizedScopeIds, $this->verifiedScopeIdsForSubmission($submission)) !== []) {
            throw ValidationException::withMessages([
                'submission' => 'This file or indicator has been verified.',
            ]);
        }
    }

    private function assertSubmissionHasNoVerifiedScopes(IndicatorSubmission $submission): void
    {
        if ($this->verifiedScopeIdsForSubmission($submission) === []) {
            return;
        }

        throw ValidationException::withMessages([
            'submission' => 'This package contains verified files or indicators. Ask the Monitor to unverify them before final submission.',
        ]);
    }

    /**
     * @param list<string> $scopeIds
     */
    private function upsertSubmittedScopes(IndicatorSubmission $submission, array $scopeIds, User $submittedBy): void
    {
        $submittedAt = now();

        foreach ($scopeIds as $scopeId) {
            IndicatorSubmissionScopeSubmission::query()->updateOrCreate(
                [
                    'indicator_submission_id' => $submission->id,
                    'scope_id' => $scopeId,
                ],
                [
                    'scope_type' => $this->scopeTypeFor($scopeId),
                    'submitted_by' => $submittedBy->id,
                    'submitted_at' => $submittedAt,
                ],
            );
        }

        $this->touchSubmissionScopeState($submission);
    }

    private function touchSubmissionScopeState(IndicatorSubmission $submission): void
    {
        $submission->touch();
        $submission->refresh();
        $submission->unsetRelation('scopeSubmissions');
        $submission->unsetRelation('scopeReviews');
    }

    /**
     * @param list<string> $scopeIds
     */
    private function removeSubmittedScopes(IndicatorSubmission $submission, array $scopeIds): void
    {
        $normalizedScopeIds = array_values(array_filter(
            array_map(static fn (mixed $scopeId): string => strtolower(trim((string) $scopeId)), $scopeIds),
            static fn (string $scopeId): bool => $scopeId !== '',
        ));

        if ($normalizedScopeIds === []) {
            return;
        }

        $deletedScopeCount = IndicatorSubmissionScopeSubmission::query()
            ->where('indicator_submission_id', $submission->id)
            ->whereIn('scope_id', $normalizedScopeIds)
            ->delete();

        if ($deletedScopeCount > 0) {
            $this->touchSubmissionScopeState($submission);
            return;
        }

        $submission->unsetRelation('scopeSubmissions');
    }

    /**
     * @param list<string> $scopeIds
     */
    private function clearReturnedScopeReviews(IndicatorSubmission $submission, array $scopeIds): void
    {
        $normalizedScopeIds = array_values(array_filter(
            array_map(static fn (mixed $scopeId): string => strtolower(trim((string) $scopeId)), $scopeIds),
            static fn (string $scopeId): bool => $scopeId !== '',
        ));

        if ($normalizedScopeIds === []) {
            return;
        }

        IndicatorSubmissionScopeReview::query()
            ->where('indicator_submission_id', $submission->id)
            ->whereIn('scope_id', $normalizedScopeIds)
            ->where('decision', 'returned')
            ->delete();

        $submission->unsetRelation('scopeReviews');
    }

    /**
     * @return \Illuminate\Database\Eloquent\Collection<int, User>
     */
    private function schoolHeadsForSubmission(IndicatorSubmission $submission): \Illuminate\Database\Eloquent\Collection
    {
        $schoolHeadsQuery = User::query()
            ->with('roles')
            ->where('school_id', $submission->school_id);

        if ($this->usersHaveAccountTypeColumn()) {
            $schoolHeadsQuery->where('account_type', UserRoleResolver::SCHOOL_HEAD);
        } else {
            $aliases = UserRoleResolver::roleAliases(UserRoleResolver::SCHOOL_HEAD);
            $schoolHeadsQuery->whereHas('roles', static function ($builder) use ($aliases): void {
                $builder->whereIn('name', $aliases);
            });
        }

        return $schoolHeadsQuery->get();
    }

    /**
     * @param list<string> $scopeIds
     * @param list<string> $scopeLabels
     */
    private function notifyMonitorsOfSubmissionReceived(
        IndicatorSubmission $submission,
        User $schoolHead,
        string $eventType,
        array $scopeIds = [],
        array $scopeLabels = [],
    ): void {
        $monitors = $this->monitorRecipientsForNotifications();
        if ($monitors->isEmpty()) {
            return;
        }

        Notification::sendNow($monitors, new IndicatorSubmissionReceivedNotification(
            $submission,
            $schoolHead,
            $eventType,
            $scopeIds,
            $scopeLabels,
        ), ['database']);
    }

    /**
     * @return Collection<int, User>
     */
    private function monitorRecipientsForNotifications(): Collection
    {
        $monitorQuery = User::query()->with('roles');

        if ($this->usersHaveAccountTypeColumn()) {
            $monitorQuery->where('account_type', UserRoleResolver::MONITOR);
        } else {
            $aliases = UserRoleResolver::roleAliases(UserRoleResolver::MONITOR);
            $monitorQuery->whereHas('roles', static function ($builder) use ($aliases): void {
                $builder->whereIn('name', $aliases);
            });
        }

        return $monitorQuery
            ->get()
            ->filter(static fn (User $user): bool => $user->canAuthenticate())
            ->values();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function buildScopeReviewsPayload(IndicatorSubmission $submission): array
    {
        $submission->loadMissing('scopeReviews.reviewedBy:id,name,email');

        return $submission->scopeReviews->map(static fn (IndicatorSubmissionScopeReview $review): array => [
            'id' => (string) $review->id,
            'scopeId' => $review->scope_id,
            'scopeType' => $review->scope_type,
            'decision' => $review->decision,
            'notes' => $review->notes,
            'reviewedBy' => $review->reviewedBy
                ? [
                    'id' => (string) $review->reviewedBy->id,
                    'name' => $review->reviewedBy->name,
                    'email' => $review->reviewedBy->email,
                ]
                : null,
            'reviewedAt' => optional($review->reviewed_at)->toISOString(),
            'updatedAt' => optional($review->updated_at)->toISOString(),
        ])->values()->all();
    }

    /**
     * @param array<string, mixed> $metadata
     */
    private function auditSubmissionEvent(
        Request $request,
        string $action,
        IndicatorSubmission $submission,
        User $actor,
        array $metadata = [],
    ): void {
        app(WorkflowAuditLogger::class)->recordSubmissionEvent(
            $request,
            $action,
            $submission,
            $actor,
            $metadata,
        );
    }

    /**
     * @param Collection<int, array<string, mixed>> $indicatorRows
     * @return list<string>
     */
    private function auditScopeIdsForRows(Collection $indicatorRows): array
    {
        $metricIds = $indicatorRows
            ->pluck('performance_metric_id')
            ->filter(static fn (mixed $value): bool => is_numeric($value) && (int) $value > 0)
            ->map(static fn (mixed $value): int => (int) $value)
            ->unique()
            ->values();

        if ($metricIds->isEmpty()) {
            return [];
        }

        $metricCodes = PerformanceMetric::query()
            ->whereIn('id', $metricIds->all())
            ->pluck('code')
            ->map(static fn (mixed $code): string => strtoupper(trim((string) $code)))
            ->filter(static fn (string $code): bool => $code !== '')
            ->values()
            ->all();

        $scopeIds = [];
        foreach ([GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS, GroupBWorkspaceDefinition::KEY_PERFORMANCE] as $workspace) {
            $workspaceCodes = array_flip(array_map(
                static fn (string $code): string => strtoupper(trim($code)),
                GroupBWorkspaceDefinition::metricCodesFor($workspace),
            ));

            foreach ($metricCodes as $code) {
                if (isset($workspaceCodes[$code])) {
                    $scopeIds[] = $workspace;
                    break;
                }
            }
        }

        return array_values(array_unique($scopeIds));
    }

    private function latestScopeDecisionForAudit(IndicatorSubmission $submission, string $scopeId): ?string
    {
        $submission->loadMissing('scopeReviews');

        $review = $submission->scopeReviews
            ->first(static fn (IndicatorSubmissionScopeReview $candidate): bool => $candidate->scope_id === $scopeId);

        $decision = trim((string) ($review?->decision ?? ''));

        return $decision !== '' ? $decision : null;
    }

    /**
     * @param array<string, mixed> $extra
     * @return array<string, mixed>
     */
    private function indicatorBroadcastPayload(
        IndicatorSubmission $submission,
        string $eventType,
        array $extra = [],
    ): array {
        $touchedScopes = array_values(array_filter(
            array_map(
                static fn (mixed $scope): string => is_scalar($scope) ? trim((string) $scope) : '',
                (array) ($extra['touchedScopes'] ?? []),
            ),
            static fn (string $scope): bool => $scope !== '',
        ));

        unset($extra['touchedScopes']);

        return [
            'entity' => 'indicators',
            'eventType' => $eventType,
            'submissionId' => (string) $submission->id,
            'schoolId' => (string) $submission->school_id,
            'schoolCode' => (string) ($submission->school?->school_code ?? ''),
            'academicYearId' => (string) $submission->academic_year_id,
            'status' => $extra['status'] ?? $this->statusValue($submission->status),
            'version' => (int) $submission->version,
            'updatedAt' => optional($submission->updated_at)->toISOString(),
            ...($touchedScopes !== [] ? ['touchedScopes' => $touchedScopes] : []),
            ...$extra,
        ];
    }

    private function requireUser(Request $request): User
    {
        $user = ApiUserResolver::fromRequest($request);
        abort_if(! $user, Response::HTTP_UNAUTHORIZED, 'Unauthenticated.');

        return $user;
    }

    private function syncRollingIndicatorYears(): void
    {
        if ($this->hasFreshRollingIndicatorYearSyncMarker()) {
            return;
        }

        $cacheStore = Cache::getStore();
        if (! ($cacheStore instanceof LockProvider)) {
            $this->runRollingIndicatorYearSync();

            return;
        }

        $lock = Cache::lock(self::ROLLING_YEAR_SYNC_LOCK_KEY, self::ROLLING_YEAR_SYNC_LOCK_TTL_SECONDS);
        if (! $lock->get()) {
            return;
        }

        try {
            if ($this->hasFreshRollingIndicatorYearSyncMarker()) {
                return;
            }

            $this->runRollingIndicatorYearSync();
        } finally {
            $lock->release();
        }
    }

    private function hasFreshRollingIndicatorYearSyncMarker(): bool
    {
        $lastSyncedAt = Cache::get(self::ROLLING_YEAR_SYNC_CACHE_KEY);
        if (! is_string($lastSyncedAt)) {
            return false;
        }

        try {
            return Carbon::parse($lastSyncedAt)
                ->greaterThan(now()->subMinutes(self::ROLLING_YEAR_SYNC_TTL_MINUTES));
        } catch (\Throwable) {
            return false;
        }
    }

    private function runRollingIndicatorYearSync(): void
    {
        app(RollingIndicatorYearWindow::class)->sync();
        Cache::put(
            self::ROLLING_YEAR_SYNC_CACHE_KEY,
            now()->toISOString(),
            now()->addMinutes(self::ROLLING_YEAR_SYNC_TTL_MINUTES),
        );
    }

    private function usersHaveAccountTypeColumn(): bool
    {
        if (app()->runningUnitTests()) {
            return Schema::hasColumn('users', 'account_type');
        }

        if (self::$usersHasAccountTypeColumn === null) {
            self::$usersHasAccountTypeColumn = Schema::hasColumn('users', 'account_type');
        }

        return self::$usersHasAccountTypeColumn;
    }
    private function applyVisibilityScope(Builder $query, User $user): void
    {
        if ($this->isSchoolHead($user)) {
            abort_if(! $user->school_id, Response::HTTP_FORBIDDEN, 'School Head account is missing school assignment.');
            $query->where('school_id', $user->school_id);
            return;
        }

        $this->assertCanReview($user);
    }

    /**
     * @return array<string, mixed>
     */
    private function buildIndicatorFilters(Request $request): array
    {
        $filters = $this->filterService->extract($request);

        if ($request->has('reporting_period')) {
            $reportingPeriod = trim((string) $request->input('reporting_period'));
            $filters['reporting_period'] = $reportingPeriod === '' ? null : $reportingPeriod;
        }

        if ($request->has('school_code')) {
            $schoolCode = trim((string) $request->input('school_code'));
            $filters['school_code'] = $schoolCode === '' ? null : $schoolCode;
        }

        return $filters;
    }

    /**
     * @param array<string, mixed> $filters
     */
    private function applyIndicatorFilters(Builder $query, array $filters): void
    {
        $this->filterService->apply($query, $filters, [
            'date_column' => 'submitted_at',
            'search_columns' => ['reporting_period', 'notes'],
        ]);

        $schoolCode = trim((string) ($filters['school_code'] ?? ''));
        if ($schoolCode !== '') {
            $query->whereHas('school', static function (Builder $schoolQuery) use ($schoolCode): void {
                $schoolQuery->where('school_code', $schoolCode);
            });
        }

        if (! array_key_exists('reporting_period', $filters)) {
            return;
        }

        if ($filters['reporting_period'] === null) {
            $query->whereNull('reporting_period');
            return;
        }

        $reportingPeriod = trim((string) $filters['reporting_period']);
        if ($reportingPeriod !== '') {
            $query->where('reporting_period', $reportingPeriod);
        }
    }

    private function assertCanView(User $user, int $schoolId): void
    {
        if ($this->isMonitor($user)) {
            return;
        }

        if ($this->isSchoolHead($user) && (int) $user->school_id === (int) $schoolId) {
            return;
        }

        abort(Response::HTTP_FORBIDDEN, 'You are not allowed to access this indicator submission.');
    }

    private function assertCanViewFile(User $user, IndicatorSubmission $submission, string $fileType): void
    {
        if ($this->isSchoolHead($user) && (int) $user->school_id === (int) $submission->school_id) {
            return;
        }

        if (! $this->isMonitor($user)) {
            abort(Response::HTTP_FORBIDDEN, 'You are not allowed to access this indicator submission file.');
        }

        $status = $this->statusValue($submission->status);
        if (in_array($status, [
            FormSubmissionStatus::SUBMITTED->value,
            FormSubmissionStatus::VALIDATED->value,
        ], true)) {
            return;
        }

        /** @var SubmissionScopeProgressResolver $scopeProgressResolver */
        $scopeProgressResolver = app(SubmissionScopeProgressResolver::class);
        $scopeProgress = $scopeProgressResolver->buildScopeProgressForSubmission($submission);
        $submittedScopeIds = $scopeProgress['submittedScopeIds'] ?? [];

        if (is_array($submittedScopeIds) && in_array($fileType, $submittedScopeIds, true)) {
            return;
        }

        abort(Response::HTTP_FORBIDDEN, 'This file is not visible to monitors until it is sent or submitted.');
    }

    private function assertCanSubmit(User $user, int $schoolId): void
    {
        if ($this->isSchoolHead($user) && (int) $user->school_id === (int) $schoolId) {
            return;
        }

        abort(Response::HTTP_FORBIDDEN, 'Only the assigned School Head can submit this indicator package.');
    }

    private function filePathForType(IndicatorSubmission $submission, string $type): ?string
    {
        return $submission->submissionFilePathForType($type);
    }

    private function fileOriginalNameForType(IndicatorSubmission $submission, string $type): ?string
    {
        return $submission->submissionFileOriginalNameForType($type);
    }

    private function submissionFileDisk(): FilesystemAdapter
    {
        return app(SubmissionFileStorage::class)->disk();
    }

    private function submissionFilePathExists(?string $path): bool
    {
        return app(SubmissionFileStorage::class)->pathExists($path);
    }

    private function submissionFileExistsForType(IndicatorSubmission $submission, string $type): bool
    {
        return app(SubmissionFileStorage::class)->exists($submission, $type);
    }

    private function submissionFileMissingFromStorage(IndicatorSubmission $submission, string $type): bool
    {
        return app(SubmissionFileStorage::class)->missingFromStorage($submission, $type);
    }

    /**
     * @return array<string, mixed>
     */
    private function resetWorkspaceFile(IndicatorSubmission $submission, string $workspace): array
    {
        $existingPath = $this->filePathForType($submission, $workspace);
        $deletedFile = false;
        $blobStorage = app(SubmissionFileBlobStorage::class);
        if ($blobStorage->isDatabasePath($existingPath)) {
            $deletedFile = $blobStorage->deleteForPath($existingPath);
        } elseif ($this->submissionFilePathExists($existingPath)) {
            $deletedFile = $this->submissionFileDisk()->delete($existingPath);
        }

        if ($workspace === GroupBWorkspaceDefinition::BMEF) {
            $submission->forceFill([
                'bmef_file_path' => null,
                'bmef_original_filename' => null,
                'bmef_uploaded_at' => null,
                'bmef_file_size' => null,
            ])->save();
        } elseif ($workspace === GroupBWorkspaceDefinition::SMEA) {
            $submission->forceFill([
                'smea_file_path' => null,
                'smea_original_filename' => null,
                'smea_uploaded_at' => null,
                'smea_file_size' => null,
            ])->save();
        } else {
            $submission->submissionFiles()
                ->where('type', $workspace)
                ->delete();
        }

        return [
            'workspace' => $workspace,
            'deleted_file_path' => $existingPath,
            'deleted_file_from_storage' => $deletedFile,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function resetWorkspaceIndicatorRows(IndicatorSubmission $submission, string $workspace): array
    {
        $metricIds = $this->resolveWorkspaceMetricIds($workspace);
        if ($metricIds->isEmpty()) {
            return [
                'workspace' => $workspace,
                'metric_count' => 0,
                'deleted_indicator_count' => 0,
            ];
        }

        $deletedCount = $submission->items()
            ->whereIn('performance_metric_id', $metricIds->all())
            ->delete();

        return [
            'workspace' => $workspace,
            'metric_count' => $metricIds->count(),
            'deleted_indicator_count' => (int) $deletedCount,
        ];
    }

    /**
     * @return Collection<int, int>
     */
    private function resolveWorkspaceMetricIds(string $workspace): Collection
    {
        $codes = GroupBWorkspaceDefinition::metricCodesFor($workspace);
        if ($codes === []) {
            return collect();
        }

        return PerformanceMetric::query()
            ->get(['id', 'code'])
            ->filter(static fn (PerformanceMetric $metric): bool => in_array(strtoupper((string) $metric->code), $codes, true))
            ->pluck('id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->filter(static fn (int $id): bool => $id > 0)
            ->values();
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function buildSubmissionFilesPayload(IndicatorSubmission $submission, bool $includeInternalPath): array
    {
        $files = [];

        foreach (SubmissionFileDefinition::types() as $type) {
            $uploaded = $submission->hasSubmissionFileType($type);
            $available = $uploaded && $this->submissionFileExistsForType($submission, $type);
            $missingFromStorage = $uploaded && $this->submissionFileMissingFromStorage($submission, $type);
            $files[$type] = [
                'type' => $type,
                'uploaded' => $uploaded,
                'available' => $available,
                'missingFromStorage' => $missingFromStorage,
                'path' => $includeInternalPath ? $submission->submissionFilePathForType($type) : null,
                'originalFilename' => $submission->submissionFileOriginalNameForType($type),
                'sizeBytes' => $submission->submissionFileSizeForType($type),
                'uploadedAt' => optional($submission->submissionFileUploadedAtForType($type))->toISOString(),
                'downloadUrl' => $available ? "/api/submissions/{$submission->id}/download/{$type}" : null,
                'viewUrl' => $available ? "/api/submissions/{$submission->id}/view/{$type}" : null,
            ];
        }

        return $files;
    }

    private function historyNoteForWorkspaceReset(string $workspace): string
    {
        if (SubmissionFileDefinition::isValidType($workspace)) {
            return SubmissionFileDefinition::shortLabelFor($workspace) . ' workspace was reset.';
        }

        return match ($workspace) {
            GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS => 'School Achievements workspace was reset.',
            GroupBWorkspaceDefinition::KEY_PERFORMANCE => 'Key Performance workspace was reset.',
            default => 'Workspace was reset.',
        };
    }

    private function assertCanReview(User $user): void
    {
        abort_if(
            ! $this->isMonitor($user),
            Response::HTTP_FORBIDDEN,
            'Only monitor users can review indicator submissions.',
        );
    }

    private function assertSchoolHead(User $user): void
    {
        abort_if(
            ! $this->isSchoolHead($user),
            Response::HTTP_FORBIDDEN,
            'Only School Heads can encode indicator submissions.',
        );
    }

    /**
     * @return Collection<int, array{
     *     performance_metric_id: int,
     *     target_value: float,
     *     target_typed_value: array<string, mixed>,
     *     actual_value: float,
     *     actual_typed_value: array<string, mixed>,
     *     variance_value: float,
     *     target_display: string,
     *     actual_display: string,
     *     compliance_status: string,
     *     remarks: string|null
     * }>
     */
    private function buildIndicatorRows(UpsertIndicatorSubmissionRequest $request, int $schoolId): Collection
    {
        $rawIndicatorRows = collect($request->input('indicators', []))->values();
        $rawIndicatorRows = $this->mergeAutoCalculatedRows($rawIndicatorRows, $schoolId);

        $metricIds = $rawIndicatorRows
            ->map(fn (mixed $row): int => $this->normalizeMetricId(is_array($row) ? ($row['metric_id'] ?? null) : null))
            ->filter(static fn (int $value): bool => $value > 0)
            ->unique()
            ->values();
        $metricCodes = $rawIndicatorRows
            ->map(fn (mixed $row): string => $this->normalizeMetricCode(is_array($row) ? ($row['metric_code'] ?? null) : null))
            ->filter(static fn (string $value): bool => $value !== '')
            ->unique()
            ->values();

        if ($rawIndicatorRows->isEmpty()) {
            return collect();
        }

        $metrics = PerformanceMetric::query()
            ->where(function (Builder $query) use ($metricIds, $metricCodes): void {
                if ($metricIds->isNotEmpty()) {
                    $query->whereIn('id', $metricIds->all());
                }

                if ($metricCodes->isNotEmpty()) {
                    if ($metricIds->isNotEmpty()) {
                        $query->orWhereIn('code', $metricCodes->all());
                    } else {
                        $query->whereIn('code', $metricCodes->all());
                    }
                }
            })
            ->get();
        $metricsById = $metrics->keyBy(static fn (PerformanceMetric $metric): int => (int) $metric->id);
        $metricsByCode = $metrics->keyBy(static fn (PerformanceMetric $metric): string => strtoupper(trim((string) $metric->code)));
        $unresolved = [];

        return $rawIndicatorRows
            ->map(function (array $row, int $index) use ($metricsById, $metricsByCode, &$unresolved): ?array {
                $metricId = $this->normalizeMetricId($row['metric_id'] ?? null);
                $metricCode = $this->normalizeMetricCode($row['metric_code'] ?? null);

                /** @var PerformanceMetric|null $metric */
                $metric = $metricsById->get($metricId);
                if (! $metric && $metricCode !== '') {
                    $metric = $metricsByCode->get($metricCode);
                }

                if (! $metric) {
                    $unresolved[] = [
                        'index' => $index,
                        'metric_id' => $metricId > 0 ? $metricId : null,
                        'metric_code' => $metricCode !== '' ? $metricCode : null,
                    ];
                    return null;
                }

                $normalized = $this->normalizeMetricValues($metric, $row, $index);

                return [
                    'performance_metric_id' => (int) $metric->id,
                    'target_value' => $normalized['target_value'],
                    'target_typed_value' => $normalized['target_typed_value'],
                    'actual_value' => $normalized['actual_value'],
                    'actual_typed_value' => $normalized['actual_typed_value'],
                    'variance_value' => $normalized['variance_value'],
                    'target_display' => $normalized['target_display'],
                    'actual_display' => $normalized['actual_display'],
                    'compliance_status' => $normalized['compliance_status'],
                    'remarks' => isset($row['remarks']) ? trim((string) $row['remarks']) : null,
                ];
            })
            ->tap(function () use (&$unresolved): void {
                if ($unresolved === []) {
                    return;
                }

                $summary = collect($unresolved)
                    ->map(static function (array $row): string {
                        $parts = [];
                        if (isset($row['metric_id']) && $row['metric_id'] !== null) {
                            $parts[] = 'metric_id=' . $row['metric_id'];
                        }
                        if (isset($row['metric_code']) && $row['metric_code'] !== null) {
                            $parts[] = 'metric_code=' . $row['metric_code'];
                        }

                        return 'row ' . (((int) $row['index']) + 1) . ' (' . implode(', ', $parts) . ')';
                    })
                    ->implode('; ');

                throw ValidationException::withMessages([
                    'indicators' => 'Unable to resolve the following indicators against performance_metrics: ' . $summary . '.',
                ]);
            })
            ->filter(static fn (?array $row): bool => is_array($row))
            ->values();
    }

    /**
     * @param array<string, mixed> $row
     * @param array<string, mixed> $schema
     * @param int $index
     *
     * @return array{
     *     target_value: ?float,
     *     actual_value: ?float,
     *     variance_value: ?float,
     *     target_typed_value: array<string, mixed>,
     *     actual_typed_value: array<string, mixed>,
     *     target_display: string,
     *     actual_display: string,
     *     compliance_status: string
     * }
     */
    private function normalizeMetricValues(PerformanceMetric $metric, array $row, int $index): array
    {
        $schema = is_array($metric->input_schema) ? $metric->input_schema : [];
        $dataType = $this->metricDataType($metric);
        $comparison = (string) ($schema['comparison'] ?? $this->defaultComparison($dataType));
        $isActualOnlyMetric = $this->isActualOnlyWorkspaceMetric($metric);

        $targetRaw = array_key_exists('target', $row)
            ? $row['target']
            : ($row['target_value'] ?? null);
        $actualRaw = array_key_exists('actual', $row)
            ? $row['actual']
            : ($row['actual_value'] ?? null);

        if ($isActualOnlyMetric) {
            if ($actualRaw === null) {
                throw ValidationException::withMessages([
                    "indicators.{$index}" => 'Actual value is required for this indicator.',
                ]);
            }

            $actualParsed = $this->parseMetricValue($dataType, $actualRaw, $schema, "indicators.{$index}.actual");

            return [
                'target_value' => 0.0,
                'actual_value' => $actualParsed['numeric'] === null ? null : round($actualParsed['numeric'], 2),
                'variance_value' => 0.0,
                'target_typed_value' => null,
                'actual_typed_value' => $actualParsed['typed'],
                'target_display' => '-',
                'actual_display' => $actualParsed['display'],
                'compliance_status' => 'recorded',
            ];
        }

        if ($targetRaw === null || $actualRaw === null) {
            throw ValidationException::withMessages([
                "indicators.{$index}" => 'Both target and actual values are required for this indicator.',
            ]);
        }

        $targetParsed = $this->parseMetricValue($dataType, $targetRaw, $schema, "indicators.{$index}.target");
        $actualParsed = $this->parseMetricValue($dataType, $actualRaw, $schema, "indicators.{$index}.actual");
        $varianceValue = (
            $actualParsed['numeric'] !== null
            && $targetParsed['numeric'] !== null
        )
            ? round($actualParsed['numeric'] - $targetParsed['numeric'], 2)
            : null;

        $complianceStatus = (
            $targetParsed['comparable'] !== null
            && $actualParsed['comparable'] !== null
            && $this->isCompliant(
                $comparison,
                $targetParsed['comparable'],
                $actualParsed['comparable'],
            )
        ) ? 'met' : 'below_target';

        return [
            'target_value' => $targetParsed['numeric'] === null ? null : round($targetParsed['numeric'], 2),
            'actual_value' => $actualParsed['numeric'] === null ? null : round($actualParsed['numeric'], 2),
            'variance_value' => $varianceValue,
            'target_typed_value' => $targetParsed['typed'],
            'actual_typed_value' => $actualParsed['typed'],
            'target_display' => $targetParsed['display'],
            'actual_display' => $actualParsed['display'],
            'compliance_status' => $complianceStatus,
        ];
    }

    private function metricDataType(PerformanceMetric $metric): string
    {
        if ($metric->data_type instanceof MetricDataType) {
            return $metric->data_type->value;
        }

        $raw = (string) $metric->data_type;
        return MetricDataType::tryFrom($raw)?->value ?? MetricDataType::NUMBER->value;
    }

    /**
     * @param array<string, mixed> $schema
     *
     * @return array{
     *     typed: array<string, mixed>,
     *     numeric: ?float,
     *     display: string,
     *     comparable: mixed
     * }
     */
    private function parseMetricValue(string $dataType, mixed $raw, array $schema, string $errorPath): array
    {
        return match ($dataType) {
            MetricDataType::CURRENCY->value => $this->parseCurrencyValue($raw, $schema, $errorPath),
            MetricDataType::YES_NO->value => $this->parseYesNoValue($raw, $errorPath),
            MetricDataType::ENUM->value => $this->parseEnumValue($raw, $schema, $errorPath),
            MetricDataType::YEARLY_MATRIX->value => $this->parseYearlyMatrixValue($raw, $schema, $errorPath),
            MetricDataType::TEXT->value => $this->parseTextValue($raw, $errorPath),
            default => $this->parseNumberValue($raw, $schema, $errorPath),
        };
    }

    /**
     * @param array<string, mixed> $schema
     *
     * @return array{typed: array<string, mixed>, numeric: float, display: string, comparable: float}
     */
    private function parseNumberValue(mixed $raw, array $schema, string $errorPath): array
    {
        $value = is_array($raw) ? ($raw['value'] ?? null) : $raw;

        if (! is_numeric($value)) {
            throw ValidationException::withMessages([
                $errorPath => 'Numeric value is required.',
            ]);
        }

        $numeric = round((float) $value, 2);
        $valueType = (string) ($schema['valueType'] ?? 'number');

        if ($valueType === 'integer' && floor($numeric) !== $numeric) {
            throw ValidationException::withMessages([
                $errorPath => 'Whole number is required.',
            ]);
        }

        $display = $valueType === 'percentage'
            ? number_format($numeric, 2) . '%'
            : number_format($numeric, 2);

        return [
            'typed' => ['value' => $numeric],
            'numeric' => $numeric,
            'display' => $display,
            'comparable' => $numeric,
        ];
    }

    /**
     * @param array<string, mixed> $schema
     *
     * @return array{typed: array<string, mixed>, numeric: float, display: string, comparable: float}
     */
    private function parseCurrencyValue(mixed $raw, array $schema, string $errorPath): array
    {
        $amount = is_array($raw)
            ? ($raw['amount'] ?? $raw['value'] ?? null)
            : $raw;

        if (! is_numeric($amount)) {
            throw ValidationException::withMessages([
                $errorPath => 'Currency amount is required.',
            ]);
        }

        $currency = (string) ($schema['currency'] ?? 'PHP');
        $numeric = round((float) $amount, 2);

        return [
            'typed' => [
                'amount' => $numeric,
                'currency' => $currency,
            ],
            'numeric' => $numeric,
            'display' => "{$currency} " . number_format($numeric, 2),
            'comparable' => $numeric,
        ];
    }

    /**
     * @return array{typed: array<string, mixed>, numeric: float, display: string, comparable: bool}
     */
    private function parseYesNoValue(mixed $raw, string $errorPath): array
    {
        $value = is_array($raw) ? ($raw['value'] ?? null) : $raw;
        $bool = $this->normalizeBoolean($value);

        if ($bool === null) {
            throw ValidationException::withMessages([
                $errorPath => 'Value must be Yes or No.',
            ]);
        }

        return [
            'typed' => ['value' => $bool],
            'numeric' => $bool ? 1.0 : 0.0,
            'display' => $bool ? 'Yes' : 'No',
            'comparable' => $bool,
        ];
    }

    /**
     * @param array<string, mixed> $schema
     *
     * @return array{typed: array<string, mixed>, numeric: ?float, display: string, comparable: ?string}
     */
    private function parseEnumValue(mixed $raw, array $schema, string $errorPath): array
    {
        $value = is_array($raw) ? ($raw['value'] ?? null) : $raw;
        $value = is_string($value) ? trim($value) : '';
        $options = collect($schema['options'] ?? [])->map(static fn (mixed $option): string => trim((string) $option))
            ->filter(static fn (string $option): bool => $option !== '')
            ->values();

        if ($value === '') {
            return [
                'typed' => ['value' => null],
                'numeric' => null,
                'display' => '',
                'comparable' => null,
            ];
        }

        $resolvedValue = $this->resolveEnumOptionValue($value, $options);
        if ($resolvedValue === null) {
            throw ValidationException::withMessages([
                $errorPath => 'Invalid option selected for this indicator.',
            ]);
        }

        $numeric = $options->isEmpty()
            ? 1.0
            : (float) ($options->search($resolvedValue) + 1);

        return [
            'typed' => ['value' => $resolvedValue],
            'numeric' => $numeric,
            'display' => $resolvedValue,
            'comparable' => $resolvedValue,
        ];
    }

    /**
     * @param array<string, mixed> $schema
     *
     * @return array{typed: array<string, mixed>, numeric: float, display: string, comparable: array<string, mixed>}
     */
    private function parseYearlyMatrixValue(mixed $raw, array $schema, string $errorPath): array
    {
        if (is_array($raw)) {
            $values = $raw['values'] ?? $raw;
        } else {
            $seedYears = collect($schema['years'] ?? [])
                ->map(static fn (mixed $year): string => trim((string) $year))
                ->filter(static fn (string $year): bool => $year !== '')
                ->values();
            $defaultYear = $seedYears->first() ?? 'value';
            $values = [$defaultYear => $raw];
        }

        if (! is_array($values)) {
            throw ValidationException::withMessages([
                $errorPath => 'Yearly matrix values are required.',
            ]);
        }

        $allowedYears = collect($schema['years'] ?? [])
            ->map(static fn (mixed $year): string => trim((string) $year))
            ->filter(static fn (string $year): bool => $year !== '')
            ->values();
        $providedYears = collect(array_keys($values))
            ->map(static fn (mixed $year): string => trim((string) $year))
            ->filter(static fn (string $year): bool => $year !== '')
            ->values();
        $valueType = (string) ($schema['valueType'] ?? 'number');
        $enumOptions = collect($schema['options'] ?? [])
            ->map(static fn (mixed $option): string => trim((string) $option))
            ->filter(static fn (string $option): bool => $option !== '')
            ->values();
        $currency = (string) ($schema['currency'] ?? 'PHP');

        if ($allowedYears->isNotEmpty()) {
            $invalidYear = $providedYears->first(
                static fn (string $year): bool => ! $allowedYears->contains($year),
            );

            if (is_string($invalidYear)) {
                throw ValidationException::withMessages([
                    $errorPath => "Invalid school-year key: {$invalidYear}.",
                ]);
            }
        }

        $years = $providedYears;
        if ($years->isEmpty()) {
            throw ValidationException::withMessages([
                $errorPath => 'At least one school-year value is required.',
            ]);
        }

        $normalized = [];
        foreach ($years as $year) {
            if (! array_key_exists($year, $values)) {
                throw ValidationException::withMessages([
                    $errorPath => "Missing value for {$year}.",
                ]);
            }

            $yearValue = $values[$year];

            if ($valueType === 'yes_no') {
                $boolValue = $this->normalizeBoolean($yearValue);
                if ($boolValue === null) {
                    throw ValidationException::withMessages([
                        $errorPath => "Invalid Yes/No value for {$year}.",
                    ]);
                }
                $normalized[$year] = $boolValue;
                continue;
            }

            if ($valueType === 'enum') {
                $enumValue = trim((string) $yearValue);
                if ($enumValue === '') {
                    $normalized[$year] = '';
                    continue;
                }

                $resolvedValue = $this->resolveEnumOptionValue($enumValue, $enumOptions);
                if ($resolvedValue === null) {
                    throw ValidationException::withMessages([
                        $errorPath => "Invalid option for {$year}.",
                    ]);
                }

                $normalized[$year] = $resolvedValue;
                continue;
            }

            if ($valueType === 'text') {
                $textValue = trim((string) $yearValue);
                if ($textValue === '') {
                    throw ValidationException::withMessages([
                        $errorPath => "Text value is required for {$year}.",
                    ]);
                }

                $normalized[$year] = $textValue;
                continue;
            }

            if (! is_numeric($yearValue)) {
                throw ValidationException::withMessages([
                    $errorPath => "Numeric value is required for {$year}.",
                ]);
            }

            $numericValue = round((float) $yearValue, 2);
            if ($valueType === 'integer' && floor($numericValue) !== $numericValue) {
                throw ValidationException::withMessages([
                    $errorPath => "Whole number is required for {$year}.",
                ]);
            }

            $normalized[$year] = $numericValue;
        }

        $numeric = round(collect($normalized)->sum(function (mixed $value) use ($valueType, $enumOptions): float {
            if (is_bool($value)) {
                return $value ? 1.0 : 0.0;
            }

            if (is_numeric($value)) {
                return (float) $value;
            }

            if ($valueType === 'enum') {
                $index = $enumOptions->search((string) $value);
                return $index === false ? 0.0 : ((float) $index + 1);
            }

            return 1.0;
        }), 2);

        $display = collect($normalized)
            ->map(function (mixed $value, string $year) use ($valueType, $currency): string {
                if (is_bool($value)) {
                    return "{$year}: " . ($value ? 'Yes' : 'No');
                }

                if (is_numeric($value)) {
                    $formatted = $this->formatYearlyMatrixDisplayNumber((float) $value, $valueType);
                    if ($valueType === 'percentage') {
                        return "{$year}: {$formatted}%";
                    }

                    if ($valueType === 'currency') {
                        return "{$year}: {$currency} {$formatted}";
                    }

                    return "{$year}: {$formatted}";
                }

                return "{$year}: " . (string) $value;
            })
            ->join(' | ');

        return [
            'typed' => ['values' => $normalized],
            'numeric' => $numeric,
            'display' => $display,
            'comparable' => $normalized,
        ];
    }

    private function formatYearlyMatrixDisplayNumber(float $value, string $valueType): string
    {
        if ($valueType === 'integer') {
            return number_format($value, 0);
        }

        if ($valueType === 'percentage' || $valueType === 'currency') {
            return number_format($value, 2);
        }

        if (floor($value) === $value) {
            return number_format($value, 0);
        }

        return number_format($value, 2);
    }

    private function resolveEnumOptionValue(string $value, Collection $options): ?string
    {
        if ($options->isEmpty()) {
            return $value;
        }

        if ($options->contains($value)) {
            return $value;
        }

        foreach ($options as $option) {
            if (strcasecmp((string) $option, $value) === 0) {
                return (string) $option;
            }
        }

        return null;
    }

    /**
     * @return array{typed: array<string, mixed>, numeric: float, display: string, comparable: string}
     */
    private function parseTextValue(mixed $raw, string $errorPath): array
    {
        $value = is_array($raw) ? ($raw['value'] ?? null) : $raw;
        $value = trim((string) $value);

        if ($value === '') {
            throw ValidationException::withMessages([
                $errorPath => 'Text value is required.',
            ]);
        }

        return [
            'typed' => ['value' => $value],
            'numeric' => 1.0,
            'display' => $value,
            'comparable' => $value,
        ];
    }

    private function defaultComparison(string $dataType): string
    {
        return match ($dataType) {
            MetricDataType::YES_NO->value,
            MetricDataType::ENUM->value,
            MetricDataType::TEXT->value => 'equal',
            default => 'greater_or_equal',
        };
    }

    private function normalizeBoolean(mixed $value): ?bool
    {
        if (is_bool($value)) {
            return $value;
        }

        $normalized = strtolower(trim((string) $value));
        return match ($normalized) {
            '1', 'true', 'yes', 'y' => true,
            '0', 'false', 'no', 'n' => false,
            default => null,
        };
    }

    private function isCompliant(string $comparison, mixed $target, mixed $actual): bool
    {
        if ($comparison === 'info_only') {
            return true;
        }

        if (is_array($target) && is_array($actual)) {
            $keys = array_unique(array_merge(array_keys($target), array_keys($actual)));
            foreach ($keys as $key) {
                if (! array_key_exists($key, $target) || ! array_key_exists($key, $actual)) {
                    return false;
                }

                if (! $this->isCompliant($comparison, $target[$key], $actual[$key])) {
                    return false;
                }
            }

            return true;
        }

        return match ($comparison) {
            'less_or_equal' => (float) $actual <= (float) $target,
            'equal' => (string) $actual === (string) $target,
            default => (float) $actual >= (float) $target,
        };
    }

    private function nextVersion(int $schoolId, int $academicYearId, ?string $reportingPeriod): int
    {
        $query = IndicatorSubmission::query()
            ->where('school_id', $schoolId)
            ->where('academic_year_id', $academicYearId);

        if ($reportingPeriod === null) {
            $query->whereNull('reporting_period');
        } else {
            $query->where('reporting_period', $reportingPeriod);
        }

        return ((int) $query->max('version')) + 1;
    }

    private function isMonitor(User $user): bool
    {
        return UserRoleResolver::has($user, UserRoleResolver::MONITOR);
    }

    private function isSchoolHead(User $user): bool
    {
        return UserRoleResolver::has($user, UserRoleResolver::SCHOOL_HEAD);
    }

    private function statusValue(FormSubmissionStatus|string|null $status): ?string
    {
        if ($status instanceof FormSubmissionStatus) {
            return $status->value;
        }

        return is_string($status) && $status !== '' ? $status : null;
    }

    private function resolvePerPage(Request $request, int $default = 25, int $max = 100): int
    {
        $perPage = $request->integer('per_page');

        if ($perPage <= 0) {
            return $default;
        }

        return min($perPage, $max);
    }

    /**
     * @return array{recordCount: int, latestAt: ?Carbon}
     */
    private function buildSyncFingerprint(Builder $query): array
    {
        $probe = (clone $query)
            ->selectRaw('COUNT(*) as aggregate_count')
            ->selectRaw('MAX(updated_at) as latest_updated_at')
            ->selectRaw('MAX(submitted_at) as latest_submitted_at')
            ->selectRaw('MAX(reviewed_at) as latest_reviewed_at')
            ->first();

        $recordCount = (int) ($probe?->aggregate_count ?? 0);
        $latestAt = $this->resolveLatestTimestamp(
            $probe?->latest_updated_at,
            $probe?->latest_submitted_at,
            $probe?->latest_reviewed_at,
        );

        return [
            'recordCount' => $recordCount,
            'latestAt' => $latestAt,
        ];
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

    private function buildSyncEtag(
        string $scope,
        string $scopeKey,
        int $page,
        int $perPage,
        int $recordCount,
        ?Carbon $latestAt,
    ): string {
        return sha1(implode('|', [
            $scope,
            $scopeKey,
            (string) $page,
            (string) $perPage,
            (string) $recordCount,
            $latestAt?->format('U.u') ?? '0',
        ]));
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

    private function buildNotModifiedResponse(
        string $etag,
        string $scope,
        string $scopeKey,
        int $recordCount,
        ?Carbon $latestAt,
    ): JsonResponse {
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
     * Merge auto-calculated KPI indicator rows so these metrics no longer rely
     * on manual target/actual encoding.
     *
     * @param Collection<int, array<string, mixed>> $rawIndicatorRows
     * @return Collection<int, array<string, mixed>>
     */
    private function mergeAutoCalculatedRows(Collection $rawIndicatorRows, int $schoolId): Collection
    {
        $autoCalculator = app(TargetsMetAutoCalculator::class);
        $derivedByCode = $autoCalculator->deriveMatricesForSchool($schoolId);

        if ($derivedByCode === []) {
            return $rawIndicatorRows;
        }

        $autoMetrics = PerformanceMetric::query()
            ->whereIn('code', array_keys($derivedByCode))
            ->where('is_active', true)
            ->get(['id', 'code'])
            ->values();
        $autoMetricsById = $autoMetrics->keyBy(static fn (PerformanceMetric $metric): string => (string) $metric->id);
        $autoMetricsByCode = $autoMetrics->keyBy(static fn (PerformanceMetric $metric): string => strtoupper(trim((string) $metric->code)));

        if ($autoMetricsById->isEmpty()) {
            return $rawIndicatorRows;
        }

        return $rawIndicatorRows
            ->map(function (mixed $row) use ($autoMetricsById, $autoMetricsByCode, $derivedByCode): mixed {
                if (! is_array($row)) {
                    return $row;
                }

                $metricId = (string) $this->normalizeMetricId($row['metric_id'] ?? null);
                $metricCode = $this->normalizeMetricCode($row['metric_code'] ?? null);
                /** @var PerformanceMetric|null $metric */
                $metric = $autoMetricsById->get($metricId);
                if (! $metric && $metricCode !== '') {
                    $metric = $autoMetricsByCode->get($metricCode);
                }
                if (! $metric) {
                    return $row;
                }

                if ($this->rowHasExplicitTargetActualValues($row)) {
                    return $row;
                }

                /** @var array<string, mixed>|null $derived */
                $derived = $derivedByCode[(string) $metric->code] ?? null;
                if (! is_array($derived)) {
                    return $row;
                }

                return array_merge($row, [
                    'metric_id' => (int) $metric->id,
                    'metric_code' => (string) $metric->code,
                    'target' => $derived['target'] ?? null,
                    'actual' => $derived['actual'] ?? null,
                    'remarks' => $row['remarks'] ?? ($derived['remarks'] ?? null),
                ]);
            })
            ->filter(static fn (mixed $row): bool => is_array($row))
            ->values();
    }

    /**
     * @param array<string, mixed> $row
     */
    private function rowHasExplicitTargetActualValues(array $row): bool
    {
        return $this->rowValueIsPresent($row['target'] ?? null)
            || $this->rowValueIsPresent($row['actual'] ?? null)
            || $this->rowValueIsPresent($row['target_value'] ?? null)
            || $this->rowValueIsPresent($row['actual_value'] ?? null);
    }

    private function rowValueIsPresent(mixed $value): bool
    {
        if ($value === null) {
            return false;
        }

        if (is_array($value)) {
            if (array_key_exists('values', $value) && is_array($value['values'])) {
                return collect($value['values'])->contains(
                    static fn (mixed $entry): bool => $entry !== null && trim((string) $entry) !== '',
                );
            }

            return collect($value)->contains(
                static fn (mixed $entry): bool => $entry !== null && trim((string) $entry) !== '',
            );
        }

        return trim((string) $value) !== '';
    }

    private function normalizeMetricId(mixed $value): int
    {
        if (! is_numeric($value)) {
            return 0;
        }

        $metricId = (int) $value;

        return $metricId > 0 ? $metricId : 0;
    }

    private function normalizeMetricCode(mixed $value): string
    {
        $metricCode = strtoupper(trim((string) $value));

        return $metricCode !== '' ? $metricCode : '';
    }

    private function isActualOnlyWorkspaceMetric(PerformanceMetric $metric): bool
    {
        return in_array(
            strtoupper(trim((string) $metric->code)),
            GroupBWorkspaceDefinition::metricCodesFor(GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS),
            true,
        );
    }

}
