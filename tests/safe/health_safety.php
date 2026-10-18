<?php

// Reuse the fail-closed memory bootstrap and real HTTP/Sanctum helpers.
// This also runs all 18 authorization regressions. All new fixtures are in RAM.
require __DIR__.'/authorization.php';

use App\Models\Guardian;
use App\Models\HealthAccessLog;
use App\Models\HealthRecordRevision;
use App\Models\LearnerHealthProfile;
use App\Models\Role;
use App\Models\SchoolHealthIncident;
use App\Models\Student;
use App\Models\User;
use App\Services\HealthAudit;
use Carbon\Carbon;
use Illuminate\Cookie\CookieValuePrefix;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

Carbon::setTestNow(Carbon::parse('2026-10-10 12:00:00', 'Africa/Nairobi'));
$start = $passed;
Schema::table('academic_years', function (Blueprint $table) { $table->date('end_date')->nullable(); $table->boolean('is_current')->default(false); });
Schema::table('guardians', function (Blueprint $table) {
    $table->string('full_name')->nullable(); $table->string('phone')->nullable(); $table->string('email')->nullable();
    $table->string('relationship')->nullable(); $table->text('address')->nullable(); $table->boolean('is_primary_contact')->default(false);
});
(require $root.'/database/migrations/2026_08_02_000014_create_promotions_transfers_table.php')->up();
(require $root.'/database/migrations/2026_08_02_000013_create_student_medical_info_table.php')->up();

function healthCall(string $method, string $path, ?string $token = null, array $data = [], array $cookies = []): array {
    // Fixed-clock fixture batches must not exhaust the production API limiter.
    // This affects only this process's array cache; login throttling is tested above.
    app('cache')->store('array')->flush();
    return callApi($method, 'health/'.$path, $token, $data, $cookies, $cookies ? ['HTTP_ORIGIN' => 'http://localhost'] : []);
}
function data(array $response): array { status($response, 200); return $response['body']['data']; }
function created(array $response): array { status($response, 201); return $response['body']['data']; }
function learnerFixture(int $class, string $state = 'active'): int {
    static $number = 0;
    return DB::table('students')->insertGetId(['admission_no' => 'MEMORY-HEALTH-'.++$number,
        'first_name' => 'Memory', 'last_name' => 'Fixture', 'class_id' => $class, 'status' => $state]);
}
function profileFixture(int $student, string $token): array {
    return created(healthCall('POST', 'profiles', $token, ['student_id' => $student, 'source' => 'staff_observation',
        'emergency_information' => 'restricted-profile-value', 'support_information' => 'restricted-support-value']));
}
function alertPayload(array $overrides = []): array {
    return array_replace(['alert_type' => 'activity_precaution', 'description' => 'actionable-alert-value',
        'request_id' => (string) Str::uuid(),
        'emergency_instructions' => 'actionable-instruction-value', 'is_active' => true, 'source' => 'guardian_report',
        'starts_on' => '2026-10-01', 'ends_on' => null], $overrides);
}
function incidentPayload(int $student, array $overrides = []): array {
    return array_replace(['student_id' => $student, 'request_id' => (string) Str::uuid(),
        'occurred_at' => '2026-10-09T10:00:00+03:00', 'location' => 'memory-location',
        'category' => 'other_safety', 'observations' => 'restricted-incident-value', 'information_basis' => 'reported'], $overrides);
}
function incidentFixture(int $student, string $token): array {
    return created(healthCall('POST', 'incidents', $token, incidentPayload($student)));
}
function correction(int $revision, array $values = []): array {
    return $values + ['expected_revision' => $revision, 'correction_reason' => 'memory-correction-reason'];
}
function healthSession(User $user): array {
    Auth::forgetGuards(); Auth::shouldUse('web');
    $session = app('session')->driver(); $session->flush(); $session->regenerate();
    Auth::guard('web')->login($user); $session->save();
    $name = config('session.cookie');
    return [$name => app('encrypter')->encrypt(CookieValuePrefix::create($name, app('encrypter')->getKey()).$session->getId(), false)];
}

$head = actor(Role::HEAD_TEACHER); staff($head); $headToken = token($head);
$deputy = actor(Role::DEPUTY_HEAD_TEACHER); staff($deputy); $deputyToken = token($deputy);
$classTeacher = actor(Role::TEACHER); $classStaff = staff($classTeacher); $classTeacherToken = token($classTeacher);
$subjectTeacher = actor(Role::TEACHER); $subjectStaff = staff($subjectTeacher); $subjectTeacherToken = token($subjectTeacher);
$class = DB::table('classes')->insertGetId(['name' => 'Memory health class', 'level' => 'primary', 'sequence' => 30, 'class_teacher_id' => $classStaff->id]);
$subjectClass = DB::table('classes')->insertGetId(['name' => 'Memory subject class', 'level' => 'primary', 'sequence' => 31]);
$foreignClass = DB::table('classes')->insertGetId(['name' => 'Memory foreign class', 'level' => 'primary', 'sequence' => 32]);
$student = learnerFixture($class); $subjectStudent = learnerFixture($subjectClass); $foreignStudent = learnerFixture($foreignClass);
$year = DB::table('academic_years')->insertGetId(['name' => 'Memory health year', 'start_date' => '2026-01-01', 'end_date' => '2026-12-31', 'is_current' => true]);
$term = DB::table('terms')->insertGetId(['academic_year_id' => $year, 'name' => 'Memory current term', 'start_date' => '2026-09-01', 'end_date' => '2026-12-01', 'is_current' => true]);
$subject = DB::table('subjects')->insertGetId(['name' => 'Memory area', 'code' => 'MEMORY', 'status' => 'active']);
$offering = DB::table('class_subjects')->insertGetId(['class_id' => $subjectClass, 'subject_id' => $subject]);
$assignment = DB::table('class_subject_teacher')->insertGetId(['class_id' => $subjectClass, 'subject_id' => $subject, 'staff_id' => $subjectStaff->id, 'term_id' => $term]);
$placement = DB::table('promotions_transfers')->insertGetId(['student_id' => $student, 'type' => 'promotion', 'from_class_id' => $foreignClass,
    'to_class_id' => $class, 'term_id' => $term, 'effective_date' => '2026-10-01', 'recorded_by' => $head->id]);
