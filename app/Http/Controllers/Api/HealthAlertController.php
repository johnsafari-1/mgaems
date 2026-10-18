<?php

namespace App\Http\Controllers\Api;

use App\Models\HealthSafetyAlert;
use App\Models\LearnerHealthProfile;
use App\Services\HealthHistory;
use App\Services\HealthInput;
use Illuminate\Http\Request;

class HealthAlertController extends HealthController
{
    private function alert(string $profile, string $alert, bool $lock = false): HealthSafetyAlert
    {
        $query = HealthSafetyAlert::where('profile_id', $profile)->whereKey($alert);
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->firstOrFail();
    }

    public function index(Request $request, string $profile)
    {
        return $this->run($request, function ($actor) use ($request, $profile) {
            $parent = LearnerHealthProfile::findOrFail($profile);
            $this->audit($actor, 'list_alerts', 'profile', $parent->id);

            return $this->listing($request, $parent->alerts());
        });
    }

    public function store(Request $request, string $profile)
    {
        return $this->run($request, function ($actor) use ($request, $profile) {
            $parent = LearnerHealthProfile::whereKey($profile)->sharedLock()->firstOrFail();
            $data = $request->validate((new HealthInput)->alert() + ['request_id' => ['required', 'uuid']]);
            $hash = $this->hash($data + ['profile_id' => $parent->id, 'actor_id' => $actor->id]);
            $existing = HealthSafetyAlert::where('request_id', $data['request_id'])->lockForUpdate()->first();
            if ($existing) {
                if ((int) $existing->profile_id !== $parent->id || ! hash_equals($existing->request_hash, $hash)) {
                    (new HealthHistory)->conflict('IDEMPOTENCY_CONFLICT');
                }
                $this->audit($actor, 'replay', 'alert', $existing->id);

                return $this->record($existing, 200, 'replayed');
            }
            $record = HealthSafetyAlert::create($data + ['profile_id' => $parent->id, 'request_hash' => $hash]);
            (new HealthHistory)->append($record, $actor, 'creation');
            $this->audit($actor, 'create', 'alert', $record->id);

            return $this->record($record, 201);
        });
    }

    public function show(Request $request, string $profile, string $alert)
    {
        return $this->run($request, function ($actor) use ($profile, $alert) {
            $record = $this->alert($profile, $alert);
            $this->audit($actor, 'read', 'alert', $record->id);

            return $this->record($record);
        });
    }

    public function update(Request $request, string $profile, string $alert)
    {
        return $this->run($request, function ($actor) use ($request, $profile, $alert) {
            $record = $this->alert($profile, $alert, true);
            $correction = $this->correction($request, $record);
            $input = new HealthInput;
            $data = $input->merged($request, $record, $input->alert());
            $change = $record->is_active !== (bool) $data['is_active'] ? ($data['is_active'] ? 'activation' : 'deactivation') : 'correction';
            $record->fill($data)->forceFill(['verified_by' => null, 'verified_at' => null, 'verification_basis' => null]);
            (new HealthHistory)->append($record, $actor, $change, $correction['correction_reason']);
            $this->audit($actor, $change, 'alert', $record->id);

            return $this->record($record);
        });
    }

    public function verify(Request $request, string $profile, string $alert)
    {
        return $this->run($request, function ($actor) use ($request, $profile, $alert) {
            $record = $this->alert($profile, $alert, true);
            $correction = $this->correction($request, $record);
            $data = $request->validate(['verification_basis' => ['required', 'string', 'max:200']]);
            $record->forceFill($data + ['verified_by' => $actor->id, 'verified_at' => now()]);
            (new HealthHistory)->append($record, $actor, 'verification', $correction['correction_reason']);
            $this->audit($actor, 'verify', 'alert', $record->id);

            return $this->record($record);
        });
    }

    public function revisions(Request $request, string $profile, string $alert)
    {
        return $this->run($request, fn ($actor) => $this->history($request, $this->alert($profile, $alert), $actor));
    }
}
