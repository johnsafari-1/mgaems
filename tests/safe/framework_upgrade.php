<?php

// Extends fail-closed RAM-only HTTP fixtures; never loads dotenv or development DB.
require __DIR__.'/authorization.php';

use App\Models\Role;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Session\ArraySessionHandler;
use Illuminate\Session\Store;
use Illuminate\Http\Request;
use Illuminate\Session\TokenMismatchException;

$upgradeStart = $passed;
check('legacy bcrypt login rehashes the custom column without resetting account epochs or other devices', function () {
    $user = actor(Role::PARENT_GUARDIAN); $other = token($user);
    $legacy = password_hash('isolated-test-password', PASSWORD_BCRYPT, ['cost' => 4]);
    $user->forceFill(['password_hash' => $legacy])->save();
    config(['hashing.bcrypt.rounds' => 5]);
    app('hash')->forgetDrivers();
    status(callApi('POST', 'auth/login', null, ['username' => $user->username, 'password' => 'wrong-password']), 422);
    ensure($user->fresh()->password_hash === $legacy, 'Incorrect login cannot rehash');
    $login = callApi('POST', 'auth/login', null, ['username' => $user->username, 'password' => 'isolated-test-password']);
    status($login, 200); $current = $user->fresh();
    ensure(Hash::check('isolated-test-password', $current->password_hash), 'Compatible legacy password remains valid');
    if (version_compare(app()->version(), '11.0.0', '>=')) {
        ensure($current->password_hash !== $legacy && ! Hash::needsRehash($current->password_hash), 'New configured work factor');
    } else {
        ensure($current->password_hash === $legacy, 'Legacy running runtime retains its old login hashing behavior');
    }
    ensure($current->getAuthPasswordName() === 'password_hash' && ! array_key_exists('password', $current->getAttributes()), 'No redundant password column');
    ensure((int) $current->session_version === 0, 'Same credential retains epoch');
    status(callApi('GET', 'me', $other), 200);
    status(callApi('GET', 'me', $login['body']['data']['token']), 200);
    config(['hashing.bcrypt.rounds' => 4]);
    app('hash')->forgetDrivers();
});

check('Laravel Eloquent authentication rehash targets password_hash', function () {
    $user = actor(Role::PARENT_GUARDIAN);
    config(['hashing.bcrypt.rounds' => 5]);
    app('hash')->forgetDrivers();
    Auth::forgetGuards(); Auth::shouldUse('web');
    ensure(Auth::guard('web')->attempt(['username' => $user->username, 'password' => 'isolated-test-password']), 'Framework provider authenticates custom hash');
    if (version_compare(app()->version(), '11.0.0', '>=')) ensure(! Hash::needsRehash($user->fresh()->password_hash), 'Provider rehash saved custom column');
    ensure(! array_key_exists('password', $user->fresh()->getAttributes()), 'Provider never adds password column');
    Auth::guard('web')->logoutCurrentDevice(); config(['hashing.bcrypt.rounds' => 4]); app('hash')->forgetDrivers();
});

check('request forgery protection rejects missing and foreign-origin credentials and accepts valid CSRF tokens', function () {
    $middleware = new class(app(), app('encrypter')) extends App\Http\Middleware\VerifyCsrfToken {
        protected function runningUnitTests() { return false; }
    };
    $session = app('session')->driver(); $session->flush(); $session->regenerateToken();
    foreach ([[], ['HTTP_SEC_FETCH_SITE' => 'cross-site'], ['HTTP_SEC_FETCH_SITE' => 'same-site']] as $headers) {
        $request = Request::create('https://localhost/fixture-csrf', 'POST', [], [], [], $headers);
        $request->setLaravelSession($session); $rejected = false;
        try { $middleware->handle($request, fn () => response()->json(['ok' => true])); }
        catch (TokenMismatchException $exception) { $rejected = true; }
        ensure($rejected, 'No blanket exemption or foreign-origin bypass');
    }
    $request = Request::create('https://localhost/fixture-csrf', 'POST', ['_token' => $session->token()]);
    $request->setLaravelSession($session);
    ensure($middleware->handle($request, fn () => response()->json(['ok' => true]))->getStatusCode() === 200, 'Traditional CSRF tokens remain valid');
    if (version_compare(app()->version(), '13.0.0', '>=')) {
        $request = Request::create('https://localhost/fixture-csrf', 'POST', [], [], [], ['HTTP_SEC_FETCH_SITE' => 'same-origin']);
        $request->setLaravelSession($session);
        ensure($middleware->handle($request, fn () => response()->json(['ok' => true]))->getStatusCode() === 200, 'Laravel 13 verifies same-origin request metadata');
    }
});

check('PHP session compatibility and JSON session identity preserve integer revocation markers', function () {
    foreach (['php', 'json'] as $mode) {
        if ($mode === 'json' && version_compare(app()->version(), '13.0.0', '<')) continue;
        $handler = new ArraySessionHandler(120);
        $session = new Store('isolated-serialization', $handler, null, $mode); $session->start();
        $identity = ['user_id' => 123, 'session_version' => 4];
        $session->put('mgaems_health_identity', $identity); $session->save();
        $restored = new Store('isolated-serialization', $handler, $session->getId(), $mode); $restored->start();
        ensure($restored->get('mgaems_health_identity') === $identity, 'Typed marker survives '.$mode.' serialization');
    }
    ensure(config('session.serialization') === 'php', 'Existing nonstaging sessions retain format');
    ensure(config('cache.serializable_classes') === false, 'No arbitrary cache object deserialization');
});

check('file cache preserves rate-limit scalar data without enabling arbitrary object restoration', function () {
    $cache = app('cache')->store('file');
    $value = ['attempts' => 2, 'blocked' => false];
    ensure($cache->put('isolated-upgrade-scalar', $value, 60) && $cache->get('isolated-upgrade-scalar') === $value, 'File cache array/scalar behavior');
    if (version_compare(app()->version(), '13.0.0', '>=')) {
        $cache->put('isolated-upgrade-object', new stdClass(), 60);
        ensure(! ($cache->get('isolated-upgrade-object') instanceof stdClass), 'Unapproved object classes are not restored');
    }
});

check('patched path normalization refuses traversal and malformed UTF-8 control paths', function () {
    $normalizer = new League\Flysystem\WhitespacePathNormalizer();
    $refused = false;
    try { $normalizer->normalizePath('../outside'); } catch (League\Flysystem\PathTraversalDetected $exception) { $refused = true; }
    ensure($refused, 'Traversal cannot escape disk');
    if (version_compare(app()->version(), '13.0.0', '>=')) {
        $refused = false;
        try { $normalizer->normalizePath('unsafe/'.chr(0xc0).chr(0xaf).chr(0).'name'); }
        catch (League\Flysystem\CorruptedPathDetected $exception) { $refused = true; }
        ensure($refused, 'Invalid UTF-8 does not bypass control-character rejection');
    }
});

echo 'Framework upgrade checks passed: '.($passed - $upgradeStart).PHP_EOL;
