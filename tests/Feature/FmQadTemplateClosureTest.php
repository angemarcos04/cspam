<?php

namespace Tests\Feature;

use App\Events\CspamsUpdateBroadcast;
use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\FmQadForm;
use App\Models\FmQadTemplateDownloadGrant;
use App\Models\FmQadTemplateVersion;
use App\Models\IndicatorSubmission;
use App\Models\School;
use App\Models\User;
use App\Support\FmQad\FmQadTemplateAudit;
use App\Support\FmQad\FmQadTemplateVersionManager;
use Database\Seeders\FmQadFormSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Spatie\Permission\Models\Role;
use Tests\TestCase;
use ZipArchive;

class FmQadTemplateClosureTest extends TestCase
{
    use RefreshDatabase;

    /** @var list<string> */
    private array $temporaryFiles = [];

    protected function setUp(): void
    {
        parent::setUp();
        Role::findOrCreate('monitor', 'web');
        Role::findOrCreate('school_head', 'web');
    }

    protected function tearDown(): void
    {
        foreach ($this->temporaryFiles as $path) {
            if (is_file($path)) {
                unlink($path);
            }
        }
        parent::tearDown();
    }

    public function test_import_dry_run_reports_missing_catalog_fails_and_writes_nothing(): void
    {
        $directory = $this->legacyDirectoryForScope('fm_qad_003');
        config()->set('fm_qad.legacy_directory', $directory);

        $before = $this->databaseCounts();
        $this->artisan('cspams:import-fm-qad-templates', [
            '--dry-run' => true,
            '--form' => 'fm_qad_003',
        ])->expectsTable(
            ['Checked', 'Would import', 'Would skip', 'Would reactivate', 'Missing catalog', 'Missing files', 'Invalid files'],
            [[1, 0, 0, 0, 'fm_qad_003', '', '']],
        )->assertExitCode(1);
        $this->assertSame($before, $this->databaseCounts());
    }

    public function test_import_decisions_are_idempotent_after_catalog_seed(): void
    {
        $this->seed(FmQadFormSeeder::class);
        $directory = $this->legacyDirectoryForScope('fm_qad_003');
        config()->set('fm_qad.legacy_directory', $directory);

        $initial = app(\App\Support\FmQad\LegacyFmQadTemplateImporter::class)
            ->run(true, 'fm_qad_003');
        $this->assertSame([], $initial['missingCatalog']);
        $this->assertSame(1, $initial['wouldImport']);

        $real = app(\App\Support\FmQad\LegacyFmQadTemplateImporter::class)
            ->run(false, 'fm_qad_003');
        $this->assertSame(1, $real['imported']);
        $this->assertSame([], $real['missingCatalog']);
        $this->assertSame(1, FmQadTemplateVersion::query()->count());
        $this->assertSame(1, \App\Models\FmQadTemplateVersionBlob::query()->count());
        $imported = FmQadTemplateVersion::query()->with('blob')->firstOrFail();
        $this->assertSame(FmQadTemplateVersion::ACTIVE, $imported->status);
        $this->assertNull($imported->academic_year_id);
        $this->assertSame('Rev. 02', $imported->revision_label);
        $this->assertNotNull($imported->activation_key);
        $this->assertNotNull($imported->activated_at);
        $this->assertSame($imported->sha256_hash, $imported->blob?->content_sha256);

        $secondDryRun = app(\App\Support\FmQad\LegacyFmQadTemplateImporter::class)
            ->run(true, 'fm_qad_003');
        $this->assertSame(1, $secondDryRun['wouldSkip']);

        $secondReal = app(\App\Support\FmQad\LegacyFmQadTemplateImporter::class)
            ->run(false, 'fm_qad_003');
        $this->assertSame(1, $secondReal['skipped']);
        $this->assertSame(1, FmQadTemplateVersion::query()->count());
        $this->assertSame(1, \App\Models\FmQadTemplateVersionBlob::query()->count());

        $form = FmQadForm::query()->where('scope_id', 'fm_qad_003')->firstOrFail();
        $importedVersion = FmQadTemplateVersion::query()->firstOrFail();
        app(FmQadTemplateVersionManager::class)->upload(
            $form,
            $this->validDocx('replacement.docx', 'replacement'),
            [
                'revision_label' => 'Replacement',
                'academic_year_id' => null,
                'change_notes' => 'Replacement baseline.',
            ],
            null,
            true,
        );
        $this->assertSame(FmQadTemplateVersion::ARCHIVED, $importedVersion->fresh()->status);
        $forceDryRun = app(\App\Support\FmQad\LegacyFmQadTemplateImporter::class)
            ->run(true, 'fm_qad_003', true);
        $this->assertSame(1, $forceDryRun['wouldReactivate']);
        $forceReal = app(\App\Support\FmQad\LegacyFmQadTemplateImporter::class)
            ->run(false, 'fm_qad_003', true);
        $this->assertSame(1, $forceReal['reactivated']);
        $this->assertSame(FmQadTemplateVersion::ACTIVE, $importedVersion->fresh()->status);
    }

