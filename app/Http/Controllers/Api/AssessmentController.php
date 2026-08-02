<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Assessment;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Implements SRS FR-ASM-01/02/03/04 and UC-ASM-01/02.
 *
 * Same access-scope note as AttendanceController: teacher-to-class
 * allocation isn't built yet, so "own classes" isn't enforced at the
 * route level for the teacher role — tracked as a follow-up.
 */
class AssessmentController extends Controller
{
    /**
     * The CBC competency rating scale, per SRS FR-ASM-03. Kept as a
     * validated set of strings rather than a separate config table for
     * now — administrators can request this become configurable via
     * system settings in a later increment if needed.
     */
    private const COMPETENCY_RATINGS = [
        'Exceeding Expectation',
        'Meeting Expectation',
        'Approaching Expectation',
        'Below Expectation',
    ];

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'student_id' => ['required', 'exists:students,id'],
            'subject_id' => ['required', 'exists:subjects,id'],
            'term_id' => ['required', 'exists:terms,id'],
            'assessment_type' => ['required', Rule::in(['continuous', 'end_term'])],
            'score' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'competency_rating' => ['nullable', Rule::in(self::COMPETENCY_RATINGS)],
            'remarks' => ['nullable', 'string'],
        ]);

        $assessment = Assessment::create($validated + [
            'recorded_by' => auth()->id(),
            'recorded_at' => now(),
        ]);

        $auditLogger->log('RECORD_ASSESSMENT', 'Assessment', $assessment->id, $validated);

        return response()->json(['data' => $assessment->load('subject', 'term')], 201);
    }

    public function index(Request $request)
    {
        $assessments = Assessment::with(['subject:id,name', 'term:id,name'])
            ->when($request->query('student_id'), fn ($q, $id) => $q->where('student_id', $id))
            ->when($request->query('subject_id'), fn ($q, $id) => $q->where('subject_id', $id))
            ->when($request->query('term_id'), fn ($q, $id) => $q->where('term_id', $id))
            ->when($request->query('assessment_type'), fn ($q, $t) => $q->where('assessment_type', $t))
            ->orderByDesc('recorded_at')
            ->get();

        return response()->json(['data' => $assessments]);
    }
}
