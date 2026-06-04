<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\School;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Symfony\Component\HttpFoundation\Response;
use Tests\Concerns\InteractsWithSeededCredentials;
use Tests\TestCase;

class SchoolRecordBulkImportTest extends TestCase
{
    use InteractsWithSeededCredentials;
    use RefreshDatabase;

    public function test_bulk_import_rejects_duplicate_school_codes_in_same_batch(): void
    {
        $this->seed();

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $response = $this->withToken($token)->postJson('/api/dashboard/records/bulk-import', [
            'rows' => [
                [
                    'schoolId' => '955551',
                    'schoolName' => 'Duplicate One',
                    'level' => 'Secondary',
                    'type' => 'public',
                    'address' => 'District 1',
                    'district' => 'District A',
                    'region' => 'Region II',
                    'status' => 'active',
                ],
                [
                    'schoolId' => '955551',
                    'schoolName' => 'Duplicate Two',
                    'level' => 'Secondary',
                    'type' => 'public',
                    'address' => 'District 2',
                    'district' => 'District B',
                    'region' => 'Region II',
                    'status' => 'active',
                ],
            ],
        ]);

        $response->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY);

        $errors = (array) $response->json('errors', []);
        $schoolIdErrorKeys = array_values(array_filter(
            array_keys($errors),
            static fn (string $key): bool => str_starts_with($key, 'rows.') && str_ends_with($key, '.schoolId'),
        ));

        $this->assertNotEmpty($schoolIdErrorKeys);

        $messages = [];
        foreach ($schoolIdErrorKeys as $key) {
            $messages = [...$messages, ...((array) ($errors[$key] ?? []))];
        }

