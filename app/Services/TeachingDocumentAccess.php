<?php

namespace App\Services;

use App\Models\ClassSubjectTeacher;
use App\Models\Role;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Shared authorization for teaching documents: schemes of work, lesson plans,
 * and records of work. Every document is anchored to one existing term-specific
 * class_subject_teacher allocation, so teacher rights follow that exact
 * allocation and active teaching-staff link rather than class ownership,
 * client-supplied identities, or timetable rows.
 */
class TeachingDocumentAccess
{
    public const LEADERS = [Role::SYSTEM_ADMIN, Role::HEAD_TEACHER, Role::DEPUTY_HEAD_TEACHER];

    public function user(?User $user, bool $lock = false): User
    {
        abort_unless($user, 401, 'Authentication required.');
        $query = User::with('role')->whereKey($user->id);
        if ($lock) $query->sharedLock();
        $current = $query->firstOrFail();
        abort_unless($current->status === 'active', 403, 'An active account is required.');
        abort_unless($this->leader($current) || $current->hasRole(Role::TEACHER), 403, 'Teaching document access is restricted.');

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

    /** List scope: school-wide for leadership, own allocations for teachers. */
    public function readable(User $user, string $model): Builder
    {
        $query = $model::query();
        if ($this->leader($user)) return $query;
        $staff = $this->staff($user);

        return $query->whereHas('assignment', fn ($assignment) => $assignment->where('staff_id', $staff->id));
    }

    /** Single-document scope: same allocation rule as the list scope. */
    public function document(User $user, string $model, int $id, bool $lock = false): Model
    {
        $query = $model::whereKey($id);
        if (! $this->leader($user)) {
            $staff = $this->staff($user, $lock);
            $query->whereHas('assignment', fn ($assignment) => $assignment->where('staff_id', $staff->id));
        }
        if ($lock) $query->lockForUpdate();

        return $query->firstOrFail();
    }
}
