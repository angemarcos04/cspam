<?php

namespace Tests\Unit;

use App\Support\Schools\SchoolCoverage;
use PHPUnit\Framework\TestCase;

class SchoolCoverageTest extends TestCase
{
    public function test_it_normalizes_valid_school_coverage_values(): void
    {
        $this->assertSame('Elementary / Senior High', SchoolCoverage::normalize('Senior High / Elementary'));
        $this->assertSame('Junior High / Senior High', SchoolCoverage::normalize('jhs + shs'));
        $this->assertSame('Elementary / Junior High', SchoolCoverage::normalize('elem | junior high school'));
        $this->assertSame('High School', SchoolCoverage::normalize('secondary'));
    }

    public function test_it_rejects_unknown_and_mixed_legacy_coverage_values(): void
    {
        $this->assertNull(SchoolCoverage::normalize('Elementary / Integrated'));
        $this->assertNull(SchoolCoverage::normalize('Junior High / Unknown'));
        $this->assertNull(SchoolCoverage::normalize('High School / Junior High'));
        $this->assertNull(SchoolCoverage::normalize('Secondary / Senior High'));
        $this->assertNull(SchoolCoverage::normalize('Unknown'));
    }
}
