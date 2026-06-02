<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\Log;

class MonitorMfaCodeNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        private readonly string $code,
        private readonly string $expiresAt,
    ) {}

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
        Log::info('Monitor MFA email job rendering mail message.', [
            'recipient' => (string) ($notifiable->email ?? ''),
            'expires_at' => $this->expiresAt,
            'mailer' => (string) config('mail.default', ''),
            'smtp_host' => (string) config('mail.mailers.smtp.host', ''),
            'smtp_port' => (string) config('mail.mailers.smtp.port', ''),
            'smtp_scheme' => (string) config('mail.mailers.smtp.scheme', ''),
            'from' => (string) config('mail.from.address', ''),
        ]);

        return (new MailMessage())
            ->subject('CSPAMS Monitor Login Verification Code')
            ->greeting('Hello ' . ((string) ($notifiable->name ?? 'Division Monitor')) . ',')
            ->line('A sign-in attempt requires MFA verification for your division-level account.')
            ->line('Verification code: ' . $this->code)
            ->line('This code expires at: ' . $this->expiresAt)
            ->line('If you did not initiate this request, reset your password immediately.');
    }

    public function verificationCode(): string
    {
        return $this->code;
    }
}
