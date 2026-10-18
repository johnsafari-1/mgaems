<?php

// The shared harness refuses dotenv/caches and uses SQLite :memory: exclusively.
require __DIR__.'/authorization.php';

use App\Models\Role;
use App\Models\Staff;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

function linkCheck(string $name, callable $operation): void {
    // Reset only the fixture's in-memory rate-limit cache between test cases.
    app('cache')->store('array')->flush();
    check($name, $operation);
}
function unclaimedStaff(string $type = 'teaching', string $state = 'active'): Staff {
    return Staff::create(['first_name' => 'Verified fixture', 'last_name' => 'Identity', 'staff_type' => $type, 'status' => $state]);
}
function linkContext(User $user): array {
    global $adminToken;
    $response = callApi('GET', 'users/'.$user->id.'/staff-link', $adminToken);
    status($response, 200);
    ensure(str_contains($response['response']->headers->get('Cache-Control'), 'no-store'), 'Identity context must not be cached');
    return $response['body']['data'];
}
function linkPayload(User $user, ?Staff $staff): array {
    $context = linkContext($user);
    $reference = $staff ? collect($context['staff_options'])->firstWhere('id', $staff->id) : $context['account_link']['staff'];
    // Pagination is explicit; tests query the selected fixture by its name.
    if (! $reference && $staff) {
        global $adminToken;
        $response = callApi('GET', 'users/'.$user->id.'/staff-link?search='.rawurlencode($staff->first_name), $adminToken);
        status($response, 200);
        $reference = collect($response['body']['data']['staff_options'])->firstWhere('id', $staff->id);
        for ($page = 2; ! $reference && ($page - 1) * 20 < $response['body']['data']['meta']['total']; $page++) {
            $response = callApi('GET', 'users/'.$user->id.'/staff-link?search='.rawurlencode($staff->first_name).'&page='.$page, $adminToken);
            status($response, 200);
            $reference = collect($response['body']['data']['staff_options'])->firstWhere('id', $staff->id);
        }
    }
    ensure($reference !== null, 'Reviewed Staff reference exists');
    return ['staff_id' => $staff?->id, 'expected_staff_id' => $context['account_link']['staff']['id'] ?? null,
        'expected_session_version' => $context['account_link']['version'], 'staff_revision' => $reference['revision'], 'identity_confirmed' => true];
}
function linkChange(User $user, array $payload): array {
    global $adminToken;
    return callApi('PATCH', 'users/'.$user->id.'/staff-link', $adminToken, $payload);
}

linkCheck('link context exposes only reviewed identity fields and requires administrator on both routes', function () use ($adminToken) {
    $target = actor(Role::TEACHER); $identity = unclaimedStaff(); $payload = linkPayload($target, $identity);
    $before = DB::table('audit_logs')->where('action', 'STAFF_ACCOUNT_LINK_REJECTED')->count();
    status(callApi('PATCH', 'users/'.$target->id.'/staff-link', null, $payload), 401);
    foreach ([Role::HEAD_TEACHER, Role::DEPUTY_HEAD_TEACHER, Role::TEACHER, Role::SPONSOR_COORDINATOR, Role::PARENT_GUARDIAN, Role::SPONSOR, Role::STUDENT] as $role) {
        $user = actor($role); if (in_array($role, Role::STAFF_ROLES, true)) staff($user);
        $issued = token($user);
        status(callApi('GET', 'users/'.$target->id.'/staff-link', $issued), 403, 'FORBIDDEN');
        status(callApi('PATCH', 'users/'.$target->id.'/staff-link', $issued, $payload + ['role' => Role::SYSTEM_ADMIN]), 403, 'FORBIDDEN');
    }
    ensure(DB::table('audit_logs')->where('action', 'STAFF_ACCOUNT_LINK_REJECTED')->count() === $before + 8, 'Every rejected mutation audited including unauthenticated and middleware-denied');
    ensure($identity->fresh()->user_id === null && $target->fresh()->session_version === 0, 'Denied requests change no identity');
    $context = linkContext($target);
    ensure(array_keys($context['user']) === ['id', 'username', 'role', 'status'], 'Minimal account projection');
    ensure(array_keys($context['staff_options'][0]) === ['id', 'name', 'staff_type', 'role_title', 'status', 'linked', 'revision', 'eligible', 'reason'], 'Minimal Staff projection');
});

