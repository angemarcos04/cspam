<?php

namespace App\Support\Audit;

use App\Models\AuditLog;
use App\Models\IndicatorSubmission;
use App\Models\User;
use App\Support\Auth\UserRoleResolver;
use App\Support\Indicators\GroupBWorkspaceDefinition;
use App\Support\Indicators\SubmissionFileDefinition;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class WorkflowAuditLogger
{
    /**
     * @param array<string, mixed> $metadata
     */
    public function recordSubmissionEvent(
        Request $request,
        string $action,
        IndicatorSubmission $submission,
        User $actor,
        array $metadata = [],
    ): void {
        $submission->loadMissing([
            'school:id,school_code,name,type',
            'academicYear:id,name',
        ]);

        AuditLog::query()->create([
            'user_id' => $actor->id,
            'action' => $action,
            'auditable_type' => IndicatorSubmission::class,
            'auditable_id' => $submission->id,
            'metadata' => $this->safeSubmissionMetadata($request, $submission, $actor, $metadata),
            'ip_address' => $this->normalizeIpAddress($request->ip()),
            'user_agent' => $this->normalizeUserAgent($request->userAgent()),
            'created_at' => now(),
        ]);
    }

    /**
     * @param array<string, mixed> $metadata
     * @return array<string, mixed>
     */
    private function safeSubmissionMetadata(
        Request $request,
        IndicatorSubmission $submission,
        User $actor,
        array $metadata,
    ): array {
        $scopeId = $this->safeString($metadata['scope_id'] ?? $metadata['scopeId'] ?? null);
        $fileType = $this->safeString($metadata['file_type'] ?? $metadata['fileType'] ?? null);
        $scopeType = $this->safeString($metadata['scope_type'] ?? $metadata['scopeType'] ?? null);

        if ($scopeType === null && $fileType !== null) {
            $scopeType = 'file';
        }
        if ($scopeType === null && $scopeId !== null) {
            $scopeType = SubmissionFileDefinition::isValidType($scopeId) ? 'file' : 'section';
        }

        $safe = [
            'category' => 'workflow',
            'event' => $this->safeString($metadata['event'] ?? null),
            'actor_role' => $this->resolveActorRole($actor),
            'actor_name' => $this->safeString($actor->name),
            'school_id' => (string) $submission->school_id,
            'school_code' => $this->safeString($submission->school?->school_code),
            'school_name' => $this->safeString($submission->school?->name),
            'school_type' => $this->safeString($submission->school?->type),
            'academic_year_id' => (string) $submission->academic_year_id,
            'academic_year_label' => $this->safeString($submission->academicYear?->name),
            'submission_id' => (string) $submission->id,
            'status' => $this->safeString($metadata['status'] ?? $this->statusValue($submission->status)),
            'old_status' => $this->safeString($metadata['old_status'] ?? $metadata['oldStatus'] ?? null),
            'new_status' => $this->safeString($metadata['new_status'] ?? $metadata['newStatus'] ?? null),
            'scope_id' => $scopeId,
            'scope_type' => $scopeType,
            'scope_label' => $this->safeString($metadata['scope_label'] ?? $metadata['scopeLabel'] ?? $this->labelForScope($scopeId ?? $fileType)),
            'file_type' => $fileType,
            'file_label' => $this->safeString($metadata['file_label'] ?? $metadata['fileLabel'] ?? $this->labelForScope($fileType)),
            'decision' => $this->safeString($metadata['decision'] ?? null),
            'previous_decision' => $this->safeString($metadata['previous_decision'] ?? $metadata['previousDecision'] ?? null),
            'has_note' => array_key_exists('has_note', $metadata)
                ? (bool) $metadata['has_note']
                : (array_key_exists('notes', $metadata) && trim((string) $metadata['notes']) !== ''),
            'ip_address' => $this->normalizeIpAddress($request->ip()),
            'user_agent' => $this->normalizeUserAgent($request->userAgent()),
            'occurred_at' => now()->toISOString(),
        ];

        foreach ([
            'scope_ids',
            'scopeIds',
            'targets',
            'touchedScopes',
        ] as $listKey) {
            if (array_key_exists($listKey, $metadata)) {
                $safe['scope_ids'] = $this->safeStringList($metadata[$listKey]);
                break;
            }
        }

        foreach ([
            'indicator_count',
            'file_size_bytes',
            'submitted_scope_count',
        ] as $numericKey) {
            if (array_key_exists($numericKey, $metadata) && is_numeric($metadata[$numericKey])) {
                $safe[$numericKey] = (int) $metadata[$numericKey];
            }
        }

        if (array_key_exists('original_filename', $metadata)) {
            $safe['original_filename'] = $this->safeFilename($metadata['original_filename']);
        }

        return array_filter(
            $safe,
            static fn (mixed $value): bool => $value !== null && $value !== '' && $value !== [],
        );
    }

    private function resolveActorRole(User $actor): ?string
    {
        if (UserRoleResolver::has($actor, UserRoleResolver::MONITOR)) {
            return UserRoleResolver::MONITOR;
        }

        if (UserRoleResolver::has($actor, UserRoleResolver::SCHOOL_HEAD)) {
            return UserRoleResolver::SCHOOL_HEAD;
        }

        return null;
    }

    private function statusValue(mixed $status): ?string
    {
        if ($status instanceof \BackedEnum) {
            return (string) $status->value;
        }

        return $this->safeString($status);
    }

    private function labelForScope(?string $scope): ?string
    {
        if ($scope === null || $scope === '') {
            return null;
        }

        if (SubmissionFileDefinition::isValidType($scope)) {
            return SubmissionFileDefinition::shortLabelFor($scope);
        }

        return match ($scope) {
            GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS => 'School Achievements',
            GroupBWorkspaceDefinition::KEY_PERFORMANCE => 'Key Performance',
            default => Str::headline(str_replace(['_', '-'], ' ', $scope)),
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

        return Str::limit($normalized, $limit, '');
    }

    /**
     * @return list<string>
     */
    private function safeStringList(mixed $value): array
    {
        $rawValues = is_array($value) ? $value : [$value];
        $safeValues = [];

        foreach ($rawValues as $entry) {
            $safe = $this->safeString($entry, 80);
            if ($safe !== null) {
                $safeValues[] = $safe;
            }
        }

        return array_values(array_unique($safeValues));
    }

    private function safeFilename(mixed $value): ?string
    {
        $filename = $this->safeString($value, 180);
        if ($filename === null) {
            return null;
        }

        return basename(str_replace('\\', '/', $filename));
    }

    private function normalizeIpAddress(?string $ipAddress): ?string
    {
        return $this->safeString($ipAddress, 45);
    }

    private function normalizeUserAgent(?string $userAgent): ?string
    {
        return $this->safeString($userAgent, 500);
    }
}
