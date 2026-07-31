<?php

namespace Tests\Feature;

use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\FmQadForm;
use App\Models\FmQadTemplateDownloadGrant;
use App\Models\IndicatorSubmission;
use App\Models\IndicatorSubmissionFile;
use App\Models\School;
use App\Models\User;
use Database\Seeders\FmQadFormSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class FmQadCatalogInitializationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Role::findOrCreate('monitor', 'web');
        Role::findOrCreate('school_head', 'web');
    }

    public function test_empty_catalog_returns_initialization_metadata_without_writing(): void
    {
        Sanctum::actingAs($this->user('monitor@example.test', 'monitor'), ['role:monitor']);
        $before = $this->databaseCounts();

        $response = $this->getJson('/api/monitor/fm-qad/forms');

        $response->assertOk()
            ->assertJsonPath('data', [])
            ->assertJsonPath('academicYears', [])
            ->assertJsonPath('meta.configuredFormCount', 10)
            ->assertJsonPath('meta.catalogCount', 0)
            ->assertJsonPath('meta.enabledCatalogCount', 0)
            ->assertJsonPath('meta.initializationRequired', true)
            ->assertJsonCount(10, 'meta.missingScopeIds')
            ->assertJsonFragment(['fm_qad_001'])
            ->assertJsonFragment(['fm_qad_041']);

        $this->assertSame($before, $this->databaseCounts());
    }

    public function test_partial_catalog_reports_missing_scopes_and_preserves_authorization(): void
    {
        $this->seed(FmQadFormSeeder::class);
        FmQadForm::query()->where('scope_id', 'fm_qad_003')->delete();

        $this->getJson('/api/monitor/fm-qad/forms')->assertUnauthorized();
        Sanctum::actingAs($this->user('head@example.test', 'school_head'), ['role:school_head']);
        $this->getJson('/api/monitor/fm-qad/forms')->assertForbidden();

        Sanctum::actingAs($this->user('monitor@example.test', 'monitor'), ['role:monitor']);
        $this->getJson('/api/monitor/fm-qad/forms')
            ->assertOk()
            ->assertJsonCount(9, 'data')
            ->assertJsonPath('meta.catalogCount', 9)
            ->assertJsonPath('meta.enabledCatalogCount', 9)
            ->assertJsonPath('meta.initializationRequired', true)
            ->assertJsonPath('meta.missingScopeIds', ['fm_qad_003']);
    }

    public function test_seeded_catalog_returns_stably_sorted_rows_even_without_versions(): void
    {
        $this->seed(FmQadFormSeeder::class);
        FmQadForm::query()->create([
            'scope_id' => 'fm_qad_999',
            'code' => 'FM-QAD-999',
            'name' => 'Enabled historical form outside the permanent catalog',
            'sort_order' => 0,
            'is_enabled' => true,
        ]);
        Sanctum::actingAs($this->user('monitor@example.test', 'monitor'), ['role:monitor']);
        $before = $this->databaseCounts();

        $response = $this->getJson('/api/monitor/fm-qad/forms');

        $response->assertOk()
            ->assertJsonCount(10, 'data')
            ->assertJsonPath('data.0.scopeId', 'fm_qad_001')
            ->assertJsonPath('data.0.sortOrder', 1)
            ->assertJsonPath('data.0.isEnabled', true)
            ->assertJsonPath('data.0.activeVersions', [])
            ->assertJsonPath('data.9.scopeId', 'fm_qad_041')
            ->assertJsonPath('meta.configuredFormCount', 10)
            ->assertJsonPath('meta.catalogCount', 10)
            ->assertJsonPath('meta.enabledCatalogCount', 10)
            ->assertJsonPath('meta.initializationRequired', false)
            ->assertJsonPath('meta.missingScopeIds', []);
        $this->assertNotContains('fm_qad_999', $response->json('data.*.scopeId'));
        $this->assertSame($before, $this->databaseCounts());
    }

    public function test_disabled_configured_form_is_omitted_without_becoming_missing(): void
    {
        $this->seed(FmQadFormSeeder::class);
        FmQadForm::query()->where('scope_id', 'fm_qad_003')->update(['is_enabled' => false]);
        Sanctum::actingAs($this->user('monitor@example.test', 'monitor'), ['role:monitor']);

        $response = $this->getJson('/api/monitor/fm-qad/forms');

        $response->assertOk()
            ->assertJsonCount(9, 'data')
            ->assertJsonPath('meta.catalogCount', 10)
            ->assertJsonPath('meta.enabledCatalogCount', 9)
            ->assertJsonPath('meta.initializationRequired', false)
            ->assertJsonPath('meta.missingScopeIds', []);
        $this->assertNotContains('fm_qad_003', $response->json('data.*.scopeId'));
    }

    public function test_seeder_is_idempotent_updates_configuration_and_preserves_related_history(): void
    {
        $this->seed(FmQadFormSeeder::class);
        $form = FmQadForm::query()->where('scope_id', 'fm_qad_003')->firstOrFail();
        $formId = $form->id;
        $year = AcademicYear::query()->create([
            'name' => '20262027',
            'start_date' => '2026-06-01',
            'end_date' => '2027-03-31',
            'is_current' => true,
        ]);
        $school = School::query()->create([
            'school_code' => 'PRIVATE-INIT',
            'name' => 'Private Initialization School',
            'district' => 'District',
            'region' => 'Region',
            'type' => 'private',
        ]);
        $head = $this->user('catalog-head@example.test', 'school_head', $school);
        $version = $form->versions()->create([
            'academic_year_id' => $year->id,
            'revision_label' => 'Rev. Seed',
            'normalized_revision_label' => 'rev. seed',
            'status' => 'draft',
            'original_filename' => 'seed.docx',
            'mime_type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'size_bytes' => 4,
            'sha256_hash' => hash('sha256', 'docx'),
            'change_notes' => 'Preserve this version.',
            'uploaded_by' => $head->id,
        ]);
        $blob = $version->blob()->create([
            'content' => 'docx',
            'content_sha256' => hash('sha256', 'docx'),
        ]);
        $submission = IndicatorSubmission::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $year->id,
            'status' => 'draft',
            'version' => 1,
            'created_by' => $head->id,
        ]);
        $submissionFile = IndicatorSubmissionFile::query()->create([
            'indicator_submission_id' => $submission->id,
            'type' => 'fm_qad_003',
            'fm_qad_template_version_id' => $version->id,
            'path' => 'database://preserved',
            'original_filename' => 'completed.docx',
            'size_bytes' => 4,
            'uploaded_at' => now(),
        ]);
        $grant = FmQadTemplateDownloadGrant::query()->create([
            'fm_qad_template_version_id' => $version->id,
            'fm_qad_form_id' => $form->id,
            'academic_year_id' => $year->id,
            'school_id' => $school->id,
            'user_id' => $head->id,
            'downloaded_at' => now(),
        ]);
        $audit = AuditLog::query()->create([
            'user_id' => $head->id,
            'action' => 'fm_qad_template.seed_preservation_test',
            'auditable_type' => FmQadForm::class,
            'auditable_id' => $form->id,
            'created_at' => now(),
        ]);
        FmQadForm::query()->create([
            'scope_id' => 'historical_extra',
            'code' => 'FM-QAD-HISTORICAL',
            'name' => 'Historical extra row',
            'sort_order' => 999,
            'is_enabled' => false,
        ]);

        $definitions = config('fm_qad.forms');
        $definitions[2]['name'] = 'Updated configured FM-QAD-003 name';
        $definitions[2]['description'] = 'Configured description';
        $definitions[2]['sort_order'] = 33;
        config()->set('fm_qad.forms', $definitions);

        $this->seed(FmQadFormSeeder::class);
        $this->seed(FmQadFormSeeder::class);

        $this->assertSame(11, FmQadForm::query()->count());
        $this->assertSame($formId, FmQadForm::query()->where('scope_id', 'fm_qad_003')->value('id'));
        $this->assertDatabaseHas('fm_qad_forms', [
            'id' => $formId,
            'name' => 'Updated configured FM-QAD-003 name',
            'description' => 'Configured description',
            'sort_order' => 33,
            'is_enabled' => true,
        ]);
        $this->assertDatabaseHas('fm_qad_template_versions', ['id' => $version->id, 'fm_qad_form_id' => $formId]);
        $this->assertDatabaseHas('fm_qad_template_version_blobs', ['id' => $blob->id, 'fm_qad_template_version_id' => $version->id]);
        $this->assertDatabaseHas('indicator_submission_files', ['id' => $submissionFile->id, 'fm_qad_template_version_id' => $version->id]);
        $this->assertDatabaseHas('fm_qad_template_download_grants', ['id' => $grant->id, 'fm_qad_form_id' => $formId]);
        $this->assertDatabaseHas('audit_logs', ['id' => $audit->id]);
        $this->assertDatabaseHas('fm_qad_forms', ['scope_id' => 'historical_extra']);
    }

    public function test_render_startup_seeds_catalog_after_migrations_without_importing_templates(): void
    {
        $script = file_get_contents(base_path('scripts/render-start.sh'));

        $this->assertIsString($script);
        $this->assertStringContainsString('set -euo pipefail', $script);
        $migrationPosition = strpos($script, 'php artisan migrate --force');
        $catalogPosition = strpos($script, 'php artisan db:seed --class=Database\\\\Seeders\\\\FmQadFormSeeder --force');
        $this->assertIsInt($migrationPosition);
        $this->assertIsInt($catalogPosition);
        $this->assertGreaterThan($migrationPosition, $catalogPosition);
        $this->assertStringNotContainsString('cspams:import-fm-qad-templates', $script);
        $this->assertStringNotContainsString('cspams:audit-fm-qad-templates', $script);
        $this->assertStringNotContainsString('FmQadFormSeeder --force || true', $script);
    }

    /** @return array<string, int> */
    private function databaseCounts(): array
    {
        return [
            'forms' => FmQadForm::query()->count(),
            'versions' => \App\Models\FmQadTemplateVersion::query()->count(),
            'grants' => FmQadTemplateDownloadGrant::query()->count(),
            'files' => IndicatorSubmissionFile::query()->count(),
            'audits' => AuditLog::query()->count(),
        ];
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
