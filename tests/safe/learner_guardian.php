<?php

// Standalone integration checks. No dotenv, PHPUnit configuration, migrations,
// development connection, or persistent database is used by this runner.
require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->bootstrapWith([Illuminate\Foundation\Bootstrap\LoadConfiguration::class]);
$app['config']->set('database.default', 'learner_guardian_memory');
$app['config']->set('database.connections', ['learner_guardian_memory' => [
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

use App\Http\Controllers\Api\GuardianController;
use App\Http\Controllers\Api\ParentPortalController;
use App\Http\Controllers\Api\SponsorshipController;
use App\Http\Controllers\Api\StudentController;
use App\Http\Middleware\EnsureRole;
use App\Models\Guardian;
use App\Models\Role;
use App\Models\Student;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

$connection = DB::connection();
if ($connection->getDriverName() !== 'sqlite' || $connection->getDatabaseName() !== ':memory:') {
    throw new RuntimeException('Refusing to run outside an explicit in-memory SQLite connection.');
}
Schema::create('roles', function (Blueprint $table) { $table->id(); $table->string('name'); });
Schema::create('users', function (Blueprint $table) {
    $table->id(); $table->string('username')->unique(); $table->string('email')->unique(); $table->string('password_hash');
    $table->foreignId('role_id')->constrained(); $table->string('status'); $table->timestamps();
});
Schema::create('classes', function (Blueprint $table) { $table->id(); $table->string('name'); $table->string('level')->default('primary'); });
Schema::create('students', function (Blueprint $table) {
    $table->id(); $table->string('admission_no')->unique(); $table->string('first_name'); $table->string('last_name');
    $table->date('date_of_birth'); $table->string('gender'); $table->foreignId('class_id')->constrained('classes');
    $table->string('photo_path')->nullable(); $table->string('status'); $table->date('admission_date'); $table->timestamps();
});
Schema::create('guardians', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id')->constrained(); $table->foreignId('user_id')->nullable()->constrained();
    $table->string('full_name'); $table->string('relationship'); $table->string('phone'); $table->string('email')->nullable();
    $table->string('address')->nullable(); $table->boolean('is_primary_contact')->default(false);
});
Schema::create('student_medical_info', function (Blueprint $table) { $table->id(); $table->foreignId('student_id')->constrained(); $table->string('conditions'); });
Schema::create('terms', function (Blueprint $table) { $table->id(); $table->string('name'); });
Schema::create('promotions_transfers', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id')->constrained(); $table->string('type');
    $table->foreignId('from_class_id')->nullable()->constrained('classes'); $table->foreignId('to_class_id')->nullable()->constrained('classes');
    $table->foreignId('term_id')->constrained(); $table->string('reason')->nullable(); $table->date('effective_date');
    $table->foreignId('recorded_by')->constrained('users'); $table->timestamp('created_at')->useCurrent();
});
Schema::create('audit_logs', function (Blueprint $table) {
    $table->id(); $table->foreignId('user_id')->nullable()->constrained(); $table->string('action');
    $table->string('entity_type')->nullable(); $table->unsignedBigInteger('entity_id')->nullable(); $table->text('details')->nullable();
    $table->string('ip_address')->nullable(); $table->timestamp('created_at');
});
Schema::create('sponsors', function (Blueprint $table) { $table->id(); $table->string('name'); });
Schema::create('sponsorships', function (Blueprint $table) {
    $table->id(); $table->foreignId('sponsor_id')->constrained(); $table->foreignId('student_id')->nullable()->constrained();
    $table->string('sponsorship_type'); $table->string('program_name')->nullable(); $table->string('status');
    $table->date('start_date'); $table->date('end_date')->nullable(); $table->string('notes')->nullable();
    $table->foreignId('created_by')->nullable()->constrained('users'); $table->timestamps();
});
Schema::create('sponsorship_student', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id')->constrained(); $table->foreignId('sponsorship_id')->constrained();
    $table->timestamps(); $table->unique(['student_id', 'sponsorship_id']);
});
Schema::create('attendance_students', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id')->constrained(); $table->date('attendance_date'); $table->string('status');
});
Schema::create('subjects', function (Blueprint $table) { $table->id(); $table->string('name'); });
Schema::create('assessments', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id')->constrained(); $table->foreignId('subject_id')->constrained(); $table->foreignId('term_id')->constrained();
    $table->string('assessment_type'); $table->integer('score')->nullable(); $table->string('competency_rating')->nullable();
    $table->string('remarks')->nullable(); $table->timestamp('recorded_at');
});
Schema::create('report_cards', function (Blueprint $table) {
    $table->id(); $table->foreignId('student_id')->constrained(); $table->foreignId('term_id')->constrained(); $table->string('file_path')->nullable();
    $table->string('overall_remark')->nullable(); $table->timestamp('generated_at');
});

