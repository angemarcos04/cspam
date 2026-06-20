<?php

namespace Tests\Feature;

use App\Models\IndicatorSubmission;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class MonitorReviewE2eFixtureTest extends TestCase
{
    use RefreshDatabase;

    public function test_monitor_review_e2e_fixture_is_verified_before_browser_startup(): void
    {
        Storage::fake('local');

        $this->artisan('e2e:seed-monitor-review')
            ->assertExitCode(0);
        $this->artisan('e2e:verify-monitor-review-fixture')
            ->expectsOutput('Monitor review E2E fixture is ready for Verify and Return scenarios.')
            ->assertExitCode(0);
    }

    public function test_monitor_review_e2e_fixture_verifier_rejects_a_missing_sent_file(): void
    {
        Storage::fake('local');

        $this->artisan('e2e:seed-monitor-review')
            ->assertExitCode(0);
        IndicatorSubmission::query()
            ->whereHas('school', static fn ($query) => $query->where('school_code', '401777'))
            ->firstOrFail()
            ->submissionFiles()
            ->delete();

        $this->artisan('e2e:verify-monitor-review-fixture')
            ->assertExitCode(1);
    }
}
