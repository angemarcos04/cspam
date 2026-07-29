<?php

namespace App\Http\Requests\Api;

use App\Support\Auth\UserRoleResolver;
use Illuminate\Foundation\Http\FormRequest;

class UploadFmQadTemplateVersionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return UserRoleResolver::has($this->user(), UserRoleResolver::MONITOR);
    }

    public function rules(): array
    {
        return [
            'revisionLabel' => ['required', 'string', 'max:'.config('fm_qad.revision_label_max_length', 50)],
            'academicYearId' => ['nullable', 'integer', 'exists:academic_years,id'],
            'changeNotes' => ['required', 'string', 'max:'.config('fm_qad.change_notes_max_length', 5000)],
            'internalNote' => ['nullable', 'string', 'max:'.config('fm_qad.internal_note_max_length', 5000)],
            'file' => ['required', 'file', 'max:'.max(1, (int) config('fm_qad.max_upload_kb', 10240))],
            'activate' => ['sometimes', 'boolean'],
        ];
    }
}
