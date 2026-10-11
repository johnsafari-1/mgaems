<?php

// Guarded SQLite RAM/Sanctum bootstrap, also exercising Teacher Workspace regressions.
require __DIR__.'/teacher_workspace.php';

use App\Models\Guardian;
use App\Models\ReportCard;
use App\Models\ReportCardRevision;
use App\Models\Role;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

$parentStart = $passed;
Schema::create('attendance_students', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id'); $table->foreignId('class_id')->nullable();
    $table->date('attendance_date'); $table->string('status');
});
Schema::create('assessments', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id'); $table->foreignId('subject_id'); $table->foreignId('term_id');
    $table->string('assessment_type'); $table->decimal('score')->nullable(); $table->string('competency_rating')->nullable();
    $table->text('remarks')->nullable(); $table->timestamp('recorded_at');
});
Schema::create('report_cards', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id'); $table->foreignId('term_id'); $table->text('overall_remark')->nullable();
    $table->string('file_path')->nullable(); $table->timestamp('generated_at')->nullable(); $table->foreignId('generated_by')->nullable();
    $table->integer('revision_number')->default(0);
});
Schema::create('report_card_revisions', function (Blueprint $table) {
    $table->id(); $table->foreignId('report_card_id'); $table->integer('revision_number');
    $table->timestamp('generated_at')->nullable(); $table->foreignId('generated_by')->nullable();
    $table->string('artifact_path')->nullable(); $table->string('artifact_sha256')->nullable(); $table->integer('artifact_size')->nullable();
    $table->json('input_snapshot')->nullable(); $table->json('source_manifest')->nullable();
    $table->string('provenance'); $table->string('template_version')->nullable(); $table->timestamp('created_at');
});
Schema::create('announcements', function (Blueprint $table) {
    $table->id(); $table->foreignId('published_by'); $table->string('title'); $table->text('body');
    $table->string('audience'); $table->timestamp('published_at')->useCurrent();
});
Schema::table('messages', function (Blueprint $table) { $table->text('body')->nullable(); $table->timestamp('read_at')->nullable(); });

class FamilyMemoryDisk
{
    public array $files = [];
    public function exists($path): bool { return isset($this->files[$path]); }
    public function get($path): string { return $this->files[$path]; }
    public function download($path, $name) { return response($this->files[$path], 200, ['Content-Type' => 'application/pdf']); }
}
$familyDisk = new FamilyMemoryDisk();
Storage::swap(new class($familyDisk) { public function __construct(private $memory) {} public function disk($name) { return $this->memory; } });
$familyParent = actor(Role::PARENT_GUARDIAN); $familyToken = token($familyParent);
$familyOther = actor(Role::PARENT_GUARDIAN); $familyOtherToken = token($familyOther);
$familyOneParent = actor(Role::PARENT_GUARDIAN); $familyOneToken = token($familyOneParent);
$familyEmptyToken = token(actor(Role::PARENT_GUARDIAN));
$familyClass = teachingClass('Family current class');
$familyA = teachingLearner($familyClass); $familyB = teachingLearner($familyClass); $familyForeign = teachingLearner($familyClass);
foreach ([$familyA, $familyB, $familyA] as $id) Guardian::create(['student_id' => $id, 'user_id' => $familyParent->id, 'full_name' => 'private-family-contact', 'phone' => 'private-phone']);
Guardian::create(['student_id' => $familyForeign, 'user_id' => $familyOther->id]);
Guardian::create(['student_id' => $familyA, 'user_id' => $familyOneParent->id]);
DB::table('student_medical_info')->insert(['student_id' => $familyA, 'conditions' => 'private-family-medical']);
DB::table('attendance_students')->insert([
    ['student_id' => $familyA, 'class_id' => $classA, 'attendance_date' => '2026-09-01', 'status' => 'present'],
    ['student_id' => $familyA, 'class_id' => $familyClass, 'attendance_date' => '2026-10-01', 'status' => 'absent'],
    ['student_id' => $familyForeign, 'class_id' => $familyClass, 'attendance_date' => '2026-10-02', 'status' => 'late'],
]);
teachingAssignment($subjectStaff->id, $familyClass, $subject, $term);
$familyLesson = lesson($subjectStaff->id, $familyClass, $subject);
DB::table('assessments')->insert(['student_id' => $familyA, 'subject_id' => $subject, 'term_id' => $term,
    'assessment_type' => 'continuous', 'score' => 99, 'remarks' => 'private-unpublished-correction', 'recorded_at' => '2026-10-11']);
