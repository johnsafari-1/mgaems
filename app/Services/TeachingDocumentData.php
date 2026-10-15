<?php

namespace App\Services;

use App\Models\ClassSubjectTeacher;
use App\Models\Homework;
use App\Models\HomeworkQuestion;
use App\Models\LessonPlan;
use App\Models\RecordOfWork;

/**
 * One response shape for teaching documents so schemes, lesson plans and
 * records of work describe the same allocation context. Responses expose
 * educational context only: no contacts, HR metadata, or authentication data.
 */
class TeachingDocumentData
{
    public const ASSIGNMENT_RELATIONS = [
        'schoolClass:id,name,level', 'subject:id,name,code,learning_area,status', 'staff:id,first_name,last_name',
        'term:id,academic_year_id,name,start_date,end_date,is_current', 'term.academicYear:id,name',
    ];

    public const SCHEME_RELATIONS = [
        'assignment.schoolClass:id,name,level', 'assignment.subject:id,name,code,learning_area,status',
        'assignment.staff:id,first_name,last_name', 'assignment.term:id,academic_year_id,name,start_date,end_date,is_current',
        'assignment.term.academicYear:id,name',
    ];

    public const LESSON_PLAN_RELATIONS = [
        'assignment.schoolClass:id,name,level', 'assignment.subject:id,name,code,learning_area,status',
        'assignment.staff:id,first_name,last_name', 'assignment.term:id,academic_year_id,name,start_date,end_date,is_current',
        'assignment.term.academicYear:id,name', 'schemeWeek:id,scheme_of_work_id,week_number,strand,sub_strand',
        'sourcePlan:id', 'recordOfWork:id,lesson_plan_id,taught_on,status',
    ];

    public const RECORD_RELATIONS = [
        'assignment.schoolClass:id,name,level', 'assignment.subject:id,name,code,learning_area,status',
        'assignment.staff:id,first_name,last_name', 'assignment.term:id,academic_year_id,name,start_date,end_date,is_current',
        'assignment.term.academicYear:id,name', 'lessonPlan:id,class_subject_teacher_id,title,lesson_date',
    ];

    public const HOMEWORK_RELATIONS = [
        'assignment.schoolClass:id,name,level', 'assignment.subject:id,name,code,learning_area,status',
        'assignment.staff:id,first_name,last_name', 'assignment.term:id,academic_year_id,name,start_date,end_date,is_current',
        'assignment.term.academicYear:id,name', 'lessonPlan:id,class_subject_teacher_id,title,lesson_date',
        'schemeWeek:id,scheme_of_work_id,week_number,strand,sub_strand', 'questions', 'completions',
    ];

    public function assignment(ClassSubjectTeacher $assignment): array
    {
        return [
            'id' => $assignment->id,
            'class_id' => $assignment->class_id,
            'subject_id' => $assignment->subject_id,
            'term_id' => $assignment->term_id,
            'school_class' => $assignment->schoolClass?->only(['id', 'name', 'level']),
            'subject' => $assignment->subject?->only(['id', 'name', 'code', 'learning_area', 'status']),
            'staff' => $assignment->staff?->only(['id', 'first_name', 'last_name']),
            'term' => $assignment->term,
        ];
    }

    /** A lesson plan only reports delivery when an explicit record of work exists. */
    public function lessonPlan(LessonPlan $plan): array
    {
        return [
            'id' => $plan->id,
            'class_subject_teacher_id' => $plan->class_subject_teacher_id,
            'scheme_of_work_week_id' => $plan->scheme_of_work_week_id,
            'duplicated_from_lesson_plan_id' => $plan->duplicated_from_lesson_plan_id,
            'title' => $plan->title,
            'lesson_date' => $plan->lesson_date?->toDateString(),
            'duration_minutes' => $plan->duration_minutes,
            'strand' => $plan->strand,
            'sub_strand' => $plan->sub_strand,
            'specific_learning_outcomes' => $plan->specific_learning_outcomes,
            'key_inquiry_questions' => $plan->key_inquiry_questions,
            'teaching_learning_resources' => $plan->teaching_learning_resources,
            'introduction' => $plan->introduction,
            'lesson_development' => $plan->lesson_development,
            'conclusion' => $plan->conclusion,
            'learning_activities' => $plan->learning_activities,
            'assessment_approach' => $plan->assessment_approach,
            'teacher_reflection' => $plan->teacher_reflection,
            'status' => $plan->status,
            'review_notes' => $plan->review_notes,
            'submitted_at' => $plan->submitted_at?->toISOString(),
            'reviewed_at' => $plan->reviewed_at?->toISOString(),
            'created_at' => $plan->created_at?->toISOString(),
            'updated_at' => $plan->updated_at?->toISOString(),
            'assignment' => $plan->assignment ? $this->assignment($plan->assignment) : null,
            'scheme_week' => $plan->schemeWeek?->only(['id', 'scheme_of_work_id', 'week_number', 'strand', 'sub_strand']),
            'has_record_of_work' => $plan->recordOfWork !== null,
            'record_of_work' => $plan->recordOfWork ? $plan->recordOfWork->only(['id', 'taught_on', 'status']) : null,
        ];
    }

