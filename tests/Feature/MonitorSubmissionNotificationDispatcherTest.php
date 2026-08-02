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
        $this->assertSame(1, $monitor->fresh()->notifications()->where('type', IndicatorSubmissionReceivedNotification::class)->count());
        $this->assertSame(1, DB::table('monitor_submission_notification_deliveries')->where('recipient_id', $monitor->id)->count());
    }
}
