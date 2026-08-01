<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\UpdateFmQadTemplateVersionRequest;
use App\Http\Requests\Api\UploadFmQadTemplateVersionRequest;
use App\Http\Resources\FmQadTemplateVersionResource;
use App\Models\AcademicYear;
use App\Models\FmQadForm;
use App\Models\FmQadTemplateVersion;
use App\Support\Auth\UserRoleResolver;
use App\Support\FmQad\ConfiguredFmQadCatalog;
use App\Support\FmQad\FmQadTemplateVersionManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MonitorFmQadTemplateController extends Controller
{
    public function forms(Request $request, ConfiguredFmQadCatalog $catalogGuard): JsonResponse
    {
        $this->monitor($request);
        $configuredScopeIds = $catalogGuard->scopeIds();
        $catalog = FmQadForm::query()
            ->whereIn('scope_id', $configuredScopeIds)
            ->get(['scope_id', 'is_enabled']);
        $missingScopeIds = $configuredScopeIds
            ->diff($catalog->pluck('scope_id'))
            ->values();
        $years = AcademicYear::query()->orderByDesc('start_date')->get(['id', 'name', 'is_current']);
        $forms = FmQadForm::query()
            ->whereIn('scope_id', $configuredScopeIds)
            ->enabled()
            ->with(['versions' => fn ($q) => $q->active()->with('academicYear')->latest('activated_at')])
            ->orderBy('sort_order')
            ->orderBy('code')
            ->get();

        return response()->json([
            'data' => $forms->map(fn (FmQadForm $form) => [
                'id' => (string) $form->id,
                'scopeId' => $form->scope_id,
                'code' => $form->code,
                'name' => $form->name,
                'description' => $form->description,
                'sortOrder' => (int) $form->sort_order,
                'isEnabled' => (bool) $form->is_enabled,
                'activeVersions' => FmQadTemplateVersionResource::collection($form->versions)->resolve($request),
            ])->values(),
            'academicYears' => $years->map(fn ($year) => ['id' => (string) $year->id, 'name' => $year->name, 'isCurrent' => (bool) $year->is_current]),
            'meta' => [
                'configuredFormCount' => $configuredScopeIds->count(),
                'catalogCount' => $catalog->count(),
                'enabledCatalogCount' => $catalog->where('is_enabled', true)->count(),
                'initializationRequired' => $missingScopeIds->isNotEmpty(),
                'missingScopeIds' => $missingScopeIds,
            ],
        ]);
    }

    public function versions(Request $request, FmQadForm $form, ConfiguredFmQadCatalog $catalogGuard): JsonResponse
    {
        $this->monitor($request);
        $catalogGuard->ensureManageableForm($form);
        $versions = $form->versions()->with(['form', 'academicYear', 'uploader', 'activator', 'submissionFiles'])->latest()->get();

        return response()->json(['data' => FmQadTemplateVersionResource::collection($versions)->resolve($request)]);
    }

    public function store(UploadFmQadTemplateVersionRequest $request, FmQadForm $form, FmQadTemplateVersionManager $manager, ConfiguredFmQadCatalog $catalogGuard): JsonResponse
    {
        $catalogGuard->ensureManageableForm($form);
        $version = $manager->upload($form, $request->file('file'), [
            'revision_label' => $request->string('revisionLabel')->toString(),
            'academic_year_id' => $request->filled('academicYearId') ? (int) $request->input('academicYearId') : null,
            'change_notes' => $request->string('changeNotes')->toString(),
            'internal_note' => $request->input('internalNote'),
        ], $request->user(), $request->boolean('activate'), $request);

        return response()->json(['data' => (new FmQadTemplateVersionResource($version))->resolve($request)], 201);
    }

    public function update(UpdateFmQadTemplateVersionRequest $request, FmQadTemplateVersion $version, FmQadTemplateVersionManager $manager, ConfiguredFmQadCatalog $catalogGuard): JsonResponse
    {
        $catalogGuard->ensureManageableVersion($version);
        $values = [];
        if ($request->has('revisionLabel')) {
            $values['revision_label'] = $request->string('revisionLabel')->toString();
        }
        if ($request->has('academicYearId')) {
            $values['academic_year_id'] = $request->filled('academicYearId') ? (int) $request->input('academicYearId') : null;
        }
        if ($request->has('changeNotes')) {
            $values['change_notes'] = trim($request->string('changeNotes')->toString());
        }
        if ($request->has('internalNote')) {
            $values['internal_note'] = trim((string) $request->input('internalNote')) ?: null;
        }
        $updated = $manager->updateMetadata($version, $values, $request->user(), $request);

        return response()->json(['data' => (new FmQadTemplateVersionResource($updated))->resolve($request)]);
    }

    public function activate(Request $request, FmQadTemplateVersion $version, FmQadTemplateVersionManager $manager, ConfiguredFmQadCatalog $catalogGuard): JsonResponse
    {
        $this->monitor($request);
        $catalogGuard->ensureManageableVersion($version);

        return response()->json(['data' => (new FmQadTemplateVersionResource($manager->activate($version, $request->user(), $request)))->resolve($request)]);
    }

    public function archive(Request $request, FmQadTemplateVersion $version, FmQadTemplateVersionManager $manager, ConfiguredFmQadCatalog $catalogGuard): JsonResponse
    {
        $this->monitor($request);
        $catalogGuard->ensureManageableVersion($version);

        return response()->json(['data' => (new FmQadTemplateVersionResource($manager->archive($version, $request->user(), $request)))->resolve($request)]);
    }

    private function monitor(Request $request): void
    {
        abort_unless(UserRoleResolver::has($request->user(), UserRoleResolver::MONITOR), 403, 'Only Division Monitors can manage FM-QAD templates.');
    }
}
