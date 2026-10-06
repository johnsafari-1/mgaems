<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\AcademicClassResource;
use App\Models\Assessment;
use App\Models\ClassSubjectTeacher;
use App\Models\SchoolClass;
use App\Models\Staff;
use App\Models\Subject;
use App\Models\TimetableEntry;
use App\Services\AcademicIntegrity;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AcademicStructureController extends Controller
{
    public function __construct(private AcademicIntegrity $integrity)
    {
    }

    public function indexClasses(Request $request)
    {
        $classes = SchoolClass::withCount(['students', 'subjects'])
            ->with('classTeacher:id,first_name,last_name')->orderBy('sequence')->orderBy('name')->get();

        return response()->json(['data' => $classes->map(fn ($class) => (new AcademicClassResource($class))->resolve($request))]);
    }

    public function staffOptions()
    {
        return response()->json(['data' => Staff::where('status', 'active')->where('staff_type', 'teaching')
            ->orderBy('first_name')->orderBy('last_name')->orderBy('id')->get(['id', 'first_name', 'last_name'])
            ->map(fn ($staff) => ['id' => $staff->id, 'display_name' => trim($staff->first_name.' '.$staff->last_name)])]);
    }

    public function storeClass(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->classRules(), ['class_teacher_id.exists' => 'Choose an active member of teaching staff as class teacher.']);
        return $this->integrity->transaction(function () use ($request, $validated, $auditLogger) {
            if (! empty($validated['class_teacher_id'])) $this->integrity->lockTeacher((int) $validated['class_teacher_id'], 'class_teacher_id');
            $class = SchoolClass::create($validated);
            $auditLogger->log('CREATE_CLASS', 'SchoolClass', $class->id, $validated);

            return response()->json(['data' => $this->classData($request, $class)], 201);
        });
    }

    public function updateClass(Request $request, SchoolClass $class, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->classRules($class), ['class_teacher_id.exists' => 'Choose an active member of teaching staff as class teacher.']);
        return $this->integrity->transaction(function () use ($request, $validated, $class, $auditLogger) {
            $class = $this->integrity->lockClass($class->id);
            if (! empty($validated['class_teacher_id'])) $this->integrity->lockTeacher((int) $validated['class_teacher_id'], 'class_teacher_id');
            $class->update($validated);
            $auditLogger->log('UPDATE_CLASS', 'SchoolClass', $class->id, $validated);

            return response()->json(['data' => $this->classData($request, $class)]);
        });
    }

    public function destroyClass(SchoolClass $class, AuditLogger $auditLogger)
    {
        return $this->integrity->transaction(function () use ($class, $auditLogger) {
            $class = $this->integrity->lockClass($class->id);
            if ($class->students()->exists()) return $this->integrity->conflict('CLASS_HAS_STUDENTS', 'This class has learner records and cannot be deleted.');
            if ($this->integrity->hasClassHistory($class->id)
                || $class->subjects()->exists()
                || ClassSubjectTeacher::where('class_id', $class->id)->exists()
                || TimetableEntry::where('class_id', $class->id)->exists()) {
                return $this->integrity->conflict('CLASS_IN_USE', 'This class has historical placements, offerings, teacher assignments, or timetable entries. Preserve those records.');
            }
            $class->delete();
            $auditLogger->log('DELETE_CLASS', 'SchoolClass', $class->id);

            return response()->json(['data' => ['message' => 'Class deleted.']]);
        });
    }

    public function indexSubjects()
    {
        return response()->json(['data' => Subject::orderBy('name')->orderBy('id')->get(['id', 'name', 'code', 'learning_area', 'status'])]);
    }

    public function storeSubject(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->subjectRules());
        return $this->integrity->transaction(function () use ($validated, $auditLogger) {
            $subject = Subject::create($validated + ['status' => 'active']);
            $auditLogger->log('CREATE_SUBJECT', 'Subject', $subject->id, $validated);

            return response()->json(['data' => $subject], 201);
        });
    }

    public function updateSubject(Request $request, Subject $subject, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->subjectRules($subject));
        return $this->integrity->transaction(function () use ($validated, $subject, $auditLogger) {
            $subject = $this->integrity->lockSubject($subject->id);
            $subject->update($validated);
            $auditLogger->log('UPDATE_SUBJECT', 'Subject', $subject->id, $validated);

            return response()->json(['data' => $subject]);
        });
    }

    public function indexClassSubjects(Request $request)
    {
        $validated = $request->validate(['class_id' => ['required', 'integer', 'exists:classes,id']]);
        $subjects = SchoolClass::findOrFail($validated['class_id'])->subjects()
            ->orderBy('subjects.name')->get(['subjects.id', 'name', 'code', 'learning_area', 'status'])
            ->map(fn ($subject) => $subject->only(['id', 'name', 'code', 'learning_area', 'status']));

        return response()->json(['data' => $subjects]);
    }

    public function attachSubjectToClass(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->offeringRules());
        return $this->integrity->transaction(function () use ($validated, $auditLogger) {
            $class = $this->integrity->lockClass((int) $validated['class_id']);
            $subject = $this->integrity->lockSubject((int) $validated['subject_id'], true);
            if ($class->subjects()->where('subjects.id', $subject->id)->exists()) {
                return $this->integrity->conflict('ALREADY_ATTACHED', 'This learning area is already offered by the class.');
            }
            $class->subjects()->attach($subject->id);
            $auditLogger->log('ATTACH_SUBJECT_TO_CLASS', 'SchoolClass', $class->id, $validated);

            return response()->json(['data' => ['message' => 'Learning area offered by class.']], 201);
        });
    }

    public function detachSubjectFromClass(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->offeringRules());
        return $this->integrity->transaction(function () use ($validated, $auditLogger) {
            $class = $this->integrity->lockClass((int) $validated['class_id']);
            $subject = $this->integrity->lockSubject((int) $validated['subject_id']);
            if (! $class->subjects()->where('subjects.id', $subject->id)->exists()) {
                return response()->json(['error' => ['code' => 'OFFERING_NOT_FOUND', 'message' => 'This class does not offer the selected learning area.']], 404);
            }
            if ($this->integrity->offeringInUse($class->id, $subject->id)) {
                return $this->integrity->conflict('OFFERING_IN_USE', 'This offering has teacher assignments, timetable entries, or assessment history. Preserve it; retire the learning area if appropriate.');
            }
            $class->subjects()->detach($subject->id);
            $auditLogger->log('DETACH_SUBJECT_FROM_CLASS', 'SchoolClass', $class->id, $validated);

            return response()->json(['data' => ['message' => 'Learning area removed from class offerings.']]);
        });
    }

    public function destroySubject(Subject $subject, AuditLogger $auditLogger)
    {
        return $this->integrity->transaction(function () use ($subject, $auditLogger) {
            $subject = $this->integrity->lockSubject($subject->id);
            if ($subject->classes()->exists()
                || ClassSubjectTeacher::where('subject_id', $subject->id)->exists()
                || TimetableEntry::where('subject_id', $subject->id)->exists()
                || Assessment::where('subject_id', $subject->id)->exists()) {
                return $this->integrity->conflict('SUBJECT_IN_USE', 'This learning area has offerings or teaching/assessment dependencies. Set it inactive to retire it without removing history.');
            }
            $subject->delete();
            $auditLogger->log('DELETE_SUBJECT', 'Subject', $subject->id);

            return response()->json(['data' => ['message' => 'Learning area deleted.']]);
        });
    }

    private function classRules(?SchoolClass $class = null): array
    {
        return [
            'name' => [$class ? 'sometimes' : 'required', 'required', 'string', 'max:30', Rule::unique('classes', 'name')->ignore($class?->id)],
            'level' => [$class ? 'sometimes' : 'required', 'required', Rule::in(['primary', 'junior'])],
            'sequence' => [$class ? 'sometimes' : 'required', 'required', 'integer', 'min:1', 'max:255'],
            'capacity' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:500'],
            'class_teacher_id' => ['sometimes', 'nullable', 'integer', Rule::exists('staff', 'id')->where('status', 'active')->where('staff_type', 'teaching')],
        ];
    }

    private function subjectRules(?Subject $subject = null): array
    {
        return [
            'name' => [$subject ? 'sometimes' : 'required', 'required', 'string', 'max:60', Rule::unique('subjects', 'name')->ignore($subject?->id)],
            'code' => ['sometimes', 'nullable', 'string', 'max:20', Rule::unique('subjects', 'code')->ignore($subject?->id)],
            'learning_area' => ['sometimes', 'nullable', 'string', 'max:80'],
            'status' => ['sometimes', 'required', Rule::in(['active', 'inactive'])],
        ];
    }

    private function offeringRules(): array
    {
        return ['class_id' => ['required', 'integer', 'exists:classes,id'], 'subject_id' => ['required', 'integer', 'exists:subjects,id']];
    }

    private function classData(Request $request, SchoolClass $class): array
    {
        return (new AcademicClassResource($class->loadCount(['students', 'subjects'])->load('classTeacher:id,first_name,last_name')))->resolve($request);
    }
}
