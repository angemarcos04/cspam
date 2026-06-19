<?php

use App\Models\School;
use App\Models\User;
use App\Providers\AppServiceProvider;
use App\Support\Auth\UserRoleResolver;
use App\Support\Integrity\SchoolHeadDataIntegrityAudit;
use App\Support\Indicators\RollingIndicatorYearWindow;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('cspams:sync-rolling-years', function (): int {
    $result = app(RollingIndicatorYearWindow::class)->sync();

    $this->info('Indicator school-year window synchronized.');
    $this->line('Years: ' . implode(', ', $result['years']));
    $this->line('Metric schemas updated: ' . $result['metricsUpdated']);
    $this->line('Submission matrix rows pruned: ' . $result['itemsUpdated']);
    return self::SUCCESS;
})->purpose('Synchronize rolling academic-year windows and purge out-of-window indicator data.');

Artisan::command('indicators:sync-year-window', function (): int {
    return $this->call('cspams:sync-rolling-years');
})->purpose('Alias for cspams:sync-rolling-years.');

Schedule::command('cspams:sync-rolling-years')
    ->dailyAt('00:05');

Artisan::command('accounts:sync-school-head-account-type', function (): void {
    if (! Schema::hasTable('users') || ! Schema::hasColumn('users', 'account_type')) {
        $this->error('School Head account_type storage is unavailable. Run database migrations first.');
        return;
    }

    if (! Schema::hasTable('roles') || ! Schema::hasTable('model_has_roles')) {
        $this->error('Role tables are unavailable. Run database migrations first.');
        return;
    }

    $roleId = DB::table('roles')
        ->where('name', UserRoleResolver::SCHOOL_HEAD)
        ->value('id');

    if ($roleId === null) {
        $this->warn('No school_head role found. Seed roles and permissions first.');
        return;
    }

    $userIds = DB::table('model_has_roles')
        ->where('role_id', $roleId)
        ->where('model_type', 'App\\Models\\User')
        ->pluck('model_id')
        ->map(static fn (mixed $id): int => (int) $id)
        ->values()
        ->all();

    if ($userIds === []) {
        $this->info('No School Head users found. Nothing to update.');
        return;
    }

    $duplicateSchoolIds = DB::table('users')
        ->select('school_id')
        ->whereIn('id', $userIds)
        ->whereNotNull('school_id')
        ->groupBy('school_id')
        ->havingRaw('COUNT(*) > 1')
        ->limit(10)
        ->pluck('school_id')
        ->filter(static fn (mixed $value): bool => is_scalar($value) && (string) $value !== '')
        ->map(static fn (mixed $value): string => (string) $value)
        ->values();

    if ($duplicateSchoolIds->isNotEmpty()) {
        $this->error(
            'Duplicate School Head role assignments detected for school_id(s): '
            . $duplicateSchoolIds->implode(', ')
        );
        $this->line('Resolve duplicates first, then re-run this command.');
        return;
    }

    $updated = DB::table('users')
        ->whereIn('id', $userIds)
        ->update(['account_type' => UserRoleResolver::SCHOOL_HEAD]);

    $this->info('School Head account_type synchronized.');
    $this->line('Updated users: ' . $updated);
})->purpose('Backfill users.account_type for School Head accounts based on role assignments.');