$guardian = DB::table('guardians')->insertGetId(['student_id' => $student, 'user_id' => null, 'full_name' => 'memory-contact-name', 'phone' => 'private-current-phone']);
$foreignGuardian = DB::table('guardians')->insertGetId(['student_id' => $foreignStudent, 'user_id' => null, 'full_name' => 'foreign-memory-contact']);
DB::table('student_medical_info')->insert(['student_id' => $student, 'conditions' => 'legacy-condition-sentinel',
    'allergies' => 'legacy-allergy-sentinel', 'emergency_contact_name' => 'legacy-contact-sentinel', 'emergency_contact_phone' => 'legacy-phone-sentinel']);
$legacyBefore = DB::table('student_medical_info')->get()->map(fn ($row) => (array) $row)->all();

check('health migrations add only empty operational tables and preserve legacy bytes', function () use ($legacyBefore) {
    (require $GLOBALS['root'].'/database/migrations/2026_10_10_000037_create_school_health_records.php')->up();
    foreach (['learner_health_profiles', 'health_safety_alerts', 'school_health_incidents', 'health_incident_actions',
        'health_guardian_notifications', 'health_external_referrals', 'health_record_revisions', 'health_access_logs'] as $table) {
        ensure(Schema::hasTable($table) && DB::table($table)->count() === 0, 'Empty additive table '.$table);
    }
    ensure(DB::table('student_medical_info')->get()->map(fn ($row) => (array) $row)->all() === $legacyBefore, 'Legacy unchanged by migration');
});
check('new routes all require Sanctum and the explicit health boundary and expose no deletes', function () {
    $count = 0;
    foreach (app('router')->getRoutes() as $route) {
        if (! str_starts_with($route->uri(), 'api/v1/health/')) continue;
        ensure(in_array('auth:sanctum', $route->gatherMiddleware(), true), 'Health authentication');
        ensure(count(array_filter($route->gatherMiddleware(), fn ($m) => str_starts_with($m, 'health.access:'))) === 1, 'Explicit health gate');
        ensure(! in_array('DELETE', $route->methods(), true), 'No hard delete route'); $count++;
    }
    ensure($count === 34, 'Expected separate health API boundaries');
});
check('active Head and Deputy can manage while every other role receives uniform denial before record lookup', function () use ($headToken, $deputyToken) {
    foreach ([$headToken, $deputyToken] as $issued) status(healthCall('GET', 'profiles', $issued), 200);
    foreach ([Role::SYSTEM_ADMIN, Role::PARENT_GUARDIAN, Role::SPONSOR, Role::SPONSOR_COORDINATOR, Role::STUDENT, Role::TEACHER] as $role) {
        $user = actor($role); staff($user); $issued = token($user);
        foreach (['profiles', 'profiles/999999', 'incidents/999999', 'incidents/999999/actions/999999/revisions', 'access-log'] as $path) {
            status(healthCall('GET', $path, $issued), 403, 'FORBIDDEN');
        }
        status(healthCall('POST', 'incidents', $issued, []), 403, 'FORBIDDEN');
    }
    status(healthCall('GET', 'profiles'), 401);
});
check('sensitive eligibility requires current active account and active Staff for both managers', function () {
    foreach ([Role::HEAD_TEACHER, Role::DEPUTY_HEAD_TEACHER] as $role) {
        $user = actor($role); $issued = token($user); status(healthCall('GET', 'profiles', $issued), 403, 'FORBIDDEN');
        $staff = staff($user); status(healthCall('GET', 'profiles', $issued), 200);
        foreach (['on_leave', 'terminated'] as $state) { $staff->update(['status' => $state]); status(healthCall('GET', 'profiles', $issued), 403, 'FORBIDDEN'); }
        $staff->update(['status' => 'active']);
        foreach (['inactive', 'locked'] as $state) { DB::table('users')->where('id', $user->id)->update(['status' => $state]); status(healthCall('GET', 'profiles', $issued), 403, 'ACCOUNT_INACTIVE'); }
        DB::table('users')->where('id', $user->id)->update(['status' => 'active']);
        $staff->update(['user_id' => null]); status(healthCall('GET', 'profiles', $issued), 403, 'FORBIDDEN');
    }
});

$profile = profileFixture($student, $headToken); $subjectProfile = profileFixture($subjectStudent, $deputyToken); $foreignProfile = profileFixture($foreignStudent, $headToken);
$alert = created(healthCall('POST', 'profiles/'.$profile['id'].'/alerts', $headToken, alertPayload()));
$subjectAlert = created(healthCall('POST', 'profiles/'.$subjectProfile['id'].'/alerts', $deputyToken, alertPayload()));
created(healthCall('POST', 'profiles/'.$foreignProfile['id'].'/alerts', $headToken, alertPayload()));

