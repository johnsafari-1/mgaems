<?php

return [
    // Staging cannot select SMTP/log delivery, even with inherited mail variables.
    'default' => env('MGAEMS_STAGING', false) ? 'array' : env('MAIL_MAILER', 'smtp'),

    'mailers' => env('MGAEMS_STAGING', false) ? ['array' => ['transport' => 'array']] : [
        'smtp' => [
            'transport' => 'smtp',
            'host' => env('MAIL_HOST', '127.0.0.1'),
            'port' => env('MAIL_PORT', 2525),
            'encryption' => env('MAIL_ENCRYPTION', 'tls'),
            'username' => env('MAIL_USERNAME'),
            'password' => env('MAIL_PASSWORD'),
            'timeout' => null,
        ],
        'log' => [
            'transport' => 'log',
            'channel' => env('MAIL_LOG_CHANNEL'),
        ],
    ],

    'from' => [
        'address' => env('MAIL_FROM_ADDRESS', 'notifications@mgaems.example'),
        'name' => env('MAIL_FROM_NAME', 'MGAEMS'),
    ],
];
