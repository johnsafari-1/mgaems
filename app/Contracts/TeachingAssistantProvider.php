<?php

namespace App\Contracts;

interface TeachingAssistantProvider
{
    public function name(): string;
    public function available(): bool;
    /** @return array{label:string,disclosure:string,draft:array<string,mixed>} */
    public function draft(string $operation, array $input): array;
}
