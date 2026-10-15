<?php

namespace App\Services;

use App\Models\ExamPaper;
use App\Models\SchoolSetting;

class ExamPaperExport
{
    public function paper(ExamPaper $paper, bool $markingScheme = false): array
    {
        $school = ['name' => 'MGAEMS', 'motto' => null];
        try {
            $setting = SchoolSetting::query()->first();
            if ($setting) $school = ['name' => $setting->school_name ?: 'MGAEMS', 'motto' => $setting->motto];
        } catch (\Throwable) { /* Exports remain available in isolated tests without school settings. */ }

        return [
            'school' => $school, 'title' => $paper->title, 'examination_type' => $paper->examination_type,
            'instructions' => $paper->instructions, 'duration_minutes' => $paper->duration_minutes,
            'exam_date' => $paper->exam_date?->toDateString(), 'status' => $paper->status,
            'class_name' => $paper->assignment?->schoolClass?->name, 'learning_area' => $paper->assignment?->subject?->name,
            'term' => $paper->assignment?->term?->name, 'academic_year' => $paper->assignment?->term?->academicYear?->name,
            'total_marks' => (int) $paper->questions->sum(fn ($question) => (int) $question->marks),
            'marking_scheme' => $markingScheme,
            'sections' => $paper->sections->map(fn ($section) => [
                'title' => $section->title, 'instructions' => $section->instructions,
                'questions' => $paper->questions->where('exam_paper_section_id', $section->id)->map(fn ($question) => $this->question($question, $markingScheme))->values(),
            ])->values(),
            'unsectioned_questions' => $paper->questions->whereNull('exam_paper_section_id')->map(fn ($question) => $this->question($question, $markingScheme))->values(),
            'generated_at' => now()->toISOString(),
        ];
    }

    private function question($question, bool $markingScheme): array
    {
        return ['position' => $question->position, 'question_type' => $question->question_type, 'prompt' => $question->prompt,
            'marks' => $question->marks, 'diagram_reference' => $question->diagram_reference, 'options' => $question->optionList(),
            'attachment_name' => $question->attachment?->original_name, 'answer_key' => $markingScheme ? $question->answer_key : null,
            'marking_guidance' => $markingScheme ? $question->marking_guidance : null];
    }
}
