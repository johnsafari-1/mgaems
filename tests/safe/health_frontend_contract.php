<?php

// Real HTTP contract checks on the existing guarded SQLite-memory harness only.
require __DIR__.'/health_timestamps.php';

use App\Models\Role;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

$contractStart = $passed;
$contractHead = actor(Role::HEAD_TEACHER); staff($contractHead); $contractToken = token($contractHead);
$contractStudent = learnerFixture($class);

check('frontend Health route inventory has 34 authorized concrete definitions and no delete capability', function () {
    $routes = collect(app('router')->getRoutes()->getRoutes())->filter(fn ($route) => str_starts_with($route->uri(), 'api/v1/health/'));
    ensure($routes->count() === 34, 'Health route inventory changed');
    foreach ($routes as $route) {
        ensure(in_array('auth:sanctum', $route->gatherMiddleware(), true), 'Health route lacks shared authentication');
        ensure(in_array('health.access:manage', $route->gatherMiddleware(), true) || in_array('health.access:safety', $route->gatherMiddleware(), true), 'Health route lacks operational authorization');
        ensure(! in_array('DELETE', $route->methods(), true), 'Unexpected Health deletion');
    }
});

check('leadership learner lookup returns an authorized minimal summary and preserves legacy separation', function () use ($contractStudent, $contractToken) {
    app('cache')->store('array')->flush();
    $response = callApi('GET', 'students?per_page=20&page=1', $contractToken); status($response, 200);
    ensure(isset($response['body']['meta']['total'], $response['body']['meta']['per_page']), 'Learner paging contract');
    foreach ($response['body']['data'] as $row) {
        ensure(isset($row['id'], $row['first_name'], $row['last_name'], $row['admission_no']), 'Learner selection identity');
        ensure(! isset($row['medical_info'], $row['guardians']), 'Lookup must not return medical/contact payloads');
    }
});

check('frontend profile alert and explicit review bodies work against real Health controllers', function () use ($contractStudent, $contractToken) {
    $profile = created(healthCall('POST', 'profiles', $contractToken, ['student_id' => $contractStudent, 'allergy_information_state' => 'unknown',
        'allergy_information' => null, 'emergency_information' => null, 'support_information' => null, 'source' => 'guardian_report', 'source_reference' => null]));
    ensure($profile['allergy_information_state'] === 'unknown' && $profile['allergy_information'] === null, 'Unknown remains distinct');
    $reviewed = data(healthCall('POST', 'profiles/'.$profile['id'].'/review', $contractToken, ['expected_revision' => 1, 'correction_reason' => 'Fixture human review']));
    ensure($reviewed['revision_number'] === 2 && $reviewed['reviewed_at'] !== null, 'Explicit review revision');
    $alert = created(healthCall('POST', 'profiles/'.$profile['id'].'/alerts', $contractToken, ['alert_type' => 'activity_precaution',
        'description' => 'Fixture actionable school instruction', 'emergency_instructions' => null, 'is_active' => false,
        'source' => 'staff_observation', 'source_reference' => null, 'starts_on' => '2026-10-01', 'ends_on' => null, 'request_id' => (string) Str::uuid()]));
    $activated = data(healthCall('PATCH', 'profiles/'.$profile['id'].'/alerts/'.$alert['id'], $contractToken,
        ['expected_revision' => 1, 'correction_reason' => 'Fixture operational publication', 'is_active' => true]));
    ensure($activated['is_active'] === true && $activated['revision_number'] === 2 && $activated['verified_at'] === null, 'Publication does not invent verification');
    $verified = data(healthCall('POST', 'profiles/'.$profile['id'].'/alerts/'.$alert['id'].'/verify', $contractToken,
        ['expected_revision' => 2, 'correction_reason' => 'Fixture verification review', 'verification_basis' => 'Fixture known source']));
    ensure($verified['verified_at'] !== null && $verified['revision_number'] === 3, 'Operational verification contract');
    ensure(count(data(healthCall('GET', 'profiles/'.$profile['id'].'/alerts/'.$alert['id'].'/revisions', $contractToken))) === 3, 'Restricted alert history');
});

check('frontend incident and child bodies preserve UTC microseconds and aggregate revision integrity', function () use ($contractStudent, $contractToken) {
    $incident = created(healthCall('POST', 'incidents', $contractToken, ['student_id' => $contractStudent, 'occurred_at' => '2026-10-09T10:00:00.123456+03:00',
        'location' => 'Fixture school location', 'category' => 'injury', 'information_basis' => 'observed', 'observations' => 'Fixture observed facts', 'request_id' => (string) Str::uuid()]));
    ensure($incident['occurred_at'] === '2026-10-09T07:00:00.123456Z', 'Actual EAT input becomes exact UTC');
    $path = 'incidents/'.$incident['id'];
    $action = created(healthCall('POST', $path.'/actions', $contractToken, ['action_type' => 'first_aid', 'action_at' => '2026-10-09T10:10:00.654321+03:00',
        'action' => 'Fixture actual first aid', 'result' => null, 'status_after' => null, 'disposition_after' => null, 'request_id' => (string) Str::uuid(), 'expected_incident_revision' => 1]));
    ensure($action['action_at'] === '2026-10-09T07:10:00.654321Z' && data(healthCall('GET', $path, $contractToken))['revision_number'] === 2, 'Action time and incident epoch');
    $guardian = DB::table('guardians')->insertGetId(['student_id' => $contractStudent, 'full_name' => 'Fixture contact', 'relationship' => 'parent']);
    $notification = created(healthCall('POST', $path.'/notifications', $contractToken, ['guardian_id' => $guardian, 'channel' => 'phone',
        'attempted_at' => '2026-10-09T10:20:00+03:00', 'outcome' => 'no_answer', 'contact_used' => 'fixture actual contact',
        'request_id' => (string) Str::uuid(), 'expected_incident_revision' => 2]));
    ensure($notification['contact_snapshot']['contact_used'] === 'fixture actual contact' && data(healthCall('GET', $path, $contractToken))['revision_number'] === 3, 'Historical actual contact and parent revision');
    $referral = created(healthCall('POST', $path.'/referrals', $contractToken, ['referred_at' => '2026-10-09T10:30:00+03:00', 'reason' => 'Fixture school handover',
        'destination' => null, 'authorization_details' => null, 'handover_details' => null, 'follow_up_status' => 'pending',
        'request_id' => (string) Str::uuid(), 'expected_incident_revision' => 3]));
    $parent = data(healthCall('GET', $path, $contractToken)); ensure($parent['revision_number'] === 4, 'Referral parent revision');
    $changed = data(healthCall('PATCH', $path.'/referrals/'.$referral['id'], $contractToken, ['follow_up_status' => 'completed',
        'expected_revision' => 1, 'expected_incident_revision' => 4, 'correction_reason' => 'Fixture confirmed follow-up']));
    ensure($changed['revision_number'] === 2 && data(healthCall('GET', $path, $contractToken))['revision_number'] === 5, 'Correction advances child and parent');
    status(healthCall('PATCH', $path.'/referrals/'.$referral['id'], $contractToken, ['follow_up_status' => 'pending', 'expected_revision' => 1,
        'expected_incident_revision' => 4, 'correction_reason' => 'Fixture stale edit']), 409);
});

echo 'Health frontend API contract checks passed: '.($passed - $contractStart).'; total memory checks: '.$passed.PHP_EOL;
