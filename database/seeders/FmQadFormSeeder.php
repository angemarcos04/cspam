<?php

namespace Database\Seeders;

use App\Models\FmQadForm;
use Illuminate\Database\Seeder;

class FmQadFormSeeder extends Seeder
{
    public function run(): void
    {
        foreach (config('fm_qad.forms', []) as $index => $definition) {
            FmQadForm::query()->updateOrCreate(
                ['scope_id' => $definition['scope_id']],
                [
                    'code' => $definition['code'],
                    'name' => $definition['name'],
                    'sort_order' => $index + 1,
                    'is_enabled' => true,
                ],
            );
        }
    }
}
