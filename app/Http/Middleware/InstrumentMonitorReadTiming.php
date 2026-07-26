<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class InstrumentMonitorReadTiming
{
    public function handle(Request $request, Closure $next, string $endpoint): Response
    {
        if (! config('cspams_performance.enabled', false)) {
            return $next($request);
        }

        $startedAtNs = hrtime(true);
        $queryCount = 0;
        $queryTimeMs = 0.0;

        DB::listen(static function (QueryExecuted $query) use (&$queryCount, &$queryTimeMs): void {
            $queryCount++;
            $queryTimeMs += (float) $query->time;
        });

        try {
            /** @var Response $response */
            $response = $next($request);
        } catch (\Throwable $exception) {
            $this->logMeasurement(
                endpoint: $endpoint,
                request: $request,
                status: 500,
                startedAtNs: $startedAtNs,
                queryCount: $queryCount,
                queryTimeMs: $queryTimeMs,
                rowCount: null,
                exception: $exception,
            );

            throw $exception;
        }

        $this->logMeasurement(
            endpoint: $endpoint,
            request: $request,
            status: $response->getStatusCode(),
            startedAtNs: $startedAtNs,
            queryCount: $queryCount,
            queryTimeMs: $queryTimeMs,
            rowCount: $this->responseRowCount($response),
        );

        return $response;
    }

    private function logMeasurement(
        string $endpoint,
        Request $request,
        int $status,
        int $startedAtNs,
        int $queryCount,
        float $queryTimeMs,
        ?int $rowCount,
        ?\Throwable $exception = null,
    ): void {
        $durationMs = round((hrtime(true) - $startedAtNs) / 1_000_000, 2);
        $thresholdMs = max(0, (int) config('cspams_performance.slow_request_threshold_ms', 500));
        $context = [
            'endpoint' => $endpoint,
            'method' => $request->method(),
            'status' => $status,
            'duration_ms' => $durationMs,
            'query_count' => $queryCount,
            'query_time_ms' => round($queryTimeMs, 2),
            'rows' => $rowCount,
            'not_modified' => $status === Response::HTTP_NOT_MODIFIED,
        ];

        if ($exception) {
            $context['exception'] = $exception::class;
        }

        $message = '[cspams-performance] monitor endpoint timing';
        if ($exception || $durationMs >= $thresholdMs) {
            Log::warning($message, $context);

            return;
        }

        Log::info($message, $context);
    }

    private function responseRowCount(Response $response): ?int
    {
        if (! $response instanceof JsonResponse) {
            return null;
        }

        $payload = $response->getData(true);
        $rows = is_array($payload) ? ($payload['data'] ?? null) : null;

        return is_array($rows) ? count($rows) : null;
    }
}