linkCheck('administrator linking requires human confirmation and invalidates only affected cookies and tokens', function () use ($admin, $adminToken) {
    $target = actor(Role::TEACHER); $identity = unclaimedStaff(); $old = token($target); token($target);
    $cookie = sessionCookie($target); $headers = ['HTTP_ORIGIN' => 'http://localhost'];
    $unrelated = actor(Role::PARENT_GUARDIAN); $other = token($unrelated); $otherCookie = sessionCookie($unrelated);
    $payload = linkPayload($target, $identity); $payload['identity_confirmed'] = false;
    status(linkChange($target, $payload), 422);
    $payload['identity_confirmed'] = true;
    status(linkChange($target, $payload + ['user_id' => $unrelated->id]), 422);
    status(linkChange($target, $payload), 200);
    ensure($identity->fresh()->user_id === $target->id && $target->fresh()->session_version === 1 && $target->tokens()->count() === 0, 'Atomic link and revocation');
    status(callApi('GET', 'messages', $old), 401);
    status(callApi('GET', 'me', null, [], $cookie, $headers), 401);
    status(callApi('GET', 'me', $other), 200); status(callApi('GET', 'me', null, [], $otherCookie, $headers), 200);
    status(callApi('GET', 'users', $adminToken), 200);
    $login = callApi('POST', 'auth/login', null, ['username' => $target->username, 'password' => 'isolated-test-password']); status($login, 200);
    $fresh = $login['body']['data']['token']; status(callApi('GET', 'messages', $fresh), 200);
    // Employment membership supplies no academic assignment or technical powers.
    status(callApi('GET', 'attendance/my-classes', $fresh), 200);
    ensure(callApi('GET', 'attendance/my-classes', $fresh)['body']['data'] === [], 'No inferred class assignment');
    status(callApi('GET', 'users', $fresh), 403, 'FORBIDDEN');
    $audit = DB::table('audit_logs')->where('action', 'LINK_STAFF_ACCOUNT')->where('entity_id', $target->id)->first();
    ensure($audit && (int) $audit->user_id === $admin->id && json_decode($audit->details, true) === ['staff_id' => $identity->id], 'Success audit actor, target and safe Staff ID');
    $unlink = linkPayload($target, null); status(linkChange($target, $unlink), 200);
    ensure($identity->fresh()->user_id === null && $target->fresh()->session_version === 2, 'Unlink increments epoch');
    status(callApi('GET', 'messages', $fresh), 401);
    status(callApi('GET', 'messages', token($target)), 403, 'FORBIDDEN');
    ensure(DB::table('audit_logs')->where('action', 'UNLINK_STAFF_ACCOUNT')->where('entity_id', $target->id)->exists(), 'Unlink audit');
});

linkCheck('one-to-one links reject duplicate claims, replacement, stale versions and same-second identity edits', function () {
    $first = actor(Role::TEACHER); $second = actor(Role::TEACHER); $identity = unclaimedStaff(); $alternative = unclaimedStaff();
    $firstPayload = linkPayload($first, $identity); $secondPayload = linkPayload($second, $identity);
    status(linkChange($first, $firstPayload), 200);
    status(linkChange($second, $secondPayload), 409, 'STAFF_LINK_STALE');
    status(linkChange($second, linkPayload($second, $identity)), 409, 'STAFF_ALREADY_LINKED');
    status(linkChange($first, $firstPayload), 409, 'ACCOUNT_LINK_STALE');
    status(linkChange($first, linkPayload($first, $alternative)), 409, 'ACCOUNT_ALREADY_LINKED');
    ensure($identity->fresh()->user_id === $first->id && $alternative->fresh()->user_id === null && $second->fresh()->session_version === 0, 'Conflicts leave records unchanged');
    $reviewed = linkPayload($second, $alternative);
    DB::table('staff')->where('id', $alternative->id)->update(['first_name' => 'Changed fixture identity']);
    status(linkChange($second, $reviewed), 409, 'STAFF_LINK_STALE');
    $reviewed = linkPayload($second, $alternative); $reviewed['expected_session_version'] = 999;
    status(linkChange($second, $reviewed), 409, 'ACCOUNT_LINK_STALE');
});

