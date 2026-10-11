<?php

// Run only through health_mysql.ps1: an unnetworked disposable MySQL instance,
// read-only source/vendor mounts, no dotenv and no ordinary migration execution.
require dirname(__DIR__, 2).'/vendor/autoload.php';
$root = dirname(__DIR__, 2);
$app = require $root.'/bootstrap/app.php';
if ($app->configurationIsCached() || is_file($app->getCachedRoutesPath())
    || getenv('MGAEMS_DISPOSABLE_MYSQL') !== 'health-corrective-fixtures'
    || ! getenv('MGAEMS_TEST_MYSQL_PASSWORD')) {
    throw new RuntimeException('Refusing non-isolated MySQL test execution.');
}
$app->bootstrapWith([Illuminate\Foundation\Bootstrap\LoadConfiguration::class]);
$app['config']->set([
    'database.default' => 'health_disposable',
    'database.connections' => ['health_disposable' => [
        'driver' => 'mysql', 'host' => '127.0.0.1', 'port' => 3306,
        'database' => 'mgaems_health_corrective_tests', 'username' => 'root',
        'password' => getenv('MGAEMS_TEST_MYSQL_PASSWORD'), 'charset' => 'utf8mb4',
        'collation' => 'utf8mb4_unicode_ci', 'prefix' => '', 'strict' => true,
    ]],
    'app.env' => 'testing', 'app.debug' => false, 'app.timezone' => 'Africa/Nairobi',
    'app.key' => 'base64:'.base64_encode(str_repeat('t', 32)),
    'session.driver' => 'array', 'cache.default' => 'array',
    'cache.stores.array' => ['driver' => 'array', 'serialize' => false],
    'logging.default' => 'null',
    'logging.channels.null' => ['driver' => 'monolog', 'handler' => Monolog\Handler\NullHandler::class],
]);
$app->detectEnvironment(fn () => 'testing');
date_default_timezone_set('Africa/Nairobi');
$app->instance('request', Illuminate\Http\Request::create('/'));
$app->bootstrapWith([
    Illuminate\Foundation\Bootstrap\RegisterFacades::class,
    Illuminate\Foundation\Bootstrap\RegisterProviders::class,
    Illuminate\Foundation\Bootstrap\BootProviders::class,
]);

use App\Models\HealthAccessLog;
use App\Models\HealthRecordRevision;
use App\Rules\HealthInstant;
use App\Services\HealthView;
use Carbon\Carbon;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

function mysqlEnsure(bool $condition, string $message): void {
    if (! $condition) throw new RuntimeException($message);
}
$db = DB::connection();
mysqlEnsure($db->getDriverName() === 'mysql' && $db->getDatabaseName() === 'mgaems_health_corrective_tests'
    && $db->getConfig('host') === '127.0.0.1'
    && array_keys(config('database.connections')) === ['health_disposable'], 'Unexpected database configuration');
mysqlEnsure(DB::select('SHOW TABLES') === [], 'Refusing a nonempty disposable database');
DB::listen(function ($query) {
    mysqlEnsure($query->connection->getDatabaseName() === 'mgaems_health_corrective_tests', 'Unexpected query connection');
});

// Compile the actual pending migration without applying it. Exercise ORM storage
// below with narrow test-fixture DDL; no migration ledger or legacy data exists.
$planned = DB::pretend(fn () => (require $root.'/database/migrations/2026_10_10_000037_create_school_health_records.php')->up());
$plannedSql = implode("\n", array_column($planned, 'query'));
mysqlEnsure(! preg_match('/\btimestamp\b/i', $plannedSql) && substr_count(strtolower($plannedSql), 'datetime(6)') === 25,
    'Pending migration must define exactly 25 UTC DATETIME(6) columns and no TIMESTAMP');
echo 'PASS MySQL compiles the pending migration to 25 DATETIME(6) columns without applying it'.PHP_EOL;

