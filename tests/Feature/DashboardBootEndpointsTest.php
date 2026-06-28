<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Concerns\InteractsWithSeededCredentials;
use Tests\TestCase;

class DashboardBootEndpointsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithSeededCredentials;

    public function test_monitor_dashboard_boot_endpoints_return_json_without_service_unavailable(): void
    {
        $this->seed();

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        foreach ($this->dashboardBootPaths() as $path) {
            $this->assertBootEndpointOk($this->withToken($token)->getJson($path), $path);
        }
    }

    public function test_school_head_dashboard_boot_endpoints_return_json_without_service_unavailable(): void
    {
        $this->seed();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        foreach ($this->dashboardBootPaths() as $path) {
            $this->assertBootEndpointOk($this->withToken($token)->getJson($path), $path);
        }
    }

    /**
     * @return array<int, string>
     */
    private function dashboardBootPaths(): array
    {
        return [
            '/api/auth/me',
            '/api/dashboard/records',
            '/api/notifications',
            '/api/indicators/academic-years',
            '/api/indicators/submissions?per_page=25',
            '/api/dashboard/students?per_page=25',
            '/api/dashboard/teachers?per_page=25',
        ];
    }

    private function assertBootEndpointOk(TestResponse $response, string $path): void
    {
        $this->assertNotContains(
            $response->getStatusCode(),
            [
                Response::HTTP_BAD_GATEWAY,
                Response::HTTP_SERVICE_UNAVAILABLE,
                Response::HTTP_GATEWAY_TIMEOUT,
            ],
            "{$path} returned an infrastructure availability status.",
        );

        $response->assertOk();
        $contentType = (string) $response->headers->get('Content-Type', '');
        $this->assertStringContainsString('application/json', $contentType, "{$path} did not return JSON.");
    }

    private function loginToken(string $role, string $login): string
    {
        $response = $this->postJson('/api/auth/login', [
            'role' => $role,
            'login' => $login,
            'password' => $this->demoPasswordForLogin($role, $login),
        ]);

        $response->assertOk();

        return (string) $response->json('token');
    }

    private function schoolHeadLogin(User $user): string
    {
        $user->loadMissing('school');

        return (string) $user->school?->school_code;
    }
}