linkCheck('inactive accounts, inactive Staff and incompatible roles cannot acquire new links', function () {
    foreach ([Role::PARENT_GUARDIAN, Role::SPONSOR, Role::STUDENT] as $role) {
        $target = actor($role); $identity = unclaimedStaff(); status(linkChange($target, linkPayload($target, $identity)), 422);
        ensure($identity->fresh()->user_id === null, 'Portal role unchanged');
    }
    foreach (['inactive', 'locked'] as $state) {
        $target = actor(Role::TEACHER); $issued = token($target); $target->update(['status' => $state]); $identity = unclaimedStaff();
        status(linkChange($target, linkPayload($target, $identity)), 422);
        status(callApi('GET', 'messages', $issued), 403, 'ACCOUNT_INACTIVE');
    }
    foreach (['on_leave', 'terminated'] as $state) {
        $target = actor(Role::TEACHER); $identity = unclaimedStaff('teaching', $state);
        status(linkChange($target, linkPayload($target, $identity)), 422);
        status(callApi('GET', 'messages', token($target)), 403, 'FORBIDDEN');
    }
    $target = actor(Role::TEACHER); $identity = unclaimedStaff('non_teaching');
    status(linkChange($target, linkPayload($target, $identity)), 422);
});

linkCheck('all four employment roles can be explicitly linked with role-appropriate Staff', function () {
    foreach (Role::STAFF_ROLES as $role) {
        $target = actor($role); $identity = unclaimedStaff($role === Role::TEACHER ? 'teaching' : 'non_teaching');
        status(linkChange($target, linkPayload($target, $identity)), 200);
        ensure(linkContext($target)['account_link']['eligible'] === true, 'Active role-compatible employment is eligible');
        status(callApi('GET', 'messages', token($target)), 200);
        status(linkChange($target, linkPayload($target, null)), 200);
        status(callApi('GET', 'messages', token($target)), 403, 'FORBIDDEN');
    }
});

linkCheck('optional administrator Staff membership grants no operational Health access', function () {
    $target = actor(Role::SYSTEM_ADMIN); $identity = unclaimedStaff('non_teaching');
    status(linkChange($target, linkPayload($target, $identity)), 200);
    $issued = token($target); status(callApi('GET', 'users', $issued), 200);
    status(callApi('GET', 'health/profiles', $issued), 403, 'FORBIDDEN');
    status(linkChange($target, linkPayload($target, null)), 200);
});

linkCheck('general HR fields cannot claim or release account identities including explicit null', function () use ($adminToken) {
    $target = actor(Role::TEACHER); $identity = unclaimedStaff();
    $head = actor(Role::HEAD_TEACHER); staff($head); $deputy = actor(Role::DEPUTY_HEAD_TEACHER); staff($deputy);
    foreach ([[$adminToken, 422], [token($head), 422], [token($deputy), 403]] as [$issued, $createStatus]) {
        foreach ([$target->id, null] as $owner) {
            status(callApi('PATCH', 'staff/'.$identity->id, $issued, ['user_id' => $owner]), 422);
            status(callApi('POST', 'staff', $issued, ['user_id' => $owner]), $createStatus);
        }
    }
    ensure($identity->fresh()->user_id === null, 'No raw relationship writes');
});

