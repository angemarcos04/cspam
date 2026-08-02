<?php

use App\Models\IndicatorSubmission;
use App\Models\User;
use App\Support\Notifications\MonitorSubmissionNotificationDispatcher;
use Illuminate\Contracts\Console\Kernel;

require dirname(__DIR__, 2).'/vendor/autoload.php';

$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

[$script, $barrierPath, $submissionId, $schoolHeadId, $eventType, $notificationKey] = $argv;
$deadline = microtime(true) + 20;
while (is_file($barrierPath) && microtime(true) < $deadline) {
    usleep(10_000);
}

if (is_file($barrierPath)) {
    fwrite(STDERR, "Concurrency barrier timed out.\n");
    exit(2);
}

$submission = IndicatorSubmission::query()->findOrFail((int) $submissionId);
$schoolHead = User::query()->findOrFail((int) $schoolHeadId);
$result = $app->make(MonitorSubmissionNotificationDispatcher::class)->dispatch(
    $submission,
    $schoolHead,
    $eventType,
    [],
    [],
    false,
    false,
    $notificationKey,
);

fwrite(STDOUT, json_encode([
    'successful' => $result->successful,
    'created' => $result->createdCount,
    'existing' => $result->existingCount,
], JSON_THROW_ON_ERROR));

exit($result->successful ? 0 : 1);
