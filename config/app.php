<?php

use Illuminate\Support\Facades\Facade;
use Illuminate\Support\ServiceProvider;

return [
    'name' => env('APP_NAME', 'MGAEMS'),
    'env' => env('APP_ENV', 'production'),
    'debug' => (bool) env('APP_DEBUG', false),
    'url' => env('APP_URL', 'http://localhost'),
    'timezone' => 'Africa/Nairobi',
    'locale' => 'en',
    'fallback_locale' => 'en',
    'faker_locale' => 'en_US',
    'cipher' => 'AES-256-CBC',
    'key' => env('APP_KEY'),
    'previous_keys' => [],

    'maintenance' => [
        'driver' => 'file',
    ],

    // Uses Laravel's own defaultProviders() helper for every framework
    // service provider, rather than hand-listing them — this is the same
    // pattern the official Laravel skeleton uses, and avoids the risk of
    // missing or mis-ordering a framework provider by hand.
    'providers' => ServiceProvider::defaultProviders()->merge([
        // Third-party package providers (Sanctum, DomPDF, Excel) are
        // registered automatically via Composer package auto-discovery —
        // no manual entry needed here.

        // Our own application providers.
        App\Providers\AppServiceProvider::class,
        App\Providers\RouteServiceProvider::class,
    ])->toArray(),

    'aliases' => Facade::defaultAliases()->merge([
        //
    ])->toArray(),
];
