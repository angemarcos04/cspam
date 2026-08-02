<?php

namespace App\Http\Requests\Api;

use App\Support\Auth\UserRoleResolver;
use Illuminate\Foundation\Http\FormRequest;

class UpdateFmQadTemplateVersionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return UserRoleResolver::has($this->user(), UserRoleResolver::MONITOR);
    }

    public function rules(): array
    {
        return [
            'revisionLabel' => ['sometimes', 'required', 'string', 'max:50'],
            'academicYearId' => ['sometimes', 'nullable', 'integer', 'exists:academic_years,id'],
            'changeNotes' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'internalNote' => ['sometimes', 'nullable', 'string', 'max:5000'],
        ];
    }
}
