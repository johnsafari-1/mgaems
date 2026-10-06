<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Assessment;
use App\Models\AttendanceStudent;
use App\Models\Guardian;
use App\Models\ReportCard;
use App\Models\Student;
use App\Services\AuditLogger;
use Illuminate\Support\Facades\Storage;

class ParentPortalController extends Controller
{
    public function myChildren()
    {
        $children = Student::query()
            ->select('id', 'admission_no', 'first_name', 'last_name', 'class_id', 'status')
            ->with('schoolClass:id,name,level')
            ->whereIn('id', Guardian::where('user_id', auth()->id())->select('student_id'))
            ->orderBy('first_name')->orderBy('last_name')->get()
            ->map(fn (Student $student) => $this->studentData($student));

        return response()->json(['data' => $children]);
    }

    public function childAttendance(Student $student, AuditLogger $auditLogger)
    {
        if ($denied = $this->denyUnlessOwnChild($student, $auditLogger)) return $denied;

        $records = AttendanceStudent::where('student_id', $student->id)
            ->orderByDesc('attendance_date')->get(['attendance_date', 'status']);
        $counts = $records->countBy('status');
        $total = $records->count();
        $attended = $counts->get('present', 0) + $counts->get('late', 0);

        return response()->json(['data' => [
            'student_id' => $student->id,
            'summary' => [
                'present' => $counts->get('present', 0), 'absent' => $counts->get('absent', 0),
                'late' => $counts->get('late', 0), 'excused' => $counts->get('excused', 0),
                'total' => $total, 'attendance_percentage' => $total ? round($attended / $total * 100, 1) : null,
            ],
            'recent' => $records->take(30)->map(fn ($record) => [
                'date' => $record->attendance_date->toDateString(), 'status' => $record->status,
            ])->values(),
        ]]);
    }

    public function childProgress(Student $student, AuditLogger $auditLogger)
    {
        if ($denied = $this->denyUnlessOwnChild($student, $auditLogger)) return $denied;

        $progress = Assessment::where('student_id', $student->id)
            ->with('subject:id,name', 'term:id,name')->orderByDesc('recorded_at')->get()
            ->map(fn (Assessment $assessment) => [
                'subject' => $assessment->context_snapshot['subject']['name'] ?? $assessment->subject?->name,
                'term' => $assessment->context_snapshot['term']['name'] ?? $assessment->term?->name,
                'assessment_type' => $assessment->assessment_type, 'score' => $assessment->score,
                'competency_rating' => $assessment->competency_rating, 'remarks' => $assessment->remarks,
                'recorded_date' => $assessment->recorded_at?->toDateString(),
            ]);

        return response()->json(['data' => $progress]);
    }

    public function childReportCards(Student $student, AuditLogger $auditLogger)
    {
        if ($denied = $this->denyUnlessOwnChild($student, $auditLogger)) return $denied;

        return response()->json(['data' => ReportCard::where('student_id', $student->id)
            ->with('term:id,name')->orderByDesc('generated_at')->get()->map(fn ($card) => $this->reportCardData($card))]);
    }

    public function downloadReportCard(Student $student, ReportCard $reportCard, AuditLogger $auditLogger)
    {
        if ($denied = $this->denyUnlessOwnChild($student, $auditLogger)) return $denied;
        if ($reportCard->student_id !== $student->id) return $this->forbidden();

        return $this->download($reportCard);
    }

    private function studentData(Student $student): array
    {
        return ['id' => $student->id, 'admission_no' => $student->admission_no,
            'first_name' => $student->first_name, 'last_name' => $student->last_name,
            'status' => $student->status, 'class' => $student->schoolClass ? [
                'id' => $student->schoolClass->id, 'name' => $student->schoolClass->name,
                'level' => $student->schoolClass->level,
            ] : null];
    }

    private function reportCardData(ReportCard $card): array
    {
        $snapshot = $card->publishedSnapshot();
        return ['id' => $card->id, 'term' => $card->term ? ['id' => $card->term->id, 'name' => $snapshot['term']['name'] ?? $card->term->name] : null,
            'overall_remark' => $card->overall_remark, 'generated_date' => $card->generated_at?->toDateString(),
            'download_available' => $card->file_path && Storage::disk('private')->exists($card->file_path)];
    }

    private function denyUnlessOwnChild(Student $student, AuditLogger $auditLogger)
    {
        if (Guardian::where('student_id', $student->id)->where('user_id', auth()->id())->exists()) return null;
        $auditLogger->log('PORTAL_ACCESS_DENIED', 'Student', $student->id, ['reason' => 'not_own_child']);
        return $this->forbidden();
    }

    private function download(ReportCard $card)
    {
        return app(\App\Services\ReportArtifacts::class)->download($card);
    }

    private function forbidden()
    {
        return response()->json(['error' => ['code' => 'FORBIDDEN', 'message' => 'This learner is not linked to your account.']], 403);
    }
}
