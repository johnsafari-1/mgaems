<?php

namespace App\Services;

use App\Models\ClassSubjectTeacher;
use App\Models\Role;
use App\Models\SchoolClass;
use App\Models\Staff;
use App\Models\Student;
use App\Models\Term;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Exceptions\HttpResponseException;

/** Read scope only. Attendance and Assessment retain their own domain policies. */
class TeacherWorkspaceAccess
{
    public function staff(?User $user): Staff
    {
        $current = $user?->fresh('role');
        $staff = $current && $current->status === 'active' && $current->hasRole(Role::TEACHER)
            ? $current->staff()->where('status', 'active')->where('staff_type', 'teaching')->first() : null;
        if (! $staff) {
            throw new HttpResponseException(response()->json([
                'error' => ['code' => 'FORBIDDEN', 'message' => 'You do not have permission to access this resource.'],
            ], 403));
        }

        return $staff;
    }

    public function periods(): Builder
    {
        $today = now()->toDateString();

        return Term::where('is_current', true)->where('start_date', '<=', $today)->where('end_date', '>=', $today)
            ->whereHas('academicYear', fn ($year) => $year->where('is_current', true)
                ->where('start_date', '<=', $today)->where('end_date', '>=', $today)
                ->whereColumn('terms.start_date', '>=', 'academic_years.start_date')
                ->whereColumn('terms.end_date', '<=', 'academic_years.end_date'));
    }

    public function assignments(Staff $staff): Builder
    {
        return ClassSubjectTeacher::where('staff_id', $staff->id)
            ->whereIn('term_id', $this->periods()->select('terms.id'))
            ->whereHas('schoolClass')->whereHas('subject', fn ($subject) => $subject->where('status', 'active'))
            ->whereExists(fn ($offering) => $offering->selectRaw('1')->from('class_subjects')
                ->whereColumn('class_subjects.class_id', 'class_subject_teacher.class_id')
                ->whereColumn('class_subjects.subject_id', 'class_subject_teacher.subject_id'));
    }

    public function classTeacherClasses(Staff $staff): Builder
    {
        // This current ownership is not term-dated in the existing schema.
        return SchoolClass::where('class_teacher_id', $staff->id);
    }

    public function classes(Staff $staff): Builder
    {
        return SchoolClass::where(fn ($classes) => $classes->where('class_teacher_id', $staff->id)
            ->orWhereIn('id', $this->assignments($staff)->select('class_id')));
    }

    public function learners(Staff $staff): Builder
    {
        return Student::where('status', 'active')->whereIn('class_id', $this->classes($staff)->select('classes.id'));
    }
}
