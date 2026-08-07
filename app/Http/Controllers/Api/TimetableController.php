<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TimetableEntry;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Implements SRS FR-ACAD-06/07 — "foundation" scope: entries plus a real
 * teacher double-booking conflict check on save. A visual drag-and-drop
 * grid builder is a larger follow-up feature, not in this scope.
 */
class TimetableController extends Controller
{
    public function indexByClass(Request $request)
    {
        $validated = $request->validate(['class_id' => ['required', 'exists:classes,id']]);

        $entries = TimetableEntry::with(['subject:id,name', 'staff:id,first_name,last_name', 'stream:id,name'])
            ->where('class_id', $validated['class_id'])
            ->orderBy('day_of_week')->orderBy('start_time')
            ->get();

        return response()->json(['data' => $entries]);
    }

    public function indexByTeacher(Request $request)
    {
        $validated = $request->validate(['staff_id' => ['required', 'exists:staff,id']]);

        $entries = TimetableEntry::with(['subject:id,name', 'schoolClass:id,name', 'stream:id,name'])
            ->where('staff_id', $validated['staff_id'])
            ->orderBy('day_of_week')->orderBy('start_time')
            ->get();

        return response()->json(['data' => $entries]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'class_id' => ['required', 'exists:classes,id'],
            'stream_id' => ['nullable', 'exists:streams,id'],
            'subject_id' => ['required', 'exists:subjects,id'],
            'staff_id' => ['required', 'exists:staff,id'],
            'day_of_week' => ['required', 'integer', 'min:1', 'max:7'],
            'start_time' => ['required', 'date_format:H:i'],
            'end_time' => ['required', 'date_format:H:i', 'after:start_time'],
        ]);

        // Conflict check: is this teacher already booked at an overlapping
        // time on the same day, per FR-ACAD-07.
        $conflict = TimetableEntry::where('staff_id', $validated['staff_id'])
            ->where('day_of_week', $validated['day_of_week'])
            ->where('start_time', '<', $validated['end_time'])
            ->where('end_time', '>', $validated['start_time'])
            ->exists();

        if ($conflict) {
            return response()->json([
                'error' => ['code' => 'TEACHER_CONFLICT', 'message' => 'This teacher is already scheduled for an overlapping time slot.'],
            ], 409);
        }

        $entry = TimetableEntry::create($validated);
        $auditLogger->log('CREATE_TIMETABLE_ENTRY', 'TimetableEntry', $entry->id, $validated);

        return response()->json(['data' => $entry->load('schoolClass', 'stream', 'subject', 'staff')], 201);
    }

    public function destroy(TimetableEntry $timetableEntry, AuditLogger $auditLogger)
    {
        $timetableEntry->delete();
        $auditLogger->log('DELETE_TIMETABLE_ENTRY', 'TimetableEntry', $timetableEntry->id);

        return response()->json(['data' => ['message' => 'Timetable entry removed.']]);
    }
}
