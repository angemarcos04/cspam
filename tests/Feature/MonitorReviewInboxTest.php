<?php

namespace Tests\Feature;

use App\Models\AcademicYear;
use App\Models\IndicatorSubmission;
use App\Models\School;
use App\Models\User;
use App\Support\Domain\FormSubmissionStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Symfony\Component\HttpFoundation\Response;
use Tests\TestCase;

class MonitorReviewInboxTest extends TestCase
{
    use RefreshDatabase;

    public function test_review_inbox_requires_monitor_access(): void
    {
        $this->seed();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();

        $this->getJson('/api/dashboard/review-inbox')
            ->assertStatus(Response::HTTP_UNAUTHORIZED);

        $this->actingAs($schoolHead, 'sanctum')
            ->getJson('/api/dashboard/review-inbox')
            ->assertStatus(Response::HTTP_FORBIDDEN);
    }

    public function test_monitor_review_inbox_returns_priority_sorted_paginated_rows(): void
    {
        [$monitor, $academicYear] = $this->seedReviewInboxFixture();

        $response = $this->actingAs($monitor, 'sanctum')
            ->getJson('/api/dashboard/review-inbox?search=Review%20Inbox%20API&per_page=2');

        $response->assertOk()
            ->assertJsonPath('meta.currentPage', 1)
            ->assertJsonPath('meta.lastPage', 2)
            ->assertJsonPath('meta.perPage', 2)
            ->assertJsonPath('meta.total', 4)
            ->assertJsonPath('meta.queueLaneCounts.all', 3)
            ->assertJsonPath('meta.needsActionCount', 3)
            ->assertJsonPath('data.0.schoolName', 'Review Inbox API Returned')
            ->assertJsonPath('data.0.indicatorStatus', FormSubmissionStatus::RETURNED->value)
            ->assertJsonPath('data.1.schoolName', 'Review Inbox API Missing')
            ->assertJsonPath('data.1.missingCount', 1);

        $this->assertNull(data_get($response->json('data.0'), 'searchText'));

        $secondPage = $this->actingAs($monitor, 'sanctum')
            ->getJson('/api/dashboard/review-inbox?search=Review%20Inbox%20API&per_page=2&page=2&academic_year_id=' . $academicYear->id);

        $secondPage->assertOk()
            ->assertJsonPath('meta.currentPage', 2)
            ->assertJsonPath('data.0.schoolName', 'Review Inbox API Waiting')
            ->assertJsonPath('data.0.awaitingReviewCount', 1)
            ->assertJsonPath('data.1.schoolName', 'Review Inbox API Validated')
            ->assertJsonPath('data.1.indicatorStatus', FormSubmissionStatus::VALIDATED->value);
    }

    public function test_monitor_review_inbox_supports_computed_filters(): void
    {
        [$monitor, $academicYear, $schools] = $this->seedReviewInboxFixture();

        $waiting = $this->actingAs($monitor, 'sanctum')
            ->getJson('/api/dashboard/review-inbox?search=Review%20Inbox%20API&workflow=waiting&lane=for_review&preset=pending');

        $waiting->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.schoolName', 'Review Inbox API Waiting');

        $returned = $this->actingAs($monitor, 'sanctum')
            ->getJson('/api/dashboard/review-inbox?search=Review%20Inbox%20API&lane=returned');

        $returned->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.schoolName', 'Review Inbox API Returned');

        $private = $this->actingAs($monitor, 'sanctum')
            ->getJson('/api/dashboard/review-inbox?search=Review%20Inbox%20API&sector=private&level=high_school');

        $private->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.schoolName', 'Review Inbox API Waiting');

        $coverageSchool = $this->createSchool($monitor, '955814', 'Review Inbox API Coverage', 'private', 'Junior High / Senior High', now());

        $juniorHigh = $this->actingAs($monitor, 'sanctum')
            ->getJson('/api/dashboard/review-inbox?search=Review%20Inbox%20API%20Coverage&sector=private&level=junior_high');

        $juniorHigh->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.schoolName', 'Review Inbox API Coverage');

        $seniorHigh = $this->actingAs($monitor, 'sanctum')
            ->getJson('/api/dashboard/review-inbox?school_id=' . $coverageSchool->id . '&level=senior_high');

        $seniorHigh->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.schoolName', 'Review Inbox API Coverage');

        $schoolScoped = $this->actingAs($monitor, 'sanctum')
            ->getJson('/api/dashboard/review-inbox?school_id=' . $schools['missing']->id);

        $schoolScoped->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.schoolName', 'Review Inbox API Missing');

        $wrongYear = AcademicYear::query()->create([
            'name' => '2030-2031',
            'start_date' => now()->addYears(4)->startOfYear()->toDateString(),
            'end_date' => now()->addYears(5)->startOfYear()->subDay()->toDateString(),
            'is_current' => false,
        ]);

        $yearScoped = $this->actingAs($monitor, 'sanctum')
            ->getJson('/api/dashboard/review-inbox?search=Review%20Inbox%20API&academic_year_id=' . $wrongYear->id);

        $yearScoped->assertOk()
            ->assertJsonPath('meta.total', 5)
            ->assertJsonPath('data.0.indicatorStatus', null);

        $currentYearScoped = $this->actingAs($monitor, 'sanctum')
            ->getJson('/api/dashboard/review-inbox?search=Review%20Inbox%20API&academic_year_id=' . $academicYear->id);

        $currentYearScoped->assertOk()
            ->assertJsonPath('meta.total', 5)
            ->assertJsonPath('data.0.indicatorStatus', FormSubmissionStatus::RETURNED->value);
    }