Artisan::command('accounts:audit-school-head-duplicates', function (): int {
    if (! Schema::hasTable('users') || ! Schema::hasColumn('users', 'school_id')) {
        $this->error('School Head account storage is unavailable. Run database migrations first.');
        return self::FAILURE;
    }

    $query = DB::table('users')
        ->select('school_id', DB::raw('COUNT(*) as total'))
        ->whereNotNull('school_id')
        ->groupBy('school_id')
        ->havingRaw('COUNT(*) > 1');

    if (Schema::hasColumn('users', 'account_type')) {
        $query->where('account_type', UserRoleResolver::SCHOOL_HEAD);
    } elseif (Schema::hasTable('roles') && Schema::hasTable('model_has_roles')) {
        $roleId = DB::table('roles')
            ->where('name', UserRoleResolver::SCHOOL_HEAD)
            ->value('id');

        if ($roleId === null) {
            $this->warn('No school_head role found. Seed roles and permissions first.');
            return self::FAILURE;
        }

        $userIds = DB::table('model_has_roles')
            ->where('role_id', $roleId)
            ->where('model_type', 'App\\Models\\User')
            ->pluck('model_id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->values()
            ->all();

        if ($userIds === []) {
            $this->info('No School Head users found.');
            return self::SUCCESS;
        }

        $query->whereIn('id', $userIds);
    } else {
        $this->error('Cannot audit School Head duplicates because neither users.account_type nor role tables are available.');
        return self::FAILURE;
    }

    $duplicates = $query
        ->orderBy('school_id')
        ->limit(20)
        ->get();

    if ($duplicates->isEmpty()) {
        $this->info('No duplicate School Head accounts detected.');
        return self::SUCCESS;
    }

    $this->error('Duplicate School Head accounts detected.');

    foreach ($duplicates as $duplicate) {
        $this->line(sprintf(
            '  school_id=%s total=%s',
            (string) $duplicate->school_id,
            (string) $duplicate->total,
        ));
    }

    $this->newLine();
    $this->line('Resolve duplicate School Head records before enforcing one-School-Head-per-school uniqueness.');

    return self::FAILURE;
})->purpose('Audit duplicate School Head accounts grouped by school_id.');

Artisan::command('indicators:audit-school-head-data-integrity', function (): int {
    $report = app(SchoolHeadDataIntegrityAudit::class)->run();

    $this->info('School Head data-integrity audit');
    $this->line('  school_head_users: ' . $report['counts']['school_head_users']);
    $this->line('  indicator_submissions: ' . $report['counts']['indicator_submissions']);
    $this->line('  indicator_submission_files: ' . $report['counts']['indicator_submission_files']);

    foreach ($report['warnings'] as $warning) {
        $this->warn('Warning: ' . $warning);
    }

    foreach ($report['anomalies'] as $key => $rows) {
        if ($rows === []) {
            $this->line("  {$key}: OK");
            continue;
        }

        $this->error("  {$key}: " . count($rows) . ' issue(s)');
        foreach ($rows as $row) {
            $serialized = collect($row)
                ->map(static fn (mixed $value, string $field): string => $field . '=' . (is_scalar($value) || $value === null ? (string) ($value ?? 'null') : json_encode($value)))
                ->implode(' ');
            $this->line('    - ' . $serialized);
        }
    }

    if ($report['has_anomalies']) {
        $this->newLine();
        $this->error('School Head data-integrity anomalies detected.');

        return self::FAILURE;
    }

    $this->newLine();
    $this->info('No School Head data-integrity anomalies detected.');

    return self::SUCCESS;
})->purpose('Audit School Head ownership, submission, and package/file integrity anomalies.');

Artisan::command('cspams:purge-demo-data {--force : Required to run the purge} {--with-schools : Also archive known demo school records}', function (): int {
    if (! $this->option('force')) {
        $this->error('Refusing to purge demo data without --force.');
        $this->line('Run: php artisan cspams:purge-demo-data --force');
        return self::FAILURE;
    }

    if (! Schema::hasTable('users') || ! Schema::hasTable('schools')) {
        $this->error('Required tables are missing. Run migrations first.');
        return self::FAILURE;
    }

    $demoSchoolHeadEmails = [
        'schoolhead1@cspams.local',
        'schoolhead2@cspams.local',
        'schoolhead3@cspams.local',
    ];
    $demoSchoolCodes = [
        '900001',
        '900002',
        '900003',
    ];

    $withSchools = (bool) $this->option('with-schools');

    $result = DB::transaction(static function () use ($demoSchoolHeadEmails, $demoSchoolCodes, $withSchools): array {
        $demoHeads = User::query()
            ->whereIn('email', $demoSchoolHeadEmails)
            ->get();

        $demoHeadIds = $demoHeads
            ->pluck('id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();

        $clearedSchoolSubmissions = $demoHeadIds === []
            ? 0
            : DB::table('schools')
                ->whereIn('school_code', $demoSchoolCodes)
                ->whereIn('submitted_by', $demoHeadIds)
                ->update([
                    'submitted_by' => null,
                    'submitted_at' => null,
                ]);

        $deletedSchoolHeads = 0;
        foreach ($demoHeads as $demoHead) {
            $demoHead->syncRoles([]);
            $demoHead->delete();
            $deletedSchoolHeads++;
        }

        $archivedSchools = 0;
        if ($withSchools) {
            $schools = School::query()
                ->whereIn('school_code', $demoSchoolCodes)
                ->get();

            foreach ($schools as $school) {
                $school->delete();
                $archivedSchools++;
            }
        }

        return [
            'deleted_school_head_users' => $deletedSchoolHeads,
            'cleared_school_submission_references' => $clearedSchoolSubmissions,
            'archived_demo_schools' => $archivedSchools,
        ];
    });

    $this->info('Demo data purge completed.');
    $this->line('  deleted_school_head_users: ' . $result['deleted_school_head_users']);
    $this->line('  cleared_school_submission_references: ' . $result['cleared_school_submission_references']);
    $this->line('  archived_demo_schools: ' . $result['archived_demo_schools']);
    $this->line('  monitor_account_deleted: no');

    if (! $withSchools) {
        $this->line('Known demo schools were left in place. Use --with-schools to archive them.');
    }

    return self::SUCCESS;
})->purpose('Purge known seeded demo School Head accounts without touching real production accounts.');

Artisan::command('app:check-production-config', function (): int {
    try {
        app(AppServiceProvider::class)->runProductionConfigurationAudit();
    } catch (\RuntimeException $e) {
        $this->error('Production configuration is UNSAFE:');
        $this->line('  ' . $e->getMessage());
        $this->newLine();
        $this->line('Fix the listed configuration issues and re-run before deploying.');
        return self::FAILURE;
    }

    $this->info('Production configuration looks safe.');

    return self::SUCCESS;
})->purpose('Validate production-safe configuration for the deployed CSPAMS environment.');

Artisan::command('app:check-verification-delivery', function (): int {
    $mailer = strtolower(trim((string) config('mail.default', 'log')));
    $fromAddress = trim((string) config('mail.from.address', ''));
    $testCode = trim((string) config('auth_mfa.monitor.test_code', ''));
    $mfaEnabled = (bool) config('auth_mfa.monitor.enabled', false);
    $deliveryMode = strtolower(trim((string) config('auth_mfa.monitor.delivery_mode', 'queued')));
    $configuredQueue = trim((string) config('auth_mfa.monitor.queue_connection', ''));
    $effectiveQueue = strtolower($configuredQueue !== '' ? $configuredQueue : trim((string) config('queue.default', 'database')));
    $issues = [];

    $this->line('Verification delivery status');
    $this->line('  mailer: ' . $mailer);
    $this->line('  mail from: ' . ($fromAddress !== '' ? $fromAddress : '(missing)'));
    $this->line('  monitor MFA enabled: ' . ($mfaEnabled ? 'yes' : 'no'));
    $this->line('  monitor MFA delivery mode: ' . ($deliveryMode !== '' ? $deliveryMode : '(missing)'));
    $this->line('  effective queue: ' . $effectiveQueue);
    $this->line('  monitor MFA test code: ' . ($testCode !== '' ? 'configured' : 'empty'));

    if (\App\Support\Mail\MailDelivery::isSimulated()) {
        $issues[] = "MAIL_MAILER='{$mailer}' only simulates delivery.";
    }

    if ($fromAddress === '' || str_ends_with(strtolower($fromAddress), '@example.com')) {
        $issues[] = 'MAIL_FROM_ADDRESS must be a real sender address.';
    }

    if ($testCode !== '') {
        $issues[] = 'CSPAMS_MONITOR_MFA_TEST_CODE must be empty for real verification.';
    }

    if ($mfaEnabled && $effectiveQueue === 'sync') {
        $issues[] = 'QUEUE_CONNECTION must not be sync when monitor MFA email is enabled.';
    }

    if (! in_array($deliveryMode, ['queued', 'sync'], true)) {
        $issues[] = 'CSPAMS_MONITOR_MFA_DELIVERY_MODE must be queued or sync.';
    }

    if ($mailer === 'resend') {
        $resendKey = trim((string) config('services.resend.key', ''));
        if ($resendKey === '') {
            $issues[] = 'RESEND_KEY (or RESEND_API_KEY) must be configured for MAIL_MAILER=resend.';
        }
    }

    if ($mailer === 'smtp') {
        $host = trim((string) config('mail.mailers.smtp.host', ''));
        $username = trim((string) config('mail.mailers.smtp.username', ''));
        $password = trim((string) config('mail.mailers.smtp.password', ''));

        if ($host === '' || $host === '127.0.0.1') {
            $issues[] = 'MAIL_HOST must be set to a real SMTP host.';
        }

        if ($username === '' || $password === '') {
            $issues[] = 'MAIL_USERNAME and MAIL_PASSWORD must be configured for MAIL_MAILER=smtp.';
        }
    }

    if ($issues === []) {
        $this->newLine();
        $this->info('Verification delivery is configured for real inbox delivery.');
        return self::SUCCESS;
    }

    $this->newLine();
    $this->error('Verification delivery is not production-ready:');
    foreach ($issues as $issue) {
        $this->line('  - ' . $issue);
    }

    return self::FAILURE;
})->purpose('Report whether monitor verification emails are configured for real delivery.');

Artisan::command('e2e:seed-monitor-review', function (): int {
    if (! app()->environment('testing')) {
        $this->error('Refusing to seed monitor review E2E data outside APP_ENV=testing.');
        return self::FAILURE;
    }

    $requiredTables = [
        'academic_years',
        'form_submission_histories',
        'indicator_submission_files',
        'indicator_submissions',
        'schools',
        'users',
    ];

    foreach ($requiredTables as $table) {
        if (! Schema::hasTable($table)) {
            $this->error("Required table is missing: {$table}. Run migrations first.");
            return self::FAILURE;
        }
    }

    $monitorEmail = strtolower(trim((string) env('CSPAMS_E2E_MONITOR_EMAIL', 'monitor-e2e@cspams.local')));
    $monitorPassword = (string) env('CSPAMS_E2E_MONITOR_PASSWORD', 'E2eMonitor@2026!');
    $schoolCode = '401777';
    $schoolHeadEmail = 'school-head-e2e@cspams.local';
    $returnSchoolCode = '401778';
    $returnSchoolHeadEmail = 'school-head-return-e2e@cspams.local';
    $fileType = 'fm_qad_001';
    $filePath = 'e2e-monitor-review/fm-qad-001.pdf';
    $returnFilePath = 'e2e-monitor-review/fm-qad-001-return.pdf';
    $now = now();

    Storage::disk('local')->put($filePath, "%PDF-1.4\n% CSPAMS live E2E monitor review file\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF");
    Storage::disk('local')->put($returnFilePath, "%PDF-1.4\n% CSPAMS live E2E monitor return file\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF");

    DB::transaction(function () use ($monitorEmail, $monitorPassword, $schoolCode, $schoolHeadEmail, $returnSchoolCode, $returnSchoolHeadEmail, $fileType, $filePath, $returnFilePath, $now): void {
        \Spatie\Permission\Models\Role::query()->firstOrCreate([
            'name' => \App\Support\Auth\UserRoleResolver::MONITOR,
            'guard_name' => 'web',
        ]);
        \Spatie\Permission\Models\Role::query()->firstOrCreate([
            'name' => \App\Support\Auth\UserRoleResolver::SCHOOL_HEAD,
            'guard_name' => 'web',
        ]);
        app(\Spatie\Permission\PermissionRegistrar::class)->forgetCachedPermissions();

        $academicYear = \App\Models\AcademicYear::query()->updateOrCreate(
            ['name' => '2025-2026'],
            [
                'start_date' => '2025-06-01',
                'end_date' => '2026-03-31',
                'is_current' => true,
            ],
        );

        /** @var \App\Models\School $school */
        $school = \App\Models\School::withTrashed()->updateOrCreate(
            ['school_code' => $schoolCode],
            [
                'name' => 'AMA Computer College-Santiago City',
                'level' => 'High School',
                'district' => 'Santiago City',
                'address' => 'Santiago City',
                'region' => 'Region II',
                'type' => 'private',
                'status' => 'active',
                'reported_student_count' => 0,
                'reported_teacher_count' => 0,
            ],
        );
        if ($school->trashed()) {
            $school->restore();
        }

        /** @var \App\Models\User $monitor */
        $monitor = \App\Models\User::query()->updateOrCreate(
            ['email' => $monitorEmail],
            [
                'name' => 'Division Monitor E2E',
                'password' => \Illuminate\Support\Facades\Hash::make($monitorPassword),
                'must_reset_password' => false,
                'password_changed_at' => $now,
                'school_id' => null,
            ],
        );
        $monitor->forceFill([
            'account_status' => \App\Support\Domain\AccountStatus::ACTIVE->value,
            'account_type' => \App\Support\Auth\UserRoleResolver::MONITOR,
            'email_verified_at' => $now,
        ])->save();
        $monitor->syncRoles([\App\Support\Auth\UserRoleResolver::MONITOR]);

        /** @var \App\Models\User $schoolHead */
        $schoolHead = \App\Models\User::query()->updateOrCreate(
            ['email' => $schoolHeadEmail],
            [
                'name' => 'School Head E2E',
                'password' => \Illuminate\Support\Facades\Hash::make('E2eSchoolHead@2026!'),
                'must_reset_password' => false,
                'password_changed_at' => $now,
                'school_id' => $school->id,
            ],
        );
        $schoolHead->forceFill([
            'account_status' => \App\Support\Domain\AccountStatus::ACTIVE->value,
            'account_type' => \App\Support\Auth\UserRoleResolver::SCHOOL_HEAD,
            'email_verified_at' => $now,
        ])->save();
        $schoolHead->syncRoles([\App\Support\Auth\UserRoleResolver::SCHOOL_HEAD]);

        $existingSubmissionIds = \App\Models\IndicatorSubmission::query()
            ->where('school_id', $school->id)
            ->pluck('id');

        if ($existingSubmissionIds->isNotEmpty()) {
            \App\Models\IndicatorSubmissionScopeReview::query()
                ->whereIn('indicator_submission_id', $existingSubmissionIds)
                ->delete();
            \App\Models\IndicatorSubmissionFile::query()
                ->whereIn('indicator_submission_id', $existingSubmissionIds)
                ->delete();
            \App\Models\FormSubmissionHistory::query()
                ->where('form_type', \App\Models\IndicatorSubmission::FORM_TYPE)
                ->whereIn('submission_id', $existingSubmissionIds)
                ->delete();
            \App\Models\IndicatorSubmission::query()
                ->whereIn('id', $existingSubmissionIds)
                ->delete();
        }

        /** @var \App\Models\IndicatorSubmission $submission */
        $submission = \App\Models\IndicatorSubmission::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $academicYear->id,
            'reporting_period' => null,
            'version' => 1,
            'status' => \App\Support\Domain\FormSubmissionStatus::DRAFT->value,
            'notes' => 'Live E2E monitor review package.',
            'created_by' => $schoolHead->id,
            'submitted_by' => $schoolHead->id,
        ]);

        \App\Models\IndicatorSubmissionFile::query()->create([
            'indicator_submission_id' => $submission->id,
            'type' => $fileType,
            'path' => $filePath,
            'original_filename' => 'Profile-1.pdf',
            'size_bytes' => strlen((string) Storage::disk('local')->get($filePath)),
            'uploaded_at' => $now,
        ]);

        \App\Models\FormSubmissionHistory::query()->create([
            'form_type' => \App\Models\IndicatorSubmission::FORM_TYPE,
            'submission_id' => $submission->id,
            'school_id' => $school->id,
            'academic_year_id' => $academicYear->id,
            'action' => "{$fileType}_uploaded",
            'from_status' => \App\Support\Domain\FormSubmissionStatus::DRAFT->value,
            'to_status' => \App\Support\Domain\FormSubmissionStatus::DRAFT->value,
            'actor_id' => $schoolHead->id,
            'notes' => 'FM-QAD file uploaded for live E2E.',
            'metadata' => [
                'type' => $fileType,
                'touchedScopes' => [$fileType],
            ],
            'created_at' => $now->copy()->subMinute(),
        ]);

        \App\Models\FormSubmissionHistory::query()->create([
            'form_type' => \App\Models\IndicatorSubmission::FORM_TYPE,
            'submission_id' => $submission->id,
            'school_id' => $school->id,
            'academic_year_id' => $academicYear->id,
            'action' => 'scope_submitted',
            'from_status' => \App\Support\Domain\FormSubmissionStatus::DRAFT->value,
            'to_status' => \App\Support\Domain\FormSubmissionStatus::DRAFT->value,
            'actor_id' => $schoolHead->id,
            'notes' => 'FM-QAD scope sent for live E2E.',
            'metadata' => [
                'targets' => [$fileType],
                'touchedScopes' => [$fileType],
            ],
            'created_at' => $now,
        ]);

        $school->forceFill([
            'submitted_by' => $schoolHead->id,
            'submitted_at' => $now,
        ])->save();

        /** @var \App\Models\School $returnSchool */
        $returnSchool = \App\Models\School::withTrashed()->updateOrCreate(
            ['school_code' => $returnSchoolCode],
            [
                'name' => 'CSPAMS Return Flow School',
                'level' => 'High School',
                'district' => 'Santiago City',
                'address' => 'Santiago City',
                'region' => 'Region II',
                'type' => 'private',
                'status' => 'active',
                'reported_student_count' => 0,
                'reported_teacher_count' => 0,
            ],
        );
        if ($returnSchool->trashed()) {
            $returnSchool->restore();
        }

        /** @var \App\Models\User $returnSchoolHead */
        $returnSchoolHead = \App\Models\User::query()->updateOrCreate(
            ['email' => $returnSchoolHeadEmail],
            [
                'name' => 'Return Flow School Head E2E',
                'password' => \Illuminate\Support\Facades\Hash::make('E2eSchoolHead@2026!'),
                'must_reset_password' => false,
                'password_changed_at' => $now,
                'school_id' => $returnSchool->id,
            ],
        );
        $returnSchoolHead->forceFill([
            'account_status' => \App\Support\Domain\AccountStatus::ACTIVE->value,
            'account_type' => \App\Support\Auth\UserRoleResolver::SCHOOL_HEAD,
            'email_verified_at' => $now,
        ])->save();
        $returnSchoolHead->syncRoles([\App\Support\Auth\UserRoleResolver::SCHOOL_HEAD]);

        $existingReturnSubmissionIds = \App\Models\IndicatorSubmission::query()
            ->where('school_id', $returnSchool->id)
            ->pluck('id');

        if ($existingReturnSubmissionIds->isNotEmpty()) {
            \App\Models\IndicatorSubmissionScopeReview::query()
                ->whereIn('indicator_submission_id', $existingReturnSubmissionIds)
                ->delete();
            \App\Models\IndicatorSubmissionFile::query()
                ->whereIn('indicator_submission_id', $existingReturnSubmissionIds)
                ->delete();
            \App\Models\FormSubmissionHistory::query()
                ->where('form_type', \App\Models\IndicatorSubmission::FORM_TYPE)
                ->whereIn('submission_id', $existingReturnSubmissionIds)
                ->delete();
            \App\Models\IndicatorSubmission::query()
                ->whereIn('id', $existingReturnSubmissionIds)
                ->delete();
        }

        /** @var \App\Models\IndicatorSubmission $returnSubmission */
        $returnSubmission = \App\Models\IndicatorSubmission::query()->create([
            'school_id' => $returnSchool->id,
            'academic_year_id' => $academicYear->id,
            'reporting_period' => null,
            'version' => 1,
            'status' => \App\Support\Domain\FormSubmissionStatus::DRAFT->value,
            'notes' => 'Live E2E monitor return package.',
            'created_by' => $returnSchoolHead->id,
            'submitted_by' => $returnSchoolHead->id,
        ]);

        \App\Models\IndicatorSubmissionFile::query()->create([
            'indicator_submission_id' => $returnSubmission->id,
            'type' => $fileType,
            'path' => $returnFilePath,
            'original_filename' => 'Return-Profile-1.pdf',
            'size_bytes' => strlen((string) Storage::disk('local')->get($returnFilePath)),
            'uploaded_at' => $now,
        ]);

        \App\Models\FormSubmissionHistory::query()->create([
            'form_type' => \App\Models\IndicatorSubmission::FORM_TYPE,
            'submission_id' => $returnSubmission->id,
            'school_id' => $returnSchool->id,
            'academic_year_id' => $academicYear->id,
            'action' => "{$fileType}_uploaded",
            'from_status' => \App\Support\Domain\FormSubmissionStatus::DRAFT->value,
            'to_status' => \App\Support\Domain\FormSubmissionStatus::DRAFT->value,
            'actor_id' => $returnSchoolHead->id,
            'notes' => 'FM-QAD file uploaded for live E2E return flow.',
            'metadata' => [
                'type' => $fileType,
                'touchedScopes' => [$fileType],
            ],
            'created_at' => $now->copy()->subMinute(),
        ]);

        \App\Models\FormSubmissionHistory::query()->create([
            'form_type' => \App\Models\IndicatorSubmission::FORM_TYPE,
            'submission_id' => $returnSubmission->id,
            'school_id' => $returnSchool->id,
            'academic_year_id' => $academicYear->id,
            'action' => 'scope_submitted',
            'from_status' => \App\Support\Domain\FormSubmissionStatus::DRAFT->value,
            'to_status' => \App\Support\Domain\FormSubmissionStatus::DRAFT->value,
            'actor_id' => $returnSchoolHead->id,
            'notes' => 'FM-QAD scope sent for live E2E return flow.',
            'metadata' => [
                'targets' => [$fileType],
                'touchedScopes' => [$fileType],
            ],
            'created_at' => $now,
        ]);

        $returnSchool->forceFill([
            'submitted_by' => $returnSchoolHead->id,
            'submitted_at' => $now,
        ])->save();
    });

    $this->info('Seeded monitor review live E2E data.');
    $this->line('Monitor login: ' . $monitorEmail);
    $this->line('Verify school: AMA Computer College-Santiago City');
    $this->line('Return school: CSPAMS Return Flow School');

    return self::SUCCESS;
})->purpose('Seed isolated test-only monitor review data for live Playwright smoke tests.');