check('unknown allergy information is explicit and never imports legacy content or becomes none reported', function () use ($profile, $headToken, $student, $class) {
    ensure($profile['allergy_information_state'] === 'unknown' && $profile['allergy_information'] === null, 'Unknown default');
    ensure($profile['reviewed_at'] === null && $profile['reviewed_by'] === null, 'No invented review');
    $next = data(healthCall('PATCH', 'profiles/'.$profile['id'], $headToken, correction(1, ['allergy_information_state' => 'none_reported'])));
    ensure($next['allergy_information_state'] === 'none_reported', 'Explicit none reported');
    $history = data(healthCall('GET', 'profiles/'.$profile['id'].'/revisions', $headToken));
    ensure($history[1]['snapshot']['allergy_information_state'] === 'unknown', 'Unknown retained in prior revision');
    status(healthCall('POST', 'profiles', $headToken, ['student_id' => $student, 'source' => 'staff_observation']), 409, 'PROFILE_EXISTS');
    $new = learnerFixture($class);
    foreach ([['allergy_information_state' => 'recorded'], ['allergy_information_state' => 'none_reported', 'allergy_information' => 'conflicting-value'],
        ['allergy_information_state' => 'unknown', 'allergy_information' => 'conflicting-value'], ['allergy_information_state' => 'invented']] as $values) {
        status(healthCall('POST', 'profiles', $headToken, $values + ['student_id' => $new, 'source' => 'staff_observation']), 422);
    }
});
check('profile corrections require reasons and revisions; reviews are explicit and edits clear review metadata', function () use ($profile, $headToken, $head) {
    $path = 'profiles/'.$profile['id'];
    status(healthCall('PATCH', $path, $headToken, ['expected_revision' => 2, 'support_information' => 'new']), 422);
    status(healthCall('PATCH', $path, $headToken, correction(1, ['support_information' => 'new'])), 409, 'REVISION_CONFLICT');
    $reviewed = data(healthCall('POST', $path.'/review', $headToken, correction(2)));
    ensure($reviewed['reviewed_by'] === $head->id && $reviewed['reviewed_at'] !== null, 'Explicit human review');
    $edited = data(healthCall('PATCH', $path, $headToken, correction(3, ['support_information' => 'corrected-support-value', 'student_id' => 999])));
    ensure($edited['reviewed_at'] === null && $edited['student_id'] === $profile['student_id'], 'Clear review and immutable owner');
    ensure($edited['revision_number'] === 4, 'Monotonic profile revisions');
});
check('profile and alert bounds, sources, date ranges and validation remain strict', function () use ($profile, $headToken) {
    foreach ([['description' => str_repeat('x', 501)], ['emergency_instructions' => str_repeat('x', 501)], ['ends_on' => '2026-09-30'],
        ['alert_type' => 'clinical_diagnosis'], ['source' => 'invented_source'], ['is_active' => null]] as $values) {
        status(healthCall('POST', 'profiles/'.$profile['id'].'/alerts', $headToken, alertPayload($values)), 422);
    }
    status(healthCall('PATCH', 'profiles/'.$profile['id'], $headToken, correction(4, ['emergency_information' => str_repeat('x', 1001)])), 422);
    status(healthCall('GET', 'profiles?per_page=51', $headToken), 422);
});
check('teacher safety responses include only current actionable alerts within Class Teacher scope', function () use ($classTeacherToken, $student, $foreignStudent, $profile, $headToken) {
    foreach ([['is_active' => false], ['starts_on' => '2026-11-01'], ['ends_on' => '2026-10-08']] as $values) {
        created(healthCall('POST', 'profiles/'.$profile['id'].'/alerts', $headToken, alertPayload($values)));
    }
    $view = data(healthCall('GET', 'safety/learners/'.$student, $classTeacherToken));
    ensure(array_keys($view) === ['student_id', 'alerts'] && count($view['alerts']) === 1, 'Only relevant alerts');
    ensure(array_keys($view['alerts'][0]) === ['id', 'alert_type', 'description', 'emergency_instructions'], 'Safety allowlist');
    foreach (['restricted-profile-value', 'corrected-support-value', 'legacy-condition-sentinel', 'source', 'verified_by', 'revision_number'] as $secret) {
        ensure(! str_contains(json_encode($view), $secret), 'No confidential profile/internal fields');
    }
    status(healthCall('GET', 'safety/learners/'.$foreignStudent.'?staff_id=1&role=head_teacher', $classTeacherToken), 403, 'FORBIDDEN');
    status(healthCall('GET', 'safety/learners/999999', $classTeacherToken), 403, 'FORBIDDEN');
});
check('Subject Teacher scope requires current calendar, active subject and actual offering/assignment', function () use ($subjectTeacherToken, $subjectStudent, $foreignStudent, $term, $year, $subject, $offering, $assignment, $subjectClass) {
    ensure(count(data(healthCall('GET', 'safety/learners/'.$subjectStudent, $subjectTeacherToken))['alerts']) === 1, 'Current subject assignment');
    status(healthCall('GET', 'safety/learners/'.$foreignStudent, $subjectTeacherToken), 403, 'FORBIDDEN');
    foreach ([['terms', $term, 'is_current', false, true], ['academic_years', $year, 'is_current', false, true],
        ['subjects', $subject, 'status', 'inactive', 'active'], ['terms', $term, 'end_date', '2026-10-09', '2026-12-01']] as [$table, $id, $column, $bad, $good]) {
        DB::table($table)->where('id', $id)->update([$column => $bad]);
        status(healthCall('GET', 'safety/learners/'.$subjectStudent, $subjectTeacherToken), 403, 'FORBIDDEN');
        DB::table($table)->where('id', $id)->update([$column => $good]);
    }
    DB::table('class_subjects')->where('id', $offering)->delete();
    status(healthCall('GET', 'safety/learners/'.$subjectStudent, $subjectTeacherToken), 403, 'FORBIDDEN');
    DB::table('class_subjects')->insert(['id' => $offering, 'class_id' => $subjectClass, 'subject_id' => $subject]);
    DB::table('class_subject_teacher')->where('id', $assignment)->delete();
    status(healthCall('GET', 'safety/learners/'.$subjectStudent, $subjectTeacherToken), 403, 'FORBIDDEN');
});
check('teacher eligibility changes deny scope immediately, and empty alerts do not assert no allergies', function () use ($classTeacherToken, $classStaff, $student, $class) {
    $noProfile = learnerFixture($class);
    ensure(data(healthCall('GET', 'safety/learners/'.$noProfile, $classTeacherToken)) === ['student_id' => $noProfile, 'alerts' => []], 'No allergy claim from empty alerts');
    DB::table('students')->where('id', $student)->update(['status' => 'left']);
    status(healthCall('GET', 'safety/learners/'.$student, $classTeacherToken), 403, 'FORBIDDEN');
    DB::table('students')->where('id', $student)->update(['status' => 'active']);
    $classStaff->update(['staff_type' => 'non_teaching']); status(healthCall('GET', 'safety/learners/'.$student, $classTeacherToken), 403, 'FORBIDDEN');
    $classStaff->update(['staff_type' => 'teaching', 'status' => 'on_leave']); status(healthCall('GET', 'safety/learners/'.$student, $classTeacherToken), 403, 'FORBIDDEN');
    $classStaff->update(['status' => 'active']);
    DB::table('classes')->where('id', $class)->update(['class_teacher_id' => null]);
    status(healthCall('GET', 'safety/learners/'.$student, $classTeacherToken), 403, 'FORBIDDEN');
    DB::table('classes')->where('id', $class)->update(['class_teacher_id' => $classStaff->id]);
});
check('alert activation history and real verification are recorded; edits revoke stale verification', function () use ($profile, $alert, $headToken, $head, $classTeacherToken, $student) {
    $path = 'profiles/'.$profile['id'].'/alerts/'.$alert['id'];
    ensure($alert['verified_by'] === null && $alert['verified_at'] === null, 'No invented verification');
    $verified = data(healthCall('POST', $path.'/verify', $headToken, correction(1, ['verification_basis' => 'memory-reviewed-source'])));
    ensure($verified['verified_by'] === $head->id && $verified['verified_at'] !== null, 'Explicit verifier');
    $inactive = data(healthCall('PATCH', $path, $headToken, correction(2, ['is_active' => false])));
    ensure($inactive['verified_at'] === null && count(data(healthCall('GET', 'safety/learners/'.$student, $classTeacherToken))['alerts']) === 0, 'Inactive removed and verification cleared');
    data(healthCall('PATCH', $path, $headToken, correction(3, ['is_active' => true])));
    $history = data(healthCall('GET', $path.'/revisions', $headToken));
    ensure(array_column($history, 'change_type') === ['activation', 'deactivation', 'verification', 'creation'], 'Activation timeline');
    status(healthCall('PATCH', $path, $headToken, correction(3, ['description' => 'stale'])), 409, 'REVISION_CONFLICT');
});
check('nested alert ownership is enforced independently of client IDs', function () use ($profile, $foreignProfile, $alert, $headToken) {
    foreach (['', '/revisions'] as $suffix) status(healthCall('GET', 'profiles/'.$foreignProfile['id'].'/alerts/'.$alert['id'].$suffix, $headToken), 404);
    status(healthCall('PATCH', 'profiles/'.$foreignProfile['id'].'/alerts/'.$alert['id'], $headToken, correction(4, ['profile_id' => $profile['id']])), 404);
});

