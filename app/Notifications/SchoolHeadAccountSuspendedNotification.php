<?php

namespace App\Notifications;

use App\Models\School;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class SchoolHeadAccountSuspendedNotification extends Notification
{
    use Queueable;

    public function __construct(
        private readonly School $school,
        private readonly ?string $reason = null,
    ) {
    }

    /**
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $schoolName = (string) ($this->school->name ?? 'your school');
        $schoolCode = (string) ($this->school->school_code ?? 'N/A');

        $message = (new MailMessage())
            ->subject('CSPAMS School Head account suspended')
            ->greeting('Hello ' . ((string) ($notifiable->name ?? 'School Head')) . ',')
            ->line("Your CSPAMS School Head account for {$schoolName} ({$schoolCode}) has been suspended.")
            ->line('If you need access restored, contact your Division Office, assigned monitor, or system administrator.');

        if ($this->reason !== null && trim($this->reason) !== '') {
            $message->line('Reason provided by the Division Monitor: ' . trim($this->reason));
        }

        return $message;
    }
}
