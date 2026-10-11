<?php

// Real HTTP routes against the guarded, sole SQLite :memory: connection.
// No dotenv, development database, persistent fixtures or migration commands.
require __DIR__.'/authorization.php';

use App\Models\Role;
use Carbon\Carbon;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

$start = $passed;
Carbon::setTestNow(Carbon::parse('2026-10-11 12:00:00', 'Africa/Nairobi'));
Schema::create('announcements', function (Blueprint $table) {
    $table->id(); $table->foreignId('published_by')->constrained('users');
    $table->string('title', 200); $table->text('body'); $table->string('audience');
    $table->timestamp('published_at')->useCurrent();
});
Schema::table('academic_years', function (Blueprint $table) {
    $table->date('end_date')->nullable(); $table->boolean('is_current')->default(false);
});

function announcementCall(string $method, string $path, ?string $token = null, array $data = [], array $cookies = []): array {
    app('cache')->store('array')->flush();
    return callApi($method, $path, $token, $data, $cookies, $cookies ? ['HTTP_ORIGIN' => 'http://localhost'] : []);
}
function announcementPayload(string $audience = 'school_wide', array $extra = []): array {
    return $extra + ['title' => 'Memory announcement', 'body' => 'private-announcement-body', 'audience' => $audience];
}

$roles = [Role::SYSTEM_ADMIN, Role::HEAD_TEACHER, Role::DEPUTY_HEAD_TEACHER,
    Role::TEACHER, Role::SPONSOR_COORDINATOR, Role::PARENT_GUARDIAN, Role::SPONSOR, Role::STUDENT];
$actors = $tokens = $staffRecords = [];
foreach ($roles as $role) {
    $actors[$role] = actor($role);
    if (in_array($role, Role::STAFF_ROLES, true)) $staffRecords[$role] = staff($actors[$role]);
    $tokens[$role] = token($actors[$role]);
}
$teacher = $actors[Role::TEACHER]; $teacherToken = $tokens[Role::TEACHER];
$class = DB::table('classes')->insertGetId(['name' => 'Memory assigned class', 'level' => 'primary', 'sequence' => 80,
    'class_teacher_id' => $staffRecords[Role::TEACHER]->id]);
$unrelatedClass = DB::table('classes')->insertGetId(['name' => 'Memory unrelated class', 'level' => 'primary', 'sequence' => 81]);
$year = DB::table('academic_years')->insertGetId(['name' => 'Memory current year', 'start_date' => '2026-01-01',
    'end_date' => '2026-12-31', 'is_current' => true]);
$term = DB::table('terms')->insertGetId(['academic_year_id' => $year, 'name' => 'Memory current term',
    'start_date' => '2026-10-01', 'end_date' => '2026-12-01', 'is_current' => true]);
$subject = DB::table('subjects')->insertGetId(['name' => 'Memory subject', 'code' => 'MEMANN', 'status' => 'active']);
DB::table('class_subjects')->insert(['class_id' => $class, 'subject_id' => $subject]);
DB::table('class_subject_teacher')->insert(['class_id' => $class, 'subject_id' => $subject,
    'term_id' => $term, 'staff_id' => $staffRecords[Role::TEACHER]->id]);

