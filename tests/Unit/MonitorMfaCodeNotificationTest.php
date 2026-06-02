<?php

namespace Tests\Unit;

use App\Notifications\MonitorMfaCodeNotification;
use Illuminate\Contracts\Queue\ShouldQueue;
use Tests\TestCase;

class MonitorMfaCodeNotificationTest extends TestCase
{
    public function test_monitor_mfa_code_notification_is_queued_on_mail_queue(): void
    {
        $notification = new MonitorMfaCodeNotification('123456', now()->addMinutes(10)->toDateTimeString());

        config()->set('queue.default', 'database');
        config()->set('auth_mfa.monitor.queue_connection', null);
        config()->set('auth_mfa.monitor.queue', 'mail');

        $this->assertInstanceOf(ShouldQueue::class, $notification);
        $this->assertSame(['mail' => 'database'], $notification->viaConnections());
        $this->assertSame(['mail' => 'mail'], $notification->viaQueues());
    }

    public function test_monitor_mfa_code_notification_does_not_use_sync_queue_connection(): void
    {
        $notification = new MonitorMfaCodeNotification('123456', now()->addMinutes(10)->toDateTimeString());

        config()->set('queue.default', 'sync');
        config()->set('auth_mfa.monitor.queue_connection', null);
        config()->set('auth_mfa.monitor.queue', '');

        $this->assertSame(['mail' => 'database'], $notification->viaConnections());
        $this->assertSame(['mail' => 'mail'], $notification->viaQueues());
    }
}
