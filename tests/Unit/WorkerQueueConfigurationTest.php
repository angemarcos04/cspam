<?php

namespace Tests\Unit;

use Tests\TestCase;

class WorkerQueueConfigurationTest extends TestCase
{
    public function test_worker_and_render_default_to_prioritized_notification_queues(): void
    {
        $script = file_get_contents(base_path('docker/worker-start.sh'));
        $render = file_get_contents(base_path('render.yaml'));

        $this->assertIsString($script);
        $this->assertStringContainsString('Queue names: ${CSPAMS_QUEUE_NAMES:-mail,broadcasts,default}', $script);
        $this->assertStringContainsString('--queue="${CSPAMS_QUEUE_NAMES:-mail,broadcasts,default}"', $script);
        $this->assertSame(2, substr_count($script, '${CSPAMS_QUEUE_NAMES:-mail,broadcasts,default}'));

        $this->assertIsString($render);
        $workerBlock = explode('  - type: worker', $render, 2)[1] ?? '';
        $webBlock = explode('  - type: worker', $render, 2)[0];
        $this->assertStringContainsString('name: cspam-backend-worker', $workerBlock);
        $this->assertStringContainsString("key: CSPAMS_QUEUE_NAMES\n        value: mail,broadcasts,default", str_replace("\r\n", "\n", $workerBlock));
        $this->assertStringNotContainsString('key: CSPAMS_QUEUE_NAMES', $webBlock);
    }
}
