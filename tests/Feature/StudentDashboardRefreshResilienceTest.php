<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\FilterService;
use App\Support\Indicators\RollingIndicatorYearWindow;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;
use Tests\Concerns\InteractsWithSeededCredentials;
use Tests\TestCase;

class StudentDashboardRefreshResilienceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithSeededCredentials;

    public function test_monitor_student_dashboard_endpoint_returns_json(): void
    {
        $this->seed();

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $this->withToken($token)
            ->getJson('/api/dashboard/students?per_page=25')
            ->assertOk()
            ->assertJsonStructure([
                'data',
                'meta' => [
                    'syncedAt',
                    'scope',
                    'recordCount',
                    'total',
                ],
            ]);
    }

    public function test_student_sync_fingerprint_query_does_not_reuse_listing_select_columns(): void
    {
        $this->seed();

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');
        $queries = [];

        DB::listen(static function ($query) use (&$queries): void {
            $queries[] = strtolower($query->sql);
        });

        $this->withToken($token)
            ->getJson('/api/dashboard/students?page=1&per_page=25')
            ->assertOk()
            ->assertHeader('X-Sync-Scope', 'division')
            ->assertHeader('X-Sync-Etag')
            ->assertHeader('X-Synced-At');

        $aggregateQuery = collect($queries)
            ->first(static fn (string $sql): bool => str_contains($sql, 'aggregate_count'));

        $this->assertIsString($aggregateQuery, 'Expected the student sync aggregate query to run.');
        $this->assertStringContainsString('count(*) as aggregate_count', $aggregateQuery);
        $this->assertStringNotContainsString('students.id', $aggregateQuery);
        $this->assertStringNotContainsString('students"."id', $aggregateQuery);
        $this->assertStringNotContainsString('lrn', $aggregateQuery);
        $this->assertStringNotContainsString('first_name', $aggregateQuery);
        $this->assertStringNotContainsString('teacher_name', $aggregateQuery);
    }

    public function test_school_head_student_dashboard_endpoint_returns_json(): void
    {
        $this->seed();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        $this->withToken($token)
            ->getJson('/api/dashboard/students?per_page=25')
            ->assertOk()
            ->assertJsonPath('meta.scope', 'school')
            ->assertJsonStructure([
                'data',
                'meta' => [
                    'syncedAt',
                    'scope',
                    'recordCount',
                    'total',
                ],
            ]);
    }

    public function test_rolling_academic_year_sync_failure_does_not_break_student_listing(): void
    {
        $this->seed();
        Cache::flush();
        $this->app->bind(RollingIndicatorYearWindow::class, static fn () => new class extends RollingIndicatorYearWindow {
            public function sync(): array
            {
                throw new \RuntimeException('Forced rolling year sync failure.');
            }
        });

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $this->withToken($token)
            ->getJson('/api/dashboard/students?per_page=25')
            ->assertOk()
            ->assertJsonStructure(['data', 'meta']);
    }

    public function test_unexpected_authorized_student_listing_failure_returns_safe_json(): void
    {
        $this->seed();
        $this->app->instance(FilterService::class, new class extends FilterService {
            public function extract(Request $request, array $aliases = [], array $keys = []): array
            {
                throw new \RuntimeException('Forced student filter failure.');
            }
        });

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $this->withToken($token)
            ->getJson('/api/dashboard/students?per_page=25')
            ->assertStatus(Response::HTTP_INTERNAL_SERVER_ERROR)
            ->assertJsonPath('message', 'Unable to refresh student records right now. Please try again.')
            ->assertJsonPath('errorCode', 'student_records_refresh_failed')
            ->assertJsonMissingPath('exception')
            ->assertJsonMissingPath('trace');
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
