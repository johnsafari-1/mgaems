<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;
use JsonException;
use RuntimeException;
use stdClass;

/**
 * Server-side transport only. Callers must supply non-identifying educational
 * content and validate operation-specific output before offering it for review.
 * This service never reads or writes school records or logs prompt content.
 */
class OllamaService
{
    /** @return list<array<string, mixed>> */
    public function models(): array
    {
        $models = $this->request('GET', '/api/tags')['models'] ?? null;
        if (! is_array($models) || ! array_is_list($models)) {
            throw new RuntimeException('Ollama returned an invalid model list.');
        }

        foreach ($models as $model) {
            if (! is_array($model) || ! is_string($model['name'] ?? null) || trim($model['name']) === '') {
                throw new RuntimeException('Ollama returned an invalid model list.');
            }
        }

        return $models;
    }

    /**
     * Request a completed JSON object, not a stream or tool invocation.
     * JSON syntax validation here does not replace a generator's JSON schema.
     *
     * @param  list<array{role: string, content: string}>  $messages
     * @return array<string, mixed>
     */
    public function chat(array $messages): array
    {
        if ($messages === [] || ! array_is_list($messages)) {
            throw new InvalidArgumentException('Ollama requires a list of text messages.');
        }
        foreach ($messages as $message) {
            if (! is_array($message) || array_diff(array_keys($message), ['role', 'content']) !== []
                || ! in_array($message['role'] ?? null, ['system', 'user', 'assistant'], true)
                || ! is_string($message['content'] ?? null) || trim($message['content']) === '') {
                throw new InvalidArgumentException('Ollama requires role and content text messages only.');
            }
        }

        $model = config('services.ollama.model');
        if (! is_string($model) || trim($model) === '') {
            throw new RuntimeException('Configure OLLAMA_MODEL before using Ollama.');
        }

        $result = $this->request('POST', '/api/chat', [
            'model' => $model,
            'messages' => $messages,
            'stream' => false,
            'format' => 'json',
        ]);

        if (($result['done'] ?? null) !== true || ($result['done_reason'] ?? null) === 'length'
            || ($result['message']['role'] ?? null) !== 'assistant'
            || ! is_string($result['message']['content'] ?? null)) {
            throw new RuntimeException('Ollama did not return a completed assistant response.');
        }

        return $this->jsonObject($result['message']['content']);
    }

    private function request(string $method, string $path, array $payload = []): array
    {
        $baseUrl = config('services.ollama.base_url');
        $timeout = filter_var(config('services.ollama.timeout'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if (! is_string($baseUrl) || ! filter_var($baseUrl, FILTER_VALIDATE_URL)
            || ! in_array(parse_url($baseUrl, PHP_URL_SCHEME), ['http', 'https'], true) || $timeout === false) {
            throw new RuntimeException('Configure a valid OLLAMA_BASE_URL and positive OLLAMA_TIMEOUT.');
        }

        try {
            $response = Http::acceptJson()->asJson()->connectTimeout(min(10, $timeout))->timeout($timeout)
                ->withOptions(['allow_redirects' => false])
                ->send($method, rtrim($baseUrl, '/').$path, $method === 'POST' ? ['json' => $payload] : []);
        } catch (ConnectionException) {
            // Do not expose transport details, request bodies or upstream output.
            throw new RuntimeException('Ollama could not be reached or the request timed out.');
        }

        if ($path === '/api/chat' && $response->status() === 404) {
            throw new RuntimeException('The Ollama model is unavailable. Check OLLAMA_MODEL and installed models.');
        }
        if (! $response->successful()) {
            throw new RuntimeException('Ollama could not complete the request (HTTP '.$response->status().').');
        }

        $result = $this->jsonObject($response->body());
        if (array_key_exists('error', $result)) {
            throw new RuntimeException('Ollama returned an error response.');
        }

        return $result;
    }

    private function jsonObject(string $json): array
    {
        try {
            if (! (json_decode($json, false, 512, JSON_THROW_ON_ERROR) instanceof stdClass)) {
                throw new RuntimeException('Ollama must return a JSON object.');
            }

            return json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new RuntimeException('Ollama returned invalid JSON.');
        }
    }
}
