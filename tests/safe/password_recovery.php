<?php

// Full HTTP/Sanctum/session behavior, with mail faked and all fixtures in RAM.
require __DIR__.'/health_safety.php';

use App\Mail\PasswordResetMail;
use App\Models\AuditLog;
use App\Models\Role;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;

$recoveryStart = $passed;
Carbon::setTestNow(Carbon::parse('2026-10-10T12:00:00+03:00'));
Schema::create('password_reset_tokens', function (Blueprint $table) {
    $table->string('email')->primary(); $table->string('token'); $table->timestamp('created_at')->nullable();
});
Mail::fake();

function recoveryCall(string $path, array $data): array {
    app('cache')->store('array')->flush();
    return callApi('POST', 'auth/password/'.$path, null, $data);
}
function recoveryLink(User $user, string $plain = 'RAM-single-use-reset-link'): array {
    DB::table('password_reset_tokens')->updateOrInsert(['email' => $user->email], ['token' => Hash::make($plain), 'created_at' => now()]);

    return ['email' => $user->email, 'token' => $plain, 'password' => 'RAM-new-recovery-password', 'password_confirmation' => 'RAM-new-recovery-password'];
}
function ordinarySessionRequest(array $cookies): array {
    app('cache')->store('array')->flush();
    return callApi('GET', 'me', null, [], $cookies, ['HTTP_ORIGIN' => 'http://localhost']);
}

check('forgot preserves generic responses and issues a hashed usable single-use link without revocation', function () {
    $user = actor(Role::PARENT_GUARDIAN); $issued = token($user);
    $known = recoveryCall('forgot', ['email' => $user->email]); status($known, 200);
    $unknown = recoveryCall('forgot', ['email' => 'absent-recovery@example.test']); status($unknown, 200);
    ensure($known['body'] === $unknown['body'], 'Recovery response does not enumerate accounts');
    $payload = null;
    Mail::assertQueued(PasswordResetMail::class, function ($mail) use ($user, &$payload) {
        parse_str(parse_url($mail->resetUrl, PHP_URL_QUERY), $payload);
        return $mail->hasTo($user->email) && $mail->expiresInMinutes === 60;
    });
    ensure($payload && Hash::check($payload['token'], DB::table('password_reset_tokens')->where('email', $user->email)->value('token')), 'Only hashed link stored');
    ensure((int) $user->fresh()->session_version === 0 && $user->tokens()->count() === 1, 'Issuance does not revoke');
    status(callApi('GET', 'me', $issued), 200);
    $payload += ['password' => 'RAM-new-recovery-password', 'password_confirmation' => 'RAM-new-recovery-password'];
    $reset = recoveryCall('reset', $payload); status($reset, 200);
    ensure($reset['body'] === ['data' => ['message' => 'Password updated. You can now log in.']], 'Success shape preserved');
    status(recoveryCall('reset', $payload), 422, 'INVALID_TOKEN');
});

check('Parent Sponsor and non-Staff administrator recovery revokes all tokens and old versioned or legacy sessions', function () {
    foreach ([Role::PARENT_GUARDIAN, Role::SPONSOR, Role::SYSTEM_ADMIN] as $role) {
        $user = actor($role); $oldOne = token($user); $oldTwo = token($user);
        $versioned = healthSession($user); $legacy = sessionCookie($user);
        status(ordinarySessionRequest($versioned), 200); status(ordinarySessionRequest($legacy), 200);
        $link = recoveryLink($user); status(recoveryCall('reset', $link), 200);
        $current = $user->fresh();
        ensure(Hash::check($link['password'], $current->password_hash) && (int) $current->session_version === 1, 'Credential and epoch updated');
        ensure($user->tokens()->count() === 0 && ! $user->staff()->exists(), 'All tokens revoked without Staff');
        foreach ([$oldOne, $oldTwo] as $old) status(callApi('GET', 'me', $old), 401);
        status(ordinarySessionRequest($versioned), 401); status(ordinarySessionRequest($legacy), 401);
        status(callApi('POST', 'auth/login', null, ['username' => $user->username, 'password' => 'isolated-test-password']), 422);
        $login = callApi('POST', 'auth/login', null, ['username' => $user->email, 'password' => $link['password']]); status($login, 200);
        status(callApi('GET', 'me', $login['body']['data']['token']), 200);
        status(ordinarySessionRequest(healthSession($current)), 200);
        status(healthCall('GET', 'profiles', $login['body']['data']['token']), 403, 'FORBIDDEN');
    }
});

check('Head and Deputy reset invalidate old Health sessions and tokens while fresh logins retain approved access', function () {
    foreach ([Role::HEAD_TEACHER, Role::DEPUTY_HEAD_TEACHER] as $role) {
        $user = actor($role); staff($user); $old = token($user); $cookie = healthSession($user);
        status(healthCall('GET', 'profiles', null, [], $cookie), 200);
        status(recoveryCall('reset', recoveryLink($user)), 200);
        status(healthCall('GET', 'profiles', $old), 401);
        status(healthCall('GET', 'profiles', null, [], $cookie), 401);
        status(healthCall('GET', 'profiles', null, [], healthSession($user->fresh())), 200);
        status(healthCall('GET', 'profiles', token($user->fresh())), 200);
    }
});