$familySnapshot = ['term' => ['name' => 'Published term', 'academic_year' => 'Published year'], 'overall_remark' => 'Published overall remark',
    'subject_rows' => [[
        'continuous' => ['subject' => 'Published subject', 'score' => 0, 'performance_level' => 'Published level', 'remarks' => 'Published remark', 'context_snapshot' => ['staff_id' => 999]],
        'end_term' => ['subject' => 'Published subject', 'score' => 42, 'performance_level' => null, 'remarks' => null],
    ]]];
$familyCard = ReportCard::create(['student_id' => $familyA, 'term_id' => $term, 'generated_at' => '2026-10-01',
    'file_path' => 'private-projection-path.pdf', 'overall_remark' => 'private-mutable-remark', 'revision_number' => 1]);
$familyDisk->files['private-retained-path.pdf'] = '%PDF-family-memory';
ReportCardRevision::create(['report_card_id' => $familyCard->id, 'revision_number' => 1, 'generated_at' => '2026-10-01',
    'artifact_path' => 'private-retained-path.pdf', 'artifact_sha256' => hash('sha256', $familyDisk->files['private-retained-path.pdf']),
    'input_snapshot' => $familySnapshot, 'source_manifest' => [['staff_id' => 999, 'private-history' => true]],
    'generated_by' => $otherTeacher->id, 'provenance' => 'captured', 'created_at' => '2026-10-01']);
$familyForeignCard = ReportCard::create(['student_id' => $familyForeign, 'term_id' => $term, 'generated_at' => '2026-10-01', 'file_path' => 'foreign.pdf']);
$familyBCard = ReportCard::create(['student_id' => $familyB, 'term_id' => $term, 'generated_at' => '2026-10-01', 'file_path' => 'legacy.pdf']);
$familyDisk->files['legacy.pdf'] = '%PDF-legacy-memory';
ReportCard::create(['student_id' => $familyA, 'term_id' => $oldTerm, 'file_path' => 'draft.pdf', 'overall_remark' => 'private-unreleased-draft']);
$familyDisk->files['draft.pdf'] = '%PDF-draft-memory';

function familyCall(string $method, string $path, ?string $issued = null, array $payload = [], array $cookies = []): array {
    app('cache')->store('array')->flush(); return callApi($method, $path, $issued, $payload, $cookies, $cookies ? ['HTTP_ORIGIN' => 'http://localhost'] : []);
}
function familyData(string $path, string $issued): array {
    $response = familyCall('GET', 'portal/parent/'.$path, $issued); status($response, 200);
    ensure(str_contains($response['response']->headers->get('Cache-Control'), 'no-store'), 'Family response may be cached');
    return $response['body']['data'];
}

