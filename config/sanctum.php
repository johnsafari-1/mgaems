<?php

use Laravel\Sanctum\Sanctum;

return [
    // Front-end origins allowed to receive stateful (cookie-based) auth,
    // e.g. a local dev server for the future frontend. Token-based API
    // auth (what AuthController issues) works regardless of this list.
    'stateful' => env('MGAEMS_STAGING', false) ? [] : explode(',', env('SANCTUM_STATEFUL_DOMAINS', sprintf(
        '%s%s',
        'localhost,localhost:3000,127.0.0.1,127.0.0.1:8000,::1',
        env('APP_URL') ? ','.parse_url(env('APP_URL'), PHP_URL_HOST) : ''
    ))),

    'guard' => ['web'],

    'expiration' => null,

    'middleware' => [
        'authenticate_session' => version_compare(Composer\InstalledVersions::getVersion('laravel/sanctum'), '4.0.0', '>=')
            ? Laravel\Sanctum\Http\Middleware\AuthenticateSession::class : null,
        'validate_csrf_token' => App\Http\Middleware\VerifyCsrfToken::class,
        // Keep the live Sanctum 3 runtime protected until its controlled transition.
        'verify_csrf_token' => App\Http\Middleware\VerifyCsrfToken::class,
        'encrypt_cookies' => App\Http\Middleware\EncryptCookies::class,
    ],
];