    public function test_version_and_blob_creation_roll_back_together_when_storage_fails(): void
    {
        $this->seed(FmQadFormSeeder::class);
        $form = FmQadForm::query()->where('scope_id', 'fm_qad_003')->firstOrFail();
        $storage = new class extends \App\Support\FmQad\FmQadTemplateStorage
        {
            public function put(
                FmQadTemplateVersion $version,
                string $content,
                string $sha256,
            ): \App\Models\FmQadTemplateVersionBlob {
                throw new \RuntimeException('Simulated blob write failure.');
            }
        };
        $manager = new FmQadTemplateVersionManager(
            app(\App\Support\FmQad\FmQadDocxValidator::class),
            $storage,
        );

        try {
            $manager->upload(
                $form,
                $this->validDocx('atomic.docx', 'atomic'),
                [
                    'revision_label' => 'Atomic import',
                    'academic_year_id' => null,
                    'change_notes' => 'Must roll back.',
                ],
                null,
                true,
            );
            $this->fail('The simulated storage failure should be rethrown.');
        } catch (\RuntimeException $exception) {
            $this->assertSame('Simulated blob write failure.', $exception->getMessage());
        }

        $this->assertSame(0, FmQadTemplateVersion::query()->count());
        $this->assertSame(0, \App\Models\FmQadTemplateVersionBlob::query()->count());
    }

    public function test_import_reports_missing_and_invalid_docx_files(): void
    {
        $this->seed(FmQadFormSeeder::class);
        $directory = sys_get_temp_dir().DIRECTORY_SEPARATOR.'cspams-fm-qad-'.uniqid();
        mkdir($directory);
        config()->set('fm_qad.legacy_directory', $directory);

        $missing = app(\App\Support\FmQad\LegacyFmQadTemplateImporter::class)
            ->run(true, 'fm_qad_003');
        $this->assertSame(['fm_qad_003'], $missing['missing']);

        $definition = collect(config('fm_qad.forms'))->firstWhere('scope_id', 'fm_qad_003');
        $invalidPath = $directory.DIRECTORY_SEPARATOR.$definition['filename'];
        file_put_contents($invalidPath, 'not-a-docx');
        $this->temporaryFiles[] = $invalidPath;
        $invalid = app(\App\Support\FmQad\LegacyFmQadTemplateImporter::class)
            ->run(true, 'fm_qad_003');
        $this->assertArrayHasKey('fm_qad_003', $invalid['invalid']);
    }