check('single multiple duplicate and empty Guardian associations return only actual linked children', function () use ($familyToken, $familyOneToken, $familyEmptyToken, $familyA, $familyB) {
    $actual = array_column(familyData('children', $familyToken), 'id'); sort($actual);
    ensure($actual === [$familyA, $familyB], 'Family child deduplication/ownership');
    ensure(array_column(familyData('children', $familyOneToken), 'id') === [$familyA], 'Single child');
    ensure(familyData('children', $familyEmptyToken) === [], 'Empty family saw learners');
});
check('every family route requires authentication active Parent role and current Guardian ownership', function () use ($familyToken, $familyA, $familyForeign) {
    foreach (['', '/attendance', '/progress', '/report-cards', '/timetable'] as $suffix) {
        status(familyCall('GET', 'portal/parent/children/'.$familyA.$suffix), 401);
        $foreign = familyCall('GET', 'portal/parent/children/'.$familyForeign.$suffix.'?guardian_id=1&user_id=1&owns_child=true', $familyToken); status($foreign, 403, 'FORBIDDEN');
        $missing = familyCall('GET', 'portal/parent/children/999999'.$suffix, $familyToken); status($missing, 403, 'FORBIDDEN');
        ensure($foreign['body'] === $missing['body'], 'Foreign/missing child existence leaked');
        status(familyCall('GET', 'portal/parent/children/-1'.$suffix, $familyToken), 403);
    }
});
check('overview allowlist contains educational context without family contacts medical or internal metadata', function () use ($familyToken, $familyA) {
    $data = familyData('children/'.$familyA, $familyToken);
    ensure(array_keys($data) === ['id', 'admission_no', 'first_name', 'last_name', 'status', 'class', 'current_periods'], 'Overview fields');
    ensure(count($data['current_periods']) === 1 && $data['class']['name'] === 'Family current class', 'Current academic context');
    foreach (['date_of_birth', 'guardians', 'private-phone', 'private-family-medical', 'staff_id', 'sponsorship', 'password_hash'] as $private) ensure(! str_contains(json_encode($data), $private), 'Private overview exposure');
    $references = familyCall('GET', 'classes', $familyToken); status($references, 200);
    ensure(count($references['body']['data']) === 1 && array_keys($references['body']['data'][0]) === ['id', 'name', 'level'], 'Generic class reference leaked unrelated counts or Staff');
});
check('attendance is child-specific preserves historical class and no-record is distinct from absent', function () use ($familyToken, $familyA, $familyB) {
    $data = familyData('children/'.$familyA.'/attendance', $familyToken);
    ensure($data['summary']['total'] === 2 && $data['summary']['present'] === 1 && $data['summary']['absent'] === 1 && $data['summary']['late'] === 0, 'Attendance mixed children');
    ensure($data['records'][1]['class']['name'] === 'Memory class A', 'Historical class was inferred from current placement');
    $empty = familyData('children/'.$familyB.'/attendance', $familyToken);
    ensure($empty['summary']['total'] === 0 && $empty['summary']['attendance_percentage'] === null && $empty['records'] === [], 'Missing record invented an absence');
});
check('attendance filters pagination and validation retain exact recorded dates and totals', function () use ($familyToken, $familyA) {
    $response = familyCall('GET', 'portal/parent/children/'.$familyA.'/attendance?per_page=1&page=2', $familyToken); status($response, 200);
    ensure($response['body']['meta']['total'] === 2 && $response['body']['data']['records'][0]['date'] === '2026-09-01', 'Attendance pagination');
    ensure(familyData('children/'.$familyA.'/attendance?from=2026-10-01&to=2026-10-02', $familyToken)['summary']['total'] === 1, 'Date filter');
    foreach (['per_page=101', 'from=2026-02-30', 'from=2026-10-10&to=2026-10-01', 'page=0'] as $query) status(familyCall('GET', 'portal/parent/children/'.$familyA.'/attendance?'.$query, $familyToken), 422);
});
check('progress uses only existing report snapshots with separate types and never current assessment corrections', function () use ($familyToken, $familyA, $familyB) {
    $rows = familyData('children/'.$familyA.'/progress', $familyToken);
    ensure(array_column($rows, 'assessment_type') === ['continuous', 'end_term'] && (float) $rows[0]['score'] === 0.0 && (float) $rows[1]['score'] === 42.0, 'Published values or types changed');
    $json = json_encode($rows);
    foreach (['private-unpublished-correction', 'private-unreleased-draft', 'source_manifest', 'context_snapshot', 'staff_id', 'revision_number', 'private-retained-path'] as $private) ensure(! str_contains($json, $private), 'Private progress exposure');
    ensure(familyData('children/'.$familyB.'/progress', $familyToken) === [], 'Legacy PDF reconstructed live results');
});
check('available cards use immutable published metadata omit drafts and preserve existing legacy PDF access', function () use ($familyToken, $familyA, $familyB, $familyCard) {
    $cards = familyData('children/'.$familyA.'/report-cards', $familyToken);
    ensure(count($cards) === 1 && $cards[0]['id'] === $familyCard->id && $cards[0]['overall_remark'] === 'Published overall remark' && $cards[0]['term']['name'] === 'Published term', 'Draft or mutable projection leaked');
    ensure($cards[0]['download_available'] === true && familyData('children/'.$familyB.'/report-cards', $familyToken)[0]['download_available'] === true, 'Existing artifacts unavailable');
    foreach (['file_path', 'input_snapshot', 'source_manifest', 'generated_by', 'artifact_path'] as $field) ensure(! str_contains(json_encode($cards), $field), 'Internal report field');
});
check('direct report downloads enforce Guardian ownership and nested report ownership even between two linked children', function () use ($familyToken, $familyA, $familyB, $familyForeign, $familyCard, $familyForeignCard, $familyBCard) {
    status(familyCall('GET', 'portal/parent/children/'.$familyA.'/report-cards/'.$familyCard->id.'/download', $familyToken), 200);
    status(familyCall('GET', 'portal/parent/children/'.$familyB.'/report-cards/'.$familyBCard->id.'/download', $familyToken), 200);
    foreach ([[$familyA, $familyBCard->id], [$familyA, $familyForeignCard->id], [$familyForeign, $familyCard->id], [$familyA, 999999]] as [$child, $card]) status(familyCall('GET', 'portal/parent/children/'.$child.'/report-cards/'.$card.'/download', $familyToken), 403, 'FORBIDDEN');
});
check('missing and corrupt report artifacts fail closed without disclosing paths or reconstructing progress', function () use ($familyDisk, $familyToken, $familyA, $familyCard) {
    $bytes = $familyDisk->files['private-retained-path.pdf'];
    $familyDisk->files['private-retained-path.pdf'] = 'corrupt';
    ensure(familyData('children/'.$familyA.'/progress', $familyToken) === [] && ! familyData('children/'.$familyA.'/report-cards', $familyToken)[0]['download_available'], 'Corrupt artifact considered available');
    status(familyCall('GET', 'portal/parent/children/'.$familyA.'/report-cards/'.$familyCard->id.'/download', $familyToken), 409);
    unset($familyDisk->files['private-retained-path.pdf']);
    status(familyCall('GET', 'portal/parent/children/'.$familyA.'/report-cards/'.$familyCard->id.'/download', $familyToken), 404);
    $familyDisk->files['private-retained-path.pdf'] = $bytes;
    DB::table('report_card_revisions')->where('report_card_id', $familyCard->id)->update(['artifact_sha256' => null]);
    ensure(familyData('children/'.$familyA.'/progress', $familyToken) === [] && familyData('children/'.$familyA.'/report-cards', $familyToken) === [], 'Unverified captured publication disclosed');
    DB::table('report_card_revisions')->where('report_card_id', $familyCard->id)->update(['artifact_sha256' => hash('sha256', $bytes)]);
});
check('current timetable uses only the owned current class with eligible lessons and no Staff HR', function () use ($familyToken, $familyA, $familyLesson, $otherStaff) {
    $data = familyData('children/'.$familyA.'/timetable?class_id=1&staff_id='.$otherStaff->id, $familyToken);
    ensure(array_column($data, 'id') === [$familyLesson], 'Foreign or forged class timetable');
    ensure(array_keys($data[0]) === ['id', 'day_of_week', 'start_time', 'end_time', 'subject'], 'Timetable Staff or historical data leak');
});
check('missing academic context inactive staff subjects offerings and exited learners make timetable unavailable', function () use ($familyToken, $familyA, $term, $subjectStaff, $subject, $familyClass) {
    DB::table('terms')->where('id', $term)->update(['is_current' => false]);
    ensure(familyData('children/'.$familyA.'/timetable', $familyToken) === [], 'Missing term fabricated timetable');
    DB::table('terms')->where('id', $term)->update(['is_current' => true]);
    $subjectStaff->update(['status' => 'inactive']); ensure(familyData('children/'.$familyA.'/timetable', $familyToken) === [], 'Inactive Staff lesson'); $subjectStaff->update(['status' => 'active']);
    DB::table('subjects')->where('id', $subject)->update(['status' => 'inactive']); ensure(familyData('children/'.$familyA.'/timetable', $familyToken) === [], 'Inactive subject lesson'); DB::table('subjects')->where('id', $subject)->update(['status' => 'active']);
    DB::table('class_subjects')->where('class_id', $familyClass)->where('subject_id', $subject)->delete(); ensure(familyData('children/'.$familyA.'/timetable', $familyToken) === [], 'Missing offering lesson'); DB::table('class_subjects')->insert(['class_id' => $familyClass, 'subject_id' => $subject]);
    DB::table('students')->where('id', $familyA)->update(['status' => 'left']); ensure(familyData('children/'.$familyA.'/timetable', $familyToken) === [], 'Former enrollment treated as current'); DB::table('students')->where('id', $familyA)->update(['status' => 'active']);
});
check('unlinking current Guardian rows immediately removes every learner read and download without deleting history', function () use ($familyToken, $familyParent, $familyA, $familyB, $familyCard, $familyOneToken) {
    $links = DB::table('guardians')->where('user_id', $familyParent->id)->where('student_id', $familyA)->get()->map(fn ($row) => (array) $row)->all();
    DB::table('guardians')->where('user_id', $familyParent->id)->where('student_id', $familyA)->delete();
    ensure(array_column(familyData('children', $familyToken), 'id') === [$familyB], 'Removed link still listed');
    foreach (['', '/attendance', '/progress', '/report-cards', '/timetable', '/report-cards/'.$familyCard->id.'/download'] as $suffix) status(familyCall('GET', 'portal/parent/children/'.$familyA.$suffix, $familyToken), 403);
    status(familyCall('GET', 'portal/parent/children/'.$familyA, $familyOneToken), 200);
    ensure(DB::table('attendance_students')->where('student_id', $familyA)->count() === 2 && ReportCard::find($familyCard->id) !== null, 'Unlink removed history');
    DB::table('guardians')->insert($links);
});
check('Parent announcements return school-wide and Parent audiences only with publication denied', function () use ($familyToken, $familyParent) {
    foreach (['school_wide', 'parents', 'staff', 'sponsors', 'class'] as $audience) DB::table('announcements')->insert(['published_by' => $familyParent->id, 'title' => $audience, 'body' => 'Memory '.$audience, 'audience' => $audience]);
    $response = familyCall('GET', 'announcements', $familyToken); status($response, 200);
    $audiences = array_column($response['body']['data'], 'audience'); sort($audiences); ensure($audiences === ['parents', 'school_wide'], 'Parent audience leak');
    status(familyCall('POST', 'announcements', $familyToken, ['audience' => 'school_wide', 'title' => 'Denied', 'body' => 'Denied']), 403);
});
check('Parent arbitrary messaging is denied before recipient lookup while legacy reads and mark-read remain owned', function () use ($familyToken, $familyParent, $familyOther, $otherTeacher) {
    $before = DB::table('messages')->count();
    foreach ([$otherTeacher->id, $familyOther->id, 999999] as $recipient) status(familyCall('POST', 'messages', $familyToken, ['recipient_id' => $recipient, 'body' => 'private-message-sentinel']), 403);
    ensure(DB::table('messages')->count() === $before, 'Denied message was written');
    $own = DB::table('messages')->insertGetId(['sender_id' => $otherTeacher->id, 'recipient_id' => $familyParent->id, 'sent_at' => '2026-10-11', 'body' => 'Owned history']);
    $other = DB::table('messages')->insertGetId(['sender_id' => $otherTeacher->id, 'recipient_id' => $familyOther->id, 'sent_at' => '2026-10-11', 'body' => 'private-other-conversation']);
    $response = familyCall('GET', 'messages', $familyToken); status($response, 200); ensure(array_column($response['body']['data'], 'id') === [$own], 'Other conversation leaked');
    status(familyCall('PATCH', 'messages/'.$other.'/read', $familyToken), 403);
    status(familyCall('PATCH', 'messages/'.$own.'/read', $familyToken), 200);
});
check('inactive locked cookie sessions and current role changes cannot keep family access', function () use ($familyParent, $familyToken, $familyA) {
    $cookie = sessionCookie($familyParent);
    status(familyCall('GET', 'portal/parent/children/'.$familyA, null, [], $cookie), 200);
    foreach (['inactive', 'locked'] as $state) {
        DB::table('users')->where('id', $familyParent->id)->update(['status' => $state]);
        status(familyCall('GET', 'portal/parent/children/'.$familyA, $familyToken), 403, 'ACCOUNT_INACTIVE');
        status(familyCall('GET', 'portal/parent/children/'.$familyA, null, [], $cookie), $state === 'inactive' ? 403 : 401);
    }
    DB::table('users')->where('id', $familyParent->id)->update(['status' => 'active']);
    $original = $familyParent->role_id; $studentRole = Role::firstOrCreate(['name' => Role::STUDENT]);
    DB::table('users')->where('id', $familyParent->id)->update(['role_id' => $studentRole->id]);
    status(familyCall('GET', 'portal/parent/children', $familyToken), 403);
    DB::table('users')->where('id', $familyParent->id)->update(['role_id' => $original]);
});
check('Parent Sponsor Student and Teacher boundaries reject operational confidential and cross-portal access', function () use ($familyToken, $familyA) {
    foreach (['students', 'guardians', 'audit-logs', 'staff', 'teacher/context', 'assessments/context', 'attendance/my-classes', 'health/profiles', 'health/safety/learners/'.$familyA, 'portal/sponsor/sponsorships'] as $path) status(familyCall('GET', $path, $familyToken), 403);
    foreach ([Role::SPONSOR, Role::STUDENT, Role::TEACHER] as $role) {
        $user = actor($role); if ($role === Role::TEACHER) staff($user); $issued = token($user);
        status(familyCall('GET', 'portal/parent/children/'.$familyA, $issued), 403);
    }
    foreach (['attendance/students', 'assessments', 'guardians'] as $path) status(familyCall('POST', $path, $familyToken, []), 403);
});
check('routine Student provisioning is blocked while existing Student accounts and roles remain reviewable', function () use ($adminToken) {
    $before = DB::table('users')->count();
    $response = familyCall('POST', 'users', $adminToken, ['username' => 'new-student-denied', 'email' => 'new-student-denied@example.test', 'password' => 'isolated-long-password', 'role' => Role::STUDENT]); status($response, 422);
    ensure(isset($response['body']['errors']['role']) && DB::table('users')->count() === $before, 'Student provisioning succeeded');
    $existing = actor(Role::STUDENT); $other = actor(Role::PARENT_GUARDIAN);
    status(familyCall('PATCH', 'users/'.$other->id, $adminToken, ['role' => Role::STUDENT]), 422);
    status(familyCall('PATCH', 'users/'.$existing->id, $adminToken, ['role' => Role::STUDENT, 'email' => 'review-existing-student@example.test']), 200);
    ensure($existing->fresh()->role->name === Role::STUDENT && Role::where('name', Role::STUDENT)->exists(), 'Existing Student role/account removed');
});
check('denial audit details contain only reason metadata and no family report or message content', function () {
    foreach (DB::table('audit_logs')->where('action', 'PORTAL_ACCESS_DENIED')->get() as $log) ensure(json_decode($log->details, true) === ['reason' => 'not_own_child'], 'Unexpected denial audit content');
    $details = implode('\n', DB::table('audit_logs')->pluck('details')->all());
    foreach (['private-phone', 'private-family-medical', 'private-message-sentinel', 'private-unpublished-correction', 'private-mutable-remark'] as $private) ensure(! str_contains($details, $private), 'Sensitive audit material');
});

echo 'Parent Portal checks passed: '.($passed - $parentStart).PHP_EOL;
