<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SchoolClass;
use App\Models\Stream;
use App\Models\Subject;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Implements SRS FR-ACAD-02/03 and API Design §5 (Academic Management) for
 * classes, streams, and subjects. Read access is broad (per the User Role
 * Matrix — Teacher/Parent/Student can view); write access is gated to
 * system_admin/head_teacher/deputy_head_teacher via routes/api.php.
 */
class AcademicStructureController extends Controller
{
    // -------- Classes --------

    public function indexClasses()
    {
        return response()->json([
            'data' => SchoolClass::withCount('students')
                ->with('classTeacher:id,first_name,last_name')
                ->orderBy('sequence')
                ->get(),
        ]);
    }

    public function storeClass(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:30', 'unique:classes,name'],
            'level' => ['required', Rule::in(['primary', 'junior'])],
            'sequence' => ['required', 'integer', 'min:1', 'max:255'],
            'capacity' => ['nullable', 'integer', 'min:1', 'max:500'],
            'class_teacher_id' => ['nullable', 'exists:staff,id'],
        ]);

        $class = SchoolClass::create($validated);
        $auditLogger->log('CREATE_CLASS', 'SchoolClass', $class->id, $validated);

        return response()->json(['data' => $class->load('classTeacher')], 201);
    }

    public function updateClass(Request $request, SchoolClass $class, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:30', Rule::unique('classes', 'name')->ignore($class->id)],
            'level' => ['sometimes', Rule::in(['primary', 'junior'])],
            'sequence' => ['sometimes', 'integer', 'min:1', 'max:255'],
            'capacity' => ['nullable', 'integer', 'min:1', 'max:500'],
            'class_teacher_id' => ['nullable', 'exists:staff,id'],
        ]);

        $class->update($validated);
        $auditLogger->log('UPDATE_CLASS', 'SchoolClass', $class->id, $validated);

        return response()->json(['data' => $class->fresh()->load('classTeacher')]);
    }

    public function destroyClass(SchoolClass $class, AuditLogger $auditLogger)
    {
        if ($class->streams()->exists()) {
            return response()->json([
                'error' => ['code' => 'CLASS_HAS_STREAMS', 'message' => 'Reassign or remove streams before deleting this class.'],
            ], 409);
        }
        if ($class->students()->exists()) {
            return response()->json([
                'error' => ['code' => 'CLASS_HAS_STUDENTS', 'message' => 'This class has enrolled learners and cannot be deleted.'],
            ], 409);
        }

        $class->delete();
        $auditLogger->log('DELETE_CLASS', 'SchoolClass', $class->id);

        return response()->json(['data' => ['message' => 'Class deleted.']]);
    }

    // -------- Streams --------

    public function indexStreams(Request $request)
    {
        $streams = Stream::withCount('students')
            ->with('schoolClass:id,name')
            ->when($request->query('class_id'), fn ($q, $id) => $q->where('class_id', $id))
            ->get();

        return response()->json(['data' => $streams]);
    }

    public function storeStream(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'class_id' => ['required', 'exists:classes,id'],
            'name' => ['required', 'string', 'max:30'],
        ]);

        $exists = Stream::where('class_id', $validated['class_id'])->where('name', $validated['name'])->exists();
        if ($exists) {
            return response()->json([
                'error' => ['code' => 'DUPLICATE_STREAM', 'message' => 'This stream already exists for the selected class.'],
            ], 409);
        }

        $stream = Stream::create($validated);
        $auditLogger->log('CREATE_STREAM', 'Stream', $stream->id, $validated);

        return response()->json(['data' => $stream->load('schoolClass')], 201);
    }

    public function updateStream(Request $request, Stream $stream, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:30'],
        ]);

        $stream->update($validated);
        $auditLogger->log('UPDATE_STREAM', 'Stream', $stream->id, $validated);

        return response()->json(['data' => $stream->fresh()->load('schoolClass')]);
    }

    public function destroyStream(Stream $stream, AuditLogger $auditLogger)
    {
        if ($stream->students()->exists()) {
            return response()->json([
                'error' => ['code' => 'STREAM_HAS_STUDENTS', 'message' => 'This stream has enrolled learners and cannot be deleted.'],
            ], 409);
        }

        $stream->delete();
        $auditLogger->log('DELETE_STREAM', 'Stream', $stream->id);

        return response()->json(['data' => ['message' => 'Stream deleted.']]);
    }

    // -------- Subjects --------

    public function indexSubjects()
    {
        return response()->json(['data' => Subject::orderBy('name')->get()]);
    }

    public function storeSubject(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:60', 'unique:subjects,name'],
            'code' => ['nullable', 'string', 'max:20', 'unique:subjects,code'],
            'learning_area' => ['nullable', 'string', 'max:80'],
            'status' => ['nullable', Rule::in(['active', 'inactive'])],
        ]);

        $subject = Subject::create($validated);
        $auditLogger->log('CREATE_SUBJECT', 'Subject', $subject->id, $validated);

        return response()->json(['data' => $subject], 201);
    }

    public function updateSubject(Request $request, Subject $subject, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:60', Rule::unique('subjects', 'name')->ignore($subject->id)],
            'code' => ['nullable', 'string', 'max:20', Rule::unique('subjects', 'code')->ignore($subject->id)],
            'learning_area' => ['nullable', 'string', 'max:80'],
            'status' => ['sometimes', Rule::in(['active', 'inactive'])],
        ]);

        $subject->update($validated);
        $auditLogger->log('UPDATE_SUBJECT', 'Subject', $subject->id, $validated);

        return response()->json(['data' => $subject->fresh()]);
    }

    public function attachSubjectToClass(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'class_id' => ['required', 'exists:classes,id'],
            'subject_id' => ['required', 'exists:subjects,id'],
        ]);

        $class = SchoolClass::findOrFail($validated['class_id']);

        if ($class->subjects()->where('subjects.id', $validated['subject_id'])->exists()) {
            return response()->json([
                'error' => ['code' => 'ALREADY_ATTACHED', 'message' => 'This subject is already assigned to this class.'],
            ], 409);
        }

        $class->subjects()->attach($validated['subject_id']);
        $auditLogger->log('ATTACH_SUBJECT_TO_CLASS', 'SchoolClass', $class->id, $validated);

        return response()->json(['data' => ['message' => 'Subject attached to class.']], 201);
    }

    public function detachSubjectFromClass(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'class_id' => ['required', 'exists:classes,id'],
            'subject_id' => ['required', 'exists:subjects,id'],
        ]);

        $class = SchoolClass::findOrFail($validated['class_id']);
        $class->subjects()->detach($validated['subject_id']);
        $auditLogger->log('DETACH_SUBJECT_FROM_CLASS', 'SchoolClass', $class->id, $validated);

        return response()->json(['data' => ['message' => 'Subject removed from class.']]);
    }

    public function destroySubject(Subject $subject, AuditLogger $auditLogger)
    {
        $subject->classes()->detach();
        $subject->delete();
        $auditLogger->log('DELETE_SUBJECT', 'Subject', $subject->id);

        return response()->json(['data' => ['message' => 'Subject deleted.']]);
    }
}
