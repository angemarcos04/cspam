<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class MailDiagnosticsTest extends TestCase
{
    public function test_mail_diagnostics_are_disabled_without_token_configuration(): void
    {
        config()->set('diagnostics.queue.token', null);

        $this->postJson('/api/ops/mail-diagnostics/send?token=anything')
            ->assertNotFound();
    }

    public function test_mail_diagnostics_require_matching_token(): void
    {
        config()->set('diagnostics.queue.token', 'correct-token');

        $this->postJson('/api/ops/mail-diagnostics/send?token=wrong-token')
            ->assertNotFound();
    }

    public function test_mail_diagnostics_report_missing_recipient_with_error_code(): void
    {
        config()->set('diagnostics.queue.token', 'diagnostic-token');
        config()->set('diagnostics.mail.recipient', '');

        $this->postJson('/api/ops/mail-diagnostics/send?token=diagnostic-token')
            ->assertStatus(503)
            ->assertJsonPath('status', 'failed')
            ->assertJsonPath('message', 'CSPAMS_MONITOR_EMAIL is not configured.')
            ->assertJsonPath('errorCode', 'diagnostics_recipient_missing');
    }

    public function test_mail_diagnostics_send_to_configured_monitor_email(): void
    {
        config()->set('diagnostics.queue.token', 'diagnostic-token');
        config()->set('mail.default', 'resend');
        config()->set('mail.from.address', 'onboarding@resend.dev');
        config()->set('services.resend.key', 'secret-resend-key');
        config()->set('diagnostics.mail.recipient', 'monitor@example.test');

        Notification::shouldReceive('sendNow')
            ->once();

        $this->postJson('/api/ops/mail-diagnostics/send?token=diagnostic-token')
            ->assertOk()
            ->assertJsonPath('status', 'sent')
            ->assertJsonPath('recipient', 'monitor@example.test')
            ->assertJsonPath('mail.mailer', 'resend')
            ->assertJsonPath('mail.resendKeyConfigured', true);

        $this->assertTrue(true);
    }

    public function test_mail_diagnostics_sanitize_delivery_failures(): void
    {
        config()->set('diagnostics.queue.token', 'diagnostic-token');
        config()->set('mail.default', 'resend');
        config()->set('mail.from.address', 'onboarding@resend.dev');
        config()->set('services.resend.key', 'secret-resend-key');
        config()->set('diagnostics.mail.recipient', 'monitor@example.test');

        Notification::shouldReceive('sendNow')
            ->once()
            ->andThrow(new \RuntimeException('Resend rejected key re_123456 password=secret-value'));

        $response = $this->postJson('/api/ops/mail-diagnostics/send?token=diagnostic-token')
            ->assertStatus(503)
            ->assertJsonPath('status', 'failed')
            ->assertJsonPath('errorCode', 'mail_diagnostics_failed')
            ->assertJsonPath('exception.message', 'Resend rejected key re_[redacted] password=[redacted]');

        $this->assertStringNotContainsString('re_123456', $response->getContent());
        $this->assertStringNotContainsString('secret-value', $response->getContent());
        $this->assertStringNotContainsString('secret-resend-key', $response->getContent());
    }
}
