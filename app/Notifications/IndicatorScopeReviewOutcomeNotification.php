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
        $monitorName = (string) ($this->monitor->name ?? 'Division Monitor');
        [$eventType, $title, $message] = $this->notificationCopy($monitorName);

        return [
            'eventType' => $eventType,
            'title' => $title,
            'message' => $message,
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

    /**
     * @return array{0: string, 1: string, 2: string}
     */
    private function notificationCopy(string $monitorName): array
    {
        return match ($this->decision) {
            'verified' => [
                'indicator_scope_verified',
                "{$this->scopeLabel} verified",
                "{$this->scopeLabel} for submission #{$this->submission->id} was verified by {$monitorName}.",
            ],
            'returned' => [
                'indicator_scope_returned',
                "{$this->scopeLabel} returned",
                "{$this->scopeLabel} for submission #{$this->submission->id} was returned by {$monitorName}.",
            ],
            'unverified' => [
                'indicator_scope_unverified',
                "{$this->scopeLabel} reopened for review",
                "{$this->scopeLabel} for submission #{$this->submission->id} was reopened for review by {$monitorName}.",
            ],
            default => [
                'indicator_scope_review_updated',
                "{$this->scopeLabel} review updated",
                "{$this->scopeLabel} for submission #{$this->submission->id} was updated by {$monitorName}.",
            ],
        };
    }
}
