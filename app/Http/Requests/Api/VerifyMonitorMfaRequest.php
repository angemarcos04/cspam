<?php

namespace App\Http\Requests\Api;

use App\Http\Requests\Api\Concerns\NormalizesAuthRoleAndLoginInput;
use App\Support\Auth\UserRoleResolver;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class VerifyMonitorMfaRequest extends FormRequest
{
    use NormalizesAuthRoleAndLoginInput;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $role = $this->normalizeRoleForLoginPayload($this->input('role'));

        $this->merge([
            'role' => $role,
            'login' => $this->normalizeLoginIdentifierForRole($this->input('login'), $role),
            'code' => $this->normalizeMfaCode($this->input('code')),
        ]);
    }

    private function normalizeMfaCode(mixed $value): mixed
    {
        if (! is_scalar($value)) {
            return $value;
        }

        $raw = trim((string) $value);
        if ($raw === '') {
            return $raw;
        }

        if (preg_match('/^[\d\s-]+$/', $raw) === 1) {
            $digits = preg_replace('/\D+/', '', $raw) ?? '';

            return strlen($digits) === 6 ? $digits : $raw;
        }

        $compact = strtoupper(preg_replace('/[^A-Za-z0-9]+/', '', $raw) ?? '');
        if (strlen($compact) === 8) {
            return substr($compact, 0, 4) . '-' . substr($compact, 4, 4);
        }

        return strtoupper($raw);
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'role' => ['required', 'string', Rule::in([UserRoleResolver::MONITOR])],
            'login' => ['required', 'string', 'email', 'max:255'],
            'challenge_id' => ['required', 'string', 'uuid'],
            'code' => ['required', 'string', 'regex:/^(?:\d{6}|[A-Za-z0-9]{4}-[A-Za-z0-9]{4})$/'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'role.in' => 'MFA verification is currently supported for division monitor accounts only.',
            'code.regex' => 'Code must be a 6-digit verification code or an 8-character backup code (XXXX-XXXX).',
        ];
    }
}
