<?php

namespace App\Support\FmQad;

use App\Models\FmQadForm;
use App\Models\FmQadTemplateVersion;
use Database\Seeders\FmQadFormSeeder;
use Illuminate\Http\UploadedFile;

class LegacyFmQadTemplateImporter
{
    public function __construct(private readonly FmQadDocxValidator $validator, private readonly FmQadTemplateVersionManager $manager) {}

    /** @return array{imported:int, skipped:int, missing:list<string>, invalid:array<string,string>, checked:int} */
    public function run(bool $dryRun = false, ?string $scopeId = null, bool $force = false): array
    {
        if (! $dryRun) {
            app(FmQadFormSeeder::class)->run();
        }
        $result = ['imported' => 0, 'skipped' => 0, 'missing' => [], 'invalid' => [], 'checked' => 0];
        foreach (config('fm_qad.forms', []) as $definition) {
            if ($scopeId && $definition['scope_id'] !== $scopeId) continue;
            $result['checked']++;
            $path = rtrim((string) config('fm_qad.legacy_directory'), DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.$definition['filename'];
            if (! is_file($path)) {
                $result['missing'][] = $definition['scope_id'];
                continue;
            }
            try {
                $validated = $this->validator->validatePath($path);
            } catch (\Throwable $exception) {
                $result['invalid'][$definition['scope_id']] = $exception->getMessage();
                continue;
            }
            if ($dryRun) {
                $result['imported']++;
                continue;
            }
            $form = FmQadForm::query()->where('scope_id', $definition['scope_id'])->firstOrFail();
            $existing = $form->versions()->where('sha256_hash', $validated['sha256'])->first();
            if ($existing) {
                if ($force && ! $dryRun && $existing->status !== FmQadTemplateVersion::ACTIVE) {
                    $this->manager->activate($existing, null);
                }
                $result['skipped']++;
                continue;
            }
            $file = new UploadedFile($path, basename($path), $validated['mime_type'], null, true);
            $this->manager->upload($form, $file, [
                'revision_label' => $definition['revision_label'] ?? 'Initial Version',
                'academic_year_id' => null,
                'change_notes' => 'Imported from the original CSPAMS static FM-QAD template library.',
                'internal_note' => 'Legacy template import',
            ], null, true);
            $result['imported']++;
        }
        return $result;
    }
}