    public function test_review_inbox_rejects_invalid_filter_values(): void
    {
        $this->seed();

        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();

        $this->actingAs($monitor, 'sanctum')
            ->getJson('/api/dashboard/review-inbox?workflow=archived&per_page=500')
            ->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['workflow', 'per_page']);
    }

    /**
     * @return array{0: User, 1: AcademicYear, 2: array<string, School>}
     */
    private function seedReviewInboxFixture(): array
    {
        $this->seed();

        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();
        /** @var AcademicYear $academicYear */
        $academicYear = AcademicYear::query()->where('is_current', true)->firstOrFail();

        $returned = $this->createSchool($monitor, '955810', 'Review Inbox API Returned', 'public', 'Elementary', now()->subDay());
        $missing = $this->createSchool($monitor, '955811', 'Review Inbox API Missing', 'public', 'Elementary', now()->subHours(3));
        $waiting = $this->createSchool($monitor, '955812', 'Review Inbox API Waiting', 'private', 'High School', now()->subHours(2));
        $validated = $this->createSchool($monitor, '955813', 'Review Inbox API Validated', 'public', 'Elementary', now()->subHours(1));

        $this->createSubmission($returned, $monitor, $academicYear, FormSubmissionStatus::RETURNED->value, now()->subMinutes(30));
        $this->createSubmission($waiting, $monitor, $academicYear, FormSubmissionStatus::SUBMITTED->value, now()->subMinutes(20));
        $this->createSubmission($validated, $monitor, $academicYear, FormSubmissionStatus::VALIDATED->value, now()->subMinutes(10));

        return [$monitor, $academicYear, [
            'returned' => $returned,
            'missing' => $missing,
            'waiting' => $waiting,
            'validated' => $validated,
        ]];
    }

    private function createSchool(
        User $monitor,
        string $code,
        string $name,
        string $type,
        string $level,
        \DateTimeInterface $submittedAt,
    ): School {
        return School::query()->create([
            'school_code' => $code,
            'name' => $name,
            'level' => $level,
            'district' => 'Review Inbox District',
            'address' => 'Review Inbox District, Region Test',
            'region' => 'Region Test',
            'type' => $type,
            'status' => 'active',
            'reported_student_count' => 10,
            'reported_teacher_count' => 2,
            'submitted_by' => $monitor->id,
            'submitted_at' => $submittedAt,
            'created_at' => $submittedAt,
            'updated_at' => $submittedAt,
        ]);
    }

    private function createSubmission(
        School $school,
        User $monitor,
        AcademicYear $academicYear,
        string $status,
        \DateTimeInterface $updatedAt,
    ): IndicatorSubmission {
        return IndicatorSubmission::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $academicYear->id,
            'reporting_period' => 'ANNUAL',
            'version' => 1,
            'status' => $status,
            'created_by' => $monitor->id,
            'submitted_by' => $monitor->id,
            'submitted_at' => $status === FormSubmissionStatus::SUBMITTED->value ? $updatedAt : now()->subDays(2),
            'reviewed_by' => in_array($status, [FormSubmissionStatus::RETURNED->value, FormSubmissionStatus::VALIDATED->value], true)
                ? $monitor->id
                : null,
            'reviewed_at' => in_array($status, [FormSubmissionStatus::RETURNED->value, FormSubmissionStatus::VALIDATED->value], true)
                ? $updatedAt
                : null,
            'created_at' => now()->subDays(3),
            'updated_at' => $updatedAt,
        ]);
    }
}
