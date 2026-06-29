<?php

namespace Tests\Feature;

use App\Models\AcademicYear;
use App\Models\IndicatorSubmission;
use App\Models\PerformanceMetric;
use App\Models\User;
use App\Support\Indicators\GroupBWorkspaceDefinition;
use Database\Seeders\DemoDataSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Symfony\Component\HttpFoundation\Response;
use Tests\Concerns\InteractsWithSeededCredentials;
use Tests\TestCase;

class TargetsMetReportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithSeededCredentials;

    public function test_monitor_targets_met_report_includes_sent_school_achievement_values(): void
    {
        $this->seedIndicatorFixtures();
        [$schoolHead, $schoolHeadToken, $academicYearId, $year] = $this->schoolHeadContext();
        $submissionId = $this->createSubmission($schoolHeadToken, $academicYearId, [
            ...$this->completeRowsForScope(GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS, $year, [
                'IMETA_HEAD_NAME' => 'Maria Santos',
            ]),
        ]);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => [GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS],
        ])->assertOk();

        $report = $this->withToken($this->monitorToken())
            ->getJson("/api/indicators/submissions/{$submissionId}/targets-met-report");

        $report->assertOk()
            ->assertJsonPath('data.scopeVisibility.schoolAchievements', true)
            ->assertJsonPath('data.scopeVisibility.keyPerformance', false)
            ->assertJsonPath('data.schoolAchievements.0.key', 'school_head_name')
            ->assertJsonPath('data.schoolAchievements.0.visible', true)
            ->assertJsonPath('data.schoolAchievements.0.actual', 'Maria Santos')
            ->assertJsonPath('data.keyPerformanceIndicators.0.visible', false);

        $this->assertSame((string) $schoolHead->school_id, $report->json('data.school.id'));
    }

    public function test_monitor_targets_met_report_redacts_unsent_school_achievement_draft_values(): void
    {
        $this->seedIndicatorFixtures();
        [, $schoolHeadToken, $academicYearId, $year] = $this->schoolHeadContext();
        $submissionId = $this->createSubmission($schoolHeadToken, $academicYearId, [
            ...$this->completeRowsForScope(GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS, $year, [
                'IMETA_HEAD_NAME' => 'Maria Santos',
            ]),
        ]);

        $report = $this->withToken($this->monitorToken())
            ->getJson("/api/indicators/submissions/{$submissionId}/targets-met-report");

        $report->assertOk()
            ->assertJsonPath('data.scopeVisibility.schoolAchievements', false)
            ->assertJsonPath('data.schoolAchievements.0.visible', false)
            ->assertJsonPath('data.schoolAchievements.0.actual', null)
            ->assertJsonPath('data.schoolAchievements.0.missingReason', 'Scope has not been submitted for monitor review.');

        $this->assertStringNotContainsString('Maria Santos', json_encode($report->json(), JSON_THROW_ON_ERROR));
    }

    public function test_targets_met_report_computes_kpi_status_from_target_actual_and_comparison(): void
    {
        $this->seedIndicatorFixtures();
        [, $schoolHeadToken, $academicYearId, $year] = $this->schoolHeadContext();
        $submissionId = $this->createSubmission($schoolHeadToken, $academicYearId, [
            ...$this->completeRowsForScope(GroupBWorkspaceDefinition::KEY_PERFORMANCE, $year, [
                'NER' => ['target' => 90, 'actual' => 95],
                'DR' => ['target' => 2, 'actual' => 4],
            ]),
        ]);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => [GroupBWorkspaceDefinition::KEY_PERFORMANCE],
        ])->assertOk();

        $report = $this->withToken($this->monitorToken())
            ->getJson("/api/indicators/submissions/{$submissionId}/targets-met-report");

        $report->assertOk();
        $ner = $this->rowByKey($report->json('data.keyPerformanceIndicators'), 'net_enrollment_rate');
        $dropout = $this->rowByKey($report->json('data.keyPerformanceIndicators'), 'dropout_rate');

        $this->assertSame('90.00%', $ner['target']);
        $this->assertSame('95.00%', $ner['actual']);
        $this->assertSame('Met', $ner['status']);
        $this->assertSame('Not met', $dropout['status']);
    }

    public function test_targets_met_report_marks_kpi_with_missing_target_or_actual_as_missing_value(): void
    {
        $this->seedIndicatorFixtures();
        [, $schoolHeadToken, $academicYearId, $year] = $this->schoolHeadContext();
        $submissionId = $this->createSubmission($schoolHeadToken, $academicYearId, [
            ...$this->completeRowsForScope(GroupBWorkspaceDefinition::KEY_PERFORMANCE, $year, [
                'NER' => ['target' => 90, 'actual' => 95],
            ]),
        ]);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => [GroupBWorkspaceDefinition::KEY_PERFORMANCE],
        ])->assertOk();

        $submission = IndicatorSubmission::query()->whereKey((int) $submissionId)->firstOrFail();
        $metricId = (int) PerformanceMetric::query()->where('code', 'NER')->value('id');
        $submission->items()
            ->where('performance_metric_id', $metricId)
            ->update([
                'target_typed_value' => ['values' => [$year => null]],
                'target_display' => '',
            ]);

        $report = $this->withToken($this->monitorToken())
            ->getJson("/api/indicators/submissions/{$submissionId}/targets-met-report");

        $report->assertOk();
        $ner = $this->rowByKey($report->json('data.keyPerformanceIndicators'), 'net_enrollment_rate');

        $this->assertNull($ner['target']);
        $this->assertSame('Missing value', $ner['status']);
        $this->assertSame('Value is missing.', $ner['missingReason']);
    }

    public function test_monitor_targets_met_report_redacts_unsent_kpi_draft_values(): void
    {
        $this->seedIndicatorFixtures();
        [, $schoolHeadToken, $academicYearId, $year] = $this->schoolHeadContext();
        $submissionId = $this->createSubmission($schoolHeadToken, $academicYearId, [
            ...$this->completeRowsForScope(GroupBWorkspaceDefinition::KEY_PERFORMANCE, $year, [
                'NER' => ['target' => 90, 'actual' => 95],
            ]),
        ]);

        $report = $this->withToken($this->monitorToken())
            ->getJson("/api/indicators/submissions/{$submissionId}/targets-met-report");

        $report->assertOk();
        $ner = $this->rowByKey($report->json('data.keyPerformanceIndicators'), 'net_enrollment_rate');

        $this->assertFalse($ner['visible']);
        $this->assertNull($ner['target']);
        $this->assertNull($ner['actual']);
        $this->assertSame('Not submitted', $ner['status']);
        $this->assertStringNotContainsString('95.00%', json_encode($report->json(), JSON_THROW_ON_ERROR));
    }

    public function test_monitor_targets_met_report_includes_sent_kpi_values(): void
    {
        $this->seedIndicatorFixtures();
        [, $schoolHeadToken, $academicYearId, $year] = $this->schoolHeadContext();
        $submissionId = $this->createSubmission($schoolHeadToken, $academicYearId, [
            ...$this->completeRowsForScope(GroupBWorkspaceDefinition::KEY_PERFORMANCE, $year, [
                'NER' => ['target' => 90, 'actual' => 95],
            ]),
        ]);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => [GroupBWorkspaceDefinition::KEY_PERFORMANCE],
        ])->assertOk();

        $report = $this->withToken($this->monitorToken())
            ->getJson("/api/indicators/submissions/{$submissionId}/targets-met-report");

        $report->assertOk();
        $ner = $this->rowByKey($report->json('data.keyPerformanceIndicators'), 'net_enrollment_rate');

        $this->assertTrue($ner['visible']);
        $this->assertSame('90.00%', $ner['target']);
        $this->assertSame('95.00%', $ner['actual']);
        $this->assertSame('Met', $ner['status']);
    }

    public function test_monitor_targets_met_report_includes_final_submitted_values(): void
    {
        $this->seedIndicatorFixtures();
        [, $schoolHeadToken, $academicYearId, $year] = $this->schoolHeadContext();
        $submissionId = $this->createSubmission($schoolHeadToken, $academicYearId, [
            ...$this->completeRowsForScope(GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS, $year, [
                'IMETA_HEAD_NAME' => 'Maria Santos',
            ]),
            ...$this->completeRowsForScope(GroupBWorkspaceDefinition::KEY_PERFORMANCE, $year, [
                'NER' => ['target' => 90, 'actual' => 95],
            ]),
        ]);
        $this->uploadSubmissionFiles($schoolHeadToken, $submissionId, ['bmef', 'smea']);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit")
            ->assertOk();

        $report = $this->withToken($this->monitorToken())
            ->getJson("/api/indicators/submissions/{$submissionId}/targets-met-report");

        $report->assertOk()
            ->assertJsonPath('data.scopeVisibility.schoolAchievements', true)
            ->assertJsonPath('data.scopeVisibility.keyPerformance', true)
            ->assertJsonPath('data.schoolAchievements.0.actual', 'Maria Santos');

        $ner = $this->rowByKey($report->json('data.keyPerformanceIndicators'), 'net_enrollment_rate');
        $this->assertSame('Met', $ner['status']);
    }

    public function test_monitor_targets_met_report_hides_scope_after_school_head_edits_until_resend(): void
    {
        $this->seedIndicatorFixtures();
        [, $schoolHeadToken, $academicYearId, $year] = $this->schoolHeadContext();
        $submissionId = $this->createSubmission($schoolHeadToken, $academicYearId, [
            ...$this->completeRowsForScope(GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS, $year, [
                'IMETA_HEAD_NAME' => 'Maria Santos',
            ]),
        ]);

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => [GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS],
        ])->assertOk();

        $beforeEdit = $this->withToken($this->monitorToken())
            ->getJson("/api/indicators/submissions/{$submissionId}/targets-met-report");
        $beforeEdit->assertOk()
            ->assertJsonPath('data.schoolAchievements.0.actual', 'Maria Santos');

        $this->withToken($schoolHeadToken)->putJson("/api/indicators/submissions/{$submissionId}", [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'workspace_section' => GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS,
            'indicators' => $this->completeRowsForScope(GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS, $year, [
                'IMETA_HEAD_NAME' => 'Ana Reyes',
            ]),
        ])->assertOk();

        $afterEdit = $this->withToken($this->monitorToken())
            ->getJson("/api/indicators/submissions/{$submissionId}/targets-met-report");
        $afterEdit->assertOk()
            ->assertJsonPath('data.schoolAchievements.0.visible', false)
            ->assertJsonPath('data.schoolAchievements.0.actual', null);
        $this->assertStringNotContainsString('Ana Reyes', json_encode($afterEdit->json(), JSON_THROW_ON_ERROR));

        $this->withToken($schoolHeadToken)->postJson("/api/indicators/submissions/{$submissionId}/submit-scopes", [
            'targets' => [GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS],
        ])->assertOk();

        $afterResend = $this->withToken($this->monitorToken())
            ->getJson("/api/indicators/submissions/{$submissionId}/targets-met-report");
        $afterResend->assertOk()
            ->assertJsonPath('data.schoolAchievements.0.actual', 'Ana Reyes');
    }

    public function test_targets_met_report_requires_authorized_viewer(): void
    {
        $this->seedIndicatorFixtures();
        [$owner, $ownerToken, $academicYearId, $year] = $this->schoolHeadContext();
        $submissionId = $this->createSubmission($ownerToken, $academicYearId, [
            ...$this->completeRowsForScope(GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS, $year, [
                'IMETA_HEAD_NAME' => 'Maria Santos',
            ]),
        ]);

        /** @var User $outsider */
        $outsider = User::query()
            ->where('email', '!=', $owner->email)
            ->whereNot('school_id', $owner->school_id)
            ->whereHas('roles', fn ($query) => $query->whereIn('name', ['school_head', 'School Head', 'school head']))
            ->firstOrFail();
        $outsiderToken = $this->loginToken('school_head', $this->schoolHeadLogin($outsider));

        $this->withToken($outsiderToken)
            ->getJson("/api/indicators/submissions/{$submissionId}/targets-met-report")
            ->assertStatus(Response::HTTP_FORBIDDEN);
    }

    /**
     * @return array{0:User,1:string,2:int,3:string}
     */
    private function schoolHeadContext(string $email = 'schoolhead1@cspams.local'): array
    {
        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', $email)->firstOrFail();
        $academicYearId = (int) AcademicYear::query()->where('is_current', true)->value('id');
        $year = (string) AcademicYear::query()->whereKey($academicYearId)->value('name');
        $token = $this->loginToken('school_head', $this->schoolHeadLogin($schoolHead));

        return [$schoolHead, $token, $academicYearId, $year];
    }

    /**
     * @param list<array<string, mixed>> $indicators
     */
    private function createSubmission(string $token, int $academicYearId, array $indicators): string
    {
        $created = $this->withToken($token)->postJson('/api/indicators/submissions', [
            'academic_year_id' => $academicYearId,
            'reporting_period' => 'ANNUAL',
            'indicators' => $indicators,
        ]);

        $created->assertCreated();

        return (string) $created->json('data.id');
    }

    /**
     * @param array<string, mixed> $overrides
     * @return list<array<string, mixed>>
     */
    private function completeRowsForScope(string $scope, string $year, array $overrides = []): array
    {
        return collect(GroupBWorkspaceDefinition::metricCodesFor($scope))
            ->map(function (string $code) use ($scope, $year, $overrides): array {
                /** @var PerformanceMetric $metric */
                $metric = PerformanceMetric::query()->where('code', $code)->firstOrFail();
                $override = $overrides[$code] ?? null;

                if ($scope === GroupBWorkspaceDefinition::KEY_PERFORMANCE) {
                    $target = is_array($override) && array_key_exists('target', $override)
                        ? $override['target']
                        : $this->defaultMetricValue($metric);
                    $actual = is_array($override) && array_key_exists('actual', $override)
                        ? $override['actual']
                        : $this->defaultMetricValue($metric);

                    return [
                        'metric_code' => $code,
                        'target' => ['values' => [$year => $target]],
                        'actual' => ['values' => [$year => $actual]],
                    ];
                }

                return [
                    'metric_code' => $code,
                    'actual' => ['values' => [$year => $override ?? $this->defaultMetricValue($metric)]],
                ];
            })
            ->values()
            ->all();
    }

    private function defaultMetricValue(PerformanceMetric $metric): mixed
    {
        $schema = is_array($metric->input_schema) ? $metric->input_schema : [];
        $valueType = strtolower(trim((string) ($schema['valueType'] ?? 'number')));

        return match ($valueType) {
            'text' => 'Sample value',
            'enum' => collect($schema['options'] ?? [])->first() ?? 'Level 1',
            'yes_no' => true,
            'integer' => 5,
            'currency' => 1000,
            default => 95,
        };
    }

    /**
     * @param list<array<string, mixed>>|null $rows
     * @return array<string, mixed>
     */
    private function rowByKey(?array $rows, string $key): array
    {
        $row = collect($rows ?? [])->first(fn (array $row): bool => ($row['key'] ?? null) === $key);
        $this->assertIsArray($row);

        return $row;
    }

    private function monitorToken(): string
    {
        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();

        return $monitor->createToken('targets-met-report-monitor', ['role:monitor'])->plainTextToken;
    }

    /**
     * @param list<string> $types
     */
    private function uploadSubmissionFiles(string $token, string $submissionId, array $types): void
    {
        foreach ($types as $type) {
            $filename = str_replace('_', '-', $type);
            $extension = $type === 'smea' ? 'xlsx' : 'pdf';
            $mimeType = $type === 'smea'
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : 'application/pdf';

            $this->withToken($token)->postJson("/api/submissions/{$submissionId}/upload-file", [
                'type' => $type,
                'file' => UploadedFile::fake()->create("{$filename}.{$extension}", 64, $mimeType),
            ])->assertOk();
        }
    }

    private function loginToken(string $role, string $login): string
    {
        $normalizedRole = strtolower($role);
        $userQuery = User::query();

        if ($normalizedRole === 'monitor') {
            $userQuery
                ->where('email', $login)
                ->whereHas('roles', fn ($query) => $query->whereIn('name', ['monitor', 'Monitor', 'division monitor', 'Division Monitor']));
        } else {
            $userQuery
                ->where(function ($query) use ($login) {
                    $query
                        ->where('email', $login)
                        ->orWhereHas('school', fn ($schoolQuery) => $schoolQuery->where('school_code', $login));
                })
                ->whereHas('roles', fn ($query) => $query->whereIn('name', ['school_head', 'School Head', 'school head']));
        }

        /** @var User $user */
        $user = $userQuery->firstOrFail();
        $ability = $normalizedRole === 'monitor' ? 'role:monitor' : 'role:school_head';

        return $user->createToken("targets-met-report-{$normalizedRole}", [$ability])->plainTextToken;
    }

    private function schoolHeadLogin(User $user): string
    {
        $user->loadMissing('school');

        return (string) $user->school?->school_code;
    }

    private function seedIndicatorFixtures(): void
    {
        $this->seed([
            RolesAndPermissionsSeeder::class,
            DemoDataSeeder::class,
        ]);
    }
}
