<?php

namespace App\Services;

use App\Models\Role;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/** Existing Staff.user_id is the sole account/employment association. */
class StaffAccountLinks
{
    public function summary(User $user): array
    {
        $staff = $user->staff;
        $required = in_array($user->role?->name, Role::STAFF_ROLES, true);
        $reason = $required ? $this->eligibility($user, $staff) : null;

        return [
            'required' => $required,
            'eligible' => $reason === null,
            'reason' => $reason,
            'version' => (int) $user->session_version,
            'staff' => $staff ? $this->staffReference($staff) : null,
        ];
    }

    public function context(Request $request, int $userId): array
    {
        $this->administrator($request, User::with('role')->find($request->user()?->id));
        $user = User::with('role', 'staff')->findOrFail($userId);
        $query = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
        ]);
        $staff = Staff::when($query['search'] ?? null, function ($q, $search) {
            $q->where(fn ($q) => $q->where('first_name', 'like', '%'.$search.'%')->orWhere('last_name', 'like', '%'.$search.'%'));
        })->orderBy('last_name')->orderBy('id')->paginate(20);

        return [
            'user' => ['id' => $user->id, 'username' => $user->username, 'role' => $user->role?->name, 'status' => $user->status],
            'account_link' => $this->summary($user),
            'can_link' => $user->status === 'active' && $this->linkableRole($user->role?->name) && $user->staff === null,
            'staff_options' => $staff->getCollection()->map(function (Staff $staff) use ($user) {
                $reason = $staff->user_id !== null ? 'This Staff identity already has an account.' : $this->eligibility($user, $staff);
                if (! $this->linkableRole($user->role?->name)) {
                    $reason = 'This account role does not use Staff linking.';
                }

                return $this->staffReference($staff) + ['eligible' => $reason === null, 'reason' => $reason];
            })->all(),
            'meta' => ['page' => $staff->currentPage(), 'per_page' => $staff->perPage(), 'total' => $staff->total()],
        ];
    }

    public function change(Request $request, int $userId, AuditLogger $audit): array
    {
        try {
            return DB::transaction(function () use ($request, $userId, $audit) {
                // Same administrative mutex as UserController. All identity changes
                // lock Users before Staff; login/reset also use User-first locking.
                Role::where('name', Role::SYSTEM_ADMIN)->lockForUpdate()->firstOrFail();
                $users = User::with('role')->whereIn('id', [$request->user()?->id, $userId])->orderBy('id')->lockForUpdate()->get()->keyBy('id');
                $this->administrator($request, $users->get($request->user()?->id));
                $user = $users->get($userId);
                abort_unless($user, 404);
                $data = $request->validate([
                    'staff_id' => ['present', 'nullable', 'integer', 'min:1'],
                    'expected_staff_id' => ['present', 'nullable', 'integer', 'min:1'],
                    'expected_session_version' => ['required', 'integer', 'min:0'],
                    'staff_revision' => ['required', 'string', 'size:64', 'regex:/^[a-f0-9]+$/'],
                    'identity_confirmed' => ['required', 'accepted'],
                ]);
                if (array_diff(array_keys($request->all()), array_keys($data))) {
                    throw ValidationException::withMessages(['identity_confirmed' => 'Submit only the reviewed account-link fields.']);
                }
                $current = Staff::where('user_id', $user->id)->first();
                if ((int) $user->session_version !== (int) $data['expected_session_version']
                    || ($current?->id) !== ($data['expected_staff_id'] === null ? null : (int) $data['expected_staff_id'])) {
                    $this->conflict('ACCOUNT_LINK_STALE', 'This account changed. Reload and verify the identities again.');
                }
                if ($data['staff_id'] !== null && $current !== null) {
                    $this->conflict('ACCOUNT_ALREADY_LINKED', 'Remove the existing link with confirmation before linking another Staff identity.');
                }
                $staffId = $data['staff_id'] ?? $current?->id;
                if ($staffId === null) {
                    $this->conflict('ACCOUNT_LINK_STALE', 'This account has no link to remove. Reload its current state.');
                }
                $staff = Staff::whereKey($staffId)->lockForUpdate()->firstOrFail();
                if (! hash_equals($this->revision($staff), $data['staff_revision'])) {
                    $this->conflict('STAFF_LINK_STALE', 'This Staff record changed. Reload and verify the identity again.');
                }
                $linking = $data['staff_id'] !== null;
                if ($linking) {
                    if ($staff->user_id !== null) {
                        $this->conflict('STAFF_ALREADY_LINKED', 'This Staff identity already has an account. No reassignment was made.');
                    }
                    $this->assertRoleCompatible($user->role?->name, $staff);
                    if ($reason = $this->eligibility($user, $staff)) {
                        throw ValidationException::withMessages(['staff_id' => $reason]);
                    }
                } elseif ((int) $staff->user_id !== (int) $user->id) {
                    $this->conflict('ACCOUNT_LINK_STALE', 'The existing link changed. Reload before removing it.');
                }
                $staff->user_id = $linking ? $user->id : null;
                $staff->save();
                $this->revoke($user);
                // Audit failure rolls back the relation, counter and token revocation.
                $audit->log($linking ? 'LINK_STAFF_ACCOUNT' : 'UNLINK_STAFF_ACCOUNT', 'User', $user->id, ['staff_id' => $staff->id]);

                return $this->summary($user->fresh(['role', 'staff']));
            }, 3);
        } catch (QueryException $exception) {
            if (($exception->errorInfo[1] ?? null) === 1062
                || (($exception->errorInfo[1] ?? null) === 19 && str_contains($exception->getMessage(), 'UNIQUE constraint'))) {
                $this->conflict('ACCOUNT_LINK_CONFLICT', 'Another operation claimed this account or Staff identity. Reload before retrying.');
            }

            throw $exception;
        }
    }

    public function updateEmployment(Request $request, Staff $staff, array $changes, AuditLogger $audit): Staff
    {
        return DB::transaction(function () use ($request, $staff, $changes, $audit) {
            Role::where('name', Role::SYSTEM_ADMIN)->lockForUpdate()->firstOrFail();
            $ownerId = Staff::whereKey($staff->id)->value('user_id');
            $users = User::with('role')->whereIn('id', array_filter([$request->user()?->id, $ownerId]))->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $actor = $users->get($request->user()?->id);
            abort_unless($actor && $actor->status === 'active' && in_array($actor->role?->name, [Role::SYSTEM_ADMIN, Role::HEAD_TEACHER, Role::DEPUTY_HEAD_TEACHER], true), 403);
            $this->currentAuthorization($request, $actor);
            if ($actor->role?->name !== Role::SYSTEM_ADMIN) {
                abort_unless($actor->staff()->where('status', 'active')->exists(), 403);
            }
            $staff = Staff::whereKey($staff->id)->lockForUpdate()->firstOrFail();
            if ($staff->user_id !== $ownerId) {
                $this->conflict('STAFF_LINK_STALE', 'The Staff account changed. Reload the employment record.');
            }
            $user = $ownerId ? $users->get($ownerId) : null;
            if ($user && isset($changes['staff_type'])) {
                $probe = clone $staff;
                $probe->staff_type = $changes['staff_type'];
                $this->assertRoleCompatible($user->role?->name, $probe);
            }
            $securityChange = (isset($changes['status']) && $changes['status'] !== $staff->status)
                || (isset($changes['staff_type']) && $changes['staff_type'] !== $staff->staff_type);
            $staff->update($changes);
            if ($user && $securityChange) {
                $this->revoke($user);
            }
            $audit->log('UPDATE_STAFF', 'Staff', $staff->id, ['changes' => array_keys($changes)]);

            return $staff->fresh(['department']);
        }, 3);
    }

    public function assertRoleCompatible(?string $role, Staff $staff): void
    {
        if (! $this->linkableRole($role)) {
            throw ValidationException::withMessages(['role' => 'Remove any existing Staff link before assigning a portal or Student role.']);
        }
        if ($role === Role::TEACHER && $staff->staff_type !== 'teaching') {
            throw ValidationException::withMessages(['staff_id' => 'Teacher accounts require teaching Staff.']);
        }
    }

    private function linkableRole(?string $role): bool
    {
        return in_array($role, [Role::SYSTEM_ADMIN, ...Role::STAFF_ROLES], true);
    }

    private function eligibility(User $user, ?Staff $staff): ?string
    {
        if ($user->status !== 'active') {
            return 'The account is not active.';
        }
        if (! $staff) {
            return 'An active Staff identity has not been linked.';
        }
        if ($staff->status !== 'active') {
            return 'The Staff employment record is not active.';
        }
        if ($user->role?->name === Role::TEACHER && $staff->staff_type !== 'teaching') {
            return 'Teacher accounts require teaching Staff.';
        }

        return null;
    }

    private function administrator(Request $request, ?User $actor): void
    {
        if (! $actor || $actor->status !== 'active' || $actor->role?->name !== Role::SYSTEM_ADMIN) {
            throw new HttpResponseException(response()->json(['error' => ['code' => 'FORBIDDEN', 'message' => 'Only an active System Administrator can manage Staff account links.']], 403));
        }
        $this->currentAuthorization($request, $actor);
    }

    private function currentAuthorization(Request $request, User $actor): void
    {
        $token = $request->user()?->currentAccessToken();
        if ((int) $request->user()->session_version !== (int) $actor->session_version
            || ($token instanceof \Laravel\Sanctum\PersonalAccessToken && ! $actor->tokens()->whereKey($token->id)->lockForUpdate()->first(['id']))) {
            throw new HttpResponseException(response()->json(['message' => 'Unauthenticated.'], 401));
        }
    }

    private function staffReference(Staff $staff): array
    {
        return ['id' => $staff->id, 'name' => trim($staff->first_name.' '.$staff->last_name), 'staff_type' => $staff->staff_type,
            'role_title' => $staff->role_title, 'status' => $staff->status, 'linked' => $staff->user_id !== null, 'revision' => $this->revision($staff)];
    }

    private function revision(Staff $staff): string
    {
        // Detect stale identity/employment selections even for same-second edits.
        return hash('sha256', json_encode($staff->only(['id', 'user_id', 'first_name', 'last_name', 'role_title', 'staff_type', 'status', 'department_id', 'updated_at']), JSON_THROW_ON_ERROR));
    }

    private function revoke(User $user): void
    {
        $user->session_version = (int) $user->session_version + 1;
        $user->save();
        $user->tokens()->delete();
    }

    private function conflict(string $code, string $message): never
    {
        throw new HttpResponseException(response()->json(['error' => compact('code', 'message')], 409));
    }
}
