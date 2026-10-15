<?php

// Guarded teaching-workspace checks: this process only uses a fresh SQLite :memory: database.
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->bootstrapWith([Illuminate\Foundation\Bootstrap\LoadConfiguration::class]);
$app['config']->set('database.default', 'teaching_workspace_memory');
$app['config']->set('database.connections', ['teaching_workspace_memory' => [
    'driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '', 'foreign_key_constraints' => true,
]]);
$app['config']->set('session.driver', 'array');
$app['config']->set('cache.default', 'array');
$app['config']->set('cache.stores.array', ['driver' => 'array', 'serialize' => false]);
$app['config']->set('app.env', 'testing');
$app->instance('request', Illuminate\Http\Request::create('/'));
$app->bootstrapWith([
    Illuminate\Foundation\Bootstrap\RegisterFacades::class,
    Illuminate\Foundation\Bootstrap\RegisterProviders::class,
    Illuminate\Foundation\Bootstrap\BootProviders::class,
]);

use App\Http\Controllers\Api\AcademicCalendarController;
use App\Http\Controllers\Api\AcademicEventController;
use App\Http\Controllers\Api\HomeworkController;
use App\Http\Controllers\Api\LessonPlanController;
use App\Http\Controllers\Api\RecordOfWorkController;
use App\Http\Controllers\Api\SchemeOfWorkController;
use App\Http\Controllers\Api\TeacherAssignmentController;
use App\Models\AcademicYear;
use App\Models\ClassSubjectTeacher;
use App\Models\Homework;
use App\Models\HomeworkCompletion;
use App\Models\LessonPlan;
use App\Models\RecordOfWork;
use App\Models\Role;
use App\Models\SchoolClass;
use App\Models\Staff;
use App\Models\Subject;
use App\Models\Term;
use App\Models\User;
use App\Services\AcademicIntegrity;
use App\Services\AuditLogger;
use App\Services\TeachingDocumentAccess;
use App\Services\TeachingDocumentData;
use App\Services\TeachingDocumentExport;
use App\Services\HomeworkExport;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

