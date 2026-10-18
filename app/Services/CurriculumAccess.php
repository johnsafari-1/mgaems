<?php

namespace App\Services;

use App\Models\Role;
use App\Models\User;

class CurriculumAccess
{
    public function administrator(?User $user): User
    {
        abort_unless($user, 401);
        $current = User::with('role')->findOrFail($user->id);
        abort_unless($current->status === 'active' && $current->hasRole(Role::SYSTEM_ADMIN), 403, 'Curriculum library administration requires an active system administrator.');

        return $current;
    }
}
