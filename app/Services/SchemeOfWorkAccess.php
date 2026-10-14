<?php

namespace App\Services;

use App\Models\ClassSubjectTeacher;
use App\Models\Role;
use App\Models\SchemeOfWork;
use App\Models\Staff;
use App\Models\User;

class SchemeOfWorkAccess
{
    public const LEADERS = [Role::SYSTEM_ADMIN, Role::HEAD_TEACHER, Role::DEPUTY_HEAD_TEACHER];

    public function user(?User $user, bool $lock = false): User
    {
        abort_unless($user, 401, 'Authentication required.');
        $query = User::with('role')->whereKey($user->id);
        if ($lock) $query->sharedLock();
        $current = $query->firstOrFail();
        abort_unless($current->status === 'active', 403, 'An active account is required.');
        abort_unless($this->leader($current) || $current->hasRole(Role::TEACHER), 403, 'Scheme of work access is restricted.');

        return $current;
    }

    public function leader(User $user): bool
    {
        return in_array($user->role?->name, self::LEADERS, true);
    }

    public function staff(User $user, bool $lock = false): Staff
    {
        $query = Staff::where('user_id', $user->id)->where('status', 'active')->where('staff_type', 'teaching');
        if ($lock) $query->sharedLock();
        $staff = $query->first();
        abort_unless($staff, 403, 'Your account must be linked to active teaching staff.');

        return $staff;
    }

    public function assignment(User $user, int $id, bool $lock = false): ClassSubjectTeacher
    {
        $query = ClassSubjectTeacher::whereKey($id);
        if ($lock) $query->lockForUpdate();
        $assignment = $query->firstOrFail();
        if (! $this->leader($user)) {
            abort_unless((int) $assignment->staff_id === (int) $this->staff($user, $lock)->id, 403, 'You are not assigned to this teaching context.');
        }

        return $assignment;
    }

    public function scheme(User $user, int $id, bool $lock = false): SchemeOfWork
    {
        $query = SchemeOfWork::whereKey($id);
        if (! $this->leader($user)) {
            $staff = $this->staff($user, $lock);
            $query->whereHas('assignment', fn ($assignment) => $assignment->where('staff_id', $staff->id));
        }
        if ($lock) $query->lockForUpdate();

        return $query->firstOrFail();
    }

    public function readable(User $user)
    {
        $query = SchemeOfWork::query();
        if ($this->leader($user)) return $query;
        $staff = $this->staff($user);

        return $query->whereHas('assignment', fn ($assignment) => $assignment->where('staff_id', $staff->id));
    }
}
