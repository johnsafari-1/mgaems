<?php

namespace App\Services;

use App\Contracts\TeachingAssistantProvider;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class HttpTeachingAssistantProvider implements TeachingAssistantProvider
{
    public function name(): string { return 'http'; }
    public function available(): bool { return (bool) config('services.ai.endpoint') && (bool) config('services.ai.key'); }
    public function draft(string $operation, array $input): array
    {
        if (! $this->available()) throw new RuntimeException('No AI Teaching Assistant provider is configured. Manual authoring remains available.');
        $response = Http::timeout((int) config('services.ai.timeout', 20))->withToken(config('services.ai.key'))
            ->acceptJson()->post(config('services.ai.endpoint'), ['operation' => $operation, 'model' => config('services.ai.model'), 'input' => $input]);
        if (! $response->successful() || ! is_array($response->json('draft'))) throw new RuntimeException('The configured AI provider did not return a usable draft.');
        return ['label' => 'AI-generated draft (configured provider)', 'disclosure' => 'External AI output is a draft only and requires human review before saving, approval or publication.', 'draft' => $response->json('draft')];
    }
}
