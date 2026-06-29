<?php

namespace App\Notifications;

use App\Models\School;
use App\Models\User;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Str;

class SchoolSubmissionReminderNotification extends Notification
{
    public function __construct(
        private readonly School $school,
        private readonly User $monitor,
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
        $schoolCode = (string) ($this->school->school_code ?? 'N/A');
        $schoolName = (string) ($this->school->name ?? 'Your school');
        $monitorName = (string) ($this->monitor->name ?? 'Division Monitor');
        $notePreview = is_string($this->notes) && trim($this->notes) !== ''
            ? Str::limit(trim($this->notes), 180)
            : null;

        return [
            'eventType' => 'reminder_sent',
            'title' => 'Submission reminder',
            'message' => "Division Monitor sent a reminder to update and submit your school's latest CSPAMS records.",
            'schoolId' => (string) $this->school->id,
            'schoolCode' => $schoolCode,
            'schoolName' => $schoolName,
            'monitorName' => $monitorName,
            'notes' => $this->notes,
            'notePreview' => $notePreview,
            'actionLabel' => 'Open School Head workspace',
            'actionUrl' => '/school-admin',
            'target' => [
                'dashboard' => 'school_head',
                'section' => 'requirements',
                'schoolId' => (string) $this->school->id,
                'schoolCode' => $schoolCode,
            ],
            'createdAt' => now()->toISOString(),
        ];
    }
}
