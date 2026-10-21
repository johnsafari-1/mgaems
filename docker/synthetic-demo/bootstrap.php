<?php

// This bootstrap is used only by the separate demo router/seeder, never by the app.
function syntheticDemoApp(): Illuminate\Foundation\Application
{
    foreach (['MGAEMS_SYNTHETIC_DEMO' => '1', 'APP_ENV' => 'synthetic_demo',
        'DB_HOST' => 'synthetic-mysql', 'DB_DATABASE' => 'mgaems_synthetic_demo',
        'DB_USERNAME' => 'synthetic_demo', 'MGAEMS_AI_DRIVER' => 'synthetic_demo'] as $key => $value) {
        if (getenv($key) !== $value) {
            throw new RuntimeException('Refusing to run outside the isolated synthetic demo: '.$key);
        }
    }
    require_once dirname(__DIR__, 2).'/vendor/autoload.php';
    $app = require dirname(__DIR__, 2).'/bootstrap/app.php';
    $app->useStoragePath('/synthetic-storage');
    foreach (['app/private', 'app/public', 'framework/cache/data', 'framework/sessions', 'framework/views', 'logs'] as $directory) {
        $path = $app->storagePath($directory);
        if (!is_dir($path) && !mkdir($path, 0775, true) && !is_dir($path)) {
            throw new RuntimeException('Cannot create isolated demo storage.');
        }
    }
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    if (config('app.env') !== 'synthetic_demo' || config('database.connections.mysql.host') !== 'synthetic-mysql'
        || config('database.connections.mysql.database') !== 'mgaems_synthetic_demo'
        || config('services.ai.driver') !== 'synthetic_demo' || $app->storagePath() !== '/synthetic-storage') {
        throw new RuntimeException('Unexpected resolved demo configuration.');
    }
    require_once __DIR__.'/Provider.php';
    $app->bind(App\Contracts\TeachingAssistantProvider::class, MgaemsSyntheticDemo\Provider::class);

    return $app;
}

function assertSyntheticDemoIdentity(bool $requireSeeded = true): void
{
    $db = Illuminate\Support\Facades\DB::connection();
    if ($db->getDriverName() !== 'mysql' || $db->getDatabaseName() !== 'mgaems_synthetic_demo') {
        throw new RuntimeException('Unexpected demo database connection.');
    }
    $identity = $db->table('synthetic_demo_identity')->where('id', 'mgaems-original-science-v1')->first();
    if (!$identity || $identity->server_uuid !== $db->selectOne('SELECT @@server_uuid AS uuid')->uuid || ($requireSeeded && !$identity->seeded)) {
        throw new RuntimeException('Demo database marker/server identity mismatch.');
    }
}
