<?php

namespace App\Support\Indicators;

use App\Models\IndicatorSubmission;
use App\Models\IndicatorSubmissionFileBlob;
use Illuminate\Http\UploadedFile;
use RuntimeException;

class SubmissionFileBlobStorage
{
    private const DATABASE_PATH_PREFIX = 'database://indicator-submissions/';

    public function makePath(IndicatorSubmission $submission, string $type): string
    {
        return self::DATABASE_PATH_PREFIX . (int) $submission->getKey() . '/' . strtolower(trim($type));
    }

    public function isDatabasePath(?string $path): bool
    {
        return is_string($path) && str_starts_with(trim($path), self::DATABASE_PATH_PREFIX);
    }

    /**
     * @return array{submission_id: int, type: string}|null
     */
    public function parsePath(?string $path): ?array
    {
        if (! $this->isDatabasePath($path)) {
            return null;
        }

        $path = trim((string) $path);
        if (! preg_match('#^database://indicator-submissions/([1-9][0-9]*)/([A-Za-z0-9_-]+)$#', $path, $matches)) {
            return null;
        }

        return [
            'submission_id' => (int) $matches[1],
            'type' => strtolower($matches[2]),
        ];
    }

    public function put(
        IndicatorSubmission $submission,
        string $type,
        UploadedFile $file,
        string $originalFilename,
    ): IndicatorSubmissionFileBlob {
        $realPath = $file->getRealPath();
        $content = is_string($realPath) && $realPath !== '' ? file_get_contents($realPath) : false;
        if ($content === false) {
            throw new RuntimeException('Uploaded file bytes could not be read.');
        }

        return IndicatorSubmissionFileBlob::query()->updateOrCreate(
            [
                'indicator_submission_id' => (int) $submission->getKey(),
                'type' => strtolower(trim($type)),
            ],
            [
                'original_filename' => $originalFilename,
                'mime_type' => $file->getMimeType() ?: 'application/octet-stream',
                'size_bytes' => strlen($content),
                'sha256' => hash('sha256', $content),
                'content' => $content,
                'uploaded_at' => now(),
            ],
        );
    }

    public function existsForSubmission(IndicatorSubmission $submission, string $type): bool
    {
        return IndicatorSubmissionFileBlob::query()
            ->where('indicator_submission_id', (int) $submission->getKey())
            ->where('type', strtolower(trim($type)))
            ->exists();
    }

    public function existsForPath(?string $path): bool
    {
        return $this->findForPath($path) !== null;
    }

    public function findForSubmission(IndicatorSubmission $submission, string $type): ?IndicatorSubmissionFileBlob
    {
        return IndicatorSubmissionFileBlob::query()
            ->where('indicator_submission_id', (int) $submission->getKey())
            ->where('type', strtolower(trim($type)))
            ->first();
    }

    public function findForPath(?string $path): ?IndicatorSubmissionFileBlob
    {
        $parsed = $this->parsePath($path);
        if (! $parsed) {
            return null;
        }

        return IndicatorSubmissionFileBlob::query()
            ->where('indicator_submission_id', $parsed['submission_id'])
            ->where('type', $parsed['type'])
            ->first();
    }

    public function deleteForPath(?string $path): bool
    {
        $parsed = $this->parsePath($path);
        if (! $parsed) {
            return false;
        }

        return IndicatorSubmissionFileBlob::query()
            ->where('indicator_submission_id', $parsed['submission_id'])
            ->where('type', $parsed['type'])
            ->delete() > 0;
    }

    public function contentAsString(IndicatorSubmissionFileBlob $blob): string
    {
        $content = $blob->content;
        if (is_resource($content)) {
            $streamContent = stream_get_contents($content);

            return $streamContent === false ? '' : $streamContent;
        }

        return is_string($content) ? $content : (string) $content;
    }
}