$roles = collect(['system_admin', 'head_teacher', 'deputy_head_teacher', 'teacher', 'parent_guardian', 'sponsor'])->mapWithKeys(fn ($name) => [$name => Role::create(['name' => $name])->id]);
function userFor(string $role): User {
    global $roles;
    static $sequence = 0;
    $sequence++;
    return User::create(['username' => 'test-'.$sequence, 'email' => 'test-'.$sequence.'@example.test', 'password_hash' => password_hash('test-only-password', PASSWORD_BCRYPT), 'role_id' => $roles[$role], 'status' => 'active']);
}
$leader = userFor('head_teacher'); $teacher = userFor('teacher');
$classA = DB::table('classes')->insertGetId(['name' => 'Class A']);
$classB = DB::table('classes')->insertGetId(['name' => 'Class B']);
$term = DB::table('terms')->insertGetId(['name' => 'Term']);
function learner(array $overrides = []): Student {
    global $classA;
    static $sequence = 0;
    return Student::create(array_replace(['admission_no' => 'TEST-'.++$sequence, 'first_name' => 'Test', 'last_name' => 'Learner', 'date_of_birth' => '2020-01-01', 'gender' => 'female', 'class_id' => $classA, 'status' => 'active', 'admission_date' => '2024-01-01', 'photo_path' => 'private/test-photo.jpg'], $overrides));
}
function requestFor(User $user, array $data = [], string $method = 'POST'): Request {
    $request = Request::create('/api/v1/check', $method, $data);
    $request->headers->set('Accept', 'application/json');
    $request->setUserResolver(fn () => $user);
    app()->instance('request', $request);
    auth()->setUser($user);
    return $request;
}
function ensure(bool $condition, string $message): void { if (! $condition) throw new RuntimeException($message); }
function invalid(callable $operation, string $field): void {
    try { $operation(); } catch (ValidationException $exception) { ensure(array_key_exists($field, $exception->errors()), 'Expected validation field '.$field); return; }
    throw new RuntimeException('Expected validation rejection for '.$field);
}
$passed = 0;
function check(string $name, callable $operation): void { global $passed; $operation(); $passed++; echo 'PASS '.$name.PHP_EOL; }
$students = new StudentController(); $guardians = new GuardianController();

check('learner responses exclude private fields and teacher guardian contacts', function () use ($students, $leader, $teacher) {
    $child = learner();
    Guardian::create(['student_id' => $child->id, 'full_name' => 'Contact', 'relationship' => 'Guardian', 'phone' => '000']);
    DB::table('student_medical_info')->insert(['student_id' => $child->id, 'conditions' => 'Retained private information']);
    $data = $students->show(requestFor($teacher), $child)->getData(true)['data'];
    foreach (['guardians', 'medical_info', 'photo_path', 'created_at', 'updated_at'] as $field) ensure(! array_key_exists($field, $data), 'Unexpected '.$field);
    $data = $students->show(requestFor($leader), $child)->getData(true)['data'];
    ensure(count($data['guardians']) === 1 && ! isset($data['guardians'][0]['user_id']), 'Leadership contact shaping');
    $list = $students->index(requestFor($teacher, ['per_page' => 1], 'GET'))->getData(true);
    ensure(count($list['data']) === 1 && ! isset($list['data'][0]['date_of_birth']), 'List minimization and bound');
    ensure(DB::table('student_medical_info')->where('student_id', $child->id)->value('conditions') === 'Retained private information', 'Medical data must remain');
});

