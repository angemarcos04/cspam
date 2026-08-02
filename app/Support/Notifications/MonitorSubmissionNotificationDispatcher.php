<?php

namespace App\Support\Notifications;

use App\Jobs\RetryMonitorSubmissionNotification;
use App\Models\IndicatorSubmission;
use App\Models\User;
use App\Notifications\IndicatorSubmissionReceivedNotification;
use App\Support\Auth\UserRoleResolver;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Throwable;

final class MonitorSubmissionNotificationDispatcher
{
    /**
     * @param  list<string>  $scopeIds
     * @param  list<string>  $scopeLabels
     */
    public function dispatch(
        IndicatorSubmission $submission,
        User $schoolHead,
        string $eventType,
        array $scopeIds = [],
        array $scopeLabels = [],
        bool $dryRun = false,
        bool $queueRetryOnFailure = true,
        ?string $notificationKeyOverride = null,
    ): NotificationDispatchResult {
        $notificationKey = $notificationKeyOverride ?? $this->notificationKey($submission, $eventType, $scopeIds);

        try {
            $recipients = $this->recipients();
            $existingCount = 0;
            $wouldCreateCount = 0;
            $createdCount = 0;
            $failedCount = 0;

            foreach ($recipients as $recipient) {
                if ($dryRun) {
                    if ($this->notificationExists($recipient, $notificationKey)) {
                        $existingCount++;
                    } else {
                        $wouldCreateCount++;
                    }

                    continue;
                }

                try {
                    $outcome = $this->persistForRecipient(
                        $recipient,
                        $submission,
                        $schoolHead,
                        $eventType,
                        $scopeIds,
                        $scopeLabels,
                        $notificationKey,
                    );
                    $outcome === 'created' ? $createdCount++ : $existingCount++;
                } catch (Throwable $exception) {
                    $failedCount++;
                    $this->logFailure($submission, $eventType, $scopeIds, $recipient, $exception);
                }
            }

            $result = new NotificationDispatchResult(
                recipientCount: $recipients->count(),
                existingCount: $existingCount,
                wouldCreateCount: $wouldCreateCount,
                createdCount: $createdCount,
                failedCount: $failedCount,
                persistedCount: $existingCount + $createdCount,
                successful: $failedCount === 0,
            );

            if (! $dryRun && ! $result->successful && $queueRetryOnFailure) {
                $this->queueRetry($submission, $schoolHead, $eventType, $scopeIds, $scopeLabels, $notificationKey);
            }

            return $result;
        } catch (Throwable $exception) {
            $this->logFailure($submission, $eventType, $scopeIds, null, $exception);

            if (! $dryRun && $queueRetryOnFailure) {
                $this->queueRetry($submission, $schoolHead, $eventType, $scopeIds, $scopeLabels, $notificationKey);
            }

            return new NotificationDispatchResult(0, 0, 0, 0, 1, 0, false);
        }
    }

    private function recipients(): \Illuminate\Database\Eloquent\Collection
    {
        $query = User::query()->with('roles');
        if (Schema::hasColumn('users', 'account_type')) {
            $query->where('account_type', UserRoleResolver::MONITOR);
        } else {
            $query->whereHas('roles', static function ($builder): void {
                $builder->whereIn('name', UserRoleResolver::roleAliases(UserRoleResolver::MONITOR));
            });
        }

        return $query->get()->filter(static fn (User $user): bool => $user->canAuthenticate())->values();
    }

    /** @param list<string> $scopeIds */
    private function notificationKey(IndicatorSubmission $submission, string $eventType, array $scopeIds): string
    {
        $normalizedScopes = array_values(array_unique(array_map(static fn ($scope): string => trim((string) $scope), $scopeIds)));
        sort($normalizedScopes);

        $sendTimestamp = $submission->submitted_at?->toISOString();
        if ($normalizedScopes !== []) {
            $sendTimestamp = $submission->scopeSubmissions()
                ->whereIn('scope_id', $normalizedScopes)
                ->max('submitted_at') ?: $sendTimestamp;
        }

        return hash('sha256', json_encode([
            'submissionId' => (string) $submission->id,
            'eventType' => $eventType,
            'scopeIds' => $normalizedScopes,
            'sentAt' => (string) $sendTimestamp,
        ], JSON_THROW_ON_ERROR));
    }

