<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClassSubjectTeacher;
use App\Services\AuditLogger;
use Illuminate\Http\Request;

/**
 * Implements SRS FR-ACAD-04 and UC-ACAD-03: allocates teachers to
 * subjects/classes/streams for a term.
 */
class TeacherAssignmentController extends Controller
{
    public function index(Request $request)
    {
        $assignments = ClassSubjectTeacher::with(['schoolClass:id,name', 'stream:id,name', 'subject:id,name', 'staff:id,first_name,last_name', 'term:id,name'])
            ->when($request->query('term_id'), fn ($q, $id) => $q->where('term_id', $id))
            ->when($request->query('staff_id'), fn ($q, $id) => $q->where('staff_id', $id))
            ->when($request->query('class_id'), fn ($q, $id) => $q->where('class_id', $id))
            ->get();

        return response()->json(['data' => $assignments]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'class_id' => ['required', 'exists:classes,id'],
            'stream_id' => ['nullable', 'exists:streams,id'],
            'subject_id' => ['required', 'exists:subjects,id'],
            'staff_id' => ['required', 'exists:staff,id'],
            'term_id' => ['required', 'exists:terms,id'],
        ]);

        $duplicate = ClassSubjectTeacher::where('class_id', $validated['class_id'])
            ->where('stream_id', $validated['stream_id'] ?? null)
            ->where('subject_id', $validated['subject_id'])
            ->where('term_id', $validated['term_id'])
            ->exists();

        if ($duplicate) {
            return response()->json([
                'error' => ['code' => 'DUPLICATE_ASSIGNMENT', 'message' => 'This class/subject/term combination is already assigned to a teacher.'],
            ], 409);
        }

        $assignment = ClassSubjectTeacher::create($validated);
        $auditLogger->log('CREATE_TEACHER_ASSIGNMENT', 'ClassSubjectTeacher', $assignment->id, $validated);

        return response()->json(['data' => $assignment->load('schoolClass', 'stream', 'subject', 'staff', 'term')], 201);
    }

    public function destroy(ClassSubjectTeacher $classSubjectTeacher, AuditLogger $auditLogger)
    {
        $classSubjectTeacher->delete();
        $auditLogger->log('DELETE_TEACHER_ASSIGNMENT', 'ClassSubjectTeacher', $classSubjectTeacher->id);

        return response()->json(['data' => ['message' => 'Assignment removed.']]);
    }
}
