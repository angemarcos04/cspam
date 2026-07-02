<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\MonitorReviewInboxService;
use App\Support\Auth\ApiUserResolver;
use App\Support\Auth\UserRoleResolver;
use App\Support\Domain\SchoolStatus;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

class MonitorReviewInboxController extends Controller
{
    public function __construct(
        private readonly MonitorReviewInboxService $reviewInbox,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $user = ApiUserResolver::fromRequest($request);
        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], Response::HTTP_UNAUTHORIZED);
        }

        if (! UserRoleResolver::has($user, UserRoleResolver::MONITOR)) {
            return response()->json(['message' => 'Forbidden.'], Response::HTTP_FORBIDDEN);
        }

        $validated = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'q' => ['sometimes', 'nullable', 'string', 'max:120'],
            'status' => ['sometimes', 'nullable', 'string', Rule::in(['all', ...array_column(SchoolStatus::cases(), 'value')])],
            'workflow' => ['sometimes', 'nullable', 'string', Rule::in(['all', 'missing', 'waiting', 'returned', 'submitted', 'validated'])],
            'lane' => ['sometimes', 'nullable', 'string', Rule::in(['all', 'urgent', 'returned', 'for_review', 'waiting_data'])],
            'preset' => ['sometimes', 'nullable', 'string', Rule::in(['all', 'pending', 'missing', 'returned', 'no_submission'])],
            'sector' => ['sometimes', 'nullable', 'string', Rule::in(['all', 'public', 'private'])],
            'level' => ['sometimes', 'nullable', 'string', Rule::in(['all', 'elementary', 'junior_high', 'senior_high', 'legacy_high_school', 'high_school'])],
            'school_id' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'date_from' => ['sometimes', 'nullable', 'date'],
            'date_to' => ['sometimes', 'nullable', 'date'],
            'academic_year_id' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
        ]);

        if (! isset($validated['search']) && isset($validated['q'])) {
            $validated['search'] = $validated['q'];
        }

        foreach (['status', 'workflow', 'lane', 'preset', 'sector', 'level'] as $key) {
            if (! isset($validated[$key]) || trim((string) $validated[$key]) === '') {
                $validated[$key] = 'all';
            }
        }

        return response()->json($this->reviewInbox->build($validated));
    }
}