    public function recordOfWork(RecordOfWork $record): array
    {
        return [
            'id' => $record->id,
            'class_subject_teacher_id' => $record->class_subject_teacher_id,
            'lesson_plan_id' => $record->lesson_plan_id,
            'taught_on' => $record->taught_on?->toDateString(),
            'content_covered' => $record->content_covered,
            'learning_activities_conducted' => $record->learning_activities_conducted,
            'work_completed' => $record->work_completed,
            'work_not_completed' => $record->work_not_completed,
            'reasons_for_deviations' => $record->reasons_for_deviations,
            'teacher_observations' => $record->teacher_observations,
            'follow_up_actions' => $record->follow_up_actions,
            'status' => $record->status,
            'review_notes' => $record->review_notes,
            'submitted_at' => $record->submitted_at?->toISOString(),
            'reviewed_at' => $record->reviewed_at?->toISOString(),
            'created_at' => $record->created_at?->toISOString(),
            'updated_at' => $record->updated_at?->toISOString(),
            'assignment' => $record->assignment ? $this->assignment($record->assignment) : null,
            'lesson_plan' => $record->lessonPlan ? $record->lessonPlan->only(['id', 'title', 'lesson_date']) : null,
        ];
    }

    /** Staff-facing homework, including answer keys and marking guidance. */
    public function homeworkWorkspace(Homework $homework): array
    {
        return $this->homework($homework, true);
    }

    /** Directory row: counts and context only, no question or answer payload. */
    public function homeworkSummary(Homework $homework, int $eligibleLearners = 0): array
    {
        $questions = $homework->questions;
        $recorded = $homework->completions->groupBy('status');

        return [
            'id' => $homework->id,
            'class_subject_teacher_id' => $homework->class_subject_teacher_id,
            'lesson_plan_id' => $homework->lesson_plan_id,
            'scheme_of_work_week_id' => $homework->scheme_of_work_week_id,
            'title' => $homework->title,
            'status' => $homework->status,
            'assigned_on' => $homework->assigned_on?->toDateString(),
            'due_on' => $homework->due_on?->toDateString(),
            'submission_method' => $homework->submission_method,
            'total_marks' => $homework->total_marks,
            'updated_at' => $homework->updated_at?->toISOString(),
            'assignment' => $homework->assignment ? $this->assignment($homework->assignment) : null,
            'lesson_plan' => $homework->lessonPlan ? $homework->lessonPlan->only(['id', 'title', 'lesson_date']) : null,
            'scheme_week' => $homework->schemeWeek ? $homework->schemeWeek->only(['id', 'week_number', 'strand', 'sub_strand']) : null,
            'question_count' => $questions->count(),
            'recorded_marks' => (int) $questions->sum(fn ($question) => (int) $question->marks),
            'eligible_learner_count' => $eligibleLearners,
            'completion_counts' => [
                'submitted' => $recorded->get('submitted', collect())->count(),
                'completed' => $recorded->get('completed', collect())->count(),
                'missing' => $recorded->get('missing', collect())->count(),
                'recorded' => (int) $homework->completions->count(),
            ],
        ];
    }

    /**
     * Family-facing homework. Answer keys, marking guidance and internal teacher
     * notes are never included: a guardian view must not expose assessment
     * answers or staff working notes.
     */
    public function homeworkFamily(Homework $homework): array
    {
        $family = $this->homework($homework, false);
        unset($family['teacher_notes']);

        return $family;
    }

    private function homework(Homework $homework, bool $withAnswers): array
    {
        $questions = $homework->questions->map(fn ($question) => $withAnswers ? $this->question($question) : $this->familyQuestion($question))->values();

        return [
            'id' => $homework->id,
            'class_subject_teacher_id' => $homework->class_subject_teacher_id,
            'lesson_plan_id' => $homework->lesson_plan_id,
            'scheme_of_work_week_id' => $homework->scheme_of_work_week_id,
            'title' => $homework->title,
            'instructions' => $homework->instructions,
            'learning_outcomes' => $homework->learning_outcomes,
            'total_marks' => $homework->total_marks,
            'assigned_on' => $homework->assigned_on?->toDateString(),
            'due_on' => $homework->due_on?->toDateString(),
            'submission_method' => $homework->submission_method,
            'teacher_notes' => $withAnswers ? $homework->teacher_notes : null,
            'status' => $homework->status,
            'published_at' => $homework->published_at?->toISOString(),
            'closed_at' => $homework->closed_at?->toISOString(),
            'archived_at' => $homework->archived_at?->toISOString(),
            'created_at' => $homework->created_at?->toISOString(),
            'updated_at' => $homework->updated_at?->toISOString(),
            'assignment' => $homework->assignment ? $this->assignment($homework->assignment) : null,
            'lesson_plan' => $homework->lessonPlan ? $homework->lessonPlan->only(['id', 'title', 'lesson_date']) : null,
            'scheme_week' => $homework->schemeWeek ? $homework->schemeWeek->only(['id', 'week_number', 'strand', 'sub_strand']) : null,
            'questions' => $questions,
            'question_count' => $questions->count(),
        ];
    }

    private function question(HomeworkQuestion $question): array
    {
        return [
            'id' => $question->id,
            'position' => $question->position,
            'question_type' => $question->question_type,
            'prompt' => $question->prompt,
            'marks' => $question->marks,
            'diagram_reference' => $question->diagram_reference,
            'options' => $question->optionList(),
            'answer_key' => $question->answer_key,
            'marking_guidance' => $question->marking_guidance,
        ];
    }

    private function familyQuestion(HomeworkQuestion $question): array
    {
        return [
            'id' => $question->id,
            'position' => $question->position,
            'question_type' => $question->question_type,
            'prompt' => $question->prompt,
            'marks' => $question->marks,
            'diagram_reference' => $question->diagram_reference,
            'options' => $question->optionList(),
        ];
    }
}
