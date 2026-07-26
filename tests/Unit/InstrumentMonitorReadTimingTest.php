<?php

namespace Tests\Unit;

use App\Http\Middleware\InstrumentMonitorReadTiming;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class InstrumentMonitorReadTimingTest extends TestCase
{
    public function test_it_logs_safe_monitor_read_measurements_when_enabled(): void
    {
        config()->set('cspams_performance.enabled', true);
        config()->set('cspams_performance.slow_request_threshold_ms', 10_000);
        Log::spy();

        $request = Request::create('/api/dashboard/review-inbox', 'GET');
        $response = (new InstrumentMonitorReadTiming)->handle(
            $request,
            static fn () => response()->json([
                'data' => [
                    ['schoolCode' => 'SCH-001'],
                    ['schoolCode' => 'SCH-002'],
                ],
            ]),
            'dashboard.review-inbox',
        );

        $this->assertSame(200, $response->getStatusCode());
        Log::shouldHaveReceived('info')
            ->once()
            ->with(
                '[cspams-performance] monitor endpoint timing',
                \Mockery::on(static fn (array $context): bool => $context['endpoint'] === 'dashboard.review-inbox'
                    && $context['method'] === 'GET'
                    && $context['status'] === 200
                    && $context['rows'] === 2
                    && $context['query_count'] === 0
                    && $context['not_modified'] === false
                    && ! array_key_exists('request', $context)
                    && ! array_key_exists('headers', $context)),
            );
    }

    public function test_it_has_no_timing_log_when_disabled(): void
    {
        config()->set('cspams_performance.enabled', false);
        Log::spy();

        (new InstrumentMonitorReadTiming)->handle(
            Request::create('/api/dashboard/records', 'GET'),
            static fn () => response()->json(['data' => []]),
            'dashboard.records',
        );

        Log::shouldNotHaveReceived('info');
        Log::shouldNotHaveReceived('warning');
    }
}
