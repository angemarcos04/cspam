<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\FmQadTemplateVersionResource;
use App\Models\AcademicYear;
use App\Models\FmQadForm;
use App\Models\FmQadTemplateDownloadGrant;
use App\Models\FmQadTemplateVersion;
use App\Models\IndicatorSubmissionFile;
use App\Support\Auth\UserRoleResolver;
use App\Support\FmQad\FmQadTemplateStorage;
use App\Support\FmQad\FmQadTemplateVersionManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class FmQadTemplateController extends Controller
{
    public function index(Request $request, FmQadTemplateVersionManager $manager): JsonResponse
    {
        $user = $request->user();
        $isMonitor = UserRoleResolver::has($user, UserRoleResolver::MONITOR);
        $isSchoolHead = UserRoleResolver::has($user, UserRoleResolver::SCHOOL_HEAD);
        if (! $isMonitor && ! $isSchoolHead) {
            abort(Response::HTTP_FORBIDDEN);
        }
        if ($isSchoolHead && strtolower(trim((string) $user?->school?->type)) !== 'private') {
            return response()->json(['data' => []]);
        }

        $academicYearId = $request->filled('academic_year_id') ? (int) $request->query('academic_year_id') : null;
        $forms = FmQadForm::query()->enabled()->orderBy('sort_order')->get();
        $data = $forms->map(function (FmQadForm $form) use ($manager, $academicYearId, $request): array {
            $version = $manager->effective($form, $academicYearId);

            return [
                'id' => (string) $form->id,
                'scopeId' => $form->scope_id,
                'code' => $form->code,
                'name' => $form->name,
                'activeVersion' => $version ? (new FmQadTemplateVersionResource($version))->toArray($request) : null,
            ];
        })->values();

        return response()->json(['data' => $data]);
    }

    public function download(Request $request, FmQadTemplateVersion $version, FmQadTemplateVersionManager $manager, FmQadTemplateStorage $storage)
    {
        $user = $request->user();
        $isMonitor = UserRoleResolver::has($user, UserRoleResolver::MONITOR);
        $isSchoolHead = UserRoleResolver::has($user, UserRoleResolver::SCHOOL_HEAD);
        abort_unless($isMonitor || $isSchoolHead, Response::HTTP_FORBIDDEN);

        if ($isSchoolHead && strtolower(trim((string) $user?->school?->type)) !== 'private') {
            abort(Response::HTTP_FORBIDDEN, 'FM-QAD templates are available only to private schools.');
        }

        $grant = null;
        $grantAttributes = null;
        $allowed = $isMonitor;
        if (! $allowed && $isSchoolHead) {
            $academicYearId = (int) $request->validate([
                'academic_year_id' => ['required', 'integer', 'exists:academic_years,id'],
            ])['academic_year_id'];
            AcademicYear::query()->findOrFail($academicYearId);
            $effective = $manager->effective($version->form, $academicYearId);
            $ownedHistorical = IndicatorSubmissionFile::query()
                ->where('fm_qad_template_version_id', $version->id)
                ->whereHas('submission', fn ($query) => $query
                    ->where('school_id', $user->school_id)
                    ->where('academic_year_id', $academicYearId))
                ->exists();
            $allowed = (int) ($effective?->id ?? 0) === (int) $version->id || $ownedHistorical;
            if ((int) ($effective?->id ?? 0) === (int) $version->id) {
                $grantAttributes = [
                    'school_id' => $user->school_id,
                    'user_id' => $user->id,
                    'academic_year_id' => $academicYearId,
                    'fm_qad_form_id' => $version->fm_qad_form_id,
                    'fm_qad_template_version_id' => $version->id,
                ];
            }
        }
        if (! $allowed) {
            abort(Response::HTTP_FORBIDDEN, 'You are not allowed to download this template revision.');
        }
        $content = $storage->content($version);
        abort_if($content === '' || hash('sha256', $content) !== $version->sha256_hash, 500, 'Template storage integrity check failed.');
        if ($grantAttributes) {
            $grant = FmQadTemplateDownloadGrant::query()->updateOrCreate($grantAttributes, ['downloaded_at' => now()]);
        }
        $filename = str_replace(['"', "\r", "\n"], '-', basename($version->original_filename));
        $headers = [
            'Content-Type' => $version->mime_type,
            'Content-Length' => (string) strlen($content),
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
            'X-Content-Type-Options' => 'nosniff',
            'X-CSPAMS-FM-QAD-Version-Id' => (string) $version->id,
            'X-CSPAMS-FM-QAD-Revision' => $version->revision_label,
        ];
        if ($grant) {
            $headers['X-CSPAMS-FM-QAD-Download-Grant-Id'] = (string) $grant->id;
        }

        return response($content, 200, $headers);
    }
}
