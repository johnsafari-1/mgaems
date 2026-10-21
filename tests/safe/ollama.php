<?php

use App\Contracts\TeachingAssistantProvider;
use App\Services\OllamaService;
use Illuminate\Foundation\Bootstrap\BootProviders;
use Illuminate\Foundation\Bootstrap\LoadConfiguration;
use Illuminate\Foundation\Bootstrap\LoadEnvironmentVariables;
use Illuminate\Foundation\Bootstrap\RegisterFacades;
use Illuminate\Foundation\Bootstrap\RegisterProviders;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Http;

// No database, migrations, school fixtures, or arbitrary prompt arguments.
require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->bootstrapWith([
    LoadEnvironmentVariables::class,
    LoadConfiguration::class,
]);
$app['config']->set('database.connections', []);
$app['config']->set('session.driver', 'array');
$app['config']->set('cache.default', 'array');
$app['config']->set('cache.stores.array', ['driver' => 'array', 'serialize' => false]);
$app->bootstrapWith([
    RegisterFacades::class,
    RegisterProviders::class,
    BootProviders::class,
]);

$passed = 0;
function ensure(bool $condition, string $message): void
{
    if (! $condition) {
        throw new RuntimeException($message);
    }
}
function check(string $name, callable $test): void
{
    global $passed;
    $test();
    $passed++;
    echo 'PASS '.$name.PHP_EOL;
}
function fails(callable $call, string $message): void
{
    try {
        $call();
    } catch (RuntimeException $exception) {
        ensure($exception->getMessage() === $message, 'Unexpected error: '.$exception->getMessage());

        return;
    }
    throw new RuntimeException('Expected failure was not raised.');
}
function fake(callable $response): void
{
    Http::swap(new Factory);
    Http::preventStrayRequests();
    Http::fake($response);
}

$service = $app->make(OllamaService::class);
$messages = [['role' => 'user', 'content' => 'Return only this JSON object: {"status":"ok"}. /no_think']];

if (in_array('--live', $argv, true)) {
    // These calls use synthetic content only and never touch the application DB.
    check('PHP container GET /api/tags lists configured model', function () use ($service) {
        ensure(in_array(config('services.ollama.model'), array_column($service->models(), 'name'), true), 'Configured model is not installed.');
    });
    check('PHP container POST /api/chat returns parsed JSON object', function () use ($service, $messages) {
        $started = hrtime(true);
        ensure($service->chat($messages) === ['status' => 'ok'], 'Unexpected synthetic probe output.');
        echo 'MEASURE tiny JSON wall_seconds='.round((hrtime(true) - $started) / 1e9, 3).PHP_EOL;
    });
    check('live synthetic educational JSON preserves readings and arithmetic', function () use ($service) {
        $started = hrtime(true);
        $answer = $service->chat([['role' => 'user', 'content' => 'Original software-test exercise, not official curriculum: compare 20 and 30 degrees Celsius, then calculate the rise from 22 to 27 degrees Celsius. Return only {"warmer_celsius":30,"rise_celsius":5}. /no_think']]);
        echo 'MEASURE synthetic educational JSON wall_seconds='.round((hrtime(true) - $started) / 1e9, 3).' output='.json_encode($answer, JSON_THROW_ON_ERROR).PHP_EOL;
        ensure($answer === ['warmer_celsius' => 30, 'rise_celsius' => 5], 'Unexpected synthetic educational answer.');
    });
    check('live missing model produces sanitized model-unavailable error', function () use ($service, $messages) {
        $original = config('services.ollama.model');
        try {
            config(['services.ollama.model' => 'mgaems-connectivity-probe-missing:never-installed']);
            fails(fn () => $service->chat($messages), 'The Ollama model is unavailable. Check OLLAMA_MODEL and installed models.');
        } finally {
            config(['services.ollama.model' => $original]);
        }
    });
    echo $passed.' live checks passed; no database connection configured.'.PHP_EOL;
    exit(0);
}

config(['services.ollama' => ['base_url' => 'http://ollama.test:11434/', 'model' => 'qwen3:1.7b', 'timeout' => 120]]);
$envelope = ['done' => true, 'message' => ['role' => 'assistant', 'content' => '{"status":"ok","nested":{"items":[1,2]}}']];

