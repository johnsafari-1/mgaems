<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Role;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

/**
 * Implements docs/MGAEMS_APIDesign.docx §2 (User Management) and
 * SRS FR-ADM-03 / UC-AUTH-04. All routes are gated by the "role"
 * middleware (see routes/api.php) — System Administrator only.
 */
class UserController extends Controller
{
    public function index(Request $request)
    {
        $perPage = min((int) $request->query('per_page', 15), 100);

        $users = User::with('role')
            ->when($request->query('status'), fn ($q, $status) => $q->where('status', $status))
            ->when($request->query('role'), fn ($q, $roleName) => $q->whereHas('role', fn ($r) => $r->where('name', $roleName)))
            ->orderBy('username')
            ->paginate($perPage);

        return response()->json([
            'data' => $users->through(fn (User $u) => $this->transform($u))->items(),
            'meta' => [
                'page' => $users->currentPage(),
                'per_page' => $users->perPage(),
                'total' => $users->total(),
            ],
        ]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'username' => ['required', 'string', 'max:100', 'unique:users,username'],
            'email' => ['required', 'email', 'max:150', 'unique:users,email'],
            'password' => ['required', 'string', 'min:10'],
            'role' => ['required', Rule::in($this->validRoleNames())],
        ]);

        $role = Role::where('name', $validated['role'])->firstOrFail();

        $user = User::create([
            'username' => $validated['username'],
            'email' => $validated['email'],
            'password_hash' => Hash::make($validated['password']),
            'role_id' => $role->id,
            'status' => 'active',
        ]);

        $auditLogger->log('CREATE_USER', 'User', $user->id, ['role' => $role->name]);

        return response()->json(['data' => $this->transform($user)], 201);
    }

    public function show(User $user)
    {
        return response()->json(['data' => $this->transform($user)]);
    }

    public function update(Request $request, User $user, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'email' => ['sometimes', 'email', 'max:150', Rule::unique('users', 'email')->ignore($user->id)],
            'role' => ['sometimes', Rule::in($this->validRoleNames())],
            'status' => ['sometimes', Rule::in(['active', 'inactive', 'locked'])],
        ]);

        // Guard rail: never allow the last active System Administrator to be
        // demoted/deactivated, per UC-AUTH-04's "prevent lockout" rule.
        if ($this->wouldRemoveLastAdmin($user, $validated)) {
            return response()->json([
                'error' => [
                    'code' => 'LAST_ADMIN_PROTECTED',
                    'message' => 'Cannot change the role/status of the last active System Administrator.',
                ],
            ], 409);
        }

        if (isset($validated['role'])) {
            $validated['role_id'] = Role::where('name', $validated['role'])->firstOrFail()->id;
            unset($validated['role']);
        }

        $user->update($validated);
        $auditLogger->log('UPDATE_USER', 'User', $user->id, ['changes' => array_keys($validated)]);

        return response()->json(['data' => $this->transform($user->fresh('role'))]);
    }

    public function destroy(User $user, AuditLogger $auditLogger)
    {
        if ($this->wouldRemoveLastAdmin($user, ['status' => 'inactive'])) {
            return response()->json([
                'error' => [
                    'code' => 'LAST_ADMIN_PROTECTED',
                    'message' => 'Cannot deactivate the last active System Administrator.',
                ],
            ], 409);
        }

        // Soft deactivation, not a hard delete — preserves audit/history integrity
        // per Database Schema §4 (Referential Integrity Notes).
        $user->update(['status' => 'inactive']);
        $auditLogger->log('DEACTIVATE_USER', 'User', $user->id);

        return response()->json(['data' => ['message' => 'User deactivated.']]);
    }

    private function wouldRemoveLastAdmin(User $user, array $changes): bool
    {
        $isCurrentlyActiveAdmin = $user->hasRole(Role::SYSTEM_ADMIN) && $user->status === 'active';
        $wouldStopBeingActiveAdmin =
            (isset($changes['role']) && $changes['role'] !== Role::SYSTEM_ADMIN) ||
            (isset($changes['status']) && $changes['status'] !== 'active');

        if (! $isCurrentlyActiveAdmin || ! $wouldStopBeingActiveAdmin) {
            return false;
        }

        $activeAdminCount = User::where('status', 'active')
            ->whereHas('role', fn ($r) => $r->where('name', Role::SYSTEM_ADMIN))
            ->count();

        return $activeAdminCount <= 1;
    }

    private function validRoleNames(): array
    {
        return Role::pluck('name')->all();
    }

    private function transform(User $user): array
    {
        return [
            'id' => $user->id,
            'username' => $user->username,
            'email' => $user->email,
            'role' => $user->role?->name,
            'status' => $user->status,
            'last_login_at' => $user->last_login_at,
            'created_at' => $user->created_at,
        ];
    }
}
