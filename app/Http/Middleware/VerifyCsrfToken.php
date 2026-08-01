<?php

namespace App\Http\Middleware;

use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken as Middleware;

class VerifyCsrfToken extends Middleware
{
    // API routes use Sanctum token auth, not session CSRF, so nothing is
    // excluded here by default — SRS FR-AUTH-10 requires CSRF protection
    // to stay on everywhere it applies.
    protected $except = [
        //
    ];
}