    public function test_audit_reports_missing_effective_current_year_and_baseline_clears_it(): void
    {
        $this->seed(FmQadFormSeeder::class);
        $current = $this->year('2026-2027', true);
        $previous = $this->year('2025-2026', false);
        $monitor = $this->user('monitor@example.test', 'monitor');
        $manager = app(FmQadTemplateVersionManager::class);

        foreach (FmQadForm::query()->get() as $form) {
            $manager->upload($form, $this->validDocx("{$form->scope_id}.docx", $form->scope_id), [
                'revision_label' => 'Previous Year',
                'academic_year_id' => $previous->id,
                'change_notes' => 'Previous year only.',
            ], $monitor, true);
        }

        $issues = app(FmQadTemplateAudit::class)->run();
        $this->assertContains("fm_qad_003:{$current->id}", $issues['academicYearsWithoutEffectiveVersion']);

        $form = FmQadForm::query()->where('scope_id', 'fm_qad_003')->firstOrFail();
        $manager->upload($form, $this->validDocx('baseline.docx', 'baseline'), [
            'revision_label' => 'Baseline',
            'academic_year_id' => null,
            'change_notes' => 'Baseline coverage.',
        ], $monitor, true);

        $this->assertNotContains(
            "fm_qad_003:{$current->id}",
            app(FmQadTemplateAudit::class)->run()['academicYearsWithoutEffectiveVersion'],
        );
    }

    public function test_historical_user_reassignment_does_not_invalidate_download_grant(): void
    {
        $this->seed(FmQadFormSeeder::class);
        $year = $this->year();
        $schoolA = $this->school('PRIVATE-A');
        $schoolB = $this->school('PRIVATE-B');
        $head = $this->user('head@example.test', 'school_head', $schoolA);
        $monitor = $this->user('monitor@example.test', 'monitor');
        $form = FmQadForm::query()->firstOrFail();
        $version = app(FmQadTemplateVersionManager::class)->upload($form, $this->validDocx('active.docx', 'active'), [
            'revision_label' => 'Rev. 01',
            'academic_year_id' => $year->id,
            'change_notes' => 'Active.',
        ], $monitor, true);
        FmQadTemplateDownloadGrant::query()->create([
            'fm_qad_template_version_id' => $version->id,
            'fm_qad_form_id' => $form->id,
            'academic_year_id' => $year->id,
            'school_id' => $schoolA->id,
            'user_id' => $head->id,
            'downloaded_at' => now(),
        ]);

        $head->update(['school_id' => $schoolB->id]);

        $this->assertSame([], app(FmQadTemplateAudit::class)->run()['invalidDownloadGrants']);
    }

    public function test_healthy_audit_is_read_only_and_form_version_grant_mismatch_is_detected(): void
    {
        $this->seed(FmQadFormSeeder::class);
        $year = $this->year();
        $school = $this->school('PRIVATE-A');
        $head = $this->user('head@example.test', 'school_head', $school);
        $monitor = $this->user('monitor@example.test', 'monitor');
        $manager = app(FmQadTemplateVersionManager::class);
        foreach (FmQadForm::query()->get() as $form) {
            $manager->upload($form, $this->validDocx("{$form->scope_id}.docx", $form->scope_id), [
                'revision_label' => 'Baseline',
                'academic_year_id' => null,
                'change_notes' => 'Baseline.',
            ], $monitor, true);
        }

        $before = $this->databaseCounts();
        $issues = app(FmQadTemplateAudit::class)->run();
        $this->assertTrue(collect($issues)->every(fn (array $values): bool => $values === []));
        $this->assertSame($before, $this->databaseCounts());
        $this->artisan('cspams:audit-fm-qad-templates')->assertExitCode(0);

        $version = FmQadTemplateVersion::query()->whereHas(
            'form',
            fn ($query) => $query->where('scope_id', 'fm_qad_003'),
        )->firstOrFail();
        $otherForm = FmQadForm::query()->where('scope_id', 'fm_qad_004')->firstOrFail();
        $grant = FmQadTemplateDownloadGrant::query()->create([
            'fm_qad_template_version_id' => $version->id,
            'fm_qad_form_id' => $otherForm->id,
            'academic_year_id' => $year->id,
            'school_id' => $school->id,
            'user_id' => $head->id,
            'downloaded_at' => now(),
        ]);
        $issues = app(FmQadTemplateAudit::class)->run();
        $this->assertContains((string) $grant->id, $issues['invalidDownloadGrants']);
        $this->artisan('cspams:audit-fm-qad-templates')->assertExitCode(1);
    }

