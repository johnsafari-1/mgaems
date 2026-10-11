<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TimetableEntry;
use App\Services\TeacherWorkspaceAccess;
use Illuminate\Http\Request;

class TeacherWorkspaceController extends Controller
{
    public function __construct(private TeacherWorkspaceAccess $access)
    {
    }

    public function context(Request $request)
    {
        $staff = $this->access->staff($request->user());
        $assignments = $this->access->assignments($staff)->with([
            'schoolClass:id,name', 'subject:id,name,code', 'term:id,name,academic_year_id', 'term.academicYear:id,name',
        ])->orderBy('class_id')->orderBy('subject_id')->orderBy('term_id')->get();

        return response()->json(['data' => [
            'school_date' => now()->toDateString(),
            'current_periods' => $this->access->periods()->with('academicYear:id,name')->orderBy('id')
                ->get(['id', 'name', 'academic_year_id'])->map(fn ($term) => $this->period($term)),
            'class_teacher_classes' => $this->access->classTeacherClasses($staff)->orderBy('sequence')->orderBy('name')
                ->get(['id', 'name', 'level']),
            'subject_assignments' => $assignments->map(fn ($assignment) => [
                'class_id' => $assignment->class_id, 'subject_id' => $assignment->subject_id, 'term_id' => $assignment->term_id,
                'school_class' => $assignment->schoolClass->only(['id', 'name']),
                'subject' => $assignment->subject->only(['id', 'name', 'code']), 'term' => $this->period($assignment->term),
            ]),
            'learner_classes' => $this->access->classes($staff)->orderBy('sequence')->orderBy('name')->get(['id', 'name']),
        ]]);
    }

    public function timetable(Request $request)
    {
        $staff = $this->access->staff($request->user());
        // Timetable rows are recurring, with no term FK. Require a matching
        // eligible current assignment; never infer subject rights from class ownership.
        $rows = TimetableEntry::where('staff_id', $staff->id)->whereExists(
            $this->access->assignments($staff)->selectRaw('1')
                ->whereColumn('class_subject_teacher.class_id', 'timetable_entries.class_id')
                ->whereColumn('class_subject_teacher.subject_id', 'timetable_entries.subject_id')->toBase()
        )->with(['schoolClass:id,name', 'subject:id,name,code'])->orderBy('day_of_week')->orderBy('start_time')->orderBy('id')->get();
        $periods = $this->access->assignments($staff)->with(['term:id,name,academic_year_id', 'term.academicYear:id,name'])
            ->get()->groupBy(fn ($assignment) => $assignment->class_id.':'.$assignment->subject_id);

        return response()->json(['data' => $rows->filter(fn ($row) => $periods->has($row->class_id.':'.$row->subject_id))->values()->map(fn ($row) => [
            'id' => $row->id, 'day_of_week' => $row->day_of_week, 'start_time' => $row->start_time, 'end_time' => $row->end_time,
            'school_class' => $row->schoolClass->only(['id', 'name']), 'subject' => $row->subject->only(['id', 'name', 'code']),
            'current_periods' => $periods->get($row->class_id.':'.$row->subject_id)->map(fn ($assignment) => $this->period($assignment->term)),
        ]), 'meta' => ['schedule_type' => 'recurring_weekly', 'school_date' => now()->toDateString()]]);
    }

    private function period($term): array
    {
        return $term->only(['id', 'name', 'academic_year_id']) + ['academic_year' => $term->academicYear->only(['id', 'name'])];
    }
}
