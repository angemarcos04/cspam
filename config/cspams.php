<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Submission File Upload Limit
    |--------------------------------------------------------------------------
    |
    | Maximum upload size (in KB) for BMEF/SMEA files.
    | Default keeps current behavior at 10MB.
    |
    */
    'submission_file_max_kb' => (int) env('CSPAMS_SUBMISSION_FILE_MAX_KB', 10240),
    'submission_file_disk' => env('CSPAMS_SUBMISSION_FILE_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | School Reminder Delivery
    |--------------------------------------------------------------------------
    |
    | Queued delivery is the default production mode, but it requires a queue
    | worker. Sync mode sends the School Head dashboard notification and email
    | during the monitor request, which is useful when a worker is unavailable.
    |
    */
    'school_reminders' => [
        'delivery_mode' => env('CSPAMS_SCHOOL_REMINDER_DELIVERY_MODE', 'queued'),
    ],
];

