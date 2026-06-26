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
            'createdAt' => now()->toISOString(),
        ];
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
