<?php

// Guarded integration checks: skip dotenv, replace every connection before
// providers boot, and never run repository migrations or persistent fixtures.
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->bootstrapWith([Illuminate\Foundation\Bootstrap\LoadConfiguration::class]);
$app['config']->set('database.default', 'attendance_memory');
$app['config']->set('database.connections', ['attendance_memory' => [
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

use App\Http\Controllers\Api\AttendanceController;
use App\Http\Controllers\Api\ParentPortalController;
use App\Http\Controllers\Api\StudentController;
use App\Http\Middleware\EnsureRole;
use App\Models\AttendanceStudent;
use App\Models\Guardian;
use App\Models\Role;
use App\Models\SchoolClass;
use App\Models\Staff;
use App\Models\Student;
use App\Models\User;
use App\Services\AttendanceAccess;
use App\Services\AuditLogger;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

$connection = DB::connection();
if ($connection->getDriverName() !== 'sqlite' || $connection->getDatabaseName() !== ':memory:') {
    throw new RuntimeException('Refusing to run outside explicit in-memory SQLite.');
}
Carbon::setTestNow(Carbon::parse('2026-10-06 10:00:00', 'Africa/Nairobi'));
Schema::create('roles', function (Blueprint $table) { $table->id(); $table->string('name'); });
Schema::create('users', function (Blueprint $table) {
    $table->id(); $table->string('username')->unique(); $table->string('email')->unique(); $table->string('password_hash');
    $table->foreignId('role_id')->constrained(); $table->string('status'); $table->timestamps();
});
Schema::create('staff', function (Blueprint $table) {
    $table->id(); $table->foreignId('user_id')->nullable()->unique()->constrained('users');
    $table->string('first_name'); $table->string('last_name'); $table->string('staff_type'); $table->string('status'); $table->timestamps();
});
Schema::create('classes', function (Blueprint $table) {
    $table->id(); $table->string('name'); $table->string('level')->default('primary'); $table->integer('sequence')->default(1);
    $table->foreignId('class_teacher_id')->nullable()->constrained('staff')->nullOnDelete();
});
Schema::create('students', function (Blueprint $table) {
    $table->id(); $table->string('admission_no')->unique(); $table->string('first_name'); $table->string('last_name');
    $table->date('date_of_birth'); $table->string('gender'); $table->foreignId('class_id')->constrained('classes')->restrictOnDelete();
    $table->string('status'); $table->date('admission_date'); $table->timestamps();
});
Schema::create('terms', function (Blueprint $table) { $table->id(); $table->string('name'); });
Schema::create('promotions_transfers', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id')->constrained('students'); $table->string('type');
    $table->foreignId('from_class_id')->nullable()->constrained('classes')->nullOnDelete();
    $table->foreignId('to_class_id')->nullable()->constrained('classes')->nullOnDelete();
    $table->foreignId('term_id')->constrained('terms'); $table->foreignId('recorded_by')->constrained('users');
    $table->date('effective_date'); $table->string('reason')->nullable(); $table->timestamp('created_at')->useCurrent();
});
Schema::create('attendance_students', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id')->constrained('students')->cascadeOnDelete();
    $table->foreignId('class_id')->constrained('classes')->restrictOnDelete(); $table->date('attendance_date');
    $table->string('status'); $table->foreignId('recorded_by')->constrained('users')->restrictOnDelete(); $table->timestamps();
    $table->unique(['student_id', 'attendance_date'], 'uq_student_attendance');
});
Schema::create('audit_logs', function (Blueprint $table) {
    $table->id(); $table->foreignId('user_id')->nullable()->constrained('users'); $table->string('action'); $table->string('entity_type')->nullable();
    $table->unsignedBigInteger('entity_id')->nullable(); $table->text('details')->nullable(); $table->string('ip_address')->nullable(); $table->timestamp('created_at');
});
Schema::create('guardians', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id')->constrained('students'); $table->foreignId('user_id')->nullable()->constrained('users');
    $table->string('full_name'); $table->string('relationship'); $table->string('phone'); $table->boolean('is_primary_contact')->default(false);
});
Schema::create('class_subject_teacher', function (Blueprint $table) { $table->id(); $table->foreignId('class_id')->constrained('classes'); $table->foreignId('staff_id')->constrained('staff'); });

