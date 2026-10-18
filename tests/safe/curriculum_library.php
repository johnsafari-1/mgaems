<?php

use App\Contracts\TeachingAssistantProvider;
use App\Http\Controllers\Api\CurriculumLibraryController;
use App\Models\CurriculumSourceVersion;
use App\Models\Role;
use App\Models\Staff;
use App\Models\Subject;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\CurriculumAccess;
use App\Services\CurriculumLibrary;
use App\Services\CurriculumPromptContext;
use App\Services\CurriculumRetrieval;
use App\Services\GroundedDocumentContract;
use App\Services\OllamaTeachingAssistantProvider;
use App\Services\TeachingDocumentAccess;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Bootstrap\BootProviders;
use Illuminate\Foundation\Bootstrap\LoadConfiguration;
use Illuminate\Foundation\Bootstrap\LoadEnvironmentVariables;
use Illuminate\Foundation\Bootstrap\RegisterFacades;
use Illuminate\Foundation\Bootstrap\RegisterProviders;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->bootstrapWith([LoadEnvironmentVariables::class, LoadConfiguration::class]);
$mysql = in_array('--mysql', $argv, true);
if ($mysql) {
    $connection = $app['config']->get('database.connections.mysql');
    if (getenv('MGAEMS_CURRICULUM_TEST_UUID') === false || $connection['host'] !== '127.0.0.1' || $connection['database'] !== 'mgaems_curriculum_test') {
        throw new RuntimeException('Refusing a non-isolated MySQL connection.');
    }
    $app['config']->set('database.connections', ['mysql' => $connection]);
    $app['config']->set('database.default', 'mysql');
} else {
    $app['config']->set('database.connections', ['curriculum_memory' => ['driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '', 'foreign_key_constraints' => true]]);
    $app['config']->set('database.default', 'curriculum_memory');
}
$app['config']->set('app.env', 'testing');
$app['config']->set('session.driver', 'array');
$app['config']->set('cache.default', 'array');
$app['config']->set('view.compiled', sys_get_temp_dir().'/mgaems-curriculum-views');
$app->instance('request', Request::create('/'));
$app->bootstrapWith([RegisterFacades::class, RegisterProviders::class, BootProviders::class]);
Http::preventStrayRequests();
Storage::fake('private');
if ($mysql) {
    if (DB::selectOne('SELECT @@server_uuid AS uuid')->uuid !== getenv('MGAEMS_CURRICULUM_TEST_UUID')) {
        throw new RuntimeException('MySQL server identity differs.');
    }
    $beforeTables = DB::select('SHOW TABLES');
    $oldChecksums = DB::select('CHECKSUM TABLE '.implode(', ', array_map(fn ($row) => '`'.array_values((array) $row)[0].'`', $beforeTables)));
} else {
    if (DB::connection()->getDatabaseName() !== ':memory:') {
        throw new RuntimeException('Refusing non-memory SQLite.');
    }
    Schema::create('roles', function (Blueprint $t) {
        $t->id();
        $t->string('name')->unique();
    });
    Schema::create('users', function (Blueprint $t) {
        $t->id();
        $t->string('username')->unique();
        $t->string('email')->unique();
        $t->string('password_hash');
        $t->foreignId('role_id')->constrained();
        $t->string('status');
        $t->timestamps();
    });
    Schema::create('subjects', function (Blueprint $t) {
        $t->id();
        $t->string('name');
        $t->string('code')->nullable();
        $t->string('learning_area')->nullable();
        $t->string('status');
    });
    Schema::create('staff', function (Blueprint $t) {
        $t->id();
        $t->foreignId('user_id')->constrained();
        $t->string('first_name');
        $t->string('last_name');
        $t->string('staff_type');
        $t->string('status');
        $t->string('role_title');
        $t->date('employment_date');
        $t->timestamps();
    });
    Schema::create('audit_logs', function (Blueprint $t) {
        $t->id();
        $t->foreignId('user_id')->nullable();
        $t->string('action');
        $t->string('entity_type')->nullable();
        $t->unsignedBigInteger('entity_id')->nullable();
        $t->text('details')->nullable();
        $t->string('ip_address')->nullable();
        $t->timestamp('created_at');
    });
}
if (Schema::hasTable('curriculum_sources')) {
    throw new RuntimeException('Refusing to overwrite an existing curriculum library.');
}
if (app(CurriculumRetrieval::class)->retrieve(['grade' => 7, 'learning_area' => 'Synthetic Test Science'])['reason'] !== 'CURRICULUM_LIBRARY_NOT_INSTALLED') {
    throw new RuntimeException('Missing curriculum schema must return an explicit unavailable result.');
}
echo 'PASS missing curriculum schema returns explicit unavailable before installation'.PHP_EOL;
$pendingAccess = new class extends CurriculumAccess
{
    public function administrator(?User $user): User
    {
        return new User;
    }
};
try {
    (new CurriculumLibraryController($pendingAccess, app(CurriculumLibrary::class)))->showVersion(Request::create('/'), 1);
    throw new RuntimeException('Pending schema should block record resolution.');
} catch (HttpException $exception) {
    if ($exception->getStatusCode() !== 503) {
        throw $exception;
    }
}
echo 'PASS pending administration returns 503 before curriculum record lookup'.PHP_EOL;
$migration = require __DIR__.'/../../database/migrations/2026_10_18_000043_create_curriculum_library.php';
$migration->up();
if ($mysql) {
    $afterChecksums = DB::select('CHECKSUM TABLE '.implode(', ', array_map(fn ($row) => '`'.array_values((array) $row)[0].'`', $beforeTables)));
    if (json_encode($oldChecksums) !== json_encode($afterChecksums)) {
        throw new RuntimeException('Additive migration changed an existing table checksum.');
    }
    echo 'PASS additive migration preserves all 58 restored table checksums'.PHP_EOL;
}
DB::beginTransaction();
$passed = 0;
function ensure(bool $condition, string $message = 'Assertion failed'): void
{
    if (! $condition) {
        throw new RuntimeException($message);
    }
}
function check(string $name, callable $test): void
{
    global $passed;
    $test();
    $passed++;
    echo 'PASS '.$name.PHP_EOL;
}
function invalid(callable $test): void
{
    try {
        $test();
    } catch (ValidationException) {
        return;
    } throw new RuntimeException('Expected validation failure.');
}
function denied(callable $test, int $status = 403): void
{
    try {
        $test();
    } catch (HttpException $e) {
        ensure($e->getStatusCode() === $status, 'Unexpected HTTP status '.$e->getStatusCode());

        return;
    } throw new RuntimeException('Expected access/conflict failure.');
}
function requestFor(?User $user, array $input = []): Request
{
    $r = Request::create('/api/v1/curriculum-library', 'POST', $input);
    $r->setUserResolver(fn () => $user);

    return $r;
}
function actor(string $role): User
{
    $r = Role::firstOrCreate(['name' => $role]);
    $id = bin2hex(random_bytes(8));

    return User::create(['username' => 'curriculum_'.$id, 'email' => $id.'@example.invalid', 'password_hash' => 'test-only', 'role_id' => $r->id, 'status' => 'active']);
}
function recordInput(string $key = 'test.1'): array
{
    return ['record_key' => $key, 'strand' => 'Synthetic test strand', 'sub_strand' => 'Synthetic test sub-strand', 'page_reference' => 'Synthetic fixture page 1', 'specific_learning_outcomes' => ['Synthetic test outcome; not official curriculum.'], 'suggested_learning_experiences' => ['Synthetic classroom exercise.'], 'key_inquiry_questions' => ['Synthetic inquiry?'], 'assessment_approaches' => ['Synthetic observation.']];
}
function document(string $variant = 'one'): UploadedFile
{
    return UploadedFile::fake()->createWithContent('synthetic-test.pdf', "%PDF-1.4\n% Synthetic fixture, not KICD or real curriculum.\n".$variant."\n%%EOF\n");
}
$admin = actor(Role::SYSTEM_ADMIN);
$teacher = actor(Role::TEACHER);
$parent = actor('parent_guardian');
$library = app(CurriculumLibrary::class);
$retrieval = app(CurriculumRetrieval::class);
$controller = app(CurriculumLibraryController::class);
$audit = new AuditLogger(requestFor($admin));
$area = Subject::create(['name' => 'Synthetic Test Science', 'learning_area' => 'Synthetic Test Science', 'code' => 'CTS'.bin2hex(random_bytes(3)), 'status' => 'active']);
$metadata = ['identifier' => 'synthetic-test-'.bin2hex(random_bytes(4)), 'title' => 'Synthetic reference for tests only', 'official_url' => 'https://example.invalid/curriculum', 'publisher' => 'Synthetic test publisher', 'grade' => 7, 'learning_area' => $area->name, 'subject_id' => $area->id];
$source = $library->register($metadata, $admin, $audit);
$versionData = ['edition' => 'Synthetic edition 1', 'document_url' => 'https://example.invalid/test.pdf', 'authorization_basis' => 'Synthetic test fixture created for automated tests only.'];
$version = $library->addVersion($source, $versionData, document(), $admin, $audit);
$selection = ['grade' => 7, 'learning_area' => $area->name, 'strand' => 'Synthetic test strand', 'sub_strand' => 'Synthetic test sub-strand'];
function approveVersion(CurriculumSourceVersion $version): void
{
    global $library, $admin, $audit;
    $library->approve($version, ['document_sha256' => $version->document_sha256, 'content_sha256' => $library->contentChecksum($version), 'actual_document_checked' => true, 'extracted_content_checked' => true, 'authorized_use_confirmed' => true, 'verification_notes' => 'Synthetic fixture and records checked for isolated automated testing only.'], $admin, $audit);
}

try {
    check('source registration is validated, audited and subject-consistent', function () use ($source, $metadata, $library, $admin, $audit) {
        ensure($source->grade === 7 && DB::table('audit_logs')->where('action', 'REGISTER_CURRICULUM_SOURCE')->exists());
        invalid(fn () => $library->register($metadata, $admin, $audit));
        invalid(fn () => $library->register(array_replace($metadata, ['identifier' => 'mismatch', 'learning_area' => 'Different subject']), $admin, $audit));
    });
    check('every administration action denies teachers and unauthenticated callers', function () use ($controller, $teacher, $source, $version, $audit) {
        $calls = [fn ($r) => $controller->index($r), fn ($r) => $controller->store($r, $audit), fn ($r) => $controller->updateSource($r, $source->id, $audit), fn ($r) => $controller->updateVersion($r, $version->id, $audit), fn ($r) => $controller->storeVersion($r, $source->id, $audit), fn ($r) => $controller->showVersion($r, $version->id), fn ($r) => $controller->import($r, $version->id, $audit), fn ($r) => $controller->correct($r, $version->id, 1, $audit), fn ($r) => $controller->approve($r, $version->id, $audit), fn ($r) => $controller->withdraw($r, $version->id, $audit), fn ($r) => $controller->document($r, $version->id)];
        foreach ($calls as $call) {
            denied(fn () => $call(requestFor($teacher)));
            denied(fn () => $call(requestFor(null)), 401);
        }
    });
    check('private documents are checksummed and duplicate editions/documents blocked', function () use ($source, $version, $library, $versionData, $admin, $audit) {
        ensure(Storage::disk('private')->exists($version->document_path) && $version->verification_status === 'pending');
        denied(fn () => $library->addVersion($source, $versionData, document('different'), $admin, $audit), 409);
        denied(fn () => $library->addVersion($source, array_replace($versionData, ['edition' => 'Different edition']), document(), $admin, $audit), 409);
        invalid(fn () => $library->addVersion($source, array_replace($versionData, ['edition' => 'Not a PDF']), UploadedFile::fake()->createWithContent('bad.pdf', '<html>not a PDF</html>'), $admin, $audit));
    });
    check('missing and unverified curriculum returns explicit unavailable', function () use ($retrieval, $selection) {
        ensure($retrieval->retrieve($selection)['reason'] === 'NO_VERIFIED_CURRICULUM');
        ensure($retrieval->retrieve(array_replace($selection, ['grade' => 8]))['available'] === false);
    });
    check('draft source and edition corrections invalidate the previous review checksum', function () use ($library, $source, &$version, $metadata, $versionData, $audit) {
        $before = $library->contentChecksum($version);
        $library->updateSource($source, array_replace($metadata, ['title' => 'Corrected synthetic reference']), $audit);
        ensure($before !== $library->contentChecksum($version));
        $before = $library->contentChecksum($version);
        $version = $library->updateVersion($version, array_replace($versionData, ['edition' => 'Corrected synthetic edition']), $audit);
        ensure($before !== $library->contentChecksum($version));
    });
    check('malformed extraction imports are atomic and cannot carry private columns', function () use ($library, $version, $audit) {
        invalid(fn () => $library->import($version, ['records' => [recordInput(), ['record_key' => 'bad']]], $audit));
        invalid(fn () => $library->import($version, ['records' => [recordInput() + ['student_name' => 'Must never be imported']]], $audit));
        invalid(fn () => $library->import($version, ['records' => [array_replace(recordInput(), ['specific_learning_outcomes' => 'invalid'])]], $audit));
        invalid(fn () => $library->import($version, ['records' => [recordInput(), recordInput()]], $audit));
        ensure($version->records()->count() === 0);
    });
    $record = $library->import($version, ['records' => [recordInput()]], $audit)[0];
    check('duplicate imports never overwrite records and manual correction retains identity', function () use ($library, $version, $record, $audit) {
        denied(fn () => $library->import($version, ['records' => [recordInput()]], $audit), 409);
        $result = $library->correct($version, $record, recordInput() + [], $audit);
        ensure($result->id === $record->id && $version->records()->count() === 1);
    });
    check('approval requires document/content review and detects stale content', function () use ($library, $version, $admin, $audit) {
        invalid(fn () => $library->approve($version, [], $admin, $audit));
        invalid(fn () => $library->approve($version, ['document_sha256' => $version->document_sha256, 'content_sha256' => $library->contentChecksum($version), 'actual_document_checked' => true, 'extracted_content_checked' => true, 'authorized_use_confirmed' => false, 'verification_notes' => 'Synthetic test must reject missing authorization attestation.'], $admin, $audit));
        denied(fn () => $library->approve($version, ['document_sha256' => $version->document_sha256, 'content_sha256' => str_repeat('0', 64), 'actual_document_checked' => true, 'extracted_content_checked' => true, 'authorized_use_confirmed' => true, 'verification_notes' => 'Synthetic test review with intentionally stale content hash.'], $admin, $audit), 409);
        approveVersion($version);
        ensure($version->fresh()->verification_status === 'verified');
    });
    check('reviewed source and edition metadata cannot be overwritten', function () use ($library, $source, $metadata, $version, $versionData, $audit) {
        denied(fn () => $library->updateSource($source, $metadata, $audit), 409);
        denied(fn () => $library->updateVersion($version, $versionData, $audit), 409);
    });
    check('verified retrieval carries exact outcomes and source/page/checksum references', function () use ($retrieval, $selection, $record, $source) {
        $result = $retrieval->retrieve($selection);
        ensure($result['available'] && $result['records'][0]['record_id'] === $record->id && $result['records'][0]['source']['identifier'] === $source->identifier);
        ensure($result['records'][0]['specific_learning_outcomes'][0]['text'] === recordInput()['specific_learning_outcomes'][0]);
        ensure(! isset($result['records'][0]['source']['document_path']));
        ensure($retrieval->retrieve($selection + ['topic' => 'Synthetic test outcome'])['available']);
        ensure(! $retrieval->retrieve($selection + ['topic' => '%'])['available']);
    });
    check('grade, subject, record and topic mismatches never fall back to invented content', function () use ($retrieval, $selection, $area, $record) {
        ensure(! $retrieval->retrieve(array_replace($selection, ['grade' => 8]))['available']);
        ensure(! $retrieval->retrieve(array_replace($selection, ['learning_area' => 'Other area']))['available']);
        ensure(! $retrieval->retrieve($selection + ['topic' => 'absent topic'])['available']);
        ensure(! $retrieval->retrieve($selection + ['record_ids' => [$record->id, 999999]])['available']);
        invalid(fn () => $retrieval->retrieve(array_replace($selection, ['learning_area' => 'Other area', 'subject_id' => $area->id])));
        invalid(fn () => $retrieval->retrieve($selection + ['guardian' => 'private']));
    });
    check('staff retrieval requires active teaching staff and denies family roles', function () use ($controller, $teacher, $parent, $selection, $retrieval) {
        $access = new TeachingDocumentAccess;
        denied(fn () => $controller->retrieve(requestFor($parent, $selection), $access, $retrieval));
        denied(fn () => $controller->retrieve(requestFor($teacher, $selection), $access, $retrieval));
        Staff::create(['user_id' => $teacher->id, 'first_name' => 'Synthetic', 'last_name' => 'Teacher', 'staff_type' => 'teaching', 'status' => 'active', 'role_title' => 'Synthetic teacher', 'employment_date' => '2026-01-01']);
        ensure($controller->retrieve(requestFor($teacher, $selection), $access, $retrieval)->getData(true)['data']['available']);
        $teacher->update(['status' => 'inactive']);
        denied(fn () => $controller->retrieve(requestFor($teacher, $selection), $access, $retrieval));
        $teacher->update(['status' => 'active']);
    });
    check('reviewed content is immutable and new editions preserve prior evidence', function () use ($library, $source, $versionData, $version, $record, $admin, $audit, $retrieval, $selection) {
        denied(fn () => $library->correct($version, $record, recordInput(), $audit), 409);
        denied(fn () => $library->import($version, ['records' => [recordInput('test.2')]], $audit), 409);
        $next = $library->addVersion($source, array_replace($versionData, ['edition' => 'Synthetic edition 2']), document('edition two'), $admin, $audit);
        $library->import($next, ['records' => [recordInput()]], $audit);
        approveVersion($next);
        ensure($version->fresh()->approval_status === 'superseded' && $version->records()->count() === 1);
        $library->withdraw($next, ['reason' => 'Synthetic edition withdrawn in isolated automated test.'], $admin, $audit);
        ensure($next->fresh()->verification_status === 'revoked');
        ensure(! $retrieval->retrieve($selection)['available'], 'Withdrawal must not reactivate a superseded edition.');
        // Return the original edition to active only inside this rollback-only fixture.
        $version->update(['approval_status' => 'approved']);
    });
    check('prompt context re-retrieves verified references as untrusted user data', function () use ($selection, $source) {
        $prompt = app(CurriculumPromptContext::class)->build('lesson_plan', $selection);
        ensure($prompt['available'] && $prompt['messages'][0]['role'] === 'system' && $prompt['messages'][1]['role'] === 'user');
        ensure(str_contains($prompt['messages'][0]['content'], 'untrusted curriculum reference data'));
        $data = json_decode($prompt['messages'][1]['content'], true, 512, JSON_THROW_ON_ERROR);
        ensure($data['reference_data']['records'][0]['source']['identifier'] === $source->identifier);
        ensure(! str_contains($prompt['messages'][1]['content'], 'verification_notes') && ! str_contains($prompt['messages'][1]['content'], 'authorization_basis'));
        invalid(fn () => app(CurriculumPromptContext::class)->build('lesson_plan', $selection + ['student_id' => 1]));
        ensure(! app(CurriculumPromptContext::class)->build('lesson_plan', array_replace($selection, ['grade' => 8]))['available']);
        Http::assertNothingSent();
    });

    $context = $retrieval->retrieve($selection);
    $r = $context['records'][0];
    $o = $r['specific_learning_outcomes'][0];
    $common = ['status' => 'draft', 'grade' => 7, 'learning_area' => $area->name, 'title' => 'Synthetic editable draft', 'curriculum_claims' => [],
        'curriculum_references' => [['record_id' => $r['record_id'], 'source_version_id' => $r['source']['version_id'], 'document_sha256' => $r['source']['document_sha256'], 'page_reference' => $r['source']['page_reference'], 'outcome_ids' => [$o['id']]]], 'specific_learning_outcomes' => [$o]];
    // Retrieval uses text, and contracts deliberately preserve that exact text.
    $links = ['curriculum_record_ids' => [$r['record_id']], 'learning_outcome_ids' => [$o['id']]];
    $question = $links + ['position' => 1, 'question_type' => 'short_answer', 'prompt' => 'Synthetic question', 'marks' => 5, 'options' => [], 'answer_key' => 'Synthetic answer', 'marking_guidance' => 'Synthetic guidance'];
    $drafts = [
        'scheme_of_work' => $common + ['total_duration_minutes' => 80, 'weeks' => [$links + ['week_number' => 1, 'lessons_per_week' => 2, 'lesson_duration_minutes' => 40, 'total_duration_minutes' => 80, 'learning_activities' => ['Synthetic activity'], 'assessment_approach' => 'Synthetic observation']]],
        'lesson_plan' => $common + ['duration_minutes' => 40, 'resources' => ['Synthetic resource'], 'assessment_approach' => 'Synthetic observation', 'stages' => array_map(fn ($phase, $duration) => $links + ['phase' => $phase, 'duration_minutes' => $duration, 'activities' => ['Synthetic activity']], ['introduction', 'development', 'conclusion'], [5, 30, 5])],
        'homework' => $common + ['instructions' => 'Synthetic instructions', 'total_marks' => 5, 'questions' => [$question]],
        'exam_paper' => $common + ['instructions' => 'Synthetic instructions', 'duration_minutes' => 40, 'total_marks' => 5, 'sections' => [['position' => 1, 'title' => 'Synthetic section', 'total_marks' => 5, 'questions' => [$question]]]],
    ];
    $contract = new GroundedDocumentContract;
    foreach ($drafts as $operation => $draft) {
        check($operation.' contract accepts a complete grounded editable draft', function () use ($contract, $operation, $draft, $selection) {
            ensure($contract->validate($operation, $draft, $selection) === $draft);
        });
        check($operation.' contract rejects missing fields, false claims and foreign context', function () use ($contract, $operation, $draft, $selection) {
            $bad = $draft;
            unset($bad['title']);
            invalid(fn () => $contract->validate($operation, $bad, $selection));
            foreach ([['grade' => 8], ['learning_area' => 'Other'], ['status' => 'approved'], ['title' => 'KICD approved draft'], ['curriculum_claims' => ['Unsupported alignment claim']], ['student_data' => 'private']] as $override) {
                invalid(fn () => $contract->validate($operation, array_replace($draft, $override), $selection));
            }
            $bad = $draft;
            $bad['curriculum_references'][0]['record_id'] = 999999;
            invalid(fn () => $contract->validate($operation, $bad, $selection));
            $bad = $draft;
            $bad['specific_learning_outcomes'][0]['text'] = 'Invented outcome';
            invalid(fn () => $contract->validate($operation, $bad, $selection));
        });
    }
    check('Ollama adapter accepts only verified curriculum context and contract-valid JSON', function () use ($drafts, $selection, $app) {
        config(['services.ai.driver' => 'ollama', 'services.ollama' => ['base_url' => 'http://ollama.test:11434', 'model' => 'qwen3:1.7b', 'timeout' => 120]]);
        ensure($app->make(TeachingAssistantProvider::class)->name() === 'ollama');
        $responses = [
            ['done' => true, 'message' => ['role' => 'assistant', 'content' => json_encode($drafts['lesson_plan'], JSON_THROW_ON_ERROR)]],
            ['done' => true, 'message' => ['role' => 'assistant', 'content' => 'not JSON']],
        ];
        Http::fake(function () use (&$responses) { return Http::response(array_shift($responses)); });
        $adapter = app(OllamaTeachingAssistantProvider::class);
        $result = $adapter->draft('lesson_plan', ['selection' => $selection, 'constraints' => ['duration_minutes' => '40']]);
        ensure($result['draft'] === $drafts['lesson_plan'] && str_contains($result['label'], 'Ollama'));
        Http::assertSent(fn ($request) => $request->method() === 'POST' && $request->url() === 'http://ollama.test:11434/api/chat');
        invalid(fn () => $adapter->draft('lesson_plan', ['selection' => $selection, 'student_name' => 'Must never be sent']));
        try { $adapter->draft('lesson_plan', ['selection' => $selection]); throw new RuntimeException('Invalid model JSON was accepted.'); }
        catch (RuntimeException $exception) { ensure(str_contains($exception->getMessage(), 'Ollama')); }
        config(['services.ai.driver' => 'disabled']);
        Http::fake();
    });
    check('marks and duration totals must match both item sums and requested constraints', function () use ($contract, $drafts, $selection) {
        foreach (['homework', 'exam_paper'] as $operation) {
            $bad = $drafts[$operation];
            $bad['total_marks']++;
            invalid(fn () => $contract->validate($operation, $bad, $selection));
        }
        $bad = $drafts['exam_paper'];
        $bad['sections'][0]['total_marks']++;
        invalid(fn () => $contract->validate('exam_paper', $bad, $selection));
        $bad = $drafts['lesson_plan'];
        $bad['duration_minutes']++;
        invalid(fn () => $contract->validate('lesson_plan', $bad, $selection));
        $bad = $drafts['lesson_plan'];
        $bad['stages'][1]['phase'] = 'conclusion';
        invalid(fn () => $contract->validate('lesson_plan', $bad, $selection));
        $bad = $drafts['scheme_of_work'];
        $bad['weeks'][0]['total_duration_minutes']++;
        invalid(fn () => $contract->validate('scheme_of_work', $bad, $selection));
        invalid(fn () => $contract->validate('lesson_plan', $drafts['lesson_plan'], $selection, ['duration_minutes' => 35]));
    });
    check('item references and multiple-choice answers are checked', function () use ($contract, $drafts, $selection) {
        $bad = $drafts['homework'];
        $bad['questions'][0]['learning_outcome_ids'] = [999999];
        invalid(fn () => $contract->validate('homework', $bad, $selection));
        $bad = $drafts['homework'];
        $bad['questions'][0]['question_type'] = 'multiple_choice';
        $bad['questions'][0]['options'] = ['One', 'Two'];
        invalid(fn () => $contract->validate('homework', $bad, $selection));
    });
    check('tampered verified content is excluded from retrieval and prompt building', function () use ($record, $selection, $retrieval) {
        $original = $record->strand;
        $record->update(['strand' => 'Tampered']);
        $ids = ['grade' => $selection['grade'], 'learning_area' => $selection['learning_area'], 'record_ids' => [$record->id]];
        ensure($retrieval->retrieve($ids)['reason'] === 'CURRICULUM_INTEGRITY_FAILED');
        ensure(! app(CurriculumPromptContext::class)->build('lesson_plan', $ids)['available']);
        $record->update(['strand' => $original]);
    });
    check('missing or modified source document fails closed', function () use ($version, $retrieval, $selection) {
        $disk = Storage::disk('private');
        $original = $disk->get($version->document_path);
        $disk->put($version->document_path, 'not the verified source');
        ensure($retrieval->retrieve($selection)['reason'] === 'CURRICULUM_INTEGRITY_FAILED');
        $disk->delete($version->document_path);
        ensure($retrieval->retrieve($selection)['reason'] === 'CURRICULUM_INTEGRITY_FAILED');
        $disk->put($version->document_path, $original);
    });
    check('existing provider remains disabled and curriculum routes retain auth and roles', function () use ($app) {
        config(['services.ai.driver' => 'disabled']);
        ensure($app->make(TeachingAssistantProvider::class)->name() === 'unavailable');
        foreach ($app['router']->getRoutes() as $route) {
            if (! str_starts_with($route->uri(), 'api/v1/curriculum-library')) {
                continue;
            }
            $middleware = $route->gatherMiddleware();
            ensure(in_array('auth:sanctum', $middleware, true));
            ensure(in_array(str_ends_with($route->uri(), '/retrieve') ? 'role:system_admin,head_teacher,deputy_head_teacher,teacher' : 'role:system_admin', $middleware, true));
        }
        Http::assertNothingSent();
    });
    echo $passed.' curriculum checks passed on '.($mysql ? 'isolated restored MySQL only' : 'in-memory SQLite only').'.'.PHP_EOL;
} finally {
    DB::rollBack();
}