$incident = incidentFixture($student, $headToken); $foreignIncident = incidentFixture($foreignStudent, $deputyToken);
check('incidents preserve evidence-backed historical context without inferring unproven current class', function () use ($incident, $class, $term, $placement, $foreignIncident) {
    ensure($incident['historical_class_id'] === $class && $incident['historical_term_id'] === $term, 'Evidence-backed context');
    ensure($incident['context_snapshot']['placement_record_id'] === $placement, 'Actual history source');
    ensure($foreignIncident['historical_class_id'] === null && $foreignIncident['context_snapshot']['class_basis'] === 'unknown', 'Current class not fabricated as history');
});
check('incident creates are idempotent and conflicting request reuse is refused', function () use ($student, $headToken) {
    $payload = incidentPayload($student); $first = created(healthCall('POST', 'incidents', $headToken, $payload));
    $replayed = healthCall('POST', 'incidents', $headToken, $payload); status($replayed, 200);
    ensure($replayed['body']['data']['id'] === $first['id'] && $replayed['body']['meta']['operation'] === 'replayed', 'Stable identity');
    ensure(SchoolHealthIncident::find($first['id'])->revisions()->count() === 1, 'No duplicate creation revision');
    $payload['observations'] = 'different-payload'; status(healthCall('POST', 'incidents', $headToken, $payload), 409, 'IDEMPOTENCY_CONFLICT');
    foreach ([['occurred_at' => '2026-10-11T10:00:00+03:00'], ['observations' => str_repeat('x', 2001)], ['category' => 'diagnosis']] as $values) {
        status(healthCall('POST', 'incidents', $headToken, incidentPayload($student, $values)), 422);
    }
});

$actionPayload = ['request_id' => (string) Str::uuid(), 'expected_incident_revision' => 1, 'action_type' => 'first_aid',
    'action_at' => '2026-10-09T10:05:00+03:00', 'action' => 'restricted-action-value', 'result' => 'restricted-result-value',
    'status_after' => 'monitoring', 'disposition_after' => 'monitoring'];
