<?php
// Runs only in the staging image against an owned, empty, network-isolated fixture.
declare(strict_types=1);
function ensure(bool $ok, string $label): void { if (!$ok) { fwrite(STDERR, 'FAIL '.$label.PHP_EOL); exit(1); } }
function pass(string $label): void { echo 'PASS '.$label.PHP_EOL; }
$mode = $argv[1] ?? '';
ensure(in_array($mode, ['setup', 'http', 'persist', 'exports'], true), 'Explicit test mode required');
ensure(getenv('MGAEMS_DISPOSABLE_STAGING') === 'fresh-mysql-fixture', 'Fixture marker required');
ensure((bool) preg_match('/^mgaems_stage_test_[a-f0-9]{8}$/', getenv('DB_DATABASE') ?: ''), 'Fixture database name required');
ensure(getenv('DB_HOST') === '127.0.0.1' && getenv('DB_PORT') === '3306', 'Fixture loopback only');
ensure(!is_file('/var/www/html/.env'), 'Image must contain no dotenv file');
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class); $kernel->bootstrap();
set_exception_handler(static function (Throwable $exception): void { fwrite(STDERR, 'Fixture failed: '.get_class($exception).PHP_EOL); exit(1); });
$db = Illuminate\Support\Facades\DB::connection();
ensure($db->getDriverName() === 'mysql' && $db->getDatabaseName() === getenv('DB_DATABASE'), 'Explicit fixture connection required');
ensure(config('staging.enabled') && config('app.env') === 'production', 'Staging production config required');
$identity = $db->selectOne('SELECT DATABASE() AS db, @@server_uuid AS uuid');
ensure($identity->db === getenv('DB_DATABASE') && $identity->uuid !== '08778507-b858-11f1-a705-a6d841c8094c', 'Development MySQL is forbidden');
$password = getenv('MGAEMS_TEST_ADMIN_PASSWORD') ?: ''; ensure(strlen($password) >= 16, 'Test-only credential required');

