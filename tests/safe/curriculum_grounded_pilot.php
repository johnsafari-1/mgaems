<?php

// End-to-end HTTP/API pilot. All database connections are replaced by the guarded
// workspace suite's SQLite :memory: connection before providers boot. Ollama HTTP
// is faked; no authorized source or school data is needed or touched.
if (!in_array('--synthetic', $argv, true)) {
    throw new RuntimeException('Explicit --synthetic mode is required.');
}
require __DIR__.'/teaching_learning_workspace.php';

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;

ensure(DB::connection()->getDatabaseName() === ':memory:', 'Pilot must use in-memory SQLite');
(require dirname(__DIR__, 2).'/database/migrations/2026_10_18_000043_create_curriculum_library.php')->up();
Storage::fake('private');
Http::preventStrayRequests();
$kernel = app(Kernel::class);

function pilotApi($user, string $method, string $path, array $body = [], int $status = 200, ?UploadedFile $file = null): array
{
    global $kernel;
    auth()->guard('sanctum')->setUser($user);
    $request = Request::create('/api/v1/'.$path, $method, $body);
    $request->headers->set('Accept', 'application/json');
    $request->setUserResolver(fn () => $user);
    if ($file) $request->files->set('document', $file);
    $response = $kernel->handle($request);
    $json = json_decode($response->getContent(), true, 512, JSON_THROW_ON_ERROR);
    ensure($response->getStatusCode() === $status, $method.' '.$path.' expected '.$status.'; got '.$response->getStatusCode().' '.$response->getContent());

    return $json['data'] ?? $json;
}

function pilotDraft(array $prompt): array
{
    $record = $prompt['reference_data']['records'][0];
    $outcome = $record['specific_learning_outcomes'][0];
    $links = ['curriculum_record_ids' => [$record['record_id']], 'learning_outcome_ids' => [$outcome['id']]];
    $common = ['status' => 'draft', 'grade' => 7, 'learning_area' => 'Synthetic Pilot Science', 'title' => 'Synthetic pilot draft; not official curriculum', 'curriculum_claims' => [],
        'curriculum_references' => [['record_id' => $record['record_id'], 'source_version_id' => $record['source']['version_id'], 'document_sha256' => $record['source']['document_sha256'], 'page_reference' => $record['source']['page_reference'], 'outcome_ids' => [$outcome['id']]]],
        'specific_learning_outcomes' => [$outcome]];
    $question = $links + ['position' => 1, 'question_type' => 'short_answer', 'prompt' => 'Synthetic observation question', 'marks' => 5, 'options' => [], 'answer_key' => 'Synthetic answer', 'marking_guidance' => 'Synthetic marking guidance'];

    return $common + match ($prompt['operation']) {
        'scheme_of_work' => ['total_duration_minutes' => 80, 'weeks' => [$links + ['week_number' => 1, 'strand' => 'Synthetic strand', 'sub_strand' => 'Synthetic sub-strand', 'lessons_per_week' => 2, 'lesson_duration_minutes' => 40, 'total_duration_minutes' => 80, 'learning_activities' => ['Synthetic activity'], 'resources' => ['Synthetic chart'], 'assessment_approach' => 'Synthetic observation']]],
        'lesson_plan' => ['duration_minutes' => 40, 'key_inquiry_questions' => ['Synthetic inquiry?'], 'resources' => ['Synthetic chart'], 'assessment_approach' => 'Synthetic observation', 'stages' => array_map(fn ($phase, $minutes) => $links + ['phase' => $phase, 'duration_minutes' => $minutes, 'activities' => ['Synthetic activity']], ['introduction', 'development', 'conclusion'], [5, 30, 5])],
        'homework' => ['instructions' => 'Synthetic instructions', 'total_marks' => 5, 'questions' => [$question]],
        'exam_paper' => ['instructions' => 'Synthetic instructions', 'duration_minutes' => 40, 'total_marks' => 5, 'sections' => [['position' => 1, 'title' => 'Synthetic section', 'total_marks' => 5, 'questions' => [$question]]]],
    };
}

