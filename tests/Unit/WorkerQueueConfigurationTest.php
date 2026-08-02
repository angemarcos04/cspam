<?php

namespace Tests\Unit;

use Tests\TestCase;

class WorkerQueueConfigurationTest extends TestCase
{
    public function test_worker_default_consumes_mail_default_and_broadcasts_queues(): void
    {
        $script = file_get_contents(base_path('docker/worker-start.sh'));

        $this->assertIsString($script);
        $this->assertStringContainsString('${CSPAMS_QUEUE_NAMES:-mail,default,broadcasts}', $script);
        $this->assertSame(2, substr_count($script, '${CSPAMS_QUEUE_NAMES:-mail,default,broadcasts}'));
    }
}
