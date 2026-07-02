<?php

namespace App\Http\Requests\Api;

use App\Support\Schools\SchoolCoverage;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

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

                $rawLevel = $row['schoolCoverage'] ?? $row['school_coverage'] ?? $row['level'] ?? null;
                $normalizedLevel = SchoolCoverage::normalize($rawLevel) ?? $normalize($rawLevel);

                return [
                    'schoolId' => strtoupper((string) $normalize($row['schoolId'] ?? null)),
                    'schoolName' => $normalize($row['schoolName'] ?? null),
                    'level' => $normalizedLevel,
                    'type' => strtolower((string) $normalize($row['type'] ?? null)),
                    'address' => $normalize($row['address'] ?? null),
                    'district' => $normalize($row['district'] ?? null),
                    'region' => $normalize($row['region'] ?? null),
                    'status' => strtolower((string) $normalize($row['status'] ?? null)),
                    'schoolHeadName' => $normalize($row['schoolHeadName'] ?? null),
                    'schoolHeadEmail' => strtolower((string) $normalize($row['schoolHeadEmail'] ?? null)),
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
            'rows.*.level' => ['required', 'string', Rule::in(SchoolCoverage::CANONICAL_VALUES)],
            'rows.*.type' => ['required', 'string', Rule::in(['public', 'private'])],
            'rows.*.address' => ['required', 'string', 'max:255'],
            'rows.*.district' => ['sometimes', 'nullable', 'string', 'max:255'],
            'rows.*.region' => ['sometimes', 'nullable', 'string', 'max:255'],
            'rows.*.status' => ['sometimes', 'nullable', 'string', Rule::in(['active', 'inactive', 'pending'])],
            'rows.*.schoolHeadName' => ['sometimes', 'nullable', 'string', 'max:255'],
            'rows.*.schoolHeadEmail' => ['sometimes', 'nullable', 'email', 'max:255'],
            'options' => ['sometimes', 'array'],
            'options.updateExisting' => ['sometimes', 'boolean'],
            'options.restoreArchived' => ['sometimes', 'boolean'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $rows = $this->input('rows', []);
            if (! is_array($rows)) {
                return;
            }

            foreach ($rows as $index => $row) {
                if (! is_array($row)) {
                    continue;
                }

                $name = trim((string) ($row['schoolHeadName'] ?? ''));
                $email = trim((string) ($row['schoolHeadEmail'] ?? ''));
                if ($name === '' && $email === '') {
                    continue;
                }

                if ($name === '') {
                    $validator->errors()->add("rows.{$index}.schoolHeadName", 'School Head name is required when School Head email is provided.');
                }

                if ($email === '') {
                    $validator->errors()->add("rows.{$index}.schoolHeadEmail", 'School Head email is required when School Head name is provided.');
                }
            }
        });
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
