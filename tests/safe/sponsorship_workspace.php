<?php

// Reuse the sole guarded SQLite RAM connection, Sanctum HTTP helpers and family/teacher fixtures.
// No dotenv, configuration file, development connection or persistent artifact.
require __DIR__.'/parent_portal.php';

use App\Models\Role;
use App\Models\Sponsor;
use App\Models\Sponsorship;
use App\Services\AuditLogger;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

$coordinatorStart = $passed;
// Replace minimal authorization-only fixture definitions in RAM with the actual domain schema.
Schema::drop('sponsorships'); Schema::drop('sponsors');
foreach (['2026_08_02_000018_create_sponsors_table.php', '2026_08_02_000019_create_sponsorships_table.php', '2026_09_28_000001_create_sponsorship_student_table.php'] as $fixture) {
    (require $root.'/database/migrations/'.$fixture)->up();
}
$coordinator = actor(Role::SPONSOR_COORDINATOR); $coordinatorStaff = staff($coordinator, 'active', 'non_teaching'); $coordinatorToken = token($coordinator);
$sponsorActor = actor(Role::SPONSOR); $sponsorToken = token($sponsorActor);
$secondSponsorActor = actor(Role::SPONSOR); $secondSponsorToken = token($secondSponsorActor);
$businessSponsor = Sponsor::create(['name' => 'Memory sponsor A', 'sponsor_type' => 'individual', 'user_id' => $sponsorActor->id,
    'phone' => 'private-business-contact', 'notes' => 'private-business-notes']);
$secondBusinessSponsor = Sponsor::create(['name' => 'Memory sponsor B', 'sponsor_type' => 'church', 'user_id' => $secondSponsorActor->id]);
$spIndividual = Sponsorship::create(['sponsor_id' => $businessSponsor->id, 'sponsorship_type' => 'individual', 'student_id' => $familyA,
    'status' => 'active', 'start_date' => '2026-01-01', 'created_by' => $coordinator->id]);
$spGroup = Sponsorship::create(['sponsor_id' => $businessSponsor->id, 'sponsorship_type' => 'group', 'status' => 'paused',
    'start_date' => '2026-01-01', 'created_by' => $coordinator->id]); $spGroup->students()->sync([$familyA, $familyB]);
$spSchool = Sponsorship::create(['sponsor_id' => $businessSponsor->id, 'sponsorship_type' => 'school_wide', 'program_name' => 'Memory school programme',
    'status' => 'active', 'start_date' => '2026-01-01', 'created_by' => $coordinator->id]);
$spForeign = Sponsorship::create(['sponsor_id' => $secondBusinessSponsor->id, 'sponsorship_type' => 'individual', 'student_id' => $familyForeign,
    'status' => 'ended', 'start_date' => '2026-01-01', 'created_by' => $coordinator->id]);