    public function test_grants_reject_cross_user_school_year_and_form_boundaries(): void
    {
        $this->seed(FmQadFormSeeder::class);
        $yearA = $this->year('2026-2027', true);
        $yearB = $this->year('2027-2028', false);
        $schoolA = $this->school('PRIVATE-A');
        $schoolB = $this->school('PRIVATE-B');
        $headA = $this->user('head-a@example.test', 'school_head', $schoolA);
        $headSchoolB = $this->user('head-school-b@example.test', 'school_head', $schoolB);
        $monitor = $this->user('monitor@example.test', 'monitor');
        $form3 = FmQadForm::query()->where('scope_id', 'fm_qad_003')->firstOrFail();
        $form4 = FmQadForm::query()->where('scope_id', 'fm_qad_004')->firstOrFail();
        $manager = app(FmQadTemplateVersionManager::class);
        $version3 = $manager->upload($form3, $this->validDocx('3.docx', 'three'), [
            'revision_label' => 'Rev. 03', 'academic_year_id' => $yearA->id, 'change_notes' => 'Three.',
        ], $monitor, true);
        $version4 = $manager->upload($form4, $this->validDocx('4.docx', 'four'), [
            'revision_label' => 'Rev. 04', 'academic_year_id' => $yearA->id, 'change_notes' => 'Four.',
        ], $monitor, true);
        $submissionA = $this->submission($schoolA, $yearA, $headA);
        $submissionYearB = $this->submission($schoolA, $yearB, $headA);
        $submissionSchoolB = $this->submission($schoolB, $yearA, $headSchoolB);

        Sanctum::actingAs($headA, ['role:school_head']);
        $this->get("/api/fm-qad/template-versions/{$version3->id}/download?academic_year_id={$yearA->id}")->assertOk();
        $this->get("/api/fm-qad/template-versions/{$version4->id}/download?academic_year_id={$yearA->id}")->assertOk();
        $grant3 = FmQadTemplateDownloadGrant::query()->where('fm_qad_template_version_id', $version3->id)->firstOrFail();
        $grant4 = FmQadTemplateDownloadGrant::query()->where('fm_qad_template_version_id', $version4->id)->firstOrFail();

        $headA->update(['school_id' => null]);
        $headB = $this->user('head-b@example.test', 'school_head', $schoolA);
        Sanctum::actingAs($headB, ['role:school_head']);
        $this->uploadWithGrant($submissionA, 'fm_qad_003', $grant3)->assertUnprocessable();

        $this->get("/api/fm-qad/template-versions/{$version3->id}/download?academic_year_id={$yearA->id}")->assertOk();
        $this->get("/api/fm-qad/template-versions/{$version4->id}/download?academic_year_id={$yearA->id}")->assertOk();
        $headBGrant3 = FmQadTemplateDownloadGrant::query()
            ->where('user_id', $headB->id)
            ->where('fm_qad_template_version_id', $version3->id)
            ->firstOrFail();
        $headBGrant4 = FmQadTemplateDownloadGrant::query()
            ->where('user_id', $headB->id)
            ->where('fm_qad_template_version_id', $version4->id)
            ->firstOrFail();
        $this->uploadWithGrant($submissionYearB, 'fm_qad_003', $headBGrant3)->assertUnprocessable();
        $this->uploadWithGrant($submissionA, 'fm_qad_003', $headBGrant4)->assertUnprocessable();

        Sanctum::actingAs($headSchoolB, ['role:school_head']);
        $this->uploadWithGrant($submissionSchoolB, 'fm_qad_003', $grant3)->assertUnprocessable();
    }

