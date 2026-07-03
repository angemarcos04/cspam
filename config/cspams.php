<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Submission File Upload Limit
    |--------------------------------------------------------------------------
    |
    | Maximum upload size (in KB) for indicator requirement files.
    | Database-backed storage is intended for small requirement files.
    |
    */
    'submission_file_max_kb' => (int) env('CSPAMS_SUBMISSION_FILE_MAX_KB', 2048),
    'submission_file_disk' => env('CSPAMS_SUBMISSION_FILE_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | School Reminder Delivery
    |--------------------------------------------------------------------------
    |
    | Queued delivery is the default production mode. The dashboard
    | notification is written during the monitor request, while email can be
    | queued. Sync mode attempts both dashboard and email during the request.
    |
    */
    'school_reminders' => [
        'delivery_mode' => env('CSPAMS_SCHOOL_REMINDER_DELIVERY_MODE', 'queued'),
    ],
];