check('transport resolves without changing teaching provider selection', function () use ($app) {
    foreach (['disabled' => 'unavailable', 'mock' => 'mock', 'http' => 'http', 'ollama' => 'ollama'] as $driver => $name) {
        config(['services.ai.driver' => $driver]);
        ensure($app->make(TeachingAssistantProvider::class)->name() === $name, 'Existing provider binding changed.');
    }
});
check('tags request uses configured URL and parses model list', function () use ($service) {
    fake(fn () => Http::response(['models' => [['name' => 'qwen3:1.7b']]]));
    ensure($service->models() === [['name' => 'qwen3:1.7b']], 'Model list parsing failed.');
    Http::assertSent(fn ($request) => $request->method() === 'GET' && $request->url() === 'http://ollama.test:11434/api/tags');
});
check('chat uses non-streamed JSON, configured model/timeouts and parses nested content', function () use ($service, $messages, $envelope) {
    fake(function ($request, $options) use ($envelope) {
        ensure($options['timeout'] === 120 && $options['connect_timeout'] === 10 && $options['allow_redirects'] === false, 'Transport limits changed.');

        return Http::response($envelope);
    });
    ensure($service->chat($messages) === ['status' => 'ok', 'nested' => ['items' => [1, 2]]], 'Content parsing failed.');
    Http::assertSent(fn ($request) => $request->method() === 'POST' && $request->url() === 'http://ollama.test:11434/api/chat'
        && $request->data() === ['model' => 'qwen3:1.7b', 'messages' => $messages, 'stream' => false, 'format' => 'json']);
});
check('timeout and connection failures are sanitized', function () use ($service, $messages) {
    foreach (['cURL error 28: secret timeout details', 'cURL error 7: secret connection details'] as $details) {
        fake(function () use ($details) {
            throw new ConnectionException($details);
        });
        fails(fn () => $service->chat($messages), 'Ollama could not be reached or the request timed out.');
    }
});
check('unavailable model and HTTP failures never expose upstream bodies', function () use ($service, $messages) {
    foreach ([404, 429, 500] as $status) {
        fake(fn () => Http::response(['error' => 'private upstream details'], $status));
        fails(fn () => $service->chat($messages), $status === 404
            ? 'The Ollama model is unavailable. Check OLLAMA_MODEL and installed models.'
            : 'Ollama could not complete the request (HTTP '.$status.').');
    }
});
check('invalid outer JSON and upstream error envelopes are rejected', function () use ($service) {
    foreach (['broken' => 'Ollama returned invalid JSON.', '[]' => 'Ollama must return a JSON object.', '{"error":"private details"}' => 'Ollama returned an error response.'] as $body => $error) {
        fake(fn () => Http::response($body));
        fails(fn () => $service->models(), $error);
    }
});
check('malformed model lists are rejected', function () use ($service) {
    foreach ([(object) [], ['models' => null], ['models' => 'invalid'], ['models' => [['name' => '']]]] as $body) {
        fake(fn () => Http::response(json_encode($body, JSON_THROW_ON_ERROR)));
        fails(fn () => $service->models(), 'Ollama returned an invalid model list.');
    }
});
check('invalid generated JSON and non-object content are rejected', function () use ($service, $messages, $envelope) {
    foreach (['broken' => 'Ollama returned invalid JSON.', '[]' => 'Ollama must return a JSON object.', 'null' => 'Ollama must return a JSON object.'] as $body => $error) {
        $result = $envelope;
        $result['message']['content'] = $body;
        fake(fn () => Http::response($result));
        fails(fn () => $service->chat($messages), $error);
    }
});
check('incomplete, truncated and malformed chat responses are rejected', function () use ($service, $messages, $envelope) {
    foreach ([['done' => false], ['done_reason' => 'length'], ['message' => ['role' => 'user', 'content' => '{}']], ['message' => ['role' => 'assistant', 'content' => null]]] as $override) {
        fake(fn () => Http::response(array_replace($envelope, $override)));
        fails(fn () => $service->chat($messages), 'Ollama did not return a completed assistant response.');
    }
});
check('invalid configuration fails without network calls', function () use ($service) {
    fake(fn () => throw new RuntimeException('Unexpected network call.'));
    foreach ([['base_url' => 'file:///tmp/no'], ['timeout' => 0], ['timeout' => 'invalid']] as $override) {
        $original = config('services.ollama');
        try {
            config(['services.ollama' => array_replace($original, $override)]);
            fails(fn () => $service->models(), 'Configure a valid OLLAMA_BASE_URL and positive OLLAMA_TIMEOUT.');
        } finally {
            config(['services.ollama' => $original]);
        }
    }
    Http::assertNothingSent();
});
check('invalid messages cannot trigger inference', function () use ($service) {
    fake(fn () => throw new RuntimeException('Unexpected network call.'));
    foreach ([[], [['role' => 'tool', 'content' => 'invalid']], [['role' => 'user', 'content' => 'text', 'images' => ['invalid']]]] as $messages) {
        try {
            $service->chat($messages);
        } catch (InvalidArgumentException) {
            continue;
        }
        throw new RuntimeException('Invalid messages accepted.');
    }
    Http::assertNothingSent();
});
echo $passed.' isolated checks passed; no database connections or live HTTP allowed.'.PHP_EOL;