linkCheck('linked-role compatibility and employment updates revoke grants without broadening scopes', function () use ($adminToken) {
    $target = actor(Role::SPONSOR_COORDINATOR); $identity = unclaimedStaff('non_teaching');
    status(linkChange($target, linkPayload($target, $identity)), 200);
    $issued = token($target);
    status(callApi('PATCH', 'users/'.$target->id, $adminToken, ['role' => Role::TEACHER]), 422);
    status(callApi('PATCH', 'users/'.$target->id, $adminToken, ['role' => Role::PARENT_GUARDIAN]), 422);
    status(callApi('GET', 'messages', $issued), 200);
    $cookie = sessionCookie($target);
    status(callApi('PATCH', 'staff/'.$identity->id, $adminToken, ['status' => 'on_leave']), 200);
    status(callApi('GET', 'me', $issued), 401);
    status(callApi('GET', 'messages', token($target)), 403, 'FORBIDDEN');
    status(callApi('PATCH', 'staff/'.$identity->id, $adminToken, ['status' => 'active']), 200);
    status(callApi('GET', 'me', null, [], $cookie, ['HTTP_ORIGIN' => 'http://localhost']), 401);
    status(callApi('GET', 'messages', token($target)), 200);
    status(callApi('PATCH', 'staff/'.$identity->id, $adminToken, ['staff_type' => 'teaching']), 200);
    $old = token($target);
    status(callApi('PATCH', 'users/'.$target->id, $adminToken, ['role' => Role::TEACHER]), 200);
    status(callApi('GET', 'me', $old), 401);
    status(callApi('PATCH', 'staff/'.$identity->id, $adminToken, ['staff_type' => 'non_teaching']), 422);
});

linkCheck('audit failure rolls relationship, counter, all tokens and success audit back together', function () {
    $target = actor(Role::TEACHER); $identity = unclaimedStaff(); $issued = token($target); token($target);
    $payload = linkPayload($target, $identity); $audits = DB::table('audit_logs')->count();
    app()->instance(AuditLogger::class, new class(Request::create('/')) extends AuditLogger {
        public function log(string $action, ?string $entityType = null, ?int $entityId = null, array $details = []): App\Models\AuditLog {
            throw new RuntimeException('Isolated link audit failure');
        }
    });
    try { status(linkChange($target, $payload), 500); }
    finally { app()->forgetInstance(AuditLogger::class); }
    ensure($identity->fresh()->user_id === null && $target->fresh()->session_version === 0 && $target->tokens()->count() === 2, 'Full link rollback');
    ensure(DB::table('audit_logs')->count() === $audits, 'No partial audit');
    status(callApi('GET', 'me', $issued), 200);
    status(linkChange($target, $payload), 200);
    $issued = token($target); $payload = linkPayload($target, null);
    app()->instance(AuditLogger::class, new class(Request::create('/')) extends AuditLogger {
        public function log(string $action, ?string $entityType = null, ?int $entityId = null, array $details = []): App\Models\AuditLog { throw new RuntimeException('Isolated unlink failure'); }
    });
    try { status(linkChange($target, $payload), 500); }
    finally { app()->forgetInstance(AuditLogger::class); }
    ensure($identity->fresh()->user_id === $target->id && $target->fresh()->session_version === 1 && $target->tokens()->count() === 1, 'Full unlink rollback');
    status(callApi('GET', 'messages', $issued), 200);
});

linkCheck('rejected-link audit contains safe IDs and classifications without submitted private values', function () {
    $details = implode('\n', DB::table('audit_logs')->whereIn('action', ['LINK_STAFF_ACCOUNT', 'UNLINK_STAFF_ACCOUNT', 'STAFF_ACCOUNT_LINK_REJECTED'])->pluck('details')->all());
    foreach (['Verified fixture', 'Identity', 'isolated-test-password', 'password_hash', 'staff_revision', 'Bearer ', '@example.test'] as $secret) ensure(! str_contains($details, $secret), 'No private identity or credential in audit');
});

echo 'Staff account-link checks passed (including shared authorization): '.$passed.PHP_EOL;
