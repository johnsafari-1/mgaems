<?php

namespace App\Services;

use App\Models\HealthAccessLog;
use App\Models\User;

/** Health associations must never enter the general administrator-visible audit feed. */
class HealthAudit
{
    public function log(User $actor, string $operation, string $type, ?int $id = null): void
    {
        HealthAccessLog::create([
            'actor_id' => $actor->id, 'operation' => $operation, 'record_type' => $type,
            'record_id' => $id, 'recorded_at' => now(),
        ]);
    }
}
