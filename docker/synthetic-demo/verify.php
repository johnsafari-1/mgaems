<?php

// Real kernel, Sanctum bearer login and MySQL checks; all writes roll back.
require __DIR__.'/bootstrap.php';
$app = syntheticDemoApp();
assertSyntheticDemoIdentity();

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

Http::preventStrayRequests();
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
function demoApi(string $method, string $path, array $body = [], ?string $token = null, int $expected = 200): array
{
    global $kernel;
    Auth::forgetGuards();
    $request = Request::create('/api/v1/'.$path, $method, $body);
    $request->headers->set('Accept', 'application/json');
    if ($token) $request->headers->set('Authorization', 'Bearer '.$token);
    $response = $kernel->handle($request);
    if ($response->getStatusCode() !== $expected) throw new RuntimeException($path.' returned '.$response->getStatusCode().': '.$response->getContent());

    return json_decode($response->getContent(), true, 512, JSON_THROW_ON_ERROR)['data'] ?? [];
}
$failed = false;
DB::beginTransaction();
try {
    $token = demoApi('POST', 'auth/login', ['username' => 'demo.teacher', 'password' => 'DemoOnly!2026'])['token'];
    $status = demoApi('GET', 'ai-teaching/status', [], $token);
    if (!$status['available'] || $status['provider'] !== 'synthetic_demo') throw new RuntimeException('Wrong provider for this demo.');
    $manifest = json_decode(DB::table('synthetic_demo_identity')->value('manifest'), true, 512, JSON_THROW_ON_ERROR);
    $selection = ['grade' => 7, 'learning_area' => 'Integrated Science', 'subject_id' => $manifest['subject_id']];
    $retrieval = demoApi('GET', 'curriculum-library/retrieve', $selection, $token);
    if (!$retrieval['available']) throw new RuntimeException('Original fixture retrieval unavailable.');
    echo 'PASS isolated bearer login, labelled sample provider and original curriculum retrieval'.PHP_EOL;
    $specs = [
        'scheme_of_work' => ['path' => 'schemes-of-work', 'constraints' => ['total_duration_minutes' => 80]],
        'lesson_plan' => ['path' => 'lesson-plans', 'constraints' => ['duration_minutes' => 40]],
        'homework' => ['path' => 'homework', 'constraints' => ['total_marks' => 10]],
        'exam_paper' => ['path' => 'exam-papers', 'constraints' => ['total_marks' => 10, 'duration_minutes' => 40]],
    ];
    foreach ($specs as $type => $spec) {
        $id = $manifest['documents'][$type];
        $url = $spec['path'].'/'.$id;
        $run = demoApi('POST', 'ai-teaching/drafts', ['operation' => $type, 'document_type' => $type, 'document_id' => $id,
            'input' => ['selection' => ['grade' => 7, 'learning_area' => 'Integrated Science', 'class_subject_teacher_id' => $manifest['allocation_id']], 'constraints' => $spec['constraints']]], $token, 201);
        $draft = $run['draft'];
        if (!str_contains($run['label'], 'not live AI')) throw new RuntimeException('Sample output must be honestly labelled.');
        if ($type === 'scheme_of_work') {
            $week = $draft['weeks'][0];
            $values = ['week_number' => 1, 'strand' => $week['strand'], 'sub_strand' => $week['sub_strand'],
                'learning_outcomes' => $draft['specific_learning_outcomes'][0]['text'], 'learning_activities' => implode("\n", $week['learning_activities']), 'resources' => implode("\n", $week['resources'])];
            demoApi('POST', $url.'/weeks', $values, $token, 201);
            demoApi('POST', $url.'/weeks', $values, $token, 409);
        } elseif ($type === 'lesson_plan') {
            $values = ['specific_learning_outcomes' => $draft['specific_learning_outcomes'][0]['text'], 'key_inquiry_questions' => implode("\n", $draft['key_inquiry_questions']),
                'teaching_learning_resources' => implode("\n", $draft['resources']), 'assessment_approach' => $draft['assessment_approach'], 'duration_minutes' => $draft['duration_minutes'],
                'introduction' => implode("\n", $draft['stages'][0]['activities']), 'lesson_development' => implode("\n", $draft['stages'][1]['activities']), 'conclusion' => implode("\n", $draft['stages'][2]['activities'])];
            demoApi('PATCH', $url, $values, $token);
            demoApi('PATCH', $url, $values, $token);
        } else {
            $questions = $type === 'homework' ? $draft['questions'] : $draft['sections'][0]['questions'];
            $sectionId = null;
            if ($type === 'homework') {
                demoApi('PATCH', $url, ['instructions' => $draft['instructions'], 'total_marks' => $draft['total_marks']], $token);
            } else {
                $paper = demoApi('POST', $url.'/sections', ['position' => 1, 'title' => $draft['sections'][0]['title']], $token, 201);
                $sectionId = $paper['sections'][0]['id'];
            }
            foreach ($questions as $question) {
                unset($question['curriculum_record_ids'], $question['learning_outcome_ids']);
                if ($sectionId) $question += ['exam_paper_section_id' => $sectionId, 'ai_generated' => true];
                demoApi('POST', $url.'/questions', $question, $token, 201);
                demoApi('POST', $url.'/questions', $question, $token, 409);
            }
        }
        $accept = 'ai-teaching/runs/'.$run['run_id'].'/accept';
        $first = demoApi('POST', $accept, [], $token);
        if ($first !== demoApi('POST', $accept, [], $token)) throw new RuntimeException('Acceptance retry changed its result.');
        if (DB::table('audit_logs')->where('action', 'ACCEPT_AI_TEACHING_DRAFT')->where('entity_id', $run['run_id'])->count() !== 1) throw new RuntimeException('Duplicate acceptance audit.');
        if (demoApi('GET', $url, [], $token)['status'] !== 'draft') throw new RuntimeException('Document was unexpectedly submitted.');
        echo 'PASS '.$type.' sample generation, MySQL import, duplicate handling and audited acceptance'.PHP_EOL;
    }
    Http::assertNothingSent();
    echo 'PASS no live inference performed; verification writes will roll back, leaving initial documents ready for the browser'.PHP_EOL;
} catch (Throwable $exception) {
    fwrite(STDERR, 'Demo verification failed: '.$exception->getMessage().PHP_EOL);
    $failed = true;
} finally {
    DB::rollBack();
}
exit($failed ? 1 : 0);
