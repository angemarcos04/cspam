<?php

namespace Tests\Feature;

use App\Models\School;
use App\Models\User;
use App\Notifications\SchoolSubmissionReminderNotification;
use Illuminate\Contracts\Notifications\Dispatcher as NotificationDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Symfony\Component\HttpFoundation\Response;
use Tests\Concerns\InteractsWithSeededCredentials;
use Tests\TestCase;

class NotificationCenterApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithSeededCredentials;

    public function test_school_head_can_list_and_mark_notifications_as_read(): void
    {
        $this->seed();

        $monitorToken = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        /** @var School $school */
        $school = School::query()->where('school_code', '900001')->firstOrFail();
        /** @var User $schoolHead */
        $schoolHead = User::query()->where('school_id', $school->id)->firstOrFail();
        $schoolHeadToken = $schoolHead->createToken('test-school-head')->plainTextToken;

        $this->withToken($monitorToken)->postJson("/api/dashboard/records/{$school->id}/send-reminder", [
            'notes' => 'Test reminder for notifications center.',
        ])->assertOk();

        $listed = $this->withToken($schoolHeadToken)->getJson('/api/notifications');
        $listed->assertOk()
            ->assertJsonPath('meta.unreadCount', fn (int $value): bool => $value >= 1)
            ->assertJsonPath('data.0.eventType', 'reminder_sent')
            ->assertJsonPath('data.0.data.notes', 'Test reminder for notifications center.');

        $notificationId = (string) $listed->json('data.0.id');

        $marked = $this->withToken($schoolHeadToken)->postJson("/api/notifications/{$notificationId}/read");
        $marked->assertOk()
            ->assertJsonPath('data.id', $notificationId)
            ->assertJsonPath('data.readAt', fn (?string $value): bool => $value !== null);

        $this->withToken($schoolHeadToken)->postJson('/api/notifications/read-all')
            ->assertStatus(Response::HTTP_OK);
    }

    public function test_sync_school_reminder_creates_school_head_notification_without_worker(): void
    {
        $this->seed();
        config()->set('cspams.school_reminders.delivery_mode', 'sync');
        config()->set('mail.default', 'array');

        $monitorToken = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        /** @var School $school */
        $school = School::query()->where('school_code', '900001')->firstOrFail();
        /** @var User $schoolHead */
        $schoolHead = User::query()->where('school_id', $school->id)->firstOrFail();
        $schoolHeadToken = $schoolHead->createToken('test-school-head')->plainTextToken;

        $this->withToken($monitorToken)->postJson("/api/dashboard/records/{$school->id}/send-reminder", [
            'notes' => 'Sync reminder note for dashboard notification.',
        ])->assertOk()
            ->assertJsonPath('data.deliveryMode', 'sync')
            ->assertJsonPath('data.deliveryStatus', 'sent')
            ->assertJsonPath('data.deliveryWarning', null);

        $listed = $this->withToken($schoolHeadToken)->getJson('/api/notifications');
        $listed->assertOk()
            ->assertJsonPath('data.0.eventType', 'reminder_sent')
            ->assertJsonPath('data.0.data.notes', 'Sync reminder note for dashboard notification.');
    }

    public function test_sync_school_reminder_surfaces_email_failure_after_dashboard_notification(): void
    {
        $this->seed();
        config()->set('cspams.school_reminders.delivery_mode', 'sync');

        $monitorToken = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        /** @var School $school */
        $school = School::query()->where('school_code', '900001')->firstOrFail();
        /** @var User $schoolHead */
        $schoolHead = User::query()->where('school_id', $school->id)->firstOrFail();

        Notification::swap(new class implements NotificationDispatcher {
            public function send($notifiables, $notification): void
            {
            }

            public function sendNow($notifiables, $notification, ?array $channels = null): void
            {
                if ($channels === ['mail']) {
                    throw new \RuntimeException('403 testing domain restriction');
                }

                if ($channels !== ['database'] || ! $notification instanceof SchoolSubmissionReminderNotification) {
                    return;
                }

                \Illuminate\Support\Collection::wrap($notifiables)->each(static function (User $notifiable) use ($notification): void {
                    $notifiable->notifications()->create([
                        'id' => (string) \Illuminate\Support\Str::uuid(),
                        'type' => $notification::class,
                        'data' => $notification->toArray($notifiable),
                        'read_at' => null,
                    ]);
                });
            }
        });

        $this->withToken($monitorToken)->postJson("/api/dashboard/records/{$school->id}/send-reminder", [
            'notes' => 'Please check the returned package.',
        ])->assertOk()
            ->assertJsonPath('data.deliveryMode', 'sync')
            ->assertJsonPath('data.deliveryStatus', 'partial')
            ->assertJsonPath('data.deliveryWarning', 'Dashboard notification was sent, but email delivery failed. Check mail provider/domain settings.');

        $notification = $schoolHead->fresh()->notifications()->latest()->first();

        $this->assertNotNull($notification);
        $this->assertSame('reminder_sent', data_get($notification?->data, 'eventType'));
        $this->assertSame('Please check the returned package.', data_get($notification?->data, 'notes'));
    }

    private function loginToken(string $role, string $login): string
    {
        $loginResponse = $this->postJson('/api/auth/login', [
            'role' => $role,
            'login' => $login,
            'password' => $this->demoPasswordForLogin($role, $login),
        ]);

        $loginResponse->assertOk();

        return (string) $loginResponse->json('token');
    }

    private function schoolHeadLogin(User $user): string
    {
        $user->loadMissing('school');

        return (string) $user->school?->school_code;
    }
}