function ensure(bool $condition, string $message): void { if (! $condition) throw new RuntimeException($message); }
function forbidden(callable $operation): void {
    try { $operation(); } catch (HttpException $exception) { ensure($exception->getStatusCode() === 403, 'Expected forbidden response'); return; }
    throw new RuntimeException('Expected forbidden operation');
}
function invalid(callable $operation, string $field): void {
    try { $operation(); } catch (ValidationException $exception) { ensure(isset($exception->errors()[$field]), 'Expected validation field '.$field); return; }
    throw new RuntimeException('Expected validation error: '.$field);
}
function actor(string $role): User {
    static $number = 0; $number++;
    return User::create(['username' => 'attendance-test-'.$number, 'email' => 'attendance-test-'.$number.'@example.test', 'password_hash' => 'memory-only',
        'role_id' => Role::firstOrCreate(['name' => $role])->id, 'status' => 'active']);
}
function teacherStaff(User $user, string $status = 'active', string $type = 'teaching'): Staff {
    return Staff::create(['user_id' => $user->id, 'first_name' => 'Test', 'last_name' => 'Teacher', 'staff_type' => $type, 'status' => $status]);
}
function classroom(?Staff $staff = null): SchoolClass { static $number = 0; return SchoolClass::create(['name' => 'Configured test class '.++$number, 'level' => 'primary', 'sequence' => $number, 'class_teacher_id' => $staff?->id]); }
function learner(SchoolClass $class): Student {
    static $number = 0; return Student::create(['admission_no' => 'ATTENDANCE-TEST-'.++$number, 'first_name' => 'Test', 'last_name' => 'Learner', 'date_of_birth' => '2020-01-01',
        'gender' => 'female', 'class_id' => $class->id, 'status' => 'active', 'admission_date' => '2026-01-01']);
}
function requestFor(User $user, array $data = [], string $method = 'POST'): Request {
    $request = Request::create('/api/v1/check', $method, $data); $request->headers->set('Accept', 'application/json');
    $request->setUserResolver(fn () => $user); app()->instance('request', $request); auth()->setUser($user); return $request;
}
function payload(SchoolClass $class, Student $student, string $status = 'present', string $date = '2026-10-01'): array {
    return ['class_id' => $class->id, 'attendance_date' => $date, 'records' => [['student_id' => $student->id, 'status' => $status]]];
}
function record(AttendanceController $controller, User $user, array $payload) {
    $request = requestFor($user, $payload); return $controller->store($request, new AuditLogger($request));
}
function roster(AttendanceController $controller, User $user, SchoolClass $class, string $date = '2026-10-01'): array {
    return $controller->roster(requestFor($user, ['class_id' => $class->id, 'attendance_date' => $date], 'GET'))->getData(true)['data'];
}
$controller = new AttendanceController(new AttendanceAccess());
$leader = actor('head_teacher'); $teacher = actor('teacher'); $staff = teacherStaff($teacher); $class = classroom($staff); $child = learner($class);
$foreignTeacher = actor('teacher'); $foreignStaff = teacherStaff($foreignTeacher); $foreignClass = classroom($foreignStaff); $foreignChild = learner($foreignClass);
$passed = 0;
function check(string $name, callable $operation): void { global $passed; $operation(); $passed++; echo 'PASS '.$name.PHP_EOL; }

check('class teachers discover and write only their class; subject allocation grants no attendance rights', function () use ($controller, $teacher, $staff, $class, $child, $foreignClass, $foreignChild) {
    DB::table('class_subject_teacher')->insert(['class_id' => $foreignClass->id, 'staff_id' => $staff->id]);
    $request = requestFor($teacher, [], 'GET'); $response = $controller->myClasses($request)->getData(true);
    ensure(array_column($response['data'], 'id') === [$class->id] && array_keys($response['data'][0]) === ['id', 'name'], 'Minimal owned class list');
    ensure($response['meta']['today'] === '2026-10-06' && $response['meta']['timezone'] === 'Africa/Nairobi', 'School date metadata');
    ensure(record($controller, $teacher, payload($class, $child))->getStatusCode() === 201, 'Own class write');
    forbidden(fn () => record($controller, $teacher, payload($foreignClass, $foreignChild) + ['staff_id' => $staff->id]));
    forbidden(fn () => roster($controller, $teacher, $foreignClass));
});