check('registration validates dates, separates domains, and uses admission year', function () use ($students, $leader, $classA) {
    $input = ['first_name' => 'Admission', 'last_name' => 'Check', 'date_of_birth' => '2020-01-01', 'gender' => 'male', 'class_id' => $classA, 'admission_date' => '2024-03-01'];
    foreach ([['date_of_birth' => '2099-01-01'], ['admission_date' => '2099-01-01'], ['admission_date' => '2019-01-01'], ['guardians' => [['full_name' => 'Excluded']]], ['medical' => ['conditions' => 'Excluded']]] as $change) {
        $request = requestFor($leader, array_replace($input, $change));
        invalid(fn () => $students->store($request, new AuditLogger($request)), array_key_first($change) === 'admission_date' ? 'admission_date' : array_key_first($change));
    }
    $request = requestFor($leader, $input);
    $one = $students->store($request, new AuditLogger($request))->getData(true)['data'];
    $two = $students->store($request, new AuditLogger($request))->getData(true)['data'];
    ensure(str_starts_with($one['admission_no'], 'MGA-2024-') && $one['admission_no'] !== $two['admission_no'], 'Admission year and unique number');
    ensure(! Guardian::where('student_id', $one['id'])->exists(), 'No combined guardian creation');
    $request = requestFor($leader, $input + ['admission_no' => null, 'status' => null]);
    $empty = $students->store($request, new AuditLogger($request))->getData(true)['data'];
    ensure($empty['status'] === 'active' && str_starts_with($empty['admission_no'], 'MGA-2024-'), 'Empty prohibited keys cannot override generated values');
});

check('pagination and filters reject malformed or unbounded input', function () use ($students, $guardians, $leader) {
    foreach ([['per_page' => 0], ['per_page' => 101], ['page' => -1], ['status' => 'unknown']] as $change) invalid(fn () => $students->index(requestFor($leader, $change, 'GET')), array_key_first($change));
    invalid(fn () => $guardians->index(requestFor($leader, ['per_page' => 51], 'GET')), 'per_page');
    invalid(fn () => $guardians->accounts(requestFor($leader, ['page' => 0], 'GET')), 'page');
});

check('class changes and transitions retain immutable history', function () use ($students, $leader, $classA, $classB, $term) {
    $child = learner();
    $request = requestFor($leader, ['class_id' => $classB]); invalid(fn () => $students->update($request, $child, new AuditLogger($request)), 'class_id');
    $input = ['to_class_id' => $classB, 'term_id' => $term, 'effective_date' => '2024-07-01'];
    foreach ([['to_class_id' => $classA], ['effective_date' => '2099-01-01'], ['effective_date' => '2023-01-01']] as $change) {
        $request = requestFor($leader, array_replace($input, $change)); invalid(fn () => $students->promote($request, $child, new AuditLogger($request)), array_key_first($change));
    }
    $request = requestFor($leader, $input); $students->promote($request, $child, new AuditLogger($request));
    ensure($child->fresh()->class_id === $classB && $child->fresh()->status === 'active', 'Promotion remains active');
    $request = requestFor($leader, $input); invalid(fn () => $students->promote($request, $child, new AuditLogger($request)), 'to_class_id');
    $request = requestFor($leader, ['type' => 'transfer_out', 'term_id' => $term, 'effective_date' => '2024-08-01']); $students->transfer($request, $child, new AuditLogger($request));
    invalid(fn () => $students->transfer($request, $child, new AuditLogger($request)), 'type');
    $request = requestFor($leader, array_replace($input, ['to_class_id' => $classA, 'effective_date' => '2024-09-01'])); invalid(fn () => $students->promote($request, $child, new AuditLogger($request)), 'to_class_id');
    $request = requestFor($leader, ['type' => 'transfer_in', 'term_id' => $term, 'effective_date' => '2024-09-01']); invalid(fn () => $students->transfer($request, $child, new AuditLogger($request)), 'to_class_id');
    $request = requestFor($leader, ['type' => 'transfer_in', 'to_class_id' => $classA, 'term_id' => $term, 'effective_date' => '2024-09-01']); $students->transfer($request, $child, new AuditLogger($request));
    ensure($child->fresh()->status === 'active' && $child->fresh()->class_id === $classA, 'Transfer-in requires destination and restores active');
    $history = $students->academicHistory(requestFor($leader), $child)->getData(true)['data']['promotions_transfers'];
    ensure(count($history) === 3 && $history[2]['from_class']['id'] === $classA && $history[2]['to_class']['id'] === $classB, 'Historical classes preserved');
    ensure(! isset($history[0]['recorded_by']) && ! isset($history[0]['created_at']), 'History response minimization');
    $request = requestFor($leader, ['status' => 'left']); $students->update($request, $child, new AuditLogger($request));
    $request = requestFor($leader, ['status' => 'active']); invalid(fn () => $students->update($request, $child, new AuditLogger($request)), 'status');
});

