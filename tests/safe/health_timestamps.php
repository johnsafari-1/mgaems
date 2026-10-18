<?php

// Real HTTP regressions and raw storage assertions on the fail-closed RAM database.
require __DIR__.'/health_safety.php';

use App\Models\SchoolHealthIncident;
use App\Rules\HealthInstant;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

$timestampStart = $passed;
Carbon::setTestNow(Carbon::parse('2026-10-10T12:00:00.654321+03:00'));
$timeStudent = learnerFixture($class);
$timePayload = incidentPayload($timeStudent, ['occurred_at' => '2026-10-09T12:00:00.123456+03:00']);
$timeIncident = created(healthCall('POST', 'incidents', $headToken, $timePayload));
$timePath = 'incidents/'.$timeIncident['id'];

check('explicit offsets persist the actual UTC instant and six fractional digits', function () use ($timeIncident, $timePath, $headToken, $timePayload) {
    $row = DB::table('school_health_incidents')->where('id', $timeIncident['id'])->first();
    ensure($row->occurred_at === '2026-10-09 09:00:00.123456', 'Raw UTC event storage');
    ensure($row->recorded_at === '2026-10-10 09:00:00.654321', 'Raw UTC server clock');
    ensure($row->created_at === $row->recorded_at && $row->updated_at === $row->recorded_at, 'UTC model timestamps');
    ensure(data(healthCall('GET', $timePath, $headToken))['occurred_at'] === '2026-10-09T09:00:00.123456Z', 'Explicit UTC response');
    foreach (['2026-10-09T09:00:00.123456Z', '2026-10-09T04:00:00.123456-05:00'] as $offset) {
        $payload = array_replace($timePayload, ['occurred_at' => $offset]);
        ensure(data(healthCall('POST', 'incidents', $headToken, $payload))['id'] === $timeIncident['id'], 'Equivalent-offset idempotent replay');
    }
    ensure(HealthInstant::parse('2026-10-09T12:00:00+03:00')->eq(HealthInstant::parse('2026-10-09T09:00:00Z')), 'Nairobi noon equals UTC nine');
});

check('malformed and ambiguous event inputs fail before writing health records', function () use ($timeStudent, $headToken) {
    $before = DB::table('school_health_incidents')->count();
    foreach (['2026-10-09 12:00:00', '2026-10-09T12:00:00', 'yesterday', '2026-02-30T09:00:00Z',
        '2026-10-09T24:00:00Z', '2026-10-09T09:00:60Z', '2026-10-09T09:00:00-00:00',
        '2026-10-09T09:00:00+14:01', '2026-10-09T09:00:00+03:60', '2026-10-09T09:00:00.1234567Z',
        '0999-12-31T23:59:59Z', '1000-01-01T00:00:00+03:00', '9999-12-31T23:59:59-01:00',
        '2026-10-10T09:00:00.654322Z'] as $invalid) {
        $response = healthCall('POST', 'incidents', $headToken, incidentPayload($timeStudent, ['occurred_at' => $invalid]));
        status($response, 422); ensure(isset($response['body']['errors']['occurred_at']), 'Field validation error');
    }
    ensure(DB::table('school_health_incidents')->count() === $before, 'No malformed writes');
});