$connection = DB::connection();
if ($connection->getDriverName() !== 'sqlite' || $connection->getDatabaseName() !== ':memory:') throw new RuntimeException('Refusing a non-memory database.');
Schema::create('roles', function (Blueprint $table) { $table->id(); $table->string('name')->unique(); });
Schema::create('users', function (Blueprint $table) {
    $table->id(); $table->string('username')->unique(); $table->string('email')->unique(); $table->string('password_hash');
    $table->foreignId('role_id')->constrained(); $table->string('status'); $table->timestamps();
});
Schema::create('staff', function (Blueprint $table) {
    $table->id(); $table->foreignId('user_id')->nullable()->constrained(); $table->string('first_name'); $table->string('last_name');
    $table->string('staff_type'); $table->string('status'); $table->timestamps();
});
Schema::create('academic_years', function (Blueprint $table) { $table->id(); $table->string('name')->unique(); $table->date('start_date'); $table->date('end_date'); $table->boolean('is_current')->default(false); });
Schema::create('terms', function (Blueprint $table) {
    $table->id(); $table->foreignId('academic_year_id')->constrained('academic_years')->restrictOnDelete(); $table->string('name');
    $table->date('start_date'); $table->date('end_date'); $table->boolean('is_current')->default(false);
});
Schema::create('classes', function (Blueprint $table) { $table->id(); $table->string('name'); $table->string('level'); $table->integer('sequence'); });
Schema::create('subjects', function (Blueprint $table) { $table->id(); $table->string('name'); $table->string('code')->nullable(); $table->string('learning_area')->nullable(); $table->string('status'); });
Schema::create('class_subjects', function (Blueprint $table) { $table->id(); $table->foreignId('class_id')->constrained('classes'); $table->foreignId('subject_id')->constrained('subjects'); });
Schema::create('class_subject_teacher', function (Blueprint $table) {
    $table->id(); $table->foreignId('class_id')->constrained('classes'); $table->foreignId('subject_id')->constrained('subjects');
    $table->foreignId('staff_id')->constrained('staff'); $table->foreignId('term_id')->constrained('terms'); $table->timestamps();
});
Schema::create('audit_logs', function (Blueprint $table) {
    $table->id(); $table->foreignId('user_id')->nullable()->constrained(); $table->string('action'); $table->string('entity_type')->nullable();
    $table->unsignedBigInteger('entity_id')->nullable(); $table->text('details')->nullable(); $table->string('ip_address')->nullable(); $table->timestamp('created_at');
});
// Calendar history checks inspect these existing academic dependencies.
Schema::create('assessments', function (Blueprint $table) { $table->id(); $table->foreignId('student_id')->constrained('students'); $table->foreignId('subject_id')->constrained('subjects'); $table->foreignId('term_id')->constrained('terms'); $table->foreignId('class_id')->nullable()->constrained('classes'); });
Schema::create('report_cards', function (Blueprint $table) { $table->id(); $table->foreignId('term_id')->constrained('terms'); });
Schema::create('promotions_transfers', function (Blueprint $table) { $table->id(); $table->foreignId('student_id')->constrained('students'); $table->foreignId('term_id')->constrained('terms'); $table->foreignId('from_class_id')->nullable()->constrained('classes'); $table->foreignId('to_class_id')->nullable()->constrained('classes'); });
// Assignment removal inspects the existing recurring timetable and legacy learner placements.
Schema::create('students', function (Blueprint $table) {
    $table->id(); $table->string('admission_no')->unique(); $table->string('first_name'); $table->string('last_name');
    $table->foreignId('class_id')->constrained('classes'); $table->string('status'); $table->timestamps();
});
Schema::create('timetable_entries', function (Blueprint $table) { $table->id(); $table->foreignId('class_id')->constrained('classes'); $table->foreignId('subject_id')->constrained('subjects'); $table->foreignId('staff_id')->constrained('staff'); });
(require dirname(__DIR__, 2).'/database/migrations/2026_10_15_000038_create_teaching_learning_workspace.php')->up();
(require dirname(__DIR__, 2).'/database/migrations/2026_10_15_000039_create_lesson_plans_and_records_of_work_tables.php')->up();
(require dirname(__DIR__, 2).'/database/migrations/2026_10_15_000040_create_homework_and_assignments_tables.php')->up();

function ensure(bool $condition, string $message): void { if (! $condition) throw new RuntimeException($message); }
function invalid(callable $operation, string $field): void {
    try { $operation(); } catch (ValidationException $exception) { ensure(isset($exception->errors()[$field]), 'Expected validation field '.$field); return; }
    throw new RuntimeException('Expected validation rejection for '.$field);
}
function requestFor(User $user, array $data = [], string $method = 'POST'): Request {
    $request = Request::create('/api/v1/check', $method, $data); $request->headers->set('Accept', 'application/json');
    $request->setUserResolver(fn () => $user); app()->instance('request', $request); auth()->setUser($user); return $request;
}
function actor(string $role): User {
    static $number = 0; $number++;
    return User::create(['username' => 'teaching-'.$number, 'email' => 'teaching-'.$number.'@example.test', 'password_hash' => 'test-only', 'status' => 'active', 'role_id' => Role::firstOrCreate(['name' => $role])->id]);
}
function teachingStaff(User $user): Staff { return Staff::create(['user_id' => $user->id, 'first_name' => 'Test', 'last_name' => 'Teacher', 'staff_type' => 'teaching', 'status' => 'active']); }
function check(string $name, callable $operation): void { global $passed; $operation(); $passed++; echo 'PASS '.$name.PHP_EOL; }

