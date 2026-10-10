<?php

// Guarded standalone checks: no dotenv, development migrations, PHPUnit configuration,
// development connection, or persistent fixtures are used.
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->bootstrapWith([Illuminate\Foundation\Bootstrap\LoadConfiguration::class]);
$app['config']->set('database.default', 'academic_structure_memory');
$app['config']->set('database.connections', ['academic_structure_memory' => [
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
use App\Http\Controllers\Api\AcademicStructureController;
use App\Http\Controllers\Api\AssessmentController;
use App\Http\Controllers\Api\TeacherAssignmentController;
use App\Http\Controllers\Api\TimetableController;
use App\Http\Middleware\EnsureRole;
use App\Models\AcademicYear;
use App\Models\Assessment;
use App\Models\ClassSubjectTeacher;
use App\Models\Role;
use App\Models\SchoolClass;
use App\Models\Staff;
use App\Models\Student;
use App\Models\Subject;
use App\Models\Term;
use App\Models\TimetableEntry;
use App\Models\User;
use App\Services\AcademicIntegrity;
use App\Services\AuditLogger;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

$connection = DB::connection();
if ($connection->getDriverName() !== 'sqlite' || $connection->getDatabaseName() !== ':memory:') throw new RuntimeException('Refusing a non-memory database.');
Schema::create('roles', function (Blueprint $table) { $table->id(); $table->string('name'); });
Schema::create('users', function (Blueprint $table) {
    $table->id(); $table->string('username')->unique(); $table->string('email')->unique(); $table->string('password_hash');
    $table->foreignId('role_id')->constrained(); $table->string('status'); $table->timestamps();
});
Schema::create('staff', function (Blueprint $table) {
    $table->id(); $table->foreignId('user_id')->nullable()->constrained(); $table->string('first_name'); $table->string('last_name');
    $table->string('staff_type'); $table->string('status'); $table->string('phone')->nullable(); $table->string('contract_type')->nullable(); $table->timestamps();
});
Schema::create('academic_years', function (Blueprint $table) { $table->id(); $table->string('name')->unique(); $table->date('start_date'); $table->date('end_date'); $table->boolean('is_current')->default(false); });
Schema::create('terms', function (Blueprint $table) {
    $table->id(); $table->foreignId('academic_year_id')->constrained('academic_years')->restrictOnDelete();
    $table->string('name'); $table->date('start_date'); $table->date('end_date'); $table->boolean('is_current')->default(false); $table->unique(['academic_year_id', 'name'], 'uq_term');
});
Schema::create('classes', function (Blueprint $table) {
    $table->id(); $table->string('name')->unique(); $table->string('level'); $table->integer('sequence'); $table->integer('capacity')->nullable();
    $table->foreignId('class_teacher_id')->nullable()->constrained('staff')->nullOnDelete();
});
Schema::create('subjects', function (Blueprint $table) { $table->id(); $table->string('name')->unique(); $table->string('code')->nullable()->unique(); $table->string('learning_area')->nullable(); $table->string('status')->default('active'); });
Schema::create('class_subjects', function (Blueprint $table) {
    $table->id(); $table->foreignId('class_id')->constrained('classes')->restrictOnDelete(); $table->foreignId('subject_id')->constrained('subjects')->restrictOnDelete(); $table->unique(['class_id', 'subject_id'], 'uq_class_subject');
});
Schema::create('class_subject_teacher', function (Blueprint $table) {
    $table->id(); $table->foreignId('class_id')->constrained('classes')->restrictOnDelete(); $table->foreignId('subject_id')->constrained()->restrictOnDelete();
    $table->foreignId('staff_id')->constrained('staff')->restrictOnDelete(); $table->foreignId('term_id')->constrained()->restrictOnDelete();
    $table->timestamps(); $table->unique(['class_id', 'subject_id', 'term_id'], 'uq_class_subject_term');
});
Schema::create('timetable_entries', function (Blueprint $table) {
    $table->id(); $table->foreignId('class_id')->constrained('classes')->restrictOnDelete(); $table->foreignId('subject_id')->constrained()->restrictOnDelete();
    $table->foreignId('staff_id')->constrained('staff')->restrictOnDelete(); $table->integer('day_of_week'); $table->time('start_time'); $table->time('end_time'); $table->timestamps();
});
Schema::create('students', function (Blueprint $table) {
    $table->id(); $table->string('admission_no')->unique(); $table->string('first_name'); $table->string('last_name'); $table->date('date_of_birth');
    $table->string('gender'); $table->foreignId('class_id')->constrained('classes')->restrictOnDelete(); $table->string('status'); $table->date('admission_date'); $table->timestamps();
});
Schema::create('promotions_transfers', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id')->constrained(); $table->string('type');
    $table->foreignId('from_class_id')->nullable()->constrained('classes')->nullOnDelete(); $table->foreignId('to_class_id')->nullable()->constrained('classes')->nullOnDelete();
    $table->foreignId('term_id')->constrained()->restrictOnDelete(); $table->foreignId('recorded_by')->constrained('users'); $table->date('effective_date'); $table->string('reason')->nullable(); $table->timestamp('created_at')->useCurrent();
});
Schema::create('assessments', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id')->constrained(); $table->foreignId('subject_id')->constrained()->restrictOnDelete(); $table->foreignId('term_id')->constrained()->restrictOnDelete();
    $table->foreignId('recorded_by')->constrained('users'); $table->string('assessment_type'); $table->decimal('score')->nullable();
    $table->string('competency_rating')->nullable(); $table->string('remarks')->nullable(); $table->timestamp('recorded_at')->useCurrent();
    $table->unique(['student_id', 'subject_id', 'term_id', 'assessment_type']);
});
Schema::create('report_cards', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id')->constrained(); $table->foreignId('term_id')->constrained()->restrictOnDelete();
    $table->string('file_path')->nullable(); $table->string('overall_remark')->nullable(); $table->timestamp('generated_at')->nullable();
    $table->foreignId('generated_by')->nullable()->constrained('users')->nullOnDelete(); $table->unique(['student_id', 'term_id'], 'uq_report_card');
});
Schema::create('audit_logs', function (Blueprint $table) {
    $table->id(); $table->foreignId('user_id')->nullable()->constrained(); $table->string('action'); $table->string('entity_type')->nullable();
    $table->unsignedBigInteger('entity_id')->nullable(); $table->text('details')->nullable(); $table->string('ip_address')->nullable(); $table->timestamp('created_at');
});