$action = created(healthCall('POST', 'incidents/'.$incident['id'].'/actions', $headToken, $actionPayload));
check('first-aid actions append attributed history and update the incident with optimistic protection', function () use ($incident, $action, $actionPayload, $headToken, $head) {
    ensure($action['actor_id'] === $head->id && $action['recorded_at'] !== null, 'Server actor/time');
    $current = data(healthCall('GET', 'incidents/'.$incident['id'], $headToken));
    ensure($current['revision_number'] === 2 && $current['status'] === 'monitoring' && $current['disposition'] === 'monitoring', 'Action transition versioned');
    $replay = healthCall('POST', 'incidents/'.$incident['id'].'/actions', $headToken, $actionPayload); status($replay, 200);
    ensure($replay['body']['data']['id'] === $action['id'], 'Action idempotency');
    $stale = $actionPayload; $stale['request_id'] = (string) Str::uuid();
    status(healthCall('POST', 'incidents/'.$incident['id'].'/actions', $headToken, $stale), 409, 'REVISION_CONFLICT');
    $invalid = $stale; $invalid['expected_incident_revision'] = 2; $invalid['action_at'] = '2026-10-09T09:00:00+03:00';
    status(healthCall('POST', 'incidents/'.$incident['id'].'/actions', $headToken, $invalid), 422);
});
$notification = created(healthCall('POST', 'incidents/'.$incident['id'].'/notifications', $headToken, [
    'request_id' => (string) Str::uuid(), 'expected_incident_revision' => 2, 'guardian_id' => $guardian, 'channel' => 'phone',
    'attempted_at' => '2026-10-09T10:10:00+03:00', 'outcome' => 'no_answer', 'contact_used' => 'restricted-actual-contact-value',
]));
$referralPayload = ['request_id' => (string) Str::uuid(), 'expected_incident_revision' => 3, 'referred_at' => '2026-10-09T10:15:00+03:00',
    'reason' => 'restricted-referral-value', 'destination' => 'memory-destination', 'authorization_details' => 'restricted-authorization-value',
    'handover_details' => 'restricted-handover-value', 'follow_up_status' => 'pending'];
