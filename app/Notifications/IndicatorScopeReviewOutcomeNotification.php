<?php

namespace App\Notifications;

use App\Models\IndicatorSubmission;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Notification;

class IndicatorScopeReviewOutcomeNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        private readonly IndicatorSubmission $submission,
        private readonly User $monitor,
        private readonly string $scopeId,
        private readonly string $scopeLabel,
        private readonly string $decision,
        private readonly ?string $notes = null,
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
        $isVerified = $this->decision === 'verified';
        $monitorName = (string) ($this->monitor->name ?? 'Division Monitor');

        return [
            'eventType' => $isVerified ? 'indicator_scope_verified' : 'indicator_scope_returned',
            'title' => $isVerified ? "{$this->scopeLabel} verified" : "{$this->scopeLabel} returned",
            'message' => $isVerified
                ? "{$this->scopeLabel} for submission #{$this->submission->id} was verified by {$monitorName}."
                : "{$this->scopeLabel} for submission #{$this->submission->id} was returned by {$monitorName}.",
            'status' => $this->decision,
            'submissionId' => (string) $this->submission->id,
            'academicYearId' => (string) $this->submission->academic_year_id,
            'schoolId' => (string) $this->submission->school_id,
            'scopeId' => $this->scopeId,
            'scopeLabel' => $this->scopeLabel,
            'reviewNotes' => $this->notes,
            'monitorName' => $monitorName,
            'createdAt' => now()->toISOString(),
        ];
    }
}