check('actions notifications referrals and follow-ups retain UTC instants and chronology', function () use ($timeIncident, $timePath, $headToken) {
    $payload = ['request_id' => (string) Str::uuid(), 'expected_incident_revision' => 1, 'action_type' => 'observation',
        'action_at' => '2026-10-09T04:00:00.123455-05:00', 'action' => 'RAM chronology fixture'];
    status(healthCall('POST', $timePath.'/actions', $headToken, $payload), 422);
    $payload['action_at'] = '2026-10-09T04:00:00.123457-05:00';
    $action = created(healthCall('POST', $timePath.'/actions', $headToken, $payload));
    ensure(DB::table('health_incident_actions')->where('id', $action['id'])->value('action_at') === '2026-10-09 09:00:00.123457', 'Action raw UTC');
    // Same-second correction must not slip past a query that truncates fractions.
    status(healthCall('PATCH', $timePath, $headToken, correction(2, ['occurred_at' => '2026-10-09T09:00:00.123458Z'])), 422);
    $notification = created(healthCall('POST', $timePath.'/notifications', $headToken, [
        'request_id' => (string) Str::uuid(), 'expected_incident_revision' => 2, 'channel' => 'phone',
        'attempted_at' => '2026-10-09T12:05:00.345678+03:00', 'outcome' => 'no_answer']));
    ensure(DB::table('health_guardian_notifications')->where('id', $notification['id'])->value('attempted_at') === '2026-10-09 09:05:00.345678', 'Notification raw UTC');
    ensure($notification['contact_snapshot']['captured_at'] === '2026-10-10T09:00:00.654321Z', 'Snapshot capture instant');
    $referral = created(healthCall('POST', $timePath.'/referrals', $headToken, [
        'request_id' => (string) Str::uuid(), 'expected_incident_revision' => 3, 'referred_at' => '2026-10-09T04:10:00.456789-05:00',
        'reason' => 'RAM referral fixture', 'follow_up_status' => 'pending']));
    ensure(DB::table('health_external_referrals')->where('id', $referral['id'])->value('referred_at') === '2026-10-09 09:10:00.456789', 'Referral raw UTC');
    $follow = data(healthCall('PATCH', $timePath.'/referrals/'.$referral['id'], $headToken,
        correction(1, ['expected_incident_revision' => 4, 'follow_up_status' => 'completed'])));
    ensure($follow['referred_at'] === '2026-10-09T09:10:00.456789Z', 'Merged corrections preserve fractions and instant');
    $followAction = created(healthCall('POST', $timePath.'/actions', $headToken, [
        'request_id' => (string) Str::uuid(), 'expected_incident_revision' => 5, 'action_type' => 'follow_up',
        'action_at' => '2026-10-09T12:20:00.567890+03:00', 'action' => 'RAM follow-up fixture']));
    ensure($followAction['action_at'] === '2026-10-09T09:20:00.567890Z', 'Follow-up action instant');
    ensure(SchoolHealthIncident::find($timeIncident['id'])->occurred_at->format('u') === '123456', 'Rejected correction leaves event intact');
});

check('profile review alert verification revisions and access logs share UTC recording clock', function () use ($timeStudent, $headToken) {
    $profile = profileFixture($timeStudent, $headToken);
    $profile = data(healthCall('POST', 'profiles/'.$profile['id'].'/review', $headToken, correction(1)));
    $alert = created(healthCall('POST', 'profiles/'.$profile['id'].'/alerts', $headToken,
        alertPayload(['starts_on' => '2026-10-10', 'ends_on' => '2026-10-10'])));
    $alert = data(healthCall('POST', 'profiles/'.$profile['id'].'/alerts/'.$alert['id'].'/verify', $headToken,
        correction(1, ['verification_basis' => 'RAM verified source'])));
    foreach (['learner_health_profiles' => ['id' => $profile['id'], 'field' => 'reviewed_at'],
        'health_safety_alerts' => ['id' => $alert['id'], 'field' => 'verified_at']] as $table => $key) {
        ensure(DB::table($table)->where('id', $key['id'])->value($key['field']) === '2026-10-10 09:00:00.654321', 'Metadata raw UTC');
    }
    ensure(DB::table('health_safety_alerts')->where('id', $alert['id'])->value('starts_on') === '2026-10-10', 'Calendar date remains literal');
    foreach (['health_record_revisions', 'health_access_logs'] as $table) {
        ensure(DB::table($table)->orderByDesc('id')->value('recorded_at') === '2026-10-10 09:00:00.654321', 'History raw UTC');
    }
    $history = data(healthCall('GET', 'profiles/'.$profile['id'].'/revisions', $headToken));
    ensure($history[0]['recorded_at'] === '2026-10-10T09:00:00.654321Z', 'Revision response UTC');
    ensure($profile['reviewed_at'] === $history[0]['recorded_at'] && $alert['verified_at'] === $profile['reviewed_at'], 'Consistent metadata instants');
});

