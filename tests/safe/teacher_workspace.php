<?php

// Reuse the sole guarded SQLite :memory: bootstrap and real Sanctum HTTP helpers.
// No dotenv, development connection, persistent fixtures or migration command.
require __DIR__.'/authorization.php';

use App\Models\Role;
use Carbon\Carbon;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

$start = $passed;
Carbon::setTestNow(Carbon::parse('2026-10-11 12:00:00', 'Africa/Nairobi'));
Schema::table('academic_years', function (Blueprint $table) { $table->date('end_date')->nullable(); $table->boolean('is_current')->default(false); });
Schema::table('students', function (Blueprint $table) {
    $table->date('date_of_birth')->nullable(); $table->date('admission_date')->nullable(); $table->string('gender')->nullable();
});
Schema::table('guardians', function (Blueprint $table) {
    $table->string('full_name')->nullable(); $table->string('relationship')->nullable(); $table->string('phone')->nullable();
    $table->string('email')->nullable(); $table->boolean('is_primary_contact')->default(false);
});
Schema::create('student_medical_info', function (Blueprint $table) { $table->id(); $table->foreignId('student_id'); $table->text('conditions'); });
Schema::create('promotions_transfers', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id'); $table->string('type'); $table->date('effective_date'); $table->text('reason')->nullable();
    $table->foreignId('from_class_id')->nullable(); $table->foreignId('to_class_id')->nullable(); $table->foreignId('term_id')->nullable();
});
Schema::create('timetable_entries', function (Blueprint $table) {
    $table->id(); $table->foreignId('class_id'); $table->foreignId('subject_id'); $table->foreignId('staff_id');
    $table->integer('day_of_week'); $table->time('start_time'); $table->time('end_time');
});

function teacherCall(string $method, string $path, ?string $issued = null, array $payload = [], array $cookies = []): array {
    app('cache')->store('array')->flush();
    return callApi($method, $path, $issued, $payload, $cookies, $cookies ? ['HTTP_ORIGIN' => 'http://localhost'] : []);
}
function teacherData(string $path, string $issued): array {
    $response = teacherCall('GET', $path, $issued); status($response, 200); return $response['body']['data'];
}
function teachingClass(string $name, ?int $staff = null): int {
    static $sequence = 100;
    return DB::table('classes')->insertGetId(['name' => $name, 'level' => 'primary', 'sequence' => ++$sequence, 'class_teacher_id' => $staff]);
}
function teachingLearner(int $class, string $state = 'active'): int {
    static $number = 0;
    return DB::table('students')->insertGetId(['admission_no' => 'TWORK-'.++$number, 'first_name' => 'Memory',
        'last_name' => 'Learner '.$number, 'class_id' => $class, 'status' => $state, 'gender' => 'female',
        'date_of_birth' => '2017-01-01', 'admission_date' => '2026-01-01']);
}
function teachingAssignment(int $staff, int $class, int $subject, int $term): int {
    if (! DB::table('class_subjects')->where('class_id', $class)->where('subject_id', $subject)->exists()) {
        DB::table('class_subjects')->insert(['class_id' => $class, 'subject_id' => $subject]);
    }
    return DB::table('class_subject_teacher')->insertGetId(['staff_id' => $staff, 'class_id' => $class, 'subject_id' => $subject, 'term_id' => $term]);
}
function lesson(int $staff, int $class, int $subject, int $day = 1): int {
    return DB::table('timetable_entries')->insertGetId(['staff_id' => $staff, 'class_id' => $class, 'subject_id' => $subject,
        'day_of_week' => $day, 'start_time' => '09:00:00', 'end_time' => '09:40:00']);
}

