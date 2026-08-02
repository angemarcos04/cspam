<?php

namespace App\Support\Notifications;

use App\Models\IndicatorSubmission;
use App\Models\User;
use App\Notifications\IndicatorSubmissionReceivedNotification;
use App\Support\Auth\UserRoleResolver;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Schema;
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
    ): NotificationDispatchResult {
        try {
            $recipients = $this->recipients();
            $notificationKey = $this->notificationKey($submission, $eventType, $scopeIds);
            $persistedCount = 0;
            $successful = true;

            foreach ($recipients as $recipient) {
                if ($this->alreadyPersisted($recipient, $notificationKey)) {
                    $persistedCount++;
                    continue;
                }

                if ($dryRun) {
                    continue;
                }

                try {
                    Notification::sendNow($recipient, new IndicatorSubmissionReceivedNotification(
                        $submission,
                        $schoolHead,
                        $eventType,
                        $scopeIds,
                        $scopeLabels,
                        $notificationKey,
                    ), ['database']);
                    $persistedCount++;
                } catch (Throwable $exception) {
                    $successful = false;
                    $this->logFailure($submission, $eventType, $scopeIds, $recipient, $exception);
                }
            }

            return new NotificationDispatchResult($recipients->count(), $persistedCount, $successful);
        } catch (Throwable $exception) {
            $this->logFailure($submission, $eventType, $scopeIds, null, $exception);

            return new NotificationDispatchResult(0, 0, false);
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

    private function alreadyPersisted(User $recipient, string $notificationKey): bool
    {
        return $recipient->notifications()
            ->get(['data'])
            ->contains(static fn ($notification): bool => (
                (string) (($notification->data ?? [])['notificationKey'] ?? '') === $notificationKey
            ));
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
