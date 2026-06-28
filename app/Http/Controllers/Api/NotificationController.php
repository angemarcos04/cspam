<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Auth\ApiUserResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Notifications\DatabaseNotification;
use Symfony\Component\HttpFoundation\Response;

class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $this->requireUser($request);
        $perPage = $this->resolvePerPage($request);
        $page = $this->resolvePage($request);
        $visibleNotifications = $user->notifications()->whereNull('cleared_at');
        $total = (clone $visibleNotifications)->count();
        $unreadCount = (clone $visibleNotifications)->whereNull('read_at')->count();
        $notifications = (clone $visibleNotifications)
            ->orderByDesc('created_at')
            ->forPage($page, $perPage)
            ->get();
        $lastPage = max(1, (int) ceil($total / $perPage));

        return response()->json([
            'data' => $notifications
                ->map(fn (DatabaseNotification $notification): array => $this->serializeNotification($notification))
                ->values(),
            'meta' => [
                'currentPage' => $page,
                'lastPage' => $lastPage,
                'perPage' => $perPage,
                'total' => $total,
                'unreadCount' => $unreadCount,
            ],
        ]);
    }

    public function markAsRead(Request $request, string $notification): JsonResponse
    {
        $user = $this->requireUser($request);

        /** @var DatabaseNotification|null $row */
        $row = $user->notifications()
            ->whereNull('cleared_at')
            ->whereKey($notification)
            ->first();

        if (! $row) {
            return response()->json(['message' => 'Notification not found.'], Response::HTTP_NOT_FOUND);
        }

        if (! $row->read_at) {
            $row->markAsRead();
        }

        return response()->json([
            'data' => $this->serializeNotification($row->fresh()),
        ]);
    }

    public function markAllAsRead(Request $request): JsonResponse
    {
        $user = $this->requireUser($request);
        $updated = $user->notifications()
            ->whereNull('cleared_at')
            ->whereNull('read_at')
            ->update(['read_at' => now()]);

        return response()->json([
            'data' => [
                'updated' => $updated,
            ],
        ]);
    }

    public function clear(Request $request, string $notification): JsonResponse
    {
        $user = $this->requireUser($request);

        /** @var DatabaseNotification|null $row */
        $row = $user->notifications()
            ->whereNull('cleared_at')
            ->whereKey($notification)
            ->first();

        if (! $row) {
            return response()->json(['message' => 'Notification not found.'], Response::HTTP_NOT_FOUND);
        }

        $now = now();
        $row->forceFill([
            'read_at' => $row->read_at ?? $now,
            'cleared_at' => $now,
        ])->save();

        return response()->json([
            'data' => [
                'cleared' => 1,
            ],
        ]);
    }

    public function clearAll(Request $request): JsonResponse
    {
        $user = $this->requireUser($request);
        $now = now();

        $updated = $user->notifications()
            ->whereNull('cleared_at')
            ->update([
                'read_at' => $now,
                'cleared_at' => $now,
            ]);

        return response()->json([
            'data' => [
                'cleared' => $updated,
            ],
        ]);
    }

    private function requireUser(Request $request): User
    {
        $user = ApiUserResolver::fromRequest($request);
        abort_if(! $user, Response::HTTP_UNAUTHORIZED, 'Unauthenticated.');

        return $user;
    }

    private function resolvePerPage(Request $request, int $default = 25, int $max = 100): int
    {
        $perPage = $request->integer('per_page');

        if ($perPage <= 0) {
            return $default;
        }

        return min($perPage, $max);
    }

    private function resolvePage(Request $request, int $default = 1): int
    {
        $page = $request->integer('page');

        if ($page <= 0) {
            return $default;
        }

        return $page;
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeNotification(DatabaseNotification $notification): array
    {
        $payload = $this->normalizeNotificationPayload($notification->data);

        return [
            'id' => (string) $notification->id,
            'type' => (string) $notification->type,
            'eventType' => $this->payloadString($payload, 'eventType', 'notification'),
            'title' => $this->payloadString($payload, 'title', 'Notification'),
            'message' => $this->payloadString($payload, 'message', 'You have a new notification.'),
            'readAt' => $notification->read_at?->toISOString(),
            'createdAt' => $notification->created_at?->toISOString(),
            'data' => $payload,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function normalizeNotificationPayload(mixed $data): array
    {
        if (is_array($data)) {
            return $data;
        }

        if (is_string($data) && trim($data) !== '') {
            $decoded = json_decode($data, true);

            if (is_array($decoded)) {
                return $decoded;
            }
        }

        return [];
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function payloadString(array $payload, string $key, string $fallback): string
    {
        $value = $payload[$key] ?? null;

        if (is_string($value) && trim($value) !== '') {
            return $value;
        }

        return $fallback;
    }
}
