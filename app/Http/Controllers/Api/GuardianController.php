<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Guardian;
use App\Models\Role;
use App\Models\Student;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class GuardianController extends Controller
{
    public function index(Request $request)
    {
        $groups = Guardian::with(['student.schoolClass', 'user.role'])
            ->orderBy('full_name')->orderBy('id')->get()
            ->groupBy(fn (Guardian $guardian) => $this->groupKey($guardian))
            ->map(fn (Collection $rows) => $this->transformGroup($rows));
        $search = trim((string) $request->query('search', ''));

        if ($search !== '') {
            $groups = $groups->filter(fn (array $group) => stripos(implode(' ', [
                $group['full_name'], $group['relationship'], $group['phone'] ?? '', $group['email'] ?? '',
                $group['address'] ?? '', $group['account']['username'] ?? '', $group['account']['email'] ?? '',
                ...array_map(fn (array $student) => implode(' ', [$student['name'], $student['admission_no'], $student['class'] ?? '']), $group['students']),
            ]), $search) !== false)->values();
        } else {
            $groups = $groups->values();
        }

        return response()->json(['data' => $groups]);
    }

    public function accounts()
    {
        $users = User::whereHas('role', fn (Builder $query) => $query->where('name', Role::PARENT_GUARDIAN))
            ->orderBy('username')->get();

        return response()->json(['data' => $users->map(fn (User $user) => [
            'id' => $user->id,
            'username' => $user->username,
            'email' => $user->email,
            'status' => $user->status,
            'linked' => Guardian::where('user_id', $user->id)->exists(),
        ])->values()]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->validationRules(true));
        $this->assertAccountInput($validated);

        $created = DB::transaction(function () use ($validated) {
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

        $updated = DB::transaction(function () use ($validated, $guardian) {
            $rows = $this->groupQuery($guardian)->lockForUpdate()->get();
            if ($rows->isEmpty()) abort(404);

            $user = $this->resolveAccount($validated, $guardian->user_id);
            $changes = collect($validated)->only([
                'full_name', 'relationship', 'phone', 'email', 'address', 'is_primary_contact',
            ])->all();

            foreach ($rows as $row) {
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
            'student_ids' => ['required', 'array', 'min:1'],
            'student_ids.*' => ['required', 'integer', 'distinct', 'exists:students,id'],
        ]);

        $created = DB::transaction(function () use ($validated, $guardian) {
            $source = $this->groupQuery($guardian)->lockForUpdate()->firstOrFail();
            $created = collect();

            foreach ($this->lockStudents($validated['student_ids']) as $student) {
                $this->assertNoDuplicateLink($student, $source->getAttributes(), $guardian->user_id);
                $created->push($student->guardians()->create([
                    'user_id' => $guardian->user_id,
                    'full_name' => $source->full_name,
                    'relationship' => $source->relationship,
                    'phone' => $source->phone,
                    'email' => $source->email,
                    'address' => $source->address,
                    'is_primary_contact' => $source->is_primary_contact,
                ]));
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
        $row = $this->groupQuery($guardian)->where('student_id', $student->id)->first();
        if (! $row) {
            return response()->json(['error' => [
                'code' => 'GUARDIAN_LINK_NOT_FOUND',
                'message' => 'This learner is not linked to the selected guardian.',
            ]], 404);
        }

        DB::transaction(fn () => $row->delete());
        $auditLogger->log('UNLINK_GUARDIAN_STUDENT', 'Guardian', $guardian->id, ['student_id' => $student->id]);

        return response()->json(['data' => ['message' => 'Learner unlinked.']]);
    }

    private function validationRules(bool $creating): array
    {
        return [
            'full_name' => [$creating ? 'required' : 'sometimes', 'string', 'max:150'],
            'relationship' => [$creating ? 'required' : 'sometimes', 'string', 'max:30'],
            'phone' => [$creating ? 'required' : 'sometimes', 'string', 'max:20'],
            'email' => ['sometimes', 'nullable', 'email', 'max:150'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'is_primary_contact' => ['sometimes', 'boolean'],
            'student_ids' => [$creating ? 'required' : 'sometimes', 'array', 'min:1'],
            'student_ids.*' => ['required', 'integer', 'distinct', 'exists:students,id'],
            'user_id' => ['sometimes', 'nullable', 'integer', 'exists:users,id'],
            'account' => ['sometimes', 'nullable', 'array'],
            'account.username' => ['required_with:account', 'string', 'max:100', 'unique:users,username'],
            'account.email' => ['required_with:account', 'email', 'max:150', 'unique:users,email'],
            'account.password' => ['required_with:account', 'string', 'min:10'],
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
            $user = User::with('role')->findOrFail($validated['user_id']);
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

    private function assertNoDuplicateLink(Student $student, array $details, ?int $userId): void
    {
        $query = Guardian::where('student_id', $student->id);
        if ($userId !== null) {
            $query->where('user_id', $userId);
        } else {
            $query->whereNull('user_id');
            foreach (['full_name', 'relationship', 'phone', 'email', 'address'] as $field) {
                $query->where($field, $details[$field] ?? null);
            }
        }

        if ($query->exists()) {
            throw ValidationException::withMessages(['student_ids' => 'This guardian is already linked to one or more selected learners.']);
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

    private function groupKey(Guardian $guardian): string
    {
        if ($guardian->user_id !== null) return 'user:'.$guardian->user_id;

        return 'contact:'.sha1(json_encode([
            $guardian->full_name, $guardian->relationship, $guardian->phone,
            $guardian->email, $guardian->address,
        ]));
    }

    private function loadGroup(Guardian $guardian): array
    {
        return $this->transformGroup($this->groupQuery($guardian)
            ->with(['student.schoolClass', 'user.role'])->orderBy('id')->get());
    }

    private function transformGroup(Collection $rows): array
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
            'is_primary_contact' => $rows->contains(fn (Guardian $row) => $row->is_primary_contact),
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
            ])->values()->all(),
        ];
    }
}