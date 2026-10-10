<?php

namespace App\Http\Controllers\Api;

use App\Models\LearnerHealthProfile;
use App\Models\Student;
use App\Services\HealthHistory;
use App\Services\HealthInput;
use Illuminate\Http\Request;

class HealthProfileController extends HealthController
{
    public function index(Request $request)
    {
        return $this->run($request, function ($actor) use ($request) {
            $filters = $request->validate(['student_id' => ['sometimes', 'integer', 'min:1']]);
            $query = LearnerHealthProfile::query();
            if (isset($filters['student_id'])) {
                $query->where('student_id', $filters['student_id']);
            }
            $this->audit($actor, 'list', 'profile');

            return $this->listing($request, $query);
        });
    }

    public function store(Request $request)
    {
        return $this->run($request, function ($actor) use ($request) {
            if (! $request->exists('allergy_information_state')) {
                $request->merge(['allergy_information_state' => 'unknown']);
            }
            $input = new HealthInput;
            $data = $request->validate($input->profile() + ['student_id' => ['required', 'integer', 'exists:students,id']]);
            $input->profileState($data);
            Student::whereKey($data['student_id'])->sharedLock()->firstOrFail();
            if (LearnerHealthProfile::where('student_id', $data['student_id'])->exists()) {
                (new HealthHistory)->conflict('PROFILE_EXISTS');
            }
            $profile = LearnerHealthProfile::create($data + ['recorded_by' => $actor->id, 'recorded_at' => now()]);
            (new HealthHistory)->append($profile, $actor, 'creation');
            $this->audit($actor, 'create', 'profile', $profile->id);

            return $this->record($profile, 201);
        });
    }

    public function show(Request $request, string $profile)
    {
        return $this->run($request, function ($actor) use ($profile) {
            $record = LearnerHealthProfile::findOrFail($profile);
            $this->audit($actor, 'read', 'profile', $record->id);

            return $this->record($record);
        });
    }

    public function update(Request $request, string $profile)
    {
        return $this->run($request, function ($actor) use ($request, $profile) {
            $record = LearnerHealthProfile::whereKey($profile)->lockForUpdate()->firstOrFail();
            $correction = $this->correction($request, $record);
            $input = new HealthInput;
            $data = $input->merged($request, $record, $input->profile());
            $input->profileState($data);
            $record->fill($data)->forceFill(['reviewed_at' => null, 'reviewed_by' => null]);
            (new HealthHistory)->append($record, $actor, 'correction', $correction['correction_reason']);
            $this->audit($actor, 'correct', 'profile', $record->id);

            return $this->record($record);
        });
    }

    public function review(Request $request, string $profile)
    {
        return $this->run($request, function ($actor) use ($request, $profile) {
            $record = LearnerHealthProfile::whereKey($profile)->lockForUpdate()->firstOrFail();
            $data = $this->correction($request, $record);
            $record->forceFill(['reviewed_by' => $actor->id, 'reviewed_at' => now()]);
            (new HealthHistory)->append($record, $actor, 'review', $data['correction_reason']);
            $this->audit($actor, 'review', 'profile', $record->id);

            return $this->record($record);
        });
    }

    public function revisions(Request $request, string $profile)
    {
        return $this->run($request, fn ($actor) => $this->history($request, LearnerHealthProfile::findOrFail($profile), $actor));
    }
}
