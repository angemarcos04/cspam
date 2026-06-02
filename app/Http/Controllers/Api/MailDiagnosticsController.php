<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Notification as NotificationFacade;
use Symfony\Component\HttpFoundation\Response;

class MailDiagnosticsController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $configuredToken = trim((string) config('diagnostics.queue.token', ''));
        if ($configuredToken === '') {
            return response()->json(['message' => 'Not Found'], Response::HTTP_NOT_FOUND);
        }

        $providedToken = $this->providedToken($request);
        if ($providedToken === '' || ! hash_equals($configuredToken, $providedToken)) {
            return response()->json(['message' => 'Not Found'], Response::HTTP_NOT_FOUND);
        }

        $recipient = trim((string) config('diagnostics.mail.recipient', ''));
        if ($recipient === '') {
            return response()->json([
                'status' => 'failed',
                'message' => 'CSPAMS_MONITOR_EMAIL is not configured.',
            ], Response::HTTP_SERVICE_UNAVAILABLE);
        }

        $notifiable = new class ($recipient) {
            public function __construct(public readonly string $email) {}

            public function routeNotificationForMail(): string
            {
                return $this->email;
            }
        };

        try {
            NotificationFacade::sendNow($notifiable, new DiagnosticMailNotification());
        } catch (\Throwable $exception) {
            return response()->json([
                'status' => 'failed',
                'message' => 'Diagnostic email delivery failed.',
                'mail' => $this->mailSummary(),
                'recipient' => $recipient,
                'exception' => [
                    'class' => $exception::class,
                    'message' => $this->sanitizeExceptionMessage($exception->getMessage()),
                ],
            ], Response::HTTP_SERVICE_UNAVAILABLE);
        }

        return response()->json([
            'status' => 'sent',
            'message' => 'Diagnostic email was accepted by the configured mail transport.',
            'mail' => $this->mailSummary(),
            'recipient' => $recipient,
        ]);
    }

    private function providedToken(Request $request): string
    {
        $bearerToken = trim((string) $request->bearerToken());
        if ($bearerToken !== '') {
            return $bearerToken;
        }

        $headerToken = trim((string) $request->header('X-CSPAMS-Diagnostics-Token', ''));
        if ($headerToken !== '') {
            return $headerToken;
        }

        return trim((string) $request->query('token', ''));
    }

    /**
     * @return array<string, mixed>
     */
    private function mailSummary(): array
    {
        return [
            'mailer' => (string) config('mail.default', ''),
            'from' => (string) config('mail.from.address', ''),
            'resendKeyConfigured' => trim((string) config('services.resend.key', '')) !== '',
        ];
    }

    private function sanitizeExceptionMessage(string $message): string
    {
        $message = preg_replace('/password[=:]\S+/i', 'password=[redacted]', $message) ?? $message;
        $message = preg_replace('/re_[A-Za-z0-9_\-]+/', 're_[redacted]', $message) ?? $message;

        return mb_substr($message, 0, 1000);
    }
}

class DiagnosticMailNotification extends Notification
{
    /**
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage())
            ->subject('CSPAMS Mail Delivery Test')
            ->line('This is a CSPAMS diagnostic email.')
            ->line('If you received this message, the configured mail transport is working.');
    }
}