// Exercise the additive history migration only against these explicit memory fixtures.
(require dirname(__DIR__, 2).'/database/migrations/2026_10_06_000035_add_assessment_and_report_history.php')->up();

function ensure(bool $condition, string $message): void { if (! $condition) throw new RuntimeException($message); }
function invalid(callable $operation, string $field): void {
    try { $operation(); } catch (ValidationException $exception) { ensure(isset($exception->errors()[$field]), 'Expected validation field '.$field); return; }
    throw new RuntimeException('Expected rejection: '.$field);
}
function requestFor(User $user, array $data = [], string $method = 'POST'): Request {
    $request = Request::create('/api/v1/check', $method, $data); $request->headers->set('Accept', 'application/json');
    $request->setUserResolver(fn () => $user); app()->instance('request', $request); auth()->setUser($user); return $request;
}
function actor(string $role): User {
    static $number = 0; $number++;
    $roleId = Role::firstOrCreate(['name' => $role])->id;
    return User::create(['username' => 'academic-test-'.$number, 'email' => 'academic-test-'.$number.'@example.test', 'password_hash' => 'test-only-hash', 'status' => 'active', 'role_id' => $roleId]);
}
function classroom(): SchoolClass { static $number = 0; return SchoolClass::create(['name' => 'Class test '.++$number, 'level' => 'primary', 'sequence' => $number, 'capacity' => 30]); }
function area(string $status = 'active'): Subject { static $number = 0; return Subject::create(['name' => 'Area test '.++$number, 'code' => 'AT'.$number, 'status' => $status]); }
function staff(?User $user = null, string $status = 'active', string $type = 'teaching'): Staff {
    return Staff::create(['user_id' => $user?->id, 'first_name' => 'Teacher', 'last_name' => 'Test', 'staff_type' => $type, 'status' => $status, 'phone' => 'private-contact', 'contract_type' => 'private-contract']);
}
function year(string $start = '2026-01-01', string $end = '2026-12-31'): AcademicYear { static $number = 0; return AcademicYear::create(['name' => 'Year test '.++$number, 'start_date' => $start, 'end_date' => $end]); }
function period(AcademicYear $year, string $start = '2026-01-01', string $end = '2026-04-30'): Term {
    static $number = 0; return Term::create(['name' => 'Period test '.++$number, 'academic_year_id' => $year->id, 'start_date' => $start, 'end_date' => $end]);
}
function learner(SchoolClass $class): Student {
    static $number = 0; return Student::create(['admission_no' => 'ACADEMIC-TEST-'.++$number, 'first_name' => 'Test', 'last_name' => 'Learner', 'date_of_birth' => '2020-01-01', 'gender' => 'female', 'status' => 'active', 'class_id' => $class->id, 'admission_date' => '2026-01-01']);
}
$integrity = new AcademicIntegrity(); $calendar = new AcademicCalendarController($integrity); $structure = new AcademicStructureController($integrity);
$assignments = new TeacherAssignmentController($integrity); $timetable = new TimetableController($integrity);
$leader = actor('head_teacher'); $teacher = actor('teacher');
$passed = 0;
function check(string $name, callable $operation): void { global $passed; $operation(); $passed++; echo 'PASS '.$name.PHP_EOL; }

