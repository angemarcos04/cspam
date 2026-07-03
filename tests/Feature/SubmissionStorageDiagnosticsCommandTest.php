<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class SubmissionStorageDiagnosticsCommandTest extends TestCase
{
    use RefreshDatabase;

    public function test_submission_storage_diagnostics_command_prints_safe_readiness_values(): void
    {
        Storage::fake('local');

        $exitCode = Artisan::call('cspams:diagnose-submission-storage');
        $output = Artisan::output();

        $this->assertSame(0, $exitCode, $output);
        $this->assertStringContainsString('Submission storage diagnostics', $output);
        $this->assertStringContainsString('databaseBlobTableExists: yes', $output);
        $this->assertStringContainsString('databaseBlobReadable: yes', $output);
        $this->assertStringContainsString('databaseBlobColumnsReady: yes', $output);
        $this->assertStringContainsString('databaseBlobMissingColumns: none', $output);
        $this->assertStringContainsString('databaseBlobSchemaReady: yes', $output);
        $this->assertStringContainsString('databaseBlobReady: yes', $output);
    }

    public function test_submission_storage_diagnostics_command_returns_safe_json(): void
    {
        Storage::fake('local');
        $originalDatabaseUrl = getenv('DATABASE_URL');
        $originalDatabasePassword = getenv('DB_PASSWORD');
        $originalAppKey = config('app.key');

        try {
            putenv('DATABASE_URL=postgres://diagnostics-secret');
            putenv('DB_PASSWORD=diagnostics-secret-password');
            config()->set('app.key', 'base64:diagnostics-secret-app-key');

            $exitCode = Artisan::call('cspams:diagnose-submission-storage', [
                '--json' => true,
            ]);
            $output = Artisan::output();
            $diagnostics = json_decode($output, true);

            $this->assertSame(0, $exitCode, $output);
            $this->assertIsArray($diagnostics, $output);
            $this->assertSame('ok', $diagnostics['status'] ?? null);
            $this->assertSame(true, $diagnostics['databaseBlobTableExists'] ?? null);
            $this->assertSame(true, $diagnostics['databaseBlobReadable'] ?? null);
            $this->assertSame(true, $diagnostics['databaseBlobColumnsReady'] ?? null);
            $this->assertSame([], $diagnostics['databaseBlobMissingColumns'] ?? null);
            $this->assertArrayHasKey('databaseBlobContentColumnType', $diagnostics);
            $this->assertSame(true, $diagnostics['databaseBlobContentColumnTypeReady'] ?? null);
            $this->assertSame(true, $diagnostics['databaseBlobSchemaReady'] ?? null);
            $this->assertSame(true, $diagnostics['databaseBlobReady'] ?? null);
            $this->assertJson($output);
            $this->assertStringNotContainsString('DATABASE_URL', $output);
            $this->assertStringNotContainsString('DB_PASSWORD', $output);
            $this->assertStringNotContainsString('APP_KEY', $output);
            $this->assertStringNotContainsString(storage_path(), $output);
            $this->assertStringNotContainsString('pretend-uploaded-file-content', $output);
            $this->assertStringNotContainsString('diagnostics-secret', $output);
            $this->assertStringNotContainsString('diagnostics-secret-password', $output);
            $this->assertStringNotContainsString('diagnostics-secret-app-key', $output);
        } finally {
            $originalDatabaseUrl === false
                ? putenv('DATABASE_URL')
                : putenv('DATABASE_URL=' . $originalDatabaseUrl);
            $originalDatabasePassword === false
                ? putenv('DB_PASSWORD')
                : putenv('DB_PASSWORD=' . $originalDatabasePassword);
            config()->set('app.key', $originalAppKey);
        }
    }

    public function test_current_blob_schema_has_required_columns(): void
    {
        $requiredColumns = [
            'id',
            'indicator_submission_id',
            'type',
            'original_filename',
            'mime_type',
            'size_bytes',
            'sha256',
            'content',
            'uploaded_at',
            'created_at',
            'updated_at',
        ];

        foreach ($requiredColumns as $column) {
            $this->assertTrue(
                Schema::hasColumn('indicator_submission_file_blobs', $column),
                "Missing indicator_submission_file_blobs.{$column}",
            );
        }
    }
}
