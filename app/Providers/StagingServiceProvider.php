<?php

namespace App\Providers;

use App\Http\Controllers\StagingHealthController;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

class StagingServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        if (!config('staging.enabled')) return;
        // Laravel 11+ merges framework defaults into nested configuration.
        // Enforce the sink after that merge, including explicit named mailers.
        config(['mail.default' => 'array', 'mail.mailers' => ['array' => ['transport' => 'array']],
            'database.connections.mysql.url' => null]);
    }

    public function boot(): void
    {
        if (!config('staging.enabled')) return;
        // Fonts persist on the app volume; rendering scratch files are private.
        config(['dompdf.options.temp_dir' => storage_path('framework/cache/dompdf')]);
        // Stateless readiness avoids session creation and audit writes.
        if (!$this->app->routesAreCached()) Route::get('/healthz', StagingHealthController::class);
    }
}
