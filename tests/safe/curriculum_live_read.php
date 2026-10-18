<?php

// Read-only live inspection. Never creates fixtures or executes migrations.
use App\Services\CurriculumRetrieval;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (config('database.default') !== 'mysql' || config('database.connections.mysql.host') !== 'mysql') {
    throw new RuntimeException('Expected the existing Docker application database.');
}
$target = storage_path('app/private/curriculum-pilot/live-install-baseline.json');
if (in_array('--baseline', $argv, true)) {
    $tables = array_map(fn ($row) => array_values((array) $row)[0], DB::select('SHOW TABLES'));
    if (in_array('curriculum_sources', $tables, true)) {
        throw new RuntimeException('Curriculum library is already installed.');
    }
    $checksums = [];
    foreach (DB::select('CHECKSUM TABLE '.implode(', ', array_map(fn ($table) => '`'.$table.'`', $tables))) as $row) {
        if (! str_ends_with($row->Table, '.migrations')) {
            $checksums[$row->Table] = $row->Checksum;
        }
    }
    file_put_contents($target, json_encode(['checksums' => $checksums, 'migration_rows' => DB::table('migrations')->count()], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT));
    echo 'PASS read-only baseline captured for '.count($checksums).' existing non-migration tables'.PHP_EOL;
} elseif (in_array('--verify', $argv, true) || in_array('--verify-uninstalled', $argv, true)) {
    $before = json_decode(file_get_contents($target), true, 512, JSON_THROW_ON_ERROR);
    $checksums = [];
    foreach (DB::select('CHECKSUM TABLE '.implode(', ', array_map(fn ($name) => '`'.str_replace('.', '`.`', $name).'`', array_keys($before['checksums'])))) as $row) {
        $checksums[$row->Table] = $row->Checksum;
    }
    if ($checksums !== $before['checksums']) {
        throw new RuntimeException('Existing table checksums changed; inspect concurrent writes before making any preservation claim.');
    }
    if (in_array('--verify-uninstalled', $argv, true)) {
        if (DB::table('migrations')->count() !== $before['migration_rows'] || Schema::hasTable('curriculum_sources')) {
            throw new RuntimeException('Unexpected live schema change.');
        }
        echo 'PASS active migration count and all existing data checksums unchanged; curriculum migration not applied'.PHP_EOL;
        $sample = app(CurriculumRetrieval::class)->retrieve(['grade' => 7, 'learning_area' => 'Integrated Science']);
        if (($sample['reason'] ?? '') !== 'CURRICULUM_LIBRARY_NOT_INSTALLED') {
            throw new RuntimeException('Pending installation did not fail closed.');
        }
        echo json_encode(['data' => $sample], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT).PHP_EOL;
        file_put_contents(storage_path('app/private/curriculum-pilot/live-retrieval-sample.json'), json_encode(['data' => $sample], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT));
        exit(0);
    }
    if (DB::table('migrations')->count() !== $before['migration_rows'] + 1) {
        throw new RuntimeException('Unexpected migration repository change.');
    }
    foreach (['curriculum_sources', 'curriculum_source_versions', 'curriculum_records', 'curriculum_learning_outcomes'] as $table) {
        if (DB::table($table)->count() !== 0) {
            throw new RuntimeException('Unexpected curriculum content: '.$table);
        }
    }
    echo 'PASS all existing non-migration table checksums preserved; four curriculum tables empty; one migration row added'.PHP_EOL;
    $sample = app(CurriculumRetrieval::class)->retrieve(['grade' => 7, 'learning_area' => 'Integrated Science']);
    if ($sample['available'] !== false || $sample['records'] !== []) {
        throw new RuntimeException('Unexpected verified pilot content.');
    }
    echo json_encode(['data' => $sample], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT).PHP_EOL;
    file_put_contents(storage_path('app/private/curriculum-pilot/live-retrieval-sample.json'), json_encode(['data' => $sample], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT));
} else {
    throw new RuntimeException('Choose --baseline, --verify or --verify-uninstalled explicitly.');
}
