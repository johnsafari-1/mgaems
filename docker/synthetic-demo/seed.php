<?php

require __DIR__.'/bootstrap.php';

use App\Models\AcademicYear;
use App\Models\Role;
use App\Models\SchoolSetting;
use App\Models\Staff;
use App\Models\Term;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\CurriculumLibrary;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

try {
$app = syntheticDemoApp();
$db = DB::connection();
if ($db->getDriverName() !== 'mysql' || $db->getDatabaseName() !== 'mgaems_synthetic_demo') {
    throw new RuntimeException('Refusing to initialize a non-demo database.');
}
$uuid = $db->selectOne('SELECT @@server_uuid AS uuid')->uuid;
if (!Schema::hasTable('synthetic_demo_identity')) {
    if ($db->select('SHOW TABLES') !== []) {
        throw new RuntimeException('Refusing to initialize a nonempty unmarked database.');
    }
    // Ordinary installation on this new, empty isolated database; never a reset.
    $kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
    if ($kernel->call('migrate', ['--force' => true]) !== 0) {
        throw new RuntimeException('Demo schema installation failed: '.$kernel->output());
    }
    Schema::create('synthetic_demo_identity', function (Blueprint $table) {
        $table->string('id', 80)->primary();
        $table->string('server_uuid', 64);
        $table->boolean('seeded')->default(false);
        $table->text('manifest')->nullable();
    });
    DB::table('synthetic_demo_identity')->insert(['id' => 'mgaems-original-science-v1', 'server_uuid' => $uuid, 'seeded' => false]);
}
assertSyntheticDemoIdentity(false);
$identity = DB::table('synthetic_demo_identity')->first();
if ($identity->seeded) {
    echo 'Existing isolated synthetic demo retained; no fixtures overwritten.'.PHP_EOL;
    exit(0);
}
if (DB::table('users')->exists() || DB::table('curriculum_sources')->exists()) {
    throw new RuntimeException('Refusing to seed over existing demo records.');
}

function demoRequest(User $actor, array $body, string $method = 'POST'): Request
{
    $request = Request::create('http://localhost:8010/api/v1/synthetic-setup', $method, $body);
    $request->headers->set('Accept', 'application/json');
    $request->setUserResolver(fn () => $actor);
    app()->instance('request', $request);
    auth()->setUser($actor);

    return $request;
}

function demoCreate(string $controller, string $method, User $actor, array $body): array
{
    $request = demoRequest($actor, $body);
    $response = app($controller)->$method($request, new AuditLogger($request));
    if ($response->getStatusCode() !== 201) throw new RuntimeException('Demo create failed: '.$response->getContent());

    return $response->getData(true)['data'];
}

$manifest = DB::transaction(function () {
    $adminRole = Role::create(['name' => Role::SYSTEM_ADMIN]);
    $teacherRole = Role::create(['name' => Role::TEACHER]);
    // Public fictional demo credentials, never credentials for the school's app.
    $password = Hash::make('DemoOnly!2026');
    $admin = User::create(['username' => 'demo.admin', 'email' => 'demo.admin@example.invalid', 'password_hash' => $password, 'status' => 'active', 'role_id' => $adminRole->id]);
    $teacher = User::create(['username' => 'demo.teacher', 'email' => 'demo.teacher@example.invalid', 'password_hash' => $password, 'status' => 'active', 'role_id' => $teacherRole->id]);
    $staff = Staff::create(['user_id' => $teacher->id, 'staff_type' => 'teaching', 'role_title' => 'Synthetic demo teacher', 'first_name' => 'Demo', 'last_name' => 'Teacher', 'employment_date' => now()->startOfYear()->toDateString(), 'status' => 'active']);
    SchoolSetting::create(['school_name' => 'MGAEMS - SYNTHETIC DEMO', 'motto' => 'Original test material; not official curriculum']);
    $year = AcademicYear::create(['name' => 'Synthetic '.now()->year, 'start_date' => now()->startOfYear()->toDateString(), 'end_date' => now()->endOfYear()->toDateString(), 'is_current' => true]);
    $term = Term::create(['academic_year_id' => $year->id, 'name' => 'Demo term', 'start_date' => $year->start_date->toDateString(), 'end_date' => $year->end_date->toDateString(), 'is_current' => true]);
    $class = demoCreate(App\Http\Controllers\Api\AcademicStructureController::class, 'storeClass', $admin,
        ['name' => 'Demo Grade 7', 'level' => 'junior', 'sequence' => 7, 'class_teacher_id' => $staff->id]);
    $subject = demoCreate(App\Http\Controllers\Api\AcademicStructureController::class, 'storeSubject', $admin,
        ['name' => 'Integrated Science', 'code' => 'DEMO-SCIE', 'learning_area' => 'Integrated Science']);
    demoCreate(App\Http\Controllers\Api\AcademicStructureController::class, 'attachSubjectToClass', $admin, ['class_id' => $class['id'], 'subject_id' => $subject['id']]);
    $allocation = demoCreate(App\Http\Controllers\Api\TeacherAssignmentController::class, 'store', $admin,
        ['class_id' => $class['id'], 'subject_id' => $subject['id'], 'staff_id' => $staff->id, 'term_id' => $term->id]);

    $outcome = 'Read two thermometer values in degrees Celsius and identify the warmer sample.';
    $record = ['record_key' => 'original.temperature.1', 'strand' => 'Observing and measuring', 'sub_strand' => 'Temperature readings', 'page_reference' => 'Original synthetic demonstration sheet, page 1',
        'specific_learning_outcomes' => [$outcome],
        'suggested_learning_experiences' => ['Read original thermometer diagrams labelled 20 and 30 degrees Celsius.', 'Compare both readings and explain which sample is warmer.'],
        'key_inquiry_questions' => ['How can two thermometer readings help us compare samples?'],
        'assessment_approaches' => ['Record two fresh readings, identify the warmer sample and explain the comparison.']];
    $request = demoRequest($admin, []);
    $audit = new AuditLogger($request);
    $library = app(CurriculumLibrary::class);
    $source = $library->register(['identifier' => 'original-synthetic-grade7-temperature-v1', 'title' => 'Original synthetic Grade 7 temperature-reading demonstration',
        'publisher' => 'MGAEMS synthetic demo fixtures', 'official_url' => 'https://example.invalid/mgaems/synthetic-temperature',
        'grade' => 7, 'learning_area' => 'Integrated Science', 'subject_id' => $subject['id']], $admin, $audit);
    $pdf = new Dompdf\Dompdf();
    $html = '<h1>Original synthetic demonstration sheet</h1><p>Not official curriculum. Grade 7 science practice for software testing only.</p><h2>Observing and measuring: Temperature readings</h2><p>'.htmlspecialchars($outcome).'</p><p>Diagram A: 20 degrees Celsius. Diagram B: 30 degrees Celsius. B is warmer because its temperature is higher.</p><p>Practice: a reading changes from 22 to 27 degrees Celsius. The sample became warmer by 5 degrees Celsius.</p>';
    foreach (['suggested_learning_experiences', 'key_inquiry_questions', 'assessment_approaches'] as $field) {
        $html .= '<h3>'.htmlspecialchars(str_replace('_', ' ', $field)).'</h3><ul>';
        foreach ($record[$field] as $text) $html .= '<li>'.htmlspecialchars($text).'</li>';
        $html .= '</ul>';
    }
    $pdf->loadHtml($html);
    $pdf->render();
    $temporary = storage_path('app/original-synthetic-source.pdf');
    if (file_put_contents($temporary, $pdf->output()) === false) throw new RuntimeException('Could not create original demo PDF.');
    $version = $library->addVersion($source, ['edition' => 'Original synthetic demonstration v1', 'document_url' => 'https://example.invalid/mgaems/synthetic-temperature.pdf',
        'authorization_basis' => 'Original demonstration text authored specifically as repository test fixtures for this isolated software demo. No third-party or official curriculum content is included.'],
        new UploadedFile($temporary, 'original-synthetic-source.pdf', 'application/pdf', null, true), $admin, $audit);
    $library->import($version, ['records' => [$record]], $audit);
    $library->approve($version, ['document_sha256' => $version->document_sha256, 'content_sha256' => $library->contentChecksum($version),
        'actual_document_checked' => true, 'extracted_content_checked' => true, 'authorized_use_confirmed' => true,
        'verification_notes' => 'The PDF and structured extraction are built from the same original fixture text in this seeder. All outcomes, examples and record fields were compared for this isolated demo only.'], $admin, $audit);

    $assignment = ['class_subject_teacher_id' => $allocation['id']];
    $scheme = demoCreate(App\Http\Controllers\Api\SchemeOfWorkController::class, 'store', $teacher, $assignment + ['title' => 'DEMO - Temperature scheme', 'curriculum_reference' => 'Original synthetic demonstration sheet, page 1']);
    $plan = demoCreate(App\Http\Controllers\Api\LessonPlanController::class, 'store', $teacher, $assignment + [
        'title' => 'DEMO - Temperature lesson', 'lesson_date' => now()->toDateString(), 'duration_minutes' => 40,
        'strand' => 'Observing and measuring', 'sub_strand' => 'Temperature readings', 'specific_learning_outcomes' => $outcome,
        'key_inquiry_questions' => 'How can we compare two thermometer readings?', 'teaching_learning_resources' => 'Original thermometer diagrams',
        'introduction' => 'Generate a sample draft, review it, then apply it here.', 'lesson_development' => 'Ready for reviewed demonstration content.',
        'conclusion' => 'Ready for reviewed demonstration content.', 'learning_activities' => 'Read and compare thermometer diagrams.', 'assessment_approach' => 'Check both readings and the warmer comparison.']);
    $homework = demoCreate(App\Http\Controllers\Api\HomeworkController::class, 'store', $teacher, $assignment + [
        'title' => 'DEMO - Temperature homework', 'instructions' => 'Generate and import the reviewed synthetic questions.', 'learning_outcomes' => $outcome,
        'total_marks' => 10, 'assigned_on' => now()->toDateString(), 'due_on' => min(now()->addDays(3)->toDateString(), $term->end_date->toDateString()), 'submission_method' => 'exercise_book']);
    $exam = demoCreate(App\Http\Controllers\Api\ExamPaperController::class, 'store', $teacher, $assignment + [
        'title' => 'DEMO - Temperature paper', 'examination_type' => 'end_term', 'duration_minutes' => 40]);
    $manifest = ['class_id' => $class['id'], 'subject_id' => $subject['id'], 'allocation_id' => $allocation['id'], 'source_id' => $source->id, 'version_id' => $version->id,
        'documents' => ['scheme_of_work' => $scheme['id'], 'lesson_plan' => $plan['id'], 'homework' => $homework['id'], 'exam_paper' => $exam['id']]];
    DB::table('synthetic_demo_identity')->where('id', 'mgaems-original-science-v1')->update(['seeded' => true, 'manifest' => json_encode($manifest, JSON_THROW_ON_ERROR)]);

    return $manifest;
});
echo 'Synthetic demo initialized; school records were not accessed.'.PHP_EOL;
echo json_encode($manifest, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
} catch (Throwable $exception) {
    fwrite(STDERR, 'Synthetic demo setup failed: '.$exception->getMessage().PHP_EOL);
    exit(1);
}
