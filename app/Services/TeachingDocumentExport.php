<?php

namespace App\Services;

use App\Models\LessonPlan;
use App\Models\RecordOfWork;

/**
 * Builds printable document input for lesson plans and records of work.
 * Content is staff-entered planning text; the export never adds curriculum
 * claims, official alignment statements, or learner data.
 */
class TeachingDocumentExport
{
    public function lessonPlan(LessonPlan $plan): array
    {
        $assignment = $plan->assignment;

        return [
            'document_type' => 'Lesson Plan',
            'school' => $this->school(),
            'class_name' => $assignment?->schoolClass?->name,
            'learning_area' => $assignment?->subject?->name,
            'term' => $assignment?->term?->name,
            'academic_year' => $assignment?->term?->academicYear?->name,
            'teacher' => $assignment?->staff ? trim($assignment->staff->first_name.' '.$assignment->staff->last_name) : null,
            'title' => $plan->title,
            'status' => $plan->status,
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
            'review_notes' => $plan->review_notes,
            'scheme_week' => $plan->schemeWeek ? 'Week '.$plan->schemeWeek->week_number.' · '.$plan->schemeWeek->strand : null,
            'record_of_work' => $plan->recordOfWork ? $plan->recordOfWork->taught_on?->toDateString() : null,
            'generated_at' => now()->toISOString(),
        ];
    }

    public function recordOfWork(RecordOfWork $record): array
    {
        $assignment = $record->assignment;

        return [
            'document_type' => 'Record of Work',
            'school' => $this->school(),
            'class_name' => $assignment?->schoolClass?->name,
            'learning_area' => $assignment?->subject?->name,
            'term' => $assignment?->term?->name,
            'academic_year' => $assignment?->term?->academicYear?->name,
            'teacher' => $assignment?->staff ? trim($assignment->staff->first_name.' '.$assignment->staff->last_name) : null,
            'status' => $record->status,
            'taught_on' => $record->taught_on?->toDateString(),
            'lesson_plan' => $record->lessonPlan ? $record->lessonPlan->title.' · '.$record->lessonPlan->lesson_date?->toDateString() : null,
            'content_covered' => $record->content_covered,
            'learning_activities_conducted' => $record->learning_activities_conducted,
            'work_completed' => $record->work_completed,
            'work_not_completed' => $record->work_not_completed,
            'reasons_for_deviations' => $record->reasons_for_deviations,
            'teacher_observations' => $record->teacher_observations,
            'follow_up_actions' => $record->follow_up_actions,
            'review_notes' => $record->review_notes,
            'generated_at' => now()->toISOString(),
        ];
    }

    /** School identity is optional: exports stay usable without it. */
    private function school(): array
    {
        return (new SchoolExportIdentity())->current();
    }
}
