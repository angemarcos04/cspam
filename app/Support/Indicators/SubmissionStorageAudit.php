<?php

namespace App\Support\Indicators;

use App\Models\IndicatorSubmission;
use App\Models\IndicatorSubmissionFile;

class SubmissionStorageAudit
{
    public function __construct(
        private readonly SubmissionFileBlobStorage $blobStorage,
        private readonly SubmissionFileStorage $fileStorage,
    ) {
    }

    /**
     * @return array{
     *     summary: array<string, mixed>,
     *     rows: list<array<string, mixed>>
     * }
     */
    public function run(bool $onlyMissing = false, int $limit = 100): array
    {
        $limit = max(1, $limit);
        $rows = [];

        foreach ($this->coreMetadataRows() as $submission) {
            foreach (['bmef', 'smea'] as $type) {
                $path = $type === 'bmef' ? $submission->bmef_file_path : $submission->smea_file_path;
                $originalFilename = $type === 'bmef' ? $submission->bmef_original_filename : $submission->smea_original_filename;
                $uploadedAt = $type === 'bmef' ? $submission->bmef_uploaded_at : $submission->smea_uploaded_at;
                $sizeBytes = $type === 'bmef' ? $submission->bmef_file_size : $submission->smea_file_size;

                if (! $this->hasAnyMetadata($path, $originalFilename, $uploadedAt, $sizeBytes)) {
                    continue;
                }

                $rows[] = $this->classify(
                    submissionId: (int) $submission->id,
                    schoolId: (int) $submission->school_id,
                    academicYearId: (int) $submission->academic_year_id,
                    type: $type,
                    path: is_string($path) ? $path : null,
                    originalFilename: is_string($originalFilename) ? $originalFilename : null,
                );
            }
        }

        foreach ($this->nonCoreMetadataRows() as $file) {
            $submission = $file->submission;
            if (! $submission) {
                continue;
            }

            $rows[] = $this->classify(
                submissionId: (int) $submission->id,
                schoolId: (int) $submission->school_id,
                academicYearId: (int) $submission->academic_year_id,
                type: (string) $file->type,
                path: is_string($file->path) ? $file->path : null,
                originalFilename: is_string($file->original_filename) ? $file->original_filename : null,
            );
        }

        $statusCounts = [];
        $reuploadRequired = 0;
        foreach ($rows as $row) {
            $status = (string) $row['status'];
            $statusCounts[$status] = ($statusCounts[$status] ?? 0) + 1;
            if (($row['action'] ?? null) === 'reupload_required') {
                $reuploadRequired++;
            }
        }

        $filteredRows = $onlyMissing
            ? array_values(array_filter($rows, static fn (array $row): bool => ($row['action'] ?? null) === 'reupload_required'))
            : $rows;

        return [
            'summary' => [
                'totalMetadataRows' => count($rows),
                'displayedRows' => min(count($filteredRows), $limit),
                'reuploadRequired' => $reuploadRequired,
                'statusCounts' => $statusCounts,
            ],
            'rows' => array_slice($filteredRows, 0, $limit),
        ];
    }

    /**
     * @return \Illuminate\Database\Eloquent\Collection<int, IndicatorSubmission>
     */
    private function coreMetadataRows()
    {
        return IndicatorSubmission::query()
            ->select([
                'id',
                'school_id',
                'academic_year_id',
                'bmef_file_path',
                'bmef_original_filename',
                'bmef_uploaded_at',
                'bmef_file_size',
                'smea_file_path',
                'smea_original_filename',
                'smea_uploaded_at',
                'smea_file_size',
            ])
            ->where(function ($query): void {
                foreach ([
                    'bmef_file_path',
                    'bmef_original_filename',
                    'bmef_uploaded_at',
                    'bmef_file_size',
                    'smea_file_path',
                    'smea_original_filename',
                    'smea_uploaded_at',
                    'smea_file_size',
                ] as $column) {
                    $query->orWhereNotNull($column);
                }
            })
            ->orderBy('id')
            ->get();
    }

    /**
     * @return \Illuminate\Database\Eloquent\Collection<int, IndicatorSubmissionFile>
     */
    private function nonCoreMetadataRows()
    {
        return IndicatorSubmissionFile::query()
            ->with('submission:id,school_id,academic_year_id')
            ->orderBy('indicator_submission_id')
            ->orderBy('type')
            ->get();
    }

    private function hasAnyMetadata(mixed ...$values): bool
    {
        foreach ($values as $value) {
            if ($value !== null && trim((string) $value) !== '') {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array<string, mixed>
     */
    private function classify(
        int $submissionId,
        int $schoolId,
        int $academicYearId,
        string $type,
        ?string $path,
        ?string $originalFilename,
    ): array {
        $path = trim((string) ($path ?? ''));
        $pathKind = 'empty';
        $status = 'metadata_missing';
        $exists = false;
        $action = 'metadata_cleanup_optional';

        if ($path !== '') {
            if ($this->blobStorage->isDatabasePath($path)) {
                $parsed = $this->blobStorage->parsePath($path);
                if (! $parsed) {
                    $pathKind = 'invalid';
                    $status = 'invalid_database_path';
                    $action = 'reupload_required';
                } else {
                    $pathKind = 'database_blob';
                    $exists = $this->blobStorage->existsForPath($path);
                    $status = $exists ? 'ok_database_blob' : 'missing_database_blob';
                    $action = $exists ? 'none' : 'reupload_required';
                }
            } elseif (str_starts_with($path, 'database://')) {
                $pathKind = 'invalid';
                $status = 'invalid_database_path';
                $action = 'reupload_required';
            } else {
                $pathKind = 'legacy_disk';
                $exists = $this->fileStorage->pathExists($path);
                $status = $exists ? 'ok_legacy_disk' : 'missing_legacy_disk';
                $action = $exists ? 'legacy_disk_still_available' : 'reupload_required';
            }
        }

        return [
            'submission_id' => $submissionId,
            'school_id' => $schoolId,
            'academic_year_id' => $academicYearId,
            'type' => $type,
            'path_kind' => $pathKind,
            'exists' => $exists,
            'status' => $status,
            'original_filename' => $originalFilename,
            'action' => $action,
        ];
    }
}
