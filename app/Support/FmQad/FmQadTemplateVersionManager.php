<?php

namespace App\Support\FmQad;

use App\Events\CspamsUpdateBroadcast;
use App\Models\AuditLog;
use App\Models\FmQadForm;
use App\Models\FmQadTemplateVersion;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class FmQadTemplateVersionManager
{
    public function __construct(
        private readonly FmQadDocxValidator $validator,
        private readonly FmQadTemplateStorage $storage,
    ) {}

    /** @param array{revision_label:string, academic_year_id?:int|null, change_notes:string, internal_note?:string|null} $metadata */
    public function upload(FmQadForm $form, UploadedFile $file, array $metadata, ?User $actor, bool $activate = false, ?Request $request = null): FmQadTemplateVersion
    {
        $validatedFile = $this->validator->validateUploadedFile($file);
        $label = trim(preg_replace('/\s+/', ' ', $metadata['revision_label']) ?? '');
        $normalizedLabel = mb_strtolower($label);

        if ($label === '' || mb_strlen($label) > 50) {
            throw ValidationException::withMessages(['revisionLabel' => 'Revision label is required and may not exceed 50 characters.']);
        }
        if (trim($metadata['change_notes']) === '') {
            throw ValidationException::withMessages(['changeNotes' => 'Change notes are required.']);
        }
        if ($form->versions()->where('normalized_revision_label', $normalizedLabel)->exists()) {
            throw ValidationException::withMessages(['revisionLabel' => 'This revision label already exists for the selected FM-QAD form.']);
        }
        if ($form->versions()->where('sha256_hash', $validatedFile['sha256'])->exists()) {
            throw ValidationException::withMessages(['file' => 'This exact template file has already been uploaded for the selected FM-QAD form.']);
        }

        $version = DB::transaction(function () use ($form, $file, $metadata, $actor, $label, $normalizedLabel, $validatedFile): FmQadTemplateVersion {
            $version = $form->versions()->create([
                'academic_year_id' => $metadata['academic_year_id'] ?? null,
                'revision_label' => $label,
                'normalized_revision_label' => $normalizedLabel,
                'status' => FmQadTemplateVersion::DRAFT,
                'original_filename' => $this->safeFilename($file->getClientOriginalName(), $form->code.'.docx'),
                'mime_type' => $validatedFile['mime_type'],
                'size_bytes' => $validatedFile['size_bytes'],
                'sha256_hash' => $validatedFile['sha256'],
                'change_notes' => trim($metadata['change_notes']),
                'internal_note' => isset($metadata['internal_note']) ? trim((string) $metadata['internal_note']) ?: null : null,
                'uploaded_by' => $actor?->id,
            ]);
            $this->storage->put($version, $validatedFile['content'], $validatedFile['sha256']);
            return $version;
        });

        $this->audit($request, 'fm_qad_template.version_uploaded', $version, $actor);
        event(new CspamsUpdateBroadcast($this->broadcastPayload($version, 'fm_qad_template.version_uploaded')));

        return $activate ? $this->activate($version, $actor, $request) : $version->fresh(['form', 'academicYear', 'uploader', 'blob']);
    }

    public function activate(FmQadTemplateVersion $version, ?User $actor, ?Request $request = null): FmQadTemplateVersion
    {
        $previousId = null;
        $activated = DB::transaction(function () use ($version, $actor, &$previousId): FmQadTemplateVersion {
            $target = FmQadTemplateVersion::query()->lockForUpdate()->findOrFail($version->id);
            $conflicts = FmQadTemplateVersion::query()
                ->where('fm_qad_form_id', $target->fm_qad_form_id)
                ->where('status', FmQadTemplateVersion::ACTIVE)
                ->when($target->academic_year_id === null, fn ($q) => $q->whereNull('academic_year_id'), fn ($q) => $q->where('academic_year_id', $target->academic_year_id))
                ->lockForUpdate()
                ->get();
            $previousId = $conflicts->firstWhere('id', '!=', $target->id)?->id;
            foreach ($conflicts as $conflict) {
                if ((int) $conflict->id === (int) $target->id) continue;
                $conflict->update([
                    'status' => FmQadTemplateVersion::ARCHIVED,
                    'activation_key' => null,
                    'archived_by' => $actor?->id,
                    'archived_at' => now(),
                ]);
            }
            $target->update([
                'status' => FmQadTemplateVersion::ACTIVE,
                'activation_key' => $this->activationKey($target),
                'activated_by' => $actor?->id,
                'activated_at' => now(),
                'archived_by' => null,
                'archived_at' => null,
            ]);
            return $target;
        });

        $this->audit($request, 'fm_qad_template.version_activated', $activated, $actor, ['previousActiveVersionId' => $previousId]);
        event(new CspamsUpdateBroadcast($this->broadcastPayload($activated, 'fm_qad_template.version_activated')));
        return $activated->fresh(['form', 'academicYear', 'uploader', 'activator', 'blob']);
    }

    public function archive(FmQadTemplateVersion $version, ?User $actor, ?Request $request = null): FmQadTemplateVersion
    {
        $version->forceFill([
            'status' => FmQadTemplateVersion::ARCHIVED,
            'activation_key' => null,
            'archived_by' => $actor?->id,
            'archived_at' => now(),
        ])->save();
        $this->audit($request, 'fm_qad_template.version_archived', $version, $actor);
        event(new CspamsUpdateBroadcast($this->broadcastPayload($version, 'fm_qad_template.version_archived')));
        return $version->fresh(['form', 'academicYear', 'uploader', 'blob']);
    }

    /** @param array<string, mixed> $values */
    public function updateMetadata(FmQadTemplateVersion $version, array $values, ?User $actor, ?Request $request = null): FmQadTemplateVersion
    {
        if ($version->status !== FmQadTemplateVersion::DRAFT) {
            throw ValidationException::withMessages(['version' => 'Only draft template metadata can be edited.']);
        }
        $version->update($values);
        $this->audit($request, 'fm_qad_template.version_updated', $version, $actor);
        event(new CspamsUpdateBroadcast($this->broadcastPayload($version, 'fm_qad_template.version_updated')));

        return $version->fresh(['form', 'academicYear', 'uploader', 'blob']);
    }

    public function effective(FmQadForm $form, ?int $academicYearId): ?FmQadTemplateVersion
    {
        if ($academicYearId !== null) {
            $exact = $form->versions()->active()->where('academic_year_id', $academicYearId)->latest('activated_at')->first();
            if ($exact) return $exact;
        }
        return $form->versions()->active()->whereNull('academic_year_id')->latest('activated_at')->first();
    }

    public function isApplicable(FmQadTemplateVersion $version, FmQadForm $form, ?int $academicYearId): bool
    {
        return (int) $version->fm_qad_form_id === (int) $form->id
            && $version->status === FmQadTemplateVersion::ACTIVE
            && (int) ($this->effective($form, $academicYearId)?->id ?? 0) === (int) $version->id;
    }

    private function activationKey(FmQadTemplateVersion $version): string
    {
        return $version->fm_qad_form_id.':'.($version->academic_year_id ?? 'baseline');
    }

    private function safeFilename(?string $filename, string $fallback): string
    {
        $safe = preg_replace('/[\\\\\\/\\x00-\\x1F\\x7F"\\r\\n]+/u', '-', trim((string) $filename)) ?? '';
        $safe = mb_substr($safe, 0, 180);
        return $safe !== '' ? $safe : $fallback;
    }

    private function audit(?Request $request, string $action, FmQadTemplateVersion $version, ?User $actor, array $extra = []): void
    {
        $version->loadMissing('form');
        AuditLog::query()->create([
            'user_id' => $actor?->id,
            'action' => $action,
            'auditable_type' => FmQadTemplateVersion::class,
            'auditable_id' => (string) $version->id,
            'metadata' => [
                'formId' => (string) $version->fm_qad_form_id,
                'scopeId' => $version->form?->scope_id,
                'code' => $version->form?->code,
                'versionId' => (string) $version->id,
                'revisionLabel' => $version->revision_label,
                'academicYearId' => $version->academic_year_id ? (string) $version->academic_year_id : null,
                'originalFilename' => $version->original_filename,
                'sizeBytes' => $version->size_bytes,
                'sha256Hash' => $version->sha256_hash,
                'changeNotes' => $version->change_notes,
                ...$extra,
            ],
            'ip_address' => $request?->ip(),
            'user_agent' => $request?->userAgent(),
            'created_at' => now(),
        ]);
    }

    private function broadcastPayload(FmQadTemplateVersion $version, string $eventType): array
    {
        $version->loadMissing('form');
        return [
            'entity' => 'fm_qad_template',
            'eventType' => $eventType,
            'formId' => (string) $version->fm_qad_form_id,
            'scopeId' => $version->form?->scope_id,
            'code' => $version->form?->code,
            'versionId' => (string) $version->id,
            'academicYearId' => $version->academic_year_id ? (string) $version->academic_year_id : null,
            'broadcastToPrivateSchools' => true,
            'updatedAt' => $version->updated_at?->toISOString(),
        ];
    }
}
