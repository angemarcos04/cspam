<?php

namespace App\Support\FmQad;

use App\Models\FmQadForm;
use App\Models\FmQadTemplateVersion;
use App\Models\IndicatorSubmissionFile;

class FmQadTemplateAudit
{
    /** @return array<string,list<string>> */
    public function run(): array
    {
        $issues = [
            'missingForms' => [], 'formsWithoutVersions' => [], 'formsWithoutActiveVersion' => [],
            'duplicateActiveVersions' => [], 'missingBlobs' => [], 'hashMismatch' => [],
            'orphanedVersions' => [], 'brokenSubmissionReferences' => [],
        ];
        $configuredScopes = collect(config('fm_qad.forms', []))->pluck('scope_id');
        $existingScopes = FmQadForm::query()->pluck('scope_id');
        $issues['missingForms'] = $configuredScopes->diff($existingScopes)->values()->all();

        FmQadForm::query()->enabled()->with(['versions.blob'])->each(function (FmQadForm $form) use (&$issues): void {
            if ($form->versions->isEmpty()) $issues['formsWithoutVersions'][] = $form->scope_id;
            if ($form->versions->where('status', FmQadTemplateVersion::ACTIVE)->isEmpty()) $issues['formsWithoutActiveVersion'][] = $form->scope_id;
            $duplicates = $form->versions->where('status', FmQadTemplateVersion::ACTIVE)->groupBy(fn ($v) => $v->academic_year_id ?? 'baseline')->filter(fn ($group) => $group->count() > 1);
            foreach ($duplicates->keys() as $key) $issues['duplicateActiveVersions'][] = $form->scope_id.':'.$key;
            foreach ($form->versions as $version) {
                if (! $version->blob) {
                    $issues['missingBlobs'][] = (string) $version->id;
                    continue;
                }
                $content = app(FmQadTemplateStorage::class)->content($version);
                if (hash('sha256', $content) !== $version->sha256_hash) $issues['hashMismatch'][] = (string) $version->id;
            }
        });
        $issues['orphanedVersions'] = FmQadTemplateVersion::query()->whereDoesntHave('form')->pluck('id')->map(fn ($id) => (string) $id)->all();
        $issues['brokenSubmissionReferences'] = IndicatorSubmissionFile::query()->whereNotNull('fm_qad_template_version_id')->whereDoesntHave('fmQadTemplateVersion')->pluck('id')->map(fn ($id) => (string) $id)->all();
        return $issues;
    }
}
