<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\FmQadTemplateVersionResource;
use App\Models\FmQadForm;
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
        if (! $isMonitor && ! $isSchoolHead) abort(Response::HTTP_FORBIDDEN);
        if ($isSchoolHead && strtolower((string) $user?->school?->type) !== 'private') {
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
        $allowed = UserRoleResolver::has($user, UserRoleResolver::MONITOR);
        if (! $allowed && UserRoleResolver::has($user, UserRoleResolver::SCHOOL_HEAD)) {
            $effective = $manager->effective($version->form, $version->academic_year_id ? (int) $version->academic_year_id : null);
            $ownedHistorical = IndicatorSubmissionFile::query()
                ->where('fm_qad_template_version_id', $version->id)
                ->whereHas('submission', fn ($query) => $query->where('school_id', $user->school_id))
                ->exists();
            $allowed = (int) ($effective?->id ?? 0) === (int) $version->id || $ownedHistorical;
        }
        if (! $allowed) abort(Response::HTTP_FORBIDDEN, 'You are not allowed to download this template revision.');
        $content = $storage->content($version);
        abort_if($content === '' || hash('sha256', $content) !== $version->sha256_hash, 500, 'Template storage integrity check failed.');
        $filename = str_replace(['"', "\r", "\n"], '-', basename($version->original_filename));
        return response($content, 200, [
            'Content-Type' => $version->mime_type,
            'Content-Length' => (string) strlen($content),
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
