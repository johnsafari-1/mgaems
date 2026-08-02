<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceStudent;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Implements SRS FR-ATT-01/02/03 and UC-ATT-01/03.
 *
 * NOTE: teacher-to-class allocation (class_subject_teacher) is not yet
 * built (see Development Roadmap Phase 2), so write access here is
 * currently gated to the "teacher" role broadly rather than restricted
 * to a teacher's own assigned class. That tightening is a follow-up once
 * allocation exists — tracked, not silently skipped.
 */
class AttendanceController extends Controller
{
    /**
     * Records attendance for an entire class on one date in a single
     * request. Uses updateOrCreate so re-submitting the same class/date
     * edits existing records rather than creating duplicates, per
     * UC-ATT-01's alternate flow.
     */
    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'class_id' => ['required', 'exists:classes,id'],
            'attendance_date' => ['required', 'date'],
            'records' => ['required', 'array', 'min:1'],
            'records.*.student_id' => ['required', 'exists:students,id'],
            'records.*.status' => ['required', Rule::in(['present', 'absent', 'late', 'excused'])],
        ]);

        $saved = DB::transaction(function () use ($validated) {
            $rows = [];
            foreach ($validated['records'] as $r) {
                $rows[] = AttendanceStudent::updateOrCreate(
                    [
                        'student_id' => $r['student_id'],
                        'attendance_date' => $validated['attendance_date'],
                    ],
                    [
                        'class_id' => $validated['class_id'],
                        'status' => $r['status'],
                        'recorded_by' => auth()->id(),
                    ]
                );
            }

            return $rows;
        });

        $auditLogger->log('RECORD_ATTENDANCE', 'SchoolClass', $validated['class_id'], [
            'attendance_date' => $validated['attendance_date'],
            'count' => count($saved),
        ]);

        return response()->json(['data' => $saved], 201);
    }

    /**
     * Query raw attendance records — filterable by class, student, and
     * date range, per FR-ATT-02 (daily/weekly/monthly reports).
     */
    public function index(Request $request)
    {
        $records = AttendanceStudent::with(['student:id,first_name,last_name,admission_no', 'schoolClass:id,name'])
            ->when($request->query('class_id'), fn ($q, $id) => $q->where('class_id', $id))
            ->when($request->query('student_id'), fn ($q, $id) => $q->where('student_id', $id))
            ->when($request->query('from'), fn ($q, $d) => $q->whereDate('attendance_date', '>=', $d))
            ->when($request->query('to'), fn ($q, $d) => $q->whereDate('attendance_date', '<=', $d))
            ->orderByDesc('attendance_date')
            ->get();

        return response()->json(['data' => $records]);
    }

    /**
     * Aggregated statistics for a class or student over a date range,
     * per FR-ATT-03.
     */
    public function summary(Request $request)
    {
        $validated = $request->validate([
            'class_id' => ['required_without:student_id', 'exists:classes,id'],
            'student_id' => ['required_without:class_id', 'exists:students,id'],
            'from' => ['required', 'date'],
            'to' => ['required', 'date', 'after_or_equal:from'],
        ]);

        $query = AttendanceStudent::whereBetween('attendance_date', [$validated['from'], $validated['to']]);

        if (! empty($validated['class_id'])) {
            $query->where('class_id', $validated['class_id']);
        }
        if (! empty($validated['student_id'])) {
            $query->where('student_id', $validated['student_id']);
        }

        $counts = (clone $query)->select('status', DB::raw('count(*) as total'))
            ->groupBy('status')
            ->pluck('total', 'status');

        $totalDays = array_sum($counts->toArray());
        $presentDays = $counts->get('present', 0);

        return response()->json([
            'data' => [
                'from' => $validated['from'],
                'to' => $validated['to'],
                'counts' => [
                    'present' => $counts->get('present', 0),
                    'absent' => $counts->get('absent', 0),
                    'late' => $counts->get('late', 0),
                    'excused' => $counts->get('excused', 0),
                ],
                'total_records' => $totalDays,
                'attendance_rate' => $totalDays > 0 ? round(($presentDays / $totalDays) * 100, 1) : null,
            ],
        ]);
    }
}
