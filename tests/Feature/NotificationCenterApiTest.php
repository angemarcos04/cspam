<?php

namespace Tests\Feature;

use App\Models\AcademicYear;
use App\Models\IndicatorSubmission;
use App\Models\PerformanceMetric;
use App\Models\School;
use App\Models\User;
use App\Notifications\IndicatorReviewOutcomeNotification;
use App\Notifications\IndicatorScopeReviewOutcomeNotification;
use App\Notifications\IndicatorSubmissionReceivedNotification;
use App\Notifications\SchoolSubmissionReminderNotification;
use Illuminate\Contracts\Notifications\Dispatcher as NotificationDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
use Tests\Concerns\InteractsWithSeededCredentials;
use Tests\TestCase;

class NotificationCenterApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithSeededCredentials;

    public function test_unauthenticated_user_cannot_list_notifications(): void
    {
        $this->getJson('/api/notifications')
            ->assertUnauthorized();
    }

    public function test_monitor_notification_list_returns_empty_state(): void
    {
        $this->seed();

        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();
        $monitorToken = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');
        $monitor->notifications()->delete();

        $this->withToken($monitorToken)->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('data', [])
            ->assertJsonPath('meta.total', 0)
            ->assertJsonPath('meta.unreadCount', 0)
            ->assertJsonPath('meta.currentPage', 1)
            ->assertJsonPath('meta.lastPage', 1);
    }

    public function test_school_head_notification_list_returns_empty_state(): void
    {
        $this->seed();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $schoolHeadToken = $schoolHead->createToken('test-school-head')->plainTextToken;
        $schoolHead->notifications()->delete();

        $this->withToken($schoolHeadToken)->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('data', [])
            ->assertJsonPath('meta.total', 0)
            ->assertJsonPath('meta.unreadCount', 0);
    }

    public function test_malformed_and_legacy_notification_payloads_do_not_crash_index(): void
    {
        $this->seed();

        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();
        $monitorToken = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');
        $monitor->notifications()->delete();

        $fallbackId = (string) Str::uuid();
        $legacyJsonStringId = (string) Str::uuid();
        $missingMessageId = (string) Str::uuid();
        $now = now();

        DB::table('notifications')->insert([
            [
                'id' => $fallbackId,
                'type' => 'legacy.notification',
                'notifiable_type' => User::class,
                'notifiable_id' => $monitor->id,
                'data' => 'not-json',
                'read_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'id' => $legacyJsonStringId,
                'type' => 'legacy.notification',
                'notifiable_type' => User::class,
                'notifiable_id' => $monitor->id,
                'data' => json_encode(json_encode([
                    'eventType' => 'legacy_json_string',
                    'title' => 'Legacy JSON string',
                    'message' => 'Decoded from a legacy JSON string.',
                ])),
                'read_at' => null,
                'created_at' => $now->copy()->addSecond(),
                'updated_at' => $now->copy()->addSecond(),
            ],
            [
                'id' => $missingMessageId,
                'type' => 'legacy.notification',
                'notifiable_type' => User::class,
                'notifiable_id' => $monitor->id,
                'data' => json_encode([
                    'eventType' => 'legacy_missing_message',
                    'title' => 'Legacy notification',
                ]),
                'read_at' => null,
                'created_at' => $now->copy()->addSeconds(2),
                'updated_at' => $now->copy()->addSeconds(2),
            ],
        ]);

        $response = $this->withToken($monitorToken)->getJson('/api/notifications');

        $response->assertOk()
            ->assertJsonPath('meta.total', 3)
            ->assertJsonPath('meta.unreadCount', 3);

        $rows = collect($response->json('data'))->keyBy('id');

        $this->assertSame('notification', data_get($rows->get($fallbackId), 'eventType'));
        $this->assertSame('Notification', data_get($rows->get($fallbackId), 'title'));
        $this->assertSame('You have a new notification.', data_get($rows->get($fallbackId), 'message'));
        $this->assertSame('legacy_json_string', data_get($rows->get($legacyJsonStringId), 'eventType'));
        $this->assertSame('Legacy JSON string', data_get($rows->get($legacyJsonStringId), 'title'));
        $this->assertSame('You have a new notification.', data_get($rows->get($missingMessageId), 'message'));
    }

    public function test_mark_as_read_cannot_read_another_users_notification(): void
    {
        $this->seed();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $monitorToken = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');
        $notification = $schoolHead->notifications()->create([
            'id' => (string) Str::uuid(),
            'type' => 'test.notification',
            'data' => ['title' => 'Private notification'],
            'read_at' => null,
        ]);

        $this->withToken($monitorToken)->postJson("/api/notifications/{$notification->id}/read")
            ->assertNotFound();

        $this->assertNull($notification->fresh()?->read_at);
    }

    public function test_mark_all_read_succeeds_with_zero_unread_notifications(): void
    {
        $this->seed();

        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();
        $monitorToken = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');
        $monitor->notifications()->delete();

        $this->withToken($monitorToken)->postJson('/api/notifications/read-all')
            ->assertOk()
            ->assertJsonPath('data.updated', 0);
    }

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

    public function test_monitor_receives_full_package_submitted_notification(): void
    {
        Storage::fake('local');
        $this->seed();

        [$schoolHead, $schoolHeadToken, $monitor] = $this->submissionNotificationActors();
        $submissionId = $this->createCompleteIndicatorSubmission($schoolHeadToken);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit")
            ->assertOk();

        $notification = $this->monitorSubmissionNotificationByEvent($monitor, 'indicator_package_submitted');
        $this->assertSame(IndicatorSubmissionReceivedNotification::class, $notification?->type);
        $this->assertSame('indicator_package_submitted', data_get($notification?->data, 'eventType'));
        $this->assertSame($submissionId, data_get($notification?->data, 'submissionId'));
        $this->assertSame((string) $schoolHead->school_id, data_get($notification?->data, 'schoolId'));
        $this->assertNotEmpty(data_get($notification?->data, 'schoolName'));
        $this->assertNotEmpty(data_get($notification?->data, 'academicYearId'));
    }

    public function test_monitor_receives_full_package_resubmitted_notification_after_return(): void
    {
        Storage::fake('local');
        $this->seed();

        [$schoolHead, $schoolHeadToken, $monitor, $monitorToken] = $this->submissionNotificationActors();
        $submissionId = $this->createCompleteIndicatorSubmission($schoolHeadToken);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit")
            ->assertOk();

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/review", [
            'decision' => 'returned',
            'notes' => 'Please revise the package.',
        ])->assertOk();

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit")
            ->assertOk();

        $notification = $this->monitorSubmissionNotificationByEvent($monitor, 'indicator_package_resubmitted');
        $this->assertSame('indicator_package_resubmitted', data_get($notification?->data, 'eventType'));
        $this->assertSame($submissionId, data_get($notification?->data, 'submissionId'));
        $this->assertSame((string) $schoolHead->school_id, data_get($notification?->data, 'schoolId'));
    }

    public function test_school_head_receives_package_validated_notification_immediately_without_worker(): void
    {
        Storage::fake('local');
        $this->seed();

        [$schoolHead, $schoolHeadToken, , $monitorToken] = $this->submissionNotificationActors();
        $submissionId = $this->createCompleteIndicatorSubmission($schoolHeadToken);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit")
            ->assertOk();

        Queue::fake();

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/review", [
            'decision' => 'validated',
            'notes' => 'Accepted.',
        ])->assertOk();

        $notification = $this->schoolHeadReviewNotificationByEvent($schoolHead, 'indicator_validated');
        $this->assertSame(IndicatorReviewOutcomeNotification::class, $notification?->type);
        $this->assertSame($submissionId, data_get($notification?->data, 'submissionId'));
        $this->assertSame('validated', data_get($notification?->data, 'status'));
    }

    public function test_school_head_receives_package_returned_notification_immediately_without_worker(): void
    {
        Storage::fake('local');
        $this->seed();

        [$schoolHead, $schoolHeadToken, , $monitorToken] = $this->submissionNotificationActors();
        $submissionId = $this->createCompleteIndicatorSubmission($schoolHeadToken);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit")
            ->assertOk();

        Queue::fake();

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/review", [
            'decision' => 'returned',
            'notes' => 'Please revise the package.',
        ])->assertOk();

        $notification = $this->schoolHeadReviewNotificationByEvent($schoolHead, 'indicator_returned');
        $this->assertSame(IndicatorReviewOutcomeNotification::class, $notification?->type);
        $this->assertSame($submissionId, data_get($notification?->data, 'submissionId'));
        $this->assertSame('returned', data_get($notification?->data, 'status'));
        $this->assertSame('Please revise the package.', data_get($notification?->data, 'reviewNotes'));
    }

    public function test_school_head_receives_scope_verified_notification_immediately_without_worker(): void
    {
        Storage::fake('local');
        $this->seed();

        [$schoolHead, $schoolHeadToken, , $monitorToken] = $this->submissionNotificationActors();
        $submissionId = $this->bootstrapIndicatorSubmission($schoolHeadToken);

        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef.pdf', 'application/pdf')
            ->assertOk();

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();

        Queue::fake();

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ])->assertOk();

        $notification = $this->schoolHeadScopeNotificationByEvent($schoolHead, 'indicator_scope_verified');
        $this->assertSame(IndicatorScopeReviewOutcomeNotification::class, $notification?->type);
        $this->assertSame($submissionId, data_get($notification?->data, 'submissionId'));
        $this->assertSame('verified', data_get($notification?->data, 'status'));
        $this->assertSame('bmef', data_get($notification?->data, 'scopeId'));
    }

    public function test_school_head_receives_scope_returned_notification_immediately_without_worker(): void
    {
        Storage::fake('local');
        $this->seed();

        [$schoolHead, $schoolHeadToken, , $monitorToken] = $this->submissionNotificationActors();
        $submissionId = $this->bootstrapIndicatorSubmission($schoolHeadToken);

        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef.pdf', 'application/pdf')
            ->assertOk();

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();

        Queue::fake();

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'returned',
            'notes' => 'Please upload the signed version.',
        ])->assertOk();

        $notification = $this->schoolHeadScopeNotificationByEvent($schoolHead, 'indicator_scope_returned');
        $this->assertSame(IndicatorScopeReviewOutcomeNotification::class, $notification?->type);
        $this->assertSame($submissionId, data_get($notification?->data, 'submissionId'));
        $this->assertSame('returned', data_get($notification?->data, 'status'));
        $this->assertSame('bmef', data_get($notification?->data, 'scopeId'));
        $this->assertSame('Please upload the signed version.', data_get($notification?->data, 'reviewNotes'));
    }

    public function test_monitor_receives_grouped_scope_submitted_notification(): void
    {
        Storage::fake('local');
        $this->seed();

        [$schoolHead, $schoolHeadToken, $monitor] = $this->submissionNotificationActors();
        $submissionId = $this->bootstrapIndicatorSubmission($schoolHeadToken);

        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef.pdf', 'application/pdf')
            ->assertOk();

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();

        $notification = $this->monitorSubmissionNotificationByEvent($monitor, 'indicator_scope_submitted');
        $this->assertSame('indicator_scope_submitted', data_get($notification?->data, 'eventType'));
        $this->assertSame(['bmef'], data_get($notification?->data, 'scopeIds'));
        $this->assertContains('BMEF file', data_get($notification?->data, 'scopeLabels'));
    }

    public function test_monitor_receives_grouped_scope_resent_notification_after_return(): void
    {
        Storage::fake('local');
        $this->seed();

        [$schoolHead, $schoolHeadToken, $monitor, $monitorToken] = $this->submissionNotificationActors();
        $submissionId = $this->bootstrapIndicatorSubmission($schoolHeadToken);

        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef.pdf', 'application/pdf')
            ->assertOk();

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'returned',
        ])->assertOk();

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();

        $notification = $this->monitorSubmissionNotificationByEvent($monitor, 'indicator_scope_resent');
        $this->assertSame('indicator_scope_resent', data_get($notification?->data, 'eventType'));
        $this->assertSame(['bmef'], data_get($notification?->data, 'scopeIds'));
    }

    public function test_monitor_does_not_receive_submission_notification_for_draft_save_or_upload_only(): void
    {
        Storage::fake('local');
        $this->seed();

        [$schoolHead, $schoolHeadToken, $monitor] = $this->submissionNotificationActors();
        $initialCount = $monitor->notifications()
            ->where('type', IndicatorSubmissionReceivedNotification::class)
            ->count();

        $submissionId = $this->bootstrapIndicatorSubmission($schoolHeadToken);
        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef.pdf', 'application/pdf')
            ->assertOk();

        $this->assertSame(
            $initialCount,
            $monitor->fresh()->notifications()->where('type', IndicatorSubmissionReceivedNotification::class)->count(),
        );
        $this->assertSame((string) $schoolHead->school_id, (string) IndicatorSubmission::query()->findOrFail($submissionId)->school_id);
    }

    public function test_scope_unverified_notification_is_labeled_as_reopened_for_review(): void
    {
        Storage::fake('local');
        $this->seed();

        [$schoolHead, $schoolHeadToken, $monitor, $monitorToken] = $this->submissionNotificationActors();
        $submissionId = $this->bootstrapIndicatorSubmission($schoolHeadToken);

        $this->uploadSubmissionDocument($schoolHeadToken, $submissionId, 'bmef', 'bmef.pdf', 'application/pdf')
            ->assertOk();

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => ['bmef'],
        ])->assertOk();

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'verified',
        ])->assertOk();

        Queue::fake();

        $this->withToken($monitorToken)->postJson("/api/indicators/submissions/{$submissionId}/scope-review", [
            'scopeId' => 'bmef',
            'decision' => 'unverified',
        ])->assertOk();

        $notification = $schoolHead->fresh()->notifications()
            ->where('type', IndicatorScopeReviewOutcomeNotification::class)
            ->get()
            ->first(static fn ($notification): bool => data_get($notification->data, 'eventType') === 'indicator_scope_unverified');

        $this->assertSame('indicator_scope_unverified', data_get($notification?->data, 'eventType'));
        $this->assertSame('BMEF file reopened for review', data_get($notification?->data, 'title'));
        $this->assertStringContainsString('reopened for review', (string) data_get($notification?->data, 'message'));
        $this->assertNotSame('indicator_scope_returned', data_get($notification?->data, 'eventType'));
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

    /**
     * @return array{0: User, 1: string, 2: User, 3: string}
     */
    private function submissionNotificationActors(): array
    {
        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();

        return [
            $schoolHead,
            $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead)),
            $monitor,
            $this->loginToken('monitor', 'cspamsmonitor@gmail.com'),
        ];
    }

    private function bootstrapIndicatorSubmission(string $schoolHeadToken): string
    {
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');

        $response = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions/bootstrap', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
        ]);

        $response->assertCreated();

        return (string) $response->json('data.id');
    }

    private function createCompleteIndicatorSubmission(string $schoolHeadToken): string
    {
        $academicYear = AcademicYear::query()->where('is_current', true)->firstOrFail();
        $metricId = (int) PerformanceMetric::query()->where('code', 'SALO')->value('id');

        $response = $this->withToken($schoolHeadToken)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYear->id,
            'reporting_period' => 'ANNUAL',
            'indicators' => [
                [
                    'metric_id' => $metricId,
                    'target_value' => 1,
                    'actual_value' => 1,
                    'remarks' => 'Ready for review.',
                ],
                [
                    'metric_code' => 'IMETA_HEAD_NAME',
                    'actual' => ['values' => [(string) $academicYear->name => 'Maria Santos']],
                ],
            ],
        ]);

        $response->assertCreated();
        $submissionId = (string) $response->json('data.id');
        $this->uploadRequiredSubmissionFiles($schoolHeadToken, $submissionId);

        return $submissionId;
    }

    private function uploadRequiredSubmissionFiles(string $token, string $submissionId): void
    {
        $this->uploadSubmissionDocument($token, $submissionId, 'bmef', 'bmef.pdf', 'application/pdf')
            ->assertOk();
        $this->uploadSubmissionDocument($token, $submissionId, 'smea', 'smea.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            ->assertOk();
    }

    private function uploadSubmissionDocument(
        string $token,
        string $submissionId,
        string $type,
        string $filename,
        string $mimeType,
    ) {
        return $this->withToken($token)->postJson("/api/submissions/{$submissionId}/upload-file", [
            'type' => $type,
            'file' => UploadedFile::fake()->create($filename, 64, $mimeType),
        ]);
    }

    private function monitorSubmissionNotificationByEvent(User $monitor, string $eventType): ?\Illuminate\Notifications\DatabaseNotification
    {
        return $monitor->fresh()->notifications()
            ->where('type', IndicatorSubmissionReceivedNotification::class)
            ->get()
            ->first(static fn ($notification): bool => data_get($notification->data, 'eventType') === $eventType);
    }

    private function schoolHeadReviewNotificationByEvent(User $schoolHead, string $eventType): ?\Illuminate\Notifications\DatabaseNotification
    {
        return $schoolHead->fresh()->notifications()
            ->where('type', IndicatorReviewOutcomeNotification::class)
            ->get()
            ->first(static fn ($notification): bool => data_get($notification->data, 'eventType') === $eventType);
    }

    private function schoolHeadScopeNotificationByEvent(User $schoolHead, string $eventType): ?\Illuminate\Notifications\DatabaseNotification
    {
        return $schoolHead->fresh()->notifications()
            ->where('type', IndicatorScopeReviewOutcomeNotification::class)
            ->get()
            ->first(static fn ($notification): bool => data_get($notification->data, 'eventType') === $eventType);
    }

    private function schoolHeadLogin(User $user): string
    {
        $user->loadMissing('school');

        return (string) $user->school?->school_code;
    }
}

