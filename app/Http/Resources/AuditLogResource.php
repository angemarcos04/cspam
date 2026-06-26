<?php

namespace App\Http\Resources;

use App\Models\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin AuditLog */
class AuditLogResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $metadata = is_array($this->metadata) ? $this->metadata : [];

        return [
            'id' => (string) $this->id,
            'eventType' => $this->action,
            'eventLabel' => $this->eventLabel($this->action, $metadata),
            'actor' => [
                'id' => $this->user_id !== null ? (string) $this->user_id : null,
                'name' => $this->safeString($metadata['actor_name'] ?? $this->user?->name ?? null),
                'role' => $this->safeString($metadata['actor_role'] ?? $metadata['role'] ?? null),
            ],
            'school' => [
                'id' => $this->safeString($metadata['school_id'] ?? null),
                'code' => $this->safeString($metadata['school_code'] ?? null),
                'name' => $this->safeString($metadata['school_name'] ?? null),
                'type' => $this->safeString($metadata['school_type'] ?? null),
            ],
            'academicYear' => [
                'id' => $this->safeString($metadata['academic_year_id'] ?? null),
                'label' => $this->safeString($metadata['academic_year_label'] ?? null),
            ],
            'submissionId' => $this->safeString($metadata['submission_id'] ?? null),
            'scopeId' => $this->safeString($metadata['scope_id'] ?? null),
            'scopeType' => $this->safeString($metadata['scope_type'] ?? null),
            'scopeLabel' => $this->safeString($metadata['scope_label'] ?? null),
            'fileType' => $this->safeString($metadata['file_type'] ?? null),
            'fileLabel' => $this->safeString($metadata['file_label'] ?? null),
            'status' => [
                'from' => $this->safeString($metadata['old_status'] ?? null),
                'to' => $this->safeString($metadata['new_status'] ?? $metadata['status'] ?? null),
                'decision' => $this->safeString($metadata['decision'] ?? null),
                'previousDecision' => $this->safeString($metadata['previous_decision'] ?? null),
            ],
            'details' => $this->safeDetails($metadata),
            'ipAddress' => $this->safeString($metadata['ip_address'] ?? $this->ip_address ?? null, 45),
            'createdAt' => optional($this->created_at)->toISOString(),
        ];
    }

    /**
     * @param array<string, mixed> $metadata
     * @return array<string, mixed>
     */
    private function safeDetails(array $metadata): array
    {
        $safeKeys = [
            'outcome',
            'event_group',
            'has_note',
            'scope_ids',
            'indicator_count',
            'file_size_bytes',
            'submitted_scope_count',
            'original_filename',
        ];

        $details = [];
        foreach ($safeKeys as $key) {
            if (array_key_exists($key, $metadata)) {
                $details[$key] = $this->safeValue($metadata[$key]);
            }
        }

        return array_filter(
            $details,
            static fn (mixed $value): bool => $value !== null && $value !== '' && $value !== [],
        );
    }

    private function safeValue(mixed $value): mixed
    {
        if (is_array($value)) {
            return array_values(array_filter(
                array_map(fn (mixed $entry): ?string => $this->safeString($entry), $value),
                static fn (?string $entry): bool => $entry !== null,
            ));
        }

        if (is_bool($value) || is_int($value) || is_float($value)) {
            return $value;
        }

        return $this->safeString($value);
    }

    /**
     * @param array<string, mixed> $metadata
     */
    private function eventLabel(string $action, array $metadata): string
    {
        return match ($action) {
            'workspace.section_saved' => 'Saved section',
            'workspace.file_saved' => 'Saved file',
            'workspace.section_reset' => 'Reset section',
            'workspace.file_reset' => 'Reset file',
            'submission.scope_sent' => 'Sent scope',
            'submission.file_sent' => 'Sent file',
            'submission.scope_resent' => 'Resent returned item',
            'submission.file_resent' => 'Resent returned file',
            'submission.final_submitted' => 'Final submitted package',
            'monitor.report_viewed' => 'Viewed TARGETS-MET',
            'monitor.file_previewed' => 'Previewed file',
            'monitor.file_downloaded' => 'Downloaded file',
            'monitor.scope_verified' => 'Verified requirement',
            'monitor.scope_unverified' => 'Unverified requirement',
            'monitor.scope_returned' => 'Returned requirement',
            'monitor.package_validated' => 'Verified package',
            'monitor.package_returned' => 'Returned package',
            default => $this->safeString($metadata['event'] ?? $action, 120) ?? $action,
        };
    }

    private function safeString(mixed $value, int $limit = 180): ?string
    {
        if (! is_scalar($value) && ! $value instanceof \Stringable) {
            return null;
        }

        $normalized = trim((string) $value);
        if ($normalized === '') {
            return null;
        }

        $normalized = preg_replace('/\s+/', ' ', $normalized) ?: $normalized;

        return str($normalized)->limit($limit, '')->toString();
    }
}
