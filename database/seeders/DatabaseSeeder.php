<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $seeders = [
            RolesAndPermissionsSeeder::class,
        ];

        if ($this->shouldSeedDemoData()) {
            $seeders[] = DemoDataSeeder::class;
        }

        $seeders[] = SantiagoCitySchoolAccountsSeeder::class;

        $this->call($seeders);
    }

    private function shouldSeedDemoData(): bool
    {
        $default = app()->environment(['production', 'staging']) ? 'false' : 'true';
        $raw = strtolower(trim((string) env('CSPAMS_SEED_DEMO_DATA', $default)));

        return in_array($raw, ['1', 'true', 'yes', 'on'], true);
    }
}