        $this->assertContains('Duplicate school code detected in the import batch.', $messages);
    }

    public function test_bulk_import_creates_school_from_school_only_payload(): void
    {
        $this->seed();

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $response = $this->withToken($token)->postJson('/api/dashboard/records/bulk-import', [
            'rows' => [
                $this->schoolRow([
                    'schoolId' => '955552',
                    'schoolName' => 'School Only Import',
                    'level' => 'secondary',
                    'type' => 'private',
                ]),
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('data.created', 1)
            ->assertJsonPath('data.updated', 0)
            ->assertJsonPath('data.restored', 0)
            ->assertJsonPath('data.skipped', 0)
            ->assertJsonPath('data.failed', 0);

        $school = School::query()->where('school_code', '955552')->firstOrFail();
        $this->assertSame('School Only Import', $school->name);
        $this->assertSame('High School', $school->level);
        $this->assertSame('private', $school->type);
        $this->assertSame(0, (int) $school->reported_student_count);
        $this->assertSame(0, (int) $school->reported_teacher_count);

        $audit = AuditLog::query()->where('action', 'school.bulk_imported')->latest('id')->firstOrFail();
        $this->assertSame(1, data_get($audit->metadata, 'created'));
        $this->assertSame('955552', data_get($audit->metadata, 'schools.0.school_id'));
        $this->assertArrayNotHasKey('rows', $audit->metadata ?? []);
    }

    public function test_bulk_import_updates_existing_school_without_overwriting_counts(): void
    {
        $this->seed();

        $school = School::query()->create([
            'school_code' => '955553',
            'name' => 'Original School',
            'level' => 'Elementary',
            'type' => 'public',
            'address' => 'Original Address',
            'district' => 'Original District',
            'region' => 'Original Region',
            'status' => 'active',
            'reported_student_count' => 321,
            'reported_teacher_count' => 27,
        ]);

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $response = $this->withToken($token)->postJson('/api/dashboard/records/bulk-import', [
            'rows' => [
                $this->schoolRow([
                    'schoolId' => '955553',
                    'schoolName' => 'Updated School',
                    'level' => 'high school',
                    'type' => 'private',
                    'address' => 'Updated Address',
                ]),
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('data.created', 0)
            ->assertJsonPath('data.updated', 1);

        $school->refresh();
        $this->assertSame('Updated School', $school->name);
        $this->assertSame('High School', $school->level);
        $this->assertSame('private', $school->type);
        $this->assertSame('Updated Address', $school->address);
        $this->assertSame(321, (int) $school->reported_student_count);
        $this->assertSame(27, (int) $school->reported_teacher_count);
    }

    public function test_bulk_import_skips_existing_school_when_updates_are_disabled(): void
    {
        $this->seed();

        $school = School::query()->create([
            'school_code' => '955554',
            'name' => 'Skip Existing',
            'level' => 'Elementary',
            'type' => 'public',
            'address' => 'Original Address',
            'district' => 'Original District',
            'region' => 'Original Region',
            'status' => 'active',
        ]);

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $response = $this->withToken($token)->postJson('/api/dashboard/records/bulk-import', [
            'rows' => [
                $this->schoolRow([
                    'schoolId' => '955554',
                    'schoolName' => 'Should Not Apply',
                ]),
            ],
            'options' => [
                'updateExisting' => false,
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('data.updated', 0)
            ->assertJsonPath('data.skipped', 1);

        $school->refresh();
        $this->assertSame('Skip Existing', $school->name);
    }

    public function test_bulk_import_restores_archived_school_when_enabled(): void
    {
        $this->seed();

        $school = School::query()->create([
            'school_code' => '955555',
            'name' => 'Archived School',
            'level' => 'Elementary',
            'type' => 'public',
            'address' => 'Original Address',
            'district' => 'Original District',
            'region' => 'Original Region',
            'status' => 'inactive',
        ]);
        $school->delete();

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $response = $this->withToken($token)->postJson('/api/dashboard/records/bulk-import', [
            'rows' => [
                $this->schoolRow([
                    'schoolId' => '955555',
                    'schoolName' => 'Restored School',
                    'status' => 'active',
                ]),
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('data.restored', 1);

        $school = School::withTrashed()->where('school_code', '955555')->firstOrFail();
        $this->assertFalse($school->trashed());
        $this->assertSame('Restored School', $school->name);
        $this->assertSame('active', $school->status);
    }

    public function test_bulk_import_skips_archived_school_when_restore_is_disabled(): void
    {
        $this->seed();

        $school = School::query()->create([
            'school_code' => '955556',
            'name' => 'Archived Skip School',
            'level' => 'Elementary',
            'type' => 'public',
            'address' => 'Original Address',
            'district' => 'Original District',
            'region' => 'Original Region',
            'status' => 'inactive',
        ]);
        $school->delete();

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $response = $this->withToken($token)->postJson('/api/dashboard/records/bulk-import', [
            'rows' => [
                $this->schoolRow([
                    'schoolId' => '955556',
                    'schoolName' => 'Should Not Restore',
                ]),
            ],
            'options' => [
                'restoreArchived' => false,
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('data.restored', 0)
            ->assertJsonPath('data.skipped', 1);

        $school = School::withTrashed()->where('school_code', '955556')->firstOrFail();
        $this->assertTrue($school->trashed());
        $this->assertSame('Archived Skip School', $school->name);
    }

    public function test_bulk_import_rejects_invalid_school_only_values(): void
    {
        $this->seed();

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $response = $this->withToken($token)->postJson('/api/dashboard/records/bulk-import', [
            'rows' => [
                $this->schoolRow([
                    'schoolId' => 'ABC123',
                    'level' => 'college',
                    'type' => 'charter',
                    'status' => 'paused',
                ]),
            ],
        ]);

        $response->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors([
                'rows.0.schoolId',
                'rows.0.level',
                'rows.0.type',
                'rows.0.status',
            ]);
    }

    public function test_school_head_cannot_bulk_import_school_records(): void
    {
        $this->seed();

        /** @var User $schoolHead */
        $schoolHead = User::query()->where('email', 'schoolhead1@cspams.local')->firstOrFail();
        $token = $schoolHead->createToken('school-head-bulk-import-test')->plainTextToken;

        $response = $this->withToken($token)->postJson('/api/dashboard/records/bulk-import', [
            'rows' => [
                $this->schoolRow(['schoolId' => '955557']),
            ],
        ]);

        $response->assertForbidden();
    }

    /**
     * @param array<string, mixed> $overrides
     *
     * @return array<string, mixed>
     */
    private function schoolRow(array $overrides = []): array
    {
        return array_merge([
            'schoolId' => '955550',
            'schoolName' => 'CSV Import School',
            'level' => 'Elementary',
            'type' => 'public',
            'address' => 'Santiago City',
            'district' => 'District A',
            'region' => 'Region II',
            'status' => 'active',
        ], $overrides);
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

}

