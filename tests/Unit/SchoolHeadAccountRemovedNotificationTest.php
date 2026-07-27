<?php

namespace Tests\Unit;

use App\Notifications\SchoolHeadAccountRemovedNotification;
use Illuminate\Contracts\Queue\ShouldQueue;
use Tests\TestCase;

class SchoolHeadAccountRemovedNotificationTest extends TestCase
{
    public function test_removal_notification_uses_the_existing_transactional_mail_queue(): void
    {
        config()->set('queue.default', 'database');
        config()->set('auth_mfa.monitor.queue_connection', null);
        config()->set('auth_mfa.monitor.queue', 'mail');

        $notification = new SchoolHeadAccountRemovedNotification(
            'Example School',
            '401777',
            'School Head',
            'Duplicate record.',
        );

        $this->assertInstanceOf(ShouldQueue::class, $notification);
        $this->assertSame(['mail' => 'database'], $notification->viaConnections());
        $this->assertSame(['mail' => 'mail'], $notification->viaQueues());
        $this->assertTrue($notification->afterCommit);
    }

    public function test_removal_notification_never_falls_back_to_a_sync_connection(): void
    {
        config()->set('queue.default', 'sync');
        config()->set('auth_mfa.monitor.queue_connection', '');
        config()->set('auth_mfa.monitor.queue', '');

        $notification = new SchoolHeadAccountRemovedNotification('Example School');

        $this->assertSame(['mail' => 'database'], $notification->viaConnections());
        $this->assertSame(['mail' => 'mail'], $notification->viaQueues());
    }
}
