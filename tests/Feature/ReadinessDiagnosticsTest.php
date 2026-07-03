<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ReadinessDiagnosticsTest extends TestCase
{
    use RefreshDatabase;

    public function test_readiness_diagnostics_are_disabled_without_token_configuration(): void
    {
        config()->set('diagnostics.queue.token', null);

        $this->getJson('/api/ops/readiness?token=anything')
            ->assertNotFound();
    }

    public function test_readiness_diagnostics_require_matching_token(): void
    {
        config()->set('diagnostics.queue.token', 'correct-token');

        $this->getJson('/api/ops/readiness?token=wrong-token')
            ->assertNotFound();
    }

    public function test_readiness_diagnostics_report_safe_runtime_checks(): void
    {
        config()->set('diagnostics.queue.token', 'diagnostic-token');
        config()->set('queue.default', 'database');
        config()->set('auth_mfa.monitor.enabled', true);
        config()->set('auth_mfa.monitor.delivery_mode', 'queued');
        config()->set('auth_mfa.monitor.queue_connection', 'database');
        config()->set('auth_mfa.monitor.queue', 'mail');
        config()->set('cspams.school_reminders.delivery_mode', 'queued');
        config()->set('mail.default', 'resend');
        config()->set('mail.from.address', 'monitor@example.test');
        config()->set('services.resend.key', 'secret-resend-key');
        config()->set('cspams.submission_file_disk', 'submissions');
        Storage::fake('submissions');

        $response = $this->getJson('/api/ops/readiness?token=diagnostic-token')
            ->assertOk()
            ->assertJsonPath('app', 'cspams')
            ->assertJsonPath('checks.database.connected', true)
            ->assertJsonPath('checks.tables.accountSetupTokens.required', true)
            ->assertJsonPath('checks.tables.notifications.required', true)
            ->assertJsonPath('checks.tables.jobs.required', true)
            ->assertJsonPath('checks.tables.monitorMfaResetTickets.required', true)
            ->assertJsonPath('checks.notifications.status', 'ok')
            ->assertJsonPath('checks.notifications.table', true)
            ->assertJsonPath('checks.notifications.clearedAtColumn', true)
            ->assertJsonPath('checks.dashboard.tables.schools.required', true)
            ->assertJsonPath('checks.dashboard.tables.users.required', true)
            ->assertJsonPath('checks.dashboard.tables.personalAccessTokens.required', true)
            ->assertJsonPath('checks.dashboard.tables.academicYears.required', true)
            ->assertJsonPath('checks.dashboard.tables.indicatorSubmissions.required', true)
            ->assertJsonPath('checks.dashboard.tables.indicatorSubmissionScopeReviews.required', true)
            ->assertJsonPath('checks.dashboard.tables.indicatorSubmissionScopeSubmissions.required', true)
            ->assertJsonPath('checks.dashboard.tables.notifications.required', true)
            ->assertJsonPath('checks.dashboard.tables.students.required', true)
            ->assertJsonPath('checks.dashboard.tables.teachers.required', true)
            ->assertJsonPath('checks.dashboard.tables.performanceMetrics.required', true)
            ->assertJsonPath('checks.dashboard.tables.indicatorSubmissionItems.required', true)
            ->assertJsonPath('checks.dashboard.tables.jobs.required', true)
            ->assertJsonPath('checks.dashboard.columns.students.status', 'ok')
            ->assertJsonPath('checks.dashboard.columns.schools.status', 'ok')
            ->assertJsonPath('checks.dashboard.columns.academicYears.status', 'ok')
            ->assertJsonPath('checks.dashboard.columns.performanceMetrics.status', 'ok')
            ->assertJsonPath('checks.dashboard.columns.indicatorSubmissionItems.status', 'ok')
            ->assertJsonPath('checks.dashboard.data.students.status', 'ok')
            ->assertJsonPath('checks.dashboard.data.students.invalidStatusCount', 0)
            ->assertJsonPath('checks.dashboard.data.students.invalidRiskLevelCount', 0)
            ->assertJsonPath('checks.queue.defaultDriver', 'database')
            ->assertJsonPath('checks.mail.defaultDriver', 'resend')
            ->assertJsonPath('checks.mail.fromConfigured', true)
            ->assertJsonPath('checks.mail.resendKeyConfigured', true)
            ->assertJsonPath('checks.monitorMfa.enabled', true)
            ->assertJsonPath('checks.monitorMfa.deliveryMode', 'queued')
            ->assertJsonPath('checks.schoolReminders.deliveryMode', 'queued')
            ->assertJsonPath('checks.submissionStorage.status', 'ok')
            ->assertJsonPath('checks.submissionStorage.diskConfigured', true)
            ->assertJsonPath('checks.submissionStorage.diskName', 'submissions')
            ->assertJsonPath('checks.submissionStorage.canWriteReadDelete', true)
            ->assertJsonPath('checks.submissionStorage.databaseBlobTableExists', true)
            ->assertJsonPath('checks.submissionStorage.databaseBlobReadable', true)
            ->assertJsonPath('checks.submissionStorage.databaseBlobColumnsReady', true)
            ->assertJsonPath('checks.submissionStorage.databaseBlobMissingColumns', [])
            ->assertJsonPath('checks.submissionStorage.databaseBlobContentColumnTypeReady', true)
            ->assertJsonPath('checks.submissionStorage.databaseBlobSchemaReady', true)
            ->assertJsonPath('checks.submissionStorage.databaseBlobReady', true);

        $this->assertIsBool($response->json('checks.tables.accountSetupTokens.exists'));
        $this->assertIsBool($response->json('checks.tables.notifications.exists'));
        $this->assertIsBool($response->json('checks.tables.jobs.exists'));
        $this->assertIsBool($response->json('checks.tables.monitorMfaResetTickets.exists'));
        $this->assertIsBool($response->json('checks.dashboard.tables.schools.exists'));
        $this->assertIsBool($response->json('checks.dashboard.tables.users.exists'));
        $this->assertIsBool($response->json('checks.dashboard.tables.personalAccessTokens.exists'));
        $this->assertIsBool($response->json('checks.dashboard.tables.indicatorSubmissions.exists'));
        $this->assertIsArray($response->json('checks.columns.userFlags.missing'));
        $this->assertSame([], $response->json('checks.dashboard.columns.students.missing'));
        $this->assertSame([], $response->json('checks.dashboard.columns.schools.missing'));
        $this->assertSame([], $response->json('checks.dashboard.columns.performanceMetrics.missing'));
        $this->assertSame([], $response->json('checks.dashboard.columns.indicatorSubmissionItems.missing'));
        $this->assertSame([], $response->json('checks.dashboard.data.students.invalidStatuses'));
        $this->assertSame([], $response->json('checks.dashboard.data.students.invalidRiskLevels'));
        $this->assertIsArray($response->json('checks.dashboard.columns.users.missing'));
        $this->assertIsArray($response->json('checks.dashboard.columns.indicatorSubmissions.missing'));

        $content = $response->getContent();
        $this->assertStringNotContainsString('secret-resend-key', $content);
        $this->assertStringNotContainsString('monitor@example.test', $content);
        $this->assertStringNotContainsString('diagnostic-token', $content);
        $this->assertStringNotContainsString((string) storage_path(), $content);
        $this->assertStringNotContainsString('password', strtolower($content));
        $this->assertStringNotContainsString('token_hash', $content);
    }

    public function test_readiness_reports_invalid_student_status_data_without_identity_leaks(): void
    {
        config()->set('diagnostics.queue.token', 'diagnostic-token');

        DB::table('schools')->insert([
            'id' => 50001,
            'school_code' => '990001',
            'school_code_normalized' => '990001',
            'name' => 'Private Student Validity School',
            'district' => 'Private District',
            'status' => 'active',
            'region' => 'Region II',
            'type' => 'public',
            'level' => 'Elementary',
            'reported_student_count' => 0,
            'reported_teacher_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('academic_years')->insert([
            'id' => 50001,
            'name' => '2099-2100',
            'start_date' => '2099-06-01',
            'end_date' => '2100-03-31',
            'is_current' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('students')->insert([
            'school_id' => 50001,
            'academic_year_id' => 50001,
            'lrn' => 'PRIVATE-LRN-900001',
            'first_name' => 'Private',
            'middle_name' => null,
            'last_name' => 'Learner',
            'sex' => 'female',
            'birth_date' => '2012-01-01',
            'status' => 'legacy_invalid_status',
            'risk_level' => 'legacy_invalid_risk',
            'tracked_from_level' => 'Grade 1',
            'current_level' => 'Grade 6',
            'section_name' => 'Private Section',
            'teacher_name' => 'Private Teacher',
            'last_status_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->getJson('/api/ops/readiness?token=diagnostic-token')
            ->assertOk()
            ->assertJsonPath('checks.dashboard.data.students.status', 'warning')
            ->assertJsonPath('checks.dashboard.data.students.invalidStatuses', ['legacy_invalid_status'])
            ->assertJsonPath('checks.dashboard.data.students.invalidRiskLevels', ['legacy_invalid_risk'])
            ->assertJsonPath('checks.dashboard.data.students.invalidStatusCount', 1)
            ->assertJsonPath('checks.dashboard.data.students.invalidRiskLevelCount', 1);

        $content = $response->getContent();
        $this->assertStringNotContainsString('PRIVATE-LRN-900001', $content);
        $this->assertStringNotContainsString('Private Learner', $content);
        $this->assertStringNotContainsString('Private Student Validity School', $content);
        $this->assertStringNotContainsString('Private Teacher', $content);
    }

    public function test_readiness_diagnostics_accept_header_token(): void
    {
        config()->set('diagnostics.queue.token', 'diagnostic-token');

        $this->withHeader('X-CSPAMS-Diagnostics-Token', 'diagnostic-token')
            ->getJson('/api/ops/readiness')
            ->assertOk()
            ->assertJsonPath('app', 'cspams');
    }
}
