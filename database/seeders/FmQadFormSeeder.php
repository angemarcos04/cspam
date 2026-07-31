<?php

namespace Database\Seeders;

use App\Models\FmQadForm;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class FmQadFormSeeder extends Seeder
{
    public function run(): void
    {
        DB::transaction(function (): void {
            foreach (config('fm_qad.forms', []) as $index => $definition) {
                FmQadForm::query()->updateOrCreate(
                    ['scope_id' => $definition['scope_id']],
                    [
                        'code' => $definition['code'],
                        'name' => $definition['name'],
                        'description' => $definition['description'] ?? null,
                        'sort_order' => $definition['sort_order'] ?? $index + 1,
                        'is_enabled' => true,
                    ],
                );
            }
        });
    }
}
