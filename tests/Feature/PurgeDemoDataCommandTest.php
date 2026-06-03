<?php

namespace Tests\Feature;

use App\Models\School;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class PurgeDemoDataCommandTest extends TestCase
{
    use RefreshDatabase;

    public function test_purge_demo_data_requires_force(): void
    {
        $this->makeUser('schoolhead2@cspams.local');

        $this->artisan('cspams:purge-demo-data')
            ->expectsOutput('Refusing to purge demo data without --force.')
            ->assertFailed();

        $this->assertDatabaseHas('users', ['email' => 'schoolhead2@cspams.local']);
    }

    public function test_purge_demo_data_deletes_only_known_demo_school_heads(): void
    {
        $demoSchool = $this->makeSchool('900002');
        $demoHead = $this->makeUser('schoolhead2@cspams.local', $demoSchool);
        $demoSchool->forceFill([
            'submitted_by' => $demoHead->id,
            'submitted_at' => now(),
        ])->save();

        $realSchool = $this->makeSchool('123456');
        $realHead = $this->makeUser('principal@example.test', $realSchool);
        $realSchool->forceFill([
            'submitted_by' => $realHead->id,
            'submitted_at' => now(),
        ])->save();

        $this->artisan('cspams:purge-demo-data --force')
            ->expectsOutput('Demo data purge completed.')
            ->expectsOutput('  deleted_school_head_users: 1')
            ->expectsOutput('  monitor_account_deleted: no')
            ->assertSuccessful();

        $this->assertDatabaseMissing('users', ['email' => 'schoolhead2@cspams.local']);
        $this->assertDatabaseHas('users', ['email' => 'principal@example.test']);
        $this->assertDatabaseHas('schools', [
            'school_code' => '900002',
            'submitted_by' => null,
            'submitted_at' => null,
        ]);
        $this->assertDatabaseHas('schools', [
            'school_code' => '123456',
            'submitted_by' => $realHead->id,
        ]);
    }

    public function test_purge_demo_data_can_archive_known_demo_schools_when_explicitly_requested(): void
    {
        $demoSchool = $this->makeSchool('900003');
        $this->makeUser('schoolhead3@cspams.local', $demoSchool);
        $realSchool = $this->makeSchool('654321');

        $this->artisan('cspams:purge-demo-data --force --with-schools')
            ->expectsOutput('Demo data purge completed.')
            ->expectsOutput('  archived_demo_schools: 1')
            ->assertSuccessful();

        $this->assertSoftDeleted('schools', ['id' => $demoSchool->id]);
        $this->assertDatabaseHas('schools', [
            'id' => $realSchool->id,
            'deleted_at' => null,
        ]);
    }

    private function makeSchool(string $schoolCode): School
    {
        return School::query()->create([
            'school_code' => $schoolCode,
            'name' => 'School ' . $schoolCode,
            'district' => 'District',
            'region' => 'Region',
            'type' => 'public',
            'status' => 'active',
        ]);
    }

    private function makeUser(string $email, ?School $school = null): User
    {
        return User::query()->create([
            'name' => 'User ' . $email,
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'school_id' => $school?->id,
        ]);
    }
}
