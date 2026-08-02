<?php

namespace App\Support\Notifications;

final class NotificationDispatchResult
{
    public function __construct(
        public readonly int $recipientCount,
        public readonly int $persistedCount,
        public readonly bool $successful,
    ) {}
}
