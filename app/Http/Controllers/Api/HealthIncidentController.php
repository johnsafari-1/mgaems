<?php

namespace App\Http\Controllers\Api;

use App\Models\SchoolHealthIncident;
use App\Models\Student;
use App\Services\HealthContext;
use App\Services\HealthHistory;
use App\Services\HealthInput;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class HealthIncidentController extends HealthController
{
    public function index(Request $request)
    {
        return $this->run($request, function ($actor) use ($request) {
            $filters = $request->validate(['student_id' => ['sometimes', 'integer', 'min:1']]);
            $query = SchoolHealthIncident::query();
            if (isset($filters['student_id'])) {
                $query->where('student_id', $filters['student_id']);
            }
            $this->audit($actor, 'list', 'incident');

            return $this->listing($request, $query);
        });
    }

    public function store(Request $request)
    {
        return $this->run($request, function ($actor) use ($request) {
            $input = new HealthInput;
            $data = $input->normalize($request->validate($input->incident() + [
                'student_id' => ['required', 'integer', 'exists:students,id'], 'request_id' => ['required', 'uuid'],
            ]));
            $hash = $this->hash($data + ['actor_id' => $actor->id]);
            $existing = SchoolHealthIncident::where('request_id', $data['request_id'])->lockForUpdate()->first();
            if ($existing) {
                if (! hash_equals($existing->request_hash, $hash)) {
                    (new HealthHistory)->conflict('IDEMPOTENCY_CONFLICT');
                }
                $this->audit($actor, 'replay', 'incident', $existing->id);

                return $this->record($existing, 200, 'replayed');
            }
            $student = Student::whereKey($data['student_id'])->sharedLock()->firstOrFail();
            $record = SchoolHealthIncident::create($data + (new HealthContext)->capture($student, $data['occurred_at']) + [
                'recorded_at' => now(), 'recorded_by' => $actor->id, 'status' => 'open', 'disposition' => 'none', 'request_hash' => $hash,
            ]);
            (new HealthHistory)->append($record, $actor, 'creation');
            $this->audit($actor, 'create', 'incident', $record->id);

            return $this->record($record, 201, 'created');
        });
    }

    public function show(Request $request, string $incident)
    {
        return $this->run($request, function ($actor) use ($incident) {
            $record = SchoolHealthIncident::findOrFail($incident);
            $this->audit($actor, 'read', 'incident', $record->id);

            return $this->record($record);
        });
    }

    public function update(Request $request, string $incident)
    {
        return $this->run($request, function ($actor) use ($request, $incident) {
            $record = SchoolHealthIncident::whereKey($incident)->lockForUpdate()->firstOrFail();
            $correction = $this->correction($request, $record);
            $input = new HealthInput;
            $data = $input->normalize($input->merged($request, $record, $input->incident()));
            foreach (['actions' => 'action_at', 'notifications' => 'attempted_at', 'referrals' => 'referred_at'] as $relation => $time) {
                // Query bindings otherwise discard microseconds on this connection.
                if ($record->$relation()->where($time, '<', $record->fromDateTime($data['occurred_at']))->exists()) {
                    throw ValidationException::withMessages(['occurred_at' => 'An incident cannot start after its recorded actions, notifications or referrals.']);
                }
            }
            if ($record->occurred_at->copy()->setTimezone(config('app.timezone'))->toDateString()
                !== $data['occurred_at']->copy()->setTimezone(config('app.timezone'))->toDateString()) {
                $student = Student::whereKey($record->student_id)->sharedLock()->firstOrFail();
                $record->fill((new HealthContext)->capture($student, $data['occurred_at']));
            }
            $record->fill($data);
            (new HealthHistory)->append($record, $actor, 'correction', $correction['correction_reason']);
            $this->audit($actor, 'correct', 'incident', $record->id);

            return $this->record($record);
        });
    }

    public function revisions(Request $request, string $incident)
    {
        return $this->run($request, fn ($actor) => $this->history($request, SchoolHealthIncident::findOrFail($incident), $actor));
    }
}
