<?php
// Inspect the built image without booting Laravel, secrets or a database.
declare(strict_types=1);
function ensure(bool $ok, string $label): void { if (!$ok) throw new RuntimeException($label); echo 'PASS '.$label.PHP_EOL; }
require '/var/www/html/vendor/autoload.php';
ensure(PHP_VERSION_ID >= 80300 && PHP_VERSION_ID < 80400, 'supported PHP 8.3 runtime');
foreach (['pdo_mysql', 'pdo_sqlite', 'mbstring', 'dom', 'xml', 'xmlreader', 'xmlwriter', 'simplexml', 'gd', 'zip', 'intl', 'bcmath', 'fileinfo', 'openssl', 'curl', 'Zend OPcache'] as $extension) ensure(extension_loaded($extension), 'runtime extension '.$extension);
ensure(!Composer\InstalledVersions::isInstalled('phpunit/phpunit', false) && !Composer\InstalledVersions::isInstalled('fakerphp/faker', false) && !Composer\InstalledVersions::isInstalled('mockery/mockery', false), 'production dependencies only');
foreach (['.env', '.env.example', '.env.production', '.git', 'test-dump.sql', 'students-report.xlsx', 'mary-report-card.pdf', 'docs', 'tests', 'compose.yaml'] as $path) ensure(!file_exists('/var/www/html/'.$path), 'excluded development artifact '.$path);
ensure(!getenv('APP_KEY') && !getenv('DB_PASSWORD'), 'image contains no application or database credentials');
ensure(!is_file('/var/www/html/bootstrap/cache/config.php'), 'runtime secrets not baked into configuration cache');
$files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator('/var/www/html/storage', FilesystemIterator::SKIP_DOTS));
ensure(iterator_count($files) === 0, 'no private learner documents, uploads, logs or snapshots in image');
ensure(!file_exists('/var/www/html/public/storage'), 'development storage link excluded');
ensure(!is_file('/usr/local/bin/composer'), 'Composer build tool removed from final image');
ensure(!str_contains(file_get_contents('/usr/local/bin/start-staging'), 'artisan migrate') && !str_contains(file_get_contents('/usr/local/bin/start-staging'), 'artisan db:seed'), 'startup performs no migrations or seeding');
$key = 'base64:'.base64_encode(random_bytes(32));
foreach (['APP_KEY' => $key, 'APP_URL' => 'https://demo.invalid', 'DB_CONNECTION' => 'mysql', 'DB_HOST' => 'fixture-host', 'DB_PORT' => '3306', 'DB_DATABASE' => 'fixture-database', 'DB_USERNAME' => 'fixture-user', 'DB_PASSWORD' => 'test-only-secret'] as $name => $value) putenv($name.'='.$value);
function validationExit(array $changes): int {
    $variables = getenv(); foreach ($changes as $name => $value) $variables[$name] = $value;
    $process = proc_open([PHP_BINARY, '/usr/local/bin/validate-staging.php'], [['pipe', 'r'], ['pipe', 'w'], ['pipe', 'w']], $pipes, null, $variables);
    fclose($pipes[0]); stream_get_contents($pipes[1]); fclose($pipes[1]); stream_get_contents($pipes[2]); fclose($pipes[2]); return proc_close($process);
}
ensure(validationExit([]) === 0, 'valid staging environment accepted');
foreach (['APP_DEBUG' => 'true', 'MAIL_MAILER' => 'smtp', 'DB_DATABASE' => 'mgaems', 'APP_URL' => 'http://demo.invalid', 'PORT' => '80;bad', 'APP_KEY' => '', 'SESSION_DOMAIN' => '.invalid', 'SANCTUM_STATEFUL_DOMAINS' => 'demo.invalid'] as $name => $value) ensure(validationExit([$name => $value]) !== 0, 'unsafe setting refused: '.$name);
