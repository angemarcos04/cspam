<?php

namespace Tests\Feature;

use App\Models\AcademicYear;
use App\Models\FormSubmissionHistory;
use App\Models\IndicatorSubmission;
use App\Models\IndicatorSubmissionFileBlob;
use App\Models\IndicatorSubmissionScopeReview;
use App\Models\IndicatorSubmissionScopeSubmission;
use App\Models\PerformanceMetric;
use App\Models\School;
use App\Models\User;
use App\Events\CspamsUpdateBroadcast;
use App\Support\Domain\MetricCategory;
use App\Support\Domain\MetricDataType;
use App\Notifications\IndicatorReviewOutcomeNotification;
use App\Notifications\IndicatorScopeReviewOutcomeNotification;
use App\Support\Indicators\GroupBWorkspaceDefinition;
use App\Support\Indicators\SubmissionFileBlobStorage;
use App\Support\Indicators\SubmissionFileDefinition;
use Database\Seeders\DemoDataSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
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

    public function test_school_achievement_enrollment_preserves_manual_payload_value(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $currentSchoolYear = (string) AcademicYear::query()->whereKey($academicYearId)->value('name');
        $schoolHeadToken = $schoolHead->createToken('monitor-redaction-school-head')->plainTextToken;
        $enrollmentMetricId = (int) PerformanceMetric::query()->where('code', 'IMETA_ENROLL_TOTAL')->value('id');

        $metrics = $this->withToken($schoolHeadToken)->getJson('/api/indicators/metrics');
        $metrics->assertOk()
            ->assertJsonPath('data', function (array $rows): bool {
                $row = collect($rows)->firstWhere('code', 'IMETA_ENROLL_TOTAL');

                return is_array($row) && ($row['isAutoCalculated'] ?? true) === false;
            });

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'indicators' => [
                [
                    'metric_id' => $enrollmentMetricId,
                    'actual' => ['values' => [$currentSchoolYear => 4321]],
                    'remarks' => 'Manual School Achievement value encoded by school head.',
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.summary.totalIndicators', 1);
        $show = $this->withToken($schoolHeadToken)->getJson('/api/indicators/submissions/' . $created->json('data.id'));
        $show->assertOk();

        /** @var array<string, mixed>|null $metricRow */
        $metricRow = collect($show->json('data.indicators', []))
            ->first(static fn (mixed $row): bool => is_array($row) && (($row['metric']['code'] ?? null) === 'IMETA_ENROLL_TOTAL'));

        $this->assertIsArray($metricRow);
        $this->assertSame(
            4321.0,
            (float) data_get($metricRow, "actualTypedValue.values.{$currentSchoolYear}"),
        );
        $this->assertNull(data_get($metricRow, 'targetTypedValue'));
        $this->assertSame('recorded', $metricRow['complianceStatus'] ?? null);
        $this->assertSame('Manual School Achievement value encoded by school head.', $metricRow['remarks'] ?? null);
    }

    public function test_school_achievement_teacher_counts_preserve_manual_payload_values(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $schoolId = (int) $schoolHead->school_id;
        $this->assertGreaterThan(0, $schoolId);

        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $currentSchoolYear = (string) AcademicYear::query()->whereKey($academicYearId)->value('name');
        $schoolHeadToken = $schoolHead->createToken('monitor-redaction-school-head')->plainTextToken;

        $metricIds = PerformanceMetric::query()
            ->whereIn('code', ['IMETA_ENROLL_TOTAL', 'TEACHERS_TOTAL', 'TEACHERS_MALE', 'TEACHERS_FEMALE'])
            ->pluck('id', 'code');

        $response = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => [
                ['metric_id' => (int) $metricIds->get('IMETA_ENROLL_TOTAL'), 'actual' => ['values' => [$currentSchoolYear => 4321]]],
                ['metric_id' => (int) $metricIds->get('TEACHERS_TOTAL'), 'actual' => ['values' => [$currentSchoolYear => 101]]],
                ['metric_id' => (int) $metricIds->get('TEACHERS_MALE'), 'actual' => ['values' => [$currentSchoolYear => 12]]],
                ['metric_id' => (int) $metricIds->get('TEACHERS_FEMALE'), 'actual' => ['values' => [$currentSchoolYear => 89]]],
            ],
        ]);

        $response->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.summary.totalIndicators', 4);
        $show = $this->withToken($schoolHeadToken)->getJson('/api/indicators/submissions/' . $response->json('data.id'));
        $show->assertOk();

        $rowsByCode = collect($show->json('data.indicators', []))
            ->keyBy(static fn (array $row): string => (string) data_get($row, 'metric.code', ''));

        $this->assertSame(
            4321.0,
            (float) data_get($rowsByCode->get('IMETA_ENROLL_TOTAL'), "actualTypedValue.values.{$currentSchoolYear}"),
        );
        $this->assertSame(
            101.0,
            (float) data_get($rowsByCode->get('TEACHERS_TOTAL'), "actualTypedValue.values.{$currentSchoolYear}"),
        );
        $this->assertSame(
            12.0,
            (float) data_get($rowsByCode->get('TEACHERS_MALE'), "actualTypedValue.values.{$currentSchoolYear}"),
        );
        $this->assertSame(
            89.0,
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

        $unverified = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'unverified',
        ]);

        $unverified->assertOk()
            ->assertJsonPath('data.status', 'submitted')
            ->assertJsonPath('data.scopeProgress.submittedScopeIds', fn (array $ids): bool => in_array('bmef', $ids, true));

        $bmefUnverifiedReview = collect($unverified->json('data.scopeReviews', []))
            ->firstWhere('scopeId', 'bmef');
        $this->assertSame('unverified', $bmefUnverifiedReview['decision'] ?? null);
        $this->assertNull($bmefUnverifiedReview['notes'] ?? null);

        $invalidUnverify = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'smea',
            'decision' => 'unverified',
        ]);
        $invalidUnverify->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['decision'])
            ->assertJsonPath('errors.decision.0', 'Only verified requirements can be unverified.');

        $returnedWithoutNote = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'smea',
            'decision' => 'returned',
        ]);
        $returnedWithoutNote->assertOk();
        $smeaReview = collect($returnedWithoutNote->json('data.scopeReviews', []))
            ->firstWhere('scopeId', 'smea');
        $this->assertSame('returned', $smeaReview['decision'] ?? null);
        $this->assertNull($smeaReview['notes'] ?? null);

        $returned = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'returned',
            'notes' => 'Please upload the signed version.',
        ]);

        $returned->assertOk();

        $this->assertDatabaseHas('indicator_submission_scope_reviews', [
            'indicator_submission_id' => $submissionId,
            'scope_id' => 'smea',
            'decision' => 'returned',
            'notes' => null,
        ]);
        $this->assertDatabaseHas('indicator_submission_scope_reviews', [
            'indicator_submission_id' => $submissionId,
            'scope_id' => 'bmef',
            'decision' => 'returned',
            'notes' => 'Please upload the signed version.',
        ]);
        $this->assertDatabaseHas('form_submission_histories', [
            'form_type' => IndicatorSubmission::FORM_TYPE,
            'submission_id' => $submissionId,
            'action' => 'scope_unverified',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'monitor.scope_unverified',
        ]);
        $this->assertDatabaseHas('notifications', [
            'type' => IndicatorScopeReviewOutcomeNotification::class,
            'notifiable_type' => User::class,
            'notifiable_id' => $schoolHead->id,
            'data->eventType' => 'indicator_scope_unverified',
            'data->status' => 'unverified',
        ]);
        $this->assertDatabaseHas('notifications', [
            'type' => IndicatorScopeReviewOutcomeNotification::class,
            'notifiable_type' => User::class,
            'notifiable_id' => $schoolHead->id,
        ]);
        Event::assertDispatched(CspamsUpdateBroadcast::class, function (CspamsUpdateBroadcast $event): bool {
            return ($event->payload['eventType'] ?? null) === 'indicators.scope_unverified'
                && ($event->payload['scopeId'] ?? null) === 'bmef'
                && ($event->payload['decision'] ?? null) === 'unverified'
                && ($event->payload['previousDecision'] ?? null) === 'verified'
                && ($event->payload['touchedScopes'] ?? null) === ['bmef']
                && ! array_key_exists('notes', $event->payload);
        });
        Event::assertDispatched(CspamsUpdateBroadcast::class, function (CspamsUpdateBroadcast $event): bool {
            return ($event->payload['eventType'] ?? null) === 'indicators.scope_returned'
                && ($event->payload['scopeId'] ?? null) === 'smea';
        });
    }

    public function test_monitor_can_reverify_unverified_scope_without_losing_history_or_notifications(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();
        Event::fake([CspamsUpdateBroadcast::class]);

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $schoolHeadToken = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);
        $created->assertCreated();

        $submissionId = (string) $created->json('data.id');
        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef.pdf', 'application/pdf')
            ->assertOk();

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();

        $this->assertDatabaseHas('indicator_submission_scope_submissions', [
            'indicator_submission_id' => $submissionId,
            'scope_id' => 'bmef',
            'scope_type' => 'file',
        ]);

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('scope-reverify-monitor', ['role:monitor'])->plainTextToken;

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ])->assertOk();

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'unverified',
        ])->assertOk();

        $verifiedNotificationCountBeforeFinal = $schoolHead->fresh()->notifications()
            ->where('type', IndicatorScopeReviewOutcomeNotification::class)
            ->where('data->eventType', 'indicator_scope_verified')
            ->count();

        $finalVerified = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ]);
        $finalVerified->assertOk()
            ->assertJsonPath('data.status', 'draft');

        $bmefReview = collect($finalVerified->json('data.scopeReviews', []))
            ->firstWhere('scopeId', 'bmef');
        $this->assertSame('verified', $bmefReview['decision'] ?? null);
        $this->assertNull($bmefReview['notes'] ?? null);

        $this->assertDatabaseHas('indicator_submission_scope_reviews', [
            'indicator_submission_id' => $submissionId,
            'scope_id' => 'bmef',
            'decision' => 'verified',
            'notes' => null,
        ]);
        $this->assertDatabaseHas('indicator_submission_scope_submissions', [
            'indicator_submission_id' => $submissionId,
            'scope_id' => 'bmef',
            'scope_type' => 'file',
        ]);
        $this->assertSame(2, FormSubmissionHistory::query()
            ->where('form_type', IndicatorSubmission::FORM_TYPE)
            ->where('submission_id', $submissionId)
            ->where('action', 'scope_verified')
            ->count());
        $this->assertDatabaseHas('form_submission_histories', [
            'form_type' => IndicatorSubmission::FORM_TYPE,
            'submission_id' => $submissionId,
            'action' => 'scope_unverified',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'monitor.scope_verified',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'monitor.scope_unverified',
        ]);
        $this->assertSame($verifiedNotificationCountBeforeFinal + 1, $schoolHead->fresh()->notifications()
            ->where('type', IndicatorScopeReviewOutcomeNotification::class)
            ->where('data->eventType', 'indicator_scope_verified')
            ->count());
        Event::assertDispatched(CspamsUpdateBroadcast::class, function (CspamsUpdateBroadcast $event): bool {
            return ($event->payload['eventType'] ?? null) === 'indicators.scope_verified'
                && ($event->payload['scopeId'] ?? null) === 'bmef'
                && ($event->payload['decision'] ?? null) === 'verified'
                && ($event->payload['previousDecision'] ?? null) === 'unverified'
                && ($event->payload['touchedScopes'] ?? null) === ['bmef'];
        });
    }

    public function test_verified_file_scope_blocks_school_head_mutation_until_unverified(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $schoolHeadToken = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ])->assertCreated();
        $submissionId = (string) $created->json('data.id');

        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef.pdf', 'application/pdf')
            ->assertOk();
        $originalSubmission = IndicatorSubmission::query()->findOrFail($submissionId);
        $originalBmefPath = $originalSubmission->bmef_file_path;
        $this->assertNotNull($originalBmefPath);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('verified-file-lock-monitor', ['role:monitor'])->plainTextToken;

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ])->assertOk();

        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef-revised.pdf', 'application/pdf')
            ->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['submission'])
            ->assertJsonPath('errors.submission.0', 'This file or indicator has been verified.');
        $this->assertDatabaseHas('indicator_submissions', [
            'id' => (int) $submissionId,
            'bmef_file_path' => $originalBmefPath,
            'bmef_original_filename' => 'bmef.pdf',
        ]);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['submission'])
            ->assertJsonPath('errors.submission.0', 'This file or indicator has been verified.');

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit")
            ->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['submission'])
            ->assertJsonPath('errors.submission.0', 'This package contains verified files or indicators. Ask the Monitor to unverify them before final submission.');

        IndicatorSubmissionScopeSubmission::query()
            ->where('indicator_submission_id', $submissionId)
            ->where('scope_id', 'bmef')
            ->delete();

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'unverified',
        ])->assertOk()
            ->assertJsonPath('data.scopeReviews.0.decision', 'unverified');

        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef-revised.pdf', 'application/pdf')
            ->assertOk()
            ->assertJsonPath('data.files.bmef.originalFilename', 'bmef-revised.pdf');
    }

    public function test_verified_same_year_scope_cannot_be_bypassed_with_second_draft(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $schoolHeadToken = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');

        $first = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ])->assertCreated();
        $firstSubmissionId = (string) $first->json('data.id');

        $this->uploadSubmissionDocument($schoolHeadToken, $firstSubmissionId, 'bmef', 'bmef.pdf', 'application/pdf')
            ->assertOk();
        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$firstSubmissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('verified-cross-submission-lock-monitor', ['role:monitor'])->plainTextToken;

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$firstSubmissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ])->assertOk();

        $second = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ])->assertCreated();
        $secondSubmissionId = (string) $second->json('data.id');
        $this->assertNotSame($firstSubmissionId, $secondSubmissionId);

        $this->uploadSubmissionDocument($schoolHeadToken, $secondSubmissionId, 'bmef', 'bmef-through-second-draft.pdf', 'application/pdf')
            ->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['submission'])
            ->assertJsonPath('errors.submission.0', 'This file or indicator has been verified.');
        $this->assertDatabaseHas('indicator_submissions', [
            'id' => (int) $secondSubmissionId,
            'bmef_file_path' => null,
            'bmef_original_filename' => null,
        ]);
    }

    public function test_verified_indicator_section_blocks_school_head_save_reset_and_send(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $schoolHeadToken = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        /** @var PerformanceMetric $metric */
        $metric = PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->firstOrFail();
        $year = (string) collect($metric->input_schema['years'] ?? [])->first();

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'workspace_section' => GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS,
            'indicators' => [
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [$year => 'Maria Santos']],
                ],
            ],
        ])->assertCreated();
        $submissionId = (string) $created->json('data.id');

        IndicatorSubmissionScopeReview::query()->create([
            'indicator_submission_id' => $submissionId,
            'scope_id' => GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS,
            'scope_type' => 'section',
            'decision' => 'verified',
            'reviewed_by' => User::query()
                ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
                ->value('id'),
            'reviewed_at' => now(),
        ]);

        $payload = [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'workspace_section' => GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS,
            'indicators' => [
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [$year => 'Updated Name']],
                ],
            ],
        ];

        $this->withToken($schoolHeadToken)->putJson("/api/indicators/submissions/{$submissionId}", $payload)
            ->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['submission'])
            ->assertJsonPath('errors.submission.0', 'This file or indicator has been verified.');

        $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions', $payload)
            ->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['submission'])
            ->assertJsonPath('errors.submission.0', 'This file or indicator has been verified.');

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/reset-workspace", [
            'workspace' => GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS,
        ])->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['submission'])
            ->assertJsonPath('errors.submission.0', 'This file or indicator has been verified.');

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => [GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS],
        ])->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['submission'])
            ->assertJsonPath('errors.submission.0', 'This file or indicator has been verified.');
    }

    public function test_school_head_can_bootstrap_minimal_indicator_draft_and_update_it_later(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $schoolCode = (string) School::query()->whereKey($schoolHead->school_id)->value('school_code');
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
        $schoolCode = (string) School::query()->whereKey($schoolHead->school_id)->value('school_code');
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

        Event::assertDispatched(CspamsUpdateBroadcast::class, function (CspamsUpdateBroadcast $event) use ($submissionId, $academicYearId, $schoolCode): bool {
            return $event->payload['eventType'] === 'indicators.updated'
                && $event->payload['submissionId'] === $submissionId
                && ($event->payload['schoolCode'] ?? null) === $schoolCode
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

    public function test_key_performance_payload_values_preserve_real_metric_id(): void
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

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.indicators.0.metric.id', (string) $metric->id)
            ->assertJsonPath('data.indicators.0.metric.code', 'PR');

        $this->assertSame(
            93.0,
            (float) $created->json("data.indicators.0.actualTypedValue.values.{$year}"),
        );
        $this->assertSame(
            91.0,
            (float) $created->json("data.indicators.0.targetTypedValue.values.{$year}"),
        );
    }

    public function test_key_performance_payload_values_preserve_metric_code_only(): void
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

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.indicators.0.metric.code', 'NER')
            ->assertJsonPath("data.indicators.0.actualTypedValue.values.{$year}", 97)
            ->assertJsonPath("data.indicators.0.targetTypedValue.values.{$year}", 95);
    }

    public function test_explicit_zero_key_performance_values_are_preserved(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $year = (string) AcademicYear::query()->whereKey($academicYearId)->value('name');

        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'Q1',
            'indicators' => [
                [
                    'metric_code' => 'NER',
                    'target' => ['values' => [$year => 0]],
                    'actual' => ['values' => [$year => 0]],
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED)
            ->assertJsonPath('data.indicators.0.metric.code', 'NER')
            ->assertJsonPath("data.indicators.0.targetTypedValue.values.{$year}", 0)
            ->assertJsonPath("data.indicators.0.actualTypedValue.values.{$year}", 0)
            ->assertJsonPath('data.indicators.0.complianceStatus', 'met');
    }

    public function test_auto_calculated_kpi_does_not_fabricate_zero_series_for_missing_sources(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $derived = app(\App\Support\Indicators\TargetsMetAutoCalculator::class)
            ->deriveMatricesForSchool((int) $schoolHead->school_id);

        $this->assertArrayNotHasKey('LEARNER_SATISFACTION', $derived);
        $this->assertArrayNotHasKey('RIGHTS_AWARENESS', $derived);
        $this->assertArrayNotHasKey('VIOLENCE_REPORT_RATE', $derived);
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

        Event::fake([CspamsUpdateBroadcast::class]);

        $scoped = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['fm_qad_001'],
        ]);

        $scoped->assertOk()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.scopeProgress.submittedScopeIds', fn (array $ids): bool => in_array('fm_qad_001', $ids, true))
            ->assertJsonPath('data.scopeProgress.submittedRequiredScopeCount', 1);

        $schoolCode = (string) School::query()->whereKey($schoolHead->school_id)->value('school_code');
        Event::assertDispatched(CspamsUpdateBroadcast::class, function (CspamsUpdateBroadcast $event) use ($submissionId, $academicYearId, $schoolCode): bool {
            return ($event->payload['eventType'] ?? null) === 'indicators.scopes_submitted'
                && ($event->payload['submissionId'] ?? null) === $submissionId
                && ($event->payload['schoolCode'] ?? null) === $schoolCode
                && ($event->payload['academicYearId'] ?? null) === (string) $academicYearId
                && ($event->payload['touchedScopes'] ?? null) === ['fm_qad_001']
                && ! array_key_exists('files', $event->payload)
                && ! array_key_exists('indicators', $event->payload)
                && ! array_key_exists('items', $event->payload);
        });

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

    public function test_monitor_indicator_list_etag_changes_when_scope_submission_state_changes(): void
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
        $monitorToken = $monitor->createToken('indicator-list-etag-monitor', ['role:monitor'])->plainTextToken;
        $schoolCode = (string) School::query()->whereKey($schoolHead->school_id)->value('school_code');
        $listUrl = "/api/indicators/submissions?school_code={$schoolCode}&academic_year_id={$academicYearId}&per_page=100";

        $initialList = $this->withToken($monitorToken)->getJson($listUrl);
        $initialList->assertOk();
        $initialEtag = trim((string) $initialList->headers->get('X-Sync-Etag'), '"');
        $this->assertNotSame('', $initialEtag);

        $this->travel(1)->second();
        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();

        $afterSendList = $this->withToken($monitorToken)
            ->withHeaders(['If-None-Match' => $initialEtag])
            ->getJson($listUrl);
        $afterSendList->assertOk();
        $afterSendEtag = trim((string) $afterSendList->headers->get('X-Sync-Etag'), '"');
        $this->assertNotSame($initialEtag, $afterSendEtag);
        $sentRow = collect($afterSendList->json('data', []))
            ->firstWhere('id', $submissionId);
        $this->assertIsArray($sentRow);
        $this->assertContains('bmef', data_get($sentRow, 'scopeProgress.submittedScopeIds', []));
        $this->assertTrue((bool) data_get($sentRow, 'files.bmef.uploaded'));
        $this->assertSame("/api/submissions/{$submissionId}/view/bmef", data_get($sentRow, 'files.bmef.viewUrl'));

        $this->travel(1)->second();
        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'returned',
            'notes' => 'Please revise the BMEF.',
        ])->assertOk();

        $afterReturnList = $this->withToken($monitorToken)
            ->withHeaders(['If-None-Match' => $afterSendEtag])
            ->getJson($listUrl);
        $afterReturnList->assertOk();
        $afterReturnEtag = trim((string) $afterReturnList->headers->get('X-Sync-Etag'), '"');
        $this->assertNotSame($afterSendEtag, $afterReturnEtag);
        $returnedRow = collect($afterReturnList->json('data', []))
            ->firstWhere('id', $submissionId);
        $this->assertIsArray($returnedRow);
        $this->assertNotContains('bmef', data_get($returnedRow, 'scopeProgress.submittedScopeIds', []));
        $this->assertFalse((bool) data_get($returnedRow, 'files.bmef.uploaded'));
        $this->assertNull(data_get($returnedRow, 'files.bmef.viewUrl'));
    }

    public function test_replacing_sent_file_removes_monitor_reviewability_until_resend(): void
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
        ])->assertOk();

        $this->assertDatabaseHas('indicator_submission_scope_submissions', [
            'indicator_submission_id' => $submissionId,
            'scope_id' => 'bmef',
        ]);

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('sent-file-replace-monitor', ['role:monitor'])->plainTextToken;

        $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}")
            ->assertOk()
            ->assertJsonPath('data.files.bmef.uploaded', true)
            ->assertJsonPath('data.files.bmef.originalFilename', 'bmef-original.pdf');

        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef-revised.pdf', 'application/pdf')
            ->assertOk();
        $this->assertDatabaseMissing('indicator_submission_scope_submissions', [
            'indicator_submission_id' => $submissionId,
            'scope_id' => 'bmef',
        ]);

        $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}")
            ->assertOk()
            ->assertJsonPath('data.files.bmef.uploaded', false)
            ->assertJsonPath('data.files.bmef.originalFilename', null)
            ->assertJsonPath('data.files.bmef.viewUrl', null);

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ])->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['submission']);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();

        $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}")
            ->assertOk()
            ->assertJsonPath('data.files.bmef.uploaded', true)
            ->assertJsonPath('data.files.bmef.originalFilename', 'bmef-revised.pdf')
            ->assertJsonPath('data.files.bmef.viewUrl', "/api/submissions/{$submissionId}/view/bmef");
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

        $resent = $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ]);
        $resent->assertOk()
            ->assertJsonPath('data.scopeProgress.submittedScopeIds', fn (array $ids): bool => in_array('bmef', $ids, true));
        $this->assertFalse(collect($resent->json('data.scopeReviews', []))->contains(
            static fn (mixed $review): bool => is_array($review)
                && ($review['scopeId'] ?? null) === 'bmef'
                && ($review['decision'] ?? null) === 'returned',
        ));

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
        $this->assertDatabaseMissing('indicator_submission_scope_submissions', [
            'indicator_submission_id' => $submissionId,
            'scope_id' => 'bmef',
        ]);

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

        $resent = $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ]);
        $resent->assertOk()
            ->assertJsonPath('data.scopeProgress.submittedScopeIds', fn (array $ids): bool => in_array('bmef', $ids, true));
        $this->assertFalse(collect($resent->json('data.scopeReviews', []))->contains(
            static fn (mixed $review): bool => is_array($review)
                && ($review['scopeId'] ?? null) === 'bmef'
                && ($review['decision'] ?? null) === 'returned',
        ));

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

    public function test_monitor_cannot_review_returned_full_package_revisions_until_school_head_resubmits(): void
    {
        Storage::fake('local');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $schoolHeadToken = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));
        $academicYear = AcademicYear::query()->where('is_current', true)->firstOrFail();
        $metricId = (int) PerformanceMetric::query()->where('code', 'SALO')->value('id');

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYear->id,
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
                    'actual' => ['values' => [(string) $academicYear->name => 'Maria Santos']],
                ],
            ],
        ]);
        $created->assertCreated();

        $submissionId = (string) $created->json('data.id');
        $this->uploadSubmissionFiles($schoolHeadToken, $submissionId, ['bmef', 'smea']);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit")
            ->assertOk()
            ->assertJsonPath('data.status', 'submitted');

        /** @var User $monitor */
        $monitor = User::query()
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']))
            ->firstOrFail();
        $monitorToken = $monitor->createToken('returned-full-package-monitor', ['role:monitor'])->plainTextToken;

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/review", [
            'decision' => 'returned',
            'notes' => 'Please revise the package.',
        ])->assertOk()
            ->assertJsonPath('data.status', 'returned');

        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef-revised.pdf', 'application/pdf')
            ->assertOk();

        $monitorShowReturnedRevision = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $monitorShowReturnedRevision->assertOk()
            ->assertJsonPath('data.status', 'returned')
            ->assertJsonPath('data.files.bmef.uploaded', false)
            ->assertJsonPath('data.files.bmef.originalFilename', null)
            ->assertJsonPath('data.files.bmef.viewUrl', null)
            ->assertJsonPath('data.files.bmef.downloadUrl', null);

        $unsentRevisionReview = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ]);
        $unsentRevisionReview->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['submission'])
            ->assertJsonPath('errors.submission.0', 'Only sent indicator scopes can be reviewed.');

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit")
            ->assertOk()
            ->assertJsonPath('data.status', 'submitted');

        $monitorShowResubmittedRevision = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $monitorShowResubmittedRevision->assertOk()
            ->assertJsonPath('data.status', 'submitted')
            ->assertJsonPath('data.files.bmef.uploaded', true)
            ->assertJsonPath('data.files.bmef.originalFilename', 'bmef-revised.pdf')
            ->assertJsonPath('data.files.bmef.viewUrl', "/api/submissions/{$submissionId}/view/bmef")
            ->assertJsonPath('data.files.bmef.downloadUrl', "/api/submissions/{$submissionId}/download/bmef");

        $resubmittedRevisionReview = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ]);
        $resubmittedRevisionReview->assertOk()
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

        $uploadedFile = UploadedFile::fake()->create('bmef-report.pdf', 64, 'application/pdf');
        $uploadedContent = (string) file_get_contents((string) $uploadedFile->getRealPath());

        $this->withToken($token)
            ->postJson("/api/submissions/{$submissionId}/upload-file", [
                'type' => 'bmef',
                'file' => $uploadedFile,
            ])
            ->assertOk();

        $view = $this->withToken($token)->get("/api/submissions/{$submissionId}/view/bmef");

        $view->assertOk();
        $this->assertStringContainsString('inline;', (string) $view->headers->get('content-disposition'));
        $this->assertStringContainsString('application/pdf', (string) $view->headers->get('content-type'));
        $this->assertSame($uploadedContent, $view->getContent());
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

        $uploadedFile = UploadedFile::fake()->create('fm-qad-001.pdf', 64, 'application/pdf');
        $uploadedContent = (string) file_get_contents((string) $uploadedFile->getRealPath());
        $upload = $this->withToken($token)->postJson("/api/submissions/{$submissionId}/upload-file", [
            'type' => 'fm_qad_001',
            'file' => $uploadedFile,
        ]);
        $upload->assertOk()
            ->assertJsonMissingPath('data.indicators')
            ->assertJsonPath('data.files.fm_qad_001.uploaded', true)
            ->assertJsonPath('data.files.fm_qad_001.originalFilename', 'fm-qad-001.pdf')
            ->assertJsonPath('data.files.fm_qad_001.viewUrl', "/api/submissions/{$submissionId}/view/fm_qad_001")
            ->assertJsonPath('data.files.fm_qad_001.downloadUrl', "/api/submissions/{$submissionId}/download/fm_qad_001");

        $view = $this->withToken($token)->get("/api/submissions/{$submissionId}/view/fm_qad_001");
        $view->assertOk();
        $this->assertStringContainsString('inline;', (string) $view->headers->get('content-disposition'));
        $this->assertSame($uploadedContent, $view->getContent());

        $download = $this->withToken($token)->get("/api/submissions/{$submissionId}/download/fm_qad_001");
        $download->assertOk();
        $this->assertStringContainsString('attachment;', (string) $download->headers->get('content-disposition'));
        $this->assertSame($uploadedContent, $download->getContent());
    }

    public function test_legacy_disk_path_fallback_still_serves_existing_file(): void
    {
        config()->set('cspams.submission_file_disk', 'submissions');
        Storage::fake('submissions');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ])->assertCreated();
        $submissionId = (string) $created->json('data.id');

        $legacyPath = 'submissions/legacy-fm-qad-001.pdf';
        $legacyContent = '%PDF-1.4 legacy disk bytes';
        Storage::disk('submissions')->put($legacyPath, $legacyContent);
        IndicatorSubmission::query()->findOrFail((int) $submissionId)
            ->submissionFiles()
            ->create([
                'type' => 'fm_qad_001',
                'path' => $legacyPath,
                'original_filename' => 'legacy-fm-qad-001.pdf',
                'size_bytes' => strlen($legacyContent),
                'uploaded_at' => now(),
            ]);

        $show = $this->withToken($token)->getJson("/api/indicators/submissions/{$submissionId}");
        $show->assertOk()
            ->assertJsonPath('data.files.fm_qad_001.uploaded', true)
            ->assertJsonPath('data.files.fm_qad_001.available', true)
            ->assertJsonPath('data.files.fm_qad_001.missingFromStorage', false);

        $view = $this->withToken($token)->get("/api/submissions/{$submissionId}/view/fm_qad_001");
        $view->assertOk();
        $this->assertStringContainsString('inline;', (string) $view->headers->get('content-disposition'));
        $this->assertResponseBodyMatches($view, $legacyContent);

        $download = $this->withToken($token)->get("/api/submissions/{$submissionId}/download/fm_qad_001");
        $download->assertOk();
        $this->assertStringContainsString('attachment;', (string) $download->headers->get('content-disposition'));
        $this->assertResponseBodyMatches($download, $legacyContent);
    }

    public function test_file_responses_sanitize_weird_filenames_for_content_disposition(): void
    {
        [$token, $submissionId] = $this->createStorageAuditSubmission();

        $this->uploadSubmissionDocument($token, $submissionId, 'bmef', 'normal.pdf', 'application/pdf')
            ->assertOk();

        $weirdFilename = "bad/\"name\r\n.pdf";
        IndicatorSubmission::query()
            ->whereKey((int) $submissionId)
            ->update(['bmef_original_filename' => $weirdFilename]);
        IndicatorSubmissionFileBlob::query()
            ->where('indicator_submission_id', (int) $submissionId)
            ->where('type', 'bmef')
            ->update(['original_filename' => $weirdFilename]);

        $view = $this->withToken($token)->get("/api/submissions/{$submissionId}/view/bmef");
        $view->assertOk();
        $viewDisposition = (string) $view->headers->get('content-disposition');
        $this->assertStringContainsString('inline;', $viewDisposition);
        $this->assertStringContainsString('bad-name.pdf', $viewDisposition);
        $this->assertStringNotContainsString("\r", $viewDisposition);
        $this->assertStringNotContainsString("\n", $viewDisposition);
        $this->assertStringNotContainsString('"bad/"name', $viewDisposition);

        $download = $this->withToken($token)->get("/api/submissions/{$submissionId}/download/bmef");
        $download->assertOk();
        $downloadDisposition = (string) $download->headers->get('content-disposition');
        $this->assertStringContainsString('attachment;', $downloadDisposition);
        $this->assertStringContainsString('bad-name.pdf', $downloadDisposition);
        $this->assertStringNotContainsString("\r", $downloadDisposition);
        $this->assertStringNotContainsString("\n", $downloadDisposition);
        $this->assertStringNotContainsString('"bad/"name', $downloadDisposition);
    }

    public function test_submission_storage_audit_command_reports_database_blob_ok(): void
    {
        [$token, $submissionId] = $this->createStorageAuditSubmission();

        $this->uploadSubmissionDocument($token, $submissionId, 'bmef', 'bmef.pdf', 'application/pdf')
            ->assertOk();

        [$exitCode, $audit, $output] = $this->callSubmissionStorageAudit(['--fail-on-missing' => true]);

        $this->assertSame(0, $exitCode, $output);
        $this->assertSame(0, (int) data_get($audit, 'summary.reuploadRequired'));
        $this->assertAuditRow($audit, (int) $submissionId, 'bmef', 'ok_database_blob', 'none', true);
    }

    public function test_submission_storage_audit_command_reports_missing_database_blob(): void
    {
        [$token, $submissionId] = $this->createStorageAuditSubmission();

        $this->uploadSubmissionDocument($token, $submissionId, 'bmef', 'bmef.pdf', 'application/pdf')
            ->assertOk();

        $path = (string) IndicatorSubmission::query()
            ->whereKey((int) $submissionId)
            ->value('bmef_file_path');
        $this->deleteSubmissionStoragePath($path);

        [$exitCode, $audit, $output] = $this->callSubmissionStorageAudit(['--fail-on-missing' => true]);

        $this->assertSame(1, $exitCode, $output);
        $this->assertSame(1, (int) data_get($audit, 'summary.reuploadRequired'));
        $this->assertAuditRow($audit, (int) $submissionId, 'bmef', 'missing_database_blob', 'reupload_required', false);
    }

    public function test_submission_storage_audit_command_reports_legacy_disk_ok(): void
    {
        config()->set('cspams.submission_file_disk', 'submissions');
        Storage::fake('submissions');
        [, $submissionId] = $this->createStorageAuditSubmission();

        $legacyPath = 'submissions/legacy-ok.pdf';
        Storage::disk('submissions')->put($legacyPath, '%PDF legacy ok');
        IndicatorSubmission::query()->findOrFail((int) $submissionId)
            ->submissionFiles()
            ->create([
                'type' => 'fm_qad_001',
                'path' => $legacyPath,
                'original_filename' => 'legacy-ok.pdf',
                'size_bytes' => strlen('%PDF legacy ok'),
                'uploaded_at' => now(),
            ]);

        [$exitCode, $audit, $output] = $this->callSubmissionStorageAudit(['--fail-on-missing' => true]);

        $this->assertSame(0, $exitCode, $output);
        $this->assertSame(0, (int) data_get($audit, 'summary.reuploadRequired'));
        $this->assertAuditRow($audit, (int) $submissionId, 'fm_qad_001', 'ok_legacy_disk', 'legacy_disk_still_available', true);
    }

    public function test_submission_storage_audit_command_reports_missing_legacy_disk_and_fail_on_missing(): void
    {
        config()->set('cspams.submission_file_disk', 'submissions');
        Storage::fake('submissions');
        [, $submissionId] = $this->createStorageAuditSubmission();

        IndicatorSubmission::query()->findOrFail((int) $submissionId)
            ->submissionFiles()
            ->create([
                'type' => 'fm_qad_001',
                'path' => 'submissions/missing.pdf',
                'original_filename' => 'missing.pdf',
                'size_bytes' => 123,
                'uploaded_at' => now(),
            ]);

        [$exitCode, $audit, $output] = $this->callSubmissionStorageAudit(['--fail-on-missing' => true]);

        $this->assertSame(1, $exitCode, $output);
        $this->assertSame(1, (int) data_get($audit, 'summary.reuploadRequired'));
        $this->assertAuditRow($audit, (int) $submissionId, 'fm_qad_001', 'missing_legacy_disk', 'reupload_required', false);
    }

    public function test_submission_file_upload_failure_logs_safe_searchable_context(): void
    {
        [$token, $submissionId] = $this->createStorageAuditSubmission();
        Log::spy();

        app()->instance(SubmissionFileBlobStorage::class, new class extends SubmissionFileBlobStorage
        {
            public function put(
                IndicatorSubmission $submission,
                string $type,
                UploadedFile $file,
                string $originalFilename,
            ): IndicatorSubmissionFileBlob {
                throw new \RuntimeException('simulated blob persistence failure');
            }
        });

        $file = UploadedFile::fake()->createWithContent('bmef.pdf', 'pretend-uploaded-file-content');

        $response = $this->withToken($token)->postJson("/api/submissions/{$submissionId}/upload-file", [
            'type' => 'bmef',
            'file' => $file,
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['file'])
            ->assertJsonPath('errors.file.0', 'The uploaded file could not be persisted. Please try again or contact the administrator.');

        Log::shouldHaveReceived('error')
            ->with('submission_file_upload_persist_failed', \Mockery::on(
                static fn (array $context): bool => ($context['submission_id'] ?? null) === (int) $submissionId
                    && ($context['file_type'] ?? null) === 'bmef'
                    && ($context['exception_class'] ?? null) === \RuntimeException::class
                    && str_contains((string) ($context['exception_message'] ?? ''), 'simulated blob persistence failure')
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'pretend-uploaded-file-content'),
            ));
    }

    public function test_submission_file_upload_stores_database_blob_and_reset_deletes_that_blob(): void
    {
        config()->set('cspams.submission_file_disk', 'submissions');
        Storage::fake('local');
        Storage::fake('submissions');
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

        $fmQadFile = UploadedFile::fake()->create('fm-qad-001.pdf', 64, 'application/pdf');
        $fmQadContent = (string) file_get_contents((string) $fmQadFile->getRealPath());
        $upload = $this->withToken($token)->postJson("/api/submissions/{$submissionId}/upload-file", [
            'type' => 'fm_qad_001',
            'file' => $fmQadFile,
        ]);
        $upload->assertOk()
            ->assertJsonPath('data.files.fm_qad_001.uploaded', true)
            ->assertJsonPath('data.files.fm_qad_001.available', true)
            ->assertJsonPath('data.files.fm_qad_001.missingFromStorage', false)
            ->assertJsonPath('data.files.fm_qad_001.viewUrl', "/api/submissions/{$submissionId}/view/fm_qad_001")
            ->assertJsonPath('data.files.fm_qad_001.downloadUrl', "/api/submissions/{$submissionId}/download/fm_qad_001");

        $storedPath = (string) \Illuminate\Support\Facades\DB::table('indicator_submission_files')
            ->where('indicator_submission_id', (int) $submissionId)
            ->where('type', 'fm_qad_001')
            ->value('path');
        $this->assertSame("database://indicator-submissions/{$submissionId}/fm_qad_001", $storedPath);
        $blob = $this->assertBlobContent($storedPath, $fmQadContent);
        $this->assertSame('fm-qad-001.pdf', $blob->original_filename);
        $this->assertSame('application/pdf', $blob->mime_type);

        $bmefFile = UploadedFile::fake()->create('bmef-report.pdf', 64, 'application/pdf');
        $bmefContent = (string) file_get_contents((string) $bmefFile->getRealPath());
        $bmefUpload = $this->withToken($token)->postJson("/api/submissions/{$submissionId}/upload-file", [
            'type' => 'bmef',
            'file' => $bmefFile,
        ]);
        $bmefUpload->assertOk()
            ->assertJsonPath('data.files.bmef.uploaded', true)
            ->assertJsonPath('data.files.bmef.available', true)
            ->assertJsonPath('data.files.bmef.missingFromStorage', false);

        $bmefPath = (string) \Illuminate\Support\Facades\DB::table('indicator_submissions')
            ->where('id', (int) $submissionId)
            ->value('bmef_file_path');
        $this->assertSame("database://indicator-submissions/{$submissionId}/bmef", $bmefPath);
        $this->assertBlobContent($bmefPath, $bmefContent);

        $reset = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/reset-workspace", [
            'workspace' => 'fm_qad_001',
        ]);

        $reset->assertOk()
            ->assertJsonPath('data.files.fm_qad_001.uploaded', false)
            ->assertJsonPath('data.files.fm_qad_001.available', false)
            ->assertJsonPath('data.files.fm_qad_001.missingFromStorage', false)
            ->assertJsonPath('data.files.fm_qad_001.viewUrl', null)
            ->assertJsonPath('data.files.fm_qad_001.downloadUrl', null);
        $this->assertSubmissionStorageMissing($storedPath);
    }

    public function test_submission_file_upload_does_not_depend_on_configured_disk(): void
    {
        config()->set('cspams.submission_file_disk', 'missing-submission-disk');
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

        $this->uploadSubmissionDocument($token, $submissionId, 'bmef', 'bmef-report.pdf', 'application/pdf')
            ->assertOk()
            ->assertJsonPath('data.files.bmef.uploaded', true)
            ->assertJsonPath('data.files.bmef.available', true)
            ->assertJsonPath('data.files.bmef.missingFromStorage', false);

        $this->assertDatabaseHas('indicator_submissions', [
            'id' => (int) $submissionId,
            'bmef_file_path' => "database://indicator-submissions/{$submissionId}/bmef",
            'bmef_original_filename' => 'bmef-report.pdf',
        ]);
        $this->assertDatabaseHas('indicator_submission_file_blobs', [
            'indicator_submission_id' => (int) $submissionId,
            'type' => 'bmef',
            'original_filename' => 'bmef-report.pdf',
        ]);
    }

    public function test_successful_submission_file_replacement_updates_single_database_blob(): void
    {
        config()->set('cspams.submission_file_disk', 'submissions');
        Storage::fake('submissions');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ])->assertCreated();
        $submissionId = (string) $created->json('data.id');

        $oldFile = UploadedFile::fake()->createWithContent('old-fm-qad-001.pdf', '%PDF-1.4 old fm-qad bytes');
        $oldContent = (string) file_get_contents((string) $oldFile->getRealPath());
        $this->withToken($token)->postJson("/api/submissions/{$submissionId}/upload-file", [
            'type' => 'fm_qad_001',
            'file' => $oldFile,
        ])->assertOk();
        $oldPath = (string) \Illuminate\Support\Facades\DB::table('indicator_submission_files')
            ->where('indicator_submission_id', (int) $submissionId)
            ->where('type', 'fm_qad_001')
            ->value('path');
        $oldBlob = $this->assertBlobContent($oldPath, $oldContent);

        $this->travel(1)->seconds();
        $newFile = UploadedFile::fake()->createWithContent('new-fm-qad-001.pdf', '%PDF-1.4 new fm-qad bytes');
        $newContent = (string) file_get_contents((string) $newFile->getRealPath());
        $this->withToken($token)->postJson("/api/submissions/{$submissionId}/upload-file", [
            'type' => 'fm_qad_001',
            'file' => $newFile,
        ])->assertOk()
            ->assertJsonPath('data.files.fm_qad_001.originalFilename', 'new-fm-qad-001.pdf');

        $newPath = (string) \Illuminate\Support\Facades\DB::table('indicator_submission_files')
            ->where('indicator_submission_id', (int) $submissionId)
            ->where('type', 'fm_qad_001')
            ->value('path');

        $this->assertSame($oldPath, $newPath);
        $newBlob = $this->assertBlobContent($newPath, $newContent);
        $this->assertSame($oldBlob->id, $newBlob->id);
        $this->assertNotSame($oldBlob->sha256, $newBlob->sha256);
        $this->assertSame(1, IndicatorSubmissionFileBlob::query()
            ->where('indicator_submission_id', (int) $submissionId)
            ->where('type', 'fm_qad_001')
            ->count());
    }

    public function test_replacing_legacy_disk_file_deletes_old_file_and_uses_database_blob(): void
    {
        config()->set('cspams.submission_file_disk', 'submissions');
        Storage::fake('submissions');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ])->assertCreated();
        $submissionId = (string) $created->json('data.id');

        $oldPath = 'submissions/legacy-fm-qad-001.pdf';
        Storage::disk('submissions')->put($oldPath, 'legacy file bytes');
        IndicatorSubmission::query()->findOrFail((int) $submissionId)
            ->submissionFiles()
            ->updateOrCreate(
                ['type' => 'fm_qad_001'],
                [
                    'path' => $oldPath,
                    'original_filename' => 'old-fm-qad-001.pdf',
                    'size_bytes' => strlen('legacy file bytes'),
                    'uploaded_at' => now(),
                ],
            );
        Storage::disk('submissions')->assertExists($oldPath);

        $this->uploadSubmissionDocument($token, $submissionId, 'fm_qad_001', 'new-fm-qad-001.pdf', 'application/pdf')
            ->assertOk()
            ->assertJsonPath('data.files.fm_qad_001.originalFilename', 'new-fm-qad-001.pdf')
            ->assertJsonPath('data.files.fm_qad_001.available', true)
            ->assertJsonPath('data.files.fm_qad_001.missingFromStorage', false);

        $newPath = (string) \Illuminate\Support\Facades\DB::table('indicator_submission_files')
            ->where('indicator_submission_id', (int) $submissionId)
            ->where('type', 'fm_qad_001')
            ->value('path');

        $this->assertSame("database://indicator-submissions/{$submissionId}/fm_qad_001", $newPath);
        $this->assertDatabaseHas('indicator_submission_files', [
            'indicator_submission_id' => (int) $submissionId,
            'type' => 'fm_qad_001',
            'original_filename' => 'new-fm-qad-001.pdf',
        ]);
        $this->assertTrue(app(SubmissionFileBlobStorage::class)->existsForPath($newPath));
        Storage::disk('submissions')->assertMissing($oldPath);
    }

    public function test_submission_file_metadata_reports_missing_storage_without_exposing_unsent_monitor_file(): void
    {
        config()->set('cspams.submission_file_disk', 'submissions');
        Storage::fake('submissions');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        School::query()->whereKey($schoolHead->school_id)->update(['type' => 'private']);
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $schoolHeadToken = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);

        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');

        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'fm_qad_001', 'fm-qad-001.pdf', 'application/pdf')
            ->assertOk();

        $storedPath = (string) \Illuminate\Support\Facades\DB::table('indicator_submission_files')
            ->where('indicator_submission_id', (int) $submissionId)
            ->where('type', 'fm_qad_001')
            ->value('path');

        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();
        $monitorToken = $monitor->createToken('missing-storage-monitor', ['role:monitor'])->plainTextToken;

        $monitorShowBeforeSend = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $monitorShowBeforeSend->assertOk()
            ->assertJsonPath('data.files.fm_qad_001.uploaded', false)
            ->assertJsonPath('data.files.fm_qad_001.available', false)
            ->assertJsonPath('data.files.fm_qad_001.missingFromStorage', false)
            ->assertJsonPath('data.files.fm_qad_001.originalFilename', null)
            ->assertJsonPath('data.files.fm_qad_001.viewUrl', null);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['fm_qad_001'],
        ])->assertOk();

        $this->deleteSubmissionStoragePath($storedPath);

        $schoolHeadShow = $this->withToken($schoolHeadToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $schoolHeadShow->assertOk()
            ->assertJsonPath('data.files.fm_qad_001.uploaded', true)
            ->assertJsonPath('data.files.fm_qad_001.available', false)
            ->assertJsonPath('data.files.fm_qad_001.missingFromStorage', true)
            ->assertJsonPath('data.files.fm_qad_001.originalFilename', 'fm-qad-001.pdf')
            ->assertJsonPath('data.files.fm_qad_001.viewUrl', null)
            ->assertJsonPath('data.files.fm_qad_001.downloadUrl', null);

        $monitorShowAfterSend = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $monitorShowAfterSend->assertOk()
            ->assertJsonPath('data.files.fm_qad_001.uploaded', true)
            ->assertJsonPath('data.files.fm_qad_001.available', false)
            ->assertJsonPath('data.files.fm_qad_001.missingFromStorage', true)
            ->assertJsonPath('data.files.fm_qad_001.originalFilename', 'fm-qad-001.pdf')
            ->assertJsonPath('data.files.fm_qad_001.viewUrl', null)
            ->assertJsonPath('data.files.fm_qad_001.downloadUrl', null);

        $this->withToken($monitorToken)
            ->get("/api/submissions/{$submissionId}/view/fm_qad_001")
            ->assertStatus(Response::HTTP_NOT_FOUND);

        $this->withToken($monitorToken)
            ->get("/api/submissions/{$submissionId}/download/fm_qad_001")
            ->assertStatus(Response::HTTP_NOT_FOUND);
    }

    public function test_final_submit_fails_when_required_file_storage_is_missing(): void
    {
        config()->set('cspams.submission_file_disk', 'submissions');
        Storage::fake('submissions');
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
        $this->uploadSubmissionFiles($token, $submissionId, ['bmef', 'smea']);

        $missingPath = (string) \Illuminate\Support\Facades\DB::table('indicator_submissions')
            ->where('id', (int) $submissionId)
            ->value('bmef_file_path');
        $this->deleteSubmissionStoragePath($missingPath);

        $submit = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit");
        $submit->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonPath('errors.submission.0', 'Submission is incomplete. Missing: BMEF file is missing from storage; re-upload before submitting.');

        $this->assertDatabaseHas('indicator_submissions', [
            'id' => (int) $submissionId,
            'status' => 'draft',
        ]);
    }

    public function test_private_school_final_submit_fails_when_required_fm_qad_storage_is_missing(): void
    {
        config()->set('cspams.submission_file_disk', 'submissions');
        Storage::fake('submissions');
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
        $created->assertCreated();
        $submissionId = (string) $created->json('data.id');
        $this->uploadSubmissionFiles($token, $submissionId, SubmissionFileDefinition::nonCoreTypes());

        $missingPath = (string) \Illuminate\Support\Facades\DB::table('indicator_submission_files')
            ->where('indicator_submission_id', (int) $submissionId)
            ->where('type', 'fm_qad_001')
            ->value('path');
        $this->assertSubmissionStorageExists($missingPath);
        $this->deleteSubmissionStoragePath($missingPath);

        $submit = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit");
        $submit->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonPath(
                'errors.submission.0',
                'Submission is incomplete. Missing: ' . SubmissionFileDefinition::shortLabelFor('fm_qad_001') . ' file is missing from storage; re-upload before submitting.',
            );

        $this->assertDatabaseHas('indicator_submissions', [
            'id' => (int) $submissionId,
            'status' => 'draft',
        ]);
    }

    public function test_file_scope_send_fails_when_physical_file_is_missing(): void
    {
        config()->set('cspams.submission_file_disk', 'submissions');
        Storage::fake('submissions');
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
        $missingPath = (string) \Illuminate\Support\Facades\DB::table('indicator_submissions')
            ->where('id', (int) $submissionId)
            ->value('bmef_file_path');
        $this->deleteSubmissionStoragePath($missingPath);

        $send = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ]);
        $send->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonPath('errors.targets.0', 'Submission scope is incomplete. Missing: BMEF file is missing from storage; re-upload before sending.');

        $this->assertDatabaseMissing('indicator_submission_scope_submissions', [
            'indicator_submission_id' => (int) $submissionId,
            'scope_id' => 'bmef',
        ]);

        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();
        $monitorToken = $monitor->createToken('missing-storage-unsent-monitor', ['role:monitor'])->plainTextToken;
        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ])->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonPath('errors.submission.0', 'Only sent indicator scopes can be reviewed.');
    }

    public function test_private_school_fm_qad_scope_send_fails_when_storage_is_missing(): void
    {
        config()->set('cspams.submission_file_disk', 'submissions');
        Storage::fake('submissions');
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
        $missingPath = (string) \Illuminate\Support\Facades\DB::table('indicator_submission_files')
            ->where('indicator_submission_id', (int) $submissionId)
            ->where('type', 'fm_qad_001')
            ->value('path');
        $this->deleteSubmissionStoragePath($missingPath);

        $send = $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['fm_qad_001'],
        ]);
        $send->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonPath(
                'errors.targets.0',
                'Submission scope is incomplete. Missing: ' . SubmissionFileDefinition::shortLabelFor('fm_qad_001') . ' file is missing from storage; re-upload before sending.',
            );

        $this->assertDatabaseMissing('indicator_submission_scope_submissions', [
            'indicator_submission_id' => (int) $submissionId,
            'scope_id' => 'fm_qad_001',
        ]);
    }

    public function test_monitor_cannot_review_sent_file_when_storage_is_missing(): void
    {
        config()->set('cspams.submission_file_disk', 'submissions');
        Storage::fake('submissions');
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
        $storedPath = (string) \Illuminate\Support\Facades\DB::table('indicator_submissions')
            ->where('id', (int) $submissionId)
            ->value('bmef_file_path');

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();
        $this->deleteSubmissionStoragePath($storedPath);

        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();
        $monitorToken = $monitor->createToken('missing-storage-review-monitor', ['role:monitor'])->plainTextToken;

        $review = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ]);
        $review->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonPath('errors.scopeId.0', 'This submitted file is missing from storage. Ask the School Head to re-upload and resend it before review.');

        $this->assertDatabaseMissing('indicator_submission_scope_reviews', [
            'indicator_submission_id' => (int) $submissionId,
            'scope_id' => 'bmef',
            'decision' => 'verified',
        ]);
    }

    public function test_monitor_cannot_review_sent_private_fm_qad_when_storage_is_missing(): void
    {
        config()->set('cspams.submission_file_disk', 'submissions');
        Storage::fake('submissions');
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        School::query()->whereKey($schoolHead->school_id)->update(['type' => 'private']);
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $schoolHeadToken = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);
        $created->assertCreated();
        $submissionId = (string) $created->json('data.id');

        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'fm_qad_001', 'fm-qad-001.pdf', 'application/pdf')
            ->assertOk();
        $storedPath = (string) \Illuminate\Support\Facades\DB::table('indicator_submission_files')
            ->where('indicator_submission_id', (int) $submissionId)
            ->where('type', 'fm_qad_001')
            ->value('path');

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['fm_qad_001'],
        ])->assertOk();
        $this->deleteSubmissionStoragePath($storedPath);

        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();
        $monitorToken = $monitor->createToken('missing-storage-fm-qad-review-monitor', ['role:monitor'])->plainTextToken;

        $review = $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'fm_qad_001',
            'decision' => 'verified',
        ]);
        $review->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonPath('errors.scopeId.0', 'This submitted file is missing from storage. Ask the School Head to re-upload and resend it before review.');

        $this->assertDatabaseMissing('indicator_submission_scope_reviews', [
            'indicator_submission_id' => (int) $submissionId,
            'scope_id' => 'fm_qad_001',
            'decision' => 'verified',
        ]);
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
        $this->assertSubmissionStorageExists($storedPath);
        $this->assertDatabaseHas('indicator_submission_files', [
            'indicator_submission_id' => (int) $submissionId,
            'type' => 'fm_qad_001',
            'path' => $storedPath,
        ]);

        $this->withToken($token)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['fm_qad_001'],
        ])->assertOk();
        $this->assertDatabaseHas('indicator_submission_scope_submissions', [
            'indicator_submission_id' => (int) $submissionId,
            'scope_id' => 'fm_qad_001',
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

        $this->assertSubmissionStorageMissing($storedPath);
        $this->assertDatabaseMissing('indicator_submission_files', [
            'indicator_submission_id' => (int) $submissionId,
            'type' => 'fm_qad_001',
        ]);
        $this->assertDatabaseMissing('indicator_submission_scope_submissions', [
            'indicator_submission_id' => (int) $submissionId,
            'scope_id' => 'fm_qad_001',
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
        config()->set('cspams.submission_file_disk', 'local');
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
        $this->assertSame("database://indicator-submissions/{$submissionId}/bmef", $submissionRow->bmef_file_path);
        $this->assertSame("database://indicator-submissions/{$submissionId}/smea", $submissionRow->smea_file_path);
        $this->assertSubmissionStorageExists((string) $submissionRow->bmef_file_path);
        $this->assertSubmissionStorageExists((string) $submissionRow->smea_file_path);
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

        $this->assertDatabaseHas('indicator_submission_scope_submissions', [
            'indicator_submission_id' => $submissionId,
            'scope_id' => 'bmef',
            'scope_type' => 'file',
            'submitted_by' => $schoolHead->id,
        ]);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();
        $this->assertSame(1, IndicatorSubmissionScopeSubmission::query()
            ->where('indicator_submission_id', $submissionId)
            ->where('scope_id', 'bmef')
            ->count());

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

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'returned',
        ])->assertOk();

        $this->assertDatabaseMissing('indicator_submission_scope_submissions', [
            'indicator_submission_id' => $submissionId,
            'scope_id' => 'bmef',
        ]);

        $monitorShowAfterReturn = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $monitorShowAfterReturn->assertOk()
            ->assertJsonPath('data.files.bmef.uploaded', false)
            ->assertJsonPath('data.files.bmef.viewUrl', null)
            ->assertJsonPath('data.files.bmef.downloadUrl', null);

        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef-revised.pdf', 'application/pdf')
            ->assertOk();
        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();

        $this->assertDatabaseHas('indicator_submission_scope_submissions', [
            'indicator_submission_id' => $submissionId,
            'scope_id' => 'bmef',
        ]);

        $monitorShowAfterResend = $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}");
        $monitorShowAfterResend->assertOk()
            ->assertJsonPath('data.scopeProgress.submittedScopeIds', ['bmef'])
            ->assertJsonPath('data.files.bmef.uploaded', true)
            ->assertJsonPath('data.files.bmef.originalFilename', 'bmef-revised.pdf')
            ->assertJsonPath('data.files.bmef.viewUrl', "/api/submissions/{$submissionId}/view/bmef")
            ->assertJsonPath('data.files.bmef.downloadUrl', "/api/submissions/{$submissionId}/download/bmef");
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
     * @return array{0: string, 1: string}
     */
    private function createStorageAuditSubmission(): array
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $created = $this->withToken($token)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ])->assertCreated();

        IndicatorSubmission::query()->update([
            'bmef_file_path' => null,
            'bmef_original_filename' => null,
            'bmef_uploaded_at' => null,
            'bmef_file_size' => null,
            'smea_file_path' => null,
            'smea_original_filename' => null,
            'smea_uploaded_at' => null,
            'smea_file_size' => null,
        ]);
        \Illuminate\Support\Facades\DB::table('indicator_submission_files')->delete();
        IndicatorSubmissionFileBlob::query()->delete();

        return [$token, (string) $created->json('data.id')];
    }

    /**
     * @param array<string, mixed> $options
     *
     * @return array{0: int, 1: array<string, mixed>, 2: string}
     */
    private function callSubmissionStorageAudit(array $options = []): array
    {
        $exitCode = Artisan::call('cspams:audit-submission-storage', [
            '--json' => true,
            ...$options,
        ]);
        $output = Artisan::output();
        $audit = json_decode($output, true);

        $this->assertIsArray($audit, $output);

        return [$exitCode, $audit, $output];
    }

    /**
     * @param array<string, mixed> $audit
     */
    private function assertAuditRow(
        array $audit,
        int $submissionId,
        string $type,
        string $status,
        string $action,
        bool $exists,
    ): void {
        $row = collect($audit['rows'] ?? [])
            ->first(static fn (mixed $row): bool => is_array($row)
                && (int) ($row['submission_id'] ?? 0) === $submissionId
                && ($row['type'] ?? null) === $type);

        $this->assertIsArray($row, json_encode($audit, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) ?: '');
        $this->assertSame($status, $row['status'] ?? null);
        $this->assertSame($action, $row['action'] ?? null);
        $this->assertSame($exists, (bool) ($row['exists'] ?? null));
    }

    private function assertResponseBodyMatches(mixed $response, string $expectedContent): void
    {
        $content = $response->getContent();
        if ($content !== false) {
            $this->assertSame($expectedContent, $content);

            return;
        }

        $baseResponse = $response->baseResponse ?? null;
        if (is_object($baseResponse) && method_exists($baseResponse, 'getFile')) {
            $this->assertSame($expectedContent, (string) file_get_contents($baseResponse->getFile()->getPathname()));

            return;
        }

        if ($baseResponse instanceof \Symfony\Component\HttpFoundation\StreamedResponse && method_exists($response, 'streamedContent')) {
            $this->assertSame($expectedContent, $response->streamedContent());

            return;
        }

        $this->fail('Response did not expose body content or a response file.');
    }

    private function assertSubmissionStorageExists(string $path): void
    {
        if (app(SubmissionFileBlobStorage::class)->isDatabasePath($path)) {
            $this->assertTrue(app(SubmissionFileBlobStorage::class)->existsForPath($path));

            return;
        }

        Storage::disk((string) config('cspams.submission_file_disk', 'local'))->assertExists($path);
    }

    private function assertSubmissionStorageMissing(string $path): void
    {
        if (app(SubmissionFileBlobStorage::class)->isDatabasePath($path)) {
            $this->assertFalse(app(SubmissionFileBlobStorage::class)->existsForPath($path));

            return;
        }

        Storage::disk((string) config('cspams.submission_file_disk', 'local'))->assertMissing($path);
    }

    private function deleteSubmissionStoragePath(string $path): void
    {
        if (app(SubmissionFileBlobStorage::class)->isDatabasePath($path)) {
            app(SubmissionFileBlobStorage::class)->deleteForPath($path);

            return;
        }

        Storage::disk((string) config('cspams.submission_file_disk', 'local'))->delete($path);
    }

    private function assertBlobContent(string $path, string $expectedContent): IndicatorSubmissionFileBlob
    {
        $blob = app(SubmissionFileBlobStorage::class)->findForPath($path);

        $this->assertNotNull($blob);
        $this->assertSame(strlen($expectedContent), (int) $blob->size_bytes);
        $this->assertSame(hash('sha256', $expectedContent), $blob->sha256);
        $this->assertSame($expectedContent, app(SubmissionFileBlobStorage::class)->contentAsString($blob));

        return $blob;
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
