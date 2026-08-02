<?php

namespace App\Jobs;

use App\Models\IndicatorSubmission;
use App\Models\User;
use App\Support\Notifications\MonitorSubmissionNotificationDispatcher;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use RuntimeException;

final class RetryMonitorSubmissionNotification implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;

    /**
     * @param  list<string>  $scopeIds
     * @param  list<string>  $scopeLabels
     */
    public function __construct(
        public readonly int $submissionId,
        public readonly int $schoolHeadId,
        public readonly string $eventType,
        public readonly array $scopeIds,
        public readonly array $scopeLabels,
        public readonly string $notificationKey,
    ) {
        $this->onConnection('database');
        $this->onQueue('default');
    }

    /** @return list<int> */
    public function backoff(): array
    {
        return [30, 120, 300, 900];
    }

    public function uniqueId(): string
    {
        return $this->notificationKey;
    }

    public function handle(MonitorSubmissionNotificationDispatcher $dispatcher): void
    {
        $submission = IndicatorSubmission::query()->findOrFail($this->submissionId);
        $schoolHead = User::query()->findOrFail($this->schoolHeadId);
        $result = $dispatcher->dispatch(
            $submission,
            $schoolHead,
            $this->eventType,
            $this->scopeIds,
            $this->scopeLabels,
            false,
            false,
            $this->notificationKey,
        );

        if (! $result->successful) {
            throw new RuntimeException('Monitor submission notification retry remains incomplete.');
        }
    }
}
