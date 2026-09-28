<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Student;
use App\Models\Sponsorship;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class SponsorshipController extends Controller
{
    private const RELATIONS = [
        'sponsor:id,name,sponsor_type',
        'student:id,first_name,last_name,admission_no,class_id,status',
        'student.schoolClass:id,name',
        'students:id,first_name,last_name,admission_no,class_id,status',
        'students.schoolClass:id,name',
        'createdBy:id,username',
    ];

    public function index(Request $request)
    {
        $items = Sponsorship::with(self::RELATIONS)
            ->when($request->query('sponsor_id'), fn ($q, $v) => $q->where('sponsor_id', $v))
            ->when($request->query('sponsorship_type'), fn ($q, $v) => $q->where('sponsorship_type', $v))
            ->when($request->query('status'), fn ($q, $v) => $q->where('status', $v))
            ->when($request->query('search'), function ($q, $search) {
                $q->where(function ($q) use ($search) {
                    $q->where('program_name', 'like', "%{$search}%")
                        ->orWhereHas('sponsor', fn ($q) => $q->where('name', 'like', "%{$search}%"))
                        ->orWhereHas('student', fn ($q) => $q->where('first_name', 'like', "%{$search}%")->orWhere('last_name', 'like', "%{$search}%")->orWhere('admission_no', 'like', "%{$search}%"))
                        ->orWhereHas('students', fn ($q) => $q->where('first_name', 'like', "%{$search}%")->orWhere('last_name', 'like', "%{$search}%")->orWhere('admission_no', 'like', "%{$search}%"));
                });
            })->orderByDesc('start_date')->get();

        return response()->json(['data' => $items]);
    }

    public function show(Sponsorship $sponsorship)
    {
        return response()->json(['data' => $sponsorship->load(self::RELATIONS)]);
    }

    public function learners(Request $request)
    {
        $learners = Student::query()->where('status', 'active')
            ->with('schoolClass:id,name')
            ->when($request->query('search'), fn ($q, $v) => $q->where(fn ($q) => $q->where('admission_no', 'like', "%{$v}%")->orWhere('first_name', 'like', "%{$v}%")->orWhere('last_name', 'like', "%{$v}%")))
            ->orderBy('first_name')->orderBy('last_name')
            ->get(['id', 'admission_no', 'first_name', 'last_name', 'class_id', 'status']);

        $activeIds = Sponsorship::where('sponsorship_type', 'individual')->where('status', 'active')->whereNotNull('student_id')->pluck('student_id')->flip();
        $learners->each(fn ($student) => $student->setAttribute('has_active_individual_sponsorship', $activeIds->has($student->id)));

        return response()->json(['data' => $learners]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'sponsor_id' => ['required', 'exists:sponsors,id'],
            'sponsorship_type' => ['required', Rule::in(['individual', 'group', 'school_wide'])],
            'student_id' => ['required_if:sponsorship_type,individual', 'nullable', 'prohibited_unless:sponsorship_type,individual', Rule::exists('students', 'id')->where('status', 'active')],
            'student_ids' => ['required_if:sponsorship_type,group', 'prohibited_unless:sponsorship_type,group', 'array', 'min:1'],
            'student_ids.*' => ['integer', 'distinct', Rule::exists('students', 'id')->where('status', 'active')],
            'program_name' => ['required_if:sponsorship_type,school_wide', 'nullable', 'prohibited_unless:sponsorship_type,school_wide', 'string', 'max:150'],
            'start_date' => ['required', 'date'],
            'end_date' => ['nullable', 'date', 'after_or_equal:start_date'],
            'notes' => ['nullable', 'string'],
        ]);

        if ($validated['sponsorship_type'] === 'individual' && Sponsorship::where('student_id', $validated['student_id'])->where('sponsorship_type', 'individual')->where('status', 'active')->exists()) {
            return response()->json(['error' => ['code' => 'ALREADY_SPONSORED', 'message' => 'This learner already has an active individual sponsorship.']], 409);
        }

        $studentIds = $validated['student_ids'] ?? [];
        unset($validated['student_ids']);
        $sponsorship = DB::transaction(function () use ($validated, $studentIds) {
            $item = Sponsorship::create($validated + ['status' => 'active', 'created_by' => auth()->id()]);
            if ($item->sponsorship_type === 'group') {
                $item->students()->sync($studentIds);
            }
            return $item;
        });
        $auditLogger->log('CREATE_SPONSORSHIP', 'Sponsorship', $sponsorship->id, ['type' => $sponsorship->sponsorship_type, 'member_count' => count($studentIds)]);

        return response()->json(['data' => $sponsorship->load(self::RELATIONS)], 201);
    }

    public function update(Request $request, Sponsorship $sponsorship, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'status' => ['required', Rule::in(['active', 'ended', 'paused'])],
            'end_date' => ['nullable', 'date', 'after_or_equal:'.$sponsorship->start_date->format('Y-m-d'), 'required_if:status,ended'],
            'notes' => ['nullable', 'string', 'required_if:status,ended'],
        ]);
        if ($sponsorship->status === 'ended' && $validated['status'] !== 'ended') {
            return response()->json(['error' => ['code' => 'TERMINAL_STATE', 'message' => 'An ended sponsorship cannot be reopened.']], 422);
        }
        $allowed = ['active' => ['paused', 'ended'], 'paused' => ['active', 'ended'], 'ended' => ['ended']];
        if ($validated['status'] !== $sponsorship->status && ! in_array($validated['status'], $allowed[$sponsorship->status], true)) {
            return response()->json(['error' => ['code' => 'INVALID_TRANSITION', 'message' => 'That sponsorship status transition is not allowed.']], 422);
        }
        $previous = $sponsorship->status;
        $sponsorship->update($validated);
        $action = match ([$previous, $sponsorship->status]) {
            ['active', 'paused'] => 'PAUSE_SPONSORSHIP',
            ['paused', 'active'] => 'RESUME_SPONSORSHIP',
            ['active', 'ended'], ['paused', 'ended'] => 'END_SPONSORSHIP',
            default => 'UPDATE_SPONSORSHIP',
        };
        $auditLogger->log($action, 'Sponsorship', $sponsorship->id, ['from' => $previous, 'to' => $sponsorship->status]);

        return response()->json(['data' => $sponsorship->fresh()->load(self::RELATIONS)]);
    }
}
