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
        return response()->json(['data' => SchoolClass::orderBy('sequence')->get()]);
    }

    public function storeClass(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:30', 'unique:classes,name'],
            'level' => ['required', Rule::in(['primary', 'junior'])],
            'sequence' => ['required', 'integer', 'min:1', 'max:255'],
        ]);

        $class = SchoolClass::create($validated);
        $auditLogger->log('CREATE_CLASS', 'SchoolClass', $class->id, $validated);

        return response()->json(['data' => $class], 201);
    }

    public function updateClass(Request $request, SchoolClass $class, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:30', Rule::unique('classes', 'name')->ignore($class->id)],
            'level' => ['sometimes', Rule::in(['primary', 'junior'])],
            'sequence' => ['sometimes', 'integer', 'min:1', 'max:255'],
        ]);

        $class->update($validated);
        $auditLogger->log('UPDATE_CLASS', 'SchoolClass', $class->id, $validated);

        return response()->json(['data' => $class->fresh()]);
    }

    public function destroyClass(SchoolClass $class, AuditLogger $auditLogger)
    {
        if ($class->streams()->exists()) {
            return response()->json([
                'error' => ['code' => 'CLASS_HAS_STREAMS', 'message' => 'Reassign or remove streams before deleting this class.'],
            ], 409);
        }

        $class->delete();
        $auditLogger->log('DELETE_CLASS', 'SchoolClass', $class->id);

        return response()->json(['data' => ['message' => 'Class deleted.']]);
    }

    // -------- Streams --------

    public function indexStreams(Request $request)
    {
        $streams = Stream::when($request->query('class_id'), fn ($q, $id) => $q->where('class_id', $id))->get();

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

        return response()->json(['data' => $stream], 201);
    }

    public function destroyStream(Stream $stream, AuditLogger $auditLogger)
    {
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
        ]);

        $subject = Subject::create($validated);
        $auditLogger->log('CREATE_SUBJECT', 'Subject', $subject->id, $validated);

        return response()->json(['data' => $subject], 201);
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

    public function destroySubject(Subject $subject, AuditLogger $auditLogger)
    {
        $subject->classes()->detach();
        $subject->delete();
        $auditLogger->log('DELETE_SUBJECT', 'Subject', $subject->id);

        return response()->json(['data' => ['message' => 'Subject deleted.']]);
    }
}
