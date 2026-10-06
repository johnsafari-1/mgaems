<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Assessment;
use App\Models\AttendanceStudent;
use App\Models\ReportCard;
use App\Models\Sponsor;
use App\Models\Sponsorship;
use App\Models\Student;
use App\Services\AuditLogger;
use Illuminate\Support\Facades\Storage;

class SponsorPortalController extends Controller
{
    public function mySponsorships()
    {
        $sponsor = Sponsor::where('user_id', auth()->id())->first();
        if (! $sponsor) return response()->json(['data' => []]);

        $items = Sponsorship::where('sponsor_id', $sponsor->id)
            ->with('student:id,admission_no,first_name,last_name,class_id,status', 'student.schoolClass:id,name,level')
            ->orderByDesc('start_date')->get()->map(fn ($item) => [
                'id' => $item->id, 'program_name' => $item->program_name,
                'sponsorship_type' => $item->sponsorship_type, 'status' => $item->status,
                'start_date' => $item->start_date?->toDateString(), 'end_date' => $item->end_date?->toDateString(),
                'learner' => $item->sponsorship_type === 'individual' && $item->student ? $this->studentData($item->student) : null,
            ]);

        return response()->json(['data' => $items]);
    }

    public function learners(Sponsorship $sponsorship, AuditLogger $auditLogger)
    {
        if ($denied = $this->denyUnlessOwned($sponsorship, $auditLogger)) return $denied;
        if ($sponsorship->sponsorship_type === 'school_wide') return $this->typeResponse('School-wide sponsorships provide programme-level information only.');

        $learners = $sponsorship->sponsorship_type === 'individual'
            ? Student::whereKey($sponsorship->student_id)->with('schoolClass:id,name,level')->get()
            : $sponsorship->students()->with('schoolClass:id,name,level')->orderBy('first_name')->get();
        return response()->json(['data' => $learners->map(fn ($student) => $this->studentData($student))]);
    }

    public function sponsorshipAttendance(Sponsorship $sponsorship, AuditLogger $auditLogger)
    { return $this->attendanceFor($sponsorship, null, $auditLogger); }
    public function learnerAttendance(Sponsorship $sponsorship, Student $student, AuditLogger $auditLogger)
    { return $this->attendanceFor($sponsorship, $student, $auditLogger); }

    public function sponsorshipReportCards(Sponsorship $sponsorship, AuditLogger $auditLogger)
    { return $this->reportCardsFor($sponsorship, null, $auditLogger); }
    public function learnerReportCards(Sponsorship $sponsorship, Student $student, AuditLogger $auditLogger)
    { return $this->reportCardsFor($sponsorship, $student, $auditLogger); }

    public function sponsorshipComments(Sponsorship $sponsorship, AuditLogger $auditLogger)
    { return $this->commentsFor($sponsorship, null, $auditLogger); }
    public function learnerComments(Sponsorship $sponsorship, Student $student, AuditLogger $auditLogger)
    { return $this->commentsFor($sponsorship, $student, $auditLogger); }

    public function downloadReportCard(Sponsorship $sponsorship, ReportCard $reportCard, AuditLogger $auditLogger)
    { return $this->downloadFor($sponsorship, null, $reportCard, $auditLogger); }
    public function downloadLearnerReportCard(Sponsorship $sponsorship, Student $student, ReportCard $reportCard, AuditLogger $auditLogger)
    { return $this->downloadFor($sponsorship, $student, $reportCard, $auditLogger); }

    private function attendanceFor(Sponsorship $sponsorship, ?Student $student, AuditLogger $logger)
    {
        $resolved = $this->resolveLearner($sponsorship, $student, $logger);
        if (! $resolved instanceof Student) return $resolved;
        $records = AttendanceStudent::where('student_id', $resolved->id)->orderByDesc('attendance_date')->get(['attendance_date', 'status']);
        $counts = $records->countBy('status'); $total = $records->count();
        return response()->json(['data' => ['student_id' => $resolved->id, 'summary' => [
            'present' => $counts->get('present', 0), 'absent' => $counts->get('absent', 0),
            'late' => $counts->get('late', 0), 'excused' => $counts->get('excused', 0), 'total' => $total,
            'attendance_percentage' => $total ? round(($counts->get('present', 0) + $counts->get('late', 0)) / $total * 100, 1) : null,
        ], 'recent' => $records->take(30)->map(fn ($r) => ['date' => $r->attendance_date->toDateString(), 'status' => $r->status])->values()]]);
    }

