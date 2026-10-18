<?php

namespace App\Services;

use App\Models\Assessment;
use App\Models\ClassSubjectTeacher;
use App\Models\SchoolClass;
use App\Models\Staff;
use App\Models\Subject;
use App\Models\Term;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AssessmentAccess
{
    public const LEADERS = ['system_admin', 'head_teacher', 'deputy_head_teacher'];

    public function user(?User $user, bool $lock = false): User
    {
        abort_unless($user, 401, 'Authentication required.');
        $query = User::with('role')->whereKey($user->id);
        if ($lock) $query->sharedLock();
        $current = $query->firstOrFail();
        abort_unless($current->status === 'active', 403, 'An active account is required.');
        abort_unless($this->leader($current) || $current->hasRole('teacher'), 403, 'Assessment access is restricted.');
        return $current;
    }

    public function leader(User $user): bool { return in_array($user->role?->name, self::LEADERS, true); }

    public function leadership(?User $user, bool $lock = false): User
    {
        $current = $this->user($user, $lock);
        abort_unless($this->leader($current), 403, 'Report cards and revision administration are leadership-managed.');
        return $current;
    }

    public function staff(User $user, bool $lock = false): Staff
    {
        $query = Staff::where('user_id', $user->id)->where('status', 'active')->where('staff_type', 'teaching');
        if ($lock) $query->sharedLock();
        $staff = $query->first();
        abort_unless($staff, 403, 'Your account must be linked to active teaching staff.');
        return $staff;
    }

    public function context(User $user, array $context, bool $lock = false): array
    {
        $classQuery = SchoolClass::whereKey($context['class_id']);
        $subjectQuery = Subject::whereKey($context['subject_id']);
        if ($lock) { $classQuery->sharedLock(); $subjectQuery->sharedLock(); }
        $class = $classQuery->firstOrFail(); $subject = $subjectQuery->firstOrFail();
        $user = $this->user($user, $lock);
        $staff = $this->leader($user) ? null : $this->staff($user, $lock);
        $termQuery = Term::with('academicYear:id,name')->whereKey($context['term_id']);
        if ($lock) $termQuery->sharedLock();
        $term = $termQuery->firstOrFail();
        $assignment = null;
        if ($staff) {
            $query = ClassSubjectTeacher::where('class_id', $class->id)->where('subject_id', $subject->id)->where('term_id', $term->id)->where('staff_id', $staff->id);
            if ($lock) $query->sharedLock();
            $assignment = $query->first();
            abort_unless($assignment, 403, 'You are not assigned to this class, subject and term.');
        }
        if ($subject->status !== 'active') throw ValidationException::withMessages(['subject_id' => 'New saves require an active learning area/subject.']);
        $offering = DB::table('class_subjects')->where('class_id', $class->id)->where('subject_id', $subject->id);
        if ($lock) $offering->sharedLock();
        $offering = $offering->first();
        if (! $offering) throw ValidationException::withMessages(['subject_id' => 'The selected class does not offer this learning area/subject.']);
        return compact('user', 'class', 'subject', 'term', 'assignment', 'offering');
    }

    public function readable(User $user)
    {
        $user = $this->user($user);
        $query = Assessment::query();
        if ($this->leader($user)) return $query;
        $staff = $this->staff($user);
        // Legacy/null class context is leadership-only. Historical reads never
        // derive an assessment's class from today's learner placement.
        return $query->whereNotNull('assessments.class_id')->whereNotNull('assessments.context_snapshot')->whereExists(function ($assignment) use ($staff) {
            $assignment->selectRaw('1')->from('class_subject_teacher')
                ->whereColumn('class_subject_teacher.class_id', 'assessments.class_id')
                ->whereColumn('class_subject_teacher.subject_id', 'assessments.subject_id')
                ->whereColumn('class_subject_teacher.term_id', 'assessments.term_id')
                ->where('class_subject_teacher.staff_id', $staff->id);
        });
    }
}
