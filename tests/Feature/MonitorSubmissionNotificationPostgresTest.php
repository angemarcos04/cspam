<?php

namespace Tests\Feature;

use App\Jobs\RetryMonitorSubmissionNotification;
use App\Models\AcademicYear;
use App\Models\IndicatorSubmission;
use App\Models\School;
use App\Models\User;
use App\Notifications\IndicatorSubmissionReceivedNotification;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;
use Tests\TestCase;

class MonitorSubmissionNotificationPostgresTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        if (DB::getDriverName() !== 'pgsql') {
            $this->markTestSkipped('Requires PostgreSQL for independent-process and database-queue integration.');
        }

        $this->assertTrue(app()->environment('testing'));
        Artisan::call('migrate:fresh', ['--force' => true]);
    }

    public function test_simultaneous_postgresql_dispatch_creates_one_delivery_and_notification(): void
    {
        [$monitor, $schoolHead, $submission] = $this->fixture();
        $notificationKey = str_repeat('c', 64);
        $releaseAt = microtime(true) + 10;

        $command = [
            PHP_BINARY,
            base_path('tests/Support/dispatch_monitor_submission_notification.php'),
            (string) $releaseAt,
            (string) $submission->id,
            (string) $schoolHead->id,
            'indicator_package_submitted',
            $notificationKey,
        ];
        $processes = [new Process($command, base_path()), new Process($command, base_path())];

        foreach ($processes as $process) {
            $process->setTimeout(60);
            $process->start();
        }

        foreach ($processes as $process) {
            $process->wait();
            $this->assertTrue($process->isSuccessful(), $process->getErrorOutput().' '.$process->getOutput());
            $this->assertTrue((bool) json_decode($process->getOutput(), true, 512, JSON_THROW_ON_ERROR)['successful']);
        }

        DB::purge();
        DB::reconnect();
        $this->assertSame(1, DB::table('monitor_submission_notification_deliveries')->where('recipient_id', $monitor->id)->count());
        $this->assertSame(1, $monitor->fresh()->notifications()->where('type', IndicatorSubmissionReceivedNotification::class)->count());
    }

    public function test_database_queue_worker_processes_retry_without_duplication_and_records_failure(): void
    {
        [$monitor, $schoolHead, $submission] = $this->fixture();
        config(['queue.default' => 'database']);
        $notificationKey = str_repeat('d', 64);

        RetryMonitorSubmissionNotification::dispatch(
            (int) $submission->id,
            (int) $schoolHead->id,
            'indicator_package_submitted',
            [],
            [],
            $notificationKey,
        );

        $this->assertSame(1, DB::table('jobs')->where('queue', 'default')->count());
        $this->runOneDatabaseJob();
        $this->assertSame(0, DB::table('jobs')->where('queue', 'default')->count());
        $this->assertSame(1, $monitor->fresh()->notifications()->count());
        $this->assertSame(1, DB::table('monitor_submission_notification_deliveries')->count());

        RetryMonitorSubmissionNotification::dispatch(
            (int) $submission->id,
            (int) $schoolHead->id,
            'indicator_package_submitted',
            [],
            [],
            $notificationKey,
        );
        $this->runOneDatabaseJob();
        $this->assertSame(1, $monitor->fresh()->notifications()->count());
        $this->assertSame(1, DB::table('monitor_submission_notification_deliveries')->count());

        $unrecoverableJob = new RetryMonitorSubmissionNotification(
            PHP_INT_MAX,
            (int) $schoolHead->id,
            'indicator_package_submitted',
            [],
            [],
            str_repeat('e', 64),
        );
        $unrecoverableJob->tries = 1;
        dispatch($unrecoverableJob);
        $this->runOneDatabaseJob();

        $this->assertSame(0, DB::table('jobs')->where('queue', 'default')->count());
        $this->assertSame(1, DB::table('failed_jobs')->count());
        $this->assertSame(1, $monitor->fresh()->notifications()->count());
        $this->assertSame('draft', $submission->fresh()->status->value);
    }

    private function runOneDatabaseJob(): void
    {
        $exitCode = Artisan::call('queue:work', [
            'connection' => 'database',
            '--queue' => 'default',
            '--once' => true,
            '--sleep' => 0,
            '--tries' => 1,
        ]);

        $this->assertSame(0, $exitCode, Artisan::output());
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