check('guardian grouping, duplicate checks, optional accounts, primary links, and detach', function () use ($guardians, $leader) {
    $one = learner(); $two = learner(); $parent = userFor('parent_guardian');
    $input = ['full_name' => 'Family contact', 'relationship' => 'Guardian', 'phone' => '001', 'student_ids' => [$one->id, $two->id], 'is_primary_contact' => true, 'user_id' => $parent->id];
    $request = requestFor($leader, $input); $group = $guardians->store($request, new AuditLogger($request))->getData(true)['data'];
    ensure(count($group['students']) === 2 && $group['account']['id'] === $parent->id, 'Grouped identity');
    $source = Guardian::findOrFail($group['id']);
    $request = requestFor($leader, ['student_ids' => [$one->id]]); invalid(fn () => $guardians->linkStudents($request, $source, new AuditLogger($request)), 'student_ids');
    $request = requestFor($leader, array_replace($input, ['student_ids' => [$one->id, $one->id]])); invalid(fn () => $guardians->store($request, new AuditLogger($request)), 'student_ids.0');
    $request = requestFor($leader, array_replace($input, ['full_name' => 'Other contact', 'student_ids' => [$one->id], 'user_id' => null])); $other = $guardians->store($request, new AuditLogger($request))->getData(true)['data'];
    ensure($other['account'] === null && Guardian::where('student_id', $one->id)->where('is_primary_contact', true)->count() === 1, 'Contact-only and single primary');
    $request = requestFor($leader, ['phone' => 'Updated contact']); $guardians->update($request, $source, new AuditLogger($request));
    ensure(! Guardian::where('user_id', $parent->id)->where('student_id', $one->id)->first()->is_primary_contact
        && Guardian::where('user_id', $parent->id)->where('student_id', $two->id)->first()->is_primary_contact, 'Ordinary edits preserve learner-specific primary flags');
    $request = requestFor($leader, ['user_id' => null]); $guardians->update($request, $source, new AuditLogger($request));
    ensure(Guardian::where('user_id', $parent->id)->count() === 0 && User::find($parent->id) !== null, 'Explicit detach retains user');
});

check('guardian/account pagination preserves complete groups and bounds discovery', function () use ($guardians, $leader) {
    $first = $guardians->index(requestFor($leader, ['per_page' => 1, 'page' => 1], 'GET'))->getData(true);
    $next = $guardians->index(requestFor($leader, ['per_page' => 1, 'page' => 2], 'GET'))->getData(true);
    ensure($first['meta']['total'] >= 2 && count($first['data']) === 1 && $first['data'][0]['id'] !== $next['data'][0]['id'], 'Grouped SQL pagination');
    $search = $guardians->index(requestFor($leader, ['search' => 'Family contact'], 'GET'))->getData(true);
    ensure(count($search['data']) === 1 && count($search['data'][0]['students']) === 2, 'Search does not discard sibling links');
    $accounts = $guardians->accounts(requestFor($leader, ['per_page' => 1], 'GET'))->getData(true);
    ensure(count($accounts['data']) <= 1 && ! isset($accounts['data'][0]['password_hash']), 'Bounded account shaping');
});

