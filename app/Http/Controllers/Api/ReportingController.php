<?php

namespace App\Http\Controllers\Api;

use App\Exports\StudentsExport;
use App\Http\Controllers\Controller;
use App\Models\AttendanceStudent;
use App\Models\Sponsorship;
use App\Models\Staff;
use App\Models\Student;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Maatwebsite\Excel\Facades\Excel;

/**
 * Implements SRS FR-REP-01..07: cross-module reporting.
 *
 * School statistics is JSON now (a PDF/print view can reuse the same
 * data via the report-card PDF pattern already proven). Student export
 * is the first Excel report — proving that pipeline works, same as
 * report cards proved the PDF pipeline.
 */
class ReportingController extends Controller
{
    public function schoolStatistics(AuditLogger $auditLogger)
    {
        $studentCounts = Student::selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');
        $staffCounts = Staff::selectRaw('staff_type, count(*) as total')->groupBy('staff_type')->pluck('total', 'staff_type');
        $activeSponsorships = Sponsorship::where('status', 'active')->count();

        $today = now()->toDateString();
        $todayAttendance = AttendanceStudent::whereDate('attendance_date', $today)
            ->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');
        $todayTotal = array_sum($todayAttendance->toArray());
        $todayPresent = $todayAttendance->get('present', 0);

        $auditLogger->log('VIEW_SCHOOL_STATISTICS');

        return response()->json([
            'data' => [
                'students' => [
                    'total' => array_sum($studentCounts->toArray()),
                    'by_status' => $studentCounts,
                ],
                'staff' => [
                    'total' => array_sum($staffCounts->toArray()),
                    'by_type' => $staffCounts,
                ],
                'active_sponsorships' => $activeSponsorships,
                'attendance_today' => [
                    'date' => $today,
                    'rate' => $todayTotal > 0 ? round(($todayPresent / $todayTotal) * 100, 1) : null,
                    'recorded' => $todayTotal,
                ],
            ],
        ]);
    }

    /**
     * FR-REP-01: student report, Excel format.
     */
    public function exportStudents(Request $request, AuditLogger $auditLogger)
    {
        $auditLogger->log('EXPORT_STUDENTS_REPORT', null, null, $request->only('class_id', 'status'));

        return Excel::download(
            new StudentsExport($request->query('class_id'), $request->query('status')),
            'students-report.xlsx'
        );
    }
}
