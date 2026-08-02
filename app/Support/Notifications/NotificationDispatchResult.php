<?php

namespace App\Support\Notifications;

final class NotificationDispatchResult
{
    public function __construct(
        public readonly int $recipientCount,
        public readonly int $existingCount,
        public readonly int $wouldCreateCount,
        public readonly int $createdCount,
        public readonly int $failedCount,
        public readonly int $persistedCount,
        public readonly bool $successful,
    ) {}
}
