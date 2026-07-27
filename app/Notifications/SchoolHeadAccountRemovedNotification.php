<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class SchoolHeadAccountRemovedNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        private readonly string $schoolName,
        private readonly ?string $schoolCode = null,
        private readonly ?string $accountName = null,
        private readonly ?string $reason = null,
    ) {
        $this->afterCommit();
    }

    /**
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    /**
     * @return array<string, string>
     */
    public function viaConnections(): array
    {
        $configured = trim((string) config('auth_mfa.monitor.queue_connection', ''));
        $connection = $configured !== ''
            ? $configured
            : trim((string) config('queue.default', 'database'));

        if ($connection === '' || strtolower($connection) === 'sync') {
            $connection = 'database';
        }

        return ['mail' => $connection];
    }

    /**
     * @return array<string, string>
     */
    public function viaQueues(): array
    {
        $queue = trim((string) config('auth_mfa.monitor.queue', 'mail'));

        return ['mail' => $queue !== '' ? $queue : 'mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $schoolLabel = $this->schoolCode !== null && trim($this->schoolCode) !== ''
            ? "{$this->schoolName} ({$this->schoolCode})"
            : $this->schoolName;

        $message = (new MailMessage)
            ->subject('CSPAMS School Head account and school record removed')
            ->greeting('Hello '.(($this->accountName !== null && trim($this->accountName) !== '') ? trim($this->accountName) : 'School Head').',')
            ->line("Your CSPAMS School Head account and school record for {$schoolLabel} were removed.")
            ->line('For questions or access concerns, contact your Division Office, assigned monitor, or system administrator.');

        if ($this->reason !== null && trim($this->reason) !== '') {
            $message->line('Reason provided by the Division Monitor: '.trim($this->reason));
        }

        return $message;
    }
}
