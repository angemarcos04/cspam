<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use App\Notifications\MonitorMfaCodeNotification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Symfony\Component\HttpFoundation\Response;
use Tests\Concerns\InteractsWithSeededCredentials;
use Tests\TestCase;

class MonitorMfaAuthTest extends TestCase
{
    use InteractsWithSeededCredentials;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('auth_mfa.monitor.enabled', true);
        config()->set('auth_mfa.monitor.test_code', '123456');
        config()->set('auth_mfa.monitor.delivery_mode', 'queued');
        config()->set('mail.default', 'smtp');
        config()->set('mail.mailers.smtp.host', 'smtp.mail.test');
        config()->set('mail.mailers.smtp.username', 'smtp-user');
        config()->set('mail.mailers.smtp.password', 'smtp-pass');
    }

    public function test_monitor_login_returns_mfa_challenge_and_sends_code_notification(): void
    {
        $this->seed();
        Notification::fake();

        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();

        $response = $this->postJson('/api/auth/login', $this->monitorLoginPayload());

        $response->assertStatus(Response::HTTP_ACCEPTED)
            ->assertJsonPath('requiresMfa', true)
            ->assertJsonPath('delivery', 'queued')
            ->assertJsonPath('deliveryMessage', 'A verification code email was queued for delivery.')
            ->assertJsonStructure([
                'requiresMfa',
                'mfa' => ['challengeId', 'expiresAt'],
                'message',
            ]);

        Notification::assertSentTo($monitor, MonitorMfaCodeNotification::class);
    }

    public function test_monitor_login_can_send_mfa_notification_synchronously(): void
    {
        $this->seed();
        config()->set('auth_mfa.monitor.delivery_mode', 'sync');
        Notification::fake();

        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();

        $response = $this->postJson('/api/auth/login', $this->monitorLoginPayload());

        $response->assertStatus(Response::HTTP_ACCEPTED)
            ->assertJsonPath('requiresMfa', true)
            ->assertJsonPath('delivery', 'sent')
            ->assertJsonPath('deliveryMessage', 'A verification code was sent to your email.');

        Notification::assertSentTo($monitor, MonitorMfaCodeNotification::class);
    }

    public function test_monitor_login_sync_mfa_delivery_failure_returns_service_unavailable(): void
    {
        $this->seed();
        config()->set('auth_mfa.monitor.delivery_mode', 'sync');

        Notification::shouldReceive('sendNow')
            ->once()
            ->andThrow(new \RuntimeException('SMTP rejected delivery.'));

        $response = $this->postJson('/api/auth/login', $this->monitorLoginPayload());

        $response->assertStatus(Response::HTTP_SERVICE_UNAVAILABLE)
            ->assertJsonPath('errorCode', 'mfa_delivery_failed')
            ->assertJsonMissingPath('mfa')
            ->assertJsonMissingPath('delivery')
            ->assertJsonMissingPath('deliveryMessage');
    }

    public function test_monitor_login_invalid_credentials_returns_explicit_error_code(): void
    {
        $this->seed();

        $response = $this->postJson('/api/auth/login', [
            'role' => 'monitor',
            'login' => 'cspamsmonitor@gmail.com',
            'password' => 'WrongPassword123!',
        ]);

        $response->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonPath('errorCode', 'invalid_credentials');
    }

    public function test_monitor_can_verify_mfa_and_receive_dashboard_token(): void
    {
        $this->seed();

        $login = $this->postJson('/api/auth/login', $this->monitorLoginPayload());
        $login->assertStatus(Response::HTTP_ACCEPTED)
            ->assertJsonPath('requiresMfa', true);

        $challengeId = (string) $login->json('mfa.challengeId');
        $this->assertNotSame('', $challengeId);

        $verify = $this->postJson('/api/auth/verify-mfa', $this->verifyMfaPayload($challengeId, '123456'));

        $verify->assertOk()
            ->assertJsonPath('user.role', 'monitor')
            ->assertJsonPath('tokenType', 'Bearer');

        $token = (string) $verify->json('token');
        $this->assertNotSame('', $token);

        $me = $this->withToken($token)->getJson('/api/auth/me');
        $me->assertOk()->assertJsonPath('user.role', 'monitor');
    }

    public function test_monitor_mfa_verification_normalizes_six_digit_code_with_separator(): void
    {
        $this->seed();

        $login = $this->postJson('/api/auth/login', $this->monitorLoginPayload());
        $login->assertStatus(Response::HTTP_ACCEPTED)
            ->assertJsonPath('requiresMfa', true);

        $challengeId = (string) $login->json('mfa.challengeId');
        $this->assertNotSame('', $challengeId);

        $verify = $this->postJson('/api/auth/verify-mfa', $this->verifyMfaPayload($challengeId, '1234-56'));

        $verify->assertOk()
            ->assertJsonPath('user.role', 'monitor')
            ->assertJsonPath('tokenType', 'Bearer');
    }

    public function test_monitor_mfa_verification_rejects_malformed_code_without_echoing_it(): void
    {
        $this->seed();

        $login = $this->postJson('/api/auth/login', $this->monitorLoginPayload());
        $login->assertStatus(Response::HTTP_ACCEPTED)
            ->assertJsonPath('requiresMfa', true);

        $challengeId = (string) $login->json('mfa.challengeId');
        $this->assertNotSame('', $challengeId);

        $verify = $this->postJson('/api/auth/verify-mfa', $this->verifyMfaPayload($challengeId, '12345'));

        $verify->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertSee('Code must be a 6-digit verification code or an 8-character backup code (XXXX-XXXX).')
            ->assertDontSee('12345');
    }

    public function test_monitor_mfa_challenge_locks_after_max_invalid_attempts(): void
    {
        $this->seed();
        config()->set('auth_mfa.monitor.max_attempts', 2);

        $login = $this->postJson('/api/auth/login', $this->monitorLoginPayload());
        $login->assertStatus(Response::HTTP_ACCEPTED)
            ->assertJsonPath('requiresMfa', true);

        $challengeId = (string) $login->json('mfa.challengeId');
        $this->assertNotSame('', $challengeId);

        $firstInvalid = $this->postJson('/api/auth/verify-mfa', $this->verifyMfaPayload($challengeId, '000000'));
        $firstInvalid->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY);

        $secondInvalid = $this->postJson('/api/auth/verify-mfa', $this->verifyMfaPayload($challengeId, '111111'));
        $secondInvalid->assertStatus(Response::HTTP_TOO_MANY_REQUESTS);

        $challengeUsedAfterLockout = $this->postJson('/api/auth/verify-mfa', $this->verifyMfaPayload($challengeId, '123456'));
        $challengeUsedAfterLockout->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY);

        /** @var AuditLog $lockoutAudit */
        $lockoutAudit = AuditLog::query()
            ->where('action', 'auth.mfa_verify.locked_out')
            ->latest('id')
            ->firstOrFail();

        $this->assertSame('lockout', data_get($lockoutAudit->metadata, 'outcome'));
        $this->assertSame('monitor', data_get($lockoutAudit->metadata, 'role'));
        $this->assertSame('cspamsmonitor@gmail.com', data_get($lockoutAudit->metadata, 'identifier'));
    }

    /**
     * @return array{role: string, login: string, password: string}
     */
    private function monitorLoginPayload(): array
    {
        return [
            'role' => 'monitor',
            'login' => 'cspamsmonitor@gmail.com',
            'password' => $this->demoPasswordForLogin('monitor', 'cspamsmonitor@gmail.com'),
        ];
    }

    /**
     * @return array{role: string, login: string, challenge_id: string, code: string}
     */
    private function verifyMfaPayload(string $challengeId, string $code): array
    {
        return [
            'role' => 'monitor',
            'login' => 'cspamsmonitor@gmail.com',
            'challenge_id' => $challengeId,
            'code' => $code,
        ];
    }
}
