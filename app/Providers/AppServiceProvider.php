<?php

namespace App\Providers;

use App\Contracts\TeachingAssistantProvider;
use App\Services\HttpTeachingAssistantProvider;
use App\Services\MockTeachingAssistantProvider;
use App\Services\UnavailableTeachingAssistantProvider;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(TeachingAssistantProvider::class, function () {
            return match (config('services.ai.driver')) {
                'mock' => new MockTeachingAssistantProvider,
                'http' => new HttpTeachingAssistantProvider,
                default => new UnavailableTeachingAssistantProvider,
            };
        });
    }

    public function boot(): void
    {
        // Only a real web login may establish the account session epoch.
        // Retain the existing marker name for issued-session compatibility.
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
