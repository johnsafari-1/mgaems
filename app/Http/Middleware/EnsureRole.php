<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Enforces RBAC at the API layer per SRS FR-AUTH-04 and the User Role Matrix.
 *
 * Usage in routes: ->middleware('role:system_admin,head_teacher')
 *
 * This is deliberately checked on every request server-side — role checks
 * must never be enforced only in the UI (see SRS §5.2 and User Role Matrix §5).
 */
class EnsureRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();

        if (! $user) {
            return response()->json([
                'error' => ['code' => 'UNAUTHENTICATED', 'message' => 'Authentication required.'],
            ], 401);
        }

        if (! in_array($user->role?->name, $roles, true)) {
            return response()->json([
                'error' => ['code' => 'FORBIDDEN', 'message' => 'You do not have permission to access this resource.'],
            ], 403);
        }

        return $next($request);
    }
}