check('school placement and term dates use Nairobi at UTC midnight boundaries including corrections', function () use ($class, $headToken, $term) {
    $learner = learnerFixture($class);
    DB::table('promotions_transfers')->insert(['student_id' => $learner, 'type' => 'promotion', 'to_class_id' => $class,
        'term_id' => $term, 'effective_date' => '2026-10-08', 'recorded_by' => $GLOBALS['head']->id]);
    $incident = created(healthCall('POST', 'incidents', $headToken,
        incidentPayload($learner, ['occurred_at' => '2026-10-08T22:00:00Z'])));
    ensure($incident['historical_class_id'] === $class, 'Nairobi October nine uses prior-day placement');
    $same = data(healthCall('PATCH', 'incidents/'.$incident['id'], $headToken,
        correction(1, ['occurred_at' => '2026-10-09T00:30:00Z'])));
    ensure($same['historical_class_id'] === $class, 'Same Nairobi date preserves context');
    $prior = data(healthCall('PATCH', 'incidents/'.$incident['id'], $headToken,
        correction(2, ['occurred_at' => '2026-10-08T20:59:59Z'])));
    ensure($prior['historical_class_id'] === null, 'Nairobi placement-day correction recaptures unknown context');
    $year = DB::table('academic_years')->insertGetId(['name' => 'RAM historical boundary year', 'start_date' => '1965-01-01', 'end_date' => '1965-12-31', 'is_current' => false]);
    $boundaryTerm = DB::table('terms')->insertGetId(['academic_year_id' => $year, 'name' => 'RAM historical boundary term',
        'start_date' => '1965-10-09', 'end_date' => '1965-10-10', 'is_current' => false]);
    $historical = created(healthCall('POST', 'incidents', $headToken,
        incidentPayload($learner, ['occurred_at' => '1965-10-08T22:00:00Z'])));
    ensure($historical['historical_term_id'] === $boundaryTerm, 'Historical term starts on Nairobi date');
});

check('same-day safety alerts remain active without UTC conversion of school calendar dates', function () use ($headToken) {
    $teacher = actor(App\Models\Role::TEACHER); $staff = staff($teacher);
    $class = DB::table('classes')->insertGetId(['name' => 'RAM same-day calendar class', 'level' => 'primary', 'sequence' => 45, 'class_teacher_id' => $staff->id]);
    $learner = learnerFixture($class); $profile = profileFixture($learner, $headToken);
    $alert = created(healthCall('POST', 'profiles/'.$profile['id'].'/alerts', $headToken,
        alertPayload(['starts_on' => '2026-10-10', 'ends_on' => '2026-10-10'])));
    $response = data(healthCall('GET', 'safety/learners/'.$learner, token($teacher)));
    ensure(count($response['alerts']) === 1 && $response['alerts'][0]['id'] === $alert['id'], 'School date inclusive start and end');
});

check('historical and post-2038 instants survive storage and supported UTC range is enforced', function () use ($timeStudent, $headToken) {
    foreach (['1960-01-01T12:00:00+03:00' => '1960-01-01 09:00:00.000000',
        '1000-01-01T00:00:00Z' => '1000-01-01 00:00:00.000000'] as $input => $stored) {
        $incident = created(healthCall('POST', 'incidents', $headToken, incidentPayload($timeStudent, ['occurred_at' => $input])));
        ensure(DB::table('school_health_incidents')->where('id', $incident['id'])->value('occurred_at') === $stored, 'Historical raw instant');
    }
    Carbon::setTestNow(Carbon::parse('2040-02-02T12:00:00+03:00'));
    $incident = created(healthCall('POST', 'incidents', $headToken,
        incidentPayload($timeStudent, ['occurred_at' => '2040-02-01T12:00:00.123456+03:00'])));
    ensure(DB::table('school_health_incidents')->where('id', $incident['id'])->value('occurred_at') === '2040-02-01 09:00:00.123456', 'Post-2038 raw instant');
    ensure(HealthInstant::parse('9999-12-31T23:59:59.999999Z') !== null, 'Upper DATETIME bound parses');
    ensure(HealthInstant::parse('9999-12-31T23:59:59-01:00') === null, 'Offset cannot cross upper bound');
    ensure(Validator::make(['time' => '2040-02-03T09:00:00Z'], ['time' => (new App\Services\HealthInput)->time()])->fails(), 'Future rejection survives extended range');
    Carbon::setTestNow();
});

echo 'Timestamp checks passed: '.($passed - $timestampStart).PHP_EOL;
