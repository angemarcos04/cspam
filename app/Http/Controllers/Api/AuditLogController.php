<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\AuditLogResource;
use App\Models\AuditLog;
use App\Models\School;
use App\Models\User;
use App\Support\Auth\ApiUserResolver;
use App\Support\Auth\UserRoleResolver;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\Response;

class AuditLogController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $user = $this->requireUser($request);

        $query = AuditLog::query()
            ->with('user:id,name,email')
            ->orderByDesc('created_at')
            ->orderByDesc('id');

        $this->applyVisibilityScope($query, $user);
        $this->applyFilters($query, $request, $user);

        $perPage = min(100, max(1, $request->integer('per_page', 25)));

        return AuditLogResource::collection(
            $query->paginate($perPage)->appends($request->query()),
        );
    }

    private function requireUser(Request $request): User
    {
        $user = ApiUserResolver::fromRequest($request);
        abort_if(! $user, Response::HTTP_UNAUTHORIZED, 'Unauthenticated.');

        return $user;
    }

    private function applyVisibilityScope(Builder $query, User $user): void
    {
        if ($this->isMonitor($user)) {
            return;
        }

        if ($this->isSchoolHead($user) && $user->school_id) {
            $school = School::query()->find($user->school_id);
            $schoolCode = is_string($school?->school_code) ? trim($school->school_code) : '';
            $schoolId = (string) $user->school_id;

            $query->where(function (Builder $builder) use ($schoolId, $schoolCode, $user): void {
                $builder->where('metadata->school_id', $schoolId)
                    ->orWhere('metadata->school_id', (int) $schoolId)
                    ->orWhere('user_id', $user->id);

                if ($schoolCode !== '') {
                    $builder->orWhere('metadata->school_code', $schoolCode)
                        ->orWhere('metadata->identifier', $schoolCode);
                }
            });

            return;
        }

        abort(Response::HTTP_FORBIDDEN, 'You are not authorized to view audit logs.');
    }

    private function applyFilters(Builder $query, Request $request, User $user): void
    {
        $action = trim((string) $request->query('action', ''));
        if ($action !== '') {
            $query->where('action', $action);
        }

        $eventPrefix = trim((string) $request->query('event_prefix', ''));
        if ($eventPrefix !== '') {
            $query->where('action', 'like', $eventPrefix . '%');
        }

        $schoolId = trim((string) $request->query('school_id', ''));
        if ($schoolId !== '') {
            $this->assertCanFilterSchool($user, $schoolId, null);
            $query->where(function (Builder $builder) use ($schoolId): void {
                $builder->where('metadata->school_id', $schoolId)
                    ->orWhere('metadata->school_id', (int) $schoolId);
            });
        }

        $schoolCode = trim((string) $request->query('school_code', ''));
        if ($schoolCode !== '') {
            $this->assertCanFilterSchool($user, null, $schoolCode);
            $query->where('metadata->school_code', $schoolCode);
        }

        $academicYearId = trim((string) $request->query('academic_year_id', ''));
        if ($academicYearId !== '') {
            $query->where(function (Builder $builder) use ($academicYearId): void {
                $builder->where('metadata->academic_year_id', $academicYearId)
                    ->orWhere('metadata->academic_year_id', (int) $academicYearId);
            });
        }

        $academicYearLabel = trim((string) $request->query('academic_year_label', ''));
        if ($academicYearLabel !== '') {
            $query->where('metadata->academic_year_label', $academicYearLabel);
        }

        $submissionId = trim((string) $request->query('submission_id', ''));
        if ($submissionId !== '') {
            $query->where(function (Builder $builder) use ($submissionId): void {
                $builder->where('metadata->submission_id', $submissionId)
                    ->orWhere('auditable_id', ctype_digit($submissionId) ? (int) $submissionId : $submissionId);
            });
        }

        $scopeId = trim((string) $request->query('scope_id', ''));
        if ($scopeId !== '') {
            $query->where('metadata->scope_id', $scopeId);
        }

        $dateFrom = $this->parseDate($request->query('date_from'));
        if ($dateFrom) {
            $query->where('created_at', '>=', $dateFrom->startOfDay());
        }

        $dateTo = $this->parseDate($request->query('date_to'));
        if ($dateTo) {
            $query->where('created_at', '<=', $dateTo->endOfDay());
        }
    }

    private function assertCanFilterSchool(User $user, ?string $schoolId, ?string $schoolCode): void
    {
        if ($this->isMonitor($user)) {
            return;
        }

        if (! $this->isSchoolHead($user) || ! $user->school_id) {
            abort(Response::HTTP_FORBIDDEN, 'You are not authorized to view this school audit trail.');
        }

        $school = School::query()->find($user->school_id);
        $matchesId = $schoolId === null || $schoolId === '' || (string) $user->school_id === $schoolId;
        $matchesCode = $schoolCode === null || $schoolCode === '' || (string) $school?->school_code === $schoolCode;

        abort_if(! $matchesId || ! $matchesCode, Response::HTTP_FORBIDDEN, 'You are not authorized to view this school audit trail.');
    }

    private function parseDate(mixed $value): ?Carbon
    {
        $raw = trim((string) $value);
        if ($raw === '') {
            return null;
        }

        try {
            return Carbon::parse($raw);
        } catch (\Throwable) {
            return null;
        }
    }

    private function isMonitor(User $user): bool
    {
        return UserRoleResolver::has($user, UserRoleResolver::MONITOR);
    }

    private function isSchoolHead(User $user): bool
    {
        return UserRoleResolver::has($user, UserRoleResolver::SCHOOL_HEAD);
    }
}