check('calendar partial edits validate merged date ranges and preserve contained terms', function () use ($calendar, $leader) {
    $year = year(); $term = period($year);
    $request = requestFor($leader, ['end_date' => '2025-01-01']); invalid(fn () => $calendar->updateYear($request, $year, new AuditLogger($request)), 'end_date');
    $request = requestFor($leader, ['start_date' => '2026-02-01']); invalid(fn () => $calendar->updateYear($request, $year, new AuditLogger($request)), 'start_date');
    $request = requestFor($leader, ['end_date' => '2025-12-31']); invalid(fn () => $calendar->updateTerm($request, $term, new AuditLogger($request)), 'end_date');
    $request = requestFor($leader, ['end_date' => '2026-03-31']); ensure($calendar->updateTerm($request, $term, new AuditLogger($request))->getStatusCode() === 200, 'Valid partial edit');
    $request = requestFor($leader, ['name' => 'One-day period', 'academic_year_id' => $year->id, 'start_date' => '2026-05-01', 'end_date' => '2026-05-01']);
    ensure($calendar->storeTerm($request, new AuditLogger($request))->getStatusCode() === 201, 'Inclusive start <= end');
});

check('terms belong within their year, cannot overlap siblings, and keep their owner', function () use ($calendar, $leader) {
    $year = year(); $term = period($year);
    $input = ['name' => 'New period', 'academic_year_id' => $year->id, 'start_date' => '2026-05-01', 'end_date' => '2026-08-31'];
    foreach ([['start_date' => '2025-12-31'], ['end_date' => '2027-01-01'], ['start_date' => '2026-04-30']] as $change) {
        $request = requestFor($leader, array_replace($input, $change)); invalid(fn () => $calendar->storeTerm($request, new AuditLogger($request)), 'start_date');
    }
    $request = requestFor($leader, $input); ensure($calendar->storeTerm($request, new AuditLogger($request))->getStatusCode() === 201, 'Adjacent non-overlapping periods');
    $request = requestFor($leader, $input); ensure($calendar->storeTerm($request, new AuditLogger($request))->getStatusCode() === 409, 'Duplicate period name');
    $request = requestFor($leader, ['academic_year_id' => year()->id]); invalid(fn () => $calendar->updateTerm($request, $term, new AuditLogger($request)), 'academic_year_id');
});

check('activation keeps exactly one current year and a term in its owning year', function () use ($calendar, $leader) {
    $one = year(); $two = year(); $first = period($one); $second = period($two);
    $request = requestFor($leader); $calendar->activateTerm($first, new AuditLogger($request));
    ensure($one->fresh()->is_current && $first->fresh()->is_current, 'Owning year activated');
    $calendar->activateTerm($second, new AuditLogger($request));
    ensure(AcademicYear::where('is_current', true)->count() === 1 && Term::where('is_current', true)->count() === 1 && $two->fresh()->is_current, 'Single current flags');
    $calendar->activateYear($one, new AuditLogger($request)); ensure(Term::where('is_current', true)->count() === 0, 'Other-year term cleared');
    ensure($calendar->destroyYear($one, new AuditLogger($request))->getStatusCode() === 409, 'Current year deletion blocked');
});

