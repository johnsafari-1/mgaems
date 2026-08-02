<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceStudent;
use App\Models\Guardian;
use App\Models\ReportCard;
use App\Models\Student;
use App\Services\AuditLogger;
use Illuminate\Support\Facades\DB;

/**
 * Implements SRS FR-PAR-01..06 and UC-PAR-01.
 *
 * Every method here independently re-verifies that the authenticated
 * parent/guardian is actually linked to the requested student via the
 * guardians table — this is the server-side enforcement of "own-data
 * only" access from the User Role Matrix, checked on every request per
 * SRS FR-AUTH-04, not assumed from the role alone.
 */
class ParentPortalController extends Controller
{
    public function myChildren()
    {
        $studentIds = Guardian::where('user_id', auth()->id())->pluck('student_id');
        $children = Student::with('schoolClass', 'stream')->whereIn('id', $studentIds)->get();

        return response()->json(['data' => $children]);
    }

    public function childAttendance(Student $student, AuditLogger $auditLogger)
    {
        if (! $this->isOwnChild($student->id)) {
            $auditLogger->log('PORTAL_ACCESS_DENIED', 'Student', $student->id, ['reason' => 'not_own_child']);

            return $this->forbidden();
        }

        $counts = AttendanceStudent::where('student_id', $student->id)
            ->select('status', DB::raw('count(*) as total'))
            ->groupBy('status')
            ->pluck('total', 'status');

        return response()->json([
            'data' => [
                'student_id' => $student->id,
                'counts' => [
                    'present' => $counts->get('present', 0),
                    'absent' => $counts->get('absent', 0),
                    'late' => $counts->get('late', 0),
                    'excused' => $counts->get('excused', 0),
                ],
            ],
        ]);
    }

    public function childReportCards(Student $student, AuditLogger $auditLogger)
    {
        if (! $this->isOwnChild($student->id)) {
            $auditLogger->log('PORTAL_ACCESS_DENIED', 'Student', $student->id, ['reason' => 'not_own_child']);

            return $this->forbidden();
        }

        $reportCards = ReportCard::where('student_id', $student->id)->with('term')->get();

        return response()->json(['data' => $reportCards]);
    }

    public function childProgress(Student $student, AuditLogger $auditLogger)
    {
        if (! $this->isOwnChild($student->id)) {
            $auditLogger->log('PORTAL_ACCESS_DENIED', 'Student', $student->id, ['reason' => 'not_own_child']);

            return $this->forbidden();
        }

        $progress = $student->assessments()
            ->with('subject:id,name', 'term:id,name')
            ->orderBy('term_id')
            ->get()
            ->groupBy('term_id');

        return response()->json(['data' => $progress]);
    }

    private function isOwnChild(int $studentId): bool
    {
        return Guardian::where('student_id', $studentId)->where('user_id', auth()->id())->exists();
    }

    private function forbidden()
    {
        return response()->json([
            'error' => ['code' => 'FORBIDDEN', 'message' => 'This learner is not linked to your account.'],
        ], 403);
    }
}
