<?php

namespace App\Support\Indicators;

use App\Models\IndicatorSubmission;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

class SubmissionFileStorage
{
    private const DATABASE_BLOB_TABLE = 'indicator_submission_file_blobs';

    private const DATABASE_BLOB_REQUIRED_COLUMNS = [
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

    public function diskName(): string
    {
        $configured = trim((string) config('cspams.submission_file_disk', 'local'));

        return $configured !== '' ? $configured : 'local';
    }

    public function disk(): FilesystemAdapter
    {
        return Storage::disk($this->diskName());
    }

    /**
     * @return array<string, mixed>
     */
    public function diagnostics(): array
    {
        $diskName = $this->diskName();
        $diskConfig = config("filesystems.disks.{$diskName}");
        $diskConfigured = is_array($diskConfig);
        $driver = $diskConfigured ? trim((string) ($diskConfig['driver'] ?? '')) : '';
        $isLocalDriver = $driver === 'local';
        $root = $isLocalDriver ? (string) ($diskConfig['root'] ?? '') : '';
        $rootConfigured = ! $isLocalDriver || trim($root) !== '';
        $rootExists = $isLocalDriver ? is_dir($root) : null;
        $rootWritable = $isLocalDriver && $rootExists === true ? is_writable($root) : null;
        $databaseBlobTableExists = false;
        $databaseBlobReadable = false;
        $databaseBlobRequiredColumns = self::DATABASE_BLOB_REQUIRED_COLUMNS;
        $databaseBlobMissingColumns = self::DATABASE_BLOB_REQUIRED_COLUMNS;
        $databaseBlobColumnsReady = false;
        $databaseBlobContentColumnType = null;
        $databaseBlobContentColumnTypeReady = false;
        $databaseBlobSchemaReady = false;
        $databaseBlobErrorCode = null;
        $databaseDriver = null;
        try {
            $databaseDriver = DB::connection()->getDriverName();
        } catch (\Throwable) {
            $databaseDriver = null;
        }
        try {
            $databaseBlobTableExists = Schema::hasTable(self::DATABASE_BLOB_TABLE);
            if ($databaseBlobTableExists) {
                DB::table(self::DATABASE_BLOB_TABLE)
                    ->whereRaw('1 = 0')
                    ->get();
                $databaseBlobReadable = true;
            }
        } catch (\Throwable) {
            $databaseBlobReadable = false;
            $databaseBlobErrorCode = 'database_blob_probe_failed';
        }

        if ($databaseBlobTableExists) {
            try {
                $databaseBlobMissingColumns = array_values(array_filter(
                    self::DATABASE_BLOB_REQUIRED_COLUMNS,
                    static fn (string $column): bool => ! Schema::hasColumn(self::DATABASE_BLOB_TABLE, $column),
                ));
                $databaseBlobColumnsReady = $databaseBlobMissingColumns === [];
            } catch (\Throwable) {
                $databaseBlobMissingColumns = self::DATABASE_BLOB_REQUIRED_COLUMNS;
                $databaseBlobColumnsReady = false;
                $databaseBlobErrorCode ??= 'database_blob_schema_probe_failed';
            }

            try {
                $databaseBlobContentColumnType = $this->databaseBlobContentColumnType();
                $contentColumnExists = ! in_array('content', $databaseBlobMissingColumns, true);
                $databaseBlobContentColumnTypeReady = $contentColumnExists
                    && (
                        $databaseBlobContentColumnType === 'bytea'
                        || $databaseBlobContentColumnType === null
                        || $databaseBlobContentColumnType === ''
                    );
            } catch (\Throwable) {
                $databaseBlobContentColumnType = null;
                $databaseBlobContentColumnTypeReady = ! in_array('content', $databaseBlobMissingColumns, true)
                    && $databaseDriver !== 'pgsql';
                $databaseBlobErrorCode ??= 'database_blob_content_type_probe_failed';
            }
        }

        $databaseBlobSchemaReady = $databaseBlobTableExists
            && $databaseBlobReadable
            && $databaseBlobColumnsReady
            && $databaseBlobContentColumnTypeReady;
        $databaseBlobReady = $databaseBlobSchemaReady;

        $canWriteReadDelete = false;
        $writeReadDeleteError = null;
        if ($diskConfigured) {
            try {
                $probePath = 'diagnostics/cspams-submission-storage-' . bin2hex(random_bytes(6)) . '.txt';
                $disk = $this->disk();
                $disk->put($probePath, 'ok');
                $canWriteReadDelete = $disk->exists($probePath)
                    && trim((string) $disk->get($probePath)) === 'ok';
                $disk->delete($probePath);
            } catch (\Throwable) {
                $canWriteReadDelete = false;
                $writeReadDeleteError = 'storage_probe_failed';
            }
        }

        return [
            'status' => $databaseBlobReady ? 'ok' : 'failed',
            'diskConfigured' => $diskConfigured,
            'diskName' => $diskName,
            'driver' => $driver !== '' ? $driver : null,
            'rootConfigured' => $rootConfigured,
            'rootExists' => $rootExists,
            'rootWritable' => $rootWritable,
            'canWriteReadDelete' => $canWriteReadDelete,
            'databaseBlobTableExists' => $databaseBlobTableExists,
            'databaseBlobReadable' => $databaseBlobReadable,
            'databaseBlobRequiredColumns' => $databaseBlobRequiredColumns,
            'databaseBlobMissingColumns' => $databaseBlobMissingColumns,
            'databaseBlobColumnsReady' => $databaseBlobColumnsReady,
            'databaseBlobContentColumnType' => $databaseBlobContentColumnType,
            'databaseBlobContentColumnTypeReady' => $databaseBlobContentColumnTypeReady,
            'databaseBlobSchemaReady' => $databaseBlobSchemaReady,
            'databaseBlobReady' => $databaseBlobReady,
            'errorCode' => $databaseBlobErrorCode ?? $writeReadDeleteError,
        ];
    }

    private function databaseBlobContentColumnType(): ?string
    {
        if (! Schema::hasColumn(self::DATABASE_BLOB_TABLE, 'content')) {
            return null;
        }

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return null;
        }

        $row = DB::selectOne(
            <<<'SQL'
            select data_type
            from information_schema.columns
            where table_schema = current_schema()
              and table_name = ?
              and column_name = ?
            limit 1
            SQL,
            [self::DATABASE_BLOB_TABLE, 'content'],
        );

        $type = is_object($row) && isset($row->data_type) ? trim((string) $row->data_type) : '';

        return $type !== '' ? strtolower($type) : null;
    }

