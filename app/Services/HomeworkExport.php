<?php

namespace App\Services;

use App\Models\Homework;
use App\Models\SchoolSetting;

/**
 * Builds printable homework documents. The learner worksheet never contains
 * answer keys or marking guidance; the answer key is a separate restricted
 * export available only to the owning teacher or school leadership.
 */
class HomeworkExport
{
    public function worksheet(Homework $homework): array
    {
        return [
            'document_type' => 'Homework',
            'school' => $this->school(),
            'class_name' => $homework->assignment?->schoolClass?->name,
            'learning_area' => $homework->assignment?->subject?->name,
            'term' => $homework->assignment?->term?->name,
            'academic_year' => $homework->assignment?->term?->academicYear?->name,
            'teacher' => $homework->assignment?->staff ? trim($homework->assignment->staff->first_name.' '.$homework->assignment->staff->last_name) : null,
            'title' => $homework->title,
            'status' => $homework->status,
            'instructions' => $homework->instructions,
            'learning_outcomes' => $homework->learning_outcomes,
            'submission_method' => $homework->submission_method,
            'assigned_on' => $homework->assigned_on?->toDateString(),
            'due_on' => $homework->due_on?->toDateString(),
            'total_marks' => $homework->total_marks,
            'questions' => $homework->questions->map(fn ($question) => [
                'position' => $question->position,
                'question_type' => $question->question_type,
                'prompt' => $question->prompt,
                'marks' => $question->marks,
                'diagram_reference' => $question->diagram_reference,
                'options' => $question->optionList(),
            ])->values()->all(),
            'includes_answer_key' => false,
            'generated_at' => now()->toISOString(),
        ];
    }

    public function answerKey(Homework $homework): array
    {
        $input = $this->worksheet($homework);
        $input['document_type'] = 'Homework answer key (restricted)';
        $input['questions'] = $homework->questions->map(fn ($question) => [
            'position' => $question->position,
            'question_type' => $question->question_type,
            'prompt' => $question->prompt,
            'marks' => $question->marks,
            'diagram_reference' => $question->diagram_reference,
            'options' => $question->optionList(),
            'answer_key' => $question->answer_key,
            'marking_guidance' => $question->marking_guidance,
        ])->values()->all();
        $input['includes_answer_key'] = true;

        return $input;
    }

    private function school(): array
    {
        $school = ['name' => 'MGAEMS', 'motto' => null];
        try {
            $settings = SchoolSetting::query()->first();
            if ($settings) $school = ['name' => $settings->school_name ?: $school['name'], 'motto' => $settings->motto];
        } catch (\Throwable $exception) {
            return $school;
        }

        return $school;
    }
}
