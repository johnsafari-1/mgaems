<?php
declare(strict_types=1);
function reject(string $message): never { fwrite(STDERR, "Staging configuration refused: {$message}\n"); exit(1); }
foreach (['APP_ENV' => 'production', 'MGAEMS_STAGING' => 'true', 'APP_DEBUG' => 'false',
    'SESSION_DRIVER' => 'database', 'SESSION_SECURE_COOKIE' => 'true', 'SESSION_ENCRYPT' => 'true',
    'LOG_CHANNEL' => 'stderr', 'MAIL_MAILER' => 'array', 'QUEUE_CONNECTION' => 'sync',
    'CACHE_DRIVER' => 'file', 'FILESYSTEM_DISK' => 'private', 'DB_CONNECTION' => 'mysql'] as $name => $value) {
    if (getenv($name) !== $value) reject("{$name} must be {$value}.");
}
$port = getenv('PORT') ?: '';
if (!ctype_digit($port) || (int) $port < 1 || (int) $port > 65535) reject('PORT must be 1–65535.');
$key = getenv('APP_KEY') ?: '';
if (!str_starts_with($key, 'base64:') || strlen(base64_decode(substr($key, 7), true) ?: '') !== 32) reject('Set a unique, valid APP_KEY.');
$url = parse_url(getenv('APP_URL') ?: '');
if (!$url || ($url['scheme'] ?? '') !== 'https' || empty($url['host']) || isset($url['user']) || isset($url['pass']) || isset($url['query']) || isset($url['fragment']) || !in_array($url['path'] ?? '', ['', '/'], true)) reject('APP_URL must be the public HTTPS origin.');
foreach (['DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME', 'DB_PASSWORD'] as $name) if (!getenv($name)) reject("{$name} is required.");
$dbPort = getenv('DB_PORT');
if (!ctype_digit($dbPort) || (int) $dbPort < 1 || (int) $dbPort > 65535) reject('DB_PORT must be 1–65535.');
if (getenv('DB_DATABASE') === 'mgaems' || getenv('DB_HOST') === 'mysql' || getenv('DB_HOST') === 'mgaems-mysql') reject('Known local development database settings are forbidden.');
if (getenv('SESSION_DOMAIN')) reject('Leave SESSION_DOMAIN unset for a host-only cookie.');
if (getenv('SANCTUM_STATEFUL_DOMAINS')) reject('This frontend uses bearer tokens; leave SANCTUM_STATEFUL_DOMAINS empty.');