check('unlinked, inactive, non-teaching and inactive-account teachers fail closed', function () use ($controller, $class, $child) {
    foreach ([['active', null], ['active', 'on_leave'], ['active', 'terminated'], ['non_teaching', 'active']] as [$type, $status]) {
        $user = actor('teacher'); if ($status) teacherStaff($user, $status, $type === 'non_teaching' ? $type : 'teaching');
        forbidden(fn () => $controller->myClasses(requestFor($user, [], 'GET')));
        forbidden(fn () => record($controller, $user, payload($class, $child)));
    }
    $user = actor('teacher'); teacherStaff($user); $user->update(['status' => 'inactive']);
    forbidden(fn () => $controller->myClasses(requestFor($user, [], 'GET')));
});

check('all leadership roles oversee classes without a staff link; other roles cannot administer attendance', function () use ($controller, $foreignClass, $foreignChild) {
    foreach (['system_admin', 'head_teacher', 'deputy_head_teacher'] as $role) {
        $user = actor($role); ensure(count($controller->myClasses(requestFor($user, [], 'GET'))->getData(true)['data']) >= 2, 'Leadership discovery');
        ensure(record($controller, $user, payload($foreignClass, $foreignChild, 'late'))->getStatusCode() < 300, 'Leadership recording');
    }
    foreach (['parent_guardian', 'sponsor', 'secretary'] as $role) {
        $user = actor($role); forbidden(fn () => $controller->myClasses(requestFor($user, [], 'GET')));
        forbidden(fn () => record($controller, $user, payload($foreignClass, $foreignChild)));
    }
});

check('mixed-class bulk payloads are rejected atomically, including leadership payloads', function () use ($controller, $teacher, $leader, $class, $child, $foreignChild) {
    $input = payload($class, $child, 'absent', '2026-10-02'); $input['records'][] = ['student_id' => $foreignChild->id, 'status' => 'present'];
    foreach ([$teacher, $leader] as $user) invalid(fn () => record($controller, $user, $input), 'records.1.student_id');
    ensure(AttendanceStudent::where('attendance_date', '2026-10-02')->count() === 0, 'No partial writes');
    $input = payload($class, $child, 'late'); $input['records'][] = ['student_id' => $foreignChild->id, 'status' => 'present'];
    invalid(fn () => record($controller, $teacher, $input), 'records.1.student_id');
    ensure(AttendanceStudent::where('student_id', $child->id)->where('attendance_date', '2026-10-01')->value('status') === 'present', 'Existing status not partially corrected');
});

check('school dates are strict calendar strings and reject invalid/future/timestamp values', function () use ($controller, $teacher, $class, $child) {
    foreach (['2026-10-07', '2026-02-30', '2026-1-1', '2026-10-01T23:30:00-03:00', 'tomorrow'] as $date) invalid(fn () => record($controller, $teacher, payload($class, $child, 'present', $date)), 'attendance_date');
    Carbon::setTestNow(Carbon::parse('2026-10-06 22:00:00', 'UTC')); // Already the next school date.
    ensure($controller->myClasses(requestFor($teacher, [], 'GET'))->getData(true)['meta']['today'] === '2026-10-07', 'School-local midnight rather than UTC date');
    ensure(record($controller, $teacher, payload($class, $child, 'present', '2026-10-07'))->getStatusCode() === 201, 'School today accepted');
    Carbon::setTestNow(Carbon::parse('2026-10-06 10:00:00', 'Africa/Nairobi'));
});

check('status vocabulary and bulk duplicate/missing/unknown learner inputs are validated', function () use ($controller, $teacher, $class, $child) {
    invalid(fn () => record($controller, $teacher, payload($class, $child, 'not_recorded')), 'records.0.status');
    $input = payload($class, $child); $input['records'][] = $input['records'][0];
    invalid(fn () => record($controller, $teacher, $input), 'records.0.student_id');
    $input = payload($class, $child); $input['records'][0]['student_id'] = 999999;
    invalid(fn () => record($controller, $teacher, $input), 'records.0.student_id');
    $input['records'] = []; invalid(fn () => record($controller, $teacher, $input), 'records');
});