check('guardian account roles, family separation, explicit creation, and contact duplicates', function () use ($guardians, $leader, $teacher) {
    $child = learner();
    $input = ['full_name' => 'New contact', 'relationship' => 'Guardian', 'phone' => '005', 'student_ids' => [$child->id]];
    $request = requestFor($leader, $input + ['user_id' => $teacher->id]); invalid(fn () => $guardians->store($request, new AuditLogger($request)), 'user_id');
    $request = requestFor($leader, $input + ['account' => ['username' => 'created-parent', 'email' => 'created-parent@example.test', 'password' => 'test-only-parent-password']]);
    $created = $guardians->store($request, new AuditLogger($request))->getData(true)['data'];
    ensure($created['account'] !== null && ! isset($created['account']['password_hash']), 'Explicit safe parent account creation');
    $request = requestFor($leader, array_replace($input, ['student_ids' => [learner()->id], 'user_id' => $created['account']['id']]));
    invalid(fn () => $guardians->store($request, new AuditLogger($request)), 'user_id');
    $request = requestFor($leader, array_replace($input, ['full_name' => 'Duplicate target', 'user_id' => null]));
    $first = $guardians->store($request, new AuditLogger($request))->getData(true)['data'];
    $request = requestFor($leader, array_replace($input, ['full_name' => 'Separate contact', 'phone' => '006', 'user_id' => null]));
    $second = $guardians->store($request, new AuditLogger($request))->getData(true)['data'];
    $request = requestFor($leader, ['full_name' => 'Duplicate target', 'phone' => '005']);
    invalid(fn () => $guardians->update($request, Guardian::findOrFail($second['id']), new AuditLogger($request)), 'student_ids');
});

check('large guardian groups are bounded and a searched learner remains discoverable', function () use ($guardians, $leader) {
    $parent = userFor('parent_guardian');
    for ($index = 0; $index < 101; $index++) {
        $last = learner(['first_name' => 'Bounded'.$index]);
        Guardian::create(['student_id' => $last->id, 'user_id' => $parent->id, 'full_name' => 'Bounded contact', 'relationship' => 'Guardian', 'phone' => '007']);
    }
    $group = $guardians->index(requestFor($leader, ['search' => 'Bounded contact'], 'GET'))->getData(true)['data'][0];
    ensure(count($group['students']) === 100 && $group['students_count'] === 101 && $group['students_truncated'], 'Nested relationship bound');
    $searched = $guardians->index(requestFor($leader, ['search' => $last->admission_no], 'GET'))->getData(true)['data'][0];
    ensure($searched['students'][0]['id'] === $last->id, 'Matching learner prioritized within bounded group');
});

check('legacy promoted state is retained without implicit normalization', function () use ($students, $leader, $classB, $term) {
    $child = learner(['status' => 'promoted']);
    $request = requestFor($leader, ['to_class_id' => $classB, 'term_id' => $term, 'effective_date' => '2024-07-01']);
    invalid(fn () => $students->promote($request, $child, new AuditLogger($request)), 'to_class_id');
    ensure($child->fresh()->status === 'promoted' && $child->promotionsTransfers()->count() === 0, 'Legacy value and history retained');
});

check('sponsorship filtering returns only own individual and member group records', function () use ($leader) {
    $one = learner(); $other = learner(); $sponsor = DB::table('sponsors')->insertGetId(['name' => 'Test sponsor']);
    $add = fn ($type, $studentId = null) => DB::table('sponsorships')->insertGetId(['sponsor_id' => $sponsor, 'student_id' => $studentId, 'sponsorship_type' => $type, 'status' => 'active', 'start_date' => '2024-01-01']);
    $individual = $add('individual', $one->id); $add('individual', $other->id); $group = $add('group'); $foreign = $add('group'); $add('school_wide');
    DB::table('sponsorship_student')->insert([['student_id' => $one->id, 'sponsorship_id' => $group], ['student_id' => $other->id, 'sponsorship_id' => $foreign]]);
    $items = (new SponsorshipController())->index(requestFor($leader, ['student_id' => $one->id], 'GET'))->getData(true)['data'];
    $ids = array_column($items, 'id'); sort($ids); ensure($ids === [$individual, $group], 'Unrelated sponsorship exclusion');
    ensure(! isset($items[0]['created_by']) && ! isset($items[0]['students']), 'Learner summary minimization');
});