if ($mode === 'setup') {
    $tables = $db->select('SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()');
    ensure(count($tables) === 0, 'Fixture must begin completely empty'); pass('identified isolated empty MySQL');
    ensure((new App\Http\Controllers\StagingHealthController())()->getStatusCode() === 503, 'Pre-migration readiness must fail');
    pass('readiness fails safely before installation');
    ensure(Illuminate\Support\Facades\Artisan::call('migrate', ['--force' => true]) === 0, 'Fresh migration failed');
    $tables = $db->select('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()');
    ensure(count($tables) === 43 && $db->table('migrations')->count() === 39, 'Expected 43 tables and 39 migrations');
    foreach ($tables as $table) if ($table->name !== 'migrations') ensure($db->table($table->name)->count() === 0, 'No automatic seeding');
    ensure(!$db->getSchemaBuilder()->hasTable('streams'), 'Streams must remain removed');
    ensure($db->getSchemaBuilder()->hasTable('personal_access_tokens') && $db->getSchemaBuilder()->hasTable('sessions'), 'Authentication schema');
    pass('all 39 migrations produce 43 empty application tables without Streams');
    ensure(Illuminate\Support\Facades\Artisan::call('migrate', ['--force' => true]) === 0 && $db->table('migrations')->count() === 39, 'Repeat migration');
    pass('migration re-run has no pending work');
    $command = $kernel->all()['staging:bootstrap-admin'];
    $unattended = new Symfony\Component\Console\Tester\CommandTester($command);
    ensure($unattended->execute([], ['interactive' => false]) !== 0 && !App\Models\User::exists(), 'Unattended bootstrap refused');
    pass('administrator bootstrap requires an interactive operator');
    $wrongTarget = new Symfony\Component\Console\Tester\CommandTester($command);
    $wrongTarget->setInputs(['wrong-database']);
    ensure($wrongTarget->execute([], ['interactive' => true]) !== 0 && !App\Models\User::exists(), 'Wrong target confirmation refused');
    pass('administrator bootstrap requires exact database confirmation');
    foreach (['short', str_repeat('x', 73)] as $invalidPassword) {
        $invalid = new Symfony\Component\Console\Tester\CommandTester($command);
        $invalid->setInputs([$db->getDatabaseName(), 'demo-admin', 'operator@example.invalid', $invalidPassword, $invalidPassword]);
        ensure($invalid->execute([], ['interactive' => true]) !== 0 && !App\Models\User::exists(), 'Unsafe password refused');
        ensure(!str_contains($invalid->getDisplay(), $invalidPassword), 'Rejected passwords must not be printed');
    }
    pass('short passwords and bcrypt truncation are rejected without account creation');
    $tester = new Symfony\Component\Console\Tester\CommandTester($command);
    $tester->setInputs([$db->getDatabaseName(), 'demo-admin', 'operator@example.invalid', $password, $password]);
    ensure($tester->execute([], ['interactive' => true]) === 0, 'Administrator bootstrap failed');
    $admin = App\Models\User::firstOrFail();
    ensure($admin->hasRole('system_admin') && Illuminate\Support\Facades\Hash::check($password, $admin->password_hash), 'Strong hashed administrator');
    ensure(!str_contains($tester->getDisplay(), $password), 'Password must not be printed');
    ensure(App\Models\Role::count() === 8 && App\Models\SchoolSetting::first()->logo_path === null, 'Reference initialization without logo import');
    foreach (['students', 'guardians', 'staff', 'sponsors', 'learner_health_profiles'] as $table) ensure($db->table($table)->count() === 0, 'No school fixture creation');
    pass('interactive administrator bootstrap hashes credentials and creates no school records or Staff links');
    $again = new Symfony\Component\Console\Tester\CommandTester($command);
    ensure($again->execute([], ['interactive' => true]) !== 0 && App\Models\User::count() === 1, 'Repeated bootstrap refused');
    pass('existing accounts cannot be overwritten by bootstrap');
    ensure(config('mail.default') === 'array' && array_keys(config('mail.mailers')) === ['array'], 'Staging SMTP must be unavailable');
    Illuminate\Support\Facades\Mail::raw('Disposable fixture message', fn ($message) => $message->to('nobody@example.invalid'));
    ensure(app('mailer')->getSymfonyTransport() instanceof Illuminate\Mail\Transport\ArrayTransport, 'Memory-only mail transport');
    pass('mail is captured in memory with no SMTP or log transport');
    ensure(config('session.secure') && config('session.http_only') && config('session.encrypt') && config('session.same_site') === 'lax', 'Secure sessions');
    ensure(config('sanctum.stateful') === [], 'Bearer frontend mode');
    pass('secure encrypted sessions and bearer-compatible staging configuration');
    @mkdir(storage_path('framework/cache/dompdf'), 0770, true);
    $bytes = Barryvdh\DomPDF\Facade\Pdf::loadHtml('<html><body>Disposable PDF smoke test</body></html>')->output();
    ensure(str_starts_with($bytes, '%PDF-') && strlen($bytes) > 100, 'PDF renderer');
    pass('production-only PDF renderer produces a valid PDF');
    pass('setup complete; no development connection or data import');
    exit;
}

if ($mode === 'persist') {
    ensure(Illuminate\Support\Facades\Storage::disk('private')->get('verification/private.txt') === 'disposable-private-marker', 'Private storage survived restart');
    pass('private volume survives container replacement'); exit;
}

