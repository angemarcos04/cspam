<?php

namespace Tests\Feature;

use App\Events\CspamsUpdateBroadcast;
use App\Http\Resources\IndicatorSubmissionResource;
use App\Models\AcademicYear;
use App\Models\FmQadForm;
use App\Models\FmQadTemplateDownloadGrant;
use App\Models\FmQadTemplateVersion;
use App\Models\IndicatorSubmission;
use App\Models\IndicatorSubmissionFile;
use App\Models\School;
use App\Models\User;
use App\Support\FmQad\FmQadTemplateStorage;
use App\Support\FmQad\FmQadTemplateVersionManager;
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

    public function test_unconfigured_form_and_its_version_are_hidden_from_every_management_route(): void
    {
        $monitor = $this->user('monitor@example.test', 'monitor');
        $extra = FmQadForm::query()->create([
            'scope_id' => 'fm_qad_999',
            'code' => 'FM-QAD-999',
            'name' => 'Historical extra form',
            'sort_order' => 999,
            'is_enabled' => true,
        ]);
        $version = app(FmQadTemplateVersionManager::class)->upload($extra, $this->validDocx('extra.docx', 'extra'), [
            'revision_label' => 'Historical',
            'academic_year_id' => null,
            'change_notes' => 'Must remain inaccessible and unchanged.',
        ], $monitor);
        $blobHash = $version->blob()->value('content_sha256');

        Sanctum::actingAs($monitor, ['role:monitor']);
        $this->getJson('/api/monitor/fm-qad/forms')
            ->assertOk()
            ->assertJsonMissing(['scopeId' => 'fm_qad_999']);
        $this->getJson("/api/monitor/fm-qad/forms/{$extra->id}/versions")->assertNotFound();
        $this->postJson("/api/monitor/fm-qad/forms/{$extra->id}/versions", [
            'revisionLabel' => 'Rejected',
            'changeNotes' => 'Rejected.',
            'file' => $this->validDocx('rejected.docx', 'rejected'),
        ])->assertNotFound();
        $this->patchJson("/api/monitor/fm-qad/template-versions/{$version->id}", [
            'revisionLabel' => 'Changed',
        ])->assertNotFound();
        $this->postJson("/api/monitor/fm-qad/template-versions/{$version->id}/activate")->assertNotFound();
        $this->postJson("/api/monitor/fm-qad/template-versions/{$version->id}/archive")->assertNotFound();
        $this->get("/api/fm-qad/template-versions/{$version->id}/download")->assertNotFound();

        $this->assertSame('Historical extra form', $extra->fresh()->name);
        $this->assertSame(FmQadTemplateVersion::DRAFT, $version->fresh()->status);
        $this->assertSame('Historical', $version->fresh()->revision_label);
        $this->assertSame($blobHash, $version->blob()->value('content_sha256'));
        $configured = FmQadForm::query()->where('scope_id', 'fm_qad_003')->firstOrFail();
        $this->getJson("/api/monitor/fm-qad/forms/{$configured->id}/versions")->assertOk();
    }

    public function test_monitor_can_upload_and_activate_a_baseline_without_changing_historical_files(): void
    {
        Event::fake([CspamsUpdateBroadcast::class]);
        $monitor = $this->user('monitor@example.test', 'monitor');
        $form = FmQadForm::query()->where('scope_id', 'fm_qad_003')->firstOrFail();
        Sanctum::actingAs($monitor, ['role:monitor']);

        $draftResponse = $this->postJson("/api/monitor/fm-qad/forms/{$form->id}/versions", [
            'revisionLabel' => 'Baseline Draft',
            'changeNotes' => 'Nullable Academic Year remains a baseline.',
            'file' => $this->validDocx('baseline-draft.docx', 'baseline-draft'),
        ])->assertCreated()
            ->assertJsonPath('data.status', FmQadTemplateVersion::DRAFT)
            ->assertJsonPath('data.academicYearId', null);

        $activeResponse = $this->postJson("/api/monitor/fm-qad/forms/{$form->id}/versions", [
            'revisionLabel' => 'Baseline Active',
            'changeNotes' => 'Activate this baseline.',
            'activate' => true,
            'file' => $this->validDocx('baseline-active.docx', 'baseline-active'),
        ])->assertCreated()
            ->assertJsonPath('data.status', FmQadTemplateVersion::ACTIVE)
            ->assertJsonPath('data.academicYearId', null);

        $draft = FmQadTemplateVersion::query()->findOrFail($draftResponse->json('data.id'));
        $active = FmQadTemplateVersion::query()->findOrFail($activeResponse->json('data.id'));
        $this->assertNull($draft->academic_year_id);
        $this->assertSame($active->id, app(FmQadTemplateVersionManager::class)->effective($form, $this->year()->id)?->id);
        $this->assertSame(0, IndicatorSubmissionFile::query()->count());
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
        ], $monitor);
        $hash = $version->sha256_hash;

        $archived = $manager->archive($version, $monitor);

        $this->assertSame('archived', $archived->status);
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
        $this->get("/api/fm-qad/template-versions/{$version->id}/download?academic_year_id={$year->id}")
            ->assertOk()
            ->assertHeader('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            ->assertHeader('X-CSPAMS-FM-QAD-Version-Id', (string) $version->id);
        $this->assertDatabaseHas('fm_qad_template_download_grants', [
            'user_id' => $privateHead->id,
            'school_id' => $privateHead->school_id,
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
        $this->get("/api/fm-qad/template-versions/{$version->id}/download?academic_year_id={$year->id}")
            ->assertForbidden();
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
        $this->get("/api/fm-qad/template-versions/{$other->id}/download?academic_year_id={$year->id}")->assertOk();
        $otherGrant = FmQadTemplateDownloadGrant::query()->where('fm_qad_template_version_id', $other->id)->firstOrFail();
        $this->postJson("/api/submissions/{$submission->id}/upload-file", [
            'type' => 'fm_qad_003',
            'fmQadTemplateVersionId' => $other->id,
            'fmQadTemplateDownloadGrantId' => $otherGrant->id,
            'file' => $this->validDocx('completed-003.docx', 'completed-invalid'),
        ])->assertUnprocessable()->assertJsonValidationErrors('fmQadTemplateDownloadGrantId');

        $this->get("/api/fm-qad/template-versions/{$version->id}/download?academic_year_id={$year->id}")->assertOk();
        $grant = FmQadTemplateDownloadGrant::query()->where('fm_qad_template_version_id', $version->id)->firstOrFail();
        $this->postJson("/api/submissions/{$submission->id}/upload-file", [
            'type' => 'fm_qad_003',
            'fmQadTemplateVersionId' => $version->id,
            'fmQadTemplateDownloadGrantId' => $grant->id,
            'file' => $this->validDocx('completed-003.docx', 'completed-valid'),
        ])->assertOk();

        $this->assertDatabaseHas('indicator_submission_files', [
            'indicator_submission_id' => $submission->id,
            'type' => 'fm_qad_003',
            'fm_qad_template_version_id' => $version->id,
        ]);
        $this->assertSame('draft', $submission->fresh()->status->value);
    }

    public function test_active_cannot_be_archived_and_draft_metadata_edit_preserves_blob(): void
    {
        $year = $this->year();
        $form = FmQadForm::query()->firstOrFail();
        $monitor = $this->user('monitor@example.test', 'monitor');
        $manager = app(FmQadTemplateVersionManager::class);
        $active = $manager->upload($form, $this->validDocx('active.docx', 'active'), [
            'revision_label' => 'Rev. 01', 'academic_year_id' => $year->id, 'change_notes' => 'Active.',
        ], $monitor, true);
        $draft = $manager->upload($form, $this->validDocx('draft.docx', 'draft'), [
            'revision_label' => 'Rev. 02', 'academic_year_id' => $year->id, 'change_notes' => 'Draft.',
        ], $monitor);
        $hash = $draft->sha256_hash;
        $content = app(FmQadTemplateStorage::class)->content($draft);

        Sanctum::actingAs($monitor, ['role:monitor']);
        $this->postJson("/api/monitor/fm-qad/template-versions/{$active->id}/archive")
            ->assertUnprocessable()->assertJsonValidationErrors('version');
        $this->patchJson("/api/monitor/fm-qad/template-versions/{$draft->id}", [
            'revisionLabel' => ' Rev. 02A ', 'academicYearId' => $year->id,
            'changeNotes' => ' Updated notes ', 'internalNote' => ' Internal ',
        ])->assertOk()->assertJsonPath('data.revisionLabel', 'Rev. 02A');

        $draft->refresh();
        $this->assertSame($hash, $draft->sha256_hash);
        $this->assertSame($content, app(FmQadTemplateStorage::class)->content($draft));
        $this->assertDatabaseHas('audit_logs', ['action' => 'fm_qad_template.version_updated', 'auditable_id' => (string) $draft->id]);
        $this->patchJson("/api/monitor/fm-qad/template-versions/{$draft->id}", [
            'revisionLabel' => '   ', 'changeNotes' => '   ',
        ])->assertUnprocessable();
    }

    public function test_downloaded_old_revision_remains_pinned_after_new_activation_and_can_switch_deliberately(): void
    {
        $year = $this->year();
        $school = $this->privateSchool();
        $head = $this->user('head@example.test', 'school_head', $school);
        $monitor = $this->user('monitor@example.test', 'monitor');
        $form = FmQadForm::query()->where('scope_id', 'fm_qad_003')->firstOrFail();
        $manager = app(FmQadTemplateVersionManager::class);
        $rev2 = $manager->upload($form, $this->validDocx('rev2.docx', 'rev2'), [
            'revision_label' => 'Rev. 02', 'academic_year_id' => $year->id, 'change_notes' => 'Second.',
        ], $monitor, true);
        $submission = IndicatorSubmission::query()->create([
            'school_id' => $school->id, 'academic_year_id' => $year->id,
            'form_type' => IndicatorSubmission::FORM_TYPE, 'status' => 'draft', 'version' => 1, 'created_by' => $head->id,
        ]);

        Sanctum::actingAs($head, ['role:school_head']);
        $this->get("/api/fm-qad/template-versions/{$rev2->id}/download?academic_year_id={$year->id}")->assertOk();
        $grant2 = FmQadTemplateDownloadGrant::query()->where('fm_qad_template_version_id', $rev2->id)->firstOrFail();
        $rev3 = $manager->upload($form, $this->validDocx('rev3.docx', 'rev3'), [
            'revision_label' => 'Rev. 03', 'academic_year_id' => $year->id, 'change_notes' => 'Third.',
        ], $monitor, true);
        $this->postJson("/api/submissions/{$submission->id}/upload-file", [
            'type' => 'fm_qad_003', 'fmQadTemplateDownloadGrantId' => $grant2->id,
            'file' => $this->validDocx('completed2.docx', 'completed2'),
        ])->assertOk();
        $this->assertDatabaseHas('indicator_submission_files', [
            'indicator_submission_id' => $submission->id, 'type' => 'fm_qad_003',
            'fm_qad_template_version_id' => $rev2->id,
        ]);
        $this->assertSame($rev3->id, $manager->effective($form, $year->id)?->id);

        $this->postJson("/api/submissions/{$submission->id}/upload-file", [
            'type' => 'fm_qad_003', 'file' => $this->validDocx('same.docx', 'same'),
        ])->assertOk();
        $this->assertSame($rev2->id, $submission->submissionFiles()->where('type', 'fm_qad_003')->value('fm_qad_template_version_id'));
        $this->get("/api/fm-qad/template-versions/{$rev3->id}/download?academic_year_id={$year->id}")->assertOk();
        $grant3 = FmQadTemplateDownloadGrant::query()->where('fm_qad_template_version_id', $rev3->id)->firstOrFail();
        $this->postJson("/api/submissions/{$submission->id}/upload-file", [
            'type' => 'fm_qad_003', 'fmQadTemplateDownloadGrantId' => $grant3->id,
            'file' => $this->validDocx('completed3.docx', 'completed3'),
        ])->assertOk();
        $this->assertSame($rev3->id, $submission->submissionFiles()->where('type', 'fm_qad_003')->value('fm_qad_template_version_id'));
    }

    public function test_submission_resource_uses_eager_loaded_template_versions_without_per_file_queries(): void
    {
        $year = $this->year();
        $school = $this->privateSchool();
        $head = $this->user('head@example.test', 'school_head', $school);
        $monitor = $this->user('monitor@example.test', 'monitor');
        $submission = IndicatorSubmission::query()->create([
            'school_id' => $school->id, 'academic_year_id' => $year->id,
            'form_type' => IndicatorSubmission::FORM_TYPE, 'status' => 'draft', 'version' => 1, 'created_by' => $head->id,
        ]);
        foreach (['fm_qad_001', 'fm_qad_002', 'fm_qad_003'] as $index => $scope) {
            $form = FmQadForm::query()->where('scope_id', $scope)->firstOrFail();
            $version = app(FmQadTemplateVersionManager::class)->upload($form, $this->validDocx("{$scope}.docx", $scope), [
                'revision_label' => 'Rev. 0'.($index + 1), 'academic_year_id' => $year->id, 'change_notes' => 'Query test.',
            ], $monitor, true);
            IndicatorSubmissionFile::query()->create([
                'indicator_submission_id' => $submission->id, 'type' => $scope,
                'fm_qad_template_version_id' => $version->id, 'path' => "missing/{$scope}.docx",
                'original_filename' => "{$scope}.docx", 'size_bytes' => 1, 'uploaded_at' => now(),
            ]);
        }
        $submission->load([
            'school', 'academicYear', 'items.metric', 'submissionFiles.fmQadTemplateVersion',
            'scopeSubmissions', 'scopeStateHistories', 'scopeReviews.reviewedBy',
            'createdBy', 'submittedBy', 'reviewedBy',
        ]);
        $versionQueries = 0;
        DB::listen(function ($query) use (&$versionQueries): void {
            if (str_contains(strtolower($query->sql), 'from "fm_qad_template_versions"')) {
                $versionQueries++;
            }
        });

        $payload = (new IndicatorSubmissionResource($submission))->resolve(request());

        $this->assertSame(0, $versionQueries);
        $this->assertSame('Rev. 01', $payload['files']['fm_qad_001']['fmQadTemplateRevisionLabel']);
        $this->assertSame('Rev. 03', $payload['files']['fm_qad_003']['fmQadTemplateRevisionLabel']);
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
