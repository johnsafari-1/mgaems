<?php

namespace App\Http\Middleware;

use Illuminate\Auth\Middleware\Authenticate as Middleware;

class Authenticate extends Middleware
{
    protected function redirectTo(\Illuminate\Http\Request $request): ?string
    {
        // API-first app — never redirect to a login page, just return null
        // so Laravel responds 401 JSON instead (see UserController tests).
        return null;
    }
}