    public function test_repeated_school_head_download_reuses_grant_and_monitor_download_creates_none(): void
    {
        $this->seed(FmQadFormSeeder::class);
        $year = $this->year();
        $school = $this->school('PRIVATE-A');
        $head = $this->user('head@example.test', 'school_head', $school);
        $monitor = $this->user('monitor@example.test', 'monitor');
        $form = FmQadForm::query()->firstOrFail();
        $version = app(FmQadTemplateVersionManager::class)->upload($form, $this->validDocx('active.docx', 'active'), [
            'revision_label' => 'Rev. 01', 'academic_year_id' => $year->id, 'change_notes' => 'Active.',
        ], $monitor, true);

        Sanctum::actingAs($head, ['role:school_head']);
        $this->get("/api/fm-qad/template-versions/{$version->id}/download?academic_year_id={$year->id}")->assertOk();
        $grant = FmQadTemplateDownloadGrant::query()->firstOrFail();
        $firstDownloadedAt = $grant->downloaded_at;
        $this->travel(1)->minute();
        $this->get("/api/fm-qad/template-versions/{$version->id}/download?academic_year_id={$year->id}")->assertOk();
        $this->assertSame(1, FmQadTemplateDownloadGrant::query()->count());
        $this->assertTrue($grant->fresh()->downloaded_at->greaterThan($firstDownloadedAt));

        FmQadTemplateDownloadGrant::query()->delete();
        Sanctum::actingAs($monitor, ['role:monitor']);
        $this->get("/api/fm-qad/template-versions/{$version->id}/download")->assertOk();
        $this->assertSame(0, FmQadTemplateDownloadGrant::query()->count());
    }

    public function test_activation_conflict_classifier_only_accepts_activation_key_unique_violation(): void
    {
        $manager = app(FmQadTemplateVersionManager::class);
        $method = new \ReflectionMethod($manager, 'isActivationKeyConflict');

        $this->assertTrue($method->invoke($manager, $this->queryException(
            '23505',
            'duplicate key value violates unique constraint "fm_qad_template_versions_activation_key_unique"',
        )));
        $this->assertFalse($method->invoke($manager, $this->queryException(
            '23505',
            'duplicate key value violates unique constraint "users_email_unique"',
        )));
        $this->assertFalse($method->invoke($manager, $this->queryException(
            '22001',
            'value too long for type character varying',
        )));
    }

    public function test_activation_key_race_returns_controlled_response_and_preserves_winner_and_blobs(): void
    {
        $this->seed(FmQadFormSeeder::class);
        Event::fake([CspamsUpdateBroadcast::class]);
        $year = $this->year();
        $monitor = $this->user('monitor@example.test', 'monitor');
        $form = FmQadForm::query()->firstOrFail();
        $manager = app(FmQadTemplateVersionManager::class);
        $winner = $manager->upload($form, $this->validDocx('winner.docx', 'winner'), [
            'revision_label' => 'Rev. 01', 'academic_year_id' => $year->id, 'change_notes' => 'Winner.',
        ], $monitor, true);
        $loser = $manager->upload($form, $this->validDocx('loser.docx', 'loser'), [
            'revision_label' => 'Rev. 02', 'academic_year_id' => $year->id, 'change_notes' => 'Competing.',
        ], $monitor);
        $activationAuditsBefore = AuditLog::query()
            ->where('action', 'fm_qad_template.version_activated')
            ->count();
        $activationBroadcastsBefore = Event::dispatched(CspamsUpdateBroadcast::class)
            ->filter(fn (array $arguments): bool => $arguments[0]->payload['eventType'] === 'fm_qad_template.version_activated')
            ->count();

        $throwConflict = true;
        FmQadTemplateVersion::updating(function (FmQadTemplateVersion $version) use (&$throwConflict): void {
            if (! $throwConflict || $version->activation_key === null) {
                return;
            }
            $throwConflict = false;
            throw $this->queryException(
                '23505',
                'duplicate key value violates unique constraint "fm_qad_template_versions_activation_key_unique"',
            );
        });

        Sanctum::actingAs($monitor, ['role:monitor']);
        $this->postJson("/api/monitor/fm-qad/template-versions/{$loser->id}/activate")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('version')
            ->assertJsonPath(
                'errors.version.0',
                'Another revision was activated at the same time. Refresh the version history and try again.',
            );

        $this->assertSame(2, FmQadTemplateVersion::query()->count());
        $this->assertSame(2, \App\Models\FmQadTemplateVersionBlob::query()->count());
        $this->assertSame(1, FmQadTemplateVersion::query()->where('status', FmQadTemplateVersion::ACTIVE)->count());
        $this->assertSame(1, FmQadTemplateVersion::query()->whereNotNull('activation_key')->count());
        $this->assertSame(FmQadTemplateVersion::ACTIVE, $winner->fresh()->status);
        $this->assertSame(FmQadTemplateVersion::DRAFT, $loser->fresh()->status);
        $this->assertSame(
            $activationAuditsBefore,
            AuditLog::query()->where('action', 'fm_qad_template.version_activated')->count(),
        );
        $this->assertSame(
            $activationBroadcastsBefore,
            Event::dispatched(CspamsUpdateBroadcast::class)
                ->filter(fn (array $arguments): bool => $arguments[0]->payload['eventType'] === 'fm_qad_template.version_activated')
                ->count(),
        );
    }