check('anonymous reads and publication require authentication', function () {
    status(announcementCall('GET', 'announcements'), 401);
    status(announcementCall('POST', 'announcements', null, announcementPayload()), 401);
});
check('existing page API role gates agree with navigation eligibility for all eight roles', function () use ($actors) {
    $leaders = [Role::SYSTEM_ADMIN, Role::HEAD_TEACHER, Role::DEPUTY_HEAD_TEACHER];
    $teaching = [...$leaders, Role::TEACHER];
    $endpoints = [
        'students' => $teaching, 'guardians/accounts' => $leaders,
        'teacher-assignments' => $leaders, 'attendance/my-classes' => $teaching,
        'assessments/context' => $teaching, 'sponsorships' => [...$leaders, Role::SPONSOR_COORDINATOR],
        'staff' => $leaders, 'visitors' => [...$leaders, Role::SPONSOR_COORDINATOR],
        'reports/school-statistics' => $leaders, 'audit-logs' => [Role::SYSTEM_ADMIN, Role::HEAD_TEACHER],
        'portal/parent/children' => [Role::PARENT_GUARDIAN], 'portal/sponsor/sponsorships' => [Role::SPONSOR],
        'announcements' => array_keys($actors), 'messages' => array_values(array_diff(array_keys($actors), [Role::STUDENT])),
    ];
    foreach ($endpoints as $endpoint => $allowed) {
        $route = collect(app('router')->getRoutes())->first(fn ($route) => $route->uri() === 'api/v1/'.$endpoint
            && in_array('GET', $route->methods(), true));
        ensure($route !== null, 'Missing destination API '.$endpoint);
        ensure(in_array('auth:sanctum', $route->gatherMiddleware(), true), 'Missing authentication '.$endpoint);
        $gate = collect($route->gatherMiddleware())->first(fn ($entry) => str_starts_with($entry, 'role:'));
        ensure($gate !== null, 'Missing role gate '.$endpoint);
        foreach ($actors as $role => $user) {
            $request = Illuminate\Http\Request::create('/api/v1/'.$endpoint);
            $request->setUserResolver(fn () => $user);
            $response = (new App\Http\Middleware\EnsureRole)->handle($request, fn () => response()->json(['data' => []]),
                ...explode(',', substr($gate, 5)));
            ensure($response->getStatusCode() === (in_array($role, $allowed, true) ? 200 : 403),
                'Unexpected destination role gate '.$endpoint.' / '.$role);
        }
    }
});
check('even an actively assigned Teacher cannot publish to any unscoped audience', function () use ($teacherToken, $class, $unrelatedClass, $actors) {
    $before = DB::table('announcements')->count(); $audit = DB::table('audit_logs')->count();
    foreach (['school_wide', 'staff', 'parents', 'sponsors', 'class'] as $audience) {
        foreach ([$class, $unrelatedClass] as $target) {
            status(announcementCall('POST', 'announcements', $teacherToken, announcementPayload($audience,
                ['class_id' => $target, 'published_by' => $actors[Role::SYSTEM_ADMIN]->id,
                    'role' => Role::HEAD_TEACHER, 'authorized' => true])), 403, 'FORBIDDEN');
        }
    }
    status(announcementCall('POST', 'announcements', $teacherToken, announcementPayload()), 403, 'FORBIDDEN');
    ensure(DB::table('announcements')->count() === $before && DB::table('audit_logs')->count() === $audit,
        'Denied publication changed records or audit logs');
});
check('Teacher without assignment, without Staff, or with non-teaching/inactive Staff cannot publish', function () {
    foreach (['unassigned', 'missing', 'non-teaching', 'inactive'] as $eligibility) {
        $user = actor(Role::TEACHER);
        if ($eligibility !== 'missing') staff($user, $eligibility === 'inactive' ? 'inactive' : 'active',
            $eligibility === 'non-teaching' ? 'non_teaching' : 'teaching');
        status(announcementCall('POST', 'announcements', token($user), announcementPayload('class', ['class_id' => 1])), 403, 'FORBIDDEN');
    }
});
check('Parent Sponsor and Student cannot publish through direct API calls', function () use ($tokens) {
    foreach ([Role::PARENT_GUARDIAN, Role::SPONSOR, Role::STUDENT] as $role) {
        status(announcementCall('POST', 'announcements', $tokens[$role], announcementPayload()), 403, 'FORBIDDEN');
    }
});
check('authorized leadership and Coordinator retain every existing non-class publication audience', function () use ($tokens, $actors) {
    foreach ([Role::SYSTEM_ADMIN, Role::HEAD_TEACHER, Role::DEPUTY_HEAD_TEACHER, Role::SPONSOR_COORDINATOR] as $role) {
        foreach (['school_wide', 'staff', 'parents', 'sponsors'] as $audience) {
            $response = announcementCall('POST', 'announcements', $tokens[$role], announcementPayload($audience));
            status($response, 201);
            ensure($response['body']['data']['published_by'] === $actors[$role]->id
                && $response['body']['data']['audience'] === $audience, 'Publisher identity or audience changed');
        }
    }
});
check('authorized publishers cannot create unscoped class announcements or forge stored identity', function () use ($tokens, $class) {
    $before = DB::table('announcements')->count();
    foreach ([Role::SYSTEM_ADMIN, Role::HEAD_TEACHER, Role::DEPUTY_HEAD_TEACHER, Role::SPONSOR_COORDINATOR] as $role) {
        status(announcementCall('POST', 'announcements', $tokens[$role], announcementPayload('class')), 422);
        foreach (['class_id' => $class, 'published_by' => 1, 'published_at' => '2000-01-01'] as $field => $value) {
            $response = announcementCall('POST', 'announcements', $tokens[$role], announcementPayload('school_wide', [$field => $value]));
            status($response, 422); ensure(isset($response['body']['errors'][$field]), 'Missing prohibited-field error');
        }
    }
    ensure(DB::table('announcements')->count() === $before, 'Invalid publication changed stored records');
});
check('empty prohibited identity claims cannot override the authenticated publisher', function () use ($tokens, $actors) {
    $response = announcementCall('POST', 'announcements', $tokens[Role::HEAD_TEACHER], announcementPayload('staff',
        ['published_by' => null, 'published_at' => null, 'class_id' => null]));
    status($response, 201);
    ensure($response['body']['data']['published_by'] === $actors[Role::HEAD_TEACHER]->id, 'Empty identity claim replaced publisher');
});
check('all eight roles receive only their exact role audience and no legacy class rows', function () use ($tokens, $actors) {
    DB::table('announcements')->insert(['published_by' => $actors[Role::SYSTEM_ADMIN]->id,
        'title' => 'Unscoped legacy class', 'body' => 'legacy-class-secret', 'audience' => 'class']);
    foreach ($tokens as $role => $issued) {
        $response = announcementCall('GET', 'announcements', $issued); status($response, 200);
        $allowed = ['school_wide'];
        if ($role === Role::PARENT_GUARDIAN) $allowed[] = 'parents';
        elseif ($role === Role::SPONSOR) $allowed[] = 'sponsors';
        elseif ($role !== Role::STUDENT) $allowed[] = 'staff';
        $expected = DB::table('announcements')->whereIn('audience', $allowed)->pluck('id')->sort()->values()->all();
        $actual = array_column($response['body']['data'], 'id'); sort($actual);
        ensure($actual === $expected, 'Wrong recipient set for '.$role);
        ensure(! str_contains(json_encode($response['body']), 'legacy-class-secret'), 'Legacy class content leaked');
    }
});
check('Staff audiences require active employment and Teacher teaching eligibility on every read', function () use ($tokens, $staffRecords) {
    foreach (Role::STAFF_ROLES as $role) {
        $staffRecords[$role]->update(['status' => 'inactive']);
        status(announcementCall('GET', 'announcements', $tokens[$role]), 403, 'FORBIDDEN');
        status(announcementCall('POST', 'announcements', $tokens[$role], announcementPayload()), 403, 'FORBIDDEN');
        $staffRecords[$role]->update(['status' => 'active']);
        status(announcementCall('GET', 'announcements', $tokens[$role]), 200);
    }
    $staffRecords[Role::TEACHER]->update(['staff_type' => 'non_teaching']);
    status(announcementCall('GET', 'announcements', $tokens[Role::TEACHER]), 403, 'FORBIDDEN');
    $staffRecords[Role::TEACHER]->update(['staff_type' => 'teaching']);
    foreach (Role::STAFF_ROLES as $role) status(announcementCall('GET', 'announcements', token(actor($role))), 403, 'FORBIDDEN');
});
check('inactive and locked bearer accounts cannot read or publish announcements', function () use ($actors, $tokens) {
    $user = $actors[Role::SYSTEM_ADMIN];
    foreach (['inactive', 'locked'] as $state) {
        DB::table('users')->where('id', $user->id)->update(['status' => $state]);
        status(announcementCall('GET', 'announcements', $tokens[Role::SYSTEM_ADMIN]), 403, 'ACCOUNT_INACTIVE');
        status(announcementCall('POST', 'announcements', $tokens[Role::SYSTEM_ADMIN], announcementPayload()), 403, 'ACCOUNT_INACTIVE');
    }
    DB::table('users')->where('id', $user->id)->update(['status' => 'active']);
});
check('cookie authentication observes Teacher publication denial and current Staff read eligibility', function () use ($teacher, $staffRecords) {
    $cookie = sessionCookie($teacher);
    status(announcementCall('GET', 'announcements', null, [], $cookie), 200);
    status(announcementCall('POST', 'announcements', null, announcementPayload(), $cookie), 403, 'FORBIDDEN');
    $staffRecords[Role::TEACHER]->update(['status' => 'inactive']);
    status(announcementCall('GET', 'announcements', null, [], $cookie), 403, 'FORBIDDEN');
    $staffRecords[Role::TEACHER]->update(['status' => 'active']);
});
check('no update or delete route permits Teacher to change identity audience or another publication', function () use ($teacherToken, $actors) {
    $row = DB::table('announcements')->first(); $before = (array) $row;
    foreach (['PUT', 'PATCH', 'DELETE'] as $method) {
        status(announcementCall($method, 'announcements/'.$row->id, $teacherToken,
            announcementPayload('school_wide', ['published_by' => $actors[Role::SYSTEM_ADMIN]->id])), 404);
        status(announcementCall($method, 'announcements', $teacherToken, announcementPayload()), 405);
    }
    ensure((array) DB::table('announcements')->where('id', $row->id)->first() === $before, 'Announcement mutated');
    foreach (app('router')->getRoutes() as $route) {
        if (! str_starts_with($route->uri(), 'api/v1/announcements')) continue;
        ensure(array_diff($route->methods(), ['GET', 'HEAD', 'POST']) === [], 'Unexpected update/delete route');
    }
});
check('audits retain only publication metadata and never announcement content', function () {
    $logs = DB::table('audit_logs')->where('action', 'PUBLISH_ANNOUNCEMENT')->get();
    ensure($logs->count() === 17, 'Expected one log for each permitted publication');
    foreach ($logs as $log) {
        $details = json_decode($log->details, true);
        ensure(array_keys($details) === ['audience'], 'Unexpected audit content');
        ensure(! str_contains($log->details, 'private-announcement-body'), 'Announcement body logged');
    }
});

echo 'Announcement checks passed: '.($passed - $start).PHP_EOL;