$definitions = [
    'learner_health_profiles' => [App\Models\LearnerHealthProfile::class, ['recorded_at', 'reviewed_at']],
    'health_safety_alerts' => [App\Models\HealthSafetyAlert::class, ['verified_at']],
    'school_health_incidents' => [App\Models\SchoolHealthIncident::class, ['occurred_at', 'recorded_at']],
    'health_incident_actions' => [App\Models\HealthIncidentAction::class, ['action_at', 'recorded_at']],
    'health_guardian_notifications' => [App\Models\HealthGuardianNotification::class, ['attempted_at', 'recorded_at']],
    'health_external_referrals' => [App\Models\HealthExternalReferral::class, ['referred_at', 'recorded_at']],
    'health_record_revisions' => [HealthRecordRevision::class, ['recorded_at']],
    'health_access_logs' => [HealthAccessLog::class, ['recorded_at']],
];
foreach ($definitions as $table => [$model, $fields]) {
    Schema::create($table, function (Blueprint $blueprint) use ($model, $fields) {
        $blueprint->id();
        foreach ($fields as $field) $blueprint->dateTime($field, 6)->nullable();
        if (is_subclass_of($model, App\Models\HealthRecord::class)) {
            $blueprint->dateTime('created_at', 6)->nullable(); $blueprint->dateTime('updated_at', 6)->nullable();
        }
        if ($model === App\Models\HealthSafetyAlert::class) {
            $blueprint->date('starts_on')->nullable(); $blueprint->date('ends_on')->nullable();
        }
    });
}
$columns = DB::select("SELECT DATA_TYPE, DATETIME_PRECISION FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME LIKE '%_at'");
mysqlEnsure(count($columns) === 25, 'All health instant fixture columns present');
foreach ($columns as $column) mysqlEnsure($column->DATA_TYPE === 'datetime' && (int) $column->DATETIME_PRECISION === 6, 'MySQL DATETIME precision');
echo 'PASS MySQL fixture metadata confirms six-digit precision for every health instant column'.PHP_EOL;

Carbon::setTestNow(Carbon::parse('2040-02-02T12:00:00.654321+03:00'));
foreach (['1960-01-01T12:00:00.123456+03:00' => '1960-01-01 09:00:00.123456',
    '2026-10-10T12:00:00.123456+03:00' => '2026-10-10 09:00:00.123456',
    '2040-02-01T04:00:00.123456-05:00' => '2040-02-01 09:00:00.123456',
    '1000-01-01T00:00:00Z' => '1000-01-01 00:00:00.000000',
    '9999-12-31T23:59:59.999999Z' => '9999-12-31 23:59:59.999999'] as $input => $stored) {
    foreach ($definitions as $table => [$model, $fields]) {
        // The upper-range case verifies storage capability, not future-event acceptance.
        $attributes = array_fill_keys($fields, HealthInstant::parse($input));
        if ($model === App\Models\HealthSafetyAlert::class) $attributes += ['starts_on' => '2026-10-10', 'ends_on' => '2026-10-10'];
        $record = $model::create($attributes);
        $row = DB::table($table)->where('id', $record->id)->first();
        foreach ($fields as $field) mysqlEnsure($row->$field === $stored, 'Raw UTC storage across date range');
        if ($record->usesTimestamps()) {
            mysqlEnsure($row->created_at === '2040-02-02 09:00:00.654321' && $row->updated_at === $row->created_at, 'Generated metadata stores UTC');
        }
        foreach (['+00:00', '+03:00', '-05:00'] as $timezone) {
            DB::statement('SET SESSION time_zone = ?', [$timezone]);
            $raw = DB::table($table)->where('id', $record->id)->first();
            $fresh = $record->fresh();
            foreach ($fields as $field) {
                mysqlEnsure($raw->$field === $stored && $fresh->$field->format('Y-m-d H:i:s.u') === $stored
                    && $fresh->$field->getTimezone()->getName() === 'UTC', 'MySQL session timezone must not reinterpret Health DATETIME');
                mysqlEnsure($fresh->toArray()[$field] === $fresh->$field->toISOString(), 'Model serialization UTC');
            }
            if ($fresh instanceof App\Models\HealthRecord) {
                $view = (new HealthView)->record($fresh);
                foreach ($fields as $field) mysqlEnsure($view[$field] === $fresh->$field->toISOString(), 'API view serialization UTC');
            }
            if ($model === App\Models\HealthSafetyAlert::class) {
                mysqlEnsure($raw->starts_on === '2026-10-10' && $fresh->starts_on->toDateString() === '2026-10-10', 'Calendar dates do not shift');
            }
        }
    }
}
echo 'PASS all eight Health models preserve raw UTC storage and readback before 1970, after 2038 and at DATETIME bounds across three MySQL session timezones'.PHP_EOL;

$incident = App\Models\SchoolHealthIncident::create(['occurred_at' => HealthInstant::parse('2026-10-10T09:00:00.123456Z')]);
$action = App\Models\HealthIncidentAction::create(['action_at' => HealthInstant::parse('2026-10-10T12:00:00.123457+03:00')]);
mysqlEnsure($action->fresh()->action_at->gt($incident->fresh()->occurred_at), 'Fractional chronology retained');
mysqlEnsure(DB::table('health_incident_actions')->where('id', $action->id)
    ->where('action_at', '<', $incident->fromDateTime(HealthInstant::parse('2026-10-10T09:00:00.123458Z')))->exists(), 'MySQL comparison preserves microseconds');
echo 'PASS MySQL chronological comparisons retain microseconds and equivalent-offset ordering'.PHP_EOL;
Carbon::setTestNow();
echo 'Isolated MySQL checks passed: 4; no development connection or migration execution.'.PHP_EOL;
