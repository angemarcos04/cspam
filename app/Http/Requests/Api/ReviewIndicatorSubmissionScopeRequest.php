<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ReviewIndicatorSubmissionScopeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'scopeId' => ['required', 'string', 'max:120'],
            'decision' => ['required', 'string', Rule::in(['verified', 'returned'])],
            'notes' => ['nullable', 'string', 'max:2000', 'required_if:decision,returned'],
        ];
    }
}