check('Parent Portal retains ownership checks and unlink revokes only the selected family access', function () use ($leader, $guardians, $term) {
    $one = learner(); $other = learner(); $parent = userFor('parent_guardian'); $foreignParent = userFor('parent_guardian');
    $link = Guardian::create(['student_id' => $one->id, 'user_id' => $parent->id, 'full_name' => 'Parent', 'relationship' => 'Parent', 'phone' => '003']);
    Guardian::create(['student_id' => $other->id, 'user_id' => $foreignParent->id, 'full_name' => 'Other parent', 'relationship' => 'Parent', 'phone' => '004']);
    DB::table('attendance_students')->insert(['student_id' => $one->id, 'attendance_date' => '2024-01-02', 'status' => 'present']);
    $subject = DB::table('subjects')->insertGetId(['name' => 'Subject']);
    DB::table('assessments')->insert(['student_id' => $one->id, 'subject_id' => $subject, 'term_id' => $term, 'assessment_type' => 'continuous', 'score' => 1, 'recorded_at' => '2024-01-02']);
    $request = requestFor($parent); $portal = new ParentPortalController(); $audit = new AuditLogger($request);
    ensure(count($portal->myChildren()->getData(true)['data']) === 1, 'Own-child directory');
    ensure($portal->childAttendance($other, $audit)->getStatusCode() === 403, 'Foreign attendance');
    ensure($portal->childProgress($other, $audit)->getStatusCode() === 403, 'Foreign progress');
    ensure($portal->childReportCards($other, $audit)->getStatusCode() === 403, 'Foreign report cards');
    $foreignCard = App\Models\ReportCard::create(['student_id' => $other->id, 'term_id' => $term, 'generated_at' => '2024-01-02']);
    ensure($portal->downloadReportCard($one, $foreignCard, $audit)->getStatusCode() === 403, 'Report card must belong to own learner');
    ensure($portal->childAttendance($one, $audit)->getStatusCode() === 200 && $portal->childProgress($one, $audit)->getStatusCode() === 200, 'Own attendance and progress');
    Guardian::create(['student_id' => $one->id, 'user_id' => $parent->id, 'full_name' => 'Parent', 'relationship' => 'Parent', 'phone' => '003']);
    $request = requestFor($leader); $guardians->unlinkStudent($link, $one, new AuditLogger($request));
    $request = requestFor($parent); ensure($portal->childAttendance($one, new AuditLogger($request))->getStatusCode() === 403, 'Unlink revokes access');
    ensure(User::find($parent->id) !== null && Guardian::where('user_id', $foreignParent->id)->exists(), 'Other family and user retained');
});

check('backend role middleware denies teacher guardian management and parent staff access', function () use ($teacher, $leader) {
    $middleware = new EnsureRole(); $next = fn () => response()->json(['data' => []]);
    ensure($middleware->handle(requestFor($teacher), $next, 'system_admin', 'head_teacher', 'deputy_head_teacher')->getStatusCode() === 403, 'Teacher contact denial');
    ensure($middleware->handle(requestFor($leader), $next, 'system_admin', 'head_teacher', 'deputy_head_teacher')->getStatusCode() === 200, 'Leadership permission');
    ensure($middleware->handle(requestFor(userFor('parent_guardian')), $next, 'system_admin', 'head_teacher', 'teacher')->getStatusCode() === 403, 'Parent staff denial');
});

echo $passed.' checks passed on in-memory SQLite only.'.PHP_EOL;
