<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Guardian;
use App\Models\Role;
use App\Models\Student;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class GuardianController extends Controller
{
    public function index(Request $request)
    {
        $filters = $request->validate($this->paginationRules() + [
            'student_id' => ['sometimes', 'integer', 'exists:students,id'],
        ]);
        $search = trim($filters['search'] ?? '');
        $query = Guardian::query()
            ->when($filters['student_id'] ?? null, fn ($query, $id) => $query->where('student_id', $id))
            ->when($search !== '', function (Builder $query) use ($search) {
                $query->where(function (Builder $query) use ($search) {
                    foreach (['full_name', 'relationship', 'phone', 'email', 'address'] as $field) {
                        $query->orWhere($field, 'like', "%{$search}%");
                    }
                    $query->orWhereHas('user', fn ($query) => $query->where('username', 'like', "%{$search}%")->orWhere('email', 'like', "%{$search}%"))
                        ->orWhereHas('student', fn ($query) => $query->where('first_name', 'like', "%{$search}%")->orWhere('last_name', 'like', "%{$search}%")->orWhere('admission_no', 'like', "%{$search}%")
                            ->orWhereHas('schoolClass', fn ($query) => $query->where('name', 'like', "%{$search}%")));
                });
            })
            ->selectRaw('MIN(guardians.id) as id, MIN(guardians.full_name) as sort_name')
            ->groupBy('user_id');
        // Preserve the existing account/contact grouping, but paginate identities in SQL.
        foreach (['full_name', 'relationship', 'phone', 'email', 'address'] as $field) {
            $query->groupByRaw("CASE WHEN user_id IS NULL THEN {$field} ELSE NULL END");
        }
        $groups = $query->orderBy('sort_name')->orderBy('id')->paginate($filters['per_page'] ?? 20);
        $representatives = Guardian::whereIn('id', $groups->pluck('id'))->get()->keyBy('id');

        return response()->json([
            'data' => $groups->getCollection()->map(fn ($group) => isset($representatives[$group->id])
                ? $this->loadGroup($representatives[$group->id], $representatives[$group->id]->student_id) : null)->filter()->values(),
            'meta' => ['page' => $groups->currentPage(), 'per_page' => $groups->perPage(), 'total' => $groups->total()],
        ]);
    }

    public function accounts(Request $request)
    {
        $filters = $request->validate($this->paginationRules());
        $search = trim($filters['search'] ?? '');
        $users = User::whereHas('role', fn (Builder $query) => $query->where('name', Role::PARENT_GUARDIAN))
            ->when($search !== '', fn ($query) => $query->where(fn ($query) => $query->where('username', 'like', "%{$search}%")->orWhere('email', 'like', "%{$search}%")))
            ->select('id', 'username', 'email', 'status')
            ->selectSub(Guardian::selectRaw('COUNT(*)')->whereColumn('guardians.user_id', 'users.id'), 'linked_count')
            ->orderBy('username')->orderBy('id')->paginate($filters['per_page'] ?? 20);

        return response()->json(['data' => $users->getCollection()->map(fn (User $user) => [
            'id' => $user->id,
            'username' => $user->username,
            'email' => $user->email,
            'status' => $user->status,
            'linked' => $user->linked_count > 0,
        ])->values(), 'meta' => ['page' => $users->currentPage(), 'per_page' => $users->perPage(), 'total' => $users->total()]]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->validationRules(true));
        $this->assertAccountInput($validated);

        $created = $this->write(function () use ($validated) {
            $students = $this->lockStudents($validated['student_ids']);
            $user = $this->resolveAccount($validated);
            $created = collect();

            foreach ($students as $student) {
                $this->assertNoDuplicateLink($student, $validated, $user?->id);
                $created->push($this->createGuardianRow($student, $validated, $user?->id));
            }

            return $created;
        });

        $first = $created->first();
        $auditLogger->log('CREATE_GUARDIAN', 'Guardian', $first->id, [
            'student_ids' => $created->pluck('student_id')->all(),
            'user_id' => $first->user_id,
        ]);

        return response()->json(['data' => $this->loadGroup($first)], 201);
    }

    public function update(Request $request, Guardian $guardian, AuditLogger $auditLogger)
    {
        $rules = $this->validationRules(false);
        $rules['student_ids'] = ['prohibited'];
        $validated = $request->validate($rules);
        $this->assertAccountInput($validated);

        $updated = $this->write(function () use ($validated, $guardian) {
            $guardian = Guardian::whereKey($guardian->id)->lockForUpdate()->firstOrFail();
            $this->lockStudents($this->groupQuery($guardian)->pluck('student_id')->unique()->all());
            $rows = $this->groupQuery($guardian)->lockForUpdate()->get();
            if ($rows->isEmpty()) abort(404);

            $user = $this->resolveAccount($validated, $guardian->user_id);
            $changes = collect($validated)->only([
                'full_name', 'relationship', 'phone', 'email', 'address', 'is_primary_contact',
            ])->all();

            foreach ($rows as $row) {
                $details = array_replace($row->getAttributes(), $changes);
                $this->assertNoDuplicateLink($row->student, $details, $user?->id, $rows->pluck('id')->all());
                if (! empty($changes['is_primary_contact'])) {
                    Guardian::where('student_id', $row->student_id)->whereNotIn('id', $rows->pluck('id'))->update(['is_primary_contact' => false]);
                }
                $row->fill($changes);
                if (array_key_exists('user_id', $validated) || array_key_exists('account', $validated)) {
                    $row->user_id = $user?->id;
                }
                $row->save();
            }

            return $rows->first();
        });

        $auditLogger->log('UPDATE_GUARDIAN', 'Guardian', $guardian->id, [
            'changed_fields' => array_keys($validated),
        ]);

        return response()->json(['data' => $this->loadGroup($updated)]);
    }

    public function linkStudents(Request $request, Guardian $guardian, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'student_ids' => ['required', 'array', 'min:1', 'max:100'],
            'student_ids.*' => ['required', 'integer', 'distinct', 'exists:students,id'],
            'is_primary_contact' => ['sometimes', 'boolean'],
        ]);

        $created = $this->write(function () use ($validated, $guardian) {
            $guardian = Guardian::whereKey($guardian->id)->lockForUpdate()->firstOrFail();
            $students = $this->lockStudents($validated['student_ids']);
            $source = $this->groupQuery($guardian)->lockForUpdate()->firstOrFail();
            if ($source->user_id !== null) $this->resolveAccount(['user_id' => $source->user_id], $source->user_id);
            $created = collect();
            $details = $source->getAttributes();
            $details['is_primary_contact'] = $validated['is_primary_contact'] ?? $source->is_primary_contact;

            foreach ($students as $student) {
                $this->assertNoDuplicateLink($student, $source->getAttributes(), $source->user_id);
                $created->push($this->createGuardianRow($student, $details, $source->user_id));
            }

            return $created;
        });

        $auditLogger->log('LINK_GUARDIAN_STUDENTS', 'Guardian', $guardian->id, [
            'student_ids' => $created->pluck('student_id')->all(),
        ]);

        return response()->json(['data' => $this->loadGroup($created->first())], 201);
    }

    public function unlinkStudent(Guardian $guardian, Student $student, AuditLogger $auditLogger)
    {
        $removed = $this->write(function () use ($guardian, $student) {
            $guardian = Guardian::whereKey($guardian->id)->lockForUpdate()->firstOrFail();
            $this->lockStudents([$student->id]);
            $rows = $this->groupQuery($guardian)->where('student_id', $student->id)->lockForUpdate()->get();
            if ($rows->isEmpty()) return false;
            foreach ($rows as $row) $row->delete();

            return true;
        });
        if (! $removed) return response()->json(['error' => ['code' => 'GUARDIAN_LINK_NOT_FOUND', 'message' => 'This learner is not linked to the selected guardian.']], 404);
        $auditLogger->log('UNLINK_GUARDIAN_STUDENT', 'Guardian', $guardian->id, ['student_id' => $student->id]);

        return response()->json(['data' => ['message' => 'Learner unlinked.']]);
    }

    private function validationRules(bool $creating): array
    {
        return [
            'full_name' => [$creating ? 'required' : 'sometimes', 'filled', 'string', 'max:150'],
            'relationship' => [$creating ? 'required' : 'sometimes', 'filled', 'string', 'max:30'],
            'phone' => [$creating ? 'required' : 'sometimes', 'filled', 'string', 'max:20'],
            'email' => ['sometimes', 'nullable', 'email', 'max:150'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'is_primary_contact' => ['sometimes', 'boolean'],
            'student_ids' => [$creating ? 'required' : 'sometimes', 'array', 'min:1', 'max:100'],
            'student_ids.*' => ['required', 'integer', 'distinct', 'exists:students,id'],
            'user_id' => ['sometimes', 'nullable', 'integer', 'exists:users,id'],
            'account' => ['sometimes', 'nullable', 'array:username,email,password'],
            'account.username' => ['required_with:account', 'string', 'max:100', 'unique:users,username'],
            'account.email' => ['required_with:account', 'email', 'max:150', 'unique:users,email'],
            'account.password' => ['required_with:account', 'string', 'min:10', 'max:200'],
        ];
    }

    private function assertAccountInput(array $validated): void
    {
        if (! empty($validated['account']) && array_key_exists('user_id', $validated) && $validated['user_id'] !== null) {
            throw ValidationException::withMessages(['user_id' => 'Choose an existing account or create a new account, not both.']);
        }
    }

    private function resolveAccount(array $validated, ?int $currentUserId = null): ?User
    {
        if (! empty($validated['account'])) {
            $roleId = Role::where('name', Role::PARENT_GUARDIAN)->value('id');
            if (! $roleId) throw ValidationException::withMessages(['account' => 'The Parent Portal role has not been configured.']);

            return User::create([
                'username' => $validated['account']['username'],
                'email' => $validated['account']['email'],
                'password_hash' => Hash::make($validated['account']['password']),
                'role_id' => $roleId,
                'status' => 'active',
            ]);
        }

        if (array_key_exists('user_id', $validated)) {
            if ($validated['user_id'] === null) return null;
            $user = User::with('role')->lockForUpdate()->findOrFail($validated['user_id']);
            if ($user->role?->name !== Role::PARENT_GUARDIAN) {
                throw ValidationException::withMessages(['user_id' => 'The selected account must have the parent_guardian role.']);
            }
            if ($user->id !== $currentUserId && Guardian::where('user_id', $user->id)->exists()) {
                throw ValidationException::withMessages(['user_id' => 'This account already has linked learners. Open that guardian record to add another learner.']);
            }

            return $user;
        }

        if (array_key_exists('account', $validated)) return null;

        return $currentUserId ? User::find($currentUserId) : null;
    }

    private function createGuardianRow(Student $student, array $details, ?int $userId): Guardian
    {
        if ($details['is_primary_contact'] ?? false) {
            Guardian::where('student_id', $student->id)->update(['is_primary_contact' => false]);
        }
        return $student->guardians()->create([
            'user_id' => $userId,
            'full_name' => $details['full_name'],
            'relationship' => $details['relationship'],
            'phone' => $details['phone'],
            'email' => $details['email'] ?? null,
            'address' => $details['address'] ?? null,
            'is_primary_contact' => $details['is_primary_contact'] ?? false,
        ]);
    }

    private function lockStudents(array $studentIds): Collection
    {
        $students = Student::whereIn('id', $studentIds)->orderBy('id')->lockForUpdate()->get();
        if ($students->count() !== count($studentIds)) {
            throw ValidationException::withMessages(['student_ids' => 'One or more learners could not be found.']);
        }

        return $students;
    }

    private function assertNoDuplicateLink(Student $student, array $details, ?int $userId, array $exceptIds = []): void
    {
        $query = Guardian::where('student_id', $student->id)->whereNotIn('id', $exceptIds);
        if ($userId !== null) {
            $query->where('user_id', $userId);
        } else {
            $query->whereNull('user_id');
            foreach (['full_name', 'relationship', 'phone', 'email', 'address'] as $field) {
                $query->where($field, $details[$field] ?? null);
            }
        }

        if ($query->exists()) {
            throw ValidationException::withMessages(['student_ids' => $exceptIds
                ? 'These contact/account details would duplicate an existing learner relationship.'
                : 'This guardian is already linked to one or more selected learners.']);
        }
    }

    private function groupQuery(Guardian $guardian): Builder
    {
        $query = Guardian::query();
        if ($guardian->user_id !== null) return $query->where('user_id', $guardian->user_id);

        return $query->whereNull('user_id')
            ->where('full_name', $guardian->full_name)
            ->where('relationship', $guardian->relationship)
            ->where('phone', $guardian->phone)
            ->where('email', $guardian->email)
            ->where('address', $guardian->address);
    }

    private function paginationRules(): array
    {
        return [
            'page' => ['sometimes', 'integer', 'min:1', 'max:1000000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:50'],
            'search' => ['sometimes', 'nullable', 'string', 'max:150'],
        ];
    }

    private function write(callable $operation)
    {
        try {
            return DB::transaction($operation, 3);
        } catch (QueryException $exception) {
            if (in_array((string) $exception->getCode(), ['23000', '23505'], true)) {
                foreach (['username', 'email'] as $field) {
                    if (str_contains($exception->getMessage(), 'users_'.$field.'_unique') || str_contains($exception->getMessage(), 'users.'.$field)) {
                        throw ValidationException::withMessages(['account.'.$field => 'This parent account '.$field.' is already in use.']);
                    }
                }
            }
            throw $exception;
        }
    }

    private function loadGroup(Guardian $guardian, ?int $preferredStudentId = null): ?array
    {
        $total = $this->groupQuery($guardian)->count();

        $rows = $this->groupQuery($guardian)
            ->with(['student:id,class_id,admission_no,first_name,last_name,status', 'student.schoolClass:id,name', 'user:id,role_id,username,email,status', 'user.role:id,name'])
            ->when($preferredStudentId, fn ($query) => $query->orderByRaw('CASE WHEN student_id = ? THEN 0 ELSE 1 END', [$preferredStudentId]))
            ->orderBy('id')->limit(100)->get();
        if ($rows->isEmpty()) return null;

        return $this->transformGroup($rows, $total, $this->groupQuery($guardian)->where('is_primary_contact', true)->exists());
    }

    private function transformGroup(Collection $rows, int $total, bool $primary): array
    {
        /** @var Guardian $first */
        $first = $rows->first();
        $user = $first->user;

        return [
            'id' => $first->id,
            'guardian_ids' => $rows->pluck('id')->all(),
            'full_name' => $first->full_name,
            'relationship' => $first->relationship,
            'phone' => $first->phone,
            'email' => $first->email,
            'address' => $first->address,
            'is_primary_contact' => $primary,
            'students_count' => $total,
            'students_truncated' => $total > $rows->count(),
            'account' => $user ? [
                'id' => $user->id,
                'username' => $user->username,
                'email' => $user->email,
                'status' => $user->status,
            ] : null,
            'access_status' => ! $user ? 'no_account' : (
                $user->role?->name === Role::PARENT_GUARDIAN ? $user->status : 'role_mismatch'
            ),
            'students' => $rows->map(fn (Guardian $row) => [
                'id' => $row->student->id,
                'admission_no' => $row->student->admission_no,
                'name' => trim($row->student->first_name.' '.$row->student->last_name),
                'class' => $row->student->schoolClass?->name,
                'status' => $row->student->status,
                'relationship' => $row->relationship,
                'is_primary_contact' => $row->is_primary_contact,
            ])->values()->all(),
        ];
    }
}
