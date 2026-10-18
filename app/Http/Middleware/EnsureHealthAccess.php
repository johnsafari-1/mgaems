<?php

namespace App\Http\Middleware;

use App\Services\HealthAccess;
use Closure;
use Illuminate\Http\Request;

class EnsureHealthAccess
{
    public function handle(Request $request, Closure $next, string $mode = 'manage')
    {
        // Validation must never redirect and flash sensitive form input to a session.
        $request->headers->set('Accept', 'application/json');
        (new HealthAccess)->actor($request, $mode);
        $response = $next($request);
        $response->headers->set('Cache-Control', 'private, no-store, max-age=0');

        return $response;
    }
}
