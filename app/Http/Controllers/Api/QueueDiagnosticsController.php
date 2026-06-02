<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\HttpFoundation\Response;

class QueueDiagnosticsController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $configuredToken = trim((string) config('diagnostics.queue.token', ''));
        if ($configuredToken === '') {
            return response()->json(['message' => 'Not Found'], Response::HTTP_NOT_FOUND);
        }

        $providedToken = $this->providedToken($request);
        if ($providedToken === '' || ! hash_equals($configuredToken, $providedToken)) {
            return response()->json(['message' => 'Not Found'], Response::HTTP_NOT_FOUND);
        }

        $jobsTable = (string) config('queue.connections.database.table', 'jobs');
        $failedJobsTable = (string) config('queue.failed.table', 'failed_jobs');

        return response()->json([
            'app' => $this->appSummary(),
            'mfa' => $this->mfaSummary(),
            'mail' => $this->mailSummary(),
            'queueConnection' => (string) config('queue.default', ''),
            'mailQueue' => (string) config('auth_mfa.monitor.queue', 'mail'),
            'jobs' => $this->jobsSummary($jobsTable),
            'failedJobs' => $this->failedJobsSummary($failedJobsTable),
        ]);
    }

    private function providedToken(Request $request): string
    {
        $bearerToken = trim((string) $request->bearerToken());
        if ($bearerToken !== '') {
            return $bearerToken;
        }

        $headerToken = trim((string) $request->header('X-CSPAMS-Diagnostics-Token', ''));
        if ($headerToken !== '') {
            return $headerToken;
        }

        return trim((string) $request->query('token', ''));
    }

    /**
     * @return array<string, mixed>
     */
    private function appSummary(): array
    {
        return [
            'env' => (string) config('app.env', ''),
            'debug' => (bool) config('app.debug', false),
            'url' => (string) config('app.url', ''),
            'frontendUrl' => (string) config('app.frontend_url', ''),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function mfaSummary(): array
    {
        return [
            'enabled' => (bool) config('auth_mfa.monitor.enabled', false),
            'deliveryMode' => (string) config('auth_mfa.monitor.delivery_mode', 'queued'),
            'queue' => (string) config('auth_mfa.monitor.queue', 'mail'),
            'testCodeConfigured' => trim((string) config('auth_mfa.monitor.test_code', '')) !== '',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function mailSummary(): array
    {
        return [
            'mailer' => (string) config('mail.default', ''),
            'from' => (string) config('mail.from.address', ''),
            'smtpHost' => (string) config('mail.mailers.smtp.host', ''),
            'smtpPort' => (string) config('mail.mailers.smtp.port', ''),
            'smtpScheme' => (string) config('mail.mailers.smtp.scheme', ''),
            'smtpUsernameConfigured' => trim((string) config('mail.mailers.smtp.username', '')) !== '',
            'smtpPasswordConfigured' => trim((string) config('mail.mailers.smtp.password', '')) !== '',
            'resendKeyConfigured' => trim((string) config('services.resend.key', '')) !== '',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function jobsSummary(string $table): array
    {
        if (! Schema::hasTable($table)) {
            return [
                'table' => $table,
                'exists' => false,
                'total' => 0,
                'byQueue' => [],
            ];
        }

        $byQueue = DB::table($table)
            ->selectRaw('queue, COUNT(*) as total, MIN(created_at) as oldest_created_at, MAX(created_at) as newest_created_at')
            ->groupBy('queue')
            ->orderBy('queue')
            ->get()
            ->map(static fn (object $row): array => [
                'queue' => (string) $row->queue,
                'total' => (int) $row->total,
                'oldestCreatedAt' => $row->oldest_created_at !== null ? (int) $row->oldest_created_at : null,
                'newestCreatedAt' => $row->newest_created_at !== null ? (int) $row->newest_created_at : null,
            ])
            ->values()
            ->all();

        return [
            'table' => $table,
            'exists' => true,
            'total' => (int) DB::table($table)->count(),
            'byQueue' => $byQueue,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function failedJobsSummary(string $table): array
    {
        if (! Schema::hasTable($table)) {
            return [
                'table' => $table,
                'exists' => false,
                'total' => 0,
                'recent' => [],
            ];
        }

        $recent = DB::table($table)
            ->select(['id', 'connection', 'queue', 'exception', 'failed_at'])
            ->orderByDesc('id')
            ->limit(5)
            ->get()
            ->map(fn (object $row): array => [
                'id' => (int) $row->id,
                'connection' => (string) $row->connection,
                'queue' => (string) $row->queue,
                'failedAt' => $row->failed_at !== null ? (string) $row->failed_at : null,
                'exceptionSummary' => $this->exceptionSummary((string) $row->exception),
            ])
            ->values()
            ->all();

        return [
            'table' => $table,
            'exists' => true,
            'total' => (int) DB::table($table)->count(),
            'recent' => $recent,
        ];
    }

    private function exceptionSummary(string $exception): string
    {
        $line = trim(strtok($exception, "\n") ?: $exception);
        $line = preg_replace('/password[=:]\S+/i', 'password=[redacted]', $line) ?? $line;

        return mb_substr($line, 0, 500);
    }
}
