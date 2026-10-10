<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Implements docs/MGAEMS_APIDesign.docx §2 (Authentication & User Management)
 * and SRS FR-AUTH-01, FR-AUTH-06, FR-AUTH-12.
 */
class AuthController extends Controller
{
    public function login(Request $request, AuditLogger $auditLogger)
    {
        $credentials = $request->validate([
            'username' => ['required', 'string'],
            'password' => ['required', 'string'],
        ]);

        $throttleKey = strtolower($credentials['username']).'|'.$request->ip();

        if (RateLimiter::tooManyAttempts($throttleKey, 5)) {
            $seconds = RateLimiter::availableIn($throttleKey);

            return response()->json([
                'error' => [
                    'code' => 'TOO_MANY_ATTEMPTS',
                    'message' => "Too many login attempts. Try again in {$seconds} seconds.",
                ],
            ], 429);
        }

        $user = User::where('username', $credentials['username'])
            ->orWhere('email', $credentials['username'])
            ->first();

        if (! $user || ! Hash::check($credentials['password'], $user->password_hash)) {
            RateLimiter::hit($throttleKey, 60);
            $auditLogger->log('LOGIN_FAILED', 'User', $user?->id, ['attempted_username' => $credentials['username']]);

            throw ValidationException::withMessages([
                'username' => ['The provided credentials are incorrect.'],
            ]);
        }

        // Serialize token issuance with account deactivation. A login that
        // started before deactivation must not issue a token afterwards.
        return DB::transaction(function () use ($user, $throttleKey, $auditLogger) {
            $user = User::whereKey($user->id)->lockForUpdate()->firstOrFail();

            if ($user->status !== 'active') {
                $auditLogger->log('LOGIN_BLOCKED_INACTIVE', 'User', $user->id);

                return response()->json([
                    'error' => ['code' => 'ACCOUNT_INACTIVE', 'message' => 'This account is not active.'],
                ], 403);
            }

            RateLimiter::clear($throttleKey);

            $token = $user->createToken('mgaems-web')->plainTextToken;
            $user->forceFill(['last_login_at' => now()])->save();
            $auditLogger->log('LOGIN_SUCCESS', 'User', $user->id);

            return response()->json([
                'data' => [
                    'token' => $token,
                    'user' => [
                        'id' => $user->id,
                        'username' => $user->username,
                        'email' => $user->email,
                        'role' => $user->role?->name,
                    ],
                ],
            ]);
        });
    }

    public function logout(Request $request, AuditLogger $auditLogger)
    {
        $auditLogger->log('LOGOUT', 'User', $request->user()->id);
        $token = $request->user()->currentAccessToken();
        if ($token instanceof PersonalAccessToken) {
            // Token logout keeps other devices signed in, as before.
            $token->delete();
        } elseif ($request->hasSession()) {
            Auth::guard('web')->logoutCurrentDevice();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return response()->json(['data' => ['message' => 'Logged out.']]);
    }

    public function me(Request $request)
    {
        $user = $request->user();

        return response()->json([
            'data' => [
                'id' => $user->id,
                'username' => $user->username,
                'email' => $user->email,
                'role' => $user->role?->name,
                'status' => $user->status,
            ],
        ]);
    }
}
