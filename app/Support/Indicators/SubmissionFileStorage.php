<?php

namespace App\Support\Indicators;

use App\Models\IndicatorSubmission;
use Illuminate\Filesystem\FilesystemAdapter;
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

    public function hasMetadata(IndicatorSubmission $submission, string $type): bool
    {
        $path = $submission->submissionFilePathForType($type);

        return is_string($path) && trim($path) !== '';
    }

    public function exists(IndicatorSubmission $submission, string $type): bool
    {
        $path = $submission->submissionFilePathForType($type);

        return $this->pathExists($path);
    }

    public function pathExists(?string $path): bool
    {
        return is_string($path)
            && trim($path) !== ''
            && $this->disk()->exists($path);
    }

    public function missingFromStorage(IndicatorSubmission $submission, string $type): bool
    {
        return $this->hasMetadata($submission, $type)
            && ! $this->exists($submission, $type);
    }
}