    private function queryException(string $sqlState, string $message): QueryException
    {
        $previous = new \PDOException($message);
        $previous->errorInfo = [$sqlState, 7, $message];

        return new QueryException('pgsql', 'update fm_qad_template_versions', [], $previous);
    }

    private function uploadWithGrant(
        IndicatorSubmission $submission,
        string $scope,
        FmQadTemplateDownloadGrant $grant,
    ) {
        return $this->postJson("/api/submissions/{$submission->id}/upload-file", [
            'type' => $scope,
            'fmQadTemplateDownloadGrantId' => $grant->id,
            'file' => $this->validDocx("{$scope}-completed.docx", uniqid($scope, true)),
        ])->assertJsonValidationErrors('fmQadTemplateDownloadGrantId');
    }

    private function submission(School $school, AcademicYear $year, User $head): IndicatorSubmission
    {
        return IndicatorSubmission::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $year->id,
            'form_type' => IndicatorSubmission::FORM_TYPE,
            'status' => 'draft',
            'version' => 1,
            'created_by' => $head->id,
        ]);
    }

    private function legacyDirectoryForScope(string $scope): string
    {
        $directory = sys_get_temp_dir().DIRECTORY_SEPARATOR.'cspams-fm-qad-'.uniqid();
        mkdir($directory);
        $this->temporaryFiles[] = $directory.DIRECTORY_SEPARATOR.'placeholder';
        $definition = collect(config('fm_qad.forms'))->firstWhere('scope_id', $scope);
        $file = $this->validDocx($definition['filename'], 'legacy-'.$scope);
        copy($file->getPathname(), $directory.DIRECTORY_SEPARATOR.$definition['filename']);
        $this->temporaryFiles[] = $directory.DIRECTORY_SEPARATOR.$definition['filename'];

        return $directory;
    }

    /** @return array<string, int> */
    private function databaseCounts(): array
    {
        return [
            'forms' => FmQadForm::query()->count(),
            'versions' => FmQadTemplateVersion::query()->count(),
            'blobs' => \App\Models\FmQadTemplateVersionBlob::query()->count(),
            'audits' => \App\Models\AuditLog::query()->count(),
        ];
    }

    private function validDocx(string $filename, string $content): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'cspams-docx-');
        $this->temporaryFiles[] = $path;
        $zip = new ZipArchive;
        $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        $zip->addFromString('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
        $zip->addFromString('word/document.xml', '<?xml version="1.0"?><document>'.$content.'</document>');
        $zip->close();

        return new UploadedFile(
            $path,
            $filename,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            null,
            true,
        );
    }

    private function year(string $name = '2026-2027', bool $current = true): AcademicYear
    {
        [$start, $end] = array_map('intval', explode('-', $name));

        return AcademicYear::query()->create([
            'name' => $name,
            'start_date' => "{$start}-06-01",
            'end_date' => "{$end}-03-31",
            'is_current' => $current,
        ]);
    }

    private function school(string $code): School
    {
        return School::query()->create([
            'school_code' => $code,
            'name' => $code,
            'district' => 'District',
            'region' => 'Region',
            'type' => 'private',
        ]);
    }

    private function user(string $email, string $role, ?School $school = null): User
    {
        $user = User::query()->create([
            'name' => $email,
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'school_id' => $school?->id,
            'account_status' => 'active',
            'email_verified_at' => now(),
        ]);
        $user->assignRole($role);

        return $user;
    }
}
