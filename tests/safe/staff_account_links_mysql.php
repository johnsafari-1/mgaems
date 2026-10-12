<?php

// Only the paired launcher supplies a RAM-only MySQL container. No dotenv,
// migrations, development connection, writable source or persistent fixtures.
require dirname(__DIR__, 2).'/vendor/autoload.php';
$root = dirname(__DIR__, 2);
$app = require $root.'/bootstrap/app.php';
if ($app->configurationIsCached() || is_file($app->getCachedRoutesPath())
    || getenv('MGAEMS_DISPOSABLE_MYSQL') !== 'staff-account-links'
    || ! getenv('MGAEMS_TEST_MYSQL_PASSWORD')) {
    throw new RuntimeException('Refusing non-isolated MySQL execution.');
}
$app->bootstrapWith([Illuminate\Foundation\Bootstrap\LoadConfiguration::class]);
$app['config']->set([
    'database.default' => 'link_fixtures',
    'database.connections' => ['link_fixtures' => [
        'driver' => 'mysql', 'host' => '127.0.0.1', 'port' => 3306,
        'database' => 'mgaems_staff_link_tests', 'username' => 'root',
        'password' => getenv('MGAEMS_TEST_MYSQL_PASSWORD'), 'charset' => 'utf8mb4',
        'collation' => 'utf8mb4_unicode_ci', 'prefix' => '', 'strict' => true,
    ]],
    'app.env' => 'testing', 'app.debug' => false,
    'app.key' => 'base64:'.base64_encode(str_repeat('f', 32)),
    'session.driver' => 'array', 'cache.default' => 'array',
    'cache.stores.array' => ['driver' => 'array', 'serialize' => false],
    'logging.default' => 'null',
    'logging.channels.null' => ['driver' => 'monolog', 'handler' => Monolog\Handler\NullHandler::class],
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
use App\Services\StaffAccountLinks;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

function assertFixture(bool $condition, string $message): void { if (! $condition) throw new RuntimeException($message); }
$db = DB::connection();
assertFixture($db->getDriverName() === 'mysql' && $db->getDatabaseName() === 'mgaems_staff_link_tests'
    && $db->getConfig('host') === '127.0.0.1' && array_keys(config('database.connections')) === ['link_fixtures'], 'Unexpected connection');
assertFixture(DB::selectOne('SELECT @@server_uuid AS uuid')->uuid !== '08778507-b858-11f1-a705-a6d841c8094c', 'Refusing development server');
DB::statement('SET SESSION innodb_lock_wait_timeout = 12');
DB::listen(function ($query) { assertFixture($query->connection->getDatabaseName() === 'mgaems_staff_link_tests', 'Unexpected query'); });

function fixtureRequest(int $actorId, int $tokenId, array $payload = []): Request {
    $actor = User::with('role')->findOrFail($actorId);
    $actor->withAccessToken($actor->tokens()->findOrFail($tokenId));
    $request = Request::create('/api/v1/users/1/staff-link', 'PATCH', $payload);
    app()->instance('request', $request);
    // Laravel's request rebind installs the guard resolver; override it afterward
    // because these narrow service fixtures intentionally do not run HTTP auth.
    $request->setUserResolver(fn () => $actor);
    return $request;
}
if (($argv[1] ?? null) === 'worker') {
    $job = json_decode(base64_decode($argv[2], true), true, 512, JSON_THROW_ON_ERROR);
    $request = fixtureRequest($job['actor'], $job['token'], $job['payload']);
    echo "READY\n"; flush();
    try {
        app(StaffAccountLinks::class)->change($request, $job['target'], new AuditLogger($request));
        echo "200\n";
    } catch (HttpResponseException $exception) { echo $exception->getResponse()->getStatusCode()."\n"; }
    exit;
}
assertFixture(DB::select('SHOW TABLES') === [], 'Refusing nonempty fixture database');
Schema::create('roles', function (Blueprint $t) { $t->id(); $t->string('name')->unique(); });
Schema::create('users', function (Blueprint $t) {
    $t->id(); $t->string('username')->unique(); $t->string('email')->unique(); $t->string('password_hash');
    $t->foreignId('role_id')->constrained(); $t->string('status'); $t->unsignedBigInteger('session_version')->default(0); $t->timestamps();
});
Schema::create('staff', function (Blueprint $t) {
    $t->id(); $t->foreignId('user_id')->nullable()->unique()->constrained('users')->nullOnDelete();
    $t->string('first_name'); $t->string('last_name'); $t->string('role_title')->nullable();
    $t->string('staff_type'); $t->string('status'); $t->unsignedBigInteger('department_id')->nullable(); $t->timestamps();
});
Schema::create('personal_access_tokens', function (Blueprint $t) {
    $t->id(); $t->morphs('tokenable'); $t->string('name'); $t->string('token', 64)->unique();
    $t->text('abilities')->nullable(); $t->timestamp('last_used_at')->nullable(); $t->timestamp('expires_at')->nullable(); $t->timestamps();
});
Schema::create('audit_logs', function (Blueprint $t) {
    $t->id(); $t->foreignId('user_id')->nullable()->constrained('users'); $t->string('action');
    $t->string('entity_type')->nullable(); $t->unsignedBigInteger('entity_id')->nullable();
    $t->text('details')->nullable(); $t->string('ip_address')->nullable(); $t->timestamp('created_at');
});
function fixtureUser(string $role = Role::TEACHER): User {
    static $id = 0; $id++;
    return User::create(['username' => 'fixture-'.$id, 'email' => 'fixture-'.$id.'@example.test', 'password_hash' => 'unused-fixture-hash',
        'role_id' => Role::firstOrCreate(['name' => $role])->id, 'status' => 'active']);
}
function fixtureStaff(): Staff { return Staff::create(['first_name' => 'Fixture', 'last_name' => 'Identity', 'staff_type' => 'teaching', 'status' => 'active']); }
$admin = fixtureUser(Role::SYSTEM_ADMIN); $adminToken = $admin->createToken('fixture')->accessToken;
$request = fixtureRequest($admin->id, $adminToken->id);
function job(User $target, Staff $staff): array {
    global $admin, $adminToken, $request;
    assertFixture((int) $request->user()?->id === (int) $admin->id && User::with('role')->find($admin->id)?->role?->name === Role::SYSTEM_ADMIN, 'Fixture request must resolve administrator identity');
    $context = app(StaffAccountLinks::class)->context($request, $target->id);
    $selected = collect($context['staff_options'])->firstWhere('id', $staff->id);
    return ['actor' => $admin->id, 'token' => $adminToken->id, 'target' => $target->id, 'payload' => [
        'staff_id' => $staff->id, 'expected_staff_id' => null, 'expected_session_version' => 0,
        'staff_revision' => $selected['revision'], 'identity_confirmed' => true,
    ]];
}
function race(array $jobs, ?callable $whileLocked = null): array {
    $workers = []; $pipesList = [];
    DB::beginTransaction();
    Role::where('name', Role::SYSTEM_ADMIN)->lockForUpdate()->firstOrFail();
    try {
        foreach ($jobs as $job) {
            $pipes = [];
            $process = proc_open([PHP_BINARY, '-d', 'zend.exception_ignore_args=1', __FILE__, 'worker', base64_encode(json_encode($job, JSON_THROW_ON_ERROR))],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            assertFixture(is_resource($process), 'Worker creation');
            fclose($pipes[0]); stream_set_timeout($pipes[1], 20);
            $workers[] = $process; $pipesList[] = $pipes;
            assertFixture(trim(fgets($pipes[1]) ?: '') === 'READY', 'Worker loaded reviewed request before administrative lock released');
        }
        if ($whileLocked) $whileLocked();
        DB::commit();
        $statuses = [];
        foreach ($workers as $index => $process) {
            $pipes = $pipesList[$index]; $output = stream_get_contents($pipes[1]); $errors = stream_get_contents($pipes[2]);
            fclose($pipes[1]); fclose($pipes[2]); $code = proc_close($process);
            assertFixture($code === 0 && $errors === '', 'Worker completed without exception');
            $statuses[] = (int) trim($output);
        }
        return $statuses;
    } finally {
        if (DB::transactionLevel()) DB::rollBack();
        foreach ($workers as $process) if (is_resource($process)) { proc_terminate($process); proc_close($process); }
    }
}

$first = fixtureUser(); $second = fixtureUser(); $identity = fixtureStaff();
$first->createToken('fixture'); $second->createToken('fixture');
$statuses = race([job($first, $identity), job($second, $identity)]); sort($statuses);
assertFixture($statuses === [200, 409], 'Same Staff race produces one success and one conflict');
$winner = $identity->fresh()->user_id; $loser = $winner === $first->id ? $second : $first;
assertFixture(User::find($winner)->session_version === 1 && User::find($winner)->tokens()->count() === 0
    && $loser->fresh()->session_version === 0 && $loser->tokens()->count() === 1, 'Only winner revoked');
assertFixture(DB::table('audit_logs')->where('action', 'LINK_STAFF_ACCOUNT')->count() === 1, 'One committed success audit');
echo 'PASS real concurrent MySQL claims of one Staff identity commit exactly one link, revocation and audit'.PHP_EOL;

$target = fixtureUser(); $a = fixtureStaff(); $b = fixtureStaff(); $target->createToken('fixture');
$statuses = race([job($target, $a), job($target, $b)]); sort($statuses);
assertFixture($statuses === [200, 409] && Staff::where('user_id', $target->id)->count() === 1
    && $target->fresh()->session_version === 1 && $target->tokens()->count() === 0, 'Same User race has one winning Staff');
echo 'PASS real concurrent MySQL claims of one User preserve the unique relationship and one session advance'.PHP_EOL;

$context = app(StaffAccountLinks::class)->context($request, $target->id);
$unlinkRequest = fixtureRequest($admin->id, $adminToken->id, [
    'staff_id' => null, 'expected_staff_id' => $context['account_link']['staff']['id'],
    'expected_session_version' => $context['account_link']['version'],
    'staff_revision' => $context['account_link']['staff']['revision'], 'identity_confirmed' => true,
]);
app(StaffAccountLinks::class)->change($unlinkRequest, $target->id, new AuditLogger($unlinkRequest));
assertFixture(Staff::where('user_id', $target->id)->count() === 0 && $target->fresh()->session_version === 2, 'MySQL unlink with reviewed revision');
echo 'PASS MySQL unlink accepts the current identity revision and advances the epoch atomically'.PHP_EOL;

$target = fixtureUser(); $identity = fixtureStaff(); $target->createToken('fixture'); $payload = job($target, $identity)['payload'];
$request = fixtureRequest($admin->id, $adminToken->id, $payload);
$before = DB::table('audit_logs')->count();
$broken = new class($request) extends AuditLogger {
    public function log(string $action, ?string $entityType = null, ?int $entityId = null, array $details = []): App\Models\AuditLog {
        parent::log($action, $entityType, $entityId, $details);
        throw new RuntimeException('Injected fixture failure after audit insert');
    }
};
try { app(StaffAccountLinks::class)->change($request, $target->id, $broken); throw new LogicException('Expected audit failure'); }
catch (RuntimeException $e) { assertFixture($e->getMessage() === 'Injected fixture failure after audit insert', 'Expected injected failure'); }
assertFixture($identity->fresh()->user_id === null && $target->fresh()->session_version === 0
    && $target->tokens()->count() === 1 && DB::table('audit_logs')->count() === $before, 'Full MySQL transaction rollback');
echo 'PASS MySQL rollback restores relationship, session version, token and even an already inserted audit'.PHP_EOL;

$request = fixtureRequest($admin->id, $adminToken->id);
$target = fixtureUser(); $identity = fixtureStaff(); $queued = job($target, $identity);
$statuses = race([$queued], function () use ($admin) {
    $admin->update(['role_id' => Role::firstOrCreate(['name' => Role::PARENT_GUARDIAN])->id]);
});
assertFixture($statuses === [403] && $identity->fresh()->user_id === null, 'Administrator demoted after authentication cannot commit queued mutation');
echo 'PASS queued MySQL operation rechecks administrator authorization after locking'.PHP_EOL;
$admin->update(['role_id' => Role::where('name', Role::SYSTEM_ADMIN)->firstOrFail()->id]);
$request = fixtureRequest($admin->id, $adminToken->id); $queued = job($target, $identity);
$statuses = race([$queued], function () use ($admin) { $admin->increment('session_version'); $admin->tokens()->delete(); });
assertFixture($statuses === [401] && $identity->fresh()->user_id === null, 'Revoked queued authorization cannot commit');
echo 'PASS queued MySQL operation rechecks actor epoch and token revocation after locking'.PHP_EOL;
echo 'MySQL account-link checks passed: 6'.PHP_EOL;
