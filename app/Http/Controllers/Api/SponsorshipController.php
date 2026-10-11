<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Student;
use App\Models\Sponsor;
use App\Models\Sponsorship;
use App\Services\AuditLogger;
use App\Services\SponsorshipOperations;
use App\Services\SponsorshipView;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class SponsorshipController extends Controller
{
    public function index(Request $request)
    {
        $filters = $request->validate(SponsorshipView::filters() + [
            'student_id' => ['sometimes', 'integer', 'min:1'],
            'sponsor_id' => ['sometimes', 'integer', 'min:1'],
            'sponsorship_type' => ['sometimes', Rule::in(['individual', 'group', 'school_wide'])],
            'status' => ['sometimes', Rule::in(['active', 'paused', 'ended'])],
        ]);
        $query = Sponsorship::with(SponsorshipView::RELATIONS)
            ->when($filters['student_id'] ?? null, fn ($query, $id) => $query->where(fn ($query) => $query
                ->where(fn ($query) => $query->where('sponsorship_type', 'individual')->where('student_id', $id))
                ->orWhere(fn ($query) => $query->where('sponsorship_type', 'group')->whereHas('students', fn ($query) => $query->where('students.id', $id)))))
            ->when($filters['sponsor_id'] ?? null, fn ($query, $id) => $query->where('sponsor_id', $id))
            ->when($filters['sponsorship_type'] ?? null, fn ($query, $type) => $query->where('sponsorship_type', $type))
            ->when($filters['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
            ->when($filters['search'] ?? null, function ($query, $search) {
                $pattern = SponsorshipView::pattern($search);
                $query->where(function ($query) use ($pattern) {
                    $query->whereRaw("program_name LIKE ? ESCAPE '!'", [$pattern])
                        ->orWhereHas('sponsor', fn ($query) => $query->whereRaw("name LIKE ? ESCAPE '!'", [$pattern]))
                        ->orWhereHas('student', fn ($query) => $query->whereRaw("(first_name LIKE ? ESCAPE '!' OR last_name LIKE ? ESCAPE '!' OR admission_no LIKE ? ESCAPE '!')", [$pattern, $pattern, $pattern]))
                        ->orWhereHas('students', fn ($query) => $query->whereRaw("(first_name LIKE ? ESCAPE '!' OR last_name LIKE ? ESCAPE '!' OR admission_no LIKE ? ESCAPE '!')", [$pattern, $pattern, $pattern]));
                });
            })->orderByDesc('start_date')->orderByDesc('id');
        return SponsorshipView::listing($query, $request, function ($item) use ($filters) {
            $data = SponsorshipView::item($item);
            // Preserve the existing learner-profile summary contract.
            return isset($filters['student_id']) ? array_intersect_key($data, array_flip(['id', 'sponsor', 'sponsorship_type', 'status', 'start_date', 'end_date'])) : $data;
        }, $filters);
    }

    public function summary()
    {
        $types = ['individual' => 0, 'group' => 0, 'school_wide' => 0];
        $statuses = ['active' => 0, 'paused' => 0, 'ended' => 0];
        foreach (Sponsorship::selectRaw('sponsorship_type, status, COUNT(*) AS total')->groupBy('sponsorship_type', 'status')->get() as $row) {
            if (array_key_exists($row->sponsorship_type, $types)) $types[$row->sponsorship_type] += (int) $row->total;
            if (array_key_exists($row->status, $statuses)) $statuses[$row->status] += (int) $row->total;
        }
        return response()->json(['data' => ['sponsors' => Sponsor::count(), 'sponsorships' => Sponsorship::count(),
            'by_type' => $types, 'by_status' => $statuses,
            'individual_assignments' => Sponsorship::where('sponsorship_type', 'individual')->whereNotNull('student_id')->count(),
            'group_memberships' => \Illuminate\Support\Facades\DB::table('sponsorship_student')->join('sponsorships', 'sponsorships.id', '=', 'sponsorship_student.sponsorship_id')
                ->where('sponsorships.sponsorship_type', 'group')->count()]])->header('Cache-Control', 'private, no-store');
    }

    public function show(Sponsorship $sponsorship)
    {
        return response()->json(['data' => SponsorshipView::item($sponsorship->load(SponsorshipView::RELATIONS))])->header('Cache-Control', 'private, no-store');
    }

    public function learner(Sponsorship $sponsorship, string $student)
    {
        if ($sponsorship->sponsorship_type === 'school_wide') {
            return response()->json(['error' => ['code' => 'SPONSORSHIP_TYPE_UNSUPPORTED', 'message' => 'School-wide sponsorships provide programme-level information only.']], 422);
        }
        $query = $sponsorship->sponsorship_type === 'individual'
            ? Student::whereKey($sponsorship->student_id) : $sponsorship->students();
        $learner = ctype_digit($student) ? $query->where('students.id', $student)->with('schoolClass:id,name')->first() : null;
        if (! $learner) return response()->json(['error' => ['code' => 'FORBIDDEN', 'message' => 'This learner is not part of the sponsorship.']], 403);
        return response()->json(['data' => SponsorshipView::learner($learner)])->header('Cache-Control', 'private, no-store');
    }

    public function learners(Request $request)
    {
        $filters = $request->validate(SponsorshipView::filters());
        // An allocation lookup is distinct from a sponsored learner directory.
        // Coordinators must deliberately search; never preload the school roster.
        $search = trim($filters['search'] ?? '');
        $pattern = SponsorshipView::pattern($search);
        $query = Student::where('status', 'active')->with('schoolClass:id,name')
            ->when($request->user()->hasRole('sponsor_coordinator') && mb_strlen($search) < 2, fn ($query) => $query->whereRaw('1 = 0'))
            ->when($search !== '', fn ($query) => $query->whereRaw("(admission_no LIKE ? ESCAPE '!' OR first_name LIKE ? ESCAPE '!' OR last_name LIKE ? ESCAPE '!')", [$pattern, $pattern, $pattern]))
            ->orderBy('first_name')->orderBy('last_name')->orderBy('id');
        return SponsorshipView::listing($query, $request, fn ($student) => SponsorshipView::learner($student) + [
            'has_active_individual_sponsorship' => Sponsorship::where('student_id', $student->id)->where('sponsorship_type', 'individual')->where('status', 'active')->exists(),
        ], $filters);
    }

    public function store(Request $request, AuditLogger $auditLogger, SponsorshipOperations $operations)
    {
        $validated = $request->validate([
            'sponsor_id' => ['required', 'integer', 'exists:sponsors,id'],
            'sponsorship_type' => ['required', Rule::in(['individual', 'group', 'school_wide'])],
            'student_id' => ['required_if:sponsorship_type,individual', 'nullable', 'integer', 'prohibited_unless:sponsorship_type,individual', Rule::exists('students', 'id')->where('status', 'active')],
            'student_ids' => ['required_if:sponsorship_type,group', 'prohibited_unless:sponsorship_type,group', 'array', 'min:1'],
            'student_ids.*' => ['integer', 'distinct', Rule::exists('students', 'id')->where('status', 'active')],
            'program_name' => ['required_if:sponsorship_type,school_wide', 'nullable', 'prohibited_unless:sponsorship_type,school_wide', 'string', 'max:150'],
            'start_date' => ['required', 'date'], 'end_date' => ['nullable', 'date', 'after_or_equal:start_date'], 'notes' => ['nullable', 'string'],
        ]);
        $result = $operations->create($validated, $request->user()->id, $auditLogger);
        if (isset($result['error'])) return response()->json(['error' => $result['error']], $result['status']);
        return response()->json(['data' => SponsorshipView::item($result['item']->load(SponsorshipView::RELATIONS))], 201)->header('Cache-Control', 'private, no-store');
    }

    public function update(Request $request, Sponsorship $sponsorship, AuditLogger $auditLogger, SponsorshipOperations $operations)
    {
        $validated = $request->validate([
            'status' => ['required', Rule::in(['active', 'ended', 'paused'])],
            'end_date' => ['nullable', 'date', 'after_or_equal:'.$sponsorship->start_date->format('Y-m-d'), 'required_if:status,ended'],
            'notes' => ['nullable', 'string', 'required_if:status,ended'],
            'sponsor_id' => ['prohibited'], 'sponsorship_type' => ['prohibited'], 'student_id' => ['prohibited'], 'student_ids' => ['prohibited'], 'start_date' => ['prohibited'],
        ]);
        $result = $operations->update($sponsorship, $validated, $auditLogger);
        if (isset($result['error'])) return response()->json(['error' => $result['error']], $result['status']);
        return response()->json(['data' => SponsorshipView::item($result['item']->load(SponsorshipView::RELATIONS))])->header('Cache-Control', 'private, no-store');
    }
}
