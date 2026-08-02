<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Student;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Implements SRS FR-STU-01/02/03/04/05 and UC-STU-01/02/04.
 *
 * Registration (store) accepts bio-data plus optional guardians[] and
 * medical{} in a single request, matching UC-STU-01's main flow, and
 * auto-generates the admission number rather than accepting one.
 */
class StudentController extends Controller
{
    public function index(Request $request)
    {
        $perPage = min((int) $request->query('per_page', 15), 100);

        $students = Student::with(['schoolClass', 'stream'])
            ->when($request->query('class_id'), fn ($q, $id) => $q->where('class_id', $id))
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->when($request->query('search'), fn ($q, $s) => $q->where(function ($q2) use ($s) {
                $q2->where('first_name', 'like', "%{$s}%")
                    ->orWhere('last_name', 'like', "%{$s}%")
                    ->orWhere('admission_no', 'like', "%{$s}%");
            }))
            ->orderBy('last_name')
            ->paginate($perPage);

        return response()->json([
            'data' => $students->items(),
            'meta' => ['page' => $students->currentPage(), 'per_page' => $students->perPage(), 'total' => $students->total()],
        ]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'first_name' => ['required', 'string', 'max:80'],
            'last_name' => ['required', 'string', 'max:80'],
            'date_of_birth' => ['required', 'date', 'before:today'],
            'gender' => ['required', Rule::in(['male', 'female'])],
            'class_id' => ['required', 'exists:classes,id'],
            'stream_id' => ['nullable', 'exists:streams,id'],
            'admission_date' => ['required', 'date'],

            'guardians' => ['sometimes', 'array'],
            'guardians.*.full_name' => ['required_with:guardians', 'string', 'max:150'],
            'guardians.*.relationship' => ['required_with:guardians', 'string', 'max:30'],
            'guardians.*.phone' => ['required_with:guardians', 'string', 'max:20'],
            'guardians.*.email' => ['nullable', 'email', 'max:150'],
            'guardians.*.is_primary_contact' => ['sometimes', 'boolean'],

            'medical' => ['sometimes', 'array'],
            'medical.conditions' => ['nullable', 'string'],
            'medical.allergies' => ['nullable', 'string'],
            'medical.emergency_contact_name' => ['nullable', 'string', 'max:150'],
            'medical.emergency_contact_phone' => ['nullable', 'string', 'max:20'],
        ]);

        $student = DB::transaction(function () use ($validated) {
            $admissionNo = $this->generateAdmissionNumber();

            $student = Student::create([
                'admission_no' => $admissionNo,
                'first_name' => $validated['first_name'],
                'last_name' => $validated['last_name'],
                'date_of_birth' => $validated['date_of_birth'],
                'gender' => $validated['gender'],
                'class_id' => $validated['class_id'],
                'stream_id' => $validated['stream_id'] ?? null,
                'status' => 'active',
                'admission_date' => $validated['admission_date'],
            ]);

            foreach ($validated['guardians'] ?? [] as $g) {
                $student->guardians()->create($g);
            }

            if (! empty($validated['medical'])) {
                $student->medicalInfo()->create($validated['medical']);
            }

            return $student;
        });

        $auditLogger->log('CREATE_STUDENT', 'Student', $student->id, ['admission_no' => $student->admission_no]);

        return response()->json([
            'data' => $student->load('guardians', 'medicalInfo', 'schoolClass', 'stream'),
        ], 201);
    }

    public function show(Student $student)
    {
        return response()->json([
            'data' => $student->load('guardians', 'medicalInfo', 'schoolClass', 'stream'),
        ]);
    }

    public function update(Request $request, Student $student, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'first_name' => ['sometimes', 'string', 'max:80'],
            'last_name' => ['sometimes', 'string', 'max:80'],
            'date_of_birth' => ['sometimes', 'date', 'before:today'],
            'gender' => ['sometimes', Rule::in(['male', 'female'])],
            'class_id' => ['sometimes', 'exists:classes,id'],
            'stream_id' => ['nullable', 'exists:streams,id'],
            'status' => ['sometimes', Rule::in(['active', 'promoted', 'transferred', 'left'])],
        ]);

        $student->update($validated);
        $auditLogger->log('UPDATE_STUDENT', 'Student', $student->id, $validated);

        return response()->json(['data' => $student->fresh(['schoolClass', 'stream'])]);
    }

    /**
     * Admission numbers follow MGA-{year}-{4-digit sequence}, e.g. MGA-2026-0001.
     * Sequence resets each calendar year and is computed from the count of
     * students already admitted that year, guarded by the transaction in
     * store() to avoid race conditions on concurrent registrations.
     */
    private function generateAdmissionNumber(): string
    {
        $year = now()->year;
        $count = Student::whereYear('admission_date', $year)->lockForUpdate()->count();

        do {
            $count++;
            $candidate = sprintf('MGA-%d-%04d', $year, $count);
        } while (Student::where('admission_no', $candidate)->exists());

        return $candidate;
    }
}