$referral = created(healthCall('POST', 'incidents/'.$incident['id'].'/referrals', $headToken, $referralPayload));
check('notifications use the existing learner Guardian and snapshot only known contact facts', function () use ($notification, $guardian, $foreignGuardian, $incident, $headToken) {
    ensure($notification['guardian_id'] === $guardian && $notification['contact_snapshot']['contact_used'] === 'restricted-actual-contact-value', 'Known attempted contact');
    ensure(! str_contains(json_encode($notification), 'private-current-phone'), 'Current phone never substituted for historical attempted contact');
    DB::table('guardians')->where('id', $guardian)->update(['full_name' => 'changed-current-name', 'phone' => 'changed-current-phone']);
    $retained = data(healthCall('GET', 'incidents/'.$incident['id'].'/notifications/'.$notification['id'], $headToken));
    ensure($retained['contact_snapshot']['guardian_name_at_recording'] === 'memory-contact-name', 'Snapshot retained after contact change');
    status(healthCall('POST', 'incidents/'.$incident['id'].'/notifications', $headToken, [
        'request_id' => (string) Str::uuid(), 'expected_incident_revision' => 4, 'guardian_id' => $foreignGuardian,
        'channel' => 'phone', 'attempted_at' => '2026-10-09T10:20:00+03:00', 'outcome' => 'contacted',
    ]), 422);
});
check('nested actions, notifications, referrals and their histories cannot be moved across incidents', function () use ($incident, $foreignIncident, $action, $notification, $referral, $headToken, $referralPayload) {
    foreach (['actions' => $action, 'notifications' => $notification, 'referrals' => $referral] as $path => $record) {
        foreach (['', '/revisions'] as $suffix) status(healthCall('GET', 'incidents/'.$foreignIncident['id'].'/'.$path.'/'.$record['id'].$suffix, $headToken), 404);
        status(healthCall('PATCH', 'incidents/'.$foreignIncident['id'].'/'.$path.'/'.$record['id'], $headToken,
            correction(1, ['expected_incident_revision' => 1, 'incident_id' => $incident['id']])), 404);
    }
    status(healthCall('POST', 'incidents/'.$foreignIncident['id'].'/referrals', $headToken, $referralPayload), 409, 'IDEMPOTENCY_CONFLICT');
});
check('entry corrections preserve attribution and prior facts, and never replay historical transitions', function () use ($incident, $action, $notification, $referral, $headToken) {
    $base = 'incidents/'.$incident['id'];
    $corrected = data(healthCall('PATCH', $base.'/actions/'.$action['id'], $headToken,
        correction(1, ['expected_incident_revision' => 4, 'action' => 'corrected-action-value', 'actor_id' => 999])));
    ensure($corrected['actor_id'] === $action['actor_id'] && $corrected['recorded_at'] === $action['recorded_at'], 'Original attribution retained');
    $history = data(healthCall('GET', $base.'/actions/'.$action['id'].'/revisions', $headToken));
    ensure($history[1]['snapshot']['action'] === 'restricted-action-value' && $history[0]['snapshot']['action'] === 'corrected-action-value', 'Prior action retained');
    status(healthCall('PATCH', $base.'/actions/'.$action['id'], $headToken,
        correction(2, ['expected_incident_revision' => 5, 'status_after' => 'closed', 'disposition_after' => 'guardian_handover'])), 422);
    data(healthCall('PATCH', $base.'/notifications/'.$notification['id'], $headToken,
        correction(1, ['expected_incident_revision' => 5, 'outcome' => 'contacted'])));
    $updatedReferral = data(healthCall('PATCH', $base.'/referrals/'.$referral['id'], $headToken,
        correction(1, ['expected_incident_revision' => 6, 'follow_up_status' => 'handed_over'])));
    ensure($updatedReferral['revision_number'] === 2, 'Referral follow-up versioned');
    $current = data(healthCall('GET', $base, $headToken));
    ensure($current['revision_number'] === 7 && $current['status'] === 'monitoring', 'Aggregate incident version; transition unchanged');
});
check('incident corrections preserve captured class and term after promotion, and stale writers conflict', function () use ($incident, $student, $foreignClass, $class, $term, $headToken) {
    DB::table('students')->where('id', $student)->update(['class_id' => $foreignClass]);
    $corrected = data(healthCall('PATCH', 'incidents/'.$incident['id'], $headToken, correction(7, ['observations' => 'corrected-incident-value', 'student_id' => 999, 'historical_class_id' => $foreignClass])));
    ensure($corrected['historical_class_id'] === $class && $corrected['historical_term_id'] === $term && $corrected['student_id'] === $student, 'Immutable context and owner');
    status(healthCall('PATCH', 'incidents/'.$incident['id'], $headToken, correction(7, ['location' => 'stale'])), 409, 'REVISION_CONFLICT');
    status(healthCall('PATCH', 'incidents/'.$incident['id'], $headToken, correction(8, ['occurred_at' => '2026-10-09T11:00:00+03:00'])), 422);
    $history = data(healthCall('GET', 'incidents/'.$incident['id'].'/revisions', $headToken));
    ensure($history[count($history) - 1]['snapshot']['observations'] === 'restricted-incident-value', 'Original observations retained');
    DB::table('students')->where('id', $student)->update(['class_id' => $class]);
});
check('confidential listings and all teacher responses exclude narratives, contact data, hashes and internal source metadata', function () use ($headToken, $classTeacherToken, $student, $incident) {
    $payloads = [];
    foreach (['profiles', 'incidents', 'incidents/'.$incident['id'].'/actions', 'incidents/'.$incident['id'].'/notifications', 'incidents/'.$incident['id'].'/referrals'] as $path) $payloads[] = data(healthCall('GET', $path, $headToken));
    $payloads[] = data(healthCall('GET', 'safety/learners/'.$student, $classTeacherToken));
    $filtered = data(healthCall('GET', 'profiles?student_id='.$student, $headToken));
    ensure(count($filtered) === 1 && $filtered[0]['student_id'] === $student, 'Exact learner profile discovery');
    $json = json_encode($payloads);
    foreach (['restricted-profile-value', 'corrected-support-value', 'restricted-incident-value', 'corrected-incident-value', 'corrected-action-value',
        'restricted-actual-contact-value', 'restricted-referral-value', 'restricted-authorization-value', 'restricted-handover-value', 'request_hash', 'request_id', 'context_snapshot'] as $secret) {
        ensure(! str_contains($json, $secret), 'Confidential listing field leaked: '.$secret);
    }
});
check('sensitive reads and mutations use a restricted metadata-only audit that administrators cannot inspect', function () use ($headToken, $adminToken, $classTeacherToken) {
    $ordinary = json_encode(DB::table('audit_logs')->get());
    ensure(! str_contains($ordinary, 'Health') && ! str_contains($ordinary, 'read_safety'), 'No health associations in general audit');
    $restricted = data(healthCall('GET', 'access-log', $headToken));
    ensure(count($restricted) > 0 && HealthAccessLog::where('operation', 'read_safety')->exists(), 'Teacher read audited privately');
    status(healthCall('GET', 'access-log', $adminToken), 403, 'FORBIDDEN');
    status(healthCall('GET', 'access-log', $classTeacherToken), 403, 'FORBIDDEN');
    $json = json_encode(DB::table('health_access_logs')->get());
    foreach (['restricted-', 'actionable-', 'memory-contact-name', 'memory-correction-reason', 'memory-location'] as $secret) ensure(! str_contains($json, $secret), 'No sensitive content in audit');
});
check('audit failures roll back creations, corrections, revisions, transitions and access logs; reads fail closed', function () use ($headToken, $student, $incident, $profile) {
    $before = [];
    foreach (['learner_health_profiles', 'school_health_incidents', 'health_incident_actions', 'health_record_revisions', 'health_access_logs'] as $table) $before[$table] = DB::table($table)->get()->map(fn ($row) => (array) $row)->all();
    app()->instance(HealthAudit::class, new class extends HealthAudit {
        public function log(User $actor, string $operation, string $type, ?int $id = null): void { throw new RuntimeException('restricted-failure-sentinel'); }
    });
    try {
        foreach ([['POST', 'incidents', incidentPayload($student)],
            ['PATCH', 'profiles/'.$profile['id'], correction(4, ['support_information' => 'rollback-value'])],
            ['POST', 'incidents/'.$incident['id'].'/actions', ['request_id' => (string) Str::uuid(), 'expected_incident_revision' => 8,
                'action_type' => 'status_change', 'action_at' => '2026-10-09T10:30:00+03:00', 'action' => 'rollback-value', 'status_after' => 'closed', 'disposition_after' => 'guardian_handover']],
            ['GET', 'profiles/'.$profile['id'], []], ['GET', 'profiles', []]] as [$method, $path, $values]) {
            $response = healthCall($method, $path, $headToken, $values); status($response, 503, 'HEALTH_OPERATION_FAILED');
            ensure(! str_contains(json_encode($response['body']), 'restricted-failure-sentinel'), 'Safe failure response');
        }
    } finally { app()->forgetInstance(HealthAudit::class); }
    foreach ($before as $table => $rows) ensure(DB::table($table)->get()->map(fn ($row) => (array) $row)->all() === $rows, 'Full rollback '.$table);
});
check('revisions and health audit rows reject model mutation/deletion and unique revision sequences remain enforced', function () {
    foreach ([HealthRecordRevision::first(), HealthAccessLog::first()] as $record) {
        try { $record->delete(); throw new LogicException('Expected deletion denial'); } catch (LogicException $exception) { ensure(str_contains($exception->getMessage(), 'cannot be deleted'), 'Immutable history'); }
        try { $record->update(['recorded_at' => now()->subDay()]); throw new LogicException('Expected update denial'); } catch (LogicException $exception) { ensure(str_contains($exception->getMessage(), 'append-only'), 'Immutable history update'); }
    }
    $row = DB::table('health_record_revisions')->first(); $copy = (array) $row; unset($copy['id']);
    try { DB::table('health_record_revisions')->insert($copy); throw new LogicException('Expected unique constraint'); }
    catch (Illuminate\Database\QueryException $exception) { ensure(str_contains($exception->getMessage(), 'UNIQUE'), 'Database sequence constraint'); }
    try { LearnerHealthProfile::first()->delete(); throw new LogicException('Expected health record deletion denial'); }
    catch (LogicException $exception) { ensure(str_contains($exception->getMessage(), 'cannot be hard deleted'), 'No model hard deletion'); }
});
check('deactivation revokes dormant health sessions durably across reactivation through PATCH and DELETE', function () use ($adminToken) {
    foreach ([['PATCH', 'inactive'], ['PATCH', 'locked'], ['DELETE', 'inactive']] as [$method, $state]) {
        $user = actor(Role::HEAD_TEACHER); staff($user); $cookie = healthSession($user);
        status(healthCall('GET', 'profiles', null, [], $cookie), 200);
        $before = (int) $user->fresh()->session_version;
        status(callApi($method, 'users/'.$user->id, $adminToken, ['status' => $state]), 200);
        ensure((int) $user->fresh()->session_version === $before + 1, 'Durable revocation epoch');
        status(callApi('PATCH', 'users/'.$user->id, $adminToken, ['status' => 'active', 'session_version' => $before]), 200);
        ensure((int) $user->fresh()->session_version === $before + 1, 'Client cannot restore a revoked session epoch');
        // Deliberately never presented the old session while inactive.
        status(healthCall('GET', 'profiles', null, [], $cookie), 401);
        $freshCookie = healthSession($user->fresh()); status(healthCall('GET', 'profiles', null, [], $freshCookie), 200);
    }
});
check('pre-checkpoint unversioned sessions cannot acquire health access; fresh bearer login remains valid', function () {
    $user = actor(Role::DEPUTY_HEAD_TEACHER); staff($user);
    $legacyCookie = sessionCookie($user); status(healthCall('GET', 'profiles', null, [], $legacyCookie), 401);
    $login = callApi('POST', 'auth/login', null, ['username' => $user->username, 'password' => 'isolated-test-password']); status($login, 200);
    status(healthCall('GET', 'profiles', $login['body']['data']['token']), 200);
});
check('legacy medical data is unchanged and remains absent from ordinary Student and health responses', function () use ($legacyBefore, $student, $headToken, $profile) {
    ensure(DB::table('student_medical_info')->get()->map(fn ($row) => (array) $row)->all() === $legacyBefore, 'Legacy bytes preserved');
    $ordinary = callApi('GET', 'students/'.$student, $headToken); status($ordinary, 200);
    $restricted = healthCall('GET', 'profiles/'.$profile['id'], $headToken); status($restricted, 200);
    foreach (['legacy-condition-sentinel', 'legacy-allergy-sentinel', 'legacy-contact-sentinel', 'legacy-phone-sentinel', 'medical_info'] as $secret) {
        ensure(! str_contains(json_encode([$ordinary['body'], $restricted['body']]), $secret), 'Legacy content not exposed');
    }
});
check('both new migrations refuse destructive rollback', function () {
    foreach (['2026_10_10_000036_add_user_session_version.php', '2026_10_10_000037_create_school_health_records.php'] as $file) {
        try { (require $GLOBALS['root'].'/database/migrations/'.$file)->down(); throw new LogicException('Expected forward-only rollback guard'); }
        catch (RuntimeException $exception) { ensure(str_contains($exception->getMessage(), 'forward-only'), 'Rollback protected'); }
    }
});
check('existing Guardian unlinking preserves notification facts and protected historical contact references', function () use ($headToken, $guardian, $student, $notification, $incident) {
    status(callApi('DELETE', 'guardians/'.$guardian.'/students/'.$student, $headToken), 200);
    ensure(! Guardian::find($guardian), 'Existing unlink workflow remains available');
    $record = data(healthCall('GET', 'incidents/'.$incident['id'].'/notifications/'.$notification['id'], $headToken));
    ensure($record['guardian_id'] === null && $record['contact_snapshot']['guardian_id_at_recording'] === $guardian, 'Historical reference retained without live Guardian');
    ensure($record['contact_snapshot']['guardian_name_at_recording'] === 'memory-contact-name'
        && $record['contact_snapshot']['contact_used'] === 'restricted-actual-contact-value', 'Minimum historical contact facts retained');
});
check('recorded allergy details remain distinct from unknown and none reported, with revision preservation', function () use ($profile, $headToken) {
    $path = 'profiles/'.$profile['id'];
    $recorded = data(healthCall('PATCH', $path, $headToken, correction(4, [
        'allergy_information_state' => 'recorded', 'allergy_information' => 'restricted-allergy-sentinel',
    ])));
    ensure($recorded['allergy_information_state'] === 'recorded' && $recorded['allergy_information'] === 'restricted-allergy-sentinel', 'Explicit reported detail');
    status(healthCall('PATCH', $path, $headToken, correction(5, ['allergy_information_state' => 'none_reported'])), 422);
    $unknown = data(healthCall('PATCH', $path, $headToken, correction(5, ['allergy_information_state' => 'unknown', 'allergy_information' => null])));
    ensure($unknown['allergy_information_state'] === 'unknown' && $unknown['allergy_information'] === null, 'Explicit unknown correction');
    $history = data(healthCall('GET', $path.'/revisions', $headToken));
    ensure($history[1]['snapshot']['allergy_information'] === 'restricted-allergy-sentinel', 'Prior reported detail retained');
});
check('real web session identity is bound to its user and permission changes require health reauthentication', function () use ($adminToken) {
    $user = actor(Role::HEAD_TEACHER); staff($user); $cookie = healthSession($user);
    status(healthCall('GET', 'profiles', null, [], $cookie), 200);
    status(callApi('PATCH', 'users/'.$user->id, $adminToken, ['role' => Role::DEPUTY_HEAD_TEACHER]), 200);
    status(healthCall('GET', 'profiles', null, [], $cookie), 401);
    $newCookie = healthSession($user->fresh()); status(healthCall('GET', 'profiles', null, [], $newCookie), 200);
    $other = actor(Role::HEAD_TEACHER); staff($other);
    $session = app('session')->driver();
    $session->put(Auth::guard('web')->getName(), $other->id); $session->save();
    status(healthCall('GET', 'profiles', null, [], $newCookie), 401);
});
check('a rejected deactivation rolls back the durable session epoch alongside account and token state', function () use ($adminToken) {
    $user = actor(Role::HEAD_TEACHER); staff($user); $cookie = healthSession($user); $version = (int) $user->fresh()->session_version;
    app()->instance(App\Services\AuditLogger::class, new class(Illuminate\Http\Request::create('/')) extends App\Services\AuditLogger {
        public function log(string $action, ?string $entityType = null, ?int $entityId = null, array $details = []): App\Models\AuditLog { throw new RuntimeException('memory-audit-failure'); }
    });
    try { status(callApi('DELETE', 'users/'.$user->id, $adminToken), 500); }
    finally { app()->forgetInstance(App\Services\AuditLogger::class); }
    ensure($user->fresh()->status === 'active' && (int) $user->fresh()->session_version === $version, 'Revocation rolled back consistently');
    status(healthCall('GET', 'profiles', null, [], $cookie), 200);
});
check('a revision write failure also rolls back new records and sensitive audit entries', function () use ($student, $headToken) {
    $incidents = SchoolHealthIncident::count(); $revisions = HealthRecordRevision::count(); $audits = HealthAccessLog::count();
    $reject = true;
    HealthRecordRevision::creating(function () use (&$reject) { if ($reject) throw new RuntimeException('memory-revision-failure'); });
    try { status(healthCall('POST', 'incidents', $headToken, incidentPayload($student)), 503, 'HEALTH_OPERATION_FAILED'); }
    finally { $reject = false; }
    ensure(SchoolHealthIncident::count() === $incidents && HealthRecordRevision::count() === $revisions
        && HealthAccessLog::count() === $audits, 'Revision failure is atomic');
});
check('notification and referral retries preserve their original identities and never duplicate history', function () use ($headToken, $incident, $notification, $referralPayload, $referral, $guardian) {
    $original = ['request_id' => App\Models\HealthGuardianNotification::find($notification['id'])->request_id,
        'expected_incident_revision' => 2, 'guardian_id' => $guardian, 'channel' => 'phone',
        'attempted_at' => '2026-10-09T10:10:00+03:00', 'outcome' => 'no_answer', 'contact_used' => 'restricted-actual-contact-value'];
    $notificationReplay = healthCall('POST', 'incidents/'.$incident['id'].'/notifications', $headToken, $original); status($notificationReplay, 200);
    ensure($notificationReplay['body']['data']['id'] === $notification['id'], 'Original notification replay survives Guardian unlinking');
    $response = healthCall('POST', 'incidents/'.$incident['id'].'/referrals', $headToken, $referralPayload); status($response, 200);
    ensure($response['body']['data']['id'] === $referral['id'] && $response['body']['meta']['operation'] === 'replayed', 'Referral replay identity');
    ensure(App\Models\HealthExternalReferral::find($referral['id'])->revisions()->count() === 2, 'Replay adds no content revision');
    $payload = ['request_id' => (string) Str::uuid(), 'expected_incident_revision' => 8, 'channel' => 'in_person',
        'attempted_at' => '2026-10-09T10:40:00+03:00', 'outcome' => 'contacted'];
    $first = created(healthCall('POST', 'incidents/'.$incident['id'].'/notifications', $headToken, $payload));
    $again = healthCall('POST', 'incidents/'.$incident['id'].'/notifications', $headToken, $payload); status($again, 200);
    ensure($again['body']['data']['id'] === $first['id'], 'Notification replay identity');
    ensure(App\Models\HealthGuardianNotification::find($first['id'])->revisions()->count() === 1, 'Notification no duplicate revision');
});
check('sensitive responses are not cached and scoped missing-record errors disclose no internal model metadata', function () use ($headToken, $profile) {
    $response = healthCall('GET', 'profiles/'.$profile['id'], $headToken); status($response, 200);
    ensure(str_contains($response['response']->headers->get('Cache-Control'), 'no-store'), 'No-store response');
    $missing = healthCall('GET', 'profiles/999999', $headToken); status($missing, 404);
    ensure($missing['body'] === ['message' => 'Not Found.'], 'Uniform missing record response');
});
check('form-style health validation returns JSON and never flashes sensitive input into the session', function () use ($head) {
    $cookie = healthSession($head);
    Auth::forgetGuards(); Auth::shouldUse('web'); app('session')->driver()->flush();
    $request = Illuminate\Http\Request::create('http://localhost/api/v1/health/profiles', 'POST',
        ['emergency_information' => 'restricted-form-value'], $cookie, [], ['HTTP_ORIGIN' => 'http://localhost', 'HTTP_ACCEPT' => 'text/html']);
    $kernel = app(Illuminate\Contracts\Http\Kernel::class); $response = $kernel->handle($request); $kernel->terminate($request, $response);
    ensure($response->getStatusCode() === 422 && str_contains($response->headers->get('Content-Type'), 'application/json'), 'API JSON validation');
    ensure(! app('session')->driver()->has('_old_input'), 'No confidential form flashing');
});
check('alert creation retries are idempotent and changed request reuse cannot create duplicate safety facts', function () use ($headToken, $profile) {
    $payload = alertPayload(); $path = 'profiles/'.$profile['id'].'/alerts';
    $first = created(healthCall('POST', $path, $headToken, $payload));
    $again = healthCall('POST', $path, $headToken, $payload); status($again, 200);
    ensure($again['body']['data']['id'] === $first['id'] && $again['body']['meta']['operation'] === 'replayed', 'Stable alert replay');
    ensure(App\Models\HealthSafetyAlert::find($first['id'])->revisions()->count() === 1, 'No duplicate alert revision');
    $payload['description'] = 'different-alert'; status(healthCall('POST', $path, $headToken, $payload), 409, 'IDEMPOTENCY_CONFLICT');
});

echo ($passed - $start).' Health & Safety checks passed; SQLite memory only, no persisted learner or health fixtures.'.PHP_EOL;
