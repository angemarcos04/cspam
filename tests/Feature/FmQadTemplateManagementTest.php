<?php

namespace Tests\Feature;

use App\Events\CspamsUpdateBroadcast;
use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\FmQadForm;
use App\Models\FmQadTemplateVersion;
use App\Models\IndicatorSubmission;
use App\Models\IndicatorSubmissionFile;
use App\Models\School;
use App\Models\User;
use App\Support\FmQad\FmQadTemplateAudit;
use App\Support\FmQad\FmQadTemplateStorage;
use App\Support\FmQad\FmQadTemplateVersionManager;
use App\Support\FmQad\LegacyFmQadTemplateImporter;
use Database\Seeders\FmQadFormSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
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

    /** @var list<string> */
    private array $temporaryDirectories = [];

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
        foreach (array_reverse($this->temporaryDirectories) as $path) {
            if (is_dir($path)) {
                rmdir($path);
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
        $this->assertSame(1, $form->versions()->where('activation_key', $form->id.':'.$year->id)->count());
        $this->assertSame(3, $form->versions()->count());
        $this->assertSame(3, $form->versions()->whereHas('blob')->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'fm_qad_template.version_activated']);
        Event::assertDispatched(CspamsUpdateBroadcast::class, fn ($event) => $event->payload['eventType'] === 'fm_qad_template.version_activated');
    }

    public function test_active_version_cannot_be_archived_and_draft_archive_preserves_blob(): void
    {
        $form = FmQadForm::query()->firstOrFail();
        $monitor = $this->user('monitor@example.test', 'monitor');
        $manager = app(FmQadTemplateVersionManager::class);
        $active = $manager->upload($form, $this->validDocx('active.docx', 'keep-active'), [
            'revision_label' => 'Rev. 01',
            'academic_year_id' => null,
            'change_notes' => 'Archive test.',
        ], $monitor, true);
        $draft = $manager->upload($form, $this->validDocx('draft.docx', 'archive-me'), [
            'revision_label' => 'Rev. 02',
            'academic_year_id' => null,
            'change_notes' => 'Draft archive test.',
        ], $monitor);
        $hash = $draft->sha256_hash;

        Sanctum::actingAs($monitor, ['role:monitor']);
        $this->postJson("/api/monitor/fm-qad/template-versions/{$active->id}/archive")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('version');
        $archived = $manager->archive($draft, $monitor);

        $this->assertSame('archived', $archived->status);
        $this->assertSame($active->id, $manager->effective($form, null)?->id);
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
        $this->assertDatabaseHas('fm_qad_template_downloads', [
            'school_id' => $privateHead->school_id,
            'user_id' => $privateHead->id,
            'academic_year_id' => $year->id,
            'fm_qad_template_version_id' => $version->id,
        ]);

        $public = School::query()->create([
            'school_code' => 'PUBLIC-1', 'name' => 'Public School', 'district' => 'District', 'region' => 'Region', 'type' => 'public',
        ]);
        $publicHead = $this->user('public@example.test', 'school_head', $public);
        Sanctum::actingAs($publicHead, ['role:school_head']);
        $this->getJson("/api/fm-qad/templates?academic_year_id={$year->id}")
            ->assertOk()
            ->assertExactJson(['data' => []]);
        $this->get("/api/fm-qad/template-versions/{$version->id}/download")
            ->assertForbidden()
            ->assertSee('FM-QAD templates are available only to private schools.');
    }

    public function test_schema_keeps_legacy_submission_association_nullable(): void
    {
        $this->assertTrue(Schema::hasColumn('indicator_submission_files', 'fm_qad_template_version_id'));
        $columns = Schema::getColumns('indicator_submission_files');
        $column = collect($columns)->firstWhere('name', 'fm_qad_template_version_id');
        $this->assertTrue((bool) ($column['nullable'] ?? false));
    }

    public function test_legacy_null_version_file_serializes_without_queries_or_errors(): void
    {
        $year = $this->year();
        $school = $this->privateSchool();
        $head = $this->user('legacy@example.test', 'school_head', $school);
        $submission = IndicatorSubmission::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $year->id,
            'form_type' => IndicatorSubmission::FORM_TYPE,
            'status' => 'draft',
            'version' => 1,
            'created_by' => $head->id,
        ]);
        IndicatorSubmissionFile::query()->create([
            'indicator_submission_id' => $submission->id,
            'type' => 'fm_qad_003',
            'fm_qad_template_version_id' => null,
            'path' => 'database://legacy-null',
            'original_filename' => 'legacy.docx',
            'size_bytes' => 1,
            'uploaded_at' => now(),
        ]);

        Sanctum::actingAs($head, ['role:school_head']);
        $this->getJson("/api/indicators/submissions/{$submission->id}")
            ->assertOk()
            ->assertJsonPath('data.files.fm_qad_003.fmQadTemplateVersionId', null)
            ->assertJsonPath('data.files.fm_qad_003.fmQadTemplateRevisionLabel', null);
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

        $this->get("/api/fm-qad/template-versions/{$version->id}/download?academic_year_id={$year->id}")
            ->assertOk();
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

    public function test_downloaded_revision_remains_pinned_after_replacement_activation_and_can_switch_deliberately(): void
    {
        $year = $this->year();
        $school = $this->privateSchool();
        $head = $this->user('trace@example.test', 'school_head', $school);
        $monitor = $this->user('monitor@example.test', 'monitor');
        $form = FmQadForm::query()->where('scope_id', 'fm_qad_003')->firstOrFail();
        $manager = app(FmQadTemplateVersionManager::class);
        $rev02 = $manager->upload($form, $this->validDocx('rev-02.docx', 'rev-02'), [
            'revision_label' => 'Rev. 02',
            'academic_year_id' => $year->id,
            'change_notes' => 'Second revision.',
        ], $monitor, true);
        $rev03 = $manager->upload($form, $this->validDocx('rev-03.docx', 'rev-03'), [
            'revision_label' => 'Rev. 03',
            'academic_year_id' => $year->id,
            'change_notes' => 'Third revision.',
        ], $monitor);
        $submission = IndicatorSubmission::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $year->id,
            'form_type' => IndicatorSubmission::FORM_TYPE,
            'status' => 'draft',
            'version' => 1,
            'created_by' => $head->id,
        ]);

        Sanctum::actingAs($head, ['role:school_head']);
        $this->get("/api/fm-qad/template-versions/{$rev02->id}/download?academic_year_id={$year->id}")->assertOk();

        Sanctum::actingAs($monitor, ['role:monitor']);
        $manager->activate($rev03, $monitor);

        Sanctum::actingAs($head, ['role:school_head']);
        $this->postJson("/api/submissions/{$submission->id}/upload-file", [
            'type' => 'fm_qad_003',
            'fmQadTemplateVersionId' => $rev02->id,
            'file' => $this->validDocx('completed-rev-02.docx', 'completed-rev-02'),
        ])->assertOk();
        $this->assertDatabaseHas('indicator_submission_files', [
            'indicator_submission_id' => $submission->id,
            'type' => 'fm_qad_003',
            'fm_qad_template_version_id' => $rev02->id,
        ]);
        $this->assertSame($rev03->id, $manager->effective($form, $year->id)?->id);
        $this->assertSame('draft', $submission->fresh()->status->value);

        $this->postJson("/api/submissions/{$submission->id}/upload-file", [
            'type' => 'fm_qad_003',
            'file' => $this->validDocx('replacement-rev-02.docx', 'replacement-rev-02'),
        ])->assertOk();
        $this->assertDatabaseHas('indicator_submission_files', [
            'indicator_submission_id' => $submission->id,
            'fm_qad_template_version_id' => $rev02->id,
        ]);

        $this->get("/api/fm-qad/template-versions/{$rev03->id}/download?academic_year_id={$year->id}")->assertOk();
        $this->postJson("/api/submissions/{$submission->id}/upload-file", [
            'type' => 'fm_qad_003',
            'fmQadTemplateVersionId' => $rev03->id,
            'file' => $this->validDocx('replacement-rev-03.docx', 'replacement-rev-03'),
        ])->assertOk();
        $this->assertDatabaseHas('indicator_submission_files', [
            'indicator_submission_id' => $submission->id,
            'fm_qad_template_version_id' => $rev03->id,
        ]);
    }

    public function test_new_fm_qad_upload_without_a_download_receipt_is_rejected_but_non_fm_qad_is_unchanged(): void
    {
        $year = $this->year();
        $school = $this->privateSchool();
        $head = $this->user('receipt-required@example.test', 'school_head', $school);
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
            'file' => $this->validDocx('unversioned.docx', 'unversioned'),
        ])->assertUnprocessable()->assertJsonValidationErrors('fmQadTemplateVersionId');

        $this->postJson("/api/submissions/{$submission->id}/upload-file", [
            'type' => 'bmef',
            'file' => UploadedFile::fake()->create('bmef.pdf', 20, 'application/pdf'),
        ])->assertOk();
    }

    public function test_download_receipts_cannot_be_reused_across_monitor_school_or_academic_year_contexts(): void
    {
        $year = $this->year();
        $otherYear = $this->year('20272028', false);
        $school = $this->privateSchool();
        $otherSchool = School::query()->create([
            'school_code' => 'PRIVATE-2',
            'name' => 'Other Private School',
            'district' => 'District',
            'region' => 'Region',
            'type' => 'private',
        ]);
        $head = $this->user('receipt-owner@example.test', 'school_head', $school);
        $otherSchoolHead = $this->user('receipt-other-school@example.test', 'school_head', $otherSchool);
        $monitor = $this->user('receipt-monitor@example.test', 'monitor');
        $form = FmQadForm::query()->where('scope_id', 'fm_qad_003')->firstOrFail();
        $version = app(FmQadTemplateVersionManager::class)->upload(
            $form,
            $this->validDocx('baseline-receipt.docx', 'baseline-receipt'),
            ['revision_label' => 'Baseline', 'academic_year_id' => null, 'change_notes' => 'Baseline receipt.'],
            $monitor,
            true,
        );
        $submission = IndicatorSubmission::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $year->id,
            'form_type' => IndicatorSubmission::FORM_TYPE,
            'status' => 'draft',
            'version' => 1,
            'created_by' => $head->id,
        ]);
        $payload = fn () => [
            'type' => 'fm_qad_003',
            'fmQadTemplateVersionId' => $version->id,
            'file' => $this->validDocx('completed.docx', bin2hex(random_bytes(8))),
        ];

        Sanctum::actingAs($monitor, ['role:monitor']);
        $this->get("/api/fm-qad/template-versions/{$version->id}/download")->assertOk();
        Sanctum::actingAs($head, ['role:school_head']);
        $this->postJson("/api/submissions/{$submission->id}/upload-file", $payload())
            ->assertUnprocessable();

        Sanctum::actingAs($otherSchoolHead, ['role:school_head']);
        $this->get("/api/fm-qad/template-versions/{$version->id}/download?academic_year_id={$year->id}")->assertOk();
        Sanctum::actingAs($head, ['role:school_head']);
        $this->postJson("/api/submissions/{$submission->id}/upload-file", $payload())
            ->assertUnprocessable();

        $this->get("/api/fm-qad/template-versions/{$version->id}/download?academic_year_id={$otherYear->id}")->assertOk();
        $this->postJson("/api/submissions/{$submission->id}/upload-file", $payload())
            ->assertUnprocessable();
    }

    public function test_historical_downloads_are_scoped_to_the_school_while_monitor_can_download_all_versions(): void
    {
        $year = $this->year();
        $form = FmQadForm::query()->firstOrFail();
        $monitor = $this->user('monitor@example.test', 'monitor');
        $manager = app(FmQadTemplateVersionManager::class);
        $historical = $manager->upload($form, $this->validDocx('historical.docx', 'historical'), [
            'revision_label' => 'Rev. 01',
            'academic_year_id' => $year->id,
            'change_notes' => 'Historical.',
        ], $monitor, true);
        $active = $manager->upload($form, $this->validDocx('active.docx', 'active'), [
            'revision_label' => 'Rev. 02',
            'academic_year_id' => $year->id,
            'change_notes' => 'Current.',
        ], $monitor, true);
        $school = $this->privateSchool();
        $head = $this->user('historical@example.test', 'school_head', $school);

        Sanctum::actingAs($head, ['role:school_head']);
        $this->get("/api/fm-qad/template-versions/{$active->id}/download?academic_year_id={$year->id}")->assertOk();
        $this->get("/api/fm-qad/template-versions/{$historical->id}/download?academic_year_id={$year->id}")->assertForbidden();

        $submission = IndicatorSubmission::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $year->id,
            'form_type' => IndicatorSubmission::FORM_TYPE,
            'status' => 'draft',
            'version' => 1,
            'created_by' => $head->id,
        ]);
        IndicatorSubmissionFile::query()->create([
            'indicator_submission_id' => $submission->id,
            'type' => $form->scope_id,
            'fm_qad_template_version_id' => $historical->id,
            'path' => 'database://legacy',
            'original_filename' => 'legacy.docx',
            'size_bytes' => 1,
            'uploaded_at' => now(),
        ]);
        $this->get("/api/fm-qad/template-versions/{$historical->id}/download?academic_year_id={$year->id}")->assertOk();

        $publicSchool = School::query()->create([
            'school_code' => 'PUBLIC-HISTORY',
            'name' => 'Public History School',
            'district' => 'District',
            'region' => 'Region',
            'type' => 'public',
        ]);
        $publicHead = $this->user('public-history@example.test', 'school_head', $publicSchool);
        Sanctum::actingAs($publicHead, ['role:school_head']);
        $this->get("/api/fm-qad/template-versions/{$historical->id}/download?academic_year_id={$year->id}")->assertForbidden();

        Sanctum::actingAs($monitor, ['role:monitor']);
        $this->get("/api/fm-qad/template-versions/{$active->id}/download")->assertOk();
        $this->get("/api/fm-qad/template-versions/{$historical->id}/download")->assertOk();
    }

    public function test_draft_metadata_editing_normalizes_required_values_and_preserves_blob(): void
    {
        $year = $this->year();
        $otherYear = $this->year('20272028', false);
        $form = FmQadForm::query()->firstOrFail();
        $monitor = $this->user('monitor@example.test', 'monitor');
        $manager = app(FmQadTemplateVersionManager::class);
        $draft = $manager->upload($form, $this->validDocx('draft.docx', 'immutable-blob'), [
            'revision_label' => 'Rev. 01',
            'academic_year_id' => $year->id,
            'change_notes' => 'Original notes.',
        ], $monitor);
        $hash = $draft->sha256_hash;
        $blobHash = $draft->blob->content_sha256;

        Sanctum::actingAs($monitor, ['role:monitor']);
        $this->patchJson("/api/monitor/fm-qad/template-versions/{$draft->id}", [
            'revisionLabel' => '  Rev.   01a  ',
            'academicYearId' => $otherYear->id,
            'changeNotes' => '  Updated notes.  ',
            'internalNote' => '  Internal only.  ',
        ])->assertOk()
            ->assertJsonPath('data.revisionLabel', 'Rev. 01a')
            ->assertJsonPath('data.academicYearId', (string) $otherYear->id);

        $updated = $draft->fresh();
        $this->assertSame('Updated notes.', $updated->change_notes);
        $this->assertSame('Internal only.', $updated->internal_note);
        $this->assertSame($hash, $updated->sha256_hash);
        $this->assertSame($blobHash, $updated->blob->content_sha256);
        $this->assertDatabaseHas('audit_logs', ['action' => 'fm_qad_template.version_updated']);

        $this->patchJson("/api/monitor/fm-qad/template-versions/{$draft->id}", ['revisionLabel' => '   '])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('revisionLabel');
        $this->patchJson("/api/monitor/fm-qad/template-versions/{$draft->id}", ['changeNotes' => '   '])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('changeNotes');
        $manager->upload($form, $this->validDocx('duplicate-label.docx', 'duplicate-label'), [
            'revision_label' => 'Rev. 02',
            'academic_year_id' => $year->id,
            'change_notes' => 'Another draft.',
        ], $monitor);
        $this->patchJson("/api/monitor/fm-qad/template-versions/{$draft->id}", ['revisionLabel' => '  rev. 02  '])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('revisionLabel');

        $manager->activate($updated, $monitor);
        $this->patchJson("/api/monitor/fm-qad/template-versions/{$draft->id}", ['revisionLabel' => 'Rev. 02'])
            ->assertUnprocessable();
    }

    public function test_submission_resource_eager_loads_template_versions_with_a_bounded_query_count(): void
    {
        $year = $this->year();
        $school = $this->privateSchool();
        $monitor = $this->user('monitor@example.test', 'monitor');
        $head = $this->user('query-head@example.test', 'school_head', $school);
        $form = FmQadForm::query()->firstOrFail();
        $version = app(FmQadTemplateVersionManager::class)->upload(
            $form,
            $this->validDocx('query-budget.docx', 'query-budget'),
            ['revision_label' => 'Rev. 01', 'academic_year_id' => $year->id, 'change_notes' => 'Query budget.'],
            $monitor,
            true,
        );
        foreach (range(1, 4) as $index) {
            $submission = IndicatorSubmission::query()->create([
                'school_id' => $school->id,
                'academic_year_id' => $year->id,
                'form_type' => IndicatorSubmission::FORM_TYPE,
                'status' => 'draft',
                'version' => $index,
                'created_by' => $monitor->id,
            ]);
            IndicatorSubmissionFile::query()->create([
                'indicator_submission_id' => $submission->id,
                'type' => $form->scope_id,
                'fm_qad_template_version_id' => $version->id,
                'path' => "database://query-budget-{$index}",
                'original_filename' => "completed-{$index}.docx",
                'size_bytes' => 100,
                'uploaded_at' => now(),
            ]);
        }

        $templateQueries = [];
        DB::listen(function ($query) use (&$templateQueries): void {
            if (str_contains(strtolower($query->sql), 'fm_qad_template_versions')) {
                $templateQueries[] = $query->sql;
            }
        });
        Sanctum::actingAs($head, ['role:school_head']);
        $response = $this->getJson('/api/indicators/submissions?per_page=20')->assertOk();
        $this->assertSame('Rev. 01', $response->json('data.0.files.'.$form->scope_id.'.fmQadTemplateRevisionLabel'));
        $this->assertLessThanOrEqual(1, count($templateQueries), implode("\n", $templateQueries));
    }

    public function test_import_dry_run_predicts_import_skip_and_force_reactivation_without_writes(): void
    {
        $form = FmQadForm::query()->where('scope_id', 'fm_qad_003')->firstOrFail();
        $directory = sys_get_temp_dir().DIRECTORY_SEPARATOR.'cspams-import-'.bin2hex(random_bytes(6));
        mkdir($directory);
        $this->temporaryDirectories[] = $directory;
        $path = $directory.DIRECTORY_SEPARATOR.'FM-QAD-003.docx';
        $this->createDocxAt($path, 'legacy-import');
        config([
            'fm_qad.legacy_directory' => $directory,
            'fm_qad.forms' => [[
                'scope_id' => $form->scope_id,
                'code' => $form->code,
                'name' => $form->name,
                'filename' => basename($path),
                'revision_label' => 'Initial Version',
            ]],
        ]);
        $importer = app(LegacyFmQadTemplateImporter::class);

        $firstDryRun = $importer->run(true);
        $this->assertSame(1, $firstDryRun['wouldImport']);
        $this->assertSame(0, FmQadTemplateVersion::query()->count());

        $firstImport = $importer->run();
        $this->assertSame(1, $firstImport['imported']);
        $this->assertSame(1, FmQadTemplateVersion::query()->count());
        $this->assertSame(1, FmQadTemplateVersion::query()->whereHas('blob')->count());

        $secondDryRun = $importer->run(true);
        $this->assertSame(1, $secondDryRun['wouldSkip']);
        $this->assertSame(1, $importer->run()['skipped']);

        $monitor = $this->user('monitor@example.test', 'monitor');
        app(FmQadTemplateVersionManager::class)->upload(
            $form,
            $this->validDocx('replacement.docx', 'replacement'),
            ['revision_label' => 'Rev. 02', 'academic_year_id' => null, 'change_notes' => 'Replacement.'],
            $monitor,
            true,
        );
        $this->assertSame(1, $importer->run(true, null, true)['wouldReactivate']);
        $this->assertSame(1, $importer->run(false, null, true)['reactivated']);
        $this->assertSame('Initial Version', $form->versions()->active()->whereNull('academic_year_id')->firstOrFail()->revision_label);
        $this->assertSame(2, $form->versions()->count());
        $this->assertSame(2, $form->versions()->whereHas('blob')->count());
    }

    public function test_template_audit_detects_corrupt_relationships_and_is_read_only(): void
    {
        $year = $this->year();
        $school = $this->privateSchool();
        $head = $this->user('audit-head@example.test', 'school_head', $school);
        $monitor = $this->user('audit-monitor@example.test', 'monitor');
        $form = FmQadForm::query()->where('scope_id', 'fm_qad_003')->firstOrFail();
        $otherForm = FmQadForm::query()->where('scope_id', 'fm_qad_004')->firstOrFail();
        $version = app(FmQadTemplateVersionManager::class)->upload(
            $form,
            $this->validDocx('audit.docx', 'audit'),
            ['revision_label' => 'Rev. 01', 'academic_year_id' => $year->id, 'change_notes' => 'Audit.'],
            $monitor,
            true,
        );
        Sanctum::actingAs($head, ['role:school_head']);
        $this->get("/api/fm-qad/template-versions/{$version->id}/download?academic_year_id={$year->id}")->assertOk();
        $receipt = DB::table('fm_qad_template_downloads')->first();
        DB::table('fm_qad_template_downloads')->where('id', $receipt->id)->update(['fm_qad_form_id' => $otherForm->id]);
        $version->blob()->delete();
        $countsBefore = [
            FmQadTemplateVersion::query()->count(),
            DB::table('fm_qad_template_downloads')->count(),
            AuditLog::query()->count(),
        ];

        $issues = app(FmQadTemplateAudit::class)->run();

        $this->assertContains((string) $version->id, $issues['missingBlobs']);
        $this->assertContains((string) $receipt->id, $issues['downloadReceiptsWithWrongForm']);
        $this->assertSame($countsBefore, [
            FmQadTemplateVersion::query()->count(),
            DB::table('fm_qad_template_downloads')->count(),
            AuditLog::query()->count(),
        ]);
    }

    private function validDocx(string $filename, string $documentContent): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'cspams-docx-');
        $this->temporaryFiles[] = $path;
        $zip = new ZipArchive;
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

    private function createDocxAt(string $path, string $documentContent): void
    {
        $this->temporaryFiles[] = $path;
        $zip = new ZipArchive;
        $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        $zip->addFromString('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
        $zip->addFromString('word/document.xml', '<?xml version="1.0"?><document>'.$documentContent.'</document>');
        $zip->close();
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
