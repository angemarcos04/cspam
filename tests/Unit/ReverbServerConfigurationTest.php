<?php

namespace Tests\Unit;

use Tests\TestCase;

class ReverbServerConfigurationTest extends TestCase
{
    public function test_reverb_uses_platform_port_and_safe_server_defaults(): void
    {
        $script = file_get_contents(base_path('docker/reverb-start.sh'));
        $render = file_get_contents(base_path('render.yaml'));

        $this->assertIsString($script);
        $this->assertStringContainsString('SERVER_HOST="${REVERB_SERVER_HOST:-0.0.0.0}"', $script);
        $this->assertStringContainsString('SERVER_PORT="${PORT:-${REVERB_SERVER_PORT:-8080}}"', $script);
        $this->assertStringContainsString('reverb:start --host="${SERVER_HOST}" --port="${SERVER_PORT}"', $script);
        $this->assertStringNotContainsString('REVERB_APP_SECRET', $script);

        $this->assertIsString($render);
        $this->assertStringContainsString('Reverb is intentionally provisioned as a separate Render web service', $render);
    }
}
