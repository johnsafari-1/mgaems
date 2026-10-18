<?php

// Read-only active inventory. No migrations, fixtures, provider switching or inference.
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Services\CurriculumRetrieval;
use App\Services\OllamaService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

if (DB::connection()->getDriverName() !== 'mysql') {
    throw new RuntimeException('This inventory expects the existing MySQL application connection.');
}
DB::statement('SET TRANSACTION READ ONLY');
DB::beginTransaction();
try {
    $tables = [];
    foreach (['curriculum_sources', 'curriculum_source_versions', 'curriculum_records', 'curriculum_learning_outcomes'] as $table) {
        $tables[$table] = Schema::hasTable($table) ? DB::table($table)->count() : null;
    }
    $report = [
        'read_only' => true,
        'ai_driver' => config('services.ai.driver'),
        'ollama' => ['host' => parse_url((string) config('services.ollama.base_url'), PHP_URL_HOST), 'model' => config('services.ollama.model'), 'timeout' => config('services.ollama.timeout')],
        'curriculum_tables' => $tables,
        'class_columns' => Schema::getColumnListing('classes'),
        'classes' => DB::table('classes')->select('id', 'name', 'level', 'sequence')->orderBy('sequence')->get(),
        'subjects' => DB::table('subjects')->select('id', 'name', 'learning_area', 'status')->orderBy('id')->get(),
        'allocation_pairs' => DB::table('class_subject_teacher')->select('class_id', 'subject_id', 'term_id')->distinct()->orderBy('class_id')->orderBy('subject_id')->orderBy('term_id')->get(),
        'pilot_retrieval' => app(CurriculumRetrieval::class)->retrieve(['grade' => 7, 'learning_area' => 'Integrated Science']),
    ];
    if (!in_array(null, $tables, true)) {
        $report['sources'] = DB::table('curriculum_sources')->select('id', 'identifier', 'title', 'grade', 'learning_area', 'subject_id')->orderBy('id')->get();
        $report['versions'] = DB::table('curriculum_source_versions as v')->join('curriculum_sources as s', 's.id', '=', 'v.curriculum_source_id')
            ->select('s.identifier', 's.grade', 's.learning_area', 's.subject_id', 'v.id', 'v.edition', 'v.approval_status', 'v.verification_status')->orderBy('v.id')->get();
    }
    if (in_array('--ollama-models', $argv, true)) {
        try {
            $report['ollama']['installed_models'] = array_column(app(OllamaService::class)->models(), 'name');
            $report['ollama']['connectivity'] = 'reachable (model-list GET only; no inference)';
        } catch (RuntimeException $exception) {
            $report['ollama']['connectivity'] = $exception->getMessage();
        }
    }
    echo json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
} finally {
    DB::rollBack();
}
