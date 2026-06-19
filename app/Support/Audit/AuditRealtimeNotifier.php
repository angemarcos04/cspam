<?php

namespace App\Support\Audit;

use App\Events\CspamsUpdateBroadcast;
use App\Models\AuditLog;
use Illuminate\Support\Str;

class AuditRealtimeNotifier
{
    public function dispatch(AuditLog $auditLog): void
    {
        $metadata = is_array($auditLog->metadata) ? $auditLog->metadata : [];

        $payload = array_filter([
            'entity' => 'audit',
            'eventType' => 'audit.log_created',
            'auditId' => (string) $auditLog->id,
            'auditAction' => $this->safeString($auditLog->action),
            'schoolId' => $this->safeString($metadata['school_id'] ?? null),
            'schoolCode' => $this->safeString($metadata['school_code'] ?? null),
            'academicYearId' => $this->safeString($metadata['academic_year_id'] ?? null),
            'academicYearLabel' => $this->safeString($metadata['academic_year_label'] ?? null),
            'submissionId' => $this->safeString($metadata['submission_id'] ?? null),
            'scopeId' => $this->safeString($metadata['scope_id'] ?? null),
            'scopeType' => $this->safeString($metadata['scope_type'] ?? null),
            'fileType' => $this->safeString($metadata['file_type'] ?? null),
            'actorRole' => $this->safeString($metadata['actor_role'] ?? $metadata['role'] ?? null),
            'createdAt' => optional($auditLog->created_at)->toISOString(),
        ], static fn (mixed $value): bool => $value !== null && $value !== '');

        event(new CspamsUpdateBroadcast($payload));
    }

    private function safeString(mixed $value, int $limit = 120): ?string
    {
        if (! is_scalar($value) && ! $value instanceof \Stringable) {
            return null;
        }

        $normalized = trim((string) $value);
        if ($normalized === '') {
            return null;
        }

        $normalized = preg_replace('/\s+/', ' ', $normalized) ?: $normalized;

        return Str::limit($normalized, $limit, '');
    }
}
