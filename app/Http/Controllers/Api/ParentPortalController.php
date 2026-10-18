<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceStudent;
use App\Models\ClassSubjectTeacher;
use App\Models\Guardian;
use App\Models\Homework;
use App\Models\ReportCard;
use App\Models\Role;
use App\Models\Student;
use App\Models\TimetableEntry;
use App\Services\AuditLogger;
use App\Services\ParentReportView;
use App\Services\TeacherWorkspaceAccess;
use App\Services\TeachingDocumentData;
use Illuminate\Validation\ValidationException;

class ParentPortalController extends Controller
{
    public function myChildren()
    {
        if (! $user = $this->parentUser()) return $this->forbidden();
        $children = Student::select('id', 'admission_no', 'first_name', 'last_name', 'class_id', 'status')
            ->with('schoolClass:id,name,level')
            ->whereIn('id', Guardian::where('user_id', $user->id)->select('student_id'))
            ->orderBy('first_name')->orderBy('last_name')->orderBy('id')->get();
        return $this->json(['data' => $children->map(fn ($student) => $this->studentData($student))]);
    }

    public function childOverview($student, AuditLogger $auditLogger)
    {
        if (! $child = $this->ownChild($student, $auditLogger)) return $this->forbidden();
        return $this->json(['data' => $this->studentData($child->load('schoolClass:id,name,level'))
            + ['current_periods' => $this->periods()]]);
    }

