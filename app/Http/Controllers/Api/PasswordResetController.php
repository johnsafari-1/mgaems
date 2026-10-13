<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\PasswordResetMail;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Support\Carbon;

/**
 * Implements SRS FR-AUTH-03 and UC-AUTH-02 (Recover Password):
 * a secure, single-use, time-limited token workflow.
 *
 * Deliberately does NOT use Laravel's built-in PasswordBroker, since that
 * assumes a `password` column — our schema uses `password_hash`
 * (see docs/MGAEMS_DatabaseSchema.docx §2, users table). Instead we manage
 * the password_reset_tokens table directly, which gives us full control
 * and keeps the security properties (single-use, expiring, hashed token)
 * explicit and easy to audit.
 */
class PasswordResetController extends Controller
{
    private const TOKEN_EXPIRY_MINUTES = 60;

    public function forgot(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'email' => ['required', 'email'],
        ]);

        $user = User::where('email', $validated['email'])->first();

        // Always return the same generic response whether or not the email
        // exists, so the endpoint can't be used to enumerate valid accounts.
        if ($user) {
            $plainToken = Str::random(64);

            // Issuance and consumption use the same user-first lock order.
            $user = DB::transaction(function () use ($user, $plainToken, $auditLogger) {
                $user = User::whereKey($user->id)->lockForUpdate()->firstOrFail();
                DB::table('password_reset_tokens')->updateOrInsert(
                    ['email' => $user->email],
                    ['token' => Hash::make($plainToken), 'created_at' => now()]
                );
                $auditLogger->log('PASSWORD_RESET_REQUESTED', 'User', $user->id);

                return $user;
            });

            $resetUrl = rtrim(config('app.url'), '/').'/reset-password?email='.
                urlencode($user->email).'&token='.$plainToken;

            Mail::to($user->email)->queue(
                new PasswordResetMail($resetUrl, self::TOKEN_EXPIRY_MINUTES)
            );
        }

        return response()->json([
            'data' => [
                'message' => 'If an account with that email exists, a password reset link has been sent.',
            ],
        ]);
    }

    public function reset(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'email' => ['required', 'email'],
            'token' => ['required', 'string'],
            'password' => ['required', 'string', 'min:10', 'confirmed'],
        ]);

        return DB::transaction(function () use ($validated, $auditLogger) {
            $user = User::where('email', $validated['email'])->lockForUpdate()->first();
            $record = DB::table('password_reset_tokens')
                ->where('email', $validated['email'])->lockForUpdate()->first();

            if (! $user || ! $record || ! Hash::check($validated['token'], $record->token)) {
                return response()->json([
                    'error' => ['code' => 'INVALID_TOKEN', 'message' => 'This reset link is invalid.'],
                ], 422);
            }

            // Existing offset-free database timestamps use the school timezone.
            // Compare instants in UTC; Carbon 3's signed diffInMinutes is unsuitable.
            $issuedAt = $this->issuedAt($record->created_at);
            $instant = now('UTC');
            $isExpired = ! $issuedAt || $issuedAt->greaterThan($instant)
                || $issuedAt->copy()->addMinutes(self::TOKEN_EXPIRY_MINUTES)->lessThanOrEqualTo($instant);

            if ($isExpired) {
                DB::table('password_reset_tokens')->where('email', $validated['email'])->delete();

                return response()->json([
                    'error' => ['code' => 'EXPIRED_TOKEN', 'message' => 'This reset link has expired. Please request a new one.'],
                ], 422);
            }

            $user->forceFill([
                'password_hash' => Hash::make($validated['password']),
                'session_version' => (int) $user->session_version + 1,
            ])->save();
            $user->tokens()->delete();

            // Single-use: delete the token immediately after a successful reset.
            DB::table('password_reset_tokens')->where('email', $validated['email'])->delete();

            $auditLogger->log('PASSWORD_RESET_COMPLETED', 'User', $user->id);

            return response()->json(['data' => ['message' => 'Password updated. You can now log in.']]);
        });
    }

    private function issuedAt($value): ?Carbon
    {
        if (! is_string($value) || ! preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/D', $value)) return null;
        try {
            $date = Carbon::parse($value, config('app.timezone'));
            // Reject normalised invalid dates instead of extending their lifetime.
            if ($date->format('Y-m-d H:i:s') !== substr($value, 0, 19)) return null;
            return $date->utc();
        } catch (\Throwable $exception) {
            return null;
        }
    }
}