$classTeacher = actor(Role::TEACHER); $classStaff = staff($classTeacher); $classToken = token($classTeacher);
$subjectTeacher = actor(Role::TEACHER); $subjectStaff = staff($subjectTeacher); $subjectToken = token($subjectTeacher);
$multiTeacher = actor(Role::TEACHER); $multiStaff = staff($multiTeacher); $multiToken = token($multiTeacher);
$otherTeacher = actor(Role::TEACHER); $otherStaff = staff($otherTeacher); $otherToken = token($otherTeacher);
$classA = teachingClass('Memory class A', $classStaff->id); $classB = teachingClass('Memory class B');
$classC = teachingClass('Memory class C'); $classD = teachingClass('Memory class D', $multiStaff->id);
$classE = teachingClass('Memory private class E', $otherStaff->id); $classF = teachingClass('Memory unassigned class F');
$learnerA = teachingLearner($classA); $learnerA2 = teachingLearner($classA); $learnerB = teachingLearner($classB);
$learnerC = teachingLearner($classC); $learnerD = teachingLearner($classD); $learnerE = teachingLearner($classE);
$learnerF = teachingLearner($classF); $exited = teachingLearner($classA, 'left');
$year = DB::table('academic_years')->insertGetId(['name' => 'Memory current year', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31', 'is_current' => true]);
$term = DB::table('terms')->insertGetId(['name' => 'Memory current term', 'academic_year_id' => $year,
    'start_date' => '2026-10-01', 'end_date' => '2026-12-01', 'is_current' => true]);
$oldTerm = DB::table('terms')->insertGetId(['name' => 'Memory old term', 'academic_year_id' => $year,
    'start_date' => '2026-01-01', 'end_date' => '2026-03-01', 'is_current' => true]);
$subject = DB::table('subjects')->insertGetId(['name' => 'Memory subject', 'code' => 'TW1', 'status' => 'active']);
$secondSubject = DB::table('subjects')->insertGetId(['name' => 'Memory second subject', 'code' => 'TW2', 'status' => 'active']);
teachingAssignment($subjectStaff->id, $classB, $subject, $term);
teachingAssignment($subjectStaff->id, $classC, $subject, $term);
teachingAssignment($subjectStaff->id, $classB, $secondSubject, $term);
teachingAssignment($multiStaff->id, $classB, $subject, $term);
teachingAssignment($multiStaff->id, $classD, $subject, $term);
teachingAssignment($otherStaff->id, $classE, $subject, $term);
teachingAssignment($subjectStaff->id, $classF, $subject, $oldTerm);
$ownLesson = lesson($subjectStaff->id, $classB, $subject, 2);
$secondLesson = lesson($subjectStaff->id, $classC, $subject, 1);
$foreignLesson = lesson($otherStaff->id, $classE, $subject);
$unassignedLesson = lesson($subjectStaff->id, $classE, $subject);
$oldLesson = lesson($subjectStaff->id, $classF, $subject);
$classOnlyLesson = lesson($classStaff->id, $classA, $subject);
DB::table('student_medical_info')->insert(['student_id' => $learnerA, 'conditions' => 'confidential-medical-sentinel']);
DB::table('guardians')->insert(['student_id' => $learnerA, 'full_name' => 'private-guardian-sentinel', 'phone' => 'private-contact-sentinel']);
DB::table('promotions_transfers')->insert(['student_id' => $learnerA, 'type' => 'promotion', 'effective_date' => '2026-01-01',
    'reason' => 'confidential-history-reason', 'from_class_id' => $classF, 'to_class_id' => $classA, 'term_id' => $term]);

check('Teacher read endpoints require Sanctum and reject all seven other roles', function () {
    foreach (['teacher/context', 'teacher/timetable'] as $path) {
        status(teacherCall('GET', $path), 401);
        foreach ([Role::SYSTEM_ADMIN, Role::HEAD_TEACHER, Role::DEPUTY_HEAD_TEACHER, Role::SPONSOR_COORDINATOR,
            Role::PARENT_GUARDIAN, Role::SPONSOR, Role::STUDENT] as $role) {
            $user = actor($role); if (in_array($role, Role::STAFF_ROLES, true)) staff($user);
            status(teacherCall('GET', $path, token($user)), 403, 'FORBIDDEN');
        }
    }
});
check('Class Teacher ownership grants only assigned active learner access and no subject timetable', function () use ($classToken, $classA, $learnerA, $learnerA2) {
    $context = teacherData('teacher/context', $classToken);
    ensure(array_column($context['class_teacher_classes'], 'id') === [$classA] && $context['subject_assignments'] === [], 'Class ownership context');
    ensure(array_column(teacherData('students', $classToken), 'id') === [$learnerA, $learnerA2], 'Class learner scope');
    ensure(teacherData('teacher/timetable', $classToken) === [], 'Class ownership inferred subject teaching');
});
check('Subject Teacher assignments grant current class learners without Attendance ownership', function () use ($subjectToken, $classB, $classC, $learnerB, $learnerC) {
    $context = teacherData('teacher/context', $subjectToken);
    ensure($context['class_teacher_classes'] === [] && count($context['subject_assignments']) === 3, 'Subject context');
    ensure(array_column($context['learner_classes'], 'id') === [$classB, $classC], 'Subject class deduplication');
    ensure(array_column(teacherData('students', $subjectToken), 'id') === [$learnerB, $learnerC], 'Subject learner scope');
    ensure(teacherData('attendance/my-classes', $subjectToken) === [], 'Subject assignments granted Attendance ownership');
});
check('combined and multiple subject assignments deduplicate learners and preserve separate responsibilities', function () use ($multiToken, $classD, $learnerB, $learnerD) {
    $context = teacherData('teacher/context', $multiToken);
    ensure(array_column($context['class_teacher_classes'], 'id') === [$classD] && count($context['subject_assignments']) === 2, 'Combined context');
    ensure(array_column(teacherData('students', $multiToken), 'id') === [$learnerB, $learnerD], 'Duplicate or foreign learner');
});
check('search pagination and authorized class filtering expose only scoped totals', function () use ($classToken, $subjectToken, $learnerA, $classB, $learnerB) {
    $page = teacherCall('GET', 'students?per_page=1&page=1', $classToken); status($page, 200);
    ensure(count($page['body']['data']) === 1 && $page['body']['meta'] === ['page' => 1, 'per_page' => 1, 'total' => 2], 'Scoped pagination');
    $other = teacherCall('GET', 'students?per_page=1&page=2', $classToken); status($other, 200);
    ensure($other['body']['data'][0]['id'] !== $learnerA, 'Pagination did not advance');
    ensure(array_column(teacherData('students?class_id='.$classB, $subjectToken), 'id') === [$learnerB], 'Class filter');
    ensure(teacherData('students?search=TWORK-1', $classToken)[0]['id'] === $learnerA, 'Admission search');
    ensure(teacherData('students?search=TWORK-7', $classToken) === [], 'Foreign learner search leakage');
});
check('unknown and unauthorized class filters use identical scoped missing responses', function () use ($classToken, $classE) {
    $foreign = teacherCall('GET', 'students?class_id='.$classE, $classToken); status($foreign, 404);
    $missing = teacherCall('GET', 'students?class_id=999999', $classToken); status($missing, 404);
    ensure($foreign['body'] === $missing['body'], 'Class existence leaked');
    foreach (['per_page=101', 'page=0', 'class_id=-1', 'search='.str_repeat('x', 151)] as $query) status(teacherCall('GET', 'students?'.$query, $classToken), 422);
});
check('Teacher generic detail and history reject cross-teacher and missing IDs uniformly', function () use ($classToken, $learnerA, $learnerE, $exited) {
    status(teacherCall('GET', 'students/'.$learnerA, $classToken), 200);
    foreach (['', '/academic-history'] as $suffix) {
        $foreign = teacherCall('GET', 'students/'.$learnerE.$suffix, $classToken); status($foreign, 404);
        $missing = teacherCall('GET', 'students/999999'.$suffix, $classToken); status($missing, 404);
        ensure($foreign['body'] === $missing['body'], 'Learner existence leaked');
        status(teacherCall('GET', 'students/'.$exited.$suffix, $classToken), 404);
    }
});
check('client Teacher Staff class or role claims never grant other assignments or timetable rows', function () use ($subjectToken, $otherStaff, $classE, $ownLesson, $secondLesson) {
    $rows = teacherData('teacher/timetable?staff_id='.$otherStaff->id.'&class_id='.$classE.'&role=system_admin', $subjectToken);
    ensure(array_column($rows, 'id') === [$secondLesson, $ownLesson], 'Forged identity changed timetable');
    $context = teacherData('teacher/context?staff_id='.$otherStaff->id.'&teacher_id=1&assigned_class_id='.$classE, $subjectToken);
    ensure(! in_array($classE, array_column($context['learner_classes'], 'id')), 'Forged identity changed scope');
});
check('timetable requires matching current subject offering and assignment and returns only educational fields', function () use ($subjectToken, $ownLesson, $secondLesson) {
    $rows = teacherData('teacher/timetable', $subjectToken);
    ensure(array_column($rows, 'id') === [$secondLesson, $ownLesson], 'Foreign, expired or unassigned lesson exposed');
    ensure(array_keys($rows[0]) === ['id', 'day_of_week', 'start_time', 'end_time', 'school_class', 'subject', 'current_periods'], 'Timetable minimization');
    ensure($rows[0]['current_periods'][0]['name'] === 'Memory current term' && $rows[0]['current_periods'][0]['academic_year']['name'] === 'Memory current year', 'Current context missing');
});
check('missing current term hides subject assignments timetable and subject-only learners but preserves current class ownership', function () use ($term, $subjectToken, $classToken, $classA) {
    DB::table('terms')->where('id', $term)->update(['is_current' => false]);
    ensure(teacherData('students', $subjectToken) === [] && teacherData('teacher/timetable', $subjectToken) === [], 'Missing term scope');
    ensure(teacherData('teacher/context', $subjectToken)['current_periods'] === [], 'Missing term fabricated');
    ensure(array_column(teacherData('teacher/context', $classToken)['class_teacher_classes'], 'id') === [$classA], 'Current class ownership lost');
    DB::table('terms')->where('id', $term)->update(['is_current' => true]);
});
check('expired future or noncurrent academic periods fail closed for subject reads', function () use ($term, $year, $subjectToken) {
    foreach ([['end_date' => '2026-10-10'], ['start_date' => '2026-10-12']] as $change) {
        DB::table('terms')->where('id', $term)->update($change);
        ensure(teacherData('students', $subjectToken) === [] && teacherData('teacher/timetable', $subjectToken) === [], 'Out-of-date term scope');
        DB::table('terms')->where('id', $term)->update(['start_date' => '2026-10-01', 'end_date' => '2026-12-01']);
    }
    foreach ([['is_current' => false], ['end_date' => '2026-10-10'], ['start_date' => '2026-10-12']] as $change) {
        DB::table('academic_years')->where('id', $year)->update($change);
        ensure(teacherData('students', $subjectToken) === [], 'Ineligible year scope');
        DB::table('academic_years')->where('id', $year)->update(['start_date' => '2026-01-01', 'end_date' => '2026-12-31', 'is_current' => true]);
    }
    DB::table('terms')->where('id', $term)->update(['end_date' => '2027-01-01']);
    ensure(teacherData('students', $subjectToken) === [], 'Term outside its year remained eligible');
    DB::table('terms')->where('id', $term)->update(['end_date' => '2026-12-01']);
});
check('inactive subjects and removed offerings immediately remove applicable scope', function () use ($subject, $secondSubject, $classC, $subjectToken) {
    DB::table('subjects')->whereIn('id', [$subject, $secondSubject])->update(['status' => 'inactive']);
    ensure(teacherData('students', $subjectToken) === [] && teacherData('teacher/timetable', $subjectToken) === [], 'Inactive subject scope');
    DB::table('subjects')->whereIn('id', [$subject, $secondSubject])->update(['status' => 'active']);
    DB::table('class_subjects')->where('class_id', $classC)->where('subject_id', $subject)->delete();
    ensure(count(teacherData('students', $subjectToken)) === 1 && count(teacherData('teacher/timetable', $subjectToken)) === 1, 'Missing offering scope');
    DB::table('class_subjects')->insert(['class_id' => $classC, 'subject_id' => $subject]);
});
check('assignment removal reassignment and learner transfer revoke old scope on the next request', function () use ($subjectStaff, $otherStaff, $classC, $subjectToken, $classToken, $learnerA, $classA, $classE) {
    DB::table('class_subject_teacher')->where('class_id', $classC)->where('staff_id', $subjectStaff->id)->update(['staff_id' => $otherStaff->id]);
    ensure(count(teacherData('students', $subjectToken)) === 1, 'Reassigned subject retained scope');
    DB::table('class_subject_teacher')->where('class_id', $classC)->where('staff_id', $otherStaff->id)->update(['staff_id' => $subjectStaff->id]);
    DB::table('students')->where('id', $learnerA)->update(['class_id' => $classE]);
    status(teacherCall('GET', 'students/'.$learnerA, $classToken), 404);
    DB::table('students')->where('id', $learnerA)->update(['class_id' => $classA]);
});
check('Teacher class references cannot enumerate school-wide learner counts or Staff HR', function () use ($subjectToken, $classB, $classC) {
    $classes = teacherData('classes', $subjectToken);
    ensure(array_column($classes, 'id') === [$classB, $classC], 'Generic class enumeration');
    ensure(array_keys($classes[0]) === ['id', 'name', 'level'], 'Class reference exposed counts or Staff');
    foreach (['staff', 'teacher-assignments', 'timetable/by-class?class_id='.$classB, 'timetable/by-teacher?staff_id=1',
        'reports/school-statistics', 'reports/students/export', 'sponsorships'] as $path) status(teacherCall('GET', $path, $subjectToken), 403, 'FORBIDDEN');
});
check('Teacher detail history context and timetable expose no private contacts medical content or mutation capability', function () use ($classToken, $subjectToken, $learnerA) {
    $detail = teacherData('students/'.$learnerA, $classToken);
    ensure(array_keys($detail) === ['id', 'admission_no', 'first_name', 'last_name', 'class_id', 'status', 'school_class'], 'Teacher detail minimization');
    $history = teacherData('students/'.$learnerA.'/academic-history', $classToken);
    ensure(count($history['promotions_transfers']) === 1 && ! isset($history['promotions_transfers'][0]['reason']), 'History reason exposure');
    $json = json_encode([$detail, $history, teacherData('teacher/context', $classToken), teacherData('teacher/timetable', $subjectToken)]);
    foreach (['confidential-medical-sentinel', 'private-guardian-sentinel', 'private-contact-sentinel', 'confidential-history-reason',
        'password_hash', 'staff_id', 'date_of_birth', 'guardians', 'medical_info'] as $sentinel) ensure(! str_contains($json, $sentinel), 'Private data exposed');
    foreach (['students/'.$learnerA, 'timetable'] as $path) status(teacherCall('POST', $path === 'timetable' ? $path : 'students', $classToken, ['first_name' => 'Forgery']), 403);
    status(teacherCall('PATCH', 'students/'.$learnerA, $classToken, ['first_name' => 'Forgery']), 403);
});
check('inactive locked non-teaching missing and unlinked employment fail closed on every Teacher read surface', function () use ($classTeacher, $classStaff, $classToken, $learnerA) {
    $paths = ['teacher/context', 'teacher/timetable', 'students', 'students/'.$learnerA, 'students/'.$learnerA.'/academic-history', 'classes'];
    foreach (['inactive', 'locked'] as $state) {
        DB::table('users')->where('id', $classTeacher->id)->update(['status' => $state]);
        foreach ($paths as $path) status(teacherCall('GET', $path, $classToken), 403, 'ACCOUNT_INACTIVE');
    }
    DB::table('users')->where('id', $classTeacher->id)->update(['status' => 'active']);
    foreach (['inactive', 'on_leave', 'terminated'] as $state) {
        $classStaff->update(['status' => $state]);
        foreach ($paths as $path) status(teacherCall('GET', $path, $classToken), 403, 'FORBIDDEN');
    }
    $classStaff->update(['status' => 'active', 'staff_type' => 'non_teaching']);
    foreach ($paths as $path) status(teacherCall('GET', $path, $classToken), 403, 'FORBIDDEN');
    $classStaff->update(['staff_type' => 'teaching', 'user_id' => null]);
    foreach ($paths as $path) status(teacherCall('GET', $path, $classToken), 403, 'FORBIDDEN');
    $classStaff->update(['user_id' => $classTeacher->id]);
    $missingToken = token(actor(Role::TEACHER));
    foreach ($paths as $path) status(teacherCall('GET', $path, $missingToken), 403, 'FORBIDDEN');
});
check('eligible Teacher without assignments receives real empty context learners and timetable', function () {
    $user = actor(Role::TEACHER); staff($user); $issued = token($user);
    $context = teacherData('teacher/context', $issued);
    ensure($context['class_teacher_classes'] === [] && $context['subject_assignments'] === [] && $context['learner_classes'] === [], 'Invented assignments');
    ensure(teacherData('students', $issued) === [] && teacherData('teacher/timetable', $issued) === [], 'Invented learners or timetable');
});
check('Sanctum cookie Teacher reads obey current ownership and employment scope', function () use ($classTeacher, $classStaff, $classA, $learnerA, $otherStaff) {
    $cookie = sessionCookie($classTeacher);
    status(teacherCall('GET', 'teacher/context', null, [], $cookie), 200);
    status(teacherCall('GET', 'students/'.$learnerA, null, [], $cookie), 200);
    DB::table('classes')->where('id', $classA)->update(['class_teacher_id' => $otherStaff->id]);
    status(teacherCall('GET', 'students/'.$learnerA, null, [], $cookie), 404);
    DB::table('classes')->where('id', $classA)->update(['class_teacher_id' => $classStaff->id]);
    $classStaff->update(['status' => 'inactive']);
    status(teacherCall('GET', 'teacher/context', null, [], $cookie), 403, 'FORBIDDEN');
    $classStaff->update(['status' => 'active']);
});
check('leadership still reads full learner scope and existing Guardian contacts', function () use ($learnerA, $learnerE) {
    foreach ([Role::SYSTEM_ADMIN, Role::HEAD_TEACHER, Role::DEPUTY_HEAD_TEACHER] as $role) {
        $user = actor($role); if ($role !== Role::SYSTEM_ADMIN) staff($user); $issued = token($user);
        $list = teacherData('students?per_page=100', $issued);
        ensure(in_array($learnerA, array_column($list, 'id')) && in_array($learnerE, array_column($list, 'id')), 'Leadership scope narrowed');
        ensure(teacherData('students/'.$learnerA, $issued)['guardians'][0]['phone'] === 'private-contact-sentinel', 'Leadership contact workflow changed');
    }
});
check('Student Parent and Sponsor cannot enumerate generic learners operations or the Teacher workspace', function () use ($learnerA) {
    foreach ([Role::STUDENT, Role::PARENT_GUARDIAN, Role::SPONSOR] as $role) {
        $issued = token(actor($role));
        foreach (['students', 'students/'.$learnerA, 'students/'.$learnerA.'/academic-history', 'teacher/context', 'teacher/timetable',
            'reports/school-statistics', 'attendance/my-classes', 'assessments/context', 'sponsorships'] as $path) status(teacherCall('GET', $path, $issued), 403, 'FORBIDDEN');
        if ($role === Role::STUDENT) {
            $classes = teacherData('classes', $issued);
            ensure(array_keys($classes[0]) === ['id', 'name', 'level'], 'Student class reference leaked statistics or Staff');
        }
    }
});
check('Class Teacher-only ownership still supplies no Assessment assignment and subject-only ownership no Attendance', function () use ($classToken, $subjectToken) {
    ensure(teacherData('assessments/context', $classToken)['assignments'] === [], 'Class ownership granted Assessment');
    ensure(teacherData('attendance/my-classes', $subjectToken) === [], 'Subject assignment granted Attendance');
});

echo 'Teacher Workspace checks passed: '.($passed - $start).PHP_EOL;
