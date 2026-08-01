<?php

namespace App\Support\FmQad;

use App\Models\FmQadForm;
use App\Models\FmQadTemplateVersion;
use Database\Seeders\FmQadFormSeeder;
use Illuminate\Http\UploadedFile;

class LegacyFmQadTemplateImporter
{
    public function __construct(private readonly FmQadDocxValidator $validator, private readonly FmQadTemplateVersionManager $manager) {}

    /** @return array<string,mixed> */
    public function run(bool $dryRun = false, ?string $scopeId = null, bool $force = false): array
    {
        if (! $dryRun) {
            app(FmQadFormSeeder::class)->run();
            $preflight = $this->run(true, $scopeId, $force);
            if ($preflight['labelConflicts'] !== []) {
                return [
                    'checked' => $preflight['checked'],
                    'imported' => 0,
                    'skipped' => $preflight['wouldSkip'],
                    'reactivated' => 0,
                    'inactiveExisting' => $preflight['inactiveExisting'],
                    'labelConflicts' => $preflight['labelConflicts'],
                    'missingCatalog' => $preflight['missingCatalog'],
                    'missing' => $preflight['missing'],
                    'invalid' => $preflight['invalid'],
                ];
            }
        }
        $result = $dryRun
            ? ['checked' => 0, 'wouldImport' => 0, 'wouldSkip' => 0, 'wouldReactivate' => 0, 'inactiveExisting' => [], 'labelConflicts' => [], 'missingCatalog' => [], 'missing' => [], 'invalid' => []]
            : ['checked' => 0, 'imported' => 0, 'skipped' => 0, 'reactivated' => 0, 'inactiveExisting' => [], 'labelConflicts' => [], 'missingCatalog' => [], 'missing' => [], 'invalid' => []];
        foreach (config('fm_qad.forms', []) as $definition) {
            if ($scopeId && $definition['scope_id'] !== $scopeId) {
                continue;
            }
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
            $form = FmQadForm::query()->where('scope_id', $definition['scope_id'])->first();
            if (! $form && $dryRun) {
                $result['missingCatalog'][] = $definition['scope_id'];

                continue;
            }
            $existing = $form?->versions()->where('sha256_hash', $validated['sha256'])->first();
            if ($existing) {
                if ($existing->status === FmQadTemplateVersion::ACTIVE) {
                    $result[$dryRun ? 'wouldSkip' : 'skipped']++;

                    continue;
                }
                if ($force) {
                    if ($dryRun) {
                        $result['wouldReactivate']++;

                        continue;
                    }
                    $this->manager->activate($existing, null);
                    $result['reactivated']++;

                    continue;
                }
                $result['inactiveExisting'][] = $definition['scope_id'].':'.$existing->status;

                continue;
            }
            $label = trim(preg_replace('/\s+/', ' ', (string) ($definition['revision_label'] ?? 'Initial Version')) ?? '');
            $labelConflict = $form?->versions()
                ->where('normalized_revision_label', mb_strtolower($label))
                ->first();
            if ($labelConflict) {
                $result['labelConflicts'][] = [
                    'scopeId' => $definition['scope_id'],
                    'revisionLabel' => $label,
                    'existingVersionId' => (string) $labelConflict->id,
                    'existingStatus' => $labelConflict->status,
                ];

                continue;
            }
            if ($dryRun) {
                $result['wouldImport']++;

                continue;
            }
            $form ??= FmQadForm::query()->where('scope_id', $definition['scope_id'])->firstOrFail();
            $file = new UploadedFile($path, basename($path), $validated['mime_type'], null, true);
            $this->manager->importAndActivateBaseline($form, $file, [
                'revision_label' => $definition['revision_label'] ?? 'Initial Version',
                'change_notes' => 'Imported from the original CSPAMS static FM-QAD template library.',
                'internal_note' => 'Legacy template import',
            ]);
            $result['imported']++;
        }

        return $result;
    }
}
