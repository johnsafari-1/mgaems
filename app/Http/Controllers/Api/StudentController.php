<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\PromotionTransferResource;
use App\Http\Resources\StudentResource;
use App\Http\Resources\StudentSummaryResource;
use App\Models\Student;
use App\Services\AuditLogger;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class StudentController extends Controller
{
    private const STATUSES = ['active', 'promoted', 'transferred', 'left'];

    public function index(Request $request)
    {
        $filters = $request->validate([
            'page' => ['sometimes', 'integer', 'min:1', 'max:1000000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'search' => ['sometimes', 'nullable', 'string', 'max:150'],
            'class_id' => ['sometimes', 'integer', 'exists:classes,id'],
            'status' => ['sometimes', Rule::in(self::STATUSES)],
        ]);
        $search = trim($filters['search'] ?? '');
        $students = Student::query()->select('id', 'admission_no', 'first_name', 'last_name', 'class_id', 'status')
            ->with('schoolClass:id,name')
            ->when($filters['class_id'] ?? null, fn ($query, $id) => $query->where('class_id', $id))
            ->when($filters['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
            ->when($search !== '', fn ($query) => $query->where(fn ($query) => $query
                ->where('first_name', 'like', "%{$search}%")
                ->orWhere('last_name', 'like', "%{$search}%")
                ->orWhere('admission_no', 'like', "%{$search}%")))
            ->orderBy('last_name')->orderBy('first_name')->orderBy('id')
            ->paginate($filters['per_page'] ?? 15);

        return response()->json([
            'data' => $students->getCollection()->map(fn ($student) => (new StudentSummaryResource($student))->resolve($request)),
            'meta' => ['page' => $students->currentPage(), 'per_page' => $students->perPage(), 'total' => $students->total()],
        ]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'first_name' => ['required', 'string', 'max:80'],
            'last_name' => ['required', 'string', 'max:80'],
            'date_of_birth' => ['required', 'date', 'before_or_equal:today'],
            'gender' => ['required', Rule::in(['male', 'female'])],
            'class_id' => ['required', 'integer', 'exists:classes,id'],
            'admission_date' => ['required', 'date', 'before_or_equal:today', 'after_or_equal:date_of_birth'],
            'admission_no' => ['prohibited'],
            'status' => ['prohibited'],
            'guardians' => ['prohibited'],
            'medical' => ['prohibited'],
        ]);
        $validated = array_intersect_key($validated, array_flip(['first_name', 'last_name', 'date_of_birth', 'gender', 'class_id', 'admission_date']));
        $validated['admission_date'] = Carbon::parse($validated['admission_date'])->toDateString();
        $validated['date_of_birth'] = Carbon::parse($validated['date_of_birth'])->toDateString();

        // The existing unique index is authoritative, including concurrent admissions.
        // Retry only admission-number collisions in a new transaction/snapshot.
        for ($attempt = 0; $attempt < 5; $attempt++) {
            try {
                $student = DB::transaction(fn () => Student::create($validated + [
                    'admission_no' => $this->generateAdmissionNumber($validated['admission_date']),
                    'status' => 'active',
                ]), 3);
            } catch (QueryException $exception) {
                if (! in_array((string) $exception->getCode(), ['23000', '23505'], true)
                    || ! str_contains($exception->getMessage(), 'admission_no')) {
                    throw $exception;
                }
                continue;
            }
            $auditLogger->log('CREATE_STUDENT', 'Student', $student->id, ['admission_no' => $student->admission_no]);

            return response()->json(['data' => $this->profileData($request, $student)], 201);
        }

        return response()->json(['error' => ['code' => 'ADMISSION_CONFLICT', 'message' => 'Another admission was registered concurrently. Please retry.']], 409);
    }

    public function show(Request $request, Student $student)
    {
        return response()->json(['data' => $this->profileData($request, $student)]);
    }

    public function update(Request $request, Student $student, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'first_name' => ['sometimes', 'required', 'string', 'max:80'],
            'last_name' => ['sometimes', 'required', 'string', 'max:80'],
            'date_of_birth' => ['sometimes', 'required', 'date', 'before_or_equal:today', 'before_or_equal:'.$student->admission_date->toDateString()],
            'gender' => ['sometimes', 'required', Rule::in(['male', 'female'])],
            'status' => ['sometimes', 'required', Rule::in(self::STATUSES)],
            'class_id' => ['prohibited'],
            'admission_no' => ['prohibited'],
            'admission_date' => ['prohibited'],
            'guardians' => ['prohibited'],
            'medical' => ['prohibited'],
        ]);
        $validated = array_intersect_key($validated, array_flip(['first_name', 'last_name', 'date_of_birth', 'gender', 'status']));
        $student = DB::transaction(function () use ($student, $validated) {
            $locked = Student::whereKey($student->id)->lockForUpdate()->firstOrFail();
            if (isset($validated['status']) && $validated['status'] !== $locked->status
                && ! ($locked->status === 'active' && $validated['status'] === 'left')) {
                throw ValidationException::withMessages(['status' => 'Use the existing transfer operation to change enrollment state. Only active learners may be marked as left here.']);
            }
            $locked->update($validated);

            return $locked;
        }, 3);
        $auditLogger->log('UPDATE_STUDENT', 'Student', $student->id, $validated);

        return response()->json(['data' => $this->profileData($request, $student)]);
    }

    public function promote(Request $request, Student $student, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->placementRules() + [
            'to_class_id' => ['required', 'integer', 'exists:classes,id'],
        ]);
        $record = DB::transaction(function () use ($student, $validated) {
            $locked = Student::whereKey($student->id)->lockForUpdate()->firstOrFail();
            $this->assertEffectiveDate($locked, $validated['effective_date']);
            if ($locked->status !== 'active') {
                throw ValidationException::withMessages(['to_class_id' => 'Only actively enrolled learners may be promoted.']);
            }
            if ((int) $locked->class_id === (int) $validated['to_class_id']) {
                throw ValidationException::withMessages(['to_class_id' => 'Choose a class different from the current class.']);
            }
            $from = $locked->class_id;
            $locked->update(['class_id' => $validated['to_class_id']]);

            return $locked->promotionsTransfers()->create($validated + [
                'type' => 'promotion', 'from_class_id' => $from, 'recorded_by' => auth()->id(),
            ]);
        }, 3);
        $auditLogger->log('PROMOTE_STUDENT', 'Student', $student->id, $validated);

        return response()->json(['data' => $this->historyData($request, $record)], 201);
    }

    public function transfer(Request $request, Student $student, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->placementRules() + [
            'type' => ['required', Rule::in(['transfer_in', 'transfer_out'])],
            'to_class_id' => ['required_if:type,transfer_in', 'prohibited_unless:type,transfer_in', 'nullable', 'integer', 'exists:classes,id'],
        ]);
        if ($validated['type'] === 'transfer_out') unset($validated['to_class_id']);
        $record = DB::transaction(function () use ($student, $validated) {
            $locked = Student::whereKey($student->id)->lockForUpdate()->firstOrFail();
            $this->assertEffectiveDate($locked, $validated['effective_date']);
            $out = $validated['type'] === 'transfer_out';
            if (($out && $locked->status !== 'active') || (! $out && ! in_array($locked->status, ['transferred', 'left'], true))) {
                throw ValidationException::withMessages(['type' => $out ? 'Only actively enrolled learners may transfer out.' : 'Only transferred or exited learners may transfer back in.']);
            }
            $from = $locked->class_id;
            $locked->update($out ? ['status' => 'transferred'] : ['status' => 'active', 'class_id' => $validated['to_class_id']]);

            return $locked->promotionsTransfers()->create($validated + [
                'from_class_id' => $from, 'recorded_by' => auth()->id(),
            ]);
        }, 3);
        $auditLogger->log('TRANSFER_STUDENT', 'Student', $student->id, $validated);

        return response()->json(['data' => $this->historyData($request, $record)], 201);
    }

    public function academicHistory(Request $request, Student $student)
    {
        $records = $student->promotionsTransfers()->with(['fromClass:id,name', 'toClass:id,name', 'term:id,name'])->orderByDesc('id')->get();

        return response()->json(['data' => [
            'student' => (new StudentSummaryResource($student->load('schoolClass:id,name')))->resolve($request),
            'promotions_transfers' => $records->map(fn ($record) => (new PromotionTransferResource($record))->resolve($request)),
        ]]);
    }

    private function placementRules(): array
    {
        return [
            'term_id' => ['required', 'integer', 'exists:terms,id'],
            'reason' => ['nullable', 'string', 'max:255'],
            'effective_date' => ['required', 'date', 'before_or_equal:today'],
        ];
    }

    private function assertEffectiveDate(Student $student, string $date): void
    {
        $effective = Carbon::parse($date)->toDateString();
        $latest = $student->promotionsTransfers()->first();
        if ($effective < $student->admission_date->toDateString() || ($latest && $effective < $latest->effective_date->toDateString())) {
            throw ValidationException::withMessages(['effective_date' => 'The effective date cannot precede admission or the latest recorded class/transfer change.']);
        }
    }

    private function profileData(Request $request, Student $student): array
    {
        $student->load('schoolClass:id,name');
        if (in_array($request->user()?->role?->name, ['system_admin', 'head_teacher', 'deputy_head_teacher'], true)) {
            $student->load('guardians:id,student_id,full_name,relationship,phone,email,is_primary_contact');
        }

        return (new StudentResource($student))->resolve($request);
    }

    private function historyData(Request $request, $record): array
    {
        return (new PromotionTransferResource($record->load('fromClass:id,name', 'toClass:id,name', 'term:id,name')))->resolve($request);
    }

    private function generateAdmissionNumber(string $admissionDate): string
    {
        $year = Carbon::parse($admissionDate)->year;
        $sequence = Student::whereYear('admission_date', $year)->count();
        do {
            $candidate = sprintf('MGA-%d-%04d', $year, ++$sequence);
        } while (Student::where('admission_no', $candidate)->exists());

        return $candidate;
    }
}
