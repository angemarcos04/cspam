<?php

namespace Tests\Unit;

use App\Support\Schools\SchoolCoverage;
use PHPUnit\Framework\TestCase;

class SchoolCoverageTest extends TestCase
{
    public function test_it_normalizes_valid_school_coverage_values(): void
    {
        $this->assertSame('Kindergarten', SchoolCoverage::normalize('Kinder'));
        $this->assertSame('Kindergarten', SchoolCoverage::normalize('KINDERGARTEN'));
        $this->assertSame('Kindergarten', SchoolCoverage::normalize('kindergarten-school'));
        $this->assertSame('Kindergarten / Elementary', SchoolCoverage::normalize('Elementary / Kinder'));
        $this->assertSame('Kindergarten / Senior High', SchoolCoverage::normalize('Senior High / Kindergarten'));
        $this->assertSame(
            'Kindergarten / Elementary / Junior High / Senior High',
            SchoolCoverage::normalize('SHS / Kindergarten / Elementary / JHS / Kinder'),
        );
        $this->assertSame('Elementary / Senior High', SchoolCoverage::normalize('Senior High / Elementary'));
        $this->assertSame('Junior High / Senior High', SchoolCoverage::normalize('jhs + shs'));
        $this->assertSame('Elementary / Junior High', SchoolCoverage::normalize('elem | junior high school'));
        $this->assertSame('High School', SchoolCoverage::normalize('secondary'));
        $this->assertSame(['kindergarten'], SchoolCoverage::parse('Kinder')['tokens']);
        $this->assertTrue(SchoolCoverage::hasToken('Kindergarten / Elementary', 'kindergarten'));
        $this->assertFalse(SchoolCoverage::hasToken('Elementary', 'kindergarten'));
        $this->assertContains('Kindergarten / Elementary / Junior High / Senior High', SchoolCoverage::CANONICAL_VALUES);
    }

    public function test_it_rejects_unknown_and_mixed_legacy_coverage_values(): void
    {
        $this->assertNull(SchoolCoverage::normalize('Elementary / Integrated'));
        $this->assertNull(SchoolCoverage::normalize('Junior High / Unknown'));
        $this->assertNull(SchoolCoverage::normalize('High School / Junior High'));
        $this->assertNull(SchoolCoverage::normalize('Secondary / Senior High'));
        $this->assertNull(SchoolCoverage::normalize('Kindergarten / High School'));
        $this->assertNull(SchoolCoverage::normalize('Nursery'));
        $this->assertNull(SchoolCoverage::normalize('Preschool'));
        $this->assertNull(SchoolCoverage::normalize('Kinder School Level 1'));
        $this->assertNull(SchoolCoverage::normalize('Unknown'));
    }
}
