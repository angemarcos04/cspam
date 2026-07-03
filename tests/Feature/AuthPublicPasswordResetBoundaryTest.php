<?php

namespace Tests\Feature;

use App\Models\User;
use App\Notifications\MonitorPasswordResetNotification;
use App\Notifications\SchoolHeadPasswordResetNotification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Symfony\Component\HttpFoundation\Response;
use Tests\TestCase;

class AuthPublicPasswordResetBoundaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_public_forgot_password_sends_monitor_reset_notification(): void
    {
        $this->seed();
        Notification::fake();

        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();

        $response = $this->postJson('/api/auth/forgot-password', [
            'role' => 'monitor',
            'email' => $monitor->email,
        ]);

        $response->assertStatus(Response::HTTP_ACCEPTED)
            ->assertJsonPath('message', 'If a matching account exists, a password reset link will be sent to the provided email address.');

        Notification::assertSentTo($monitor, MonitorPasswordResetNotification::class);
    }

    public function test_public_forgot_password_ignores_school_head_accounts(): void
    {
        $this->seed();
        Notification::fake();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead.103811@cspams.local')->firstOrFail();

        $response = $this->postJson('/api/auth/forgot-password', [
            'role' => 'school_head',
            'email' => $schoolHead->email,
        ]);

        $response->assertStatus(Response::HTTP_ACCEPTED)
            ->assertJsonPath('message', 'If a matching account exists, a password reset link will be sent to the provided email address.');

        Notification::assertNotSentTo($schoolHead, SchoolHeadPasswordResetNotification::class);
        Notification::assertNotSentTo($schoolHead, MonitorPasswordResetNotification::class);
    }

    public function test_public_reset_password_does_not_reset_school_head_account(): void
    {
        $this->seed();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead.103811@cspams.local')->firstOrFail();
        $schoolHead->forceFill([
            'password' => Hash::make('OldPassword123!'),
            'email_verified_at' => now(),
        ])->save();

        $token = Password::broker()->createToken($schoolHead);

        $response = $this->postJson('/api/auth/reset-password', [
            'role' => 'school_head',
            'email' => $schoolHead->email,
            'token' => $token,
            'password' => 'NewPassword123!',
            'password_confirmation' => 'NewPassword123!',
        ]);

        $response->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonPath('message', 'This password reset link is invalid or expired.');

        $schoolHead->refresh();
        $this->assertTrue(Hash::check('OldPassword123!', $schoolHead->password));
    }
}