check('class teachers and staff options require active teaching staff and minimize HR data', function () use ($structure, $leader) {
    $active = staff(); $inactive = staff(null, 'terminated'); $other = staff(null, 'active', 'non_teaching');
    $input = ['name' => 'Configured class', 'level' => 'primary', 'sequence' => 20, 'capacity' => 25, 'class_teacher_id' => $active->id];
    foreach ([$inactive->id, $other->id, 99999] as $id) { $request = requestFor($leader, array_replace($input, ['class_teacher_id' => $id])); invalid(fn () => $structure->storeClass($request, new AuditLogger($request)), 'class_teacher_id'); }
    $request = requestFor($leader, $input); $data = $structure->storeClass($request, new AuditLogger($request))->getData(true)['data'];
    ensure($data['capacity'] === 25 && $data['class_teacher_id'] === $active->id && array_keys($data['class_teacher']) === ['id', 'first_name', 'last_name'], 'Class metadata and minimal teacher response');
    $options = $structure->staffOptions()->getData(true)['data'];
    ensure(count($options) === 1 && array_keys($options[0]) === ['id', 'display_name'], 'Options expose only eligible ID/name');
});

check('offerings use the existing pivot, prevent duplicates, and reject inactive areas', function () use ($structure, $leader) {
    $class = classroom(); $subject = area(); $inactive = area('inactive');
    $request = requestFor($leader, ['class_id' => $class->id, 'subject_id' => $subject->id]);
    ensure($structure->attachSubjectToClass($request, new AuditLogger($request))->getStatusCode() === 201, 'Offering attached');
    ensure($structure->attachSubjectToClass($request, new AuditLogger($request))->getStatusCode() === 409, 'Duplicate offering');
    $bad = requestFor($leader, ['class_id' => $class->id, 'subject_id' => $inactive->id]); invalid(fn () => $structure->attachSubjectToClass($bad, new AuditLogger($bad)), 'subject_id');
    $list = $structure->indexClassSubjects(requestFor($leader, ['class_id' => $class->id], 'GET'))->getData(true)['data'];
    ensure(count($list) === 1 && ! isset($list[0]['pivot']), 'Shaped offering list');
    ensure($structure->detachSubjectFromClass($request, new AuditLogger($request))->getStatusCode() === 200 && DB::table('class_subjects')->where('class_id', $class->id)->count() === 0, 'Unused offering safely detached');
});

check('subject teachers require valid offerings, active areas/staff, and distinct term allocations', function () use ($assignments, $leader) {
    $class = classroom(); $subject = area(); $staff = staff(); $term = period(year());
    $input = ['class_id' => $class->id, 'subject_id' => $subject->id, 'staff_id' => $staff->id, 'term_id' => $term->id];
    $request = requestFor($leader, $input); invalid(fn () => $assignments->store($request, new AuditLogger($request)), 'subject_id');
    $class->subjects()->attach($subject->id);
    $bad = requestFor($leader, array_replace($input, ['staff_id' => staff(null, 'on_leave')->id])); invalid(fn () => $assignments->store($bad, new AuditLogger($bad)), 'staff_id');
    $data = $assignments->store($request, new AuditLogger($request))->getData(true)['data'];
    ensure(array_keys($data['staff']) === ['id', 'first_name', 'last_name'], 'No HR data on assignment response');
    ensure($assignments->store($request, new AuditLogger($request))->getStatusCode() === 409, 'Duplicate assignment');
    $subject->update(['status' => 'inactive']);
    $bad = requestFor($leader, array_replace($input, ['term_id' => period(year())->id])); invalid(fn () => $assignments->store($bad, new AuditLogger($bad)), 'subject_id');
});