config(['services.ai.driver' => 'disabled']);
$status = pilotApi($teacher, 'GET', 'ai-teaching/status');
ensure(!$status['available'] && !$status['capabilities']['grounded'], 'Disabled driver must remain unavailable');
pilotApi($teacher, 'POST', 'ai-teaching/drafts', ['operation' => 'lesson_plan', 'input' => ['selection' => ['grade' => 7, 'learning_area' => 'Synthetic Pilot Science']]], 503);
Http::assertNothingSent();

$pilotClass = pilotApi($admin, 'POST', 'classes', ['name' => 'Synthetic Grade 7', 'level' => 'junior', 'sequence' => 7], 201);
$area = (object) pilotApi($admin, 'POST', 'subjects', ['name' => 'Synthetic Pilot Sciense', 'code' => 'PILOT-SCIE', 'learning_area' => 'Matter'], 201);
$subjectId = $area->id;
$area = (object) pilotApi($admin, 'PATCH', 'subjects/'.$area->id, ['name' => 'Synthetic Pilot Science', 'learning_area' => 'Synthetic Pilot Science']);
ensure($area->id === $subjectId && $area->code === 'PILOT-SCIE', 'Correcting metadata must preserve subject identity and code');
$offering = ['class_id' => $pilotClass['id'], 'subject_id' => $area->id];
pilotApi($admin, 'POST', 'class-subjects', $offering, 201);
pilotApi($admin, 'POST', 'class-subjects', $offering, 409);
$allocationInput = $offering + ['staff_id' => $teacherStaff->id, 'term_id' => $term->id];
$allocation = (object) pilotApi($admin, 'POST', 'teacher-assignments', $allocationInput, 201);
pilotApi($admin, 'POST', 'teacher-assignments', $allocationInput, 409);
$sourceInput = ['title' => 'Synthetic pilot source; not KICD', 'official_url' => 'https://example.invalid/synthetic',
    'publisher' => 'Synthetic fixture publisher', 'grade' => 7, 'learning_area' => $area->name];
$source = pilotApi($admin, 'POST', 'curriculum-library/sources', ['identifier' => 'synthetic-phase7-pilot'] + $sourceInput, 201);
pilotApi($admin, 'PUT', 'curriculum-library/sources/'.$source['id'], $sourceInput + ['subject_id' => $area->id]);
$source = pilotApi($admin, 'PUT', 'curriculum-library/sources/'.$source['id'], $sourceInput);
ensure($source['subject_id'] === $area->id, 'Metadata edits must retain the source subject link');
echo 'PASS Grade 7 mapping, identity-preserving metadata correction, duplicate-safe offering/allocation and retained source link'.PHP_EOL;
$version = pilotApi($admin, 'POST', 'curriculum-library/sources/'.$source['id'].'/versions', [
    'edition' => 'Synthetic edition', 'document_url' => 'https://example.invalid/synthetic.pdf', 'authorization_basis' => 'Original synthetic fixture created solely for this isolated automated pilot.',
], 201, UploadedFile::fake()->createWithContent('synthetic-pilot.pdf', "%PDF-1.4\n% Synthetic fixture, not official curriculum.\n%%EOF\n"));
$selection = ['grade' => 7, 'learning_area' => $area->name, 'subject_id' => $area->id];
ensure(!pilotApi($teacher, 'GET', 'curriculum-library/retrieve', $selection)['available'], 'Unreviewed content must not be retrieved');
pilotApi($admin, 'POST', 'curriculum-library/versions/'.$version['id'].'/records', ['records' => [[
    'record_key' => 'synthetic.1', 'strand' => 'Synthetic strand', 'sub_strand' => 'Synthetic sub-strand', 'page_reference' => 'Synthetic fixture page 1',
    'specific_learning_outcomes' => ['Describe a synthetic observation; not an official curriculum outcome.'],
    'suggested_learning_experiences' => ['Synthetic activity'], 'key_inquiry_questions' => ['Synthetic inquiry?'], 'assessment_approaches' => ['Synthetic observation'],
]]], 201);
$review = pilotApi($admin, 'GET', 'curriculum-library/versions/'.$version['id']);
$approval = ['document_sha256' => $version['document_sha256'], 'content_sha256' => $review['review_content_sha256'], 'actual_document_checked' => true, 'extracted_content_checked' => true, 'authorized_use_confirmed' => true, 'verification_notes' => 'Synthetic fixture and every synthetic record checked for this in-memory test only.'];
pilotApi($teacher, 'POST', 'curriculum-library/versions/'.$version['id'].'/approve', $approval, 403);
pilotApi($admin, 'POST', 'curriculum-library/versions/'.$version['id'].'/approve', $approval);
ensure(pilotApi($teacher, 'GET', 'curriculum-library/retrieve', $selection)['available'], 'Reviewed synthetic records become retrievable');
ensure(!pilotApi($teacher, 'GET', 'curriculum-library/retrieve', array_replace($selection, ['grade' => 8]))['available'], 'Wrong grade must fail closed');
pilotApi($teacher, 'GET', 'curriculum-library/retrieve', array_replace($selection, ['grade' => 7.5]), 422);
echo 'PASS synthetic registration, private upload, import, review, approval and numerical-grade HTTP workflow'.PHP_EOL;

