<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Monitor read performance logging
    |--------------------------------------------------------------------------
    |
    | Disabled by default. Enable temporarily in an operational environment to
    | measure the Monitor's read-only dashboard endpoints without logging
    | request payloads, credentials, cookies, SQL, or bindings.
    |
    */
    'enabled' => filter_var(
        env('CSPAMS_PERFORMANCE_LOGGING', false),
        FILTER_VALIDATE_BOOL,
    ),
    'slow_request_threshold_ms' => (int) env('CSPAMS_SLOW_REQUEST_THRESHOLD_MS', 500),
];
