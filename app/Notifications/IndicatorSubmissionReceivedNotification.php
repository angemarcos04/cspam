<?php

namespace App\Notifications;

use App\Models\IndicatorSubmission;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Notification;

class IndicatorSubmissionReceivedNotification extends Notification implements ShouldQueue
{
    use Queueable;

    /**
     * @param list<string> $scopeIds
     * @param list<string> $scopeLabels
     */
    public function __construct(
        private readonly IndicatorSubmission $submission,
        private readonly User $schoolHead,
        private readonly string $eventType,
        private readonly array $scopeIds = [],
        private readonly array $scopeLabels = [],
        private readonly ?string $notificationKey = null,
    ) {
    }

    /**
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        return ['database'];
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(object $notifiable): array
    {
        $this->submission->loadMissing(['school:id,school_code,name', 'academicYear:id,name']);

        $schoolName = (string) ($this->submission->school?->name ?? 'A school');
        $scopeLabelText = $this->scopeLabelText();
        $primaryScopeId = count($this->scopeIds) === 1 ? $this->scopeIds[0] : null;

        return [
            'eventType' => $this->eventType,
            'title' => $this->title($scopeLabelText),
            'message' => $this->message($schoolName, $scopeLabelText),
            'submissionId' => (string) $this->submission->id,
            'academicYearId' => (string) $this->submission->academic_year_id,
            'schoolId' => (string) $this->submission->school_id,
            'schoolCode' => (string) ($this->submission->school?->school_code ?? 'N/A'),
            'schoolName' => $schoolName,
            'schoolHeadName' => (string) ($this->schoolHead->name ?? 'School Head'),
            'submittedByName' => (string) ($this->schoolHead->name ?? 'School Head'),
            'scopeIds' => $this->scopeIds,
            'scopeLabels' => $this->scopeLabels,
            'targetSection' => 'reviews',
            'primaryScopeId' => $primaryScopeId,
            'actionUrl' => $this->buildActionUrl($primaryScopeId),
            'notificationKey' => $this->notificationKey,
            'createdAt' => now()->toISOString(),
        ];
    }

    private function buildActionUrl(?string $primaryScopeId): string
    {
        $query = [
            'section' => 'reviews',
            'submissionId' => (string) $this->submission->id,
            'schoolId' => (string) $this->submission->school_id,
            'academicYearId' => (string) $this->submission->academic_year_id,
        ];

        if ($primaryScopeId !== null) {
            $query['scopeId'] = $primaryScopeId;
        }

        return '/monitor?'.http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    }

    private function title(string $scopeLabelText): string
    {
        return match ($this->eventType) {
            'indicator_package_resubmitted' => 'Indicator package resubmitted',
            'indicator_scope_submitted' => "{$scopeLabelText} sent for review",
            'indicator_scope_resent' => "{$scopeLabelText} resent after revision",
            default => 'Indicator package submitted',
        };
    }

    private function message(string $schoolName, string $scopeLabelText): string
    {
        return match ($this->eventType) {
            'indicator_package_resubmitted' => "{$schoolName} resubmitted indicator package #{$this->submission->id} after revision.",
            'indicator_scope_submitted' => "{$schoolName} sent {$scopeLabelText} for review.",
            'indicator_scope_resent' => "{$schoolName} resent {$scopeLabelText} after revision.",
            default => "{$schoolName} submitted indicator package #{$this->submission->id} for review.",
        };
    }

    private function scopeLabelText(): string
    {
        $labels = array_values(array_filter(
            array_map(static fn (mixed $label): string => trim((string) $label), $this->scopeLabels),
            static fn (string $label): bool => $label !== '',
        ));

        if ($labels === []) {
            return 'requirements';
        }

        if (count($labels) === 1) {
            return $labels[0];
        }

        $last = array_pop($labels);

        return implode(', ', $labels) . ', and ' . $last;
    }
}
