<?php

namespace Tests\Feature;

use Tests\TestCase;

class ReadinessDiagnosticsTest extends TestCase
{
    public function test_readiness_diagnostics_are_disabled_without_token_configuration(): void
    {
        config()->set('diagnostics.queue.token', null);

        $this->getJson('/api/ops/readiness?token=anything')
            ->assertNotFound();
    }

    public function test_readiness_diagnostics_require_matching_token(): void
    {
        config()->set('diagnostics.queue.token', 'correct-token');

        $this->getJson('/api/ops/readiness?token=wrong-token')
            ->assertNotFound();
    }

    public function test_readiness_diagnostics_report_safe_runtime_checks(): void
    {
        config()->set('diagnostics.queue.token', 'diagnostic-token');
        config()->set('queue.default', 'database');
        config()->set('auth_mfa.monitor.enabled', true);
        config()->set('auth_mfa.monitor.delivery_mode', 'queued');
        config()->set('auth_mfa.monitor.queue_connection', 'database');
        config()->set('auth_mfa.monitor.queue', 'mail');
        config()->set('cspams.school_reminders.delivery_mode', 'queued');
        config()->set('mail.default', 'resend');
        config()->set('mail.from.address', 'monitor@example.test');
        config()->set('services.resend.key', 'secret-resend-key');

        $response = $this->getJson('/api/ops/readiness?token=diagnostic-token')
            ->assertOk()
            ->assertJsonPath('app', 'cspams')
            ->assertJsonPath('checks.database.connected', true)
            ->assertJsonPath('checks.tables.accountSetupTokens.required', true)
            ->assertJsonPath('checks.tables.notifications.required', true)
            ->assertJsonPath('checks.tables.jobs.required', true)
            ->assertJsonPath('checks.tables.monitorMfaResetTickets.required', true)
            ->assertJsonPath('checks.queue.defaultDriver', 'database')
            ->assertJsonPath('checks.mail.defaultDriver', 'resend')
            ->assertJsonPath('checks.mail.fromConfigured', true)
            ->assertJsonPath('checks.mail.resendKeyConfigured', true)
            ->assertJsonPath('checks.monitorMfa.enabled', true)
            ->assertJsonPath('checks.monitorMfa.deliveryMode', 'queued')
            ->assertJsonPath('checks.schoolReminders.deliveryMode', 'queued');

        $this->assertIsBool($response->json('checks.tables.accountSetupTokens.exists'));
        $this->assertIsBool($response->json('checks.tables.notifications.exists'));
        $this->assertIsBool($response->json('checks.tables.jobs.exists'));
        $this->assertIsBool($response->json('checks.tables.monitorMfaResetTickets.exists'));
        $this->assertIsArray($response->json('checks.columns.userFlags.missing'));

        $content = $response->getContent();
        $this->assertStringNotContainsString('secret-resend-key', $content);
        $this->assertStringNotContainsString('monitor@example.test', $content);
        $this->assertStringNotContainsString('diagnostic-token', $content);
        $this->assertStringNotContainsString('password', strtolower($content));
        $this->assertStringNotContainsString('token_hash', $content);
    }

    public function test_readiness_diagnostics_accept_header_token(): void
    {
        config()->set('diagnostics.queue.token', 'diagnostic-token');

        $this->withHeader('X-CSPAMS-Diagnostics-Token', 'diagnostic-token')
            ->getJson('/api/ops/readiness')
            ->assertOk()
            ->assertJsonPath('app', 'cspams');
    }
}
