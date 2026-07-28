<?php

namespace App\Support\FmQad;

use Illuminate\Http\UploadedFile;
use Illuminate\Validation\ValidationException;
use ZipArchive;

class FmQadDocxValidator
{
    /**
     * @return array{content: string, mime_type: string, size_bytes: int, sha256: string}
     */
    public function validateUploadedFile(UploadedFile $file): array
    {
        $name = trim($file->getClientOriginalName());
        if (strtolower(pathinfo($name, PATHINFO_EXTENSION)) !== 'docx') {
            throw ValidationException::withMessages(['file' => 'The template file must use the .docx extension.']);
        }

        $path = $file->getRealPath();
        $content = is_string($path) && $path !== '' ? file_get_contents($path) : false;
        if (! is_string($content) || $content === '') {
            throw ValidationException::withMessages(['file' => 'The template file is empty or could not be read.']);
        }

        $maxBytes = max(1, (int) config('fm_qad.max_upload_kb', 10240)) * 1024;
        if (strlen($content) > $maxBytes) {
            throw ValidationException::withMessages(['file' => 'The template file may not be larger than '.(int) ceil($maxBytes / 1048576).' MB.']);
        }

        $mime = strtolower((string) ($file->getMimeType() ?: ''));
        $allowedMimes = [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/zip',
            'application/x-zip-compressed',
        ];
        if (! in_array($mime, $allowedMimes, true)) {
            throw ValidationException::withMessages(['file' => 'The uploaded file is not a valid DOCX document.']);
        }

        $zip = new ZipArchive();
        if (! is_string($path) || $zip->open($path) !== true) {
            throw ValidationException::withMessages(['file' => 'The uploaded file is not a readable DOCX package.']);
        }
        $hasContentTypes = $zip->locateName('[Content_Types].xml', ZipArchive::FL_NOCASE) !== false;
        $hasDocument = $zip->locateName('word/document.xml', ZipArchive::FL_NOCASE) !== false;
        $zip->close();

        if (! $hasContentTypes || ! $hasDocument) {
            throw ValidationException::withMessages(['file' => 'The DOCX package is missing required Word document files.']);
        }

        return [
            'content' => $content,
            'mime_type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'size_bytes' => strlen($content),
            'sha256' => hash('sha256', $content),
        ];
    }

    /** @return array{content: string, mime_type: string, size_bytes: int, sha256: string} */
    public function validatePath(string $path): array
    {
        return $this->validateUploadedFile(new UploadedFile(
            $path,
            basename($path),
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            null,
            true,
        ));
    }
}
