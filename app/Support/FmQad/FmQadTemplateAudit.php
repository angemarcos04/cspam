<?php

namespace App\Support\FmQad;

use App\Models\AcademicYear;
use App\Models\FmQadForm;
use App\Models\FmQadTemplateDownloadGrant;
use App\Models\FmQadTemplateVersion;
use App\Models\IndicatorSubmission;
use App\Models\IndicatorSubmissionFile;
use App\Support\Indicators\RollingIndicatorYearWindow;

class FmQadTemplateAudit
{
    /** @return array<string,list<string>> */
    public function run(): array
    {
        $issues = [
            'missingForms' => [], 'disabledConfiguredForms' => [], 'unexpectedEnabledForms' => [], 'formsWithoutVersions' => [], 'formsWithoutActiveVersion' => [],
            'academicYearsWithoutEffectiveVersion' => [],
            'duplicateActiveVersions' => [], 'missingBlobs' => [], 'hashMismatch' => [],
            'orphanedVersions' => [], 'brokenSubmissionReferences' => [],
            'invalidAcademicYearReferences' => [], 'invalidFormVersionReferences' => [],
            'invalidDownloadGrants' => [],
        ];
        $configuredScopes = collect(config('fm_qad.forms', []))->pluck('scope_id');
        $existingScopes = FmQadForm::query()->pluck('scope_id');
        $issues['missingForms'] = $configuredScopes->diff($existingScopes)->values()->all();
        $issues['disabledConfiguredForms'] = FmQadForm::query()
            ->whereIn('scope_id', $configuredScopes)
            ->where('is_enabled', false)
            ->orderBy('sort_order')
            ->pluck('scope_id')
            ->all();
        $issues['unexpectedEnabledForms'] = FmQadForm::query()
            ->whereNotIn('scope_id', $configuredScopes)
            ->where('is_enabled', true)
            ->orderBy('scope_id')
            ->pluck('scope_id')
            ->all();
        $relevantAcademicYears = $this->relevantAcademicYears();

        FmQadForm::query()->whereIn('scope_id', $configuredScopes)->with(['versions.blob'])->each(function (FmQadForm $form) use (&$issues, $relevantAcademicYears): void {
            if ($form->versions->isEmpty()) {
                $issues['formsWithoutVersions'][] = $form->scope_id;
            }
            if ($form->versions->where('status', FmQadTemplateVersion::ACTIVE)->isEmpty()) {
                $issues['formsWithoutActiveVersion'][] = $form->scope_id;
            }
            $duplicates = $form->versions->where('status', FmQadTemplateVersion::ACTIVE)->groupBy(fn ($v) => $v->academic_year_id ?? 'baseline')->filter(fn ($group) => $group->count() > 1);
            foreach ($duplicates->keys() as $key) {
                $issues['duplicateActiveVersions'][] = $form->scope_id.':'.$key;
            }
            $activeVersions = $form->versions->where('status', FmQadTemplateVersion::ACTIVE);
            $hasBaseline = $activeVersions->contains(fn (FmQadTemplateVersion $version): bool => $version->academic_year_id === null);
            foreach ($relevantAcademicYears as $academicYear) {
                $hasExact = $activeVersions->contains(
                    fn (FmQadTemplateVersion $version): bool => (int) $version->academic_year_id === (int) $academicYear->id,
                );
                if (! $hasBaseline && ! $hasExact) {
                    $issues['academicYearsWithoutEffectiveVersion'][] = $form->scope_id.':'.$academicYear->id;
                }
            }
            foreach ($form->versions as $version) {
                if (! $version->blob) {
                    $issues['missingBlobs'][] = (string) $version->id;

                    continue;
                }
                $content = app(FmQadTemplateStorage::class)->content($version);
                if (hash('sha256', $content) !== $version->sha256_hash) {
                    $issues['hashMismatch'][] = (string) $version->id;
                }
            }
        });
        $issues['orphanedVersions'] = FmQadTemplateVersion::query()->whereDoesntHave('form')->pluck('id')->map(fn ($id) => (string) $id)->all();
        $issues['brokenSubmissionReferences'] = IndicatorSubmissionFile::query()->whereNotNull('fm_qad_template_version_id')->whereDoesntHave('fmQadTemplateVersion')->pluck('id')->map(fn ($id) => (string) $id)->all();
        $issues['invalidAcademicYearReferences'] = FmQadTemplateVersion::query()
            ->whereNotNull('academic_year_id')->whereDoesntHave('academicYear')
            ->pluck('id')->map(fn ($id) => (string) $id)->all();
        IndicatorSubmissionFile::query()
            ->whereNotNull('fm_qad_template_version_id')
            ->with(['fmQadTemplateVersion.form'])
            ->get()
            ->each(function (IndicatorSubmissionFile $file) use (&$issues): void {
                if ($file->fmQadTemplateVersion?->form?->scope_id !== $file->type) {
                    $issues['invalidFormVersionReferences'][] = (string) $file->id;
                }
            });
        FmQadTemplateDownloadGrant::query()
            ->with(['version', 'form', 'academicYear', 'school', 'user'])
            ->get()
            ->each(function (FmQadTemplateDownloadGrant $grant) use (&$issues): void {
                $invalid = ! $grant->version || ! $grant->form || ! $grant->academicYear || ! $grant->school || ! $grant->user
                    || (int) $grant->version?->fm_qad_form_id !== (int) $grant->fm_qad_form_id
                    || ($grant->version?->academic_year_id !== null
                        && (int) $grant->version->academic_year_id !== (int) $grant->academic_year_id)
                    || ! $grant->downloaded_at
                    || ! $grant->created_at
                    || ! $grant->updated_at;
                if ($invalid) {
                    $issues['invalidDownloadGrants'][] = (string) $grant->id;
                }
            });

        return $issues;
    }

    /** @return \Illuminate\Database\Eloquent\Collection<int, AcademicYear> */
    private function relevantAcademicYears()
    {
        $submissionYearIds = IndicatorSubmission::query()
            ->whereNotNull('academic_year_id')
            ->distinct()
            ->pluck('academic_year_id');
        $rollingYearNames = app(RollingIndicatorYearWindow::class)->windowYears();

        return AcademicYear::query()
            ->where(function ($query) use ($submissionYearIds, $rollingYearNames): void {
                $query->where('is_current', true)
                    ->orWhereIn('id', $submissionYearIds)
                    ->orWhereIn('name', $rollingYearNames);
            })
            ->orderBy('id')
            ->get(['id', 'name']);
    }
}
