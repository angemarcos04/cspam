<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\School;
use App\Models\User;
use App\Support\Auth\UserRoleResolver;
use App\Support\Domain\AccountStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Symfony\Component\HttpFoundation\Response;
use Tests\Concerns\InteractsWithSeededCredentials;
use Tests\TestCase;

class SchoolRecordBulkImportTest extends TestCase
{
    use InteractsWithSeededCredentials;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('app.key', 'base64:'.base64_encode(str_repeat('a', 32)));
    }

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
            ->assertJsonPath('data.failed', 0)
            ->assertJsonPath('data.accounts.created', 0)
            ->assertJsonPath('data.accounts.none', 1);

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

    public function test_bulk_import_accepts_canonical_and_alias_school_coverage_values(): void
    {
        $this->seed();

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $response = $this->withToken($token)->postJson('/api/dashboard/records/bulk-import', [
            'rows' => [
                $this->schoolRow([
                    'schoolId' => '955563',
                    'schoolName' => 'CSV Coverage Canonical',
                    'level' => 'Senior High / Elementary',
                ]),
                $this->schoolRow([
                    'schoolId' => '955564',
                    'schoolName' => 'CSV Coverage Alias',
                    'level' => 'jhs + shs',
                ]),
                $this->schoolRow([
                    'schoolId' => '955565',
                    'schoolName' => 'CSV Coverage Alternate Column',
                    'level' => null,
                    'schoolCoverage' => 'elem | junior high school',
                ]),
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('data.created', 3);

        $this->assertSame('Elementary / Senior High', School::query()->where('school_code', '955563')->firstOrFail()->level);
        $this->assertSame('Junior High / Senior High', School::query()->where('school_code', '955564')->firstOrFail()->level);
        $this->assertSame('Elementary / Junior High', School::query()->where('school_code', '955565')->firstOrFail()->level);
    }

    public function test_bulk_import_rejects_invalid_mixed_school_coverage_values(): void
    {
        $this->seed();

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $response = $this->withToken($token)->postJson('/api/dashboard/records/bulk-import', [
            'rows' => [
                $this->schoolRow([
                    'schoolId' => '955566',
                    'schoolName' => 'Invalid Unknown Coverage',
                    'level' => 'Elementary / Integrated',
                ]),
                $this->schoolRow([
                    'schoolId' => '955567',
                    'schoolName' => 'Invalid Unknown Junior Coverage',
                    'level' => 'Junior High / Unknown',
                ]),
                $this->schoolRow([
                    'schoolId' => '955568',
                    'schoolName' => 'Invalid Legacy Junior Coverage',
                    'level' => 'High School / Junior High',
                ]),
                $this->schoolRow([
                    'schoolId' => '955569',
                    'schoolName' => 'Invalid Legacy Senior Coverage',
                    'level' => 'Secondary / Senior High',
                ]),
            ],
        ]);

        $response->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors([
                'rows.0.level',
                'rows.1.level',
                'rows.2.level',
                'rows.3.level',
            ]);
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

    public function test_bulk_import_rejects_partial_school_head_account_columns(): void
    {
        $this->seed();

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $response = $this->withToken($token)->postJson('/api/dashboard/records/bulk-import', [
            'rows' => [
                $this->schoolRow([
                    'schoolId' => '955557',
                    'schoolHeadName' => 'Head Without Email',
                ]),
            ],
        ]);

        $response->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY)
            ->assertJsonValidationErrors(['rows.0.schoolHeadEmail']);
    }

    public function test_bulk_import_creates_school_head_account_with_temporary_password(): void
    {
        $this->seed();

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $response = $this->withToken($token)->postJson('/api/dashboard/records/bulk-import', [
            'rows' => [
                $this->schoolRow([
                    'schoolId' => '955558',
                    'schoolName' => 'CSV Account School',
                    'schoolHeadName' => 'CSV School Head',
                    'schoolHeadEmail' => 'csv.head@example.com',
                ]),
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('data.created', 1)
            ->assertJsonPath('data.accounts.created', 1)
            ->assertJsonPath('data.results.0.accountAction', 'created')
            ->assertJsonPath('data.results.0.schoolHeadEmail', 'csv.head@example.com');

        $temporaryPassword = (string) $response->json('data.results.0.temporaryPassword');
        $this->assertMatchesRegularExpression('/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{8}$/', $temporaryPassword);

        $school = School::query()->where('school_code', '955558')->firstOrFail();
        $account = User::query()->where('email', 'csv.head@example.com')->firstOrFail();
        $this->assertSame($school->id, $account->school_id);
        $this->assertSame(AccountStatus::ACTIVE->value, $account->accountStatus()->value);
        $this->assertTrue((bool) $account->must_reset_password);
        $this->assertTrue(Hash::check($temporaryPassword, (string) $account->password));
        $this->assertSame($temporaryPassword, $account->temporary_password_display);
        $this->assertTrue($account->hasRole(UserRoleResolver::SCHOOL_HEAD));

        $audit = AuditLog::query()->where('action', 'school.bulk_imported')->latest('id')->firstOrFail();
        $this->assertSame(1, data_get($audit->metadata, 'accounts.created'));
        $this->assertSame('created', data_get($audit->metadata, 'schools.0.account_action'));
        $this->assertStringNotContainsString($temporaryPassword, json_encode($audit->metadata, JSON_THROW_ON_ERROR));
    }

    public function test_bulk_import_creates_account_for_existing_school_without_account(): void
    {
        $this->seed();

        $school = School::query()->create([
            'school_code' => '955559',
            'name' => 'Existing No Account',
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
                    'schoolId' => '955559',
                    'schoolHeadName' => 'Existing CSV Head',
                    'schoolHeadEmail' => 'existing.csv.head@example.com',
                ]),
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('data.updated', 1)
            ->assertJsonPath('data.accounts.created', 1)
            ->assertJsonPath('data.results.0.accountAction', 'created');

        $account = User::query()->where('email', 'existing.csv.head@example.com')->firstOrFail();
        $this->assertSame($school->id, $account->school_id);
        $this->assertNotEmpty($response->json('data.results.0.temporaryPassword'));
    }

    public function test_bulk_import_does_not_update_existing_school_head_account(): void
    {
        $this->seed();

        $school = School::query()->create([
            'school_code' => '955560',
            'name' => 'Existing Account School',
            'level' => 'Elementary',
            'type' => 'public',
            'address' => 'Original Address',
            'district' => 'Original District',
            'region' => 'Original Region',
            'status' => 'active',
        ]);
        $account = $this->createSchoolHeadForSchool($school, 'Original Head', 'original.head@example.com');

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $response = $this->withToken($token)->postJson('/api/dashboard/records/bulk-import', [
            'rows' => [
                $this->schoolRow([
                    'schoolId' => '955560',
                    'schoolHeadName' => 'Changed Head',
                    'schoolHeadEmail' => 'changed.head@example.com',
                ]),
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('data.accounts.skippedExistingAccount', 1)
            ->assertJsonPath('data.results.0.accountAction', 'skipped_existing_account')
            ->assertJsonPath('data.results.0.schoolHeadEmail', 'original.head@example.com');

        $this->assertNotEmpty($response->json('data.results.0.warning'));
        $account->refresh();
        $this->assertSame('Original Head', $account->name);
        $this->assertSame('original.head@example.com', $account->email);
        $this->assertNull($response->json('data.results.0.temporaryPassword'));
    }

    public function test_bulk_import_returns_account_warning_for_duplicate_email(): void
    {
        $this->seed();

        $otherSchool = School::query()->create([
            'school_code' => '955561',
            'name' => 'Other School',
            'level' => 'Elementary',
            'type' => 'public',
            'address' => 'Other Address',
            'district' => 'Other District',
            'region' => 'Other Region',
            'status' => 'active',
        ]);
        $this->createSchoolHeadForSchool($otherSchool, 'Used Email Head', 'used.email@example.com');

        $token = $this->loginToken('monitor', 'cspamsmonitor@gmail.com');

        $response = $this->withToken($token)->postJson('/api/dashboard/records/bulk-import', [
            'rows' => [
                $this->schoolRow([
                    'schoolId' => '955562',
                    'schoolName' => 'Duplicate Email Target',
                    'schoolHeadName' => 'Duplicate Email Head',
                    'schoolHeadEmail' => 'used.email@example.com',
                ]),
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('data.created', 1)
            ->assertJsonPath('data.accounts.failed', 1)
            ->assertJsonPath('data.results.0.accountAction', 'failed')
            ->assertJsonPath('data.results.0.schoolHeadEmail', 'used.email@example.com');

        $this->assertNotEmpty($response->json('data.results.0.warning'));
        $this->assertDatabaseMissing('users', [
            'school_id' => School::query()->where('school_code', '955562')->firstOrFail()->id,
            'email' => 'used.email@example.com',
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

    private function createSchoolHeadForSchool(School $school, string $name, string $email): User
    {
        $account = new User();
        $account->name = $name;
        $account->email = $email;
        $account->password = Hash::make('TempPass123!');
        $account->must_reset_password = false;
        $account->account_status = AccountStatus::ACTIVE->value;
        $account->school_id = $school->id;
        $account->email_verified_at = now();
        $account->account_type = UserRoleResolver::SCHOOL_HEAD;
        $account->save();
        $account->assignRole(UserRoleResolver::SCHOOL_HEAD);

        return $account;
    }

}

