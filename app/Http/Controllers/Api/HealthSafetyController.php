<?php

namespace App\Http\Controllers\Api;

use App\Models\HealthSafetyAlert;
use App\Services\HealthAccess;
use Illuminate\Http\Request;

class HealthSafetyController extends HealthController
{
    public function show(Request $request, string $student)
    {
        return $this->run($request, function ($actor, $staff) use ($student) {
            if (! (new HealthAccess)->learners($staff)->whereKey($student)->exists()) {
                (new HealthAccess)->deny();
            }
            $today = now()->toDateString();
            $alerts = HealthSafetyAlert::whereHas('profile', fn ($profile) => $profile->where('student_id', $student))
                ->where('is_active', true)->where('starts_on', '<=', $today)
                ->where(fn ($ends) => $ends->whereNull('ends_on')->orWhere('ends_on', '>=', $today))
                ->orderBy('id')->get(['id', 'alert_type', 'description', 'emergency_instructions']);
            $this->audit($actor, 'read_safety', 'learner', (int) $student);

            return response()->json(['data' => ['student_id' => (int) $student, 'alerts' => $alerts->map(fn ($alert) => $alert->only(['id', 'alert_type', 'description', 'emergency_instructions']))]]);
        }, 'safety');
    }
}