check('inactive recovery cannot reactivate an account or revive revoked Health sessions after reactivation', function () use ($adminToken) {
    $user = actor(Role::HEAD_TEACHER); staff($user); $old = token($user); $cookie = healthSession($user);
    status(callApi('PATCH', 'users/'.$user->id, $adminToken, ['status' => 'inactive']), 200);
    ensure((int) $user->fresh()->session_version === 1, 'Deactivation advances epoch');
    $link = recoveryLink($user); status(recoveryCall('reset', $link), 200);
    ensure($user->fresh()->status === 'inactive' && (int) $user->fresh()->session_version === 2, 'Reset preserves inactive status');
    status(callApi('POST', 'auth/login', null, ['username' => $user->username, 'password' => $link['password']]), 403, 'ACCOUNT_INACTIVE');
    status(callApi('PATCH', 'users/'.$user->id, $adminToken, ['status' => 'active']), 200);
    status(healthCall('GET', 'profiles', null, [], $cookie), 401);
    status(healthCall('GET', 'profiles', $old), 401);
    ensure((int) $user->fresh()->session_version === 2, 'Reactivation retains durable epoch');
    status(healthCall('GET', 'profiles', null, [], healthSession($user->fresh())), 200);
});

check('invalid expired and malformed reset requests leave credentials tokens and sessions unchanged', function () {
    $user = actor(Role::SPONSOR); $old = token($user); $cookie = healthSession($user);
    $link = recoveryLink($user); $before = $user->fresh()->getAttributes();
    status(recoveryCall('reset', array_replace($link, ['token' => 'wrong-RAM-link'])), 422, 'INVALID_TOKEN');
    status(recoveryCall('reset', array_replace($link, ['password_confirmation' => 'mismatch'])), 422);
    DB::table('password_reset_tokens')->where('email', $user->email)->update(['created_at' => now()->subMinutes(62)]);
    status(recoveryCall('reset', $link), 422, 'EXPIRED_TOKEN');
    ensure($user->fresh()->getAttributes() === $before && $user->tokens()->count() === 1, 'Rejected reset preserves identity and token');
    status(ordinarySessionRequest($cookie), 200); status(callApi('GET', 'me', $old), 200);
    ensure(! DB::table('password_reset_tokens')->where('email', $user->email)->exists(), 'Expired link consumed');
});

check('reset failure rolls back password epoch tokens single-use link and success audit together', function () {
    $user = actor(Role::SPONSOR); $old = token($user); $link = recoveryLink($user);
    $before = $user->fresh()->getAttributes(); $auditCount = DB::table('audit_logs')->count(); $fail = true;
    AuditLog::creating(function ($log) use (&$fail, $user) {
        if ($fail && $log->action === 'PASSWORD_RESET_COMPLETED' && $log->entity_id === $user->id) {
            $fail = false; throw new RuntimeException('RAM transactional failure');
        }
    });
    status(recoveryCall('reset', $link), 500);
    ensure($user->fresh()->getAttributes() === $before && $user->tokens()->count() === 1, 'Credential revocation rolled back');
    ensure(DB::table('password_reset_tokens')->where('email', $user->email)->exists(), 'Link remains usable after rollback');
    ensure(DB::table('audit_logs')->count() === $auditCount, 'No misleading success audit');
    status(callApi('GET', 'me', $old), 200); status(recoveryCall('reset', $link), 200);
});

check('a login using a password replaced between initial verification and locked token issuance is rejected', function () {
    $user = actor(Role::PARENT_GUARDIAN); $replace = true;
    $replacement = Hash::make('RAM-raced-new-password');
    // Deterministic simulation of a reset committing between login's two reads.
    User::retrieved(function ($retrieved) use ($user, &$replace, $replacement) {
        if ($replace && $retrieved->id === $user->id) {
            $replace = false;
            DB::table('users')->where('id', $user->id)->update(['password_hash' => $replacement, 'session_version' => 1]);
        }
    });
    app('cache')->store('array')->flush();
    status(callApi('POST', 'auth/login', null, ['username' => $user->username, 'password' => 'isolated-test-password']), 422);
    ensure($user->tokens()->count() === 0, 'Stale password cannot issue post-reset token');
    status(callApi('POST', 'auth/login', null, ['username' => $user->username, 'password' => 'RAM-raced-new-password']), 200);
});

check('current-device logout still preserves other devices and recovery audit excludes credential material', function () {
    $user = actor(Role::PARENT_GUARDIAN); $one = token($user); $two = token($user); $cookie = healthSession($user);
    $version = (int) $user->fresh()->session_version;
    status(callApi('POST', 'auth/logout', $one), 200); status(callApi('GET', 'me', $one), 401);
    status(callApi('GET', 'me', $two), 200); status(ordinarySessionRequest($cookie), 200);
    ensure((int) $user->fresh()->session_version === $version, 'Device logout keeps epoch');
    foreach (DB::table('audit_logs')->whereIn('action', ['PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED'])->get() as $entry) {
        ensure($entry->details === null, 'Recovery audit has no credential, token, email or payload details');
    }
});

check('existing role-change epochs now invalidate ordinary cookie sessions without revoking legitimate bearer access', function () use ($adminToken) {
    $user = actor(Role::PARENT_GUARDIAN); $cookie = healthSession($user); $issued = token($user);
    status(ordinarySessionRequest($cookie), 200);
    status(callApi('PATCH', 'users/'.$user->id, $adminToken, ['role' => Role::SPONSOR]), 200);
    status(ordinarySessionRequest($cookie), 401);
    status(callApi('GET', 'me', $issued), 200);
    status(ordinarySessionRequest(healthSession($user->fresh())), 200);
});

Carbon::setTestNow();
echo 'Password recovery checks passed: '.($passed - $recoveryStart).PHP_EOL;
