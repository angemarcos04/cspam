<?php

namespace App\Http\Resources;

use App\Models\FmQadTemplateVersion;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin FmQadTemplateVersion */
class FmQadTemplateVersionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $this->loadMissing(['form', 'academicYear', 'uploader', 'activator']);
        return [
            'id' => (string) $this->id,
            'formId' => (string) $this->fm_qad_form_id,
            'scopeId' => $this->form?->scope_id,
            'code' => $this->form?->code,
            'formName' => $this->form?->name,
            'revisionLabel' => $this->revision_label,
            'status' => $this->status,
            'academicYearId' => $this->academic_year_id ? (string) $this->academic_year_id : null,
            'academicYearLabel' => $this->academicYear?->name,
            'originalFilename' => $this->original_filename,
            'mimeType' => $this->mime_type,
            'sizeBytes' => (int) $this->size_bytes,
            'sha256Hash' => $this->sha256_hash,
            'changeNotes' => $this->change_notes,
            'internalNote' => $this->when($request->user() && \App\Support\Auth\UserRoleResolver::has($request->user(), 'monitor'), $this->internal_note),
            'uploadedBy' => $this->uploader ? ['id' => (string) $this->uploader->id, 'name' => $this->uploader->name] : null,
            'activatedBy' => $this->activator ? ['id' => (string) $this->activator->id, 'name' => $this->activator->name] : null,
            'activatedAt' => $this->activated_at?->toISOString(),
            'archivedAt' => $this->archived_at?->toISOString(),
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
            'isUsedBySubmission' => $this->relationLoaded('submissionFiles') ? $this->submissionFiles->isNotEmpty() : null,
            'downloadUrl' => "/api/fm-qad/template-versions/{$this->id}/download",
        ];
    }
}
