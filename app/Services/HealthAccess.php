<?php

namespace App\Services;

use App\Models\Role;
use App\Models\Staff;
use App\Models\Student;
use App\Models\User;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Laravel\Sanctum\PersonalAccessToken;

class HealthAccess
{
    public function actor(Request $request, string $mode, bool $lock = false): array
    {
        $query = User::with('role')->whereKey($request->user()?->id);
        if ($lock) {
            $query->sharedLock();
        }
        $user = $query->first();
        $roles = $mode === 'safety' ? [Role::TEACHER] : [Role::HEAD_TEACHER, Role::DEPUTY_HEAD_TEACHER];
        if (! $user || $user->status !== 'active' || ! in_array($user->role?->name, $roles, true)) {
            $this->deny();
        }
        $staff = Staff::where('user_id', $user->id)->where('status', 'active');
        if ($mode === 'safety') {
            $staff->where('staff_type', 'teaching');
        }
        if ($lock) {
            $staff->sharedLock();
        }
        $staff = $staff->first();
        if (! $staff) {
            $this->deny();
        }

        if (! ($request->user()->currentAccessToken() instanceof PersonalAccessToken)) {
            $identity = $request->hasSession() ? $request->session()->get('mgaems_health_identity') : null;
            if (! is_array($identity) || ($identity['user_id'] ?? null) !== $user->id
                || ($identity['session_version'] ?? null) !== (int) $user->session_version) {
                if ($request->hasSession()) {
                    Auth::guard('web')->logoutCurrentDevice();
                    $request->session()->invalidate();
                    $request->session()->regenerateToken();
                }
                throw new HttpResponseException(response()->json(['message' => 'Unauthenticated.'], 401));
            }
        }

        return [$user, $staff];
    }

    public function learners(Staff $staff)
    {
        $today = now()->toDateString();

        return Student::where('status', 'active')->whereHas('schoolClass', function ($class) use ($staff, $today) {
            $class->where(function ($scope) use ($staff, $today) {
                $scope->where('class_teacher_id', $staff->id)->orWhereExists(function ($assignment) use ($staff, $today) {
                    $assignment->selectRaw('1')->from('class_subject_teacher as teaching')
                        ->join('terms as period', 'period.id', '=', 'teaching.term_id')
                        ->join('academic_years as year', 'year.id', '=', 'period.academic_year_id')
                        ->join('subjects as area', 'area.id', '=', 'teaching.subject_id')
                        ->join('class_subjects as offering', function ($join) {
                            $join->on('offering.class_id', '=', 'teaching.class_id')->on('offering.subject_id', '=', 'teaching.subject_id');
                        })
                        ->whereColumn('teaching.class_id', 'classes.id')->where('teaching.staff_id', $staff->id)
                        ->where('area.status', 'active')->where('period.is_current', true)->where('year.is_current', true)
                        ->where('period.start_date', '<=', $today)->where('period.end_date', '>=', $today)
                        ->where('year.start_date', '<=', $today)->where('year.end_date', '>=', $today);
                });
            });
        });
    }

    public function deny(): never
    {
        throw new HttpResponseException(response()->json([
            'error' => ['code' => 'FORBIDDEN', 'message' => 'You do not have permission to access this resource.'],
        ], 403));
    }
}