// Provider configuration changes exist only in this isolated PHP process.
config(['services.ai.driver' => 'ollama', 'services.ollama.base_url' => 'http://ollama.test:11434', 'services.ollama.model' => 'qwen3:1.7b', 'services.ollama.timeout' => 120]);
foreach (app('router')->getRoutes() as $route) $route->flushController();
Http::fake(['ollama.test:11434/api/chat' => function ($request) {
    $prompt = json_decode($request['messages'][1]['content'], true, 512, JSON_THROW_ON_ERROR);
    ensure(isset($prompt['constraints']), 'Requested constraints must reach the model');
    return Http::response(['done' => true, 'message' => ['role' => 'assistant', 'content' => json_encode(pilotDraft($prompt), JSON_THROW_ON_ERROR)]]);
}]);
$documents = [
    'scheme_of_work' => ['path' => 'schemes-of-work', 'input' => ['class_subject_teacher_id' => $allocation->id, 'title' => 'Synthetic scheme'], 'constraints' => ['total_duration_minutes' => 80]],
    'lesson_plan' => ['path' => 'lesson-plans', 'input' => lessonPlanInput(['class_subject_teacher_id' => $allocation->id]), 'constraints' => ['duration_minutes' => 40]],
    'homework' => ['path' => 'homework', 'input' => homeworkInput(['class_subject_teacher_id' => $allocation->id]), 'constraints' => ['total_marks' => 5]],
    'exam_paper' => ['path' => 'exam-papers', 'input' => ['class_subject_teacher_id' => $allocation->id, 'title' => 'Synthetic paper', 'examination_type' => 'end_term', 'duration_minutes' => 40], 'constraints' => ['duration_minutes' => 40, 'total_marks' => 5]],
];
foreach ($documents as $operation => $spec) {
    $document = pilotApi($teacher, 'POST', $spec['path'], $spec['input'], 201);
    $url = $spec['path'].'/'.$document['id'];
    pilotApi($teacher, 'POST', 'ai-teaching/drafts', ['operation' => $operation, 'document_type' => $operation, 'document_id' => $document['id'],
        'input' => ['selection' => ['grade' => 7, 'learning_area' => $area->name, 'class_subject_teacher_id' => $assignment->id]]], 422);
    $result = pilotApi($teacher, 'POST', 'ai-teaching/drafts', ['operation' => $operation, 'document_type' => $operation, 'document_id' => $document['id'],
        'input' => ['selection' => ['grade' => 7, 'learning_area' => 'Client value is replaced', 'class_subject_teacher_id' => $allocation->id], 'constraints' => $spec['constraints']]], 201);
    $draft = $result['draft'];
    ensure($draft['learning_area'] === $area->name, 'Exact authorized allocation pins learning area');
    ensure(DB::table('ai_generation_runs')->where('id', $result['run_id'])->value('state') === 'generated', 'Generation alone must not accept');
    $outcome = $draft['specific_learning_outcomes'][0]['text'];
    if ($operation === 'scheme_of_work') {
        $week = $draft['weeks'][0];
        $values = ['week_number' => 1, 'strand' => $week['strand'], 'sub_strand' => $week['sub_strand'], 'learning_outcomes' => $outcome, 'learning_activities' => implode("\n", $week['learning_activities']), 'resources' => implode("\n", $week['resources'])];
        pilotApi($teacher, 'POST', $url.'/weeks', $values, 201);
        pilotApi($teacher, 'POST', $url.'/weeks', $values, 409);
    } elseif ($operation === 'lesson_plan') {
        $values = ['specific_learning_outcomes' => $outcome, 'key_inquiry_questions' => implode("\n", $draft['key_inquiry_questions']), 'teaching_learning_resources' => implode("\n", $draft['resources']), 'assessment_approach' => $draft['assessment_approach'], 'introduction' => $draft['stages'][0]['activities'][0], 'lesson_development' => $draft['stages'][1]['activities'][0], 'conclusion' => $draft['stages'][2]['activities'][0]];
        pilotApi($teacher, 'PATCH', $url, $values);
        pilotApi($teacher, 'PATCH', $url, $values);
    } else {
        $question = $operation === 'homework' ? $draft['questions'][0] : $draft['sections'][0]['questions'][0];
        unset($question['curriculum_record_ids'], $question['learning_outcome_ids']);
        if ($operation === 'homework') {
            pilotApi($teacher, 'PATCH', $url, ['instructions' => $draft['instructions'], 'learning_outcomes' => $outcome, 'total_marks' => 5]);
        } else {
            $paper = pilotApi($teacher, 'POST', $url.'/sections', ['position' => 1, 'title' => $draft['sections'][0]['title']], 201);
            $question['exam_paper_section_id'] = $paper['sections'][0]['id'];
            $question['ai_generated'] = true;
        }
        pilotApi($teacher, 'POST', $url.'/questions', $question, 201);
        pilotApi($teacher, 'POST', $url.'/questions', $question, 409);
    }
    pilotApi($otherTeacher, 'GET', $url, [], 404);
    $runUrl = 'ai-teaching/runs/'.$result['run_id'].'/accept';
    pilotApi($otherTeacher, 'POST', $runUrl, [], 403);
    $accepted = pilotApi($teacher, 'POST', $runUrl);
    ensure($accepted === pilotApi($teacher, 'POST', $runUrl), 'Lost acceptance response can be retried');
    $audit = DB::table('audit_logs')->where('action', 'ACCEPT_AI_TEACHING_DRAFT')->where('entity_id', $result['run_id'])->get();
    ensure($audit->count() === 1 && json_decode($audit[0]->details, true)['document_id'] === $document['id'], 'One acceptance audit links the generated run to its target');
    ensure(pilotApi($teacher, 'GET', $url)['status'] === 'draft', 'Import and acceptance never approve or publish');
    echo 'PASS '.$operation.' HTTP generation, allocation mapping, authorized import, duplicate guard and audited acceptance'.PHP_EOL;
}
Http::assertSentCount(4);
config(['services.ai.driver' => 'disabled']);
foreach (app('router')->getRoutes() as $route) $route->flushController();
ensure(!pilotApi($teacher, 'GET', 'ai-teaching/status')['available'], 'Pilot driver reset inside test process');
echo 'PASS isolated synthetic HTTP pilot complete; four faked inference requests; no active database or live Ollama inference'.PHP_EOL;
