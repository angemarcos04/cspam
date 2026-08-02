<?php

namespace Tests\Feature;

use App\Models\AcademicYear;
use App\Models\IndicatorSubmission;
use App\Models\School;
use App\Models\User;
use App\Notifications\IndicatorSubmissionReceivedNotification;
use App\Support\Notifications\MonitorSubmissionNotificationDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class MonitorSubmissionNotificationDispatcherTest extends TestCase
{
    use RefreshDatabase;

    public function test_unique_delivery_reservation_keeps_repeated_dispatch_idempotent(): void
    {
        $this->seed();
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $school = School::query()->findOrFail($schoolHead->school_id);
        $academicYear = AcademicYear::query()->where('is_current', true)->firstOrFail();
        $submission = IndicatorSubmission::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $academicYear->id,
            'reporting_period' => null,
            'version' => 1,
            'status' => 'draft',
            'created_by' => $schoolHead->id,
            'submitted_by' => $schoolHead->id,
            'submitted_at' => now(),
        ]);

        $dispatcher = app(MonitorSubmissionNotificationDispatcher::class);
        $created = $dispatcher->dispatch($submission, $schoolHead, 'indicator_package_submitted');
        $existing = $dispatcher->dispatch($submission, $schoolHead, 'indicator_package_submitted');

        $this->assertSame(1, $created->createdCount);
        $this->assertSame(0, $created->existingCount);
        $this->assertSame(0, $existing->createdCount);
        $this->assertSame(1, $existing->existingCount);
        $notification = $monitor->fresh()->notifications()->where('type', IndicatorSubmissionReceivedNotification::class)->sole();
        $this->assertNotNull($notification);
        $this->assertSame(1, DB::table('monitor_submission_notification_deliveries')->where('recipient_id', $monitor->id)->count());
        $delivery = DB::table('monitor_submission_notification_deliveries')->where('recipient_id', $monitor->id)->sole();
        $this->assertSame((string) $notification->id, (string) $delivery->notification_id);
        $this->assertNotNull($delivery->delivered_at);
    }

    public function test_missing_referenced_notification_is_restored_and_cleared_notification_is_not_duplicated(): void
    {
        [$monitor, $schoolHead, $submission] = $this->fixture();
        $dispatcher = app(MonitorSubmissionNotificationDispatcher::class);
        $key = str_repeat('a', 64);

        $dispatcher->dispatch($submission, $schoolHead, 'indicator_package_submitted', [], [], false, false, $key);
        $firstId = (string) $monitor->fresh()->notifications()->sole()->id;
        $monitor->notifications()->whereKey($firstId)->delete();

        $restored = $dispatcher->dispatch($submission, $schoolHead, 'indicator_package_submitted', [], [], false, false, $key);
        $secondId = (string) $monitor->fresh()->notifications()->sole()->id;

        $this->assertSame(1, $restored->createdCount);
        $this->assertNotSame($firstId, $secondId);
        $this->assertSame($secondId, (string) DB::table('monitor_submission_notification_deliveries')->value('notification_id'));

        $monitor->notifications()->whereKey($secondId)->update(['cleared_at' => now()]);
        $existing = $dispatcher->dispatch($submission, $schoolHead, 'indicator_package_submitted', [], [], false, false, $key);

        $this->assertSame(1, $existing->existingCount);
        $this->assertSame(1, $monitor->fresh()->notifications()->count());
    }

    public function test_pre_metadata_delivery_is_backfilled_without_duplication(): void
    {
        [$monitor, $schoolHead, $submission] = $this->fixture();
        $dispatcher = app(MonitorSubmissionNotificationDispatcher::class);
        $key = str_repeat('b', 64);

        $dispatcher->dispatch($submission, $schoolHead, 'indicator_package_submitted', [], [], false, false, $key);
        $notificationId = (string) $monitor->fresh()->notifications()->sole()->id;
        DB::table('monitor_submission_notification_deliveries')->update([
            'notification_id' => null,
            'delivered_at' => null,
        ]);

        $existing = $dispatcher->dispatch($submission, $schoolHead, 'indicator_package_submitted', [], [], false, false, $key);
        $delivery = DB::table('monitor_submission_notification_deliveries')->sole();

        $this->assertSame(1, $existing->existingCount);
        $this->assertSame(1, $monitor->fresh()->notifications()->count());
        $this->assertSame($notificationId, (string) $delivery->notification_id);
        $this->assertNotNull($delivery->delivered_at);
    }

    /** @return array{User, User, IndicatorSubmission} */
    private function fixture(): array
    {
        $this->seed();
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $school = School::query()->findOrFail($schoolHead->school_id);
        $academicYear = AcademicYear::query()->where('is_current', true)->firstOrFail();
        $submission = IndicatorSubmission::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $academicYear->id,
            'reporting_period' => null,
            'version' => 1,
            'status' => 'draft',
            'created_by' => $schoolHead->id,
            'submitted_by' => $schoolHead->id,
            'submitted_at' => now(),
        ]);

        return [$monitor, $schoolHead, $submission];
    }
}