    public function childAttendance($student, AuditLogger $auditLogger)
    {
        if (! $child = $this->ownChild($student, $auditLogger)) return $this->forbidden();
        $filters = request()->validate(['page' => ['sometimes', 'integer', 'min:1', 'max:1000000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'from' => ['sometimes', 'date_format:Y-m-d'], 'to' => ['sometimes', 'date_format:Y-m-d']]);
        if (isset($filters['from'], $filters['to']) && $filters['from'] > $filters['to']) {
            throw ValidationException::withMessages(['to' => 'The end date must be on or after the start date.']);
        }
        $query = AttendanceStudent::where('student_id', $child->id)
            ->when($filters['from'] ?? null, fn ($query, $from) => $query->whereDate('attendance_date', '>=', $from))
            ->when($filters['to'] ?? null, fn ($query, $to) => $query->whereDate('attendance_date', '<=', $to));
        $counts = (clone $query)->selectRaw('status, COUNT(*) AS total')->groupBy('status')->pluck('total', 'status');
        $total = (int) $counts->sum();
        $records = $query->with('schoolClass:id,name')->orderByDesc('attendance_date')->orderByDesc('id')
            ->paginate($filters['per_page'] ?? 30);
        $rows = $records->getCollection()->map(fn ($record) => ['date' => $record->attendance_date->toDateString(),
            'status' => $record->status, 'class' => $record->schoolClass?->only(['id', 'name'])]);
        return $this->json(['data' => ['student_id' => $child->id, 'summary' => [
            'present' => (int) $counts->get('present', 0), 'absent' => (int) $counts->get('absent', 0),
            'late' => (int) $counts->get('late', 0), 'excused' => (int) $counts->get('excused', 0), 'total' => $total,
            'attendance_percentage' => $total ? round(((int) $counts->get('present', 0) + (int) $counts->get('late', 0)) / $total * 100, 1) : null,
        ], 'recent' => $rows->map(fn ($row) => ['date' => $row['date'], 'status' => $row['status']])->values(), 'records' => $rows->values()],
            'meta' => ['page' => $records->currentPage(), 'per_page' => $records->perPage(), 'total' => $records->total()]]);
    }

    public function childProgress($student, AuditLogger $auditLogger)
    {
        if (! $child = $this->ownChild($student, $auditLogger)) return $this->forbidden();
        $view = new ParentReportView(); $progress = [];
        foreach (ReportCard::where('student_id', $child->id)->orderByDesc('generated_at')->orderByDesc('id')->get() as $card) {
            if ($publication = $view->publication($card)) array_push($progress, ...$view->progress($card, $publication));
        }
        return $this->json(['data' => $progress, 'meta' => ['disclosure' => 'available_report_snapshots']]);
    }

    public function childReportCards($student, AuditLogger $auditLogger)
    {
        if (! $child = $this->ownChild($student, $auditLogger)) return $this->forbidden();
        $view = new ParentReportView(); $cards = [];
        foreach (ReportCard::where('student_id', $child->id)->with('term:id,name')->orderByDesc('generated_at')->orderByDesc('id')->get() as $card) {
            if ($publication = $view->publication($card)) $cards[] = $view->summary($card, $publication);
        }
        return $this->json(['data' => $cards]);
    }

    public function downloadReportCard($student, $reportCard, AuditLogger $auditLogger)
    {
        if (! $child = $this->ownChild($student, $auditLogger)) return $this->forbidden();
        $id = $reportCard instanceof ReportCard ? $reportCard->id : $reportCard;
        if (! $id = filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])) return $this->forbidden();
        $card = ReportCard::whereKey($id)->where('student_id', $child->id)->first();
        if (! $card) return $this->forbidden();
        if (! (new ParentReportView())->publication($card)) {
            return $this->json(['error' => ['code' => 'FILE_NOT_FOUND', 'message' => 'The report card file could not be found.']], 404);
        }
        return $this->noStore(app(\App\Services\ReportArtifacts::class)->download($card));
    }

    /**
     * Read-only homework for a linked child. Only published homework from an
     * eligible current teaching allocation is returned: active teaching staff,
     * active learning area, an existing class offering, and a current academic
     * period for the child's current class. Answer keys, marking guidance and
     * internal teacher notes are never exposed.
     */
    public function childHomework($student, AuditLogger $auditLogger)
    {
        if (! $child = $this->ownChild($student, $auditLogger)) return $this->forbidden();
        $reason = $child->status !== 'active' ? 'not_currently_enrolled' : (! $child->class_id ? 'no_class' : null);
        $rows = collect();
        if (! $reason) {
            $periods = (new TeacherWorkspaceAccess())->periods()->select('terms.id');
            $rows = Homework::where('status', 'published')
                ->whereHas('assignment', fn ($assignment) => $assignment->where('class_id', $child->class_id)
                    ->whereIn('term_id', $periods)
                    ->whereHas('staff', fn ($staff) => $staff->where('status', 'active')->where('staff_type', 'teaching'))
                    ->whereHas('subject', fn ($subject) => $subject->where('status', 'active'))
                    ->whereExists(fn ($offering) => $offering->selectRaw('1')->from('class_subjects')
                        ->whereColumn('class_subjects.class_id', 'class_subject_teacher.class_id')
                        ->whereColumn('class_subjects.subject_id', 'class_subject_teacher.subject_id')))
                ->with('assignment.schoolClass:id,name', 'assignment.subject:id,name', 'assignment.term:id,name',
                    'questions:id,homework_id,position,question_type,prompt,marks,diagram_reference,options')
                ->orderBy('due_on')->orderBy('id')->get()
                ->map(fn ($homework) => (new TeachingDocumentData())->homeworkFamily($homework));
        }

        return $this->json(['data' => $rows, 'meta' => ['visibility' => 'published_only', 'unavailable_reason' => $reason ?: ($rows->isEmpty() ? 'no_published_homework' : null)]]);
    }

    public function childTimetable($student, AuditLogger $auditLogger)
    {
        if (! $child = $this->ownChild($student, $auditLogger)) return $this->forbidden();
        $calendar = new TeacherWorkspaceAccess(); $periods = $this->periods();
        $reason = $child->status !== 'active' ? 'not_currently_enrolled' : (! $child->class_id ? 'no_class' : (! $periods ? 'no_current_period' : null));
        $rows = collect();
        if (! $reason) {
            $assignment = ClassSubjectTeacher::whereIn('term_id', $calendar->periods()->select('terms.id'))
                ->whereColumn('class_subject_teacher.class_id', 'timetable_entries.class_id')
                ->whereColumn('class_subject_teacher.subject_id', 'timetable_entries.subject_id')
                ->whereColumn('class_subject_teacher.staff_id', 'timetable_entries.staff_id')->selectRaw('1');
            $rows = TimetableEntry::where('class_id', $child->class_id)
                ->whereHas('staff', fn ($staff) => $staff->where('status', 'active')->where('staff_type', 'teaching'))
                ->whereHas('subject', fn ($subject) => $subject->where('status', 'active'))
                ->whereExists($assignment->toBase())
                ->whereExists(fn ($offering) => $offering->selectRaw('1')->from('class_subjects')
                    ->whereColumn('class_subjects.class_id', 'timetable_entries.class_id')
                    ->whereColumn('class_subjects.subject_id', 'timetable_entries.subject_id'))
                ->with('subject:id,name,code')->orderBy('day_of_week')->orderBy('start_time')->orderBy('id')->get()
                ->map(fn ($row) => ['id' => $row->id, 'day_of_week' => $row->day_of_week,
                    'start_time' => $row->start_time, 'end_time' => $row->end_time,
                    'subject' => $row->subject->only(['id', 'name', 'code'])]);
        }
        return $this->json(['data' => $rows, 'meta' => ['schedule_type' => 'current_available_class',
            'current_periods' => $periods, 'unavailable_reason' => $reason ?: ($rows->isEmpty() ? 'no_eligible_entries' : null)]]);
    }

    private function periods(): array
    {
        return (new TeacherWorkspaceAccess())->periods()->with('academicYear:id,name')->orderBy('id')
            ->get(['id', 'name', 'academic_year_id'])->map(fn ($term) => [
                'id' => $term->id, 'name' => $term->name, 'academic_year' => $term->academicYear->only(['id', 'name']),
            ])->all();
    }

    private function parentUser()
    {
        $user = auth()->user()?->fresh('role');
        return $user && $user->status === 'active' && $user->hasRole(Role::PARENT_GUARDIAN) ? $user : null;
    }

    private function ownChild($student, AuditLogger $auditLogger): ?Student
    {
        $id = $student instanceof Student ? $student->id : $student;
        $id = filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) ?: null;
        $user = $this->parentUser();
        if ($user && $id && Guardian::where('student_id', $id)->where('user_id', $user->id)->exists()) return Student::find($id);
        $auditLogger->log('PORTAL_ACCESS_DENIED', 'Student', $id, ['reason' => 'not_own_child']);
        return null;
    }

    private function studentData(Student $student): array
    {
        return $student->only(['id', 'admission_no', 'first_name', 'last_name', 'status'])
            + ['class' => $student->schoolClass?->only(['id', 'name', 'level'])];
    }

    private function forbidden()
    {
        return $this->json(['error' => ['code' => 'FORBIDDEN', 'message' => 'This learner is not linked to your account.']], 403);
    }

    private function json(array $data, int $status = 200)
    {
        return $this->noStore(response()->json($data, $status));
    }

    private function noStore($response)
    {
        $response->headers->set('Cache-Control', 'private, no-store');
        return $response;
    }
}
