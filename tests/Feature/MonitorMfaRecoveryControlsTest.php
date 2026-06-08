<?php

namespace Tests\Feature;

use App\Models\MonitorMfaResetTicket;
use App\Models\AuditLog;
use App\Models\User;
use App\Notifications\MonitorMfaResetApprovedNotification;
use App\Support\Auth\UserRoleResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\HttpFoundation\Response;
use Tests\Concerns\InteractsWithSeededCredentials;
use Tests\TestCase;

class MonitorMfaRecoveryControlsTest extends TestCase
{
    use InteractsWithSeededCredentials;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('auth_mfa.monitor.enabled', true);
        config()->set('auth_mfa.monitor.test_code', '123456');
        config()->set('auth_mfa.monitor.backup_codes_count', 4);
    }

    public function test_monitor_can_regenerate_backup_codes_and_use_one_for_mfa_login(): void
    {
        $this->seed();

        $password = $this->demoPasswordForLogin('monitor', 'cspamsmonitor@gmail.com');
        $token = $this->monitorTokenAfterMfa('cspamsmonitor@gmail.com', $password);

        $regen = $this->withToken($token)->postJson('/api/auth/mfa/backup-codes/regenerate', [
            'current_password' => $password,
        ]);

        $regen->assertOk()
            ->assertJsonCount(4, 'backupCodes');

        /** @var list<string> $backupCodes */
        $backupCodes = array_map(
            static fn (mixed $code): string => (string) $code,
            array_values((array) $regen->json('backupCodes')),
        );
        $backupCode = $backupCodes[0] ?? null;
        $this->assertNotNull($backupCode);

        $challengeId = $this->monitorMfaChallengeId('cspamsmonitor@gmail.com', $password);
        $backupVerify = $this->postJson('/api/auth/verify-mfa', [
            'role' => 'monitor',
            'login' => 'cspamsmonitor@gmail.com',
            'challenge_id' => $challengeId,
            'code' => $backupCode,
        ]);

        $backupVerify->assertOk()
            ->assertJsonPath('user.role', 'monitor');

        $reuseChallengeId = $this->monitorMfaChallengeId('cspamsmonitor@gmail.com', $password);
        $reuseAttempt = $this->postJson('/api/auth/verify-mfa', [
            'role' => 'monitor',
            'login' => 'cspamsmonitor@gmail.com',
            'challenge_id' => $reuseChallengeId,
            'code' => $backupCode,
        ]);

        $reuseAttempt->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY);
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.mfa_verify.backup_code_used']);
    }

    public function test_mfa_reset_flow_requires_admin_approval_and_is_audited(): void
    {
        Notification::fake();
        $this->seed();

        $targetPassword = $this->demoPasswordForLogin('monitor', 'cspamsmonitor@gmail.com');

        /** @var User $admin */
        $admin = User::query()->create([
            'name' => 'Division Monitor Admin',
            'email' => 'monitor.admin@cspams.local',
            'password' => Hash::make('AdminPass@2026!'),
            'must_reset_password' => false,
            'password_changed_at' => now(),
        ]);
        $admin->assignRole(UserRoleResolver::MONITOR);

        $requestReset = $this->postJson('/api/auth/mfa/reset/request', [
            'role' => 'monitor',
            'login' => 'cspamsmonitor@gmail.com',
            'password' => $targetPassword,
            'reason' => 'Lost authenticator device.',
        ]);

        $requestReset->assertStatus(Response::HTTP_ACCEPTED)
            ->assertJsonPath('status', MonitorMfaResetTicket::STATUS_PENDING);

        $requestId = (int) $requestReset->json('requestId');
        $this->assertGreaterThan(0, $requestId);

        $adminToken = $this->monitorTokenAfterMfa('monitor.admin@cspams.local', 'AdminPass@2026!');
        $approve = $this->withToken($adminToken)->postJson("/api/auth/mfa/reset/requests/{$requestId}/approve", [
            'notes' => 'Identity verified through helpdesk.',
        ]);

        $approve->assertOk()
            ->assertJsonPath('status', MonitorMfaResetTicket::STATUS_APPROVED);

        /** @var array<string, mixed> $approvePayload */
        $approvePayload = (array) $approve->json();
        $this->assertArrayHasKey('approvalToken', $approvePayload);
        $approvalToken = (string) ($approvePayload['approvalToken'] ?? '');
        $this->assertMatchesRegularExpression('/^[A-Z0-9]{4}-[A-Z0-9]{4}$/', $approvalToken);

        /** @var User $targetUser */
        $targetUser = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();
        Notification::assertSentTo($targetUser, MonitorMfaResetApprovedNotification::class);

        $sent = Notification::sent($targetUser, MonitorMfaResetApprovedNotification::class);
        /** @var MonitorMfaResetApprovedNotification|null $notification */
        $notification = $sent->last();
        $this->assertSame($approvalToken, (string) ($notification?->approvalToken() ?? ''));

        /** @var MonitorMfaResetTicket $ticket */
        $ticket = MonitorMfaResetTicket::query()->findOrFail($requestId);
        $this->assertNotSame($approvalToken, (string) $ticket->approval_token_hash);
        $this->assertTrue(Hash::check($approvalToken, (string) $ticket->approval_token_hash));

        $complete = $this->postJson('/api/auth/mfa/reset/complete', [
            'role' => 'monitor',
            'login' => 'cspamsmonitor@gmail.com',
            'password' => $targetPassword,
            'request_id' => $requestId,
            'approval_token' => $approvalToken,
        ]);

        $complete->assertOk()
            ->assertJsonPath('user.role', 'monitor')
            ->assertJsonCount(4, 'backupCodes');

        $this->assertDatabaseHas('monitor_mfa_reset_tickets', [
            'id' => $requestId,
            'status' => MonitorMfaResetTicket::STATUS_COMPLETED,
            'approved_by_user_id' => $admin->id,
        ]);

        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.mfa_reset.requested']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.mfa_reset.approved']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.mfa_reset.completed']);

        $approvalAudit = AuditLog::query()
            ->where('action', 'auth.mfa_reset.approved')
            ->latest('id')
            ->firstOrFail();
        $this->assertStringNotContainsString($approvalToken, json_encode($approvalAudit->metadata));
    }

    public function test_monitor_cannot_self_approve_mfa_reset_request(): void
    {
        $this->seed();

        $targetPassword = $this->demoPasswordForLogin('monitor', 'cspamsmonitor@gmail.com');

        $requestReset = $this->postJson('/api/auth/mfa/reset/request', [
            'role' => 'monitor',
            'login' => 'cspamsmonitor@gmail.com',
            'password' => $targetPassword,
            'reason' => 'Lost authenticator device.',
        ]);

        $requestReset->assertStatus(Response::HTTP_ACCEPTED)
            ->assertJsonPath('status', MonitorMfaResetTicket::STATUS_PENDING);

        $requestId = (int) $requestReset->json('requestId');
        $this->assertGreaterThan(0, $requestId);

        $monitorToken = $this->monitorTokenAfterMfa('cspamsmonitor@gmail.com', $targetPassword);
        $approve = $this->withToken($monitorToken)->postJson("/api/auth/mfa/reset/requests/{$requestId}/approve");

        $approve->assertStatus(Response::HTTP_FORBIDDEN)
            ->assertJsonPath(
                'message',
                'You cannot approve your own MFA recovery request. Ask a different Division Monitor to approve it.',
            );
    }

    public function test_mfa_recovery_approval_returns_token_when_email_delivery_fails(): void
    {
        $this->seed();

        $targetPassword = $this->demoPasswordForLogin('monitor', 'cspamsmonitor@gmail.com');

        /** @var User $admin */
        $admin = User::query()->create([
            'name' => 'Division Monitor Admin',
            'email' => 'monitor.admin@cspams.local',
            'password' => Hash::make('AdminPass@2026!'),
            'must_reset_password' => false,
            'password_changed_at' => now(),
        ]);
        $admin->assignRole(UserRoleResolver::MONITOR);

        $requestReset = $this->postJson('/api/auth/mfa/reset/request', [
            'role' => 'monitor',
            'login' => 'cspamsmonitor@gmail.com',
            'password' => $targetPassword,
            'reason' => 'No access to MFA code.',
        ]);

        $requestReset->assertStatus(Response::HTTP_ACCEPTED);
        $requestId = (int) $requestReset->json('requestId');

        $adminToken = $this->monitorTokenAfterMfa('monitor.admin@cspams.local', 'AdminPass@2026!');

        Notification::shouldReceive('send')
            ->once()
            ->andThrow(new \RuntimeException('SMTP rejected recovery token.'));

        $approve = $this->withToken($adminToken)->postJson("/api/auth/mfa/reset/requests/{$requestId}/approve", [
            'notes' => 'Identity verified.',
        ]);

        $approve->assertOk()
            ->assertJsonPath('status', MonitorMfaResetTicket::STATUS_APPROVED)
            ->assertJsonPath('delivery', 'failed')
            ->assertJsonPath('message', 'MFA recovery approved, but email delivery failed. Copy and share the recovery token securely.');

        $approvalToken = (string) $approve->json('approvalToken');
        $this->assertMatchesRegularExpression('/^[A-Z0-9]{4}-[A-Z0-9]{4}$/', $approvalToken);

        $complete = $this->postJson('/api/auth/mfa/reset/complete', [
            'role' => 'monitor',
            'login' => 'cspamsmonitor@gmail.com',
            'password' => $targetPassword,
            'request_id' => $requestId,
            'approval_token' => $approvalToken,
        ]);

        $complete->assertOk()
            ->assertJsonPath('user.role', 'monitor')
            ->assertJsonCount(4, 'backupCodes');
    }

    public function test_mfa_recovery_completion_rejects_six_digit_login_code(): void
    {
        Notification::fake();
        $this->seed();

        $targetPassword = $this->demoPasswordForLogin('monitor', 'cspamsmonitor@gmail.com');

        /** @var User $admin */
        $admin = User::query()->create([
            'name' => 'Division Monitor Admin',
            'email' => 'monitor.admin@cspams.local',
            'password' => Hash::make('AdminPass@2026!'),
            'must_reset_password' => false,
            'password_changed_at' => now(),
        ]);
        $admin->assignRole(UserRoleResolver::MONITOR);

        $requestReset = $this->postJson('/api/auth/mfa/reset/request', [
            'role' => 'monitor',
            'login' => 'cspamsmonitor@gmail.com',
            'password' => $targetPassword,
        ]);

        $requestId = (int) $requestReset->json('requestId');
        $adminToken = $this->monitorTokenAfterMfa('monitor.admin@cspams.local', 'AdminPass@2026!');
        $this->withToken($adminToken)->postJson("/api/auth/mfa/reset/requests/{$requestId}/approve")->assertOk();

        $complete = $this->postJson('/api/auth/mfa/reset/complete', [
            'role' => 'monitor',
            'login' => 'cspamsmonitor@gmail.com',
            'password' => $targetPassword,
            'request_id' => $requestId,
            'approval_token' => '123456',
        ]);

        $complete->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonPath('message', 'Recovery token format is invalid.');
    }

    public function test_mfa_reset_request_returns_service_unavailable_when_ticket_storage_is_missing(): void
    {
        $this->seed();

        Schema::dropIfExists('monitor_mfa_reset_tickets');

        $requestReset = $this->postJson('/api/auth/mfa/reset/request', [
            'role' => 'monitor',
            'login' => 'cspamsmonitor@gmail.com',
            'password' => $this->demoPasswordForLogin('monitor', 'cspamsmonitor@gmail.com'),
            'reason' => 'Lost authenticator device.',
        ]);

        $requestReset->assertStatus(Response::HTTP_SERVICE_UNAVAILABLE)
            ->assertJsonPath('message', 'MFA recovery request storage is unavailable. Run database migrations first.');
    }

    public function test_mfa_reset_approval_returns_service_unavailable_when_ticket_storage_is_missing(): void
    {
        $this->seed();

        $monitorToken = $this->monitorTokenAfterMfa(
            'cspamsmonitor@gmail.com',
            $this->demoPasswordForLogin('monitor', 'cspamsmonitor@gmail.com'),
        );

        Schema::dropIfExists('monitor_mfa_reset_tickets');

        $approve = $this->withToken($monitorToken)->postJson('/api/auth/mfa/reset/requests/1/approve', [
            'notes' => 'Storage missing test.',
        ]);

        $approve->assertStatus(Response::HTTP_SERVICE_UNAVAILABLE)
            ->assertJsonPath('message', 'MFA recovery request storage is unavailable. Run database migrations first.');
    }

    private function monitorTokenAfterMfa(string $email, string $password): string
    {
        $challengeId = $this->monitorMfaChallengeId($email, $password);

        $verify = $this->postJson('/api/auth/verify-mfa', [
            'role' => 'monitor',
            'login' => $email,
            'challenge_id' => $challengeId,
            'code' => '123456',
        ]);

        $verify->assertOk()
            ->assertJsonPath('user.role', 'monitor');

        $token = (string) $verify->json('token');
        $this->assertNotSame('', $token);

        return $token;
    }

    private function monitorMfaChallengeId(string $email, string $password): string
    {
        $login = $this->postJson('/api/auth/login', [
            'role' => 'monitor',
            'login' => $email,
            'password' => $password,
        ]);

        $login->assertStatus(Response::HTTP_ACCEPTED)
            ->assertJsonPath('requiresMfa', true);

        $challengeId = (string) $login->json('mfa.challengeId');
        $this->assertNotSame('', $challengeId);

        return $challengeId;
    }
}

