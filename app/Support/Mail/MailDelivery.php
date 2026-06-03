<?php

namespace App\Support\Mail;

use Throwable;

final class MailDelivery
{
    public static function currentMailer(): string
    {
        return strtolower(trim((string) config('mail.default', 'log')));
    }

    public static function isSimulated(): bool
    {
        return in_array(self::currentMailer(), ['log', 'array'], true);
    }

    public static function simulatedStatus(): string
    {
        return 'logged';
    }

    public static function simulatedMessage(string $purpose): string
    {
        $mailer = self::currentMailer();
        $suffix = "Email delivery is configured as '{$mailer}', so no real emails are sent. Check `storage/logs/laravel.log` for the message, or configure `MAIL_MAILER=smtp` (or `MAIL_MAILER=resend`) to send real emails.";

        if ($purpose !== '') {
            return "{$purpose} {$suffix}";
        }

        return $suffix;
    }

    public static function maskEmail(string $email): string
    {
        $normalized = strtolower(trim($email));
        if (! str_contains($normalized, '@')) {
            return 'invalid-email';
        }

        [$local, $domain] = explode('@', $normalized, 2);
        $prefix = substr($local, 0, 2);

        return $prefix . '***@' . $domain;
    }

    public static function emailDomain(string $email): string
    {
        $normalized = strtolower(trim($email));
        if (! str_contains($normalized, '@')) {
            return 'unknown';
        }

        return explode('@', $normalized, 2)[1] ?: 'unknown';
    }

    public static function deliveryFailureCategory(Throwable $exception): string
    {
        $message = strtolower($exception->getMessage());
        $mailer = self::currentMailer();

        if ($mailer === 'log' || $mailer === 'array') {
            return 'mailer_not_configured';
        }

        if ($mailer === 'resend') {
            if (
                str_contains($message, 'testing domain')
                || str_contains($message, 'domain restriction')
                || str_contains($message, 'verify a domain')
                || str_contains($message, 'domain is not verified')
                || str_contains($message, '403')
            ) {
                return 'resend_domain_restricted';
            }
        }

        if (
            str_contains($message, 'connection')
            || str_contains($message, 'timed out')
            || str_contains($message, 'could not be established')
            || str_contains($message, 'transport')
            || str_contains($message, 'smtp')
        ) {
            return 'transport_failed';
        }

        return 'unknown_mail_failure';
    }

    public static function deliveryFailureMessage(string $category, string $subject = 'Password reset email'): string
    {
        return match ($category) {
            'mailer_not_configured' => "{$subject} was not sent because real mail delivery is not configured. Set MAIL_MAILER=resend and RESEND_API_KEY in Render.",
            'resend_domain_restricted' => "{$subject} was rejected by Resend. The onboarding@resend.dev sender is only for limited testing; verify a Resend domain before sending to arbitrary School Head emails.",
            'transport_failed' => "{$subject} delivery failed because the mail transport could not connect or complete the send. Check Render mail environment variables and provider status.",
            default => "{$subject} delivery failed. Check Render logs for the mail provider error and try again.",
        };
    }
}
