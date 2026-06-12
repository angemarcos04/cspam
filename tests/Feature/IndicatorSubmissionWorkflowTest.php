<?php

namespace Tests\Feature;

use App\Models\AcademicYear;
use App\Models\FormSubmissionHistory;
use App\Models\IndicatorSubmission;
use App\Models\PerformanceMetric;
use App\Models\School;
use App\Models\Student;
use App\Models\Teacher;
use App\Models\User;
use App\Events\CspamsUpdateBroadcast;
use App\Support\Domain\MetricCategory;
use App\Support\Domain\MetricDataType;
use App\Notifications\IndicatorReviewOutcomeNotification;
use App\Notifications\IndicatorScopeReviewOutcomeNotification;
use App\Support\Indicators\GroupBWorkspaceDefinition;
use App\Support\Indicators\SubmissionFileDefinition;
use Database\Seeders\DemoDataSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;
use Tests\Concerns\InteractsWithSeededCredentials;
use Tests\TestCase;

class IndicatorSubmissionWorkflowTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithSeededCredentials;

    public function test_metrics_endpoint_includes_salo_indicator(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $metrics = $this->withToken($token)->getJson('/api/indicators/metrics');

        $metrics->assertOk()
            ->assertJsonPath('data', function (array $rows): bool {
                foreach ($rows as $row) {
                    if (($row['code'] ?? null) === 'SALO') {
                        return ($row['name'] ?? null) === "School's Achievements and Learning Outcomes";
                    }
                }

                return false;
            });
    }

    public function test_indicator_submission_list_prefers_meaningful_recency_over_id_order(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');

        $olderButFresher = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => [],
        ])->assertCreated();

        $newerButStaler = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'indicators' => [],
        ])->assertCreated();

        $olderId = (string) $olderButFresher->json('data.id');
        $newerId = (string) $newerButStaler->json('data.id');

        $this->assertNotSame($olderId, $newerId);

        \App\Models\IndicatorSubmission::query()->whereKey($olderId)->update([
            'updated_at' => now()->addMinute(),
        ]);
        \App\Models\IndicatorSubmission::query()->whereKey($newerId)->update([
            'updated_at' => now()->subMinute(),
        ]);

        $listed = $this->withToken($token)->getJson('/api/indicators/submissions?per_page=10');

        $listed->assertOk()
            ->assertJsonPath('data.0.id', $olderId)
            ->assertJsonPath('data.1.id', $newerId);
    }

    public function test_auto_calculated_school_achievement_count_overrides_manual_payload_values_when_provided(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $currentSchoolYear = (string) AcademicYear::query()->whereKey($academicYearId)->value('name');
        $expectedStudentTotal = Student::query()
            ->where('school_id', (int) $schoolHead->school_id)
            ->where('academic_year_id', $academicYearId)
            ->count();
        $schoolHeadToken = $schoolHead->createToken('monitor-redaction-school-head')->plainTextToken;
        $enrollmentMetricId = (int) PerformanceMetric::query()->where('code', 'IMETA_ENROLL_TOTAL')->value('id');

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'indicators' => [
                [
                    'metric_id' => $enrollmentMetricId,
                    'target_value' => 999,
                    'actual_value' => 1,
                    'remarks' => 'Manual KPI values encoded by school head.',
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.summary.totalIndicators', 1);

        /** @var array<string, mixed>|null $metricRow */
        $metricRow = collect($created->json('data.indicators', []))
            ->first(static fn (mixed $row): bool => is_array($row) && (($row['metric']['code'] ?? null) === 'IMETA_ENROLL_TOTAL'));

        $this->assertIsArray($metricRow);
        $this->assertSame(
            (float) $expectedStudentTotal,
            (float) data_get($metricRow, "actualTypedValue.values.{$currentSchoolYear}"),
        );
        $this->assertNull(data_get($metricRow, 'targetTypedValue'));
        $this->assertSame('recorded', $metricRow['complianceStatus'] ?? null);
        $this->assertSame('Manual KPI values encoded by school head.', $metricRow['remarks'] ?? null);
    }

    public function test_school_achievement_counts_auto_sync_from_reports_and_teacher_records(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $schoolId = (int) $schoolHead->school_id;
        $this->assertGreaterThan(0, $schoolId);

        School::query()->whereKey($schoolId)->update([
            'reported_student_count' => 1234,
            'reported_teacher_count' => 57,
        ]);

        Teacher::query()->where('school_id', $schoolId)->forceDelete();
        Teacher::query()->create(['school_id' => $schoolId, 'name' => 'Teacher Male 1', 'sex' => 'male']);
        Teacher::query()->create(['school_id' => $schoolId, 'name' => 'Teacher Male 2', 'sex' => 'male']);
        Teacher::query()->create(['school_id' => $schoolId, 'name' => 'Teacher Male 3', 'sex' => 'male']);
        Teacher::query()->create(['school_id' => $schoolId, 'name' => 'Teacher Female 1', 'sex' => 'female']);
        Teacher::query()->create(['school_id' => $schoolId, 'name' => 'Teacher Female 2', 'sex' => 'female']);

        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $currentSchoolYear = (string) AcademicYear::query()->whereKey($academicYearId)->value('name');
        $expectedStudentTotal = Student::query()
            ->where('school_id', $schoolId)
            ->where('academic_year_id', $academicYearId)
            ->count();
        $schoolHeadToken = $schoolHead->createToken('monitor-redaction-school-head')->plainTextToken;

        $metricIds = PerformanceMetric::query()
            ->whereIn('code', ['IMETA_ENROLL_TOTAL', 'TEACHERS_TOTAL', 'TEACHERS_MALE', 'TEACHERS_FEMALE'])
            ->pluck('id', 'code');

        $response = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => [
                ['metric_id' => (int) $metricIds->get('IMETA_ENROLL_TOTAL'), 'target_value' => 1, 'actual_value' => 1],
                ['metric_id' => (int) $metricIds->get('TEACHERS_TOTAL'), 'target_value' => 2, 'actual_value' => 2],
                ['metric_id' => (int) $metricIds->get('TEACHERS_MALE'), 'target_value' => 3, 'actual_value' => 3],
                ['metric_id' => (int) $metricIds->get('TEACHERS_FEMALE'), 'target_value' => 4, 'actual_value' => 4],
            ],
        ]);

        $response->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.summary.totalIndicators', 4);

        $rowsByCode = collect($response->json('data.indicators', []))
            ->keyBy(static fn (array $row): string => (string) data_get($row, 'metric.code', ''));

        $this->assertSame(
            (float) $expectedStudentTotal,
            (float) data_get($rowsByCode->get('IMETA_ENROLL_TOTAL'), "actualTypedValue.values.{$currentSchoolYear}"),
        );
        $this->assertSame(
            57.0,
            (float) data_get($rowsByCode->get('TEACHERS_TOTAL'), "actualTypedValue.values.{$currentSchoolYear}"),
        );
        $this->assertSame(
            3.0,
            (float) data_get($rowsByCode->get('TEACHERS_MALE'), "actualTypedValue.values.{$currentSchoolYear}"),
        );
        $this->assertSame(
            2.0,
            (float) data_get($rowsByCode->get('TEACHERS_FEMALE'), "actualTypedValue.values.{$currentSchoolYear}"),
        );
    }

    public function test_school_head_indicator_workflow_and_monitor_review(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $metrics = PerformanceMetric::query()
            ->whereIn('code', ['SALO', 'PCR_K', 'WASH_RATIO'])
            ->orderByRaw("CASE code WHEN 'SALO' THEN 1 WHEN 'PCR_K' THEN 2 WHEN 'WASH_RATIO' THEN 3 ELSE 4 END")
            ->get();
        $this->assertCount(3, $metrics);

        $schoolHeadToken = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'notes' => 'Quarterly indicator package for monitor review.',
            'indicators' => [
                [
                    'metric_id' => $metrics[0]->id,
                    'target_value' => 80,
                    'actual_value' => 83.5,
                    'remarks' => 'Met through remediation sessions.',
                ],
                [
                    'metric_id' => $metrics[1]->id,
                    'target_value' => 90,
                    'actual_value' => 85,
                    'remarks' => 'Needs intervention.',
                ],
                [
                    'metric_id' => $metrics[2]->id,
                    'target_value' => 75,
                    'actual_value' => 75,
                    'remarks' => 'On target.',
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.formType', 'indicator')
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.reportingPeriod', 'Q1')
            ->assertJsonPath('data.summary.totalIndicators', 3)
            ->assertJsonPath('data.summary.metIndicators', 1)
            ->assertJsonPath('data.summary.belowTargetIndicators', 0)
            ->assertJsonPath('data.summary.recordedIndicators', 2)
            ->assertJsonCount(3, 'data.indicators');

        $submissionId = (string) $created->json('data.id');
        $this->uploadRequiredSubmissionFiles($schoolHeadToken, $submissionId);

        $submitted = $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit");
        $submitted->assertOk()
            ->assertJsonPath('data.status', 'submitted');

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('monitor-redaction-monitor', ['role:monitor'])->plainTextToken;

        $reviewed = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/review", [
            'decision' => 'validated',
            'notes' => 'Indicators validated by division monitor.',
        ]);

        $reviewed->assertOk()
            ->assertJsonPath('data.status', 'validated');

        $this->assertDatabaseHas('notifications', [
            'type' => IndicatorReviewOutcomeNotification::class,
            'notifiable_type' => User::class,
            'notifiable_id' => $schoolHead->id,
        ]);

        $history = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}/history");
        $history->assertOk();
        $actions = collect($history->json('data', []))->pluck('action')->all();
        $this->assertContains('validated', $actions);
        $this->assertContains('submitted', $actions);
        $this->assertContains('generated', $actions);
    }

    public function test_monitor_can_verify_and_return_individual_submission_scopes(): void
    {
        $this->seedIndicatorFixtures();
        Event::fake([CspamsUpdateBroadcast::class]);

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $schoolHeadToken = $schoolHead->createToken('scope-review-test-school-head')->plainTextToken;
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $year = (string) AcademicYear::query()->whereKey($academicYearId)->value('name');
        $metricId = (int) PerformanceMetric::query()->where('code', 'SALO')->value('id');

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => [
                [
                    'metric_id' => $metricId,
                    'target_value' => 1,
                    'actual_value' => 1,
                    'remarks' => 'Ready for review.',
                ],
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [$year => 'Maria Santos']],
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');
        $this->uploadRequiredSubmissionFiles($schoolHeadToken, $submissionId);

        $submitted = $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit");
        $submitted->assertOk()->assertJsonPath('data.status', 'submitted');

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('scope-review-test-monitor', ['role:monitor'])->plainTextToken;
        $verified = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ]);

        $verified->assertOk()
            ->assertJsonPath('data.scopeReviews.0.scopeId', 'bmef')
            ->assertJsonPath('data.scopeReviews.0.decision', 'verified');

        $missingNote = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'smea',
            'decision' => 'returned',
        ]);
        $missingNote->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY);

        $returned = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'smea',
            'decision' => 'returned',
            'notes' => 'Please upload the signed version.',
        ]);

        $returned->assertOk()
            ->assertJsonPath('data.scopeReviews.1.scopeId', 'smea')
            ->assertJsonPath('data.scopeReviews.1.decision', 'returned')
            ->assertJsonPath('data.scopeReviews.1.notes', 'Please upload the signed version.');

        $this->assertDatabaseHas('indicator_submission_scope_reviews', [
            'indicator_submission_id' => $submissionId,
            'scope_id' => 'smea',
            'decision' => 'returned',
        ]);
        $this->assertDatabaseHas('notifications', [
            'type' => IndicatorScopeReviewOutcomeNotification::class,
            'notifiable_type' => User::class,
            'notifiable_id' => $schoolHead->id,
        ]);
        Event::assertDispatched(CspamsUpdateBroadcast::class, function (CspamsUpdateBroadcast $event): bool {
            return ($event->payload['eventType'] ?? null) === 'indicators.scope_returned'
                && ($event->payload['scopeId'] ?? null) === 'smea';
        });
    }

    public function test_school_head_can_bootstrap_minimal_indicator_draft_and_update_it_later(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $metricId = (int) PerformanceMetric::query()->where('code', 'SALO')->value('id');

        $bootstrapped = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);

        $bootstrapped->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.completion.hasImetaFormData', false)
            ->assertJsonMissingPath('data.summary')
            ->assertJsonMissingPath('data.indicators');

        $submissionId = (string) $bootstrapped->json('data.id');

        $updated = $this->withToken($token)->putJson("/api/indicators/submissions/{$submissionId}", [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'notes' => 'Filled after lightweight bootstrap.',
            'indicators' => [
                [
                    'metric_id' => $metricId,
                    'target_value' => 75,
                    'actual_value' => 80,
                    'remarks' => 'Encoded after bootstrap.',
                ],
            ],
        ]);

        $updated->assertOk()
            ->assertJsonPath('data.id', $submissionId)
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.completion.hasImetaFormData', false)
            ->assertJsonMissingPath('data.summary')
            ->assertJsonMissingPath('data.indicators');
    }

    public function test_indicator_update_broadcast_includes_freshness_and_touched_scope_metadata(): void
    {
        Event::fake([CspamsUpdateBroadcast::class]);
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $metricId = (int) PerformanceMetric::query()->where('code', 'SALO')->value('id');

        $bootstrapped = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ])->assertCreated();

        Event::fake([CspamsUpdateBroadcast::class]);

        $submissionId = (string) $bootstrapped->json('data.id');

        $this->withToken($token)->putJson("/api/indicators/submissions/{$submissionId}", [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'workspace_section' => GroupBWorkspaceDefinition::KEY_PERFORMANCE,
            'indicators' => [
                [
                    'metric_id' => $metricId,
                    'target_value' => 75,
                    'actual_value' => 80,
                    'remarks' => 'Encoded after bootstrap.',
                ],
            ],
        ])->assertOk();

        Event::assertDispatched(CspamsUpdateBroadcast::class, function (CspamsUpdateBroadcast $event) use ($submissionId, $academicYearId): bool {
            return $event->payload['eventType'] === 'indicators.updated'
                && $event->payload['submissionId'] === $submissionId
                && $event->payload['academicYearId'] === (string) $academicYearId
                && $event->payload['status'] === 'draft'
                && $event->payload['version'] === 1
                && is_string($event->payload['updatedAt'] ?? null)
                && ($event->payload['touchedScopes'] ?? null) === [GroupBWorkspaceDefinition::KEY_PERFORMANCE];
        });
    }

    public function test_indicator_workspace_reset_broadcast_includes_freshness_and_touched_scope_metadata(): void
    {
        Event::fake([CspamsUpdateBroadcast::class]);
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $bootstrapped = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ])->assertCreated();

        Event::fake([CspamsUpdateBroadcast::class]);

        $submissionId = (string) $bootstrapped->json('data.id');

        $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/reset-workspace", [
            'workspace' => SubmissionFileDefinition::nonCoreTypes()[0],
        ])->assertOk();

        Event::assertDispatched(CspamsUpdateBroadcast::class, function (CspamsUpdateBroadcast $event) use ($submissionId, $academicYearId): bool {
            $workspace = SubmissionFileDefinition::nonCoreTypes()[0];

            return $event->payload['eventType'] === 'indicators.workspace_reset'
                && $event->payload['submissionId'] === $submissionId
                && $event->payload['academicYearId'] === (string) $academicYearId
                && $event->payload['status'] === 'draft'
                && $event->payload['version'] === 1
                && is_string($event->payload['updatedAt'] ?? null)
                && ($event->payload['workspace'] ?? null) === $workspace
                && ($event->payload['touchedScopes'] ?? null) === [$workspace];
        });
    }

    public function test_public_school_required_submission_files_only_include_core_documents(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        School::query()->whereKey($schoolHead->school_id)->update(['type' => 'public']);

        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $bootstrapped = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);

        $bootstrapped->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.schoolId', (string) $schoolHead->school_id)
            ->assertJsonPath('data.schoolType', 'public')
            ->assertJsonMissingPath('data.indicators')
            ->assertJsonPath('data.completion.requiredFileTypes', ['bmef', 'smea'])
            ->assertJsonPath('data.completion.missingFileTypes', ['bmef', 'smea'])
            ->assertJsonPath('data.completion.uploadedFileTypes', [])
            ->assertJsonPath('data.presentation.activeWorkspaceFileTypes', ['bmef', 'smea'])
            ->assertJsonPath('data.presentation.secondaryHistoricalFileTypes', []);
    }

    public function test_private_school_required_submission_files_only_include_private_fm_qad_tabs(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        School::query()->whereKey($schoolHead->school_id)->update(['type' => 'private']);

        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $bootstrapped = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);

        $bootstrapped->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.schoolId', (string) $schoolHead->school_id)
            ->assertJsonPath('data.schoolType', 'private')
            ->assertJsonMissingPath('data.indicators')
            ->assertJsonCount(count(SubmissionFileDefinition::nonCoreTypes()), 'data.completion.requiredFileTypes')
            ->assertJsonPath('data.presentation.activeWorkspaceFileTypes', SubmissionFileDefinition::nonCoreTypes())
            ->assertJsonPath('data.presentation.secondaryHistoricalFileTypes', []);

        $requiredFileTypes = $bootstrapped->json('data.completion.requiredFileTypes', []);
        $this->assertSame(SubmissionFileDefinition::nonCoreTypes(), $requiredFileTypes);
        $this->assertContains('fm_qad_001', $requiredFileTypes);
        $this->assertContains('fm_qad_041', $requiredFileTypes);
        $this->assertNotContains('bmef', $requiredFileTypes);
        $this->assertNotContains('smea', $requiredFileTypes);
    }

    public function test_store_response_uses_private_school_requirements_immediately(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        School::query()->whereKey($schoolHead->school_id)->update(['type' => 'private']);

        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $metricId = (int) PerformanceMetric::query()->where('code', 'SALO')->value('id');

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'indicators' => [
                [
                    'metric_id' => $metricId,
                    'target_value' => 80,
                    'actual_value' => 82,
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.schoolId', (string) $schoolHead->school_id)
            ->assertJsonPath('data.schoolType', 'private')
            ->assertJsonPath('data.school.type', 'private')
            ->assertJsonCount(count(SubmissionFileDefinition::nonCoreTypes()), 'data.completion.requiredFileTypes')
            ->assertJsonPath('data.presentation.activeReportFileTypes', SubmissionFileDefinition::nonCoreTypes())
            ->assertJsonPath('data.presentation.activeWorkspaceFileTypes', SubmissionFileDefinition::nonCoreTypes())
            ->assertJsonPath('data.presentation.secondaryHistoricalFileTypes', [])
            ->assertJsonPath('data.files.bmef.uploaded', false)
            ->assertJsonPath('data.files.smea.uploaded', false)
            ->assertJsonPath('data.files.fm_qad_001.uploaded', false)
            ->assertJsonPath('data.files.fm_qad_041.uploaded', false);

        $requiredFileTypes = $created->json('data.completion.requiredFileTypes', []);
        $this->assertSame(SubmissionFileDefinition::nonCoreTypes(), $requiredFileTypes);
    }

    public function test_private_submission_presentation_contract_marks_legacy_core_uploads_as_secondary_historical_files(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        School::query()->whereKey($schoolHead->school_id)->update(['type' => 'private']);

        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);

        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');

        $this->uploadSubmissionDocument($token, $submissionId, 'bmef', 'bmef-report.pdf', 'application/pdf')
            ->assertOk();
        $this->uploadSubmissionDocument(
            $token,
            $submissionId,
            'fm_qad_001',
            'fm-qad-001.pdf',
            'application/pdf',
        )->assertOk();

        $fetched = $this->withToken($token)->getJson("/api/indicators/submissions/{$submissionId}");

        $fetched->assertOk()
            ->assertJsonPath('data.presentation.activeWorkspaceFileTypes', SubmissionFileDefinition::nonCoreTypes())
            ->assertJsonPath('data.presentation.activeReportFileTypes', SubmissionFileDefinition::nonCoreTypes())
            ->assertJsonPath('data.presentation.secondaryHistoricalFileTypes', ['bmef']);

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('private-secondary-history-monitor', ['role:monitor'])->plainTextToken;
        $monitorFetched = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");

        $monitorFetched->assertOk()
            ->assertJsonPath('data.presentation.activeWorkspaceFileTypes', SubmissionFileDefinition::nonCoreTypes())
            ->assertJsonPath('data.presentation.activeReportFileTypes', SubmissionFileDefinition::nonCoreTypes())
            ->assertJsonPath('data.presentation.secondaryHistoricalFileTypes', [])
            ->assertJsonPath('data.files.bmef.uploaded', false)
            ->assertJsonPath('data.files.fm_qad_001.uploaded', false);
    }

    public function test_updating_indicator_draft_returns_lightweight_submission_resource(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $metricId = (int) PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->value('id');

        $created = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);

        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');

        $updated = $this->withToken($token)->putJson("/api/indicators/submissions/{$submissionId}", [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => [
                [
                    'metric_id' => $metricId,
                    'actual' => [
                        'values' => [
                            '2026-2027' => 'Dr. Elena Cruz',
                        ],
                    ],
                ],
            ],
        ]);

        $updated->assertOk()
            ->assertJsonPath('data.id', $submissionId)
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.schoolId', (string) $schoolHead->school_id)
            ->assertJsonPath('data.academicYearId', (string) $academicYearId)
            ->assertJsonPath('data.academicYear.id', (string) $academicYearId)
            ->assertJsonPath('data.academicYear.name', null)
            ->assertJsonMissingPath('data.indicators')
            ->assertJsonMissingPath('data.summary');
    }

    public function test_school_head_cannot_submit_other_schools_indicator_package(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHeadOne */
        $schoolHeadOne = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        /** @var User $schoolHeadTwo */
        $schoolHeadTwo = User::query()->where('email', 'schoolhead2@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $metricId = (int) PerformanceMetric::query()->where('is_active', true)->value('id');

        $tokenOne = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHeadOne));
        $created = $this->withToken($tokenOne)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'indicators' => [
                [
                    'metric_id' => $metricId,
                    'target_value' => 88,
                    'actual_value' => 90,
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');

        $tokenTwo = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHeadTwo));
        $forbidden = $this->withToken($tokenTwo)->postJson("/api/indicators/submissions/{$submissionId}/submit");
        $forbidden->assertStatus(Response::HTTP_FORBIDDEN);
    }

    public function test_school_head_cannot_access_other_public_schools_indicator_submission_surfaces(): void
    {
        $this->assertSchoolHeadCannotAccessOtherSchoolsIndicatorSubmissionSurfaces(
            ownerEmail: 'schoolhead1@cspams.local',
            outsiderEmail: 'schoolhead2@cspams.local',
            ownerSchoolType: 'public',
            fileType: 'bmef',
            filename: 'bmef-report.pdf',
            mimeType: 'application/pdf',
        );
    }

    public function test_school_head_cannot_access_other_private_schools_indicator_submission_surfaces(): void
    {
        $this->assertSchoolHeadCannotAccessOtherSchoolsIndicatorSubmissionSurfaces(
            ownerEmail: 'schoolhead2@cspams.local',
            outsiderEmail: 'schoolhead1@cspams.local',
            ownerSchoolType: 'private',
            fileType: 'fm_qad_001',
            filename: 'fm-qad-001.pdf',
            mimeType: 'application/pdf',
        );
    }

    public function test_returned_indicator_review_requires_notes_and_resubmission_clears_review_metadata(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $schoolHeadToken = $schoolHead->createToken('monitor-redaction-school-head')->plainTextToken;
        /** @var PerformanceMetric $metric */
        $metric = PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->firstOrFail();
        $year = (string) collect($metric->input_schema['years'] ?? [])->first();

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'indicators' => [
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [$year => 'Maria Santos']],
                ],
            ],
        ]);
        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');
        $this->uploadRequiredSubmissionFiles($schoolHeadToken, $submissionId);

        $this->withToken($schoolHeadToken)
            ->postJson("/api/indicators/submissions/{$submissionId}/submit")
            ->assertOk();

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('monitor-redaction-monitor', ['role:monitor'])->plainTextToken;

        $missingNotes = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/review", [
            'decision' => 'returned',
        ]);
        $missingNotes->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['notes']);

        $returned = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/review", [
            'decision' => 'returned',
            'notes' => 'Please update Q1 values and remarks.',
        ]);
        $returned->assertOk()
            ->assertJsonPath('data.status', 'returned')
            ->assertJsonPath('data.reviewNotes', 'Please update Q1 values and remarks.')
            ->assertJsonPath('data.reviewedAt', fn (?string $value): bool => $value !== null);

        $resubmitted = $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit");
        $resubmitted->assertOk()
            ->assertJsonPath('data.status', 'submitted')
            ->assertJsonPath('data.reviewNotes', null)
            ->assertJsonPath('data.reviewedAt', null);
    }

    public function test_school_head_can_submit_annual_compliance_matrix_values(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $schoolHeadToken = $schoolHead->createToken('monitor-redaction-kpi-school-head')->plainTextToken;

        $headNameMetricId = (int) PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->value('id');
        $sbmMetricId = (int) PerformanceMetric::query()->where('code', 'IMETA_SBM_LEVEL')->value('id');
        $internetMetricId = (int) PerformanceMetric::query()->where('code', 'INTERNET_ACCESS')->value('id');
        $incomeMetricId = (int) PerformanceMetric::query()->where('code', 'CANTEEN_INCOME')->value('id');
        $matrixYear = '2026-2027';

        $response = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'notes' => 'Annual I-META compliance update.',
            'indicators' => [
                [
                    'metric_id' => $headNameMetricId,
                    'target' => [
                        'values' => [
                            $matrixYear => 'Ma. Teresa Dela Cruz',
                        ],
                    ],
                    'actual' => [
                        'values' => [
                            $matrixYear => 'Ma. Teresa Dela Cruz',
                        ],
                    ],
                ],
                [
                    'metric_id' => $sbmMetricId,
                    'target' => [
                        'values' => [
                            $matrixYear => 'Level 2',
                        ],
                    ],
                    'actual' => [
                        'values' => [
                            $matrixYear => 'Level 2',
                        ],
                    ],
                ],
                [
                    'metric_id' => $internetMetricId,
                    'target' => [
                        'values' => [
                            $matrixYear => true,
                        ],
                    ],
                    'actual' => [
                        'values' => [
                            $matrixYear => true,
                        ],
                    ],
                ],
                [
                    'metric_id' => $incomeMetricId,
                    'target' => [
                        'values' => [
                            $matrixYear => 100000,
                        ],
                    ],
                    'actual' => [
                        'values' => [
                            $matrixYear => 125000,
                        ],
                    ],
                ],
            ],
        ]);

        $response->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.reportingPeriod', 'ANNUAL')
            ->assertJsonPath('data.summary.totalIndicators', 4)
            ->assertJsonPath('data.summary.metIndicators', 0)
            ->assertJsonPath('data.summary.belowTargetIndicators', 0)
            ->assertJsonPath('data.summary.recordedIndicators', 4)
            ->assertJsonPath('data.indicators.0.targetDisplay', '-')
            ->assertJsonPath('data.indicators.0.targetTypedValue', null)
            ->assertJsonPath('data.indicators.0.actualDisplay', fn (?string $value): bool => is_string($value) && $value !== '');
    }

    public function test_school_head_can_update_existing_draft_submission(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $year = (string) AcademicYear::query()->whereKey($academicYearId)->value('name');
        $metric = PerformanceMetric::query()->create([
            'code' => 'MANUAL_UPDATE_GE',
            'name' => 'Manual Update GE',
            'category' => MetricCategory::LEARNER->value,
            'framework' => 'targets_met',
            'data_type' => MetricDataType::YEARLY_MATRIX->value,
            'input_schema' => [
                'years' => [$year],
                'valueType' => 'percentage',
                'comparison' => 'greater_or_equal',
            ],
            'sort_order' => 9993,
            'is_active' => true,
        ]);

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'notes' => 'Original draft note.',
            'indicators' => [
                [
                    'metric_id' => (int) $metric->id,
                    'target' => ['values' => [$year => 80]],
                    'actual' => ['values' => [$year => 81]],
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.status', 'draft');

        $submissionId = (string) $created->json('data.id');

        $updated = $this->withToken($token)->putJson("/api/indicators/submissions/{$submissionId}", [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'notes' => 'Updated draft note.',
            'indicators' => [
                [
                    'metric_id' => (int) $metric->id,
                    'target' => ['values' => [$year => 90]],
                    'actual' => ['values' => [$year => 92]],
                ],
            ],
        ]);

        $updated->assertOk()
            ->assertJsonPath('data.id', $submissionId)
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.notes', 'Updated draft note.')
            ->assertJsonMissingPath('data.indicators')
            ->assertJsonMissingPath('data.summary');

        $show = $this->withToken($token)->getJson("/api/indicators/submissions/{$submissionId}");
        $show->assertOk()
            ->assertJsonPath('data.indicators.0.metric.code', 'MANUAL_UPDATE_GE')
            ->assertJsonPath("data.indicators.0.targetTypedValue.values.{$year}", 90)
            ->assertJsonPath("data.indicators.0.actualTypedValue.values.{$year}", 92)
            ->assertJsonPath('data.indicators.0.targetValue', 90)
            ->assertJsonPath('data.indicators.0.actualValue', 92);

        $history = $this->withToken($token)->getJson("/api/indicators/submissions/{$submissionId}/history");
        $history->assertOk()
            ->assertJsonPath('data.0.action', 'updated');
    }

    public function test_group_b_workspace_metric_codes_exist_after_seeding(): void
    {
        $this->seedIndicatorFixtures();

        $codes = array_values(array_unique(array_merge(
            GroupBWorkspaceDefinition::metricCodesFor(GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS),
            GroupBWorkspaceDefinition::metricCodesFor(GroupBWorkspaceDefinition::KEY_PERFORMANCE),
        )));

        $seededCodes = PerformanceMetric::query()
            ->whereIn('code', $codes)
            ->pluck('code')
            ->all();

        sort($codes);
        sort($seededCodes);

        $this->assertSame($codes, $seededCodes);
    }

    public function test_auto_calculated_kpi_still_resolves_with_real_metric_id(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        /** @var PerformanceMetric $metric */
        $metric = PerformanceMetric::query()->where('code', 'PR')->firstOrFail();
        $year = (string) collect($metric->input_schema['years'] ?? [])->first();

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'indicators' => [
                [
                    'metric_id' => (int) $metric->id,
                    'target' => ['values' => [$year => 91]],
                    'actual' => ['values' => [$year => 93]],
                ],
            ],
        ]);

        $expectedSeries = app(\App\Support\Indicators\TargetsMetAutoCalculator::class)
            ->deriveMatricesForSchool((int) $schoolHead->school_id);
        $expectedActual = data_get($expectedSeries, "PR.actual.values.{$year}");
        $expectedTarget = data_get($expectedSeries, "PR.target.values.{$year}");

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.indicators.0.metric.id', (string) $metric->id)
            ->assertJsonPath('data.indicators.0.metric.code', 'PR');

        $this->assertSame(
            (float) $expectedActual,
            (float) $created->json("data.indicators.0.actualTypedValue.values.{$year}"),
        );
        $this->assertSame(
            (float) $expectedTarget,
            (float) $created->json("data.indicators.0.targetTypedValue.values.{$year}"),
        );
    }

    public function test_auto_calculated_kpi_still_resolves_with_metric_code_only(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        /** @var PerformanceMetric $metric */
        $metric = PerformanceMetric::query()->where('code', 'NER')->firstOrFail();
        $year = (string) collect($metric->input_schema['years'] ?? [])->first();

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'indicators' => [
                [
                    'metric_code' => 'ner',
                    'target' => ['values' => [$year => 95]],
                    'actual' => ['values' => [$year => 97]],
                ],
            ],
        ]);

        $expectedSeries = app(\App\Support\Indicators\TargetsMetAutoCalculator::class)
            ->deriveMatricesForSchool((int) $schoolHead->school_id);
        $expectedActual = data_get($expectedSeries, "NER.actual.values.{$year}");
        $expectedTarget = data_get($expectedSeries, "NER.target.values.{$year}");

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.indicators.0.metric.code', 'NER')
            ->assertJsonPath("data.indicators.0.actualTypedValue.values.{$year}", fn (mixed $value): bool => (float) $value === (float) $expectedActual)
            ->assertJsonPath("data.indicators.0.targetTypedValue.values.{$year}", fn (mixed $value): bool => (float) $value === (float) $expectedTarget);
    }

    public function test_synthetic_metric_id_with_metric_code_resolves_real_metric(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $realMetricId = (int) PerformanceMetric::query()->where('code', 'CR')->value('id');
        /** @var PerformanceMetric $metric */
        $metric = PerformanceMetric::query()->where('code', 'CR')->firstOrFail();
        $year = (string) collect($metric->input_schema['years'] ?? [])->first();

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'indicators' => [
                [
                    'metric_id' => 900123,
                    'metric_code' => 'CR',
                    'target' => ['values' => [$year => 88]],
                    'actual' => ['values' => [$year => 91]],
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.indicators.0.metric.id', (string) $realMetricId)
            ->assertJsonPath('data.indicators.0.metric.code', 'CR');

        $submissionId = (string) $created->json('data.id');
        $this->assertDatabaseHas('indicator_submission_items', [
            'indicator_submission_id' => (int) $submissionId,
            'performance_metric_id' => $realMetricId,
        ]);
    }

    public function test_school_achievements_actual_only_typed_values_persist(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        /** @var PerformanceMetric $headNameMetric */
        $headNameMetric = PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->firstOrFail();
        $year = (string) collect($headNameMetric->input_schema['years'] ?? [])->first();

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => [
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [$year => 'Maria Santos']],
                ],
                [
                    'metric_code' => 'IMETA_SBM_LEVEL',
                    'actual' => ['values' => [$year => 'Level 2']],
                ],
                [
                    'metric_code' => 'INTERNET_ACCESS',
                    'actual' => ['values' => [$year => true]],
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.summary.totalIndicators', 3)
            ->assertJsonPath('data.summary.metIndicators', 0)
            ->assertJsonPath('data.summary.belowTargetIndicators', 0)
            ->assertJsonPath('data.summary.recordedIndicators', 3)
            ->assertJsonPath('data.indicators.0.targetValue', null)
            ->assertJsonPath('data.indicators.0.varianceValue', null)
            ->assertJsonPath('data.indicators.0.targetTypedValue', null)
            ->assertJsonPath('data.indicators.0.targetDisplay', '-')
            ->assertJsonPath("data.indicators.0.actualTypedValue.values.{$year}", 'Maria Santos')
            ->assertJsonPath('data.indicators.0.complianceStatus', 'recorded')
            ->assertJsonPath("data.indicators.1.actualTypedValue.values.{$year}", 'Level 2')
            ->assertJsonPath('data.indicators.1.complianceStatus', 'recorded')
            ->assertJsonPath("data.indicators.2.actualTypedValue.values.{$year}", true);
    }

    public function test_unresolved_metric_code_returns_clear_validation_error(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $response = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'indicators' => [
                [
                    'metric_id' => 900999,
                    'metric_code' => 'UNKNOWN_CODE',
                    'target_value' => 1,
                    'actual_value' => 1,
                ],
            ],
        ]);

        $response->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['indicators'])
            ->assertJsonPath('errors.indicators.0', fn (string $message): bool => str_contains($message, 'UNKNOWN_CODE'));
    }

    public function test_key_performance_target_and_actual_values_persist_with_metric_code(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $year = (string) AcademicYear::query()->whereKey($academicYearId)->value('name');
        $metric = PerformanceMetric::query()->create([
            'code' => 'MANUAL_KPI_GE',
            'name' => 'Manual KPI GE',
            'category' => MetricCategory::LEARNER->value,
            'framework' => 'targets_met',
            'data_type' => MetricDataType::YEARLY_MATRIX->value,
            'input_schema' => [
                'years' => [$year],
                'valueType' => 'percentage',
                'comparison' => 'greater_or_equal',
            ],
            'sort_order' => 9991,
            'is_active' => true,
        ]);

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'indicators' => [
                [
                    'metric_code' => 'MANUAL_KPI_GE',
                    'target' => ['values' => [$year => 96]],
                    'actual' => ['values' => [$year => 94]],
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.indicators.0.metric.code', 'MANUAL_KPI_GE')
            ->assertJsonPath("data.indicators.0.targetTypedValue.values.{$year}", 96)
            ->assertJsonPath("data.indicators.0.actualTypedValue.values.{$year}", 94)
            ->assertJsonPath('data.indicators.0.complianceStatus', 'below_target');
    }

    public function test_less_or_equal_kpi_uses_not_exceeding_target_comparison(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $year = (string) AcademicYear::query()->whereKey($academicYearId)->value('name');
        $metric = PerformanceMetric::query()->create([
            'code' => 'MANUAL_KPI_LEQ',
            'name' => 'Manual KPI LEQ',
            'category' => MetricCategory::LEARNER->value,
            'framework' => 'targets_met',
            'data_type' => MetricDataType::YEARLY_MATRIX->value,
            'input_schema' => [
                'years' => [$year],
                'valueType' => 'percentage',
                'comparison' => 'less_or_equal',
            ],
            'sort_order' => 9992,
            'is_active' => true,
        ]);

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'indicators' => [
                [
                    'metric_code' => 'MANUAL_KPI_LEQ',
                    'target' => ['values' => [$year => 2]],
                    'actual' => ['values' => [$year => 4]],
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.indicators.0.metric.code', 'MANUAL_KPI_LEQ')
            ->assertJsonPath('data.indicators.0.complianceStatus', 'below_target');
    }

    public function test_yearly_integer_matrix_display_omits_forced_decimal_places(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $year = (string) AcademicYear::query()->whereKey($academicYearId)->value('name');

        $metric = PerformanceMetric::query()->create([
            'code' => 'MANUAL_INTEGER_MATRIX',
            'name' => 'Manual Integer Matrix',
            'category' => MetricCategory::COMPLIANCE->value,
            'framework' => 'i_meta',
            'data_type' => MetricDataType::YEARLY_MATRIX->value,
            'input_schema' => [
                'years' => [$year],
                'valueType' => 'integer',
                'comparison' => 'greater_or_equal',
            ],
            'sort_order' => 9993,
            'is_active' => true,
        ]);

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => [
                [
                    'metric_code' => 'MANUAL_INTEGER_MATRIX',
                    'target' => ['values' => [$year => 1500]],
                    'actual' => ['values' => [$year => 1515]],
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.indicators.0.metric.code', 'MANUAL_INTEGER_MATRIX')
            ->assertJsonPath('data.indicators.0.targetDisplay', "{$year}: 1,500")
            ->assertJsonPath('data.indicators.0.actualDisplay', "{$year}: 1,515");
    }

    public function test_submit_fails_when_bmef_and_smea_are_missing_even_if_group_b_values_exist(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        /** @var PerformanceMetric $metric */
        $metric = PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->firstOrFail();
        $year = (string) collect($metric->input_schema['years'] ?? [])->first();

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => [
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [$year => 'Maria Santos']],
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.completion.hasImetaFormData', true);

        $submissionId = (string) $created->json('data.id');

        $submitted = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit");
        $submitted->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['submission'])
            ->assertJsonPath('errors.submission.0', fn (string $message): bool =>
                str_contains($message, 'BMEF file') && str_contains($message, 'SMEA file')
            );
    }

    public function test_private_school_submit_succeeds_with_private_fm_qad_files_without_bmef_and_smea(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        School::query()->whereKey($schoolHead->school_id)->update(['type' => 'private']);

        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        /** @var PerformanceMetric $metric */
        $metric = PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->firstOrFail();
        $year = (string) collect($metric->input_schema['years'] ?? [])->first();

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => [
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [$year => 'Maria Santos']],
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.schoolType', 'private')
            ->assertJsonPath('data.completion.hasImetaFormData', true);

        $submissionId = (string) $created->json('data.id');
        $this->uploadSubmissionFiles($token, $submissionId, SubmissionFileDefinition::nonCoreTypes());

        $submitted = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit");
        $submitted->assertOk()
            ->assertJsonPath('data.status', 'submitted')
            ->assertJsonPath('data.completion.isComplete', true)
            ->assertJsonPath('data.completion.missingFileTypes', []);
    }

    public function test_private_school_can_submit_a_single_fm_qad_scope_without_other_private_files(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        School::query()->whereKey($schoolHead->school_id)->update(['type' => 'private']);

        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);
        $created->assertCreated();

        $submissionId = (string) $created->json('data.id');
        $this->uploadSubmissionDocument($token, $submissionId, 'fm_qad_001', 'fm-qad-001.pdf', 'application/pdf')
            ->assertOk();

        $scoped = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['fm_qad_001'],
        ]);

        $scoped->assertOk()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.scopeProgress.submittedScopeIds', fn (array $ids): bool => in_array('fm_qad_001', $ids, true))
            ->assertJsonPath('data.scopeProgress.submittedRequiredScopeCount', 1);

        $finalSubmit = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit");
        $finalSubmit->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['submission']);
    }

    public function test_public_school_can_submit_bmef_scope_without_smea_being_uploaded_yet(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);
        $created->assertCreated();

        $submissionId = (string) $created->json('data.id');
        $this->uploadSubmissionDocument($token, $submissionId, 'bmef', 'bmef.pdf', 'application/pdf')
            ->assertOk();

        $scoped = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ]);

        $scoped->assertOk()
            ->assertJsonPath('data.scopeProgress.submittedScopeIds', fn (array $ids): bool => in_array('bmef', $ids, true))
            ->assertJsonPath('data.scopeProgress.pendingScopeIds', fn (array $ids): bool => in_array('smea', $ids, true));
    }

    public function test_monitor_can_review_sent_draft_scope_but_not_unsent_draft_scope(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $schoolHeadToken = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);
        $created->assertCreated();

        $submissionId = (string) $created->json('data.id');
        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef.pdf', 'application/pdf')
            ->assertOk();

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('sent-draft-scope-review-monitor', ['role:monitor'])->plainTextToken;

        $unsentReview = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ]);
        $unsentReview->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['submission']);

        $scoped = $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ]);
        $scoped->assertOk()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.scopeProgress.submittedScopeIds', fn (array $ids): bool => in_array('bmef', $ids, true));

        $sentReview = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ]);
        $sentReview->assertOk()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.scopeReviews.0.scopeId', 'bmef')
            ->assertJsonPath('data.scopeReviews.0.decision', 'verified');
    }

    public function test_monitor_cannot_review_returned_scope_edits_until_school_head_resends(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $schoolHeadToken = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);
        $created->assertCreated();

        $submissionId = (string) $created->json('data.id');
        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef-original.pdf', 'application/pdf')
            ->assertOk();

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk()
            ->assertJsonPath('data.scopeProgress.submittedScopeIds', fn (array $ids): bool => in_array('bmef', $ids, true));

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('returned-scope-resend-review-monitor', ['role:monitor'])->plainTextToken;

        $returned = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'returned',
            'notes' => 'Upload the signed BMEF copy.',
        ]);
        $returned->assertOk()
            ->assertJsonPath('data.scopeReviews.0.scopeId', 'bmef')
            ->assertJsonPath('data.scopeReviews.0.decision', 'returned');

        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef-revised.pdf', 'application/pdf')
            ->assertOk();

        $monitorShowReturnedEdit = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $monitorShowReturnedEdit->assertOk()
            ->assertJsonPath('data.files.bmef.uploaded', false)
            ->assertJsonPath('data.files.bmef.originalFilename', null)
            ->assertJsonPath('data.files.bmef.viewUrl', null)
            ->assertJsonPath('data.files.bmef.downloadUrl', null);

        $unsentReturnedEdit = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ]);
        $unsentReturnedEdit->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['submission'])
            ->assertJsonPath('errors.submission.0', 'Only sent indicator scopes can be reviewed.');

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk()
            ->assertJsonPath('data.scopeProgress.submittedScopeIds', fn (array $ids): bool => in_array('bmef', $ids, true));

        $monitorShowResentEdit = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $monitorShowResentEdit->assertOk()
            ->assertJsonPath('data.files.bmef.uploaded', true)
            ->assertJsonPath('data.files.bmef.originalFilename', 'bmef-revised.pdf')
            ->assertJsonPath('data.files.bmef.viewUrl', "/api/submissions/{$submissionId}/view/bmef")
            ->assertJsonPath('data.files.bmef.downloadUrl', "/api/submissions/{$submissionId}/download/bmef");

        $resentReview = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ]);
        $resentReview->assertOk()
            ->assertJsonPath('data.scopeReviews.0.scopeId', 'bmef')
            ->assertJsonPath('data.scopeReviews.0.decision', 'verified');
    }

    public function test_private_school_can_submit_multiple_ready_fm_qad_scopes_in_one_batch(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        School::query()->whereKey($schoolHead->school_id)->update(['type' => 'private']);

        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);
        $created->assertCreated();

        $submissionId = (string) $created->json('data.id');
        $this->uploadSubmissionDocument($token, $submissionId, 'fm_qad_001', 'fm-qad-001.pdf', 'application/pdf')
            ->assertOk();
        $this->uploadSubmissionDocument($token, $submissionId, 'fm_qad_002', 'fm-qad-002.pdf', 'application/pdf')
            ->assertOk();

        $scoped = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['fm_qad_001', 'fm_qad_002'],
        ]);

        $scoped->assertOk()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.scopeProgress.submittedScopeIds', fn (array $ids): bool => in_array('fm_qad_001', $ids, true) && in_array('fm_qad_002', $ids, true))
            ->assertJsonPath('data.scopeProgress.submittedRequiredScopeCount', 2);
    }

    public function test_school_head_partial_section_submit_validates_only_the_selected_section_scope(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        /** @var PerformanceMetric $metric */
        $metric = PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->firstOrFail();
        $year = (string) collect($metric->input_schema['years'] ?? [])->first();

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => [
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [$year => 'Maria Santos']],
                ],
            ],
        ]);
        $created->assertCreated();

        $submissionId = (string) $created->json('data.id');
        $scoped = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => [GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS],
        ]);

        $scoped->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['targets'])
            ->assertJsonPath('errors.targets.0', 'Submission scope is incomplete. Missing: School Achievements section.');

        $invalidKpi = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => [GroupBWorkspaceDefinition::KEY_PERFORMANCE],
        ]);

        $invalidKpi->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['targets']);
    }

    public function test_submit_with_group_b_values_and_uploaded_files_returns_full_submission_resource(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        /** @var PerformanceMetric $metric */
        $metric = PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->firstOrFail();
        $year = (string) collect($metric->input_schema['years'] ?? [])->first();

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => [
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [$year => 'Maria Santos']],
                ],
                [
                    'metric_code' => 'NER',
                    'target' => ['values' => [$year => 0]],
                    'actual' => ['values' => [$year => 0]],
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');

        $this->withToken($token)
            ->postJson("/api/submissions/{$submissionId}/upload-file", [
                'type' => 'bmef',
                'file' => UploadedFile::fake()->create('bmef-report.pdf', 64, 'application/pdf'),
            ])
            ->assertOk()
            ->assertJsonPath('data.files.bmef.uploaded', true)
            ->assertJsonPath('data.files.bmef.viewUrl', "/api/submissions/{$submissionId}/view/bmef");

        $this->withToken($token)
            ->postJson("/api/submissions/{$submissionId}/upload-file", [
                'type' => 'smea',
                'file' => UploadedFile::fake()->create('smea-report.xlsx', 64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
            ])
            ->assertOk()
            ->assertJsonPath('data.files.smea.uploaded', true)
            ->assertJsonPath('data.files.smea.viewUrl', "/api/submissions/{$submissionId}/view/smea");

        $submitted = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit");

        $submitted->assertOk()
            ->assertJsonPath('data.status', 'submitted')
            ->assertJsonPath('data.files.bmef.uploaded', true)
            ->assertJsonPath('data.files.smea.uploaded', true)
            ->assertJsonPath('data.completion.hasImetaFormData', true);

        $this->assertTrue(
            collect($submitted->json('data.indicators', []))->contains(
                static fn (mixed $row): bool =>
                    is_array($row) && data_get($row, "actualTypedValue.values.{$year}") === 'Maria Santos',
            ),
        );

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('monitor-redaction-kpi-monitor', ['role:monitor'])->plainTextToken;
        $monitorShow = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $monitorShow->assertOk()
            ->assertJsonPath('data.status', 'submitted')
            ->assertJsonPath('data.files.bmef.uploaded', true)
            ->assertJsonPath('data.files.smea.uploaded', true)
            ->assertJsonPath('data.files.bmef.viewUrl', "/api/submissions/{$submissionId}/view/bmef")
            ->assertJsonPath('data.files.smea.viewUrl', "/api/submissions/{$submissionId}/view/smea");

        $monitorCodes = collect($monitorShow->json('data.indicators', []))
            ->map(static fn (array $row): string => (string) data_get($row, 'metric.code'))
            ->all();
        $this->assertContains('IMETA_HEAD_NAME', $monitorCodes);
        $this->assertContains('NER', $monitorCodes);
    }

    public function test_view_file_endpoint_returns_inline_response(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        /** @var PerformanceMetric $metric */
        $metric = PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->firstOrFail();
        $year = (string) collect($metric->input_schema['years'] ?? [])->first();

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => [
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [$year => 'Maria Santos']],
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');

        $this->withToken($token)
            ->postJson("/api/submissions/{$submissionId}/upload-file", [
                'type' => 'bmef',
                'file' => UploadedFile::fake()->create('bmef-report.pdf', 64, 'application/pdf'),
            ])
            ->assertOk();

        $view = $this->withToken($token)->get("/api/submissions/{$submissionId}/view/bmef");

        $view->assertOk();
        $this->assertStringContainsString('inline;', (string) $view->headers->get('content-disposition'));
        $this->assertStringContainsString('application/pdf', (string) $view->headers->get('content-type'));
    }

    public function test_fm_qad_upload_view_and_download_work_with_generic_submission_file_flow(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);

        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');

        $upload = $this->uploadSubmissionDocument($token, $submissionId, 'fm_qad_001', 'fm-qad-001.pdf', 'application/pdf');
        $upload->assertOk()
            ->assertJsonMissingPath('data.indicators')
            ->assertJsonPath('data.files.fm_qad_001.uploaded', true)
            ->assertJsonPath('data.files.fm_qad_001.originalFilename', 'fm-qad-001.pdf')
            ->assertJsonPath('data.files.fm_qad_001.viewUrl', "/api/submissions/{$submissionId}/view/fm_qad_001")
            ->assertJsonPath('data.files.fm_qad_001.downloadUrl', "/api/submissions/{$submissionId}/download/fm_qad_001");

        $view = $this->withToken($token)->get("/api/submissions/{$submissionId}/view/fm_qad_001");
        $view->assertOk();
        $this->assertStringContainsString('inline;', (string) $view->headers->get('content-disposition'));

        $download = $this->withToken($token)->get("/api/submissions/{$submissionId}/download/fm_qad_001");
        $download->assertOk();
        $this->assertStringContainsString('attachment;', (string) $download->headers->get('content-disposition'));
    }

    public function test_fm_qad_reset_removes_database_record_storage_file_and_uses_clean_history_labels(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        School::query()->whereKey($schoolHead->school_id)->update(['type' => 'private']);

        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);

        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');

        $upload = $this->uploadSubmissionDocument($token, $submissionId, 'fm_qad_001', 'fm-qad-001.pdf', 'application/pdf');
        $upload->assertOk()
            ->assertJsonPath('data.files.fm_qad_001.uploaded', true);

        $storedPath = (string) \Illuminate\Support\Facades\DB::table('indicator_submission_files')
            ->where('indicator_submission_id', (int) $submissionId)
            ->where('type', 'fm_qad_001')
            ->value('path');
        $this->assertNotSame('', $storedPath);
        Storage::disk('local')->assertExists($storedPath);
        $this->assertDatabaseHas('indicator_submission_files', [
            'indicator_submission_id' => (int) $submissionId,
            'type' => 'fm_qad_001',
            'path' => $storedPath,
        ]);

        $this->uploadSubmissionDocument($token, $submissionId, 'fm_qad_002', 'fm-qad-002.pdf', 'application/pdf')
            ->assertOk()
            ->assertJsonPath('data.files.fm_qad_002.uploaded', true);

        $reset = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/reset-workspace", [
            'workspace' => 'fm_qad_001',
        ]);

        $reset->assertOk()
            ->assertJsonPath('data.files.fm_qad_001.uploaded', false)
            ->assertJsonPath('data.files.fm_qad_001.path', null)
            ->assertJsonPath('data.files.fm_qad_002.uploaded', true)
            ->assertJsonPath('data.files.fm_qad_002.originalFilename', 'fm-qad-002.pdf')
            ->assertJsonPath('data.files.fm_qad_002.path', null);

        Storage::disk('local')->assertMissing($storedPath);
        $this->assertDatabaseMissing('indicator_submission_files', [
            'indicator_submission_id' => (int) $submissionId,
            'type' => 'fm_qad_001',
        ]);

        $history = $this->withToken($token)->getJson("/api/indicators/submissions/{$submissionId}/history");
        $history->assertOk();
        $historyNotes = collect($history->json('data', []))->pluck('notes')->filter()->all();
        $this->assertContains('FM-QAD-001 file uploaded or replaced.', $historyNotes);
        $this->assertContains('FM-QAD-001 workspace was reset.', $historyNotes);
    }

    public function test_invalid_submission_file_type_fails_validation(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);

        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');

        $invalid = $this->withToken($token)->postJson("/api/submissions/{$submissionId}/upload-file", [
            'type' => 'fm_qad_999',
            'file' => UploadedFile::fake()->create('invalid.pdf', 64, 'application/pdf'),
        ]);

        $invalid->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['type']);
    }

    public function test_bmef_and_smea_uploads_still_write_legacy_file_columns(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);

        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');

        $this->uploadSubmissionDocument($token, $submissionId, 'bmef', 'bmef-report.pdf', 'application/pdf')
            ->assertOk()
            ->assertJsonPath('data.files.bmef.uploaded', true);
        $this->uploadSubmissionDocument(
            $token,
            $submissionId,
            'smea',
            'smea-report.xlsx',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )->assertOk()
            ->assertJsonPath('data.files.smea.uploaded', true);

        $this->assertDatabaseHas('indicator_submissions', [
            'id' => (int) $submissionId,
        ]);

        $submissionRow = \App\Models\IndicatorSubmission::query()->findOrFail((int) $submissionId);
        $this->assertNotNull($submissionRow->bmef_file_path);
        $this->assertNotNull($submissionRow->bmef_original_filename);
        $this->assertNotNull($submissionRow->smea_file_path);
        $this->assertNotNull($submissionRow->smea_original_filename);
        Storage::disk('local')->assertExists((string) $submissionRow->bmef_file_path);
        Storage::disk('local')->assertExists((string) $submissionRow->smea_file_path);
    }

    public function test_school_head_save_stays_draft_until_final_submit_makes_it_monitor_reviewable(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        /** @var PerformanceMetric $metric */
        $metric = PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->firstOrFail();
        $year = (string) collect($metric->input_schema['years'] ?? [])->first();

        $created = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);

        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');

        $saved = $this->withToken($token)->putJson("/api/indicators/submissions/{$submissionId}", [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'workspace_section' => GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS,
            'mode' => 'upsert',
            'replace_missing' => false,
            'indicators' => [
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [$year => 'Maria Santos']],
                ],
            ],
        ]);

        $saved->assertOk()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.submittedAt', null);

        $this->assertDatabaseHas('indicator_submissions', [
            'id' => (int) $submissionId,
            'status' => 'draft',
            'submitted_at' => null,
        ]);

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('monitor-redaction-monitor', ['role:monitor'])->plainTextToken;
        $submittedBeforeFinalSubmit = $this->withToken($monitorToken)
            ->getJson('/api/indicators/submissions?status=submitted&per_page=100');
        $submittedBeforeFinalSubmit->assertOk();
        $this->assertFalse(
            collect($submittedBeforeFinalSubmit->json('data', []))->contains(
                static fn (mixed $row): bool => is_array($row) && (string) ($row['id'] ?? '') === $submissionId,
            ),
            'Saved draft appeared in the monitor submitted review list before final submit.',
        );

        $this->uploadRequiredSubmissionFiles($token, $submissionId);

        $submitted = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit");
        $submitted->assertOk()
            ->assertJsonPath('data.status', 'submitted')
            ->assertJsonPath('data.submittedAt', fn (?string $value): bool => $value !== null);

        $submittedAfterFinalSubmit = $this->withToken($monitorToken)
            ->getJson('/api/indicators/submissions?status=submitted&per_page=100');
        $submittedAfterFinalSubmit->assertOk();
        $this->assertTrue(
            collect($submittedAfterFinalSubmit->json('data', []))->contains(
                static fn (mixed $row): bool => is_array($row) && (string) ($row['id'] ?? '') === $submissionId,
            ),
            'Final submitted package did not appear in the monitor submitted review list.',
        );
    }

    public function test_monitor_submission_resource_redacts_unsent_draft_values_until_scope_is_sent(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        /** @var PerformanceMetric $metric */
        $metric = PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->firstOrFail();
        $year = (string) collect($metric->input_schema['years'] ?? [])->first();
        $schoolHeadToken = $schoolHead->createToken('monitor-redaction-kpi-school-head')->plainTextToken;

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => [
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [$year => 'Maria Santos']],
                ],
                [
                    'metric_code' => 'NER',
                    'target' => ['values' => [$year => 100]],
                    'actual' => ['values' => [$year => 95]],
                ],
            ],
        ]);
        $created->assertCreated();
        $submissionId = (string) $created->json('data.id');

        $schoolHeadShow = $this->withToken($schoolHeadToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $schoolHeadShow->assertOk();
        $this->assertTrue(
            collect($schoolHeadShow->json('data.indicators', []))->contains(
                static fn (array $row): bool => data_get($row, 'metric.code') === 'IMETA_HEAD_NAME'
                    && data_get($row, "actualTypedValue.values.{$year}") === 'Maria Santos',
            ),
            'School Head show response did not include their own saved draft value.',
        );

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('monitor-redaction-kpi-monitor', ['role:monitor'])->plainTextToken;
        $monitorShowBeforeSend = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $monitorShowBeforeSend->assertOk()
            ->assertJsonPath('data.summary.totalIndicators', 0)
            ->assertJsonPath('data.completion.hasImetaFormData', false)
            ->assertJsonCount(0, 'data.indicators');

        FormSubmissionHistory::query()->create([
            'form_type' => IndicatorSubmission::FORM_TYPE,
            'submission_id' => (int) $submissionId,
            'school_id' => (int) $schoolHead->school_id,
            'academic_year_id' => $academicYearId,
            'action' => 'scope_submitted',
            'from_status' => 'draft',
            'to_status' => 'draft',
            'actor_id' => $schoolHead->id,
            'metadata' => ['targets' => [GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS]],
            'created_at' => now(),
        ]);

        $monitorShowAfterSend = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $monitorShowAfterSend->assertOk();
        $monitorCodes = collect($monitorShowAfterSend->json('data.indicators', []))
            ->map(static fn (array $row): string => (string) data_get($row, 'metric.code'))
            ->all();

        $this->assertContains('IMETA_HEAD_NAME', $monitorCodes);
        $this->assertNotContains('NER', $monitorCodes);
        $this->assertTrue((bool) $monitorShowAfterSend->json('data.completion.hasImetaFormData'));
    }

    public function test_monitor_submission_resource_exposes_only_sent_kpi_scope(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        /** @var PerformanceMetric $metric */
        $metric = PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->firstOrFail();
        $year = (string) collect($metric->input_schema['years'] ?? [])->first();
        $schoolHeadToken = $schoolHead->createToken('monitor-redaction-file-school-head')->plainTextToken;

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => [
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [$year => 'Maria Santos']],
                ],
                [
                    'metric_code' => 'NER',
                    'target' => ['values' => [$year => 100]],
                    'actual' => ['values' => [$year => 95]],
                ],
            ],
        ]);
        $created->assertCreated();
        $submissionId = (string) $created->json('data.id');

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('monitor-redaction-file-monitor', ['role:monitor'])->plainTextToken;
        $monitorShowBeforeSend = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $monitorShowBeforeSend->assertOk()
            ->assertJsonPath('data.summary.totalIndicators', 0)
            ->assertJsonPath('data.completion.hasImetaFormData', false)
            ->assertJsonCount(0, 'data.indicators');

        FormSubmissionHistory::query()->create([
            'form_type' => IndicatorSubmission::FORM_TYPE,
            'submission_id' => (int) $submissionId,
            'school_id' => (int) $schoolHead->school_id,
            'academic_year_id' => $academicYearId,
            'action' => 'scope_submitted',
            'from_status' => 'draft',
            'to_status' => 'draft',
            'actor_id' => $schoolHead->id,
            'metadata' => ['targets' => [GroupBWorkspaceDefinition::KEY_PERFORMANCE]],
            'created_at' => now(),
        ]);

        $monitorShowAfterSend = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $monitorShowAfterSend->assertOk();
        $monitorCodes = collect($monitorShowAfterSend->json('data.indicators', []))
            ->map(static fn (array $row): string => (string) data_get($row, 'metric.code'))
            ->all();

        $this->assertContains('NER', $monitorCodes);
        $this->assertNotContains('IMETA_HEAD_NAME', $monitorCodes);
        $this->assertTrue((bool) $monitorShowAfterSend->json('data.completion.hasImetaFormData'));
    }

    public function test_monitor_submission_resource_redacts_unsent_draft_file_urls_until_file_scope_is_sent(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $schoolHeadToken = $schoolHead->createToken('monitor-redaction-file-school-head')->plainTextToken;

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);
        $created->assertCreated();
        $submissionId = (string) $created->json('data.id');

        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef-report.pdf', 'application/pdf')
            ->assertOk()
            ->assertJsonPath('data.files.bmef.uploaded', true);

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('monitor-redaction-file-monitor', ['role:monitor'])->plainTextToken;
        $monitorShowBeforeSend = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $monitorShowBeforeSend->assertOk()
            ->assertJsonPath('data.files.bmef.uploaded', false)
            ->assertJsonPath('data.files.bmef.originalFilename', null)
            ->assertJsonPath('data.files.bmef.viewUrl', null)
            ->assertJsonPath('data.files.bmef.downloadUrl', null)
            ->assertJsonPath('data.completion.hasBmefFile', false)
            ->assertJsonPath('data.completion.uploadedFileTypes', []);

        $this->withToken($monitorToken)
            ->get("/api/submissions/{$submissionId}/view/bmef")
            ->assertStatus(Response::HTTP_FORBIDDEN);

        $this->withToken($monitorToken)
            ->get("/api/submissions/{$submissionId}/download/bmef")
            ->assertStatus(Response::HTTP_FORBIDDEN);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();

        $monitorShowAfterSend = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $monitorShowAfterSend->assertOk()
            ->assertJsonPath('data.files.bmef.uploaded', true)
            ->assertJsonPath('data.files.bmef.originalFilename', 'bmef-report.pdf')
            ->assertJsonPath('data.files.bmef.viewUrl', "/api/submissions/{$submissionId}/view/bmef")
            ->assertJsonPath('data.files.bmef.downloadUrl', "/api/submissions/{$submissionId}/download/bmef")
            ->assertJsonPath('data.completion.hasBmefFile', true)
            ->assertJsonPath('data.completion.uploadedFileTypes', ['bmef']);

        $this->withToken($monitorToken)
            ->get("/api/submissions/{$submissionId}/view/bmef")
            ->assertOk();

        $this->withToken($monitorToken)
            ->get("/api/submissions/{$submissionId}/download/bmef")
            ->assertOk();
    }

    public function test_submitted_indicator_submission_cannot_be_updated(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        /** @var PerformanceMetric $metric */
        $metric = PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->firstOrFail();
        $year = (string) collect($metric->input_schema['years'] ?? [])->first();

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'indicators' => [
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [$year => 'Maria Santos']],
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');
        $this->uploadRequiredSubmissionFiles($token, $submissionId);

        $this->withToken($token)
            ->postJson("/api/indicators/submissions/{$submissionId}/submit")
            ->assertOk();

        $forbiddenUpdate = $this->withToken($token)->putJson("/api/indicators/submissions/{$submissionId}", [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'notes' => 'Should fail.',
            'indicators' => [
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [$year => 'Dr. Elena Cruz']],
                ],
            ],
        ]);

        $forbiddenUpdate->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonPath('errors.submission.0', 'Only draft or returned indicator submissions can be updated.');
    }

    private function assertSchoolHeadCannotAccessOtherSchoolsIndicatorSubmissionSurfaces(
        string $ownerEmail,
        string $outsiderEmail,
        string $ownerSchoolType,
        string $fileType,
        string $filename,
        string $mimeType,
    ): void {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $owner */
        $owner = User::query()->where('email', $ownerEmail)->firstOrFail();
        /** @var User $outsider */
        $outsider = User::query()->where('email', $outsiderEmail)->firstOrFail();
        School::query()->whereKey($owner->school_id)->update(['type' => $ownerSchoolType]);

        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        /** @var PerformanceMetric $metric */
        $metric = PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->firstOrFail();
        $year = (string) collect($metric->input_schema['years'] ?? [])->first();

        $ownerToken = $this->loginToken('school_head', $this->schoolHeadLogin($owner));
        $created = $this->withToken($ownerToken)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);

        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');

        $this->uploadSubmissionDocument($ownerToken, $submissionId, $fileType, $filename, $mimeType)
            ->assertOk();

        $outsiderToken = $this->loginToken('school_head', $this->schoolHeadLogin($outsider));

        $listed = $this->withToken($outsiderToken)->getJson('/api/indicators/submissions?per_page=100');
        $listed->assertOk();
        $this->assertFalse(
            collect($listed->json('data', []))->contains(
                static fn (mixed $row): bool => is_array($row) && (string) ($row['id'] ?? '') === $submissionId,
            ),
            'School Head index response leaked another school indicator submission.',
        );

        $this->withToken($outsiderToken)
            ->getJson("/api/indicators/submissions/{$submissionId}")
            ->assertStatus(Response::HTTP_FORBIDDEN);

        $this->withToken($outsiderToken)
            ->putJson("/api/indicators/submissions/{$submissionId}", [
                'academic_year_id' => $academicYearId,
                'reporting_period' => 'ANNUAL',
                'indicators' => [
                    [
                        'metric_code' => 'IMETA_HEAD_NAME',
                        'actual' => ['values' => [$year => 'Unauthorized Edit']],
                    ],
                ],
            ])
            ->assertStatus(Response::HTTP_FORBIDDEN);

        $this->uploadSubmissionDocument($outsiderToken, $submissionId, $fileType, $filename, $mimeType)
            ->assertStatus(Response::HTTP_FORBIDDEN);

        $this->withToken($outsiderToken)
            ->postJson("/api/indicators/submissions/{$submissionId}/submit")
            ->assertStatus(Response::HTTP_FORBIDDEN);

        $this->withToken($outsiderToken)
            ->getJson("/api/indicators/submissions/{$submissionId}/history")
            ->assertStatus(Response::HTTP_FORBIDDEN);

        $this->withToken($outsiderToken)
            ->get("/api/submissions/{$submissionId}/view/{$fileType}")
            ->assertStatus(Response::HTTP_FORBIDDEN);

        $this->withToken($outsiderToken)
            ->get("/api/submissions/{$submissionId}/download/{$fileType}")
            ->assertStatus(Response::HTTP_FORBIDDEN);
    }

    private function loginToken(string $role, string $login): string
    {
        $normalizedRole = strtolower($role);
        $userQuery = User::query();

        if ($normalizedRole === 'monitor') {
            $userQuery
                ->where('email', $login)
                ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']));
        } else {
            $userQuery
                ->where(function ($query) use ($login) {
                    $query
                        ->where('email', $login)
                        ->orWhereHas('school', fn ($schoolQuery) => $schoolQuery->where('school_code', $login));
                })
                ->whereHas('roles', fn ($query) => $query->whereIn('name', ['school_head', 'School Head', 'school head']));
        }

        /** @var User $user */
        $user = $userQuery->firstOrFail();
        $ability = $normalizedRole === 'monitor' ? 'role:monitor' : 'role:school_head';

        return $user->createToken("indicator-workflow-{$normalizedRole}", [$ability])->plainTextToken;
    }

    private function uploadRequiredSubmissionFiles(string $token, string $submissionId): void
    {
        Storage::fake('local');

        $this->uploadSubmissionFiles($token, $submissionId, ['bmef', 'smea']);
    }

    /**
     * @param list<string> $types
     */
    private function uploadSubmissionFiles(string $token, string $submissionId, array $types): void
    {
        foreach ($types as $type) {
            $filename = str_replace('_', '-', $type);
            $extension = $type === 'smea' ? 'xlsx' : 'pdf';
            $mimeType = $type === 'smea'
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : 'application/pdf';

            $this->uploadSubmissionDocument($token, $submissionId, $type, "{$filename}.{$extension}", $mimeType)
                ->assertOk();
        }
    }

    private function uploadSubmissionDocument(
        string $token,
        string $submissionId,
        string $type,
        string $filename,
        string $mimeType,
    ) {
        return $this->withToken($token)->postJson("/api/submissions/{$submissionId}/upload-file", [
            'type' => $type,
            'file' => UploadedFile::fake()->create($filename, 64, $mimeType),
        ]);
    }

    private function schoolHeadLogin(User $user): string
    {
        $user->loadMissing('school');

        return (string) $user->school?->school_code;
    }

    private function seedIndicatorFixtures(): void
    {
        $this->seed([
            RolesAndPermissionsSeeder::class,
            DemoDataSeeder::class,
        ]);
    }
}
