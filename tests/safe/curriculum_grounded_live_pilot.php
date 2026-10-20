<?php

// Opt-in live inference extension of the existing deterministic HTTP pilot.
// No dotenv is loaded: its prerequisite replaces ALL DB connections before boot.
// Run only in a throwaway container with private tmpfs storage and source mounted RO.
if (! in_array('--synthetic', $argv, true) || ! in_array('--live-ollama', $argv, true)) {
    throw new RuntimeException('Both --synthetic and --live-ollama are required.');
}
require __DIR__.'/curriculum_grounded_pilot.php';

use App\Services\OllamaService;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;

ensure(count(config('database.connections')) === 1 && DB::connection()->getDriverName() === 'sqlite' && DB::connection()->getDatabaseName() === ':memory:', 'Live pilot refuses persistent databases.');
DB::listen(function ($query) {
    ensure($query->connection->getDriverName() === 'sqlite' && $query->connection->getDatabaseName() === ':memory:', 'Unexpected database connection.');
});
ensure(str_starts_with(Storage::disk('private')->path(''), storage_path('framework/testing/')), 'Private storage must be the isolated fake disk.');

// Schemes are unique per allocation; keep the deterministic prerequisite's scheme.
$liveClass = pilotApi($admin, 'POST', 'classes', ['name' => 'Synthetic live-model Grade 7', 'level' => 'junior', 'sequence' => 7], 201);
$liveOffering = ['class_id' => $liveClass['id'], 'subject_id' => $area->id];
pilotApi($admin, 'POST', 'class-subjects', $liveOffering, 201);
$allocation = (object) pilotApi($admin, 'POST', 'teacher-assignments', $liveOffering + ['staff_id' => $teacherStaff->id, 'term_id' => $term->id], 201);

// Original material with a genuine one-page PDF, not a third-party curriculum.
$outcome = 'Read two thermometer values in degrees Celsius and identify the warmer sample.';
$record = ['record_key' => 'original.temperature.phase7', 'strand' => 'Observing and measuring', 'sub_strand' => 'Temperature readings', 'page_reference' => 'Original synthetic sheet, page 1',
    'specific_learning_outcomes' => [$outcome],
    'suggested_learning_experiences' => ['Read diagrams labelled 20 and 30 degrees Celsius; the 30-degree sample is warmer.', 'Compare a change from 22 to 27 degrees Celsius: warmer by 5 degrees Celsius.'],
    'key_inquiry_questions' => ['Which thermometer reading represents the warmer sample?'],
    'assessment_approaches' => ['Record both readings with units and explain the warmer comparison.']];
$source = pilotApi($admin, 'POST', 'curriculum-library/sources', ['identifier' => 'phase7-original-temperature', 'title' => 'Original synthetic temperature sheet; not KICD',
    'publisher' => 'MGAEMS original software-test fixtures', 'official_url' => 'https://example.invalid/phase7-temperature', 'grade' => 7, 'learning_area' => $area->name, 'subject_id' => $area->id], 201);
$pdf = new Dompdf\Dompdf();
$pdf->loadHtml('<h1>Original synthetic temperature sheet</h1><p>Not official curriculum. Grade 7 software-test material only.</p><p>'.htmlspecialchars($outcome).'</p><p>Observing and measuring: Temperature readings</p><p>Diagram A: 20 degrees Celsius. Diagram B: 30 degrees Celsius. B is warmer.</p><p>A change from 22 to 27 degrees Celsius is warmer by 5 degrees Celsius.</p><p>Read both values, compare them, then explain which sample is warmer.</p>');
$pdf->render();
$version = pilotApi($admin, 'POST', 'curriculum-library/sources/'.$source['id'].'/versions', ['edition' => 'Original synthetic phase7 v1', 'document_url' => 'https://example.invalid/phase7-temperature.pdf',
    'authorization_basis' => 'Original text authored solely as software-test fixtures; no third-party or official curriculum content. Used only in this disposable in-memory test.'], 201,
    UploadedFile::fake()->createWithContent('phase7-original.pdf', $pdf->output()));
