<?php

namespace Tests\Feature;

use App\Events\CspamsUpdateBroadcast;
use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\FmQadForm;
use App\Models\FmQadTemplateVersion;
use App\Models\IndicatorSubmission;
use App\Models\School;
use App\Models\User;
use App\Support\FmQad\FmQadTemplateStorage;
use App\Support\FmQad\FmQadTemplateVersionManager;
use Database\Seeders\FmQadFormSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Spatie\Permission\Models\Role;
use Tests\TestCase;
use ZipArchive;

class FmQadTemplateManagementTest extends TestCase
{
    use RefreshDatabase;

    /** @var list<string> */
    private array $temporaryFiles = [];

    protected function setUp(): void
    {
        parent::setUp();
        Role::findOrCreate('monitor', 'web');
        Role::findOrCreate('school_head', 'web');
        $this->seed(FmQadFormSeeder::class);
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

    public function test_catalog_seeder_is_idempotent_and_preserves_all_stable_codes(): void
    {
        $this->seed(FmQadFormSeeder::class);

        $this->assertSame(10, FmQadForm::query()->count());
        $this->assertSame(
            ['fm_qad_001', 'fm_qad_002', 'fm_qad_003', 'fm_qad_004', 'fm_qad_008', 'fm_qad_009', 'fm_qad_010', 'fm_qad_011', 'fm_qad_034', 'fm_qad_041'],
            FmQadForm::query()->orderBy('sort_order')->pluck('scope_id')->all(),
        );
        $this->assertSame('FM-QAD-003', FmQadForm::query()->where('scope_id', 'fm_qad_003')->value('code'));
    }

    public function test_monitor_uploads_a_valid_docx_but_school_head_cannot_manage_versions(): void
    {
        Event::fake([CspamsUpdateBroadcast::class]);
        $year = $this->year();
        $form = FmQadForm::query()->where('scope_id', 'fm_qad_003')->firstOrFail();
        $monitor = $this->user('monitor@example.test', 'monitor');

        Sanctum::actingAs($monitor, ['role:monitor']);
        $response = $this->postJson(
            "/api/monitor/fm-qad/forms/{$form->id}/versions",
            [
                'revisionLabel' => ' Rev. 03 ',
                'academicYearId' => $year->id,
                'changeNotes' => 'Updated requirements and signature section.',
                'file' => $this->validDocx('FM-QAD-003-Rev-03.docx', 'revision-three'),
            ],
        );

        $response->assertCreated()
            ->assertJsonPath('data.revisionLabel', 'Rev. 03')
            ->assertJsonPath('data.status', 'draft');
        $version = FmQadTemplateVersion::query()->firstOrFail();
        $this->assertNotNull($version->blob);
        $this->assertSame(hash('sha256', app(FmQadTemplateStorage::class)->content($version)), $version->sha256_hash);
        $this->assertDatabaseHas('audit_logs', ['action' => 'fm_qad_template.version_uploaded']);

        $schoolHead = $this->user('head@example.test', 'school_head', $this->privateSchool());
        Sanctum::actingAs($schoolHead, ['role:school_head']);
        $this->postJson("/api/monitor/fm-qad/forms/{$form->id}/versions", [
                'revisionLabel' => 'Rev. 04',
                'academicYearId' => $year->id,
                'changeNotes' => 'Unauthorized upload.',
                'file' => $this->validDocx('FM-QAD-003-Rev-04.docx', 'revision-four'),
            ])
            ->assertForbidden();
    }

    public function test_invalid_docx_duplicate_label_and_duplicate_hash_are_rejected(): void
    {
        $year = $this->year();
        $form = FmQadForm::query()->firstOrFail();
        $monitor = $this->user('monitor@example.test', 'monitor');
        $manager = app(FmQadTemplateVersionManager::class);
        $sameFile = $this->validDocx('one.docx', 'same-content');
        $manager->upload($form, $sameFile, [
            'revision_label' => 'Rev. 01',
            'academic_year_id' => $year->id,
            'change_notes' => 'Initial test version.',
        ], $monitor);

        Sanctum::actingAs($monitor, ['role:monitor']);
        $this->postJson("/api/monitor/fm-qad/forms/{$form->id}/versions", [
                'revisionLabel' => 'rev. 01',
                'academicYearId' => $year->id,
                'changeNotes' => 'Duplicate label.',
                'file' => $this->validDocx('two.docx', 'different-content'),
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('revisionLabel');

        $this->postJson("/api/monitor/fm-qad/forms/{$form->id}/versions", [
                'revisionLabel' => 'Rev. 02',
                'academicYearId' => $year->id,
                'changeNotes' => 'Duplicate file.',
                'file' => new UploadedFile(
                    $sameFile->getPathname(),
                    'three.docx',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    null,
                    true,
                ),
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('file');

        $this->postJson("/api/monitor/fm-qad/forms/{$form->id}/versions", [
                'revisionLabel' => 'Rev. 03',
                'academicYearId' => $year->id,
                'changeNotes' => 'Corrupt package.',
                'file' => UploadedFile::fake()->createWithContent('corrupt.docx', 'not a zip'),
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('file');
    }

    public function test_activation_archives_conflict_and_exact_year_wins_over_baseline(): void
    {
        Event::fake([CspamsUpdateBroadcast::class]);
        $year = $this->year();
        $form = FmQadForm::query()->firstOrFail();
        $monitor = $this->user('monitor@example.test', 'monitor');
        $manager = app(FmQadTemplateVersionManager::class);
        $baseline = $manager->upload($form, $this->validDocx('baseline.docx', 'baseline'), [
            'revision_label' => 'Initial Version',
            'academic_year_id' => null,
            'change_notes' => 'Baseline.',
        ], $monitor, true);
        $first = $manager->upload($form, $this->validDocx('first.docx', 'first'), [
            'revision_label' => 'Rev. 01',
            'academic_year_id' => $year->id,
            'change_notes' => 'First year version.',
        ], $monitor, true);
        $second = $manager->upload($form, $this->validDocx('second.docx', 'second'), [
            'revision_label' => 'Rev. 02',
            'academic_year_id' => $year->id,
            'change_notes' => 'Replacement year version.',
        ], $monitor);

        $activated = $manager->activate($second, $monitor);

        $this->assertSame('archived', $first->fresh()->status);
        $this->assertSame('active', $activated->status);
        $this->assertSame($activated->id, $manager->effective($form, $year->id)?->id);
        $this->assertSame($baseline->id, $manager->effective($form, $this->year('20272028', false)->id)?->id);
        $this->assertSame(1, $form->versions()->active()->where('academic_year_id', $year->id)->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'fm_qad_template.version_activated']);
        Event::assertDispatched(CspamsUpdateBroadcast::class, fn ($event) => $event->payload['eventType'] === 'fm_qad_template.version_activated');
    }

    public function test_archive_preserves_blob_and_archived_version_is_not_effective(): void
    {
        $form = FmQadForm::query()->firstOrFail();
        $monitor = $this->user('monitor@example.test', 'monitor');
        $manager = app(FmQadTemplateVersionManager::class);
        $version = $manager->upload($form, $this->validDocx('active.docx', 'archive-me'), [
            'revision_label' => 'Rev. 01',
            'academic_year_id' => null,
            'change_notes' => 'Archive test.',
        ], $monitor, true);
        $hash = $version->sha256_hash;

        $archived = $manager->archive($version, $monitor);

        $this->assertSame('archived', $archived->status);
        $this->assertNull($manager->effective($form, null));
        $this->assertSame($hash, $archived->blob->content_sha256);
        $this->assertDatabaseHas('audit_logs', ['action' => 'fm_qad_template.version_archived']);
    }

    public function test_private_school_head_lists_and_downloads_effective_version_while_public_school_gets_no_forms(): void
    {
        $year = $this->year();
        $form = FmQadForm::query()->firstOrFail();
        $monitor = $this->user('monitor@example.test', 'monitor');
        $version = app(FmQadTemplateVersionManager::class)->upload(
            $form,
            $this->validDocx('FM-QAD-001.docx', 'downloadable'),
            ['revision_label' => 'Rev. 01', 'academic_year_id' => $year->id, 'change_notes' => 'Download test.'],
            $monitor,
            true,
        );
        $privateHead = $this->user('private@example.test', 'school_head', $this->privateSchool());

        Sanctum::actingAs($privateHead, ['role:school_head']);
        $this->getJson("/api/fm-qad/templates?academic_year_id={$year->id}")
            ->assertOk()
            ->assertJsonPath('data.0.activeVersion.id', (string) $version->id);
        $this->get("/api/fm-qad/template-versions/{$version->id}/download")
            ->assertOk()
            ->assertHeader('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

        $public = School::query()->create([
            'school_code' => 'PUBLIC-1', 'name' => 'Public School', 'district' => 'District', 'region' => 'Region', 'type' => 'public',
        ]);
        $publicHead = $this->user('public@example.test', 'school_head', $public);
        Sanctum::actingAs($publicHead, ['role:school_head']);
        $this->getJson("/api/fm-qad/templates?academic_year_id={$year->id}")
            ->assertOk()
            ->assertExactJson(['data' => []]);
    }

    public function test_schema_keeps_legacy_submission_association_nullable(): void
    {
        $this->assertTrue(Schema::hasColumn('indicator_submission_files', 'fm_qad_template_version_id'));
        $columns = Schema::getColumns('indicator_submission_files');
        $column = collect($columns)->firstWhere('name', 'fm_qad_template_version_id');
        $this->assertTrue((bool) ($column['nullable'] ?? false));
    }

    public function test_new_fm_qad_upload_records_the_effective_version_and_rejects_a_different_form(): void
    {
        $year = $this->year();
        $school = $this->privateSchool();
        $head = $this->user('head@example.test', 'school_head', $school);
        $monitor = $this->user('monitor@example.test', 'monitor');
        $form = FmQadForm::query()->where('scope_id', 'fm_qad_003')->firstOrFail();
        $otherForm = FmQadForm::query()->where('scope_id', 'fm_qad_004')->firstOrFail();
        $manager = app(FmQadTemplateVersionManager::class);
        $version = $manager->upload($form, $this->validDocx('blank-003.docx', 'blank-003'), [
            'revision_label' => 'Rev. 03',
            'academic_year_id' => $year->id,
            'change_notes' => 'Current form.',
        ], $monitor, true);
        $other = $manager->upload($otherForm, $this->validDocx('blank-004.docx', 'blank-004'), [
            'revision_label' => 'Rev. 01',
            'academic_year_id' => $year->id,
            'change_notes' => 'Other form.',
        ], $monitor, true);
        $submission = IndicatorSubmission::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $year->id,
            'form_type' => IndicatorSubmission::FORM_TYPE,
            'status' => 'draft',
            'version' => 1,
            'created_by' => $head->id,
        ]);

        Sanctum::actingAs($head, ['role:school_head']);
        $this->postJson("/api/submissions/{$submission->id}/upload-file", [
            'type' => 'fm_qad_003',
            'fmQadTemplateVersionId' => $other->id,
            'file' => $this->validDocx('completed-003.docx', 'completed-invalid'),
        ])->assertUnprocessable()->assertJsonValidationErrors('fmQadTemplateVersionId');

        $this->postJson("/api/submissions/{$submission->id}/upload-file", [
            'type' => 'fm_qad_003',
            'fmQadTemplateVersionId' => $version->id,
            'file' => $this->validDocx('completed-003.docx', 'completed-valid'),
        ])->assertOk();

        $this->assertDatabaseHas('indicator_submission_files', [
            'indicator_submission_id' => $submission->id,
            'type' => 'fm_qad_003',
            'fm_qad_template_version_id' => $version->id,
        ]);
        $this->assertSame('draft', $submission->fresh()->status->value);
    }

    private function validDocx(string $filename, string $documentContent): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'cspams-docx-');
        $this->temporaryFiles[] = $path;
        $zip = new ZipArchive();
        $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        $zip->addFromString('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
        $zip->addFromString('word/document.xml', '<?xml version="1.0"?><document>'.$documentContent.'</document>');
        $zip->close();

        return new UploadedFile(
            $path,
            $filename,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            null,
            true,
        );
    }

    private function year(string $name = '20262027', bool $current = true): AcademicYear
    {
        return AcademicYear::query()->create([
            'name' => $name,
            'start_date' => $name === '20262027' ? '2026-06-01' : '2027-06-01',
            'end_date' => $name === '20262027' ? '2027-03-31' : '2028-03-31',
            'is_current' => $current,
        ]);
    }

    private function privateSchool(): School
    {
        return School::query()->firstOrCreate(
            ['school_code' => 'PRIVATE-1'],
            ['name' => 'Private School', 'district' => 'District', 'region' => 'Region', 'type' => 'private'],
        );
    }

    private function user(string $email, string $role, ?School $school = null): User
    {
        $user = User::query()->create([
            'name' => ucfirst(str_replace('_', ' ', $role)),
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
