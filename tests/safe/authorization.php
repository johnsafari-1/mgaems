<?php

// Standalone HTTP regressions: no dotenv, PHPUnit config, repository migrations,
// persistent database or file fixtures. Refuse caches that can override isolation.
require dirname(__DIR__, 2).'/vendor/autoload.php';
$root = dirname(__DIR__, 2);
$app = require $root.'/bootstrap/app.php';
if (realpath($app->basePath()) !== realpath($root) || $app->configurationIsCached() || is_file($app->getCachedRoutesPath())) {
    throw new RuntimeException('Refusing an unexpected application path or cached configuration/routes.');
}
$app->bootstrapWith([Illuminate\Foundation\Bootstrap\LoadConfiguration::class]);
$app['config']->set([
    'database.default' => 'authorization_memory',
    'database.connections' => ['authorization_memory' => [
        'driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '', 'foreign_key_constraints' => true,
    ]],
    'session.driver' => 'array',
    'cache.default' => 'array',
    'cache.stores.array' => ['driver' => 'array', 'serialize' => false],
    'app.env' => 'testing',
    'app.debug' => false,
    'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
    'logging.default' => 'null',
    'logging.channels.null' => ['driver' => 'monolog', 'handler' => Monolog\Handler\NullHandler::class],
    'sanctum.stateful' => ['localhost'],
    'auth.defaults.guard' => 'web',
    'hashing.bcrypt.rounds' => 4,
]);
$app->detectEnvironment(fn () => 'testing');
$app->instance('request', Illuminate\Http\Request::create('/'));
$app->bootstrapWith([
    Illuminate\Foundation\Bootstrap\RegisterFacades::class,
    Illuminate\Foundation\Bootstrap\RegisterProviders::class,
    Illuminate\Foundation\Bootstrap\BootProviders::class,
]);

use App\Models\Role;
use App\Models\Staff;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Cookie\CookieValuePrefix;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

$connection = DB::connection();
if ($connection->getDriverName() !== 'sqlite' || $connection->getDatabaseName() !== ':memory:'
    || array_keys(config('database.connections')) !== ['authorization_memory']) {
    throw new RuntimeException('Refusing any database except the sole in-memory SQLite connection.');
}
DB::listen(function ($query) {
    if ($query->connection->getDriverName() !== 'sqlite' || $query->connection->getDatabaseName() !== ':memory:') {
        throw new RuntimeException('Unexpected database connection.');
    }
});