check('timetable protects teacher AND class overlaps while allowing adjacent slots', function () use ($timetable, $leader) {
    $one = classroom(); $two = classroom(); $subject = area(); $first = staff(); $second = staff();
    $one->subjects()->attach($subject->id); $two->subjects()->attach($subject->id);
    $input = ['class_id' => $one->id, 'subject_id' => $subject->id, 'staff_id' => $first->id, 'day_of_week' => 1, 'start_time' => '09:00', 'end_time' => '10:00'];
    $request = requestFor($leader, $input); $saved = $timetable->store($request, new AuditLogger($request))->getData(true)['data'];
    ensure(array_keys($saved['staff']) === ['id', 'first_name', 'last_name'], 'Minimal timetable staff');
    $request = requestFor($leader, array_replace($input, ['class_id' => $two->id, 'start_time' => '09:30']));
    ensure($timetable->store($request, new AuditLogger($request))->getData(true)['error']['code'] === 'TEACHER_CONFLICT', 'Teacher overlap');
    $request = requestFor($leader, array_replace($input, ['staff_id' => $second->id, 'start_time' => '09:30']));
    ensure($timetable->store($request, new AuditLogger($request))->getData(true)['error']['code'] === 'CLASS_CONFLICT', 'Different teacher, same class overlap');
    $request = requestFor($leader, array_replace($input, ['start_time' => '10:00', 'end_time' => '11:00'])); ensure($timetable->store($request, new AuditLogger($request))->getStatusCode() === 201, 'Adjacent slot');
    foreach ([['end_time' => '09:00'], ['start_time' => '25:00'], ['day_of_week' => 8]] as $change) { $request = requestFor($leader, array_replace($input, $change)); invalid(fn () => $timetable->store($request, new AuditLogger($request)), array_key_first($change)); }
});

check('removal preserves offerings, allocations, timetable, and historical learner placements', function () use ($structure, $assignments, $calendar, $leader) {
    $class = classroom(); $subject = area(); $staff = staff(); $term = period(year()); $class->subjects()->attach($subject->id);
    $allocation = ClassSubjectTeacher::create(['class_id' => $class->id, 'subject_id' => $subject->id, 'staff_id' => $staff->id, 'term_id' => $term->id]);
    $request = requestFor($leader, ['class_id' => $class->id, 'subject_id' => $subject->id]);
    ensure($structure->detachSubjectFromClass($request, new AuditLogger($request))->getStatusCode() === 409, 'Offering allocation dependency');
    ensure($structure->destroySubject($subject, new AuditLogger($request))->getStatusCode() === 409, 'Referenced subject not deleted');
    ensure($structure->destroyClass($class, new AuditLogger($request))->getStatusCode() === 409, 'Referenced class not deleted');
    ensure($calendar->destroyTerm($term, new AuditLogger($request))->getStatusCode() === 409, 'Allocated period not deleted');
    $entry = TimetableEntry::create(['class_id' => $class->id, 'subject_id' => $subject->id, 'staff_id' => $staff->id, 'day_of_week' => 2, 'start_time' => '09:00', 'end_time' => '10:00']);
    ensure($assignments->destroy($allocation, new AuditLogger($request))->getStatusCode() === 409, 'Recurring timetable allocation dependency');
    $entry->delete(); $allocation->delete();
    $other = classroom(); $child = learner($other);
    $child->promotionsTransfers()->create(['type' => 'promotion', 'from_class_id' => $class->id, 'to_class_id' => $other->id, 'term_id' => $term->id, 'recorded_by' => $leader->id, 'effective_date' => '2026-04-01']);
    $class->subjects()->detach($subject->id);
    ensure($structure->destroyClass($class, new AuditLogger($request))->getStatusCode() === 409, 'Historical class FK must not be nulled');
});