check('repeated submission is idempotent and corrections preserve row identity/class/date with audit deltas', function () use ($controller, $teacher, $class, $child) {
    $before = AttendanceStudent::where('student_id', $child->id)->where('attendance_date', '2026-10-01')->first(); $audits = DB::table('audit_logs')->count();
    $response = record($controller, $teacher, payload($class, $child))->getData(true);
    ensure($response['meta'] === ['created' => 0, 'updated' => 0, 'unchanged' => 1] && DB::table('audit_logs')->count() === $audits, 'Duplicate request makes no contradictory changes or audit noise');
    $response = record($controller, $teacher, payload($class, $child, 'excused'))->getData(true);
    $after = $before->fresh(); ensure($after->id === $before->id && $after->class_id === $class->id && $after->attendance_date->toDateString() === '2026-10-01' && $after->status === 'excused', 'Status-only correction');
    $details = json_decode(DB::table('audit_logs')->latest('id')->value('details'), true);
    ensure($details['updated'] === 1 && $details['changes'][0] === ['attendance_id' => $before->id, 'from' => 'present', 'to' => 'excused'], 'Meaningful correction metadata');
    ensure(!isset($response['data'][0]['recorded_by'], $response['data'][0]['created_at']), 'Minimized write response');
});

check('database uniqueness and class history foreign keys remain authoritative', function () use ($teacher, $class, $child) {
    try { AttendanceStudent::create(['student_id' => $child->id, 'class_id' => $class->id, 'attendance_date' => '2026-10-01', 'status' => 'absent', 'recorded_by' => $teacher->id]); throw new LogicException('Expected unique constraint'); }
    catch (QueryException $exception) { ensure(str_contains($exception->getMessage(), 'UNIQUE'), 'Unique learner/date enforced'); }
    $empty = classroom(); $moved = learner($empty);
    AttendanceStudent::create(['student_id' => $moved->id, 'class_id' => $empty->id, 'attendance_date' => '2026-09-01', 'status' => 'present', 'recorded_by' => $teacher->id]); $moved->update(['class_id' => $class->id]);
    try { $empty->delete(); throw new LogicException('Expected historical class restriction'); }
    catch (QueryException $exception) { ensure(str_contains($exception->getMessage(), 'FOREIGN KEY'), 'Historical attendance class cannot be deleted'); }
});

check('promotion preserves historical attendance and original-class corrections but forbids moving or backdating new rows', function () use ($controller, $teacher, $foreignTeacher, $leader, $class, $foreignClass) {
    $student = learner($class); record($controller, $teacher, payload($class, $student, 'late', '2026-09-01'));
    $term = DB::table('terms')->insertGetId(['name' => 'Configured period']);
    $request = requestFor($leader, ['term_id' => $term, 'to_class_id' => $foreignClass->id, 'effective_date' => '2026-09-15']);
    (new StudentController())->promote($request, $student, new AuditLogger($request));
    $saved = AttendanceStudent::where('student_id', $student->id)->first(); ensure($saved->class_id === $class->id && $student->fresh()->class_id === $foreignClass->id, 'Stored and current classes differ intentionally');
    ensure(record($controller, $teacher, payload($class, $student, 'present', '2026-09-01'))->getStatusCode() === 200, 'Original class snapshot correction');
    invalid(fn () => record($controller, $foreignTeacher, payload($foreignClass, $student, 'absent', '2026-09-01')), 'records.0.student_id');
    invalid(fn () => record($controller, $foreignTeacher, payload($foreignClass, $student, 'present', '2026-09-02')), 'records.0.student_id');
    ensure(record($controller, $foreignTeacher, payload($foreignClass, $student, 'present', '2026-09-15'))->getStatusCode() === 201, 'New current placement attendance');
    $oldRoster = roster($controller, $teacher, $class, '2026-09-01'); $historical = collect($oldRoster['learners'])->firstWhere('id', $student->id);
    ensure($historical['historical'] && $historical['status'] === 'present', 'Past class record survives promotion in roster');
});