    private function persistForRecipient(
        User $recipient,
        IndicatorSubmission $submission,
        User $schoolHead,
        string $eventType,
        array $scopeIds,
        array $scopeLabels,
        string $notificationKey,
    ): string {
        return DB::transaction(function () use (
            $recipient,
            $submission,
            $schoolHead,
            $eventType,
            $scopeIds,
            $scopeLabels,
            $notificationKey,
        ): string {
            $now = now();
            DB::table('monitor_submission_notification_deliveries')->insertOrIgnore([
                'recipient_id' => $recipient->id,
                'submission_id' => $submission->id,
                'notification_key' => $notificationKey,
                'event_type' => $eventType,
                'scope_ids' => json_encode(array_values($scopeIds), JSON_THROW_ON_ERROR),
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            $reservation = DB::table('monitor_submission_notification_deliveries')
                ->where('recipient_id', $recipient->id)
                ->where('notification_key', $notificationKey)
                ->lockForUpdate()
                ->first();

            if (! $reservation) {
                throw new RuntimeException('Monitor notification delivery reservation could not be acquired.');
            }

            $referencedNotificationId = trim((string) ($reservation->notification_id ?? ''));
            if ($referencedNotificationId !== '') {
                if ($recipient->notifications()->whereKey($referencedNotificationId)->exists()) {
                    return 'existing';
                }
            } else {
                $legacyNotification = $this->legacyNotification($recipient, $notificationKey);
                if ($legacyNotification) {
                    $this->recordDelivery(
                        (int) $reservation->id,
                        (string) $legacyNotification->id,
                        $legacyNotification->created_at ?? now(),
                    );

                    return 'existing';
                }
            }

            $notification = new IndicatorSubmissionReceivedNotification(
                $submission,
                $schoolHead,
                $eventType,
                $scopeIds,
                $scopeLabels,
                $notificationKey,
            );
            Notification::sendNow($recipient, $notification, ['database']);

            $notificationId = trim((string) ($notification->id ?? ''));
            if ($notificationId === '') {
                $persistedNotification = $recipient->notifications()
                    ->latest('created_at')
                    ->limit(10)
                    ->get(['id', 'data'])
                    ->first(static fn ($row): bool => (
                        (string) (($row->data ?? [])['notificationKey'] ?? '') === $notificationKey
                    ));
                $notificationId = trim((string) ($persistedNotification->id ?? ''));
            }

            if ($notificationId === '') {
                throw new RuntimeException('Persisted Monitor notification could not be resolved.');
            }

            $this->recordDelivery((int) $reservation->id, $notificationId, now());

            return 'created';
        });
    }

    private function notificationExists(User $recipient, string $notificationKey): bool
    {
        $reservation = DB::table('monitor_submission_notification_deliveries')
            ->where('recipient_id', $recipient->id)
            ->where('notification_key', $notificationKey)
            ->first(['notification_id']);
        $referencedNotificationId = trim((string) ($reservation->notification_id ?? ''));

        if ($referencedNotificationId !== '') {
            return $recipient->notifications()->whereKey($referencedNotificationId)->exists();
        }

        return $this->legacyNotification($recipient, $notificationKey) !== null;
    }

    private function legacyNotification(User $recipient, string $notificationKey): ?object
    {
        return $recipient->notifications()
            ->get(['id', 'data', 'created_at'])
            ->first(static fn ($notification): bool => (
                (string) (($notification->data ?? [])['notificationKey'] ?? '') === $notificationKey
            ));
    }

    private function recordDelivery(int $reservationId, string $notificationId, mixed $deliveredAt): void
    {
        DB::table('monitor_submission_notification_deliveries')
            ->where('id', $reservationId)
            ->update([
                'notification_id' => $notificationId,
                'delivered_at' => $deliveredAt,
                'updated_at' => now(),
            ]);
    }

    /** @param list<string> $scopeIds @param list<string> $scopeLabels */
    private function queueRetry(
        IndicatorSubmission $submission,
        User $schoolHead,
        string $eventType,
        array $scopeIds,
        array $scopeLabels,
        string $notificationKey,
    ): void {
        try {
            RetryMonitorSubmissionNotification::dispatch(
                (int) $submission->id,
                (int) $schoolHead->id,
                $eventType,
                array_values($scopeIds),
                array_values($scopeLabels),
                $notificationKey,
            );
        } catch (Throwable $exception) {
            try {
                Log::error('Monitor submission notification retry queueing failed.', [
                    'submission_id' => (string) $submission->id,
                    'school_id' => (string) $submission->school_id,
                    'academic_year_id' => (string) $submission->academic_year_id,
                    'event_type' => $eventType,
                    'scope_ids' => array_values($scopeIds),
                    'exception_class' => $exception::class,
                ]);
            } catch (Throwable) {
                // Submission success must not depend on queue or logging infrastructure.
            }
        }
    }

    /** @param list<string> $scopeIds */
    private function logFailure(
        IndicatorSubmission $submission,
        string $eventType,
        array $scopeIds,
        ?User $recipient,
        Throwable $exception,
    ): void {
        try {
            Log::error('Monitor submission notification persistence failed.', [
                'submission_id' => (string) $submission->id,
                'school_id' => (string) $submission->school_id,
                'academic_year_id' => (string) $submission->academic_year_id,
                'event_type' => $eventType,
                'scope_ids' => array_values($scopeIds),
                'recipient_id' => $recipient ? (string) $recipient->id : null,
                'exception_class' => $exception::class,
            ]);
        } catch (Throwable) {
            // Submission success must not depend on the logging backend.
        }
    }
}