Schema::create('roles', function (Blueprint $table) { $table->id(); $table->string('name')->unique(); });
Schema::create('users', function (Blueprint $table) {
    $table->id(); $table->string('username')->unique(); $table->string('email')->unique(); $table->string('password_hash');
    $table->foreignId('role_id')->constrained(); $table->string('status'); $table->timestamp('last_login_at')->nullable(); $table->timestamps();
});
Schema::create('personal_access_tokens', function (Blueprint $table) {
    $table->id(); $table->morphs('tokenable'); $table->string('name'); $table->string('token', 64)->unique();
    $table->text('abilities')->nullable(); $table->timestamp('last_used_at')->nullable(); $table->timestamp('expires_at')->nullable(); $table->timestamps();
});
Schema::create('staff', function (Blueprint $table) {
    $table->id(); $table->foreignId('user_id')->nullable()->unique()->constrained('users');
    $table->string('first_name'); $table->string('last_name'); $table->string('staff_type'); $table->string('status');
    $table->string('phone')->nullable(); $table->timestamps();
});
Schema::create('audit_logs', function (Blueprint $table) {
    $table->id(); $table->foreignId('user_id')->nullable()->constrained('users'); $table->string('action');
    $table->string('entity_type')->nullable(); $table->unsignedBigInteger('entity_id')->nullable();
    $table->text('details')->nullable(); $table->string('ip_address')->nullable(); $table->timestamp('created_at');
});
Schema::create('academic_years', function (Blueprint $table) { $table->id(); $table->string('name'); $table->date('start_date'); });
Schema::create('classes', function (Blueprint $table) {
    $table->id(); $table->string('name'); $table->string('level'); $table->integer('sequence');
    $table->foreignId('class_teacher_id')->nullable()->constrained('staff');
});
Schema::create('subjects', function (Blueprint $table) { $table->id(); $table->string('name'); $table->string('code'); $table->string('status'); });
Schema::create('class_subjects', function (Blueprint $table) { $table->id(); $table->foreignId('class_id'); $table->foreignId('subject_id'); });
Schema::create('terms', function (Blueprint $table) {
    $table->id(); $table->foreignId('academic_year_id'); $table->string('name');
    $table->date('start_date'); $table->date('end_date'); $table->boolean('is_current');
});
Schema::create('class_subject_teacher', function (Blueprint $table) {
    $table->id(); $table->foreignId('class_id'); $table->foreignId('staff_id'); $table->foreignId('subject_id'); $table->foreignId('term_id'); $table->timestamps();
});
Schema::create('visitors', function (Blueprint $table) { $table->id(); $table->date('visit_date'); });
Schema::create('messages', function (Blueprint $table) { $table->id(); $table->foreignId('sender_id'); $table->foreignId('recipient_id'); $table->timestamp('sent_at'); });
Schema::create('students', function (Blueprint $table) {
    $table->id(); $table->string('admission_no'); $table->string('first_name'); $table->string('last_name');
    $table->foreignId('class_id'); $table->string('status');
});
Schema::create('guardians', function (Blueprint $table) { $table->id(); $table->foreignId('student_id'); $table->foreignId('user_id'); });
Schema::create('sponsors', function (Blueprint $table) { $table->id(); $table->foreignId('user_id'); });
Schema::create('sponsorships', function (Blueprint $table) {
    $table->id(); $table->foreignId('sponsor_id'); $table->foreignId('student_id')->nullable(); $table->string('program_name')->nullable();
    $table->string('sponsorship_type'); $table->string('status'); $table->date('start_date'); $table->date('end_date')->nullable();
});