function coordinatorCall(string $method, string $path, ?string $issued = null, array $data = []): array {
    app('cache')->store('array')->flush(); return callApi($method, $path, $issued, $data);
}
function coordinatorData(string $path, string $issued): array {
    $response = coordinatorCall('GET', $path, $issued); status($response, 200);
    ensure(str_contains($response['response']->headers->get('Cache-Control'), 'no-store'), 'Operational response may be cached');
    return $response['body']['data'];
}
function assignmentBody(int $sponsor, string $type = 'individual'): array {
    return ['sponsor_id' => $sponsor, 'sponsorship_type' => $type, 'start_date' => '2026-10-01'];
}
check('Coordinator summary requires authentication and denies family teacher sponsor and student roles', function () use ($coordinatorToken) {
    status(coordinatorCall('GET', 'sponsorships/summary'), 401);
    foreach ([Role::PARENT_GUARDIAN, Role::SPONSOR, Role::STUDENT, Role::TEACHER] as $role) {
        $user = actor($role); if ($role === Role::TEACHER) staff($user);
        foreach (['sponsorships/summary', 'sponsors', 'sponsorships/learners'] as $path) status(coordinatorCall('GET', $path, token($user)), 403);
    }
    ensure(coordinatorData('sponsorships/summary', $coordinatorToken)['sponsors'] === 2, 'Valid non-teaching Coordinator denied');
});
check('inactive Coordinator cannot use existing bearer or browser session authentication', function () use ($coordinator, $coordinatorToken) {
    $cookie = sessionCookie($coordinator); $coordinator->update(['status' => 'inactive']);
    status(coordinatorCall('GET', 'sponsorships/summary', $coordinatorToken), 403, 'ACCOUNT_INACTIVE');
    status(callApi('GET', 'sponsorships/summary', null, [], $cookie, ['HTTP_ORIGIN' => 'http://localhost']), 403, 'ACCOUNT_INACTIVE');
    $coordinator->update(['status' => 'active']);
});
check('missing inactive and removed current Staff relationships deny all operations', function () use ($coordinatorStaff, $coordinatorToken, $businessSponsor) {
    foreach (['inactive', 'left'] as $state) {
        $coordinatorStaff->update(['status' => $state]);
        foreach (['sponsors', 'sponsorships', 'sponsorships/summary', 'sponsorships/learners?search=Memory'] as $path) status(coordinatorCall('GET', $path, $coordinatorToken), 403);
        status(coordinatorCall('POST', 'sponsors', $coordinatorToken, ['name' => 'Denied', 'sponsor_type' => 'individual']), 403);
        status(coordinatorCall('PATCH', 'sponsors/'.$businessSponsor->id, $coordinatorToken, ['name' => 'Denied']), 403);
    }
    $coordinatorStaff->update(['status' => 'active', 'user_id' => null]);
    status(coordinatorCall('GET', 'sponsorships/summary', $coordinatorToken), 403);
    $coordinatorStaff->update(['user_id' => $GLOBALS['coordinator']->id]);
    $missing = actor(Role::SPONSOR_COORDINATOR); status(coordinatorCall('GET', 'sponsors', token($missing)), 403);
});
check('summary reports only stored operations and honest relationship counts', function () use ($coordinatorToken) {
    $data = coordinatorData('sponsorships/summary', $coordinatorToken);
    ensure($data === ['sponsors' => 2, 'sponsorships' => 4, 'by_type' => ['individual' => 2, 'group' => 1, 'school_wide' => 1],
        'by_status' => ['active' => 2, 'paused' => 1, 'ended' => 1], 'individual_assignments' => 2, 'group_memberships' => 2], 'Incorrect summary');
    ensure(! preg_match('/student|staff|amount|balance|payment|health|contact/', json_encode($data)), 'Sensitive/invented aggregate');
});
check('sponsor directory has stable pagination search type filters and private allowlists', function () use ($coordinatorToken, $businessSponsor) {
    $first = coordinatorCall('GET', 'sponsors?per_page=1', $coordinatorToken); status($first, 200);
    ensure($first['body']['meta'] === ['page' => 1, 'per_page' => 1, 'total' => 2], 'Pagination contract');
    $second = coordinatorCall('GET', 'sponsors?per_page=1&page=2', $coordinatorToken); status($second, 200);
    ensure($first['body']['data'][0]['id'] !== $second['body']['data'][0]['id'], 'Unstable pagination');
    ensure(count(coordinatorData('sponsors?search=Memory%20sponsor%20A&sponsor_type=individual', $coordinatorToken)) === 1, 'Search or filter broken');
    $detail = coordinatorData('sponsors/'.$businessSponsor->id, $coordinatorToken);
    ensure(! isset($detail['user_id'], $detail['user'], $detail['created_at'], $detail['sponsorships']), 'Account or raw relationships exposed');
    ensure($detail['notes'] === 'private-business-notes', 'Authorized business notes missing');
});
check('invalid list and allocation filters reject unbounded pages and invalid statuses', function () use ($coordinatorToken) {
    foreach (['sponsors?per_page=101', 'sponsors?page=0', 'sponsors?sponsor_type=admin', 'sponsorships?status=cancelled', 'sponsorships/learners?per_page=1000', 'sponsorships?sponsor_id=-1'] as $path) status(coordinatorCall('GET', $path, $coordinatorToken), 422);
});
check('sponsor writes preserve duplicate validation and business/account separation', function () use ($coordinatorToken, $sponsorActor, $businessSponsor) {
    $data = ['name' => 'Memory business create', 'sponsor_type' => 'foundation', 'phone' => 'private-new-phone', 'notes' => 'private-new-notes', 'user_id' => $sponsorActor->id];
    $created = coordinatorCall('POST', 'sponsors', $coordinatorToken, $data); status($created, 201);
    $id = $created['body']['data']['id']; ensure(Sponsor::find($id)->user_id === null, 'Mass-assigned Portal account');
    status(coordinatorCall('POST', 'sponsors', $coordinatorToken, $data), 409, 'DUPLICATE_SPONSOR');
    status(coordinatorCall('PATCH', 'sponsors/'.$id, $coordinatorToken, ['name' => $businessSponsor->name, 'sponsor_type' => 'individual']), 409, 'DUPLICATE_SPONSOR');
    status(coordinatorCall('PATCH', 'sponsors/'.$id, $coordinatorToken, ['notes' => 'private-updated-notes']), 200);
    ensure(Sponsor::find($id)->notes === 'private-updated-notes', 'Update missing');
    $logs = DB::table('audit_logs')->where('entity_type', 'Sponsor')->where('entity_id', $id)->get();
    ensure($logs->count() === 2 && ! str_contains(json_encode($logs), 'private-'), 'Business content in audit');
});
check('leadership retains reads Administrator writes and no Staff requirement for Administrator', function () use ($businessSponsor, $adminToken) {
    foreach ([Role::HEAD_TEACHER, Role::DEPUTY_HEAD_TEACHER] as $role) {
        $user = actor($role); staff($user); $issued = token($user);
        status(coordinatorCall('GET', 'sponsors', $issued), 200); status(coordinatorCall('GET', 'sponsorships/summary', $issued), 200);
        status(coordinatorCall('POST', 'sponsors', $issued, ['name' => 'Denied', 'sponsor_type' => 'individual']), 403);
        status(coordinatorCall('PATCH', 'sponsorships/'.$GLOBALS['spGroup']->id, $issued, ['status' => 'active']), 403);
    }
    status(coordinatorCall('GET', 'sponsors', $adminToken), 200);
    status(coordinatorCall('PATCH', 'sponsors/'.$businessSponsor->id, $adminToken, ['contact_person' => 'Memory business contact']), 200);
});
check('allocation lookup requires deliberate search and returns only minimal active eligibility references', function () use ($coordinatorToken, $familyA, $familyB) {
    ensure(coordinatorData('sponsorships/learners', $coordinatorToken) === [], 'Unsearched school roster preload');
    ensure(coordinatorData('sponsorships/learners?search=M', $coordinatorToken) === [], 'One-character search enumerated roster');
    ensure(coordinatorData('sponsorships/learners?search=%25_', $coordinatorToken) === [], 'Wildcard bypass enumerated roster');
    $inactiveAdmission = DB::table('students')->where('id', $GLOBALS['exited'])->value('admission_no');
    ensure(coordinatorData('sponsorships/learners?search='.rawurlencode($inactiveAdmission), $coordinatorToken) === [], 'Inactive learner matched OR search');
    $rows = coordinatorData('sponsorships/learners?search=Memory&per_page=2', $coordinatorToken);
    ensure(count($rows) === 2, 'Allocation pagination');
    foreach ($rows as $row) ensure(array_keys($row) === ['id','admission_no','first_name','last_name','status','school_class','has_active_individual_sponsorship'], 'Allocation privacy');
    status(coordinatorCall('GET', 'students/'.$familyA, $coordinatorToken), 403);
    status(coordinatorCall('GET', 'students', $coordinatorToken), 403);
});
check('individual and group learner reads enforce the selected relationship and generic denials', function () use ($coordinatorToken, $spIndividual, $spGroup, $familyA, $familyB, $familyForeign) {
    ensure(coordinatorData('sponsorships/'.$spIndividual->id.'/learners/'.$familyA, $coordinatorToken)['id'] === $familyA, 'Individual scope');
    ensure(coordinatorData('sponsorships/'.$spGroup->id.'/learners/'.$familyB, $coordinatorToken)['id'] === $familyB, 'Group scope');
    foreach ([$familyB, $familyForeign, 999999] as $id) status(coordinatorCall('GET', 'sponsorships/'.$spIndividual->id.'/learners/'.$id, $coordinatorToken), 403, 'FORBIDDEN');
    status(coordinatorCall('GET', 'sponsorships/'.$spGroup->id.'/learners/'.$familyForeign, $coordinatorToken), 403);
    $spGroup->students()->detach($familyB);
    status(coordinatorCall('GET', 'sponsorships/'.$spGroup->id.'/learners/'.$familyB, $coordinatorToken), 403);
    $spGroup->students()->attach($familyB);
});
check('school-wide records ignore stray legacy relationships and never enumerate learners', function () use ($coordinatorToken, $spSchool, $familyA) {
    $spSchool->update(['student_id' => $familyA]); $spSchool->students()->attach($familyA);
    $data = coordinatorData('sponsorships/'.$spSchool->id, $coordinatorToken);
    ensure($data['student'] === null && $data['students'] === [], 'School-wide learner leak');
    status(coordinatorCall('GET', 'sponsorships/'.$spSchool->id.'/learners/'.$familyA, $coordinatorToken), 422, 'SPONSORSHIP_TYPE_UNSUPPORTED');
    $spSchool->update(['student_id' => null]); $spSchool->students()->detach();
});
check('operational learner responses exclude family health academic HR and authentication details', function () use ($coordinatorToken, $spGroup) {
    $data = coordinatorData('sponsorships/'.$spGroup->id, $coordinatorToken);
    foreach (['private-family', 'guardian', 'medical', 'date_of_birth', 'context_snapshot', 'created_by', 'username', 'pivot', 'password', 'staff_id'] as $secret) ensure(! str_contains(json_encode($data), $secret), 'Operational privacy leak: '.$secret);
});
check('sponsorship filters include explicit individual/group membership and exclude school-wide support', function () use ($coordinatorToken, $businessSponsor, $familyA, $spSchool) {
    $items = coordinatorData('sponsorships?student_id='.$familyA, $coordinatorToken);
    ensure(count($items) === 2 && ! in_array($spSchool->id, array_column($items,'id')), 'Student filter scope');
    ensure(count(coordinatorData('sponsorships?sponsor_id='.$businessSponsor->id.'&sponsorship_type=group&status=paused', $coordinatorToken)) === 1, 'Combined filter scope');
});
check('individual create rejects duplicate active assignments without side effects', function () use ($coordinatorToken, $businessSponsor, $familyA) {
    $before = Sponsorship::count(); $audit = DB::table('audit_logs')->count();
    status(coordinatorCall('POST', 'sponsorships', $coordinatorToken, assignmentBody($businessSponsor->id)+['student_id' => $familyA]), 409, 'ALREADY_SPONSORED');
    ensure(Sponsorship::count() === $before && DB::table('audit_logs')->count() === $audit, 'Conflict mutated domain/audit');
});
check('individual pause create resume conflict preserves one-active rule and immutable assignment', function () use ($coordinatorToken, $businessSponsor, $spIndividual, $familyA, $familyB) {
    status(coordinatorCall('PATCH', 'sponsorships/'.$spIndividual->id, $coordinatorToken, ['status' => 'paused']), 200);
    $second = coordinatorCall('POST', 'sponsorships', $coordinatorToken, assignmentBody($businessSponsor->id)+['student_id' => $familyA]); status($second, 201);
    status(coordinatorCall('PATCH', 'sponsorships/'.$spIndividual->id, $coordinatorToken, ['status' => 'active']), 409, 'ALREADY_SPONSORED');
    ensure($spIndividual->fresh()->status === 'paused', 'Resume conflict changed original');
    status(coordinatorCall('PATCH', 'sponsorships/'.$spIndividual->id, $coordinatorToken, ['status' => 'paused', 'student_id' => $familyB]), 422);
    status(coordinatorCall('PATCH', 'sponsorships/'.$second['body']['data']['id'], $coordinatorToken, ['status' => 'ended', 'end_date' => '2026-10-11', 'notes' => 'private-end-reason']), 200);
    status(coordinatorCall('PATCH', 'sponsorships/'.$spIndividual->id, $coordinatorToken, ['status' => 'active']), 200);
});
check('group create captures unique active memberships atomically and no new membership-edit contract', function () use ($coordinatorToken, $businessSponsor, $familyA, $familyB) {
    $body = assignmentBody($businessSponsor->id, 'group')+['student_ids' => [$familyA, $familyB]];
    $created = coordinatorCall('POST', 'sponsorships', $coordinatorToken, $body); status($created, 201); $id = $created['body']['data']['id'];
    ensure(Sponsorship::find($id)->students()->count() === 2, 'Incomplete group');
    $body['student_ids'] = [$familyA,$familyA]; status(coordinatorCall('POST', 'sponsorships', $coordinatorToken, $body), 422);
    status(coordinatorCall('PATCH', 'sponsorships/'.$id, $coordinatorToken, ['status' => 'paused','student_ids' => [$familyA]]), 422);
    ensure(Sponsorship::find($id)->students()->count() === 2, 'Unauthorized membership edit');
});
check('inactive and missing learners cannot be assigned and invalid targets cannot mix types', function () use ($coordinatorToken, $businessSponsor, $exited, $familyA) {
    foreach ([$exited,999999] as $id) status(coordinatorCall('POST', 'sponsorships', $coordinatorToken, assignmentBody($businessSponsor->id)+['student_id' => $id]), 422);
    status(coordinatorCall('POST', 'sponsorships', $coordinatorToken, assignmentBody($businessSponsor->id,'school_wide')+['program_name' => 'Memory','student_id' => $familyA]), 422);
    status(coordinatorCall('POST', 'sponsorships', $coordinatorToken, assignmentBody($businessSponsor->id,'group')+['student_ids' => [$familyA], 'program_name' => 'Forbidden']), 422);
});
check('school-wide create requires programme and creates no assignment or group pivot', function () use ($coordinatorToken, $businessSponsor) {
    status(coordinatorCall('POST', 'sponsorships', $coordinatorToken, assignmentBody($businessSponsor->id,'school_wide')), 422);
    $result = coordinatorCall('POST', 'sponsorships', $coordinatorToken, assignmentBody($businessSponsor->id,'school_wide')+['program_name' => 'Memory programme']); status($result, 201);
    $item = Sponsorship::find($result['body']['data']['id']); ensure($item->student_id === null && $item->students()->count() === 0, 'School-wide relationship invented');
});
check('ended sponsorships remain terminal and ending requires valid date and reason', function () use ($coordinatorToken, $spForeign, $spGroup) {
    status(coordinatorCall('PATCH', 'sponsorships/'.$spForeign->id, $coordinatorToken, ['status' => 'active']), 422, 'TERMINAL_STATE');
    status(coordinatorCall('PATCH', 'sponsorships/'.$spGroup->id, $coordinatorToken, ['status' => 'ended']), 422);
    status(coordinatorCall('PATCH', 'sponsorships/'.$spGroup->id, $coordinatorToken, ['status' => 'ended', 'end_date' => '2025-01-01', 'notes' => 'Memory']), 422);
});
check('assignment creator and audit claims cannot be impersonated and sensitive notes stay out of logs', function () use ($coordinatorToken, $coordinator, $businessSponsor, $familyB) {
    $created = coordinatorCall('POST', 'sponsorships', $coordinatorToken, assignmentBody($businessSponsor->id)+['student_id' => $familyB,'created_by' => $GLOBALS['admin']->id,'status' => 'ended','notes' => 'private-sponsorship-note']); status($created,201);
    $item = Sponsorship::find($created['body']['data']['id']); ensure($item->created_by === $coordinator->id && $item->status === 'active', 'Creator/status impersonation');
    ensure(! str_contains(json_encode(DB::table('audit_logs')->where('entity_type','Sponsorship')->where('entity_id',$item->id)->get()), 'private-'), 'Notes logged');
});
check('audit failure rolls back sponsorship group pivots status and sponsor writes', function () use ($coordinatorToken, $businessSponsor, $familyA, $spGroup) {
    $original = app(AuditLogger::class);
    app()->instance(AuditLogger::class, new class(Illuminate\Http\Request::create('/')) extends AuditLogger {
        public function log(string $action, ?string $entityType = null, ?int $entityId = null, array $details = []): App\Models\AuditLog { throw new RuntimeException('Memory audit failure'); }
    });
    try {
        $count = Sponsorship::count(); $pivots = DB::table('sponsorship_student')->count(); $sponsors = Sponsor::count();
        status(coordinatorCall('POST','sponsorships',$coordinatorToken,assignmentBody($businessSponsor->id,'group')+['student_ids'=>[$familyA]]),500);
        status(coordinatorCall('PATCH','sponsorships/'.$spGroup->id,$coordinatorToken,['status'=>'active']),500);
        status(coordinatorCall('POST','sponsors',$coordinatorToken,['name'=>'Rollback memory','sponsor_type'=>'general']),500);
        status(coordinatorCall('PATCH','sponsors/'.$businessSponsor->id,$coordinatorToken,['name'=>'Rollback edit']),500);
        ensure(Sponsorship::count()===$count && DB::table('sponsorship_student')->count()===$pivots && Sponsor::count()===$sponsors, 'Audit failure left partial writes');
        ensure($spGroup->fresh()->status==='paused' && $businessSponsor->fresh()->name==='Memory sponsor A', 'Audit failure changed stored state');
    } finally { app()->instance(AuditLogger::class,$original); }
});
check('Coordinator direct calls cannot cross operational academic HR system or Health boundaries', function () use ($coordinatorToken,$familyA) {
    foreach (['students','guardians','classes','subjects','class-subjects','teacher-assignments','academic/staff-options','timetable/by-class','staff','users','roles','teacher/context','attendance/my-classes','assessments/context','reports/school-statistics','health/profiles','health/safety/learners/'.$familyA,'audit-logs','portal/parent/children','portal/sponsor/sponsorships'] as $path) status(coordinatorCall('GET',$path,$coordinatorToken),403);
    status(coordinatorCall('POST','visitors',$coordinatorToken,[]),403);
    status(coordinatorCall('GET','visitors',$coordinatorToken),200);
});
check('Coordinator message sends fail closed while owned history and announcements remain authorized', function () use ($coordinatorToken,$coordinator,$secondSponsorActor) {
    status(coordinatorCall('POST','messages',$coordinatorToken,['recipient_id'=>$secondSponsorActor->id,'body'=>'Blocked']),403);
    $id=DB::table('messages')->insertGetId(['sender_id'=>$secondSponsorActor->id,'recipient_id'=>$coordinator->id,'body'=>'Memory owned','sent_at'=>'2026-10-11']);
    $other=DB::table('messages')->insertGetId(['sender_id'=>$secondSponsorActor->id,'recipient_id'=>$GLOBALS['familyParent']->id,'body'=>'Private other','sent_at'=>'2026-10-11']);
    $response=coordinatorCall('GET','messages',$coordinatorToken);status($response,200);
    ensure(in_array($id,array_column($response['body']['data'],'id')) && !in_array($other,array_column($response['body']['data'],'id')),'Message history scope');
    status(coordinatorCall('PATCH','messages/'.$other.'/read',$coordinatorToken),403);
    status(coordinatorCall('GET','announcements',$coordinatorToken),200);
});
check('Sponsor Portal remains isolated to owned individual/group records and rejects school-wide learner content', function () use ($sponsorToken,$secondSponsorToken,$spIndividual,$spGroup,$spSchool,$spForeign,$familyA,$familyB,$familyForeign,$familyForeignCard) {
    foreach (['sponsors','sponsorships','sponsorships/summary'] as $path) status(coordinatorCall('GET',$path,$sponsorToken),403);
    status(coordinatorCall('POST','sponsorships',$sponsorToken,[]),403);
    status(coordinatorCall('GET','portal/sponsor/sponsorships/'.$spForeign->id.'/learners',$sponsorToken),403);
    status(coordinatorCall('GET','portal/sponsor/sponsorships/'.$spIndividual->id.'/learners',$secondSponsorToken),403);
    status(coordinatorCall('GET','portal/sponsor/sponsorships/'.$spSchool->id.'/learners',$sponsorToken),422);
    status(coordinatorCall('GET','portal/sponsor/sponsorships/'.$spGroup->id.'/learners/'.$familyForeign.'/attendance',$sponsorToken),403);
    status(coordinatorCall('GET','portal/sponsor/sponsorships/'.$spGroup->id.'/learners/'.$familyB.'/attendance',$sponsorToken),200);
    status(coordinatorCall('GET','portal/sponsor/sponsorships/'.$spIndividual->id.'/report-cards/'.$familyForeignCard->id.'/download',$sponsorToken),403);
});
check('Parent and Teacher ownership remain independent of Coordinator sponsorship permissions', function () use ($familyToken,$familyA,$familyForeign,$familyForeignCard,$coordinatorToken,$classToken,$learnerE) {
    ensure(count(familyData('children',$familyToken))===2,'Family relationships changed');
    status(familyCall('GET','portal/parent/children/'.$familyForeign,$familyToken),403);
    status(familyCall('GET','portal/parent/children/'.$familyA.'/report-cards/'.$familyForeignCard->id.'/download',$familyToken),403);
    status(teacherCall('GET','students/'.$learnerE,$classToken),404);
    status(coordinatorCall('GET','sponsorships/summary',$classToken),403);
});
echo ($passed-$coordinatorStart).' Sponsor Coordinator checks passed; only guarded SQLite RAM fixtures used.'.PHP_EOL;
