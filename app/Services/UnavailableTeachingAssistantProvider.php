<?php

namespace App\Services;

use App\Contracts\TeachingAssistantProvider;
use RuntimeException;

class UnavailableTeachingAssistantProvider implements TeachingAssistantProvider
{
    public function name(): string { return 'unavailable'; }
    public function available(): bool { return false; }
    public function draft(string $operation, array $input): array { throw new RuntimeException('No AI Teaching Assistant provider is configured. Manual authoring remains available.'); }
}
