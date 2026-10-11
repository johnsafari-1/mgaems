<?php

namespace App\Http\Middleware;

use Illuminate\Auth\Middleware\Authenticate as Middleware;
use Illuminate\Http\Exceptions\HttpResponseException;
use Laravel\Sanctum\PersonalAccessToken;

class Authenticate extends Middleware
{
    protected function authenticate($request, array $guards)
    {
        parent::authenticate($request, $guards);

        // Sanctum accepts both bearer tokens and web sessions. Neither proves
        // that the account is still active or still holds its original role.
        // Keep the authenticated instance (and its current access token), but
        // replace cached attributes/roles with the current database state.
        $user = $this->auth->user();
        $current = $user->fresh('role');
        if (! $current) {
            $this->unauthenticated($request, $guards);
        }
        $user->setRawAttributes($current->getAttributes(), true);
        $user->setRelation('role', $current->role);

        if ($user->status !== 'active') {
            if ($request->hasSession()) {
                $this->auth->guard('web')->logoutCurrentDevice();
                $request->session()->invalidate();
                $request->session()->regenerateToken();
            }

            throw new HttpResponseException(response()->json([
                'error' => ['code' => 'ACCOUNT_INACTIVE', 'message' => 'This account is not active.'],
            ], 403));
        }

        if (in_array('web', $guards, true) || ! ($user->currentAccessToken() instanceof PersonalAccessToken)) {
            $identity = $request->hasSession() ? $request->session()->get('mgaems_health_identity') : null;
            // Keep pre-epoch ordinary sessions usable only until the first
            // revocation. Health retains its stricter login-marker requirement.
            $valid = $identity === null ? (int) $user->session_version === 0
                : (is_array($identity) && ($identity['user_id'] ?? null) === $user->id
                    && ($identity['session_version'] ?? null) === (int) $user->session_version);
            if (! $valid) {
                if ($request->hasSession()) {
                    $this->auth->guard('web')->logoutCurrentDevice();
                    $request->session()->invalidate();
                    $request->session()->regenerateToken();
                }
                $this->unauthenticated($request, $guards);
            }
        }
    }

    protected function redirectTo(\Illuminate\Http\Request $request): ?string
    {
        if ($request->expectsJson()) {
            return null;
        }

        return '/login.html';
    }
}