$admin = actor(Role::SYSTEM_ADMIN); $teacher = actor(Role::TEACHER); $otherTeacher = actor(Role::TEACHER); $teacherStaff = teachingStaff($teacher); $otherStaff = teachingStaff($otherTeacher);
$year = AcademicYear::create(['name' => 'Test year', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31']);
$term = Term::create(['academic_year_id' => $year->id, 'name' => 'Test term', 'start_date' => '2026-01-01', 'end_date' => '2026-04-30']);
$otherYear = AcademicYear::create(['name' => 'Other year', 'start_date' => '2027-01-01', 'end_date' => '2027-12-31']);
$class = SchoolClass::create(['name' => 'Test class', 'level' => 'primary', 'sequence' => 1]); $subject = Subject::create(['name' => 'Test area', 'code' => 'TA', 'status' => 'active']);
DB::table('class_subjects')->insert(['class_id' => $class->id, 'subject_id' => $subject->id]);
$assignment = ClassSubjectTeacher::create(['class_id' => $class->id, 'subject_id' => $subject->id, 'staff_id' => $teacherStaff->id, 'term_id' => $term->id]);
$otherAssignment = ClassSubjectTeacher::create(['class_id' => $class->id, 'subject_id' => $subject->id, 'staff_id' => $otherStaff->id, 'term_id' => $term->id]);
$secondTerm = Term::create(['academic_year_id' => $year->id, 'name' => 'Second term', 'start_date' => '2026-05-01', 'end_date' => '2026-08-31']);
$secondAssignment = ClassSubjectTeacher::create(['class_id' => $class->id, 'subject_id' => $subject->id, 'staff_id' => $teacherStaff->id, 'term_id' => $secondTerm->id]);
$integrity = new AcademicIntegrity(); $events = new AcademicEventController($integrity); $schemes = new SchemeOfWorkController(new TeachingDocumentAccess(), new TeachingDocumentData()); $calendar = new AcademicCalendarController($integrity); $passed = 0;
$access = new TeachingDocumentAccess(); $documentData = new TeachingDocumentData();
$lessonPlans = new LessonPlanController($access, $documentData, new TeachingDocumentExport());
$records = new RecordOfWorkController($access, $documentData, new TeachingDocumentExport());
$homeworks = new HomeworkController($access, $documentData, new HomeworkExport());

check('calendar events are contained by their school periods and audited', function () use ($events, $admin, $year, $term, $otherYear) {
    $request = requestFor($admin, ['academic_year_id' => $year->id, 'term_id' => $term->id, 'title' => 'Staff entered activity', 'event_type' => 'academic_activity', 'starts_on' => '2026-02-02', 'ends_on' => '2026-02-03']);
    $response = $events->store($request, new AuditLogger($request)); ensure($response->getStatusCode() === 201, 'Event created');
    ensure($events->index(requestFor($admin, [], 'GET'))->getData(true)['data'][0]['title'] === 'Staff entered activity', 'Event list');
    $invalid = requestFor($admin, ['academic_year_id' => $year->id, 'term_id' => Term::create(['academic_year_id' => $otherYear->id, 'name' => 'Other term', 'start_date' => '2027-01-01', 'end_date' => '2027-04-30'])->id, 'title' => 'Invalid', 'event_type' => 'meeting', 'starts_on' => '2026-02-03', 'ends_on' => '2026-02-03']);
    invalid(fn () => $events->store($invalid, new AuditLogger($invalid)), 'term_id');
    ensure(DB::table('audit_logs')->where('action', 'CREATE_ACADEMIC_EVENT')->exists(), 'Event audit');
});
check('term dates cannot discard linked calendar events', function () use ($calendar, $admin, $term) {
    $request = requestFor($admin, ['end_date' => '2026-02-01']); invalid(fn () => $calendar->updateTerm($request, $term, new AuditLogger($request)), 'start_date');
});
check('teachers create and plan only their exact allocations', function () use ($schemes, $teacher, $otherTeacher, $assignment, $otherAssignment) {
    $request = requestFor($teacher, ['class_subject_teacher_id' => $assignment->id, 'title' => 'Teacher draft', 'curriculum_reference' => 'School-reviewed source']);
    $created = $schemes->store($request, new AuditLogger($request)); ensure($created->getStatusCode() === 201, 'Draft created'); $scheme = $created->getData(true)['data'];
    try { $schemes->store(requestFor($otherTeacher, ['class_subject_teacher_id' => $assignment->id, 'title' => 'Foreign draft']), new AuditLogger(requestFor($otherTeacher))); throw new RuntimeException('Expected foreign allocation denial'); }
    catch (\Symfony\Component\HttpKernel\Exception\HttpException $exception) { ensure($exception->getStatusCode() === 403, 'Foreign allocation denied'); }
    $week = requestFor($teacher, ['week_number' => 1, 'starts_on' => '2026-02-02', 'ends_on' => '2026-02-06', 'strand' => 'Staff entered strand', 'sub_strand' => 'Staff entered sub-strand', 'learning_outcomes' => 'Staff entered outcomes', 'learning_activities' => 'Staff entered activities', 'resources' => 'Staff entered resources']);
    ensure($schemes->storeWeek($week, App\Models\SchemeOfWork::findOrFail($scheme['id']), new AuditLogger($week))->getStatusCode() === 201, 'Weekly plan created');
    $submit = requestFor($teacher); ensure($schemes->submit($submit, App\Models\SchemeOfWork::findOrFail($scheme['id']), new AuditLogger($submit))->getData(true)['data']['status'] === 'submitted', 'Teacher submitted');
});
function lessonPlanInput(array $replace = []): array {
    return array_replace([
        'class_subject_teacher_id' => 0, 'title' => 'Structured lesson plan', 'lesson_date' => '2026-02-03',
        'duration_minutes' => 40, 'strand' => 'Strand', 'sub_strand' => 'Sub-strand',
        'specific_learning_outcomes' => 'Outcomes', 'key_inquiry_questions' => 'Inquiry questions',
        'teaching_learning_resources' => 'Resources', 'introduction' => 'Introduction',
        'lesson_development' => 'Development', 'conclusion' => 'Conclusion', 'learning_activities' => 'Activities',
        'assessment_approach' => 'Assessment', 'teacher_reflection' => 'Reflection',
    ], $replace);
}
function recordInput(array $replace = []): array {
    return array_replace([
        'class_subject_teacher_id' => 0, 'taught_on' => '2026-02-03', 'content_covered' => 'Covered content',
        'learning_activities_conducted' => 'Conducted activities', 'work_completed' => 'Completed work',
        'work_not_completed' => 'One exercise', 'reasons_for_deviations' => 'Time',
        'teacher_observations' => 'Observations', 'follow_up_actions' => 'Review next lesson',
    ], $replace);
}
function homeworkInput(array $replace = []): array {
    return array_replace([
        'class_subject_teacher_id' => 0, 'title' => 'Staff entered homework', 'assigned_on' => '2026-02-03',
        'due_on' => '2026-02-06', 'submission_method' => 'exercise_book', 'instructions' => 'Complete the questions.',
        'learning_outcomes' => 'Demonstrate the planned learning outcome.', 'total_marks' => 10,
    ], $replace);
}

check('teachers create and revise lesson plans only in their exact assignments', function () use ($lessonPlans, $teacher, $otherTeacher, $assignment, $otherAssignment, $secondAssignment) {
    $request = requestFor($teacher, lessonPlanInput(['class_subject_teacher_id' => $assignment->id]));
    $created = $lessonPlans->store($request, new AuditLogger($request));
    ensure($created->getStatusCode() === 201, 'Lesson plan created'); $plan = $created->getData(true)['data'];
    ensure($plan['status'] === 'draft' && $plan['has_record_of_work'] === false, 'New plan is an undelivered draft');
    try { $lessonPlans->store(requestFor($otherTeacher, lessonPlanInput(['class_subject_teacher_id' => $assignment->id])), new AuditLogger(requestFor($otherTeacher))); throw new RuntimeException('Expected foreign allocation denial'); }
    catch (\Symfony\Component\HttpKernel\Exception\HttpException $exception) { ensure($exception->getStatusCode() === 403, 'Foreign allocation denied'); }
    invalid(fn () => $lessonPlans->store(requestFor($teacher, lessonPlanInput(['class_subject_teacher_id' => $secondAssignment->id, 'lesson_date' => '2026-09-01'])), new AuditLogger($request)), 'lesson_date');
    $foreignWeek = App\Models\SchemeOfWorkWeek::firstOrFail()->id;
    invalid(fn () => $lessonPlans->store(requestFor($teacher, lessonPlanInput(['class_subject_teacher_id' => $secondAssignment->id, 'lesson_date' => '2026-06-02', 'scheme_of_work_week_id' => $foreignWeek])), new AuditLogger($request)), 'scheme_of_work_week_id');
    try { $lessonPlans->store(requestFor($teacher, lessonPlanInput(['class_subject_teacher_id' => $otherAssignment->id])), new AuditLogger($request)); throw new RuntimeException('Expected other allocation denial'); }
    catch (\Symfony\Component\HttpKernel\Exception\HttpException $exception) { ensure($exception->getStatusCode() === 403, 'Another teacher allocation denied'); }
    $edit = requestFor($teacher, ['strand' => 'Revised strand']); ensure($lessonPlans->update($edit, LessonPlan::findOrFail($plan['id']), new AuditLogger($edit))->getData(true)['data']['strand'] === 'Revised strand', 'Draft edited');
    ensure(DB::table('audit_logs')->where('action', 'CREATE_LESSON_PLAN')->exists(), 'Lesson plan audit');
});
check('duplicating a lesson plan creates an independent editable draft', function () use ($lessonPlans, $teacher) {
    $source = LessonPlan::firstOrFail();
    $request = requestFor($teacher, ['lesson_date' => '2026-02-10']);
    $response = $lessonPlans->duplicate($request, $source, new AuditLogger($request));
    $copy = $response->getData(true)['data'];
    ensure($response->getStatusCode() === 201 && $copy['id'] !== $source->id, 'Copy created');
    ensure($copy['status'] === 'draft' && $copy['duplicated_from_lesson_plan_id'] === $source->id && $copy['teacher_reflection'] === null, 'Draft copy without previous reflection');
    ensure($copy['lesson_date'] === '2026-02-10' && $copy['strand'] === 'Revised strand', 'Planning content copied');
    ensure(DB::table('audit_logs')->where('action', 'DUPLICATE_LESSON_PLAN')->exists(), 'Duplicate audit');
});
check('lesson plan workflow is teacher submitted and leadership reviewed', function () use ($lessonPlans, $teacher, $admin, $otherTeacher) {
    $plan = LessonPlan::orderByDesc('id')->firstOrFail();
    try { $lessonPlans->submit(requestFor($admin), $plan, new AuditLogger(requestFor($admin))); throw new RuntimeException('Expected leadership submission denial'); }
    catch (\Symfony\Component\HttpKernel\Exception\HttpException $exception) { ensure($exception->getStatusCode() === 403, 'Leadership cannot submit a teacher plan'); }
    ensure($lessonPlans->submit(requestFor($teacher), $plan, new AuditLogger(requestFor($teacher)))->getData(true)['data']['status'] === 'submitted', 'Teacher submitted');
    $locked = requestFor($teacher, ['strand' => 'Late change']);
    try { $lessonPlans->update($locked, $plan, new AuditLogger($locked)); throw new RuntimeException('Expected read-only denial'); }
    catch (\Symfony\Component\HttpKernel\Exception\HttpException $exception) { ensure($exception->getStatusCode() === 409, 'Submitted plan is read-only'); }
    $missingNote = requestFor($admin, ['action' => 'returned']);
    try { $lessonPlans->review($missingNote, $plan, new AuditLogger($missingNote)); throw new RuntimeException('Expected review note requirement'); }
    catch (ValidationException $exception) { ensure(isset($exception->errors()['review_notes']), 'Returned review requires a note'); }
    $review = requestFor($admin, ['action' => 'returned', 'review_notes' => 'Add the weekly resources.']);
    ensure($lessonPlans->review($review, $plan, new AuditLogger($review))->getData(true)['data']['status'] === 'returned', 'Returned for changes');
    try { $lessonPlans->review($review, $plan, new AuditLogger($review)); throw new RuntimeException('Expected single review'); }
    catch (\Symfony\Component\HttpKernel\Exception\HttpException $exception) { ensure($exception->getStatusCode() === 409, 'Only submitted documents are reviewable'); }
});
check('a record of work is explicit and reports delivery only for its own plan', function () use ($records, $lessonPlans, $teacher, $otherTeacher, $assignment, $secondAssignment) {
    $plan = LessonPlan::orderByDesc('id')->firstOrFail();
    $request = requestFor($teacher, recordInput(['class_subject_teacher_id' => $assignment->id, 'lesson_plan_id' => $plan->id]));
    $created = $records->store($request, new AuditLogger($request)); ensure($created->getStatusCode() === 201, 'Record created');
    $record = $created->getData(true)['data'];
    ensure($record['lesson_plan']['id'] === $plan->id && $record['status'] === 'draft', 'Linked record');
    $detail = $lessonPlans->show(requestFor($teacher), $plan)->getData(true)['data'];
    ensure($detail['has_record_of_work'] === true && $detail['record_of_work']['id'] === $record['id'], 'Delivery follows a real record');
    invalid(fn () => $records->store(requestFor($teacher, recordInput(['class_subject_teacher_id' => $secondAssignment->id, 'taught_on' => '2026-06-02', 'lesson_plan_id' => $plan->id])), new AuditLogger($request)), 'lesson_plan_id');
    invalid(fn () => $records->store(requestFor($teacher, recordInput(['class_subject_teacher_id' => $assignment->id, 'taught_on' => '2027-01-05'])), new AuditLogger($request)), 'taught_on');
    try { $records->store(requestFor($otherTeacher, recordInput(['class_subject_teacher_id' => $assignment->id])), new AuditLogger($request)); throw new RuntimeException('Expected foreign record denial'); }
    catch (\Symfony\Component\HttpKernel\Exception\HttpException $exception) { ensure($exception->getStatusCode() === 403, 'Foreign record denied'); }
    $unlinked = LessonPlan::create(['class_subject_teacher_id' => $assignment->id, 'title' => 'Undelivered plan', 'lesson_date' => '2026-03-02',
        'duration_minutes' => 40, 'strand' => 'Strand', 'sub_strand' => 'Sub', 'specific_learning_outcomes' => 'Outcomes',
        'key_inquiry_questions' => 'Questions', 'teaching_learning_resources' => 'Resources', 'introduction' => 'Introduction',
        'lesson_development' => 'Development', 'conclusion' => 'Conclusion', 'learning_activities' => 'Activities',
        'assessment_approach' => 'Assessment', 'status' => 'draft', 'created_by' => $teacher->id]);
    $fresh = $lessonPlans->show(requestFor($teacher), $unlinked)->getData(true)['data'];
    ensure($fresh['has_record_of_work'] === false && $fresh['record_of_work'] === null, 'A plan alone is never delivered');
});
check('record of work review transitions are leader controlled and audited', function () use ($records, $teacher, $admin) {
    $record = RecordOfWork::firstOrFail();
    try { $records->review(requestFor($teacher, ['action' => 'approved']), $record, new AuditLogger(requestFor($teacher))); throw new RuntimeException('Expected teacher review denial'); }
    catch (\Symfony\Component\HttpKernel\Exception\HttpException $exception) { ensure($exception->getStatusCode() === 403, 'Teacher cannot review'); }
    ensure($records->submit(requestFor($teacher), $record, new AuditLogger(requestFor($teacher)))->getData(true)['data']['status'] === 'submitted', 'Teacher submitted record');
    $review = requestFor($admin, ['action' => 'approved']);
    ensure($records->review($review, $record, new AuditLogger($review))->getData(true)['data']['status'] === 'approved', 'Record approved');
    ensure(DB::table('audit_logs')->where('action', 'APPROVED_RECORD_OF_WORK')->exists(), 'Record review audit');
});
check('leadership review returns a submitted scheme and preserves the audit trail', function () use ($schemes, $admin) {
    $scheme = App\Models\SchemeOfWork::firstOrFail(); $request = requestFor($admin, ['action' => 'returned', 'review_notes' => 'Please clarify the weekly resources.']);
    $response = $schemes->review($request, $scheme, new AuditLogger($request)); ensure($response->getData(true)['data']['status'] === 'returned', 'Returned for revision');
    ensure(DB::table('audit_logs')->where('action', 'RETURNED_SCHEME_OF_WORK')->exists(), 'Review audit');
});
check('homework is allocation-scoped, teacher-published, and records only explicit completion evidence', function () use ($homeworks, $teacher, $otherTeacher, $admin, $assignment, $class) {
    $first = App\Models\Student::create(['admission_no' => 'HW-001', 'first_name' => 'Ada', 'last_name' => 'Learner', 'class_id' => $class->id, 'status' => 'active']);
    $second = App\Models\Student::create(['admission_no' => 'HW-002', 'first_name' => 'Ben', 'last_name' => 'Learner', 'class_id' => $class->id, 'status' => 'active']);
    $create = requestFor($teacher, homeworkInput(['class_subject_teacher_id' => $assignment->id]));
    $created = $homeworks->store($create, new AuditLogger($create));
    ensure($created->getStatusCode() === 201, 'Homework draft created');
    $homework = Homework::findOrFail($created->getData(true)['data']['id']);
    ensure($homework->status === 'draft' && $homework->assigned_on->toDateString() === '2026-02-03', 'Homework dates are cast and retained');
    $foreign = requestFor($otherTeacher, homeworkInput(['class_subject_teacher_id' => $assignment->id]));
    try { $homeworks->store($foreign, new AuditLogger($foreign)); throw new RuntimeException('Expected foreign homework denial'); }
    catch (\Symfony\Component\HttpKernel\Exception\HttpException $exception) { ensure($exception->getStatusCode() === 403, 'Foreign teacher denied'); }
    $question = requestFor($teacher, ['position' => 1, 'question_type' => 'multiple_choice', 'prompt' => 'Staff entered question', 'marks' => 10,
        'options' => ['Correct answer', 'Other answer'], 'answer_key' => 'Correct answer', 'marking_guidance' => 'Award the recorded mark.']);
    ensure($homeworks->storeQuestion($question, $homework, new AuditLogger($question))->getStatusCode() === 201, 'Question created');
    $family = (new TeachingDocumentData())->homeworkFamily($homework->fresh('questions'));
    ensure(isset($family['questions'][0]) && ! array_key_exists('answer_key', $family['questions'][0]) && ! array_key_exists('marking_guidance', $family['questions'][0]), 'Family homework omits assessment keys');
    try { $homeworks->publish(requestFor($admin), $homework, new AuditLogger(requestFor($admin))); throw new RuntimeException('Expected leadership publish denial'); }
    catch (\Symfony\Component\HttpKernel\Exception\HttpException $exception) { ensure($exception->getStatusCode() === 403, 'Leadership cannot publish teacher homework'); }
    $publish = requestFor($teacher); ensure($homeworks->publish($publish, $homework, new AuditLogger($publish))->getData(true)['data']['status'] === 'published', 'Teacher published homework');
    $record = requestFor($teacher, ['student_id' => $first->id, 'status' => 'missing', 'notes' => 'Teacher checked the exercise book.']);
    ensure($homeworks->recordCompletion($record, $homework, new AuditLogger($record))->getData(true)['data']['status'] === 'missing', 'Missing requires an explicit teacher record');
    $rows = $homeworks->completions(requestFor($teacher), $homework)->getData(true)['data']['learners'];
    ensure(collect($rows)->firstWhere('student_id', $first->id)['status'] === 'missing', 'Recorded learner has evidence status');
    ensure(collect($rows)->firstWhere('student_id', $second->id)['status'] === null, 'No completion row remains not yet recorded');
    $completion = HomeworkCompletion::where('homework_id', $homework->id)->where('student_id', $first->id)->firstOrFail();
    $remove = requestFor($teacher); $homeworks->destroyCompletion($remove, $homework, $completion, new AuditLogger($remove));
    ensure($homeworks->completions(requestFor($teacher), $homework)->getData(true)['data']['learners'][0]['status'] === null, 'Removing a record restores not yet recorded');
    ensure(DB::table('audit_logs')->where('action', 'PUBLISH_HOMEWORK')->exists() && DB::table('audit_logs')->where('action', 'RECORD_HOMEWORK_COMPLETION')->exists(), 'Homework audit trail');
});
check('teaching documents block assignment deletion and are exportable as PDFs', function () use ($lessonPlans, $records, $schemes, $teacher, $otherTeacher, $admin, $assignment) {
    $plan = LessonPlan::firstOrFail();
    $assignments = new TeacherAssignmentController(new AcademicIntegrity());
    $request = requestFor($admin);
    ensure($assignments->destroy(ClassSubjectTeacher::findOrFail($assignment->id), new AuditLogger($request))->getStatusCode() === 409, 'Assignment with teaching history retained');
    $week = App\Models\SchemeOfWorkWeek::firstOrFail(); $scheme = App\Models\SchemeOfWork::firstOrFail();
    ensure($scheme->status === 'returned', 'Returned scheme is editable again');
    $linked = $lessonPlans->store(requestFor($teacher, lessonPlanInput(['class_subject_teacher_id' => $assignment->id, 'lesson_date' => '2026-02-17', 'scheme_of_work_week_id' => $week->id])), new AuditLogger(requestFor($teacher)));
    ensure($linked->getData(true)['data']['scheme_week']['id'] === $week->id, 'Lesson plan linked to a weekly plan');
    ensure($schemes->destroyWeek(requestFor($teacher), $scheme, $week, new AuditLogger(requestFor($teacher)))->getData(true)['error']['code'] === 'WEEK_IN_USE', 'Linked weekly plan is retained');
    $pdf = $lessonPlans->pdf(requestFor($teacher), $plan);
    ensure($pdf->getStatusCode() === 200 && str_contains($pdf->headers->get('Content-Type') ?? '', 'application/pdf'), 'Lesson plan PDF');
    $recordPdf = $records->pdf(requestFor($teacher), RecordOfWork::firstOrFail());
    ensure($recordPdf->getStatusCode() === 200 && str_contains($recordPdf->headers->get('Content-Type') ?? '', 'application/pdf'), 'Record PDF');
    try { $lessonPlans->show(requestFor($otherTeacher), $plan); throw new RuntimeException('Expected foreign read denial'); }
    catch (ModelNotFoundException $exception) { ensure(str_contains($exception->getModel(), LessonPlan::class), 'Foreign teacher cannot read another allocation plan'); }
    try { $lessonPlans->pdf(requestFor($otherTeacher), $plan); throw new RuntimeException('Expected foreign export denial'); }
    catch (ModelNotFoundException $exception) { ensure(str_contains($exception->getModel(), LessonPlan::class), 'Foreign teacher cannot export'); }
});

echo $passed.' Teaching & Learning Workspace checks passed on in-memory SQLite only.'.PHP_EOL;
