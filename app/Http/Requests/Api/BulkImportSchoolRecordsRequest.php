<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class BulkImportSchoolRecordsRequest extends FormRequest
{
    protected function prepareForValidation(): void
    {
        $rows = $this->input('rows');
        if (! is_array($rows)) {
            return;
        }

        $normalize = static function (?string $value): ?string {
            if ($value === null) {
                return null;
            }

            $normalized = trim($value);

            return $normalized === '' ? null : $normalized;
        };

        $this->merge([
            'rows' => array_map(static function ($row) use ($normalize) {
                if (! is_array($row)) {
                    return $row;
                }

                $normalizedLevel = $normalize($row['level'] ?? null);
                $normalizedLevelToken = $normalizedLevel !== null
                    ? strtolower(str_replace(['_', '-'], ' ', $normalizedLevel))
                    : null;

                if ($normalizedLevelToken === 'elementary') {
                    $normalizedLevel = 'Elementary';
                } elseif (in_array($normalizedLevelToken, ['high school', 'secondary'], true)) {
                    $normalizedLevel = 'High School';
                }

                return [
                    'schoolId' => strtoupper((string) $normalize($row['schoolId'] ?? null)),
                    'schoolName' => $normalize($row['schoolName'] ?? null),
                    'level' => $normalizedLevel,
                    'type' => strtolower((string) $normalize($row['type'] ?? null)),
                    'address' => $normalize($row['address'] ?? null),
                    'district' => $normalize($row['district'] ?? null),
                    'region' => $normalize($row['region'] ?? null),
                    'status' => strtolower((string) $normalize($row['status'] ?? null)),
                ];
            }, $rows),
            'options' => [
                'updateExisting' => (bool) $this->boolean('options.updateExisting', true),
                'restoreArchived' => (bool) $this->boolean('options.restoreArchived', true),
            ],
        ]);
    }

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'rows' => ['required', 'array', 'min:1', 'max:500'],
            'rows.*.schoolId' => ['required', 'string', 'size:6', 'regex:/^\d{6}$/', 'distinct:strict'],
            'rows.*.schoolName' => ['required', 'string', 'max:255'],
            'rows.*.level' => ['required', 'string', Rule::in(['Elementary', 'High School'])],
            'rows.*.type' => ['required', 'string', Rule::in(['public', 'private'])],
            'rows.*.address' => ['required', 'string', 'max:255'],
            'rows.*.district' => ['sometimes', 'nullable', 'string', 'max:255'],
            'rows.*.region' => ['sometimes', 'nullable', 'string', 'max:255'],
            'rows.*.status' => ['sometimes', 'nullable', 'string', Rule::in(['active', 'inactive', 'pending'])],
            'options' => ['sometimes', 'array'],
            'options.updateExisting' => ['sometimes', 'boolean'],
            'options.restoreArchived' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'rows.*.schoolId.distinct' => 'Duplicate school code detected in the import batch.',
        ];
    }
}
