<?php

return [
    'queue' => [
        'token' => env('CSPAMS_DIAGNOSTICS_TOKEN'),
    ],

    'mail' => [
        'recipient' => env('CSPAMS_MONITOR_EMAIL'),
    ],
];