pilotApi($admin, 'POST', 'curriculum-library/versions/'.$version['id'].'/records', ['records' => [$record]], 201);
$review = pilotApi($admin, 'GET', 'curriculum-library/versions/'.$version['id']);
pilotApi($admin, 'POST', 'curriculum-library/versions/'.$version['id'].'/approve', ['document_sha256' => $version['document_sha256'], 'content_sha256' => $review['review_content_sha256'],
    'actual_document_checked' => true, 'extracted_content_checked' => true, 'authorized_use_confirmed' => true,
    'verification_notes' => 'Automated original fixture approval in isolated SQLite only, not a school reviewer or KICD approval. PDF and structured text share the same original examples and outcome.']);

// Fixed local host only; do not accept arbitrary remote endpoints/prompts.
config(['services.ai.driver' => 'ollama', 'services.ollama.base_url' => 'http://host.docker.internal:11434', 'services.ollama.model' => 'qwen3:1.7b', 'services.ollama.timeout' => 120]);
Http::swap(new Factory);
$transport = [];
$diagnostic = in_array('--no-think-diagnostic', $argv, true);
Http::globalRequestMiddleware(function ($request) use ($diagnostic) {
    ensure((string) $request->getUri() === 'http://host.docker.internal:11434/api/chat' || (string) $request->getUri() === 'http://host.docker.internal:11434/api/tags', 'Unexpected live inference destination.');
    if ($diagnostic && $request->getMethod() === 'POST') {
        $body = json_decode((string) $request->getBody(), true, 512, JSON_THROW_ON_ERROR);
        // Test-process-only experiment: unchanged application transport uses format=json.
        $body['think'] = false;
        $prompt = json_decode($body['messages'][1]['content'], true, 512, JSON_THROW_ON_ERROR);
        $body['format'] = $prompt['output_contract'];
        $body['options'] = ['num_predict' => 2048, 'temperature' => 0];
        return $request->withBody(GuzzleHttp\Psr7\Utils::streamFor(json_encode($body, JSON_THROW_ON_ERROR)))->withoutHeader('Content-Length');
    }
    return $request;
});
Http::globalResponseMiddleware(function ($response) use (&$transport) {
    $body = json_decode((string) $response->getBody(), true);
    if (is_array($body) && isset($body['message'])) $transport = [
        'done' => $body['done'] ?? null, 'done_reason' => $body['done_reason'] ?? null,
        'total_duration_seconds' => isset($body['total_duration']) ? round($body['total_duration'] / 1e9, 3) : null,
        'load_duration_seconds' => isset($body['load_duration']) ? round($body['load_duration'] / 1e9, 3) : null,
        'prompt_eval_count' => $body['prompt_eval_count'] ?? null, 'eval_count' => $body['eval_count'] ?? null,
        'thinking_characters' => strlen($body['message']['thinking'] ?? ''),
        'content' => $body['message']['content'] ?? null,
    ];
    return $response;
});
foreach (app('router')->getRoutes() as $route) $route->flushController();
ensure(in_array('qwen3:1.7b', array_column(app(OllamaService::class)->models(), 'name'), true), 'Qwen3 model missing.');
$results = []; $valid = 0;
foreach ($documents as $operation => $spec) {
    $document = pilotApi($teacher, 'POST', $spec['path'], array_replace($spec['input'], ['class_subject_teacher_id' => $allocation->id]), 201);
    $url = $spec['path'].'/'.$document['id'];
    $payload = ['operation' => $operation, 'document_type' => $operation, 'document_id' => $document['id'], 'input' => [
        'selection' => ['grade' => 7, 'learning_area' => $area->name, 'class_subject_teacher_id' => $allocation->id, 'source_version_id' => $version['id']], 'constraints' => $spec['constraints']]];
    $transport = []; $started = hrtime(true);
    // The existing HTTP helper is intentionally not used for this call: a 422/503
    // is a measured model failure, not a reason to skip the other three operations.
    auth()->guard('sanctum')->setUser($teacher);
    $request = Illuminate\Http\Request::create('/api/v1/ai-teaching/drafts', 'POST', $payload);
    $request->headers->set('Accept', 'application/json'); $request->setUserResolver(fn () => $teacher);
    $response = $kernel->handle($request);
    $elapsed = round((hrtime(true) - $started) / 1e9, 3);
    $body = json_decode($response->getContent(), true, 512, JSON_THROW_ON_ERROR);
    $measurement = ['operation' => $operation, 'mode' => $diagnostic ? 'test-only no-thinking/schema-format diagnostic; not production transport' : 'unchanged application transport', 'wall_seconds' => $elapsed, 'http_status' => $response->getStatusCode(), 'transport' => $transport];
    if ($response->getStatusCode() !== 201) {
        $measurement['rejection'] = $body;
        ensure(pilotApi($teacher, 'GET', $url)['status'] === 'draft', 'Rejected generation changed a document.');
        $measurement['import'] = 'not attempted; rejected or unavailable output';
    } else {
        $run = $body['data']; $draft = $run['draft']; $valid++;
        $measurement['draft'] = $draft;
        // Automated integration exercise only: never a claim of human teacher review.
        if ($operation === 'scheme_of_work') {
            foreach ($draft['weeks'] as $week) pilotApi($teacher, 'POST', $url.'/weeks', ['week_number' => $week['week_number'], 'strand' => $week['strand'], 'sub_strand' => $week['sub_strand'],
                'learning_outcomes' => implode("\n", array_column($draft['specific_learning_outcomes'], 'text')), 'learning_activities' => implode("\n", $week['learning_activities']), 'resources' => implode("\n", $week['resources'])], 201);
        } elseif ($operation === 'lesson_plan') {
            $stage = fn ($phase) => implode("\n", array_merge(...array_column(array_values(array_filter($draft['stages'], fn ($row) => $row['phase'] === $phase)), 'activities')));
            pilotApi($teacher, 'PATCH', $url, ['duration_minutes' => $draft['duration_minutes'], 'specific_learning_outcomes' => implode("\n", array_column($draft['specific_learning_outcomes'], 'text')),
                'key_inquiry_questions' => implode("\n", $draft['key_inquiry_questions']), 'teaching_learning_resources' => implode("\n", $draft['resources']), 'assessment_approach' => $draft['assessment_approach'],
                'introduction' => $stage('introduction'), 'lesson_development' => $stage('development'), 'conclusion' => $stage('conclusion')]);
        } else {
            if ($operation === 'homework') {
                pilotApi($teacher, 'PATCH', $url, ['instructions' => $draft['instructions'], 'total_marks' => $draft['total_marks']]);
                $sections = [['questions' => $draft['questions']]];
            } else {
                $sections = $draft['sections'];
            }
            foreach ($sections as $section) {
                $sectionId = null;
                if ($operation === 'exam_paper') {
                    $paper = pilotApi($teacher, 'POST', $url.'/sections', ['position' => $section['position'], 'title' => $section['title']], 201);
                    $sectionId = collect($paper['sections'])->firstWhere('position', $section['position'])['id'];
                }
                foreach ($section['questions'] as $question) {
                    unset($question['curriculum_record_ids'], $question['learning_outcome_ids']);
                    if ($sectionId) $question += ['exam_paper_section_id' => $sectionId, 'ai_generated' => true];
                    pilotApi($teacher, 'POST', $url.'/questions', $question, 201);
                    pilotApi($teacher, 'POST', $url.'/questions', $question, 409);
                }
            }
        }
        pilotApi($otherTeacher, 'GET', $url, [], 404);
        $accept = 'ai-teaching/runs/'.$run['run_id'].'/accept';
        pilotApi($otherTeacher, 'POST', $accept, [], 403);
        ensure(pilotApi($teacher, 'POST', $accept) === pilotApi($teacher, 'POST', $accept), 'Acceptance retry changed.');
        ensure(DB::table('audit_logs')->where('action', 'ACCEPT_AI_TEACHING_DRAFT')->where('entity_id', $run['run_id'])->count() === 1, 'Duplicate acceptance audit.');
        ensure(pilotApi($teacher, 'GET', $url)['status'] === 'draft', 'Integration import approved a document.');
        $measurement['import'] = 'automated synthetic-actor import/acceptance exercised; document remains draft; not human teacher sign-off';
    }
    $results[] = $measurement;
    echo 'PHASE7_REAL_MODEL '.json_encode($measurement, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR).PHP_EOL;
}
config(['services.ai.driver' => 'disabled']);
echo 'PHASE7_SUMMARY '.json_encode(['valid_outputs' => $valid, 'attempts' => count($results), 'persistent_database_connections' => 0, 'human_teacher_review' => 'pending', 'driver_reset_in_test_process' => true], JSON_THROW_ON_ERROR).PHP_EOL;
exit($valid === count($results) ? 0 : 2);
