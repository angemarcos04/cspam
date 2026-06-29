<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\HttpFoundation\Response;

class ReadinessDiagnosticsController extends Controller
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

        $checks = [
            'database' => $this->databaseCheck(),
            'tables' => [
                'accountSetupTokens' => $this->tableCheck('account_setup_tokens', true),
                'notifications' => $this->tableCheck('notifications', true),
                'monitorMfaResetTickets' => $this->tableCheck(
                    'monitor_mfa_reset_tickets',
                    (bool) config('auth_mfa.monitor.enabled', false),
                ),
                'jobs' => $this->jobsTableCheck(),
            ],
            'columns' => [
                'userFlags' => $this->userFlagColumnsCheck(),
            ],
            'notifications' => $this->notificationCenterCheck(),
            'dashboard' => $this->dashboardSummary(),
            'queue' => $this->queueSummary(),
            'mail' => $this->mailSummary(),
            'monitorMfa' => $this->monitorMfaSummary(),
            'schoolReminders' => $this->schoolReminderSummary(),
        ];

        return response()->json([
            'status' => $this->overallStatus($checks),
            'app' => 'cspams',
            'timestamp' => now()->toIso8601String(),
            'checks' => $checks,
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
    private function databaseCheck(): array
    {
        try {
            DB::connection()->getPdo();

            return [
                'status' => 'ok',
                'connected' => true,
            ];
        } catch (\Throwable) {
            return [
                'status' => 'failed',
                'connected' => false,
            ];
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function tableCheck(string $table, bool $required): array
    {
        try {
            $exists = Schema::hasTable($table);
        } catch (\Throwable) {
            $exists = false;
        }

        return [
            'status' => $exists ? 'ok' : ($required ? 'failed' : 'warning'),
            'required' => $required,
            'exists' => $exists,
        ];
    }

    /**
     * @param array<int, string> $columns
     * @return array<string, mixed>
     */
    private function columnCheck(string $table, array $columns, bool $required = true): array
    {
        $missing = [];
        $tableExists = false;

        try {
            $tableExists = Schema::hasTable($table);
        } catch (\Throwable) {
            $tableExists = false;
        }

        if ($tableExists) {
            foreach ($columns as $column) {
                try {
                    if (! Schema::hasColumn($table, $column)) {
                        $missing[] = $column;
                    }
                } catch (\Throwable) {
                    $missing[] = $column;
                }
            }
        } else {
            $missing = $columns;
        }

        return [
            'status' => $missing === [] ? 'ok' : ($required ? 'failed' : 'warning'),
            'required' => $required,
            'missing' => $missing,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function dashboardSummary(): array
    {
        $checks = [
            'tables' => [
                // FIX: report the shared login/dashboard dependencies that can break both roles.
                'schools' => $this->tableCheck('schools', true),
                'users' => $this->tableCheck('users', true),
                'personalAccessTokens' => $this->tableCheck('personal_access_tokens', true),
                'academicYears' => $this->tableCheck('academic_years', true),
                'indicatorSubmissions' => $this->tableCheck('indicator_submissions', true),
                'indicatorSubmissionScopeReviews' => $this->tableCheck('indicator_submission_scope_reviews', true),
                'indicatorSubmissionScopeSubmissions' => $this->tableCheck('indicator_submission_scope_submissions', true),
                'notifications' => $this->tableCheck('notifications', true),
                'students' => $this->tableCheck('students', true),
                'teachers' => $this->tableCheck('teachers', true),
                'performanceMetrics' => $this->tableCheck('performance_metrics', true),
                'indicatorSubmissionItems' => $this->tableCheck('indicator_submission_items', true),
                'jobs' => $this->jobsTableCheck(),
            ],
            'columns' => [
                'schools' => $this->columnCheck('schools', $this->schoolDashboardColumns()),
                'users' => $this->columnCheck('users', ['id', 'name', 'email', 'school_id', 'account_type', 'account_status']),
                'academicYears' => $this->columnCheck('academic_years', ['id', 'name', 'start_date', 'end_date', 'is_current']),
                'indicatorSubmissions' => $this->columnCheck('indicator_submissions', ['id', 'school_id', 'academic_year_id', 'status', 'updated_at']),
                'indicatorSubmissionScopeReviews' => $this->columnCheck('indicator_submission_scope_reviews', ['id', 'indicator_submission_id', 'scope_id', 'decision']),
                'students' => $this->columnCheck('students', $this->studentDashboardColumns()),
                'teachers' => $this->columnCheck('teachers', ['id', 'school_id', 'name', 'updated_at']),
                'performanceMetrics' => $this->columnCheck('performance_metrics', ['id', 'input_schema', 'data_type', 'is_active']),
                'indicatorSubmissionItems' => $this->columnCheck('indicator_submission_items', ['id', 'performance_metric_id', 'target_typed_value', 'actual_typed_value']),
            ],
        ];

        return [
            'status' => $this->overallStatus($checks),
            ...$checks,
        ];
    }

    /**
     * @return array<int, string>
     */
    private function studentDashboardColumns(): array
    {
        return [
            'id',
            'school_id',
            'section_id',
            'academic_year_id',
            'lrn',
            'first_name',
            'middle_name',
            'last_name',
            'sex',
            'birth_date',
            'status',
            'risk_level',
            'tracked_from_level',
            'current_level',
            'section_name',
            'teacher_name',
            'last_status_at',
            'created_at',
            'updated_at',
            'deleted_at',
            'archived_original_lrn',
        ];
    }

    /**
     * @return array<int, string>
     */
    private function schoolDashboardColumns(): array
    {
        return [
            'id',
            'school_code',
            'school_code_normalized',
            'name',
            'status',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function jobsTableCheck(): array
    {
        $defaultQueue = (string) config('queue.default', '');
        $queueDriver = (string) config("queue.connections.{$defaultQueue}.driver", $defaultQueue);
        $requiresJobsTable = $queueDriver === 'database';

        if (! $requiresJobsTable) {
            return [
                'status' => 'ok',
                'required' => false,
                'exists' => null,
            ];
        }

        $table = (string) config("queue.connections.{$defaultQueue}.table", config('queue.connections.database.table', 'jobs'));

        return $this->tableCheck($table, true);
    }

    /**
     * @return array<string, mixed>
     */
    private function userFlagColumnsCheck(): array
    {
        $requiredColumns = [
            'flagged_at',
            'flagged_by_user_id',
            'flagged_reason',
            'delete_record_flagged_at',
            'delete_record_flagged_by_user_id',
            'delete_record_flag_reason',
        ];

        $missing = [];
        foreach ($requiredColumns as $column) {
            try {
                if (! Schema::hasColumn('users', $column)) {
                    $missing[] = $column;
                }
            } catch (\Throwable) {
                $missing[] = $column;
            }
        }

        return [
            'status' => $missing === [] ? 'ok' : 'failed',
            'missing' => $missing,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function notificationCenterCheck(): array
    {
        try {
            $tableExists = Schema::hasTable('notifications');
        } catch (\Throwable) {
            $tableExists = false;
        }

        $clearedAtColumn = false;
        if ($tableExists) {
            try {
                $clearedAtColumn = Schema::hasColumn('notifications', 'cleared_at');
            } catch (\Throwable) {
                $clearedAtColumn = false;
            }
        }

        return [
            'status' => $tableExists && $clearedAtColumn ? 'ok' : 'failed',
            'table' => $tableExists,
            'clearedAtColumn' => $clearedAtColumn,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function queueSummary(): array
    {
        $defaultQueue = (string) config('queue.default', '');
        $queueDriver = (string) config("queue.connections.{$defaultQueue}.driver", $defaultQueue);

        return [
            'status' => $queueDriver !== '' ? 'ok' : 'warning',
            'defaultDriver' => $queueDriver,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function mailSummary(): array
    {
        $mailer = trim((string) config('mail.default', ''));
        $fromAddress = trim((string) config('mail.from.address', ''));

        return [
            'status' => $mailer !== '' && $fromAddress !== '' ? 'ok' : 'warning',
            'defaultDriver' => $mailer,
            'fromConfigured' => $fromAddress !== '',
            'resendKeyConfigured' => trim((string) config('services.resend.key', '')) !== '',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function monitorMfaSummary(): array
    {
        $enabled = (bool) config('auth_mfa.monitor.enabled', false);
        $deliveryMode = (string) config('auth_mfa.monitor.delivery_mode', 'queued');
        $queueConnection = trim((string) config('auth_mfa.monitor.queue_connection', ''));
        $queueName = trim((string) config('auth_mfa.monitor.queue', ''));

        return [
            'status' => $enabled ? 'ok' : 'warning',
            'enabled' => $enabled,
            'deliveryMode' => $deliveryMode,
            'queueConnection' => $queueConnection !== '' ? $queueConnection : 'default',
            'queueConfigured' => $queueName !== '',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function schoolReminderSummary(): array
    {
        $deliveryMode = (string) config('cspams.school_reminders.delivery_mode', 'queued');

        return [
            'status' => $deliveryMode !== '' ? 'ok' : 'warning',
            'deliveryMode' => $deliveryMode,
        ];
    }

    /**
     * @param array<string, mixed> $checks
     */
    private function overallStatus(array $checks): string
    {
        $statuses = $this->collectStatuses($checks);
        if (in_array('failed', $statuses, true)) {
            return 'failed';
        }

        if (in_array('warning', $statuses, true)) {
            return 'warning';
        }

        return 'ok';
    }

    /**
     * @param array<string, mixed> $value
     * @return array<int, string>
     */
    private function collectStatuses(array $value): array
    {
        $statuses = [];
        if (isset($value['status']) && is_string($value['status'])) {
            $statuses[] = $value['status'];
        }

        foreach ($value as $child) {
            if (is_array($child)) {
                array_push($statuses, ...$this->collectStatuses($child));
            }
        }

        return $statuses;
    }
}
