<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TimetableEntry;
use App\Services\AcademicIntegrity;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class TimetableController extends Controller
{
    private const RELATIONS = ['schoolClass:id,name', 'subject:id,name', 'staff:id,first_name,last_name'];

    public function __construct(private AcademicIntegrity $integrity)
    {
    }

    public function indexByClass(Request $request)
    {
        $validated = $request->validate(['class_id' => ['required', 'integer', 'exists:classes,id']]);
        return response()->json(['data' => TimetableEntry::with(self::RELATIONS)->where('class_id', $validated['class_id'])
            ->orderBy('day_of_week')->orderBy('start_time')->orderBy('id')->get()]);
    }

    public function indexByTeacher(Request $request)
    {
        $validated = $request->validate(['staff_id' => ['required', 'integer', 'exists:staff,id']]);
        return response()->json(['data' => TimetableEntry::with(self::RELATIONS)->where('staff_id', $validated['staff_id'])
            ->orderBy('day_of_week')->orderBy('start_time')->orderBy('id')->get()]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'class_id' => ['required', 'integer', 'exists:classes,id'],
            'subject_id' => ['required', 'integer', Rule::exists('subjects', 'id')->where('status', 'active')],
            'staff_id' => ['required', 'integer', Rule::exists('staff', 'id')->where('status', 'active')->where('staff_type', 'teaching')],
            'day_of_week' => ['required', 'integer', 'min:1', 'max:7'],
            'start_time' => ['required', 'date_format:H:i'],
            'end_time' => ['required', 'date_format:H:i', 'after:start_time'],
        ], [
            'staff_id.exists' => 'Choose an active member of teaching staff.',
            'subject_id.exists' => 'Choose an active learning area/subject.',
        ]);
        return $this->integrity->transaction(function () use ($validated, $auditLogger) {
            // Parent row locks serialize same-class and same-teacher bookings.
            $this->integrity->lockClass((int) $validated['class_id']);
            $this->integrity->lockSubject((int) $validated['subject_id'], true);
            $this->integrity->lockTeacher((int) $validated['staff_id']);
            $this->integrity->requireOffering((int) $validated['class_id'], (int) $validated['subject_id']);
            $slots = TimetableEntry::where('day_of_week', $validated['day_of_week'])
                ->where('start_time', '<', $validated['end_time'])->where('end_time', '>', $validated['start_time']);
            if ((clone $slots)->where('staff_id', $validated['staff_id'])->exists()) {
                return $this->integrity->conflict('TEACHER_CONFLICT', 'This teacher is already scheduled for an overlapping time slot.');
            }
            if ((clone $slots)->where('class_id', $validated['class_id'])->exists()) {
                return $this->integrity->conflict('CLASS_CONFLICT', 'This class already has a lesson in an overlapping time slot.');
            }
            $entry = TimetableEntry::create($validated);
            $auditLogger->log('CREATE_TIMETABLE_ENTRY', 'TimetableEntry', $entry->id, $validated);

            return response()->json(['data' => $entry->load(self::RELATIONS)], 201);
        });
    }

    public function destroy(TimetableEntry $timetableEntry, AuditLogger $auditLogger)
    {
        return $this->integrity->transaction(function () use ($timetableEntry, $auditLogger) {
            $this->integrity->lockClass((int) $timetableEntry->class_id);
            $this->integrity->lockSubject((int) $timetableEntry->subject_id);
            $entry = TimetableEntry::whereKey($timetableEntry->id)->lockForUpdate()->firstOrFail();
            $entry->delete();
            $auditLogger->log('DELETE_TIMETABLE_ENTRY', 'TimetableEntry', $entry->id);

            return response()->json(['data' => ['message' => 'Timetable entry removed.']]);
        });
    }
}
