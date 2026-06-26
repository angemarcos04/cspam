<?php

namespace Tests\Feature;

use App\Models\AcademicYear;
use App\Models\IndicatorSubmission;
use App\Models\Section;
use App\Models\School;
use App\Models\Student;
use App\Models\User;
use App\Support\Domain\StudentStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\InteractsWithSeededCredentials;
use Tests\TestCase;

class MonitorSchoolRecordSummaryTest extends TestCase
{
    use InteractsWithSeededCredentials;
    use RefreshDatabase;

    public function test_monitor_school_summary_prefers_latest_monitor_relevant_submission_over_newer_draft(): void
    {
        $this->seed();

        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();
        /** @var AcademicYear $academicYear */
        $academicYear = AcademicYear::query()->where('is_current', true)->firstOrFail();

        $school = School::query()->create([
            'school_code' => '955501',
            'name' => 'Monitor Summary Test School',
            'level' => 'High School',
            'district' => 'District Test',
            'address' => 'District Test, Region Test',
            'region' => 'Region Test',
            'type' => 'private',
            'status' => 'active',
            'reported_student_count' => 0,
            'reported_teacher_count' => 0,
            'submitted_by' => $monitor->id,
            'submitted_at' => now()->subDay(),
        ]);

        IndicatorSubmission::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $academicYear->id,
            'reporting_period' => 'ANNUAL',
            'version' => 1,
            'status' => 'returned',
            'created_by' => $monitor->id,
            'submitted_by' => $monitor->id,
            'submitted_at' => now()->subDays(3),
            'reviewed_by' => $monitor->id,
            'reviewed_at' => now()->subDays(2),
            'updated_at' => now()->subDays(2),
            'created_at' => now()->subDays(4),
        ]);

        IndicatorSubmission::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $academicYear->id,
            'reporting_period' => 'ANNUAL',
            'version' => 2,
            'status' => 'draft',
            'created_by' => $monitor->id,
            'updated_at' => now()->subHour(),
            'created_at' => now()->subHours(2),
        ]);

        $response = $this->actingAs($monitor, 'sanctum')->getJson('/api/dashboard/records');

        $response->assertOk();

        $record = collect($response->json('data'))
            ->firstWhere('schoolId', '955501');

        $this->assertIsArray($record);
        $this->assertSame('returned', data_get($record, 'indicatorLatest.status'));
    }

    public function test_monitor_school_summary_scopes_related_counts_and_latest_submission_to_selected_year(): void
    {
        $this->seed();

        /** @var User $monitor */
        $monitor = User::query()->where('email', 'cspamsmonitor@gmail.com')->firstOrFail();
        /** @var AcademicYear $selectedYear */
        $selectedYear = AcademicYear::query()->where('is_current', true)->firstOrFail();
        $otherYear = AcademicYear::query()->create([
            'name' => '2099-2100',
            'start_date' => '2099-06-01',
            'end_date' => '2100-03-31',
            'is_current' => false,
        ]);

        $school = School::query()->create([
            'school_code' => '955502',
            'name' => 'Year Scoped Summary School',
            'level' => 'High School',
            'district' => 'District Test',
            'address' => 'District Test, Region Test',
            'region' => 'Region Test',
            'type' => 'public',
            'status' => 'active',
            'reported_student_count' => 99,
            'reported_teacher_count' => 10,
            'submitted_by' => $monitor->id,
            'submitted_at' => now()->subDay(),
        ]);

        $selectedSection = Section::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $selectedYear->id,
            'name' => 'Selected Year Section',
            'grade_level' => 'Grade 6',
            'status' => 'active',
        ]);

        $otherSection = Section::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $otherYear->id,
            'name' => 'Other Year Section',
            'grade_level' => 'Grade 6',
            'status' => 'active',
        ]);

        Student::query()->create([
            'school_id' => $school->id,
            'section_id' => $selectedSection->id,
            'academic_year_id' => $selectedYear->id,
            'lrn' => '955502000001',
            'first_name' => 'Selected',
            'last_name' => 'Learner One',
            'status' => StudentStatus::ENROLLED->value,
        ]);

        Student::query()->create([
            'school_id' => $school->id,
            'section_id' => $selectedSection->id,
            'academic_year_id' => $selectedYear->id,
            'lrn' => '955502000002',
            'first_name' => 'Selected',
            'last_name' => 'Learner Two',
            'status' => StudentStatus::DROPPED_OUT->value,
        ]);

        foreach (range(1, 3) as $index) {
            Student::query()->create([
                'school_id' => $school->id,
                'section_id' => $otherSection->id,
                'academic_year_id' => $otherYear->id,
                'lrn' => '95550210000' . $index,
                'first_name' => 'Other',
                'last_name' => 'Learner ' . $index,
                'status' => StudentStatus::ENROLLED->value,
            ]);
        }

        IndicatorSubmission::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $selectedYear->id,
            'reporting_period' => 'ANNUAL',
            'version' => 1,
            'status' => 'submitted',
            'created_by' => $monitor->id,
            'submitted_by' => $monitor->id,
            'submitted_at' => now()->subDays(3),
            'updated_at' => now()->subDays(3),
            'created_at' => now()->subDays(4),
        ]);

        IndicatorSubmission::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $otherYear->id,
            'reporting_period' => 'ANNUAL',
            'version' => 2,
            'status' => 'returned',
            'created_by' => $monitor->id,
            'submitted_by' => $monitor->id,
            'submitted_at' => now()->subDay(),
            'reviewed_by' => $monitor->id,
            'reviewed_at' => now(),
            'updated_at' => now(),
            'created_at' => now()->subDays(2),
        ]);

        $response = $this->actingAs($monitor, 'sanctum')->getJson(
            '/api/dashboard/records?academic_year_id=' . $selectedYear->id . '&search=Year%20Scoped%20Summary%20School',
        );

        $response->assertOk()
            ->assertJsonPath('meta.targetsMet.schoolsMonitored', 1)
            ->assertJsonPath('meta.targetsMet.trackedLearners', 2)
            ->assertJsonPath('meta.targetsMet.dropoutLearners', 1);

        $record = collect($response->json('data'))
            ->firstWhere('schoolId', '955502');

        $this->assertIsArray($record);
        $this->assertSame(2, data_get($record, 'studentCount'));
        $this->assertSame('submitted', data_get($record, 'indicatorLatest.status'));
    }
}
