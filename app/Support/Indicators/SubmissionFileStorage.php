<?php

namespace App\Support\Indicators;

use App\Models\IndicatorSubmission;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

class SubmissionFileStorage
{
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
        $databaseBlobErrorCode = null;
        try {
            $databaseBlobTableExists = Schema::hasTable('indicator_submission_file_blobs');
            if ($databaseBlobTableExists) {
                DB::table('indicator_submission_file_blobs')
                    ->whereRaw('1 = 0')
                    ->get();
                $databaseBlobReadable = true;
            }
        } catch (\Throwable) {
            $databaseBlobReadable = false;
            $databaseBlobErrorCode = 'database_blob_probe_failed';
        }
        $databaseBlobReady = $databaseBlobTableExists && $databaseBlobReadable;

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
            'status' => (($diskConfigured && $rootConfigured && $canWriteReadDelete) || $databaseBlobReady) ? 'ok' : 'failed',
            'diskConfigured' => $diskConfigured,
            'diskName' => $diskName,
            'driver' => $driver !== '' ? $driver : null,
            'rootConfigured' => $rootConfigured,
            'rootExists' => $rootExists,
            'rootWritable' => $rootWritable,
            'canWriteReadDelete' => $canWriteReadDelete,
            'databaseBlobTableExists' => $databaseBlobTableExists,
            'databaseBlobReadable' => $databaseBlobReadable,
            'databaseBlobReady' => $databaseBlobReady,
            'errorCode' => $databaseBlobErrorCode ?? $writeReadDeleteError,
        ];
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
