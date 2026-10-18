<?php

namespace App\Services;

use App\Models\HealthRecord;
use App\Models\HealthRecordRevision;
use App\Models\User;
use Illuminate\Http\Exceptions\HttpResponseException;

class HealthHistory
{
    public function append(HealthRecord $record, User $actor, string $change, ?string $reason = null): void
    {
        $record->revision_number = (int) $record->revision_number + 1;
        $record->save();
        HealthRecordRevision::create([
            'record_type' => $record::TYPE, 'record_id' => $record->id, 'revision_number' => $record->revision_number,
            'snapshot' => (new HealthView)->record($record), 'change_type' => $change, 'correction_reason' => $reason,
            'actor_id' => $actor->id, 'recorded_at' => now(),
        ]);
    }

    public function expect(HealthRecord $record, int $revision): void
    {
        if ((int) $record->revision_number !== $revision) {
            $this->conflict();
        }
    }

    public function conflict(string $code = 'REVISION_CONFLICT'): never
    {
        throw new HttpResponseException(response()->json([
            'error' => ['code' => $code, 'message' => 'The record changed or this request conflicts with an existing record. Reload before retrying.'],
        ], 409));
    }
}
