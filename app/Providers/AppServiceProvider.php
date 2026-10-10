<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // Only a real web login may establish a Health & Safety session epoch.
        \Illuminate\Support\Facades\Event::listen(\Illuminate\Auth\Events\Login::class, function ($event) {
            if ($event->guard === 'web') {
                $user = $event->user->fresh();
                if (! $user || $user->status !== 'active') {
                    session()->forget('mgaems_health_identity');
                    return;
                }
                session()->put('mgaems_health_identity', [
                    'user_id' => $user->id, 'session_version' => (int) $user->session_version,
                ]);
            }
        });
    }
}
