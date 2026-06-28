<?php

namespace Tests\Feature;

use Tests\TestCase;

class HealthEndpointTest extends TestCase
{
    public function test_public_health_endpoint_reports_laravel_liveness_without_secrets(): void
    {
        $response = $this->getJson('/api/health');

        $response
            ->assertOk()
            ->assertJsonPath('status', 'ok')
            ->assertJsonPath('app', 'cspams')
            ->assertJsonPath('timestamp', fn (string $value): bool => $value !== '')
            ->assertJsonMissingPath('database')
            ->assertJsonMissingPath('config')
            ->assertJsonMissingPath('env')
            ->assertJsonMissingPath('token')
            ->assertJsonMissingPath('secret')
            ->assertJsonMissingPath('password');
    }
}