check('admission/current active eligibility is checked; retained exited learners can be corrected', function () use ($controller, $teacher, $class) {
    $student = learner($class); $student->update(['admission_date' => '2026-10-01']);
    invalid(fn () => record($controller, $teacher, payload($class, $student, 'present', '2026-09-30')), 'records.0.student_id');
    record($controller, $teacher, payload($class, $student)); $student->update(['status' => 'left']);
    invalid(fn () => record($controller, $teacher, payload($class, $student, 'present', '2026-10-02')), 'records.0.student_id');
    ensure(record($controller, $teacher, payload($class, $student, 'absent'))->getStatusCode() === 200, 'Retained snapshot correction after exit');
});

check('teacher history and summaries scope stored classes, including student-only and unfiltered reads', function () use ($controller, $teacher, $class, $foreignClass, $foreignChild) {
    $data = $controller->index(requestFor($teacher, [], 'GET'))->getData(true);
    ensure(count($data['data']) > 0 && collect($data['data'])->every(fn ($row) => $row['class_id'] === $class->id), 'Unfiltered history scoped');
    ensure(!isset($data['data'][0]['recorded_by'], $data['data'][0]['student']['date_of_birth']), 'No private learner/actor data');
    forbidden(fn () => $controller->index(requestFor($teacher, ['class_id' => $foreignClass->id], 'GET')));
    forbidden(fn () => $controller->summary(requestFor($teacher, ['class_id' => $foreignClass->id, 'from' => '2026-01-01', 'to' => '2026-10-06'], 'GET')));
    $data = $controller->summary(requestFor($teacher, ['student_id' => $foreignChild->id, 'from' => '2026-01-01', 'to' => '2026-10-06'], 'GET'))->getData(true)['data'];
    ensure($data['total_records'] === 0 && $data['attendance_rate'] === null, 'Foreign student-only query cannot leak totals');
    invalid(fn () => $controller->index(requestFor($teacher, ['per_page' => 101], 'GET')), 'per_page');
    invalid(fn () => $controller->summary(requestFor($teacher, ['class_id' => $class->id, 'from' => '2026-10-01', 'to' => '2026-09-01'], 'GET')), 'to');
});

check('daily operational counts distinguish no record, partial recording, and retained historical rows', function () use ($controller, $teacher, $class) {
    $data = roster($controller, $teacher, $class, '2026-10-03');
    ensure($data['recorded_count'] === 0 && $data['unrecorded_count'] > 0 && $data['counts']['absent'] === 0 && $data['recording_state'] === 'not_recorded', 'Missing is not absent');
    $student = collect($data['learners'])->first();
    record($controller, $teacher, payload($class, Student::findOrFail($student['id']), 'late', '2026-10-03'));
    $data = roster($controller, $teacher, $class, '2026-10-03'); ensure($data['recorded_count'] === 1 && $data['counts']['late'] === 1, 'Real recorded totals');
    ensure($data['recording_state'] === ($data['unrecorded_count'] ? 'partially_recorded' : 'recorded'), 'No invented class submission state');
});

check('reassigned class teachers lose access while leadership retains historical oversight', function () use ($controller, $teacher, $foreignTeacher, $foreignStaff, $leader, $class, $child) {
    $original = $class->class_teacher_id; $class->update(['class_teacher_id' => $foreignStaff->id]);
    forbidden(fn () => record($controller, $teacher, payload($class, $child)));
    forbidden(fn () => $controller->index(requestFor($teacher, ['class_id' => $class->id], 'GET')));
    ensure(roster($controller, $foreignTeacher, $class)['class']['id'] === $class->id, 'Current owner reads inherited class history');
    ensure(roster($controller, $leader, $class)['class']['id'] === $class->id, 'Leadership oversight');
    $class->update(['class_teacher_id' => $original]);
});