function requestFixture(string $method, string $path, ?array $body = null, ?string $token = null): array {
    $headers = ['Accept: application/json', 'Origin: https://demo.invalid', 'X-Forwarded-Proto: https'];
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    if ($token) $headers[] = 'Authorization: Bearer '.$token;
    $handle = curl_init('http://127.0.0.1:'.getenv('PORT').$path);
    curl_setopt_array($handle, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true, CURLOPT_TIMEOUT => 10, CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body, JSON_THROW_ON_ERROR)]);
    $response = curl_exec($handle); ensure(is_string($response), 'HTTP fixture response');
    $status = curl_getinfo($handle, CURLINFO_HTTP_CODE); $size = curl_getinfo($handle, CURLINFO_HEADER_SIZE); curl_close($handle);
    return [$status, substr($response, $size), substr($response, 0, $size)];
}
if ($mode === 'exports') {
    $year = $db->table('academic_years')->insertGetId(['name' => 'Export fixture', 'start_date' => '2030-01-01', 'end_date' => '2030-12-31', 'is_current' => false]);
    $term = $db->table('terms')->insertGetId(['academic_year_id' => $year, 'name' => 'Fixture term', 'start_date' => '2030-01-01', 'end_date' => '2030-04-30', 'is_current' => false]);
    $class = $db->table('classes')->insertGetId(['name' => 'Fixture class', 'level' => 'primary', 'sequence' => 1]);
    $subject = $db->table('subjects')->insertGetId(['name' => 'Fixture subject', 'code' => 'FX83', 'status' => 'active']);
    $student = $db->table('students')->insertGetId(['admission_no' => 'DISPOSABLE-83', 'first_name' => 'Fixture', 'last_name' => 'Learner',
        'gender' => 'female', 'date_of_birth' => '2018-01-02', 'admission_date' => '2026-01-03', 'class_id' => $class, 'status' => 'active']);
    $admin = App\Models\User::where('username', 'demo-admin')->firstOrFail();
    $db->table('assessments')->insert(['student_id' => $student, 'subject_id' => $subject, 'term_id' => $term, 'recorded_by' => $admin->id,
        'assessment_type' => 'continuous', 'score' => 76, 'recorded_at' => now()]);
    [$status, $body] = requestFixture('POST', '/api/v1/auth/login', ['username' => 'demo-admin', 'password' => $password]);
    ensure($status === 200, 'Export fixture login'); $token = json_decode($body, true)['data']['token'];
    [$status] = requestFixture('POST', '/api/v1/students/'.$student.'/report-cards/generate', ['term_id' => $term, 'overall_remark' => 'Fixture Unicode: café; <script>literal remark</script>'], $token);
    ensure($status === 201, 'Actual PDF publication');
    $revision = App\Models\ReportCardRevision::firstOrFail();
    $bytes = Illuminate\Support\Facades\Storage::disk('private')->get($revision->artifact_path);
    ensure(str_starts_with($bytes, '%PDF-') && hash('sha256', $bytes) === $revision->artifact_sha256, 'Published PDF integrity');
    pass('real report publication writes a verified PDF using upgraded production dependencies');
    [$status, $download] = requestFixture('GET', '/api/v1/report-cards/'.$revision->report_card_id.'/download', null, $token);
    ensure($status === 200 && hash('sha256', $download) === $revision->artifact_sha256, 'Authorized retained download');
    [$status] = requestFixture('GET', '/api/v1/report-cards/'.$revision->report_card_id.'/download'); ensure($status === 401, 'Anonymous PDF denial');
    pass('authorized PDF download retains exact bytes and anonymous download is denied');
    [$status] = requestFixture('POST', '/api/v1/students/'.$student.'/report-cards/generate', ['term_id' => $term, 'overall_remark' => 'Second disposable revision'], $token);
    ensure($status === 201 && App\Models\ReportCardRevision::count() === 2, 'Revision continuity');
    ensure(hash('sha256', Illuminate\Support\Facades\Storage::disk('private')->get($revision->artifact_path)) === $revision->artifact_sha256, 'Earlier artifact preserved');
    pass('new PDF publication retains the previous immutable artifact');
    [$status, $xlsx] = requestFixture('GET', '/api/v1/reports/students/export?class_id='.$class.'&status=active', null, $token);
    ensure($status === 200 && str_starts_with($xlsx, 'PK'), 'Authorized XLSX download');
    $file = tempnam('/tmp', 'fixture-xlsx-'); file_put_contents($file, $xlsx);
    try {
        $sheet = PhpOffice\PhpSpreadsheet\IOFactory::load($file)->getActiveSheet();
        ensure($sheet->getCell('A1')->getValue() === 'Admission No' && $sheet->getCell('A2')->getValue() === 'DISPOSABLE-83'
            && $sheet->getCell('B2')->getValue() === 'Fixture' && $sheet->getCell('E2')->getValue() === '2018-01-02' && $sheet->getHighestRow() === 2, 'Export headings, dates and filters');
    } finally { unlink($file); }
    pass('production XLSX export retains headings, dates, row filters and learner values');
    [$status] = requestFixture('GET', '/api/v1/reports/students/export'); ensure($status === 401, 'Anonymous export denial');
    pass('anonymous XLSX export is denied');
    ensure(config('dompdf.options.enable_remote') === false && config('dompdf.options.enable_php') === false, 'Renderer does not fetch remote resources or execute PHP');
    pass('renderer remote fetching and embedded PHP remain disabled');
    exit;
}
[$status, $body] = requestFixture('GET', '/healthz'); ensure($status === 200 && json_decode($body, true) === ['status' => 'ready'], 'Runtime readiness');
pass('Apache and Laravel readiness on configured PORT');
[$status, , $headers] = requestFixture('GET', '/');
ensure($status === 302 && stripos($headers, 'secure') !== false && stripos($headers, 'httponly') !== false, 'Proxy-aware secure cookies');
pass('trusted Railway-style TLS proxy and secure host-only cookies');
[$status, $body] = requestFixture('POST', '/api/v1/auth/login', ['username' => 'demo-admin', 'password' => $password]);
ensure($status === 200 && !empty(json_decode($body, true)['data']['token']), 'Same-origin frontend login without CSRF mismatch');
$token = json_decode($body, true)['data']['token'];
[$status] = requestFixture('GET', '/api/v1/me', null, $token); ensure($status === 200, 'Bearer header reaches Laravel');
pass('browser-style origin login and authorized bearer request');
[$status] = requestFixture('GET', '/api/v1/health/profiles', null, $token); ensure($status === 403, 'Administrator Health boundary');
[$status] = requestFixture('GET', '/api/v1/students'); ensure($status === 401, 'Anonymous learner denial');
pass('existing private learner and restricted Health permissions remain enforced');
[$status] = requestFixture('POST', '/api/v1/auth/password/forgot', ['email' => 'operator@example.invalid']); ensure($status === 200, 'Safe recovery API');
pass('recovery API works with email delivery deliberately disabled');
Illuminate\Support\Facades\Storage::disk('private')->put('verification/private.txt', 'disposable-private-marker');
Illuminate\Support\Facades\Storage::disk('public')->put('verification/public.txt', 'disposable-public-marker');
Illuminate\Support\Facades\Storage::disk('public')->put('verification/blocked.php', '<?php echo "must-not-execute";');
[$status, $body] = requestFixture('GET', '/storage/verification/public.txt'); ensure($status === 200 && $body === 'disposable-public-marker', 'Public storage link');
[$status] = requestFixture('GET', '/storage/verification/private.txt'); ensure($status !== 200, 'Private file cannot be served');
[$status] = requestFixture('GET', '/storage/verification/blocked.php'); ensure($status === 403, 'Uploaded PHP cannot execute');
[$status] = requestFixture('GET', '/.env'); ensure($status !== 200, 'Hidden configuration cannot be served');
pass('private files stay private; public uploads cannot execute PHP');
[$status] = requestFixture('POST', '/api/v1/auth/logout', [], $token); ensure($status === 200, 'Logout');
[$status] = requestFixture('GET', '/api/v1/me', null, $token); ensure($status === 401, 'Logged-out token revoked');
pass('logout invalidates the fixture token');