function ensure(bool $condition, string $message): void { if (! $condition) throw new RuntimeException($message); }
function actor(string $role): User {
    static $number = 0;
    $number++;
    return User::create(['username' => 'authorization-'.$number, 'email' => 'authorization-'.$number.'@example.test',
        'password_hash' => Hash::make('isolated-test-password'), 'role_id' => Role::firstOrCreate(['name' => $role])->id, 'status' => 'active']);
}
function staff(User $user, string $status = 'active', string $type = 'teaching'): Staff {
    return Staff::create(['user_id' => $user->id, 'first_name' => 'Fixture', 'last_name' => 'Staff', 'staff_type' => $type, 'status' => $status]);
}
function token(User $user): string { return $user->createToken('isolated-fixture')->plainTextToken; }
function callApi(string $method, string $path, ?string $token = null, array $data = [], array $cookies = [], array $headers = []): array {
    Auth::forgetGuards();
    Auth::shouldUse('web');
    // Each simulated request starts without another request's session attributes.
    // StartSession reloads cookie-backed data from the in-memory handler when needed.
    app('session')->driver()->flush();
    $server = ['HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'application/json'];
    if ($token) $server['HTTP_AUTHORIZATION'] = 'Bearer '.$token;
    $request = Request::create('http://localhost/api/v1/'.$path, $method, [], $cookies, [], $server + $headers, json_encode($data));
    $kernel = app(Kernel::class);
    $response = $kernel->handle($request);
    $kernel->terminate($request, $response);
    return ['status' => $response->getStatusCode(), 'body' => json_decode($response->getContent(), true), 'response' => $response];
}
function status(array $response, int $expected, ?string $code = null): void {
    ensure($response['status'] === $expected, 'Expected HTTP '.$expected.', got '.$response['status'].' '.json_encode($response['body']));
    if ($code) ensure(($response['body']['error']['code'] ?? null) === $code, 'Unexpected error code');
}
function sessionCookie(User $user): array {
    Auth::forgetGuards(); Auth::shouldUse('web');
    $session = app('session')->driver(); $session->flush(); $session->regenerate();
    $session->put(Auth::guard('web')->getName(), $user->id); $session->regenerateToken();
    $id = $session->getId(); $session->save();
    $name = config('session.cookie');
    return [$name => app('encrypter')->encrypt(CookieValuePrefix::create($name, app('encrypter')->getKey()).$id, false)];
}
function check(string $name, callable $operation): void {
    global $passed;
    $operation(); $passed++; echo 'PASS '.$name.PHP_EOL;
}
$passed = 0;
$admin = actor(Role::SYSTEM_ADMIN); $adminToken = token($admin);
$secondAdmin = actor(Role::SYSTEM_ADMIN);

check('every protected production API route retains shared authentication', function () {
    $public = ['api/v1/auth/login', 'api/v1/auth/password/forgot', 'api/v1/auth/password/reset'];
    $count = 0;
    foreach (app('router')->getRoutes() as $route) {
        if (! str_starts_with($route->uri(), 'api/v1/') || in_array($route->uri(), $public, true)) continue;
        ensure(in_array('auth:sanctum', $route->gatherMiddleware(), true), 'Unprotected API route: '.$route->uri()); $count++;
    }
    ensure($count > 100, 'Production routes were loaded');
});
check('unauthenticated and credential failures retain existing response conventions', function () {
    $response = callApi('GET', 'me'); status($response, 401);
    ensure($response['body'] === ['message' => 'Unauthenticated.'], 'Original unauthenticated convention');
    $user = actor(Role::PARENT_GUARDIAN);
    $response = callApi('POST', 'auth/login', null, ['username' => $user->username, 'password' => 'incorrect-fixture-password']);
    status($response, 422); ensure(isset($response['body']['message'], $response['body']['errors']['username']), 'Original validation convention');
});
check('active login, me and token logout preserve response shape and other devices', function () {
    $user = actor(Role::PARENT_GUARDIAN); $otherDevice = token($user);
    $login = callApi('POST', 'auth/login', null, ['username' => $user->email, 'password' => 'isolated-test-password']);
    status($login, 200); $issued = $login['body']['data']['token'];
    ensure(array_keys($login['body']['data']['user']) === ['id', 'username', 'email', 'role'], 'Login shape');
    $me = callApi('GET', 'me', $issued); status($me, 200);
    ensure(array_keys($me['body']['data']) === ['id', 'username', 'email', 'role', 'status'], 'Me shape');
    ensure($user->fresh()->last_login_at !== null, 'Last login recorded');
    $logout = callApi('POST', 'auth/logout', $issued); status($logout, 200);
    ensure($logout['body'] === ['data' => ['message' => 'Logged out.']], 'Logout shape');
    status(callApi('GET', 'me', $issued), 401); status(callApi('GET', 'me', $otherDevice), 200);
});
check('login failure throttling retains its limit, response code and token safety', function () {
    $user = actor(Role::PARENT_GUARDIAN);
    $credentials = ['username' => $user->username, 'password' => 'incorrect-fixture-password'];
    for ($attempt = 0; $attempt < 5; $attempt++) status(callApi('POST', 'auth/login', null, $credentials), 422);
    status(callApi('POST', 'auth/login', null, $credentials), 429, 'TOO_MANY_ATTEMPTS');
    $credentials['password'] = 'isolated-test-password';
    status(callApi('POST', 'auth/login', null, $credentials), 429, 'TOO_MANY_ATTEMPTS');
    ensure($user->tokens()->count() === 0, 'Throttled login issued no tokens');
});
check('inactive and locked accounts cannot log in or use existing tokens on any route class', function () {
    foreach (['inactive', 'locked'] as $state) {
        foreach ([Role::SYSTEM_ADMIN => 'users', Role::PARENT_GUARDIAN => 'portal/parent/children', Role::SPONSOR => 'portal/sponsor/sponsorships'] as $role => $path) {
            $user = actor($role); $issued = token($user);
            // Deliberately bypass the account API to prove per-request checks
            // also protect tokens surviving legacy/bulk status changes.
            DB::table('users')->where('id', $user->id)->update(['status' => $state]);
            foreach (['me', 'academic-years', $path, 'auth/logout'] as $protected) {
                status(callApi($protected === 'auth/logout' ? 'POST' : 'GET', $protected, $issued), 403, 'ACCOUNT_INACTIVE');
            }
            $before = $user->tokens()->count();
            status(callApi('POST', 'auth/login', null, ['username' => $user->username, 'password' => 'isolated-test-password']), 403, 'ACCOUNT_INACTIVE');
            ensure($user->tokens()->count() === $before, 'Inactive login issued no tokens');
        }
    }
});
check('both account APIs atomically revoke all target tokens, including locked and repeated deactivation', function () use ($adminToken, $admin) {
    foreach (['patch-inactive', 'patch-locked', 'delete'] as $operation) {
        $user = actor(Role::TEACHER); $first = token($user); $second = token($user);
        $user->createToken('expired-fixture', ['*'], now()->subDay());
        $otherCount = $admin->tokens()->count();
        $response = $operation === 'delete' ? callApi('DELETE', 'users/'.$user->id, $adminToken)
            : callApi('PATCH', 'users/'.$user->id, $adminToken, ['status' => $operation === 'patch-locked' ? 'locked' : 'inactive']);
        status($response, 200); ensure($user->tokens()->count() === 0, 'All target tokens deleted');
        ensure($admin->tokens()->count() === $otherCount, 'Other accounts unaffected');
        status(callApi('GET', 'me', $first), 401); status(callApi('GET', 'me', $second), 401);
        status(callApi('PATCH', 'users/'.$user->id, $adminToken, ['status' => 'active']), 200);
        status(callApi('GET', 'me', $first), 401);
        $login = callApi('POST', 'auth/login', null, ['username' => $user->username, 'password' => 'isolated-test-password']); status($login, 200);
        status(callApi('GET', 'me', $login['body']['data']['token']), 200);
        status(callApi('DELETE', 'users/'.$user->id, $adminToken), 200);
        // Defensive cleanup also applies to an already-inactive account.
        token($user); status(callApi('DELETE', 'users/'.$user->id, $adminToken), 200);
        ensure($user->tokens()->count() === 0, 'Repeated deactivation clears stray tokens');
    }
});
check('failed deactivation rolls back status, revocation and audit together', function () use ($adminToken) {
    $user = actor(Role::TEACHER); $issued = token($user); $audits = DB::table('audit_logs')->count();
    app()->instance(AuditLogger::class, new class(Request::create('/')) extends AuditLogger {
        public function log(string $action, ?string $entityType = null, ?int $entityId = null, array $details = []): App\Models\AuditLog {
            throw new RuntimeException('Isolated audit failure');
        }
    });
    try {
        foreach (['PATCH', 'DELETE'] as $method) {
            status(callApi($method, 'users/'.$user->id, $adminToken, ['status' => 'inactive']), 500);
            ensure($user->fresh()->status === 'active' && $user->tokens()->count() === 1, 'Atomic rollback for '.$method);
        }
    }
    finally { app()->forgetInstance(AuditLogger::class); }
    ensure($user->fresh()->status === 'active' && $user->tokens()->count() === 1, 'Atomic rollback');
    ensure(DB::table('audit_logs')->count() === $audits, 'No partial audit');
    status(callApi('GET', 'me', $issued), 200);
});
check('Staff-dependent roles require current active linkage, ignoring spoofed IDs and stale relationships', function () {
    foreach (Role::STAFF_ROLES as $role) {
        $user = actor($role); $issued = token($user);
        status(callApi('GET', 'messages?staff_id=1&role=system_admin', $issued), 403, 'FORBIDDEN');
        $staff = staff($user); status(callApi('GET', 'messages', $issued), 200);
        $user->load('staff'); // Middleware must query current linkage.
        foreach (['on_leave', 'terminated'] as $state) {
            $staff->update(['status' => $state]); status(callApi('GET', 'messages', $issued), 403, 'FORBIDDEN');
        }
        $staff->update(['status' => 'active', 'user_id' => null]);
        status(callApi('GET', 'messages', $issued), 403, 'FORBIDDEN');
        $replacement = actor($role); $staff->update(['user_id' => $replacement->id]);
        status(callApi('GET', 'messages', $issued), 403, 'FORBIDDEN');
        status(callApi('GET', 'messages', token($replacement)), 200);
        $staff->delete(); status(callApi('GET', 'messages', token($replacement)), 403, 'FORBIDDEN');
        // Loss of employment permissions leaves shared authenticated endpoints
        // and logout available while the user account itself remains active.
        status(callApi('GET', 'me', $issued), 200); status(callApi('POST', 'auth/logout', $issued), 200);
    }
});
check('Parent, Sponsor and non-Staff administrator access and ownership scopes are preserved', function () use ($adminToken, $admin) {
    status(callApi('GET', 'users', $adminToken), 200); status(callApi('GET', 'attendance/my-classes', $adminToken), 200);
    staff($admin, 'terminated', 'non_teaching');
    status(callApi('GET', 'users', $adminToken), 200);
    foreach ([Role::PARENT_GUARDIAN => 'portal/parent/children', Role::SPONSOR => 'portal/sponsor/sponsorships'] as $role => $path) {
        $user = actor($role); $issued = token($user);
        // An unrelated terminated Staff row must not disable portal permissions.
        staff($user, 'terminated', 'non_teaching');
        $response = callApi('GET', $path, $issued); status($response, 200); ensure($response['body']['data'] === [], 'Unlinked portal has no owned records');
        status(callApi('GET', 'messages', $issued), 200);
        status(callApi('GET', 'users', $issued), 403, 'FORBIDDEN');
        status(callApi('GET', 'attendance/my-classes', $issued), 403, 'FORBIDDEN');
    }
    $student = actor(Role::STUDENT); $issued = token($student);
    status(callApi('GET', 'academic-years', $issued), 200); status(callApi('GET', 'messages', $issued), 403, 'FORBIDDEN');
});
check('Attendance class ownership and Assessment assignment scopes survive the shared gate', function () use ($adminToken) {
    $teacher = actor(Role::TEACHER); $staff = staff($teacher); $issued = token($teacher);
    $own = DB::table('classes')->insertGetId(['name' => 'Owned', 'level' => 'primary', 'sequence' => 1, 'class_teacher_id' => $staff->id]);
    $foreign = DB::table('classes')->insertGetId(['name' => 'Foreign', 'level' => 'primary', 'sequence' => 2]);
    // A subject assignment to the foreign class confers no Attendance ownership.
    DB::table('class_subject_teacher')->insert(['class_id' => $foreign, 'staff_id' => $staff->id, 'subject_id' => 123, 'term_id' => 456]);
    $response = callApi('GET', 'attendance/my-classes', $issued); status($response, 200);
    ensure(array_column($response['body']['data'], 'id') === [$own], 'Only class-teacher-owned class');
    status(callApi('GET', 'attendance/roster?class_id='.$foreign.'&attendance_date=2026-01-01', $issued), 403);
    $response = callApi('GET', 'assessments/context', $issued); status($response, 200);
    ensure($response['body']['data']['scope'] === 'assigned' && count($response['body']['data']['assignments']) === 1, 'Assessment assigned scope');
    $unassigned = actor(Role::TEACHER); staff($unassigned);
    $response = callApi('GET', 'assessments/context', token($unassigned)); status($response, 200);
    ensure($response['body']['data']['assignments'] === [], 'No unassigned context disclosure');
    $nonTeaching = actor(Role::TEACHER); staff($nonTeaching, 'active', 'non_teaching'); $nonTeachingToken = token($nonTeaching);
    status(callApi('GET', 'attendance/my-classes', $nonTeachingToken), 403);
    status(callApi('GET', 'assessments/context', $nonTeachingToken), 403);
    foreach ([Role::HEAD_TEACHER, Role::DEPUTY_HEAD_TEACHER] as $role) {
        $leader = actor($role); staff($leader); $leaderToken = token($leader);
        $response = callApi('GET', 'attendance/my-classes', $leaderToken); status($response, 200);
        ensure(count($response['body']['data']) === 2, 'Leadership retains school-wide attendance');
        $response = callApi('GET', 'assessments/context', $leaderToken); status($response, 200);
        ensure($response['body']['data']['scope'] === 'school', 'Leadership retains school-wide assessment');
    }
    $response = callApi('GET', 'assessments/context', $adminToken); status($response, 200);
    ensure($response['body']['data']['scope'] === 'school', 'Non-Staff administrator school-wide scope');
});
check('Staff status and linkage API changes remove permissions without personal values in audit details', function () use ($adminToken) {
    $user = actor(Role::TEACHER); $staff = staff($user); $issued = token($user);
    status(callApi('PATCH', 'staff/'.$staff->id, $adminToken, ['status' => 'on_leave', 'phone' => 'fixture-phone']), 200);
    $details = json_decode(DB::table('audit_logs')->where('action', 'UPDATE_STAFF')->latest('id')->value('details'), true);
    ensure($details === ['changes' => ['phone', 'status']], 'Only changed field names audited');
    status(callApi('GET', 'messages', $issued), 403, 'FORBIDDEN');
    status(callApi('PATCH', 'staff/'.$staff->id, $adminToken, ['status' => 'active', 'user_id' => null]), 200);
    status(callApi('GET', 'messages', $issued), 403, 'FORBIDDEN');
});
check('encrypted Sanctum sessions reject inactive accounts and invalidate the requesting session', function () {
    foreach (['inactive', 'locked'] as $state) {
        $user = actor(Role::PARENT_GUARDIAN); $cookie = sessionCookie($user);
        status(callApi('GET', 'me', null, [], $cookie, ['HTTP_ORIGIN' => 'http://localhost']), 200);
        DB::table('users')->where('id', $user->id)->update(['status' => $state]);
        status(callApi('GET', 'academic-years', null, [], $cookie, ['HTTP_ORIGIN' => 'http://localhost']), 403, 'ACCOUNT_INACTIVE');
        DB::table('users')->where('id', $user->id)->update(['status' => 'active']);
        status(callApi('GET', 'me', null, [], $cookie, ['HTTP_ORIGIN' => 'http://localhost']), 401);
    }
});
check('account API deactivation denies pre-existing Sanctum sessions as well as revoking tokens', function () use ($adminToken) {
    foreach (['PATCH', 'DELETE'] as $method) {
        $user = actor(Role::PARENT_GUARDIAN); $issued = token($user); $cookie = sessionCookie($user);
        status(callApi('GET', 'me', null, [], $cookie, ['HTTP_ORIGIN' => 'http://localhost']), 200);
        status(callApi($method, 'users/'.$user->id, $adminToken, ['status' => 'inactive']), 200);
        ensure($user->tokens()->count() === 0, 'Session account tokens revoked');
        status(callApi('GET', 'me', $issued), 401);
        status(callApi('GET', 'me', null, [], $cookie, ['HTTP_ORIGIN' => 'http://localhost']), 403, 'ACCOUNT_INACTIVE');
    }
});
check('Staff-dependent session permissions track current employment and linkage', function () {
    foreach (Role::STAFF_ROLES as $role) {
        $user = actor($role); $staff = staff($user); $cookie = sessionCookie($user);
        $headers = ['HTTP_ORIGIN' => 'http://localhost'];
        status(callApi('GET', 'messages', null, [], $cookie, $headers), 200);
        $staff->update(['status' => 'terminated']);
        status(callApi('GET', 'messages', null, [], $cookie, $headers), 403, 'FORBIDDEN');
        $staff->update(['status' => 'active']);
        status(callApi('GET', 'messages', null, [], $cookie, $headers), 200);
        $staff->update(['user_id' => null]);
        status(callApi('GET', 'messages', null, [], $cookie, $headers), 403, 'FORBIDDEN');
        status(callApi('GET', 'me', null, [], $cookie, $headers), 200);
    }
});
check('authentication refreshes cached account status and roles without losing the current token', function () {
    $user = actor(Role::SYSTEM_ADMIN); $user->load('role');
    $issued = $user->createToken('cached-identity');
    $user->withAccessToken($issued->accessToken);
    Auth::forgetGuards(); Auth::shouldUse('web'); Auth::guard('web')->setUser($user);
    $request = Request::create('/api/v1/me'); $request->headers->set('Accept', 'application/json');
    $request->setUserResolver(fn () => Auth::user());
    $middleware = new App\Http\Middleware\Authenticate(app('auth'));
    $parentRole = Role::firstOrCreate(['name' => Role::PARENT_GUARDIAN]);
    DB::table('users')->where('id', $user->id)->update(['role_id' => $parentRole->id]);
    $middleware->handle($request, function () use ($user, $issued) {
        ensure($user->hasRole(Role::PARENT_GUARDIAN), 'Cached administrator role replaced');
        ensure($user->currentAccessToken()->is($issued->accessToken), 'Current access token retained');
        return response()->json(['data' => []]);
    }, 'web');
    DB::table('users')->where('id', $user->id)->update(['status' => 'inactive']);
    try {
        $middleware->handle($request, function () { throw new LogicException('Inactive request reached protected code'); }, 'web');
        throw new LogicException('Expected inactive rejection');
    } catch (Illuminate\Http\Exceptions\HttpResponseException $exception) {
        ensure($exception->getResponse()->getStatusCode() === 403 && $user->status === 'inactive', 'Current account state enforced');
    }
});
check('session role changes take effect and session logout preserves bearer tokens and response', function () {
    $user = actor(Role::SYSTEM_ADMIN); $issued = token($user); $cookie = sessionCookie($user);
    status(callApi('GET', 'users', null, [], $cookie, ['HTTP_ORIGIN' => 'http://localhost']), 200);
    $role = Role::firstOrCreate(['name' => Role::PARENT_GUARDIAN]);
    DB::table('users')->where('id', $user->id)->update(['role_id' => $role->id]);
    status(callApi('GET', 'users', null, [], $cookie, ['HTTP_ORIGIN' => 'http://localhost']), 403, 'FORBIDDEN');
    $response = callApi('POST', 'auth/logout', null, [], $cookie, ['HTTP_ORIGIN' => 'http://localhost']); status($response, 200);
    ensure($response['body'] === ['data' => ['message' => 'Logged out.']], 'Session logout shape');
    status(callApi('GET', 'me', null, [], $cookie, ['HTTP_ORIGIN' => 'http://localhost']), 401);
    status(callApi('GET', 'me', $issued), 200);
});
check('the last active administrator remains protected and unauthorized users cannot change accounts', function () use ($admin, $secondAdmin, $adminToken) {
    $third = actor(Role::SYSTEM_ADMIN); $thirdToken = token($third);
    status(callApi('PATCH', 'users/'.$third->id, $adminToken, ['role' => Role::PARENT_GUARDIAN]), 200);
    status(callApi('GET', 'users', $thirdToken), 403, 'FORBIDDEN');
    foreach (User::where('status', 'active')->whereHas('role', fn ($q) => $q->where('name', Role::SYSTEM_ADMIN))->where('id', '!=', $admin->id)->get() as $other) {
        status(callApi('DELETE', 'users/'.$other->id, $adminToken), 200);
    }
    $before = $admin->tokens()->count();
    foreach ([['PATCH', ['status' => 'inactive']], ['PATCH', ['status' => 'locked']], ['PATCH', ['role' => Role::TEACHER]], ['DELETE', []]] as [$method, $data]) {
        status(callApi($method, 'users/'.$admin->id, $adminToken, $data), 409, 'LAST_ADMIN_PROTECTED');
    }
    ensure($admin->fresh()->status === 'active' && $admin->tokens()->count() === $before, 'Protected administrator and tokens unchanged');
    status(callApi('PATCH', 'users/'.$admin->id, $thirdToken, ['role' => Role::TEACHER]), 403, 'FORBIDDEN');
    status(callApi('DELETE', 'users/'.$admin->id, $thirdToken), 403, 'FORBIDDEN');
});
check('authorization audit details contain no passwords, hashes, tokens, cookies or Staff personal values', function () {
    $details = implode('\n', DB::table('audit_logs')->pluck('details')->filter()->all());
    foreach (['isolated-test-password', 'incorrect-fixture-password', 'fixture-phone', 'password_hash', 'Bearer ', 'base64:'] as $secret) {
        ensure(! str_contains($details, $secret), 'Sensitive fixture or key found in audit details');
    }
    foreach (DB::table('personal_access_tokens')->pluck('token') as $hash) ensure(! str_contains($details, $hash), 'Token hash found in audit details');
});
echo 'Authorization checks passed: '.$passed.PHP_EOL;