check('attendance changes roll back if audit logging fails', function () use ($controller, $teacher, $class, $child) {
    $request = requestFor($teacher, payload($class, $child, 'absent', '2026-10-04'));
    $audit = new class($request) extends AuditLogger {
        public function log(string $action, ?string $entityType = null, ?int $entityId = null, array $details = []): App\Models\AuditLog { throw new RuntimeException('Memory-only audit failure'); }
    };
    try { $controller->store($request, $audit); throw new LogicException('Expected audit failure'); }
    catch (RuntimeException $exception) { ensure($exception->getMessage() === 'Memory-only audit failure', 'Expected simulated failure'); }
    ensure(AttendanceStudent::where('student_id', $child->id)->where('attendance_date', '2026-10-04')->count() === 0, 'No unaudited attendance write');
});

check('Parent Portal remains child-owned across promotion, with unchanged status/history shape', function () use ($controller, $leader, $class, $foreignClass) {
    $parent = actor('parent_guardian'); $own = learner($class); $other = learner($class);
    Guardian::create(['student_id' => $own->id, 'user_id' => $parent->id, 'full_name' => 'Test contact', 'relationship' => 'parent', 'phone' => 'memory-only']);
    record($controller, $leader, payload($class, $own, 'late', '2026-09-01'));
    record($controller, $leader, payload($class, $own, 'absent', '2026-09-02'));
    $own->update(['class_id' => $foreignClass->id]); $portal = new ParentPortalController(); $request = requestFor($parent, [], 'GET');
    $data = $portal->childAttendance($own, new AuditLogger($request))->getData(true)['data'];
    ensure($data['summary']['total'] === 2 && $data['summary']['late'] === 1 && (float) $data['summary']['attendance_percentage'] === 50.0, 'Own-child statuses/rate survive placement change');
    ensure(array_keys($data['recent'][0]) === ['date', 'status'], 'Minimal portal history shape');
    ensure($portal->childAttendance($other, new AuditLogger($request))->getStatusCode() === 403, 'Other child forbidden');
    Guardian::where('student_id', $own->id)->delete();
    ensure($portal->childAttendance($own, new AuditLogger($request))->getStatusCode() === 403, 'Unlink revokes attendance access');
});

check('current roster does not expose or reassign another class historical attendance', function () use ($controller, $leader, $teacher, $class, $foreignClass) {
    $student = learner($foreignClass); record($controller, $leader, payload($foreignClass, $student, 'excused', '2026-10-05'));
    $student->update(['class_id' => $class->id]);
    $data = roster($controller, $teacher, $class, '2026-10-05');
    $row = collect($data['learners'])->firstWhere('id', $student->id);
    ensure(!$row['editable'] && $row['status'] === null && $row['record_id'] === null && $data['blocked_count'] === 1, 'Foreign snapshot stays private/read-only');
    invalid(fn () => record($controller, $teacher, payload($class, $student, 'present', '2026-10-05')), 'records.0.student_id');
    ensure(AttendanceStudent::where('student_id', $student->id)->value('class_id') === $foreignClass->id, 'Historical class retained');
});

check('transfer-out retains recorded history and prohibits new attendance until active enrollment', function () use ($controller, $leader, $teacher, $class) {
    $student = learner($class); record($controller, $teacher, payload($class, $student, 'present', '2026-09-01'));
    $term = DB::table('terms')->insertGetId(['name' => 'Transfer period']);
    $request = requestFor($leader, ['type' => 'transfer_out', 'term_id' => $term, 'effective_date' => '2026-09-15']);
    (new StudentController())->transfer($request, $student, new AuditLogger($request));
    ensure($student->fresh()->status === 'transferred', 'Existing transfer flow');
    invalid(fn () => record($controller, $teacher, payload($class, $student, 'present', '2026-09-16')), 'records.0.student_id');
    ensure(record($controller, $teacher, payload($class, $student, 'late', '2026-09-01'))->getStatusCode() === 200, 'Snapshot remains correctable after transfer');
});

check('attendance route roles remain narrow and deny parent/sponsor staff APIs', function () {
    $middleware = new EnsureRole(); $next = fn () => response()->json(['data' => []]);
    foreach (['parent_guardian', 'sponsor'] as $role) ensure($middleware->handle(requestFor(actor($role)), $next, 'system_admin', 'head_teacher', 'deputy_head_teacher', 'teacher')->getStatusCode() === 403, 'Portal role denied');
});

Carbon::setTestNow();
echo $passed.' Attendance checks passed on in-memory SQLite only.'.PHP_EOL;