check('assessment dependencies remain visible after promotion and block destructive changes', function () use ($integrity, $structure, $assignments, $calendar, $leader) {
    $old = classroom(); $next = classroom(); $subject = area(); $staff = staff(); $term = period(year()); $old->subjects()->attach($subject->id);
    $allocation = ClassSubjectTeacher::create(['class_id' => $old->id, 'subject_id' => $subject->id, 'staff_id' => $staff->id, 'term_id' => $term->id]);
    $child = learner($next);
    $child->promotionsTransfers()->create(['type' => 'promotion', 'from_class_id' => $old->id, 'to_class_id' => $next->id, 'term_id' => $term->id, 'recorded_by' => $leader->id, 'effective_date' => '2026-04-01']);
    Assessment::create(['student_id' => $child->id, 'subject_id' => $subject->id, 'term_id' => $term->id, 'recorded_by' => $leader->id, 'assessment_type' => 'continuous', 'score' => 75]);
    ensure($integrity->hasAssessments($old->id, $subject->id, $term->id), 'Historical class dependency');
    $request = requestFor($leader); ensure($assignments->destroy($allocation, new AuditLogger($request))->getStatusCode() === 409, 'Historical teacher authorization retained');
    $edit = requestFor($leader, ['end_date' => '2026-03-01']); invalid(fn () => $calendar->updateTerm($edit, $term, new AuditLogger($edit)), 'start_date');
    ensure($calendar->destroyTerm($term, new AuditLogger($request))->getStatusCode() === 409, 'Period history retained');
    $subject->update(['status' => 'inactive']); ensure(Assessment::where('subject_id', $subject->id)->count() === 1, 'Retirement retains assessments');
});

check('existing assessment authorization and performance semantics remain intact', function () use ($assignments, $leader, $teacher) {
    $class = classroom(); $subject = area(); $staff = staff($teacher); $term = period(year()); $class->subjects()->attach($subject->id); $child = learner($class);
    $input = ['class_id' => $class->id, 'subject_id' => $subject->id, 'staff_id' => $staff->id, 'term_id' => $term->id];
    $request = requestFor($leader, $input); $assignments->store($request, new AuditLogger($request));
    $controller = new AssessmentController();
    $request = requestFor($teacher); ensure($controller->context($request)->getData(true)['data']['scope'] === 'assigned', 'Teacher context remains scoped');
    $request = requestFor($teacher, ['class_id' => $class->id, 'subject_id' => $subject->id, 'term_id' => $term->id, 'assessment_type' => 'continuous', 'student_id' => $child->id, 'score' => 80, 'competency_rating' => 'Meeting Expectation']);
    ensure($controller->store($request, new AuditLogger($request))->getStatusCode() === 201, 'Existing score and performance rating');
    $other = area(); $bad = requestFor($teacher, array_replace($request->all(), ['subject_id' => $other->id]));
    try { $controller->store($bad, new AuditLogger($bad)); throw new RuntimeException('Expected unassigned assessment denial'); }
    catch (\Symfony\Component\HttpKernel\Exception\HttpException $exception) { ensure($exception->getStatusCode() === 403, 'No unassigned assessment rights'); }
});

check('report cards alone protect period dates and deletion', function () use ($calendar, $leader) {
    $term = period(year()); $child = learner(classroom());
    DB::table('report_cards')->insert(['student_id' => $child->id, 'term_id' => $term->id]);
    $request = requestFor($leader);
    ensure($calendar->destroyTerm($term, new AuditLogger($request))->getStatusCode() === 409, 'Report card period retained');
    $edit = requestFor($leader, ['end_date' => '2026-03-31']);
    invalid(fn () => $calendar->updateTerm($edit, $term, new AuditLogger($edit)), 'start_date');
    $edit = requestFor($leader, ['name' => 'Historical period']);
    ensure($calendar->updateTerm($edit, $term, new AuditLogger($edit))->getStatusCode() === 200, 'Historical labels remain editable');
});

