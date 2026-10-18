<?php

namespace App\Services;

use App\Models\SchoolClass;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

/** Daily attendance follows class teachers, never subject allocations. */
class AttendanceAccess
{
    public function classes(?User $user, bool $lockStaff = false): Builder
    {
        abort_unless($user && $user->status === 'active', 403, 'An active attendance account is required.');
        $role = $user->role?->name;
        if (in_array($role, ['system_admin', 'head_teacher', 'deputy_head_teacher'], true)) return SchoolClass::query();
        abort_unless($role === 'teacher', 403, 'Attendance administration is not permitted for this role.');

        $staff = Staff::where('user_id', $user->id)->where('status', 'active')->where('staff_type', 'teaching');
        if ($lockStaff) $staff->lockForUpdate();
        $teacher = $staff->first();
        abort_unless($teacher, 403, 'Your account must be linked to active teaching staff before managing class attendance.');

        return SchoolClass::where('class_teacher_id', $teacher->id);
    }

    public function authorizeClass(?User $user, int $classId, bool $lock = false): SchoolClass
    {
        // Same class -> staff lock order used by Academic class-teacher changes.
        $class = SchoolClass::whereKey($classId);
        if ($lock) $class->lockForUpdate();
        $selected = $class->firstOrFail();
        abort_unless($this->classes($user, $lock)->whereKey($classId)->exists(), 403, 'You may manage attendance only for your Class Teacher classes.');

        return $selected;
    }
}
