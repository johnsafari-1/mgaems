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
use App\Http\Controllers\Api\SchemeOfWorkController;
use App\Models\AcademicYear;
use App\Models\ClassSubjectTeacher;
use App\Models\Role;
use App\Models\SchoolClass;
use App\Models\Staff;
use App\Models\Subject;
use App\Models\Term;
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
Schema::create('assessments', function (Blueprint $table) { $table->id(); $table->foreignId('term_id')->constrained('terms'); });
Schema::create('report_cards', function (Blueprint $table) { $table->id(); $table->foreignId('term_id')->constrained('terms'); });
Schema::create('promotions_transfers', function (Blueprint $table) { $table->id(); $table->foreignId('term_id')->constrained('terms'); });
(require dirname(__DIR__, 2).'/database/migrations/2026_10_15_000038_create_teaching_learning_workspace.php')->up();

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
$integrity = new AcademicIntegrity(); $events = new AcademicEventController($integrity); $schemes = new SchemeOfWorkController(new App\Services\SchemeOfWorkAccess()); $calendar = new AcademicCalendarController($integrity); $passed = 0;

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
check('leadership review returns a submitted scheme and preserves the audit trail', function () use ($schemes, $admin) {
    $scheme = App\Models\SchemeOfWork::firstOrFail(); $request = requestFor($admin, ['action' => 'returned', 'review_notes' => 'Please clarify the weekly resources.']);
    $response = $schemes->review($request, $scheme, new AuditLogger($request)); ensure($response->getData(true)['data']['status'] === 'returned', 'Returned for revision');
    ensure(DB::table('audit_logs')->where('action', 'RETURNED_SCHEME_OF_WORK')->exists(), 'Review audit');
});

echo $passed.' Teaching & Learning Workspace checks passed on in-memory SQLite only.'.PHP_EOL;