    private function reportCardsFor(Sponsorship $sponsorship, ?Student $student, AuditLogger $logger)
    {
        $resolved = $this->resolveLearner($sponsorship, $student, $logger);
        if (! $resolved instanceof Student) return $resolved;
        $cards = ReportCard::where('student_id', $resolved->id)->with('term:id,name')->orderByDesc('generated_at')->get()->map(fn ($c) => [
            'id' => $c->id, 'term' => $c->term ? ['id' => $c->term->id, 'name' => $c->publishedSnapshot()['term']['name'] ?? $c->term->name] : null,
            'overall_remark' => $c->overall_remark, 'generated_date' => $c->generated_at?->toDateString(), 'download_available' => $c->file_path && Storage::disk('private')->exists($c->file_path),
        ]);
        return response()->json(['data' => $cards]);
    }

    private function commentsFor(Sponsorship $sponsorship, ?Student $student, AuditLogger $logger)
    {
        $resolved = $this->resolveLearner($sponsorship, $student, $logger);
        if (! $resolved instanceof Student) return $resolved;
        $items = Assessment::where('student_id', $resolved->id)->whereNotNull('remarks')
            ->with('subject:id,name', 'term:id,name')->orderByDesc('recorded_at')->get()->map(fn ($a) => [
                'subject' => $a->context_snapshot['subject']['name'] ?? $a->subject?->name,
                'term' => $a->context_snapshot['term']['name'] ?? $a->term?->name, 'assessment_type' => $a->assessment_type,
                'score' => $a->score, 'competency_rating' => $a->competency_rating, 'remarks' => $a->remarks,
                'recorded_date' => $a->recorded_at?->toDateString(),
            ]);
        return response()->json(['data' => $items]);
    }

    private function downloadFor(Sponsorship $sponsorship, ?Student $student, ReportCard $card, AuditLogger $logger)
    {
        $resolved = $this->resolveLearner($sponsorship, $student, $logger);
        if (! $resolved instanceof Student) return $resolved;
        if ($card->student_id !== $resolved->id) return $this->forbidden('This report card is not part of the sponsorship.');
        return app(\App\Services\ReportArtifacts::class)->download($card);
    }

    private function resolveLearner(Sponsorship $sponsorship, ?Student $student, AuditLogger $logger)
    {
        if ($denied = $this->denyUnlessOwned($sponsorship, $logger)) return $denied;
        if ($sponsorship->sponsorship_type === 'school_wide') return $this->typeResponse('School-wide sponsorships do not provide learner-level records.');
        if ($sponsorship->sponsorship_type === 'individual') {
            if ($student && $student->id !== $sponsorship->student_id) return $this->forbidden('This learner is not part of the sponsorship.');
            return Student::findOrFail($sponsorship->student_id);
        }
        if (! $student) return $this->typeResponse('Select a learner from this group sponsorship.');
        if (! $sponsorship->students()->whereKey($student->id)->exists()) return $this->forbidden('This learner is not part of the sponsorship.');
        return $student;
    }

    private function denyUnlessOwned(Sponsorship $sponsorship, AuditLogger $logger)
    {
        $sponsor = Sponsor::where('user_id', auth()->id())->first();
        if ($sponsor && $sponsorship->sponsor_id === $sponsor->id) return null;
        $logger->log('PORTAL_ACCESS_DENIED', 'Sponsorship', $sponsorship->id, ['reason' => 'not_own_sponsorship']);
        return $this->forbidden('This sponsorship is not linked to your account.');
    }

    private function studentData(Student $student): array
    {
        return ['id' => $student->id, 'admission_no' => $student->admission_no, 'first_name' => $student->first_name,
            'last_name' => $student->last_name, 'status' => $student->status, 'class' => $student->schoolClass ? [
                'id' => $student->schoolClass->id, 'name' => $student->schoolClass->name, 'level' => $student->schoolClass->level] : null];
    }
    private function forbidden(string $message) { return response()->json(['error' => ['code' => 'FORBIDDEN', 'message' => $message]], 403); }
    private function typeResponse(string $message) { return response()->json(['error' => ['code' => 'SPONSORSHIP_TYPE_UNSUPPORTED', 'message' => $message]], 422); }
}