check('unused academic records can be explicitly removed with audit records', function () use ($calendar, $structure, $assignments, $timetable, $leader) {
    $class = classroom(); $subject = area(); $staff = staff(); $year = year(); $term = period($year);
    $class->subjects()->attach($subject->id);
    $allocation = ClassSubjectTeacher::create(['class_id' => $class->id, 'subject_id' => $subject->id, 'staff_id' => $staff->id, 'term_id' => $term->id]);
    $entry = TimetableEntry::create(['class_id' => $class->id, 'subject_id' => $subject->id, 'staff_id' => $staff->id, 'day_of_week' => 1, 'start_time' => '09:00', 'end_time' => '10:00']);
    $request = requestFor($leader, ['class_id' => $class->id, 'subject_id' => $subject->id]); $audit = new AuditLogger($request);
    ensure($timetable->destroy($entry, $audit)->getStatusCode() === 200, 'Explicit timetable removal');
    ensure($assignments->destroy($allocation, $audit)->getStatusCode() === 200, 'Unused allocation removal');
    ensure($structure->detachSubjectFromClass($request, $audit)->getStatusCode() === 200, 'Unused offering removal');
    ensure($structure->destroyClass($class, $audit)->getStatusCode() === 200, 'Unused class removal');
    ensure($structure->destroySubject($subject, $audit)->getStatusCode() === 200, 'Unused subject removal');
    ensure($calendar->destroyTerm($term, $audit)->getStatusCode() === 200, 'Unused term removal');
    ensure($calendar->destroyYear($year, $audit)->getStatusCode() === 200, 'Empty year removal');
    ensure(!SchoolClass::find($class->id) && !Subject::find($subject->id) && !Term::find($term->id) && !AcademicYear::find($year->id), 'Records removed, no cascade required');
    ensure(DB::table('audit_logs')->where('action', 'DELETE_CLASS')->where('entity_id', $class->id)->exists(), 'Deletion audited');
});

check('timetable rejects unavailable offerings and ineligible teaching references', function () use ($timetable, $leader) {
    $class = classroom(); $subject = area(); $teacher = staff();
    $input = ['class_id' => $class->id, 'subject_id' => $subject->id, 'staff_id' => $teacher->id, 'day_of_week' => 1, 'start_time' => '09:00', 'end_time' => '10:00'];
    $request = requestFor($leader, $input); invalid(fn () => $timetable->store($request, new AuditLogger($request)), 'subject_id');
    $class->subjects()->attach($subject->id);
    foreach ([staff(null, 'terminated')->id, staff(null, 'active', 'non_teaching')->id] as $id) {
        $request = requestFor($leader, array_replace($input, ['staff_id' => $id])); invalid(fn () => $timetable->store($request, new AuditLogger($request)), 'staff_id');
    }
    $subject->update(['status' => 'inactive']);
    $request = requestFor($leader, $input); invalid(fn () => $timetable->store($request, new AuditLogger($request)), 'subject_id');
});

check('an audit failure rolls back academic configuration writes', function () use ($structure, $leader) {
    $class = classroom(); $subject = area();
    $request = requestFor($leader, ['class_id' => $class->id, 'subject_id' => $subject->id]);
    $audit = new class($request) extends AuditLogger {
        public function log(string $action, ?string $entityType = null, ?int $entityId = null, array $details = []): App\Models\AuditLog {
            throw new RuntimeException('Simulated audit failure in memory only');
        }
    };
    try { $structure->attachSubjectToClass($request, $audit); throw new LogicException('Expected audit failure'); }
    catch (RuntimeException $exception) { ensure($exception->getMessage() === 'Simulated audit failure in memory only', 'Expected failure'); }
    ensure(!$class->subjects()->exists(), 'Offering write rolled back');
});

check('significant writes use existing audit records and teachers remain non-administrators', function () use ($teacher, $leader) {
    ensure(DB::table('audit_logs')->where('action', 'ATTACH_SUBJECT_TO_CLASS')->exists()
        && DB::table('audit_logs')->where('action', 'ACTIVATE_ACADEMIC_YEAR')->exists()
        && DB::table('audit_logs')->where('action', 'CREATE_TIMETABLE_ENTRY')->exists(), 'Existing audit system used');
    $middleware = new EnsureRole(); $next = fn () => response()->json(['data' => []]);
    ensure($middleware->handle(requestFor($teacher), $next, 'system_admin', 'head_teacher', 'deputy_head_teacher')->getStatusCode() === 403, 'Teacher administration denied');
    ensure($middleware->handle(requestFor($leader), $next, 'system_admin', 'head_teacher')->getStatusCode() === 403, 'Unlinked leadership denied');
    staff($leader);
    ensure($middleware->handle(requestFor($leader), $next, 'system_admin', 'head_teacher')->getStatusCode() === 200, 'Existing calendar authority');
});

echo $passed.' Academic Structure checks passed on in-memory SQLite only.'.PHP_EOL;