    public function hasMetadata(IndicatorSubmission $submission, string $type): bool
    {
        $path = $submission->submissionFilePathForType($type);

        return is_string($path) && trim($path) !== '';
    }

    public function exists(IndicatorSubmission $submission, string $type): bool
    {
        $path = $submission->submissionFilePathForType($type);
        $blobStorage = app(SubmissionFileBlobStorage::class);

        if ($blobStorage->isDatabasePath($path)) {
            return $blobStorage->existsForSubmission($submission, $type);
        }

        return $this->pathExists($path);
    }

    public function pathExists(?string $path): bool
    {
        $blobStorage = app(SubmissionFileBlobStorage::class);
        if ($blobStorage->isDatabasePath($path)) {
            return $blobStorage->existsForPath($path);
        }

        return is_string($path)
            && trim($path) !== ''
            && $this->disk()->exists($path);
    }

    public function missingFromStorage(IndicatorSubmission $submission, string $type): bool
    {
        return $this->hasMetadata($submission, $type)
            && ! $this->exists($submission, $type);
    }

    /**
     * @return list<string>
     */
    public function availableTypesForSubmission(IndicatorSubmission $submission): array
    {
        return array_values(array_filter(
            SubmissionFileDefinition::types(),
            fn (string $type): bool => $this->exists($submission, $type),
        ));
    }

    /**
     * @return list<string>
     */
    public function missingStorageTypesForSubmission(IndicatorSubmission $submission): array
    {
        return array_values(array_filter(
            SubmissionFileDefinition::types(),
            fn (string $type): bool => $this->missingFromStorage($submission, $type),
        ));
    }
}
