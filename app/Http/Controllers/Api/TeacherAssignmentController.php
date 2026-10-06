<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClassSubjectTeacher;
use App\Models\Term;
use App\Models\TimetableEntry;
use App\Services\AcademicIntegrity;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class TeacherAssignmentController extends Controller
{
    private const RELATIONS = ['schoolClass:id,name', 'subject:id,name', 'staff:id,first_name,last_name', 'term:id,academic_year_id,name', 'term.academicYear:id,name'];

    public function __construct(private AcademicIntegrity $integrity)
    {
    }

    public function index(Request $request)
    {
        $filters = $request->validate([
            'term_id' => ['sometimes', 'integer', 'exists:terms,id'],
            'staff_id' => ['sometimes', 'integer', 'exists:staff,id'],
            'class_id' => ['sometimes', 'integer', 'exists:classes,id'],
        ]);
        $assignments = ClassSubjectTeacher::with(self::RELATIONS)
            ->when($filters['term_id'] ?? null, fn ($query, $id) => $query->where('term_id', $id))
            ->when($filters['staff_id'] ?? null, fn ($query, $id) => $query->where('staff_id', $id))
            ->when($filters['class_id'] ?? null, fn ($query, $id) => $query->where('class_id', $id))
            ->orderBy('term_id')->orderBy('class_id')->orderBy('subject_id')->get();

        return response()->json(['data' => $assignments]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'class_id' => ['required', 'integer', 'exists:classes,id'],
            'subject_id' => ['required', 'integer', Rule::exists('subjects', 'id')->where('status', 'active')],
            'staff_id' => ['required', 'integer', Rule::exists('staff', 'id')->where('status', 'active')->where('staff_type', 'teaching')],
            'term_id' => ['required', 'integer', 'exists:terms,id'],
        ], [
            'staff_id.exists' => 'Choose an active member of teaching staff.',
            'subject_id.exists' => 'Choose an active learning area/subject.',
        ]);
        return $this->integrity->transaction(function () use ($validated, $auditLogger) {
            $this->integrity->lockClass((int) $validated['class_id']);
            $this->integrity->lockSubject((int) $validated['subject_id'], true);
            $this->integrity->lockTeacher((int) $validated['staff_id']);
            Term::whereKey($validated['term_id'])->lockForUpdate()->firstOrFail();
            $this->integrity->requireOffering((int) $validated['class_id'], (int) $validated['subject_id']);
            if (ClassSubjectTeacher::where('class_id', $validated['class_id'])->where('subject_id', $validated['subject_id'])->where('term_id', $validated['term_id'])->exists()) {
                return $this->integrity->conflict('DUPLICATE_ASSIGNMENT', 'This class/learning-area/term combination is already assigned to a teacher.');
            }
            $assignment = ClassSubjectTeacher::create($validated);
            $auditLogger->log('CREATE_TEACHER_ASSIGNMENT', 'ClassSubjectTeacher', $assignment->id, $validated);

            return response()->json(['data' => $assignment->load(self::RELATIONS)], 201);
        });
    }

    public function destroy(ClassSubjectTeacher $classSubjectTeacher, AuditLogger $auditLogger)
    {
        return $this->integrity->transaction(function () use ($classSubjectTeacher, $auditLogger) {
            $this->integrity->lockClass((int) $classSubjectTeacher->class_id);
            $this->integrity->lockSubject((int) $classSubjectTeacher->subject_id);
            Term::whereKey($classSubjectTeacher->term_id)->lockForUpdate()->firstOrFail();
            $assignment = ClassSubjectTeacher::whereKey($classSubjectTeacher->id)->lockForUpdate()->firstOrFail();
            if ($this->integrity->hasAssessments((int) $assignment->class_id, (int) $assignment->subject_id, (int) $assignment->term_id)
                || TimetableEntry::where('class_id', $assignment->class_id)->where('subject_id', $assignment->subject_id)->where('staff_id', $assignment->staff_id)->exists()) {
                return $this->integrity->conflict('ASSIGNMENT_IN_USE', 'This assignment has assessment history or recurring timetable entries. Preserve historical teacher authorization and resolve timetable dependencies first.');
            }
            $assignment->delete();
            $auditLogger->log('DELETE_TEACHER_ASSIGNMENT', 'ClassSubjectTeacher', $assignment->id);

            return response()->json(['data' => ['message' => 'Assignment removed.']]);
        });
    }
}
