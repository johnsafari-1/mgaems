<?php
// Only the owned network-isolated MySQL fixture runner may execute this file.
declare(strict_types=1);
function ensure(bool $ok, string $label): void { if (!$ok) { fwrite(STDERR, 'FAIL '.$label.PHP_EOL); exit(1); } }
function pass(string $label): void { echo 'PASS '.$label.PHP_EOL; }
$mode = $argv[1] ?? '';
ensure(in_array($mode, ['baseline', 'upgrade'], true), 'Explicit schema fixture mode');
ensure(getenv('MGAEMS_DISPOSABLE_STAGING') === 'fresh-mysql-fixture', 'Owned fixture marker');
ensure((bool)preg_match('/^mgaems_stage_test_[a-f0-9]{8}$/', getenv('DB_DATABASE') ?: ''), 'Owned fixture database');
ensure(getenv('DB_HOST') === '127.0.0.1' && getenv('DB_PORT') === '3306' && !is_file('/var/www/html/.env'), 'No development connection or dotenv');
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
set_exception_handler(static function (Throwable $exception): void { fwrite(STDERR, 'Fixture failed: '.get_class($exception).PHP_EOL); exit(1); });
$db = Illuminate\Support\Facades\DB::connection();
$identity = $db->selectOne('SELECT DATABASE() AS db, @@server_uuid AS uuid');
ensure((bool) preg_match('/^[a-f0-9-]{36}$/D', getenv('MGAEMS_TEST_MYSQL_UUID') ?: '')
    && $db->getDriverName() === 'mysql' && $identity->db === getenv('DB_DATABASE')
    && $identity->uuid === getenv('MGAEMS_TEST_MYSQL_UUID'), 'Verified disposable MySQL identity');
function schemaSnapshot($db): array {
    return [
        'columns' => $db->select('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION'),
        'indexes' => $db->select('SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX, INDEX_TYPE FROM information_schema.statistics WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX'),
        'foreign_keys' => $db->select('SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION'),
        'ledger' => $db->table('migrations')->orderBy('migration')->get(['migration', 'batch']),
        'users' => $db->table('users')->orderBy('id')->get(),
        'tokens' => $db->table('personal_access_tokens')->orderBy('id')->get(),
    ];
}
$disk = Illuminate\Support\Facades\Storage::disk('private');
$password = getenv('MGAEMS_TEST_ADMIN_PASSWORD') ?: '';
ensure(strlen($password) >= 16, 'Test-only credential required');
if ($mode === 'baseline') {
    ensure(version_compare(app()->version(), '11.0.0', '<'), 'Baseline must use locked Laravel 10 image');
    ensure(count($db->select('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()')) === 0, 'Empty baseline database');
    ensure(Illuminate\Support\Facades\Artisan::call('migrate', ['--force' => true]) === 0, 'Old schema installation');
    ensure($db->table('migrations')->count() === 39, 'Old vendor plus application migration ledger');
    (new Database\Seeders\RoleSeeder())->run();
    $user = App\Models\User::create(['username' => 'schema-fixture', 'email' => 'schema@example.invalid', 'password_hash' => password_hash($password, PASSWORD_BCRYPT, ['cost' => 4]),
        'role_id' => App\Models\Role::where('name', 'system_admin')->value('id'), 'status' => 'active']);
    $user->tokens()->create(['name' => 'old-device', 'token' => hash('sha256', $password.'|legacy'), 'abilities' => ['*']]);
    ensure($disk->put('verification/baseline-schema.json', json_encode(schemaSnapshot($db), JSON_THROW_ON_ERROR)), 'Synthetic schema snapshot');
    pass('Laravel 10 baseline installed with original vendor migration identity and one synthetic token');
    exit;
}
ensure(version_compare(app()->version(), '13.0.0', '>='), 'Upgrade must use Laravel 13');
$before = $disk->get('verification/baseline-schema.json');
ensure(Illuminate\Support\Facades\Artisan::call('migrate', ['--force' => true]) === 0, 'Existing schema migration');
ensure(json_encode(schemaSnapshot($db), JSON_THROW_ON_ERROR) === $before, 'Columns, indexes, foreign keys, ledger, credentials and tokens must remain identical');
pass('existing schema upgrade preserves all columns, indexes, foreign keys, migration ledger and token records');
ensure($db->table('migrations')->where('migration', '2019_12_14_000001_create_personal_access_tokens_table')->count() === 1 && $db->table('migrations')->count() === 39, 'No duplicate token-table migration');
ensure(count($db->select('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()')) === 43 && !$db->getSchemaBuilder()->hasTable('streams'), 'Final schema count and no Streams');
pass('39 migrations and 43 tables remain; no duplicate Sanctum creation');
$token = $db->table('personal_access_tokens')->first();
$request = Illuminate\Http\Request::create('http://localhost/api/v1/me', 'GET', [], [], [], ['HTTP_ACCEPT' => 'application/json', 'HTTP_AUTHORIZATION' => 'Bearer '.$token->id.'|'.$password.'|legacy']);
$kernel = app(Illuminate\Contracts\Http\Kernel::class); $response = $kernel->handle($request); $kernel->terminate($request, $response);
ensure($response->getStatusCode() === 200 && json_decode($response->getContent(), true)['data']['username'] === 'schema-fixture', 'Existing token authenticates under Sanctum 4');
pass('pre-upgrade Sanctum bearer token remains usable for its original owner');
$db->statement('CREATE TEMPORARY TABLE upgrade_upsert_probe (id BIGINT PRIMARY KEY, value VARCHAR(32) NOT NULL)');
$db->table('upgrade_upsert_probe')->upsert([['id' => 1, 'value' => 'first']], ['id'], ['value']);
$db->table('upgrade_upsert_probe')->upsert([['id' => 1, 'value' => 'second']], ['id'], ['value']);
ensure($db->table('upgrade_upsert_probe')->count() === 1 && $db->table('upgrade_upsert_probe')->value('value') === 'second', 'MySQL upsert behavior');
$refused = false;
try { $db->table('upgrade_upsert_probe')->upsert([['id' => 2, 'value' => 'invalid']], [], ['value']); }
catch (InvalidArgumentException $exception) { $refused = true; }
ensure($refused, 'Laravel 13 refuses empty uniqueBy');
pass('MySQL upsert updates one key and rejects empty uniqueBy');
foreach (['students','guardians','staff','sponsors','learner_health_profiles'] as $table) ensure($db->table($table)->count() === 0, 'No real or synthetic school records needed');
pass('existing-schema compatibility used no school-record fixtures');
