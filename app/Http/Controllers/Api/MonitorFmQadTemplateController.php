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
use App\Support\FmQad\FmQadTemplateVersionManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class MonitorFmQadTemplateController extends Controller
{
    public function forms(Request $request, FmQadTemplateVersionManager $manager): JsonResponse
    {
        $this->monitor($request);
        $years = AcademicYear::query()->orderByDesc('start_date')->get(['id', 'name', 'is_current']);
        $forms = FmQadForm::query()->enabled()->with(['versions' => fn ($q) => $q->active()->with('academicYear')->latest('activated_at')])->orderBy('sort_order')->get();
        return response()->json([
            'data' => $forms->map(fn (FmQadForm $form) => [
                'id' => (string) $form->id,
                'scopeId' => $form->scope_id,
                'code' => $form->code,
                'name' => $form->name,
                'activeVersions' => FmQadTemplateVersionResource::collection($form->versions)->resolve($request),
            ])->values(),
            'academicYears' => $years->map(fn ($year) => ['id' => (string) $year->id, 'name' => $year->name, 'isCurrent' => (bool) $year->is_current]),
        ]);
    }

    public function versions(Request $request, FmQadForm $form): JsonResponse
    {
        $this->monitor($request);
        $versions = $form->versions()->with(['form', 'academicYear', 'uploader', 'activator', 'submissionFiles'])->latest()->get();
        return response()->json(['data' => FmQadTemplateVersionResource::collection($versions)->resolve($request)]);
    }

    public function store(UploadFmQadTemplateVersionRequest $request, FmQadForm $form, FmQadTemplateVersionManager $manager): JsonResponse
    {
        $version = $manager->upload($form, $request->file('file'), [
            'revision_label' => $request->string('revisionLabel')->toString(),
            'academic_year_id' => $request->filled('academicYearId') ? (int) $request->input('academicYearId') : null,
            'change_notes' => $request->string('changeNotes')->toString(),
            'internal_note' => $request->input('internalNote'),
        ], $request->user(), $request->boolean('activate'), $request);
        return response()->json(['data' => (new FmQadTemplateVersionResource($version))->resolve($request)], 201);
    }

    public function update(UpdateFmQadTemplateVersionRequest $request, FmQadTemplateVersion $version, FmQadTemplateVersionManager $manager): JsonResponse
    {
        if ($version->status !== FmQadTemplateVersion::DRAFT) {
            throw ValidationException::withMessages(['version' => 'Only draft template metadata can be edited.']);
        }
        $values = [];
        if ($request->has('revisionLabel')) {
            $label = trim(preg_replace('/\s+/', ' ', $request->string('revisionLabel')->toString()) ?? '');
            $duplicate = $version->form->versions()->whereKeyNot($version->id)->where('normalized_revision_label', mb_strtolower($label))->exists();
            if ($duplicate) throw ValidationException::withMessages(['revisionLabel' => 'This revision label already exists for the selected FM-QAD form.']);
            $values['revision_label'] = $label;
            $values['normalized_revision_label'] = mb_strtolower($label);
        }
        if ($request->has('academicYearId')) $values['academic_year_id'] = $request->filled('academicYearId') ? (int) $request->input('academicYearId') : null;
        if ($request->has('changeNotes')) $values['change_notes'] = trim($request->string('changeNotes')->toString());
        if ($request->has('internalNote')) $values['internal_note'] = trim((string) $request->input('internalNote')) ?: null;
        $updated = $manager->updateMetadata($version, $values, $request->user(), $request);
        return response()->json(['data' => (new FmQadTemplateVersionResource($updated))->resolve($request)]);
    }

    public function activate(Request $request, FmQadTemplateVersion $version, FmQadTemplateVersionManager $manager): JsonResponse
    {
        $this->monitor($request);
        return response()->json(['data' => (new FmQadTemplateVersionResource($manager->activate($version, $request->user(), $request)))->resolve($request)]);
    }

    public function archive(Request $request, FmQadTemplateVersion $version, FmQadTemplateVersionManager $manager): JsonResponse
    {
        $this->monitor($request);
        return response()->json(['data' => (new FmQadTemplateVersionResource($manager->archive($version, $request->user(), $request)))->resolve($request)]);
    }

    private function monitor(Request $request): void
    {
        abort_unless(UserRoleResolver::has($request->user(), UserRoleResolver::MONITOR), 403, 'Only Division Monitors can manage FM-QAD templates.');
    }
}
