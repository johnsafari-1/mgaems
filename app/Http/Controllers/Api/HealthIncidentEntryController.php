<?php

namespace App\Http\Controllers\Api;

use App\Models\Guardian;
use App\Models\HealthRecord;
use App\Models\SchoolHealthIncident;
use App\Services\HealthHistory;
use App\Services\HealthInput;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

abstract class HealthIncidentEntryController extends HealthController
{
    private function parent(string $id): SchoolHealthIncident
    {
        return SchoolHealthIncident::whereKey($id)->lockForUpdate()->firstOrFail();
    }

    private function entry(string $incident, string $id): HealthRecord
    {
        return static::MODEL::where('incident_id', $incident)->whereKey($id)->lockForUpdate()->firstOrFail();
    }

    public function index(Request $request, string $incident)
    {
        return $this->run($request, function ($actor) use ($request, $incident) {
            $parent = $this->parent($incident);
            $this->audit($actor, 'list_'.static::TYPE, 'incident', $parent->id);

            return $this->listing($request, static::MODEL::where('incident_id', $parent->id));
        });
    }

    public function show(Request $request, string $incident, string $entry)
    {
        return $this->run($request, function ($actor) use ($incident, $entry) {
            $record = $this->entry($incident, $entry);
            $this->audit($actor, 'read', static::TYPE, $record->id);

            return $this->record($record);
        });
    }

    public function store(Request $request, string $incident)
    {
        return $this->run($request, function ($actor) use ($request, $incident) {
            $parent = $this->parent($incident);
            $input = new HealthInput;
            $rules = $input->entry(static::TYPE) + ['request_id' => ['required', 'uuid'], 'expected_incident_revision' => ['required', 'integer', 'min:1']];
            if (static::TYPE === 'notification') {
                $rules['guardian_id'] = ['nullable', 'integer', 'min:1'];
            }
            $data = $input->normalize($request->validate($rules));
            $hash = $this->hash($data + ['incident_id' => $parent->id, 'actor_id' => $actor->id]);
            $existing = static::MODEL::where('request_id', $data['request_id'])->lockForUpdate()->first();
            if ($existing) {
                if ((int) $existing->incident_id !== $parent->id || ! hash_equals($existing->request_hash, $hash)) {
                    (new HealthHistory)->conflict('IDEMPOTENCY_CONFLICT');
                }
                $this->audit($actor, 'replay', static::TYPE, $existing->id);

                return $this->record($existing, 200, 'replayed');
            }
            (new HealthHistory)->expect($parent, $data['expected_incident_revision']);
            unset($data['expected_incident_revision']);
            $this->checkTime($parent, $data);
            if (static::TYPE === 'notification') {
                $guardian = isset($data['guardian_id']) ? Guardian::whereKey($data['guardian_id'])->where('student_id', $parent->student_id)->sharedLock()->first() : null;
                if (isset($data['guardian_id']) && ! $guardian) {
                    throw ValidationException::withMessages(['guardian_id' => 'Choose an existing Guardian relationship for this learner.']);
                }
                $data['contact_snapshot'] = [
                    'guardian_id_at_recording' => $guardian?->id,
                    'guardian_name_at_recording' => $guardian?->full_name, 'contact_used' => $data['contact_used'] ?? null,
                    'basis' => 'recording_time_relationship', 'captured_at' => now()->toISOString(),
                ];
                unset($data['contact_used']);
            }
            if (static::TYPE === 'action') {
                $this->transition($parent, $data);
            }
            $record = static::MODEL::create($data + ['incident_id' => $parent->id, 'actor_id' => $actor->id, 'recorded_at' => now(), 'request_hash' => $hash]);
            (new HealthHistory)->append($record, $actor, 'creation');
            (new HealthHistory)->append($parent, $actor, static::TYPE.'_added');
            $this->audit($actor, 'create', static::TYPE, $record->id);
            $this->audit($actor, static::TYPE.'_added', 'incident', $parent->id);

            return $this->record($record, 201, 'created');
        });
    }

    public function update(Request $request, string $incident, string $entry)
    {
        return $this->run($request, function ($actor) use ($request, $incident, $entry) {
            $parent = $this->parent($incident);
            $record = $this->entry($incident, $entry);
            $correction = $this->correction($request, $record);
            $version = $request->validate(['expected_incident_revision' => ['required', 'integer', 'min:1']]);
            (new HealthHistory)->expect($parent, $version['expected_incident_revision']);
            $input = new HealthInput;
            $rules = $input->entry(static::TYPE);
            // A correction never retroactively applies or rewrites a status transition.
            if (static::TYPE === 'action') {
                unset($rules['status_after'], $rules['disposition_after']);
                $request->validate(['status_after' => ['prohibited'], 'disposition_after' => ['prohibited']]);
            }
            if (static::TYPE === 'notification') {
                $request->validate(['guardian_id' => ['prohibited']]);
                $rules['contact_used'] = ['sometimes', 'nullable', 'string', 'max:200'];
            }
            $data = $input->normalize($input->merged($request, $record, $rules));
            $this->checkTime($parent, $data);
            if (static::TYPE === 'notification') {
                $snapshot = $record->contact_snapshot;
                if ($request->exists('contact_used')) {
                    $snapshot['contact_used'] = $data['contact_used'];
                }
                $data['contact_snapshot'] = $snapshot;
                unset($data['contact_used']);
            }
            $record->fill($data);
            (new HealthHistory)->append($record, $actor, 'correction', $correction['correction_reason']);
            (new HealthHistory)->append($parent, $actor, static::TYPE.'_corrected', $correction['correction_reason']);
            $this->audit($actor, 'correct', static::TYPE, $record->id);
            $this->audit($actor, static::TYPE.'_corrected', 'incident', $parent->id);

            return $this->record($record);
        });
    }

    public function revisions(Request $request, string $incident, string $entry)
    {
        return $this->run($request, fn ($actor) => $this->history($request, $this->entry($incident, $entry), $actor));
    }

    private function checkTime(SchoolHealthIncident $incident, array $data): void
    {
        $key = match (static::TYPE) {
            'action' => 'action_at', 'notification' => 'attempted_at', 'referral' => 'referred_at'
        };
        if ($data[$key]->lt($incident->occurred_at)) {
            throw ValidationException::withMessages([$key => 'This time cannot precede the incident occurrence.']);
        }
    }

    private function transition(SchoolHealthIncident $incident, array $data): void
    {
        $status = $data['status_after'] ?? null;
        $disposition = $data['disposition_after'] ?? null;
        if (($status === null) !== ($disposition === null)) {
            throw ValidationException::withMessages(['status_after' => 'A transition requires both operational status and disposition.']);
        }
        if ($status === null) {
            return;
        }
        if (($status === 'closed' && $disposition === 'none')
            || ($incident->status === 'closed' && $status !== 'closed' && ! in_array($data['action_type'], ['follow_up', 'status_change'], true))) {
            throw ValidationException::withMessages(['status_after' => 'Use an explicit follow-up to reopen an incident, and record a disposition when closing it.']);
        }
        $incident->fill(['status' => $status, 'disposition' => $disposition]);
    }
}
