<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class SchoolHeadAccountRemovedNotification extends Notification
{
    use Queueable;

    public function __construct(
        private readonly string $schoolName,
        private readonly ?string $schoolCode = null,
        private readonly ?string $accountName = null,
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
        $schoolLabel = $this->schoolCode !== null && trim($this->schoolCode) !== ''
            ? "{$this->schoolName} ({$this->schoolCode})"
            : $this->schoolName;

        $message = (new MailMessage())
            ->subject('CSPAMS School Head account and school record removed')
            ->greeting('Hello ' . (($this->accountName !== null && trim($this->accountName) !== '') ? trim($this->accountName) : 'School Head') . ',')
            ->line("Your CSPAMS School Head account and school record for {$schoolLabel} were removed.")
            ->line('For questions or access concerns, contact your Division Office, assigned monitor, or system administrator.');

        if ($this->reason !== null && trim($this->reason) !== '') {
            $message->line('Reason provided by the Division Monitor: ' . trim($this->reason));
        }

        return $message;
    }
}
