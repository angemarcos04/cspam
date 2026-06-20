<?php

namespace Tests\Feature;

use App\Events\CspamsUpdateBroadcast;
use App\Models\IndicatorSubmission;
use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\PerformanceMetric;
use App\Models\User;
use Database\Seeders\DemoDataSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;
use Tests\TestCase;

class IndicatorAuditTrailTest extends TestCase
{
    use RefreshDatabase;

    public function test_indicator_workflow_writes_safe_audit_trail_entries(): void
    {
        $this->seedIndicatorFixtures();
        Storage::fake('local');
        Event::fake([CspamsUpdateBroadcast::class]);

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();
        $schoolHeadToken = $schoolHead->createToken('audit-school-head', ['role:school_head'])->plainTextToken;
        $monitorToken = $monitor->createToken('audit-monitor', ['role:monitor'])->plainTextToken;

        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $academicYearLabel = (string) AcademicYear::query()->whereKey($academicYearId)->value('name');
        $metricId = (int) PerformanceMetric::query()->where('code', 'IMETA_HEAD_NAME')->value('id');

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => [
                [
                    'metric_id' => $metricId,
                    'actual' => ['values' => [$academicYearLabel => 'Maria Santos']],
                ],
            ],
        ]);

        $created->assertStatus(Response::HTTP_CREATED);
        $submissionId = (string) $created->json('data.id');

        $this->withToken($schoolHeadToken)->postJson("/api/submissions/{$submissionId}/upload-file", [
            'type' => 'bmef',
            'file' => UploadedFile::fake()->create('bmef-report.pdf', 64, 'application/pdf'),
        ])->assertOk();

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();

        $this->withToken($monitorToken)
            ->get("/api/submissions/{$submissionId}/view/bmef")
            ->assertOk();

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'returned',
            'notes' => null,
        ])->assertOk();

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();

        $this->assertDatabaseHas('audit_logs', ['action' => 'workspace.section_saved']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'workspace.file_saved']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'submission.file_sent']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'submission.file_resent']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'monitor.file_previewed']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'monitor.scope_returned']);

        Event::assertDispatched(CspamsUpdateBroadcast::class, function (CspamsUpdateBroadcast $event): bool {
            return ($event->payload['entity'] ?? null) === 'audit'
                && ($event->payload['eventType'] ?? null) === 'audit.log_created'
                && ($event->payload['auditAction'] ?? null) === 'workspace.file_saved'
                && ! array_key_exists('path', $event->payload)
                && ! array_key_exists('file_path', $event->payload)
                && ! array_key_exists('downloadUrl', $event->payload)
                && ! array_key_exists('notes', $event->payload);
        });

        /** @var AuditLog $fileAudit */
        $fileAudit = AuditLog::query()->where('action', 'workspace.file_saved')->latest('id')->firstOrFail();
        $this->assertSame('bmef', data_get($fileAudit->metadata, 'file_type'));
        $this->assertSame('BMEF', data_get($fileAudit->metadata, 'file_label'));
        $this->assertSame('bmef-report.pdf', data_get($fileAudit->metadata, 'original_filename'));
        $this->assertArrayNotHasKey('path', $fileAudit->metadata ?? []);

        $auditResponse = $this->withToken($monitorToken)->getJson("/api/audit-logs?submission_id={$submissionId}&per_page=20");
        $auditResponse->assertOk()
            ->assertJsonPath('data.0.submissionId', $submissionId)
            ->assertJsonMissingPath('data.0.details.path')
            ->assertJsonMissingPath('data.0.details.file_path')
            ->assertJsonMissingPath('data.0.details.downloadUrl')
            ->assertJsonPath('data', function (array $rows): bool {
                $actions = collect($rows)->pluck('eventType')->all();

                return in_array('workspace.file_saved', $actions, true)
                    && in_array('submission.file_sent', $actions, true)
                    && in_array('submission.file_resent', $actions, true)
                    && in_array('monitor.scope_returned', $actions, true);
            });
    }

    public function test_monitor_report_view_is_logged_only_by_explicit_report_view_endpoint(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();
        $schoolHeadToken = $schoolHead->createToken('audit-school-head-report', ['role:school_head'])->plainTextToken;
        $monitorToken = $monitor->createToken('audit-monitor-report', ['role:monitor'])->plainTextToken;

        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');

        $created = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);
        $created->assertCreated();

        $submissionId = (string) $created->json('data.id');
        IndicatorSubmission::query()
            ->whereKey($submissionId)
            ->update([
                'status' => 'submitted',
                'submitted_at' => now(),
                'submitted_by' => $schoolHead->id,
            ]);

        $this->withToken($monitorToken)->getJson("/api/indicators/submissions/{$submissionId}")
            ->assertOk();
        $this->assertDatabaseMissing('audit_logs', [
            'action' => 'monitor.report_viewed',
            'auditable_id' => $submissionId,
        ]);

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/report-viewed", [
            'scopeId' => 'school_achievements_learning_outcomes',
        ])->assertOk()
            ->assertJsonPath('data.logged', true);

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'monitor.report_viewed',
            'auditable_id' => $submissionId,
        ]);
    }

    public function test_school_head_audit_api_is_scoped_to_own_school(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $firstSchoolHead */
        $firstSchoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        /** @var User $secondSchoolHead */
        $secondSchoolHead = User::query()->where('email', 'schoolhead2@cspams.local')->firstOrFail();

        AuditLog::query()->create([
            'user_id' => $firstSchoolHead->id,
            'action' => 'workspace.section_saved',
            'auditable_type' => 'test',
            'auditable_id' => 1,
            'metadata' => [
                'school_id' => (string) $firstSchoolHead->school_id,
                'school_code' => (string) $firstSchoolHead->school?->school_code,
                'submission_id' => '1',
            ],
            'created_at' => now(),
        ]);

        AuditLog::query()->create([
            'user_id' => $secondSchoolHead->id,
            'action' => 'workspace.section_saved',
            'auditable_type' => 'test',
            'auditable_id' => 2,
            'metadata' => [
                'school_id' => (string) $secondSchoolHead->school_id,
                'school_code' => (string) $secondSchoolHead->school?->school_code,
                'submission_id' => '2',
            ],
            'created_at' => now(),
        ]);

        $token = $firstSchoolHead->createToken('audit-school-head-scope', ['role:school_head'])->plainTextToken;

        $response = $this->withToken($token)->getJson('/api/audit-logs?per_page=20');
        $response->assertOk()
            ->assertJsonPath('data', function (array $rows) use ($firstSchoolHead, $secondSchoolHead): bool {
                $schoolIds = collect($rows)->pluck('school.id')->filter()->unique()->values()->all();

                return in_array((string) $firstSchoolHead->school_id, $schoolIds, true)
                    && ! in_array((string) $secondSchoolHead->school_id, $schoolIds, true);
            });
    }

    public function test_school_head_mine_filter_only_returns_own_security_activity(): void
    {
        $this->seedIndicatorFixtures();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $schoolHead->loadMissing('school');
        $otherSchoolUser = User::query()->create([
            'name' => 'Other School Audit User',
            'email' => 'other-school-audit-user@cspams.local',
            'password' => (string) $schoolHead->password,
            'must_reset_password' => false,
            'password_changed_at' => now(),
            'account_status' => $schoolHead->getRawOriginal('account_status'),
            'school_id' => $schoolHead->school_id,
        ]);

        AuditLog::query()->create([
            'user_id' => $schoolHead->id,
            'action' => 'auth.login.success',
            'auditable_type' => 'auth',
            'auditable_id' => $schoolHead->id,
            'metadata' => [
                'school_id' => (string) $schoolHead->school_id,
                'school_code' => (string) $schoolHead->school?->school_code,
                'actor_role' => 'school_head',
                'outcome' => 'success',
            ],
            'created_at' => now(),
        ]);
        AuditLog::query()->create([
            'user_id' => $otherSchoolUser->id,
            'action' => 'auth.login.success',
            'auditable_type' => 'auth',
            'auditable_id' => $otherSchoolUser->id,
            'metadata' => [
                'school_id' => (string) $schoolHead->school_id,
                'school_code' => (string) $schoolHead->school?->school_code,
                'actor_role' => 'school_head',
                'outcome' => 'success',
            ],
            'created_at' => now()->addSecond(),
        ]);

        $token = $schoolHead->createToken('audit-security-activity', ['role:school_head'])->plainTextToken;
        $response = $this->withToken($token)->getJson('/api/audit-logs?mine=true&event_prefix=auth.&per_page=20');

        $response->assertOk()
            ->assertJsonPath('data', function (array $rows) use ($schoolHead, $otherSchoolUser): bool {
                $actorIds = collect($rows)->pluck('actor.id')->filter()->unique()->values()->all();

                return in_array((string) $schoolHead->id, $actorIds, true)
                    && ! in_array((string) $otherSchoolUser->id, $actorIds, true);
            });
    }

    private function seedIndicatorFixtures(): void
    {
        $this->seed([
            RolesAndPermissionsSeeder::class,
            DemoDataSeeder::class,
        ]);
    }
}
