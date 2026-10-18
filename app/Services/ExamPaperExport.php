<?php

namespace App\Services;

use App\Models\ExamPaper;
use App\Models\ExamPaperAttachment;
use Illuminate\Support\Facades\Storage;

class ExamPaperExport
{
    // Keep exported PDFs bounded: only the existing, validated local diagram uploads are embedded.
    private const MAX_EMBED_BYTES = 3145728;

    public function paper(ExamPaper $paper, bool $markingScheme = false): array
    {
        $school = (new SchoolExportIdentity())->current();

        return [
            'school' => $school, 'title' => $paper->title, 'examination_type' => $paper->examination_type,
            'instructions' => $paper->instructions, 'duration_minutes' => $paper->duration_minutes,
            'exam_date' => $paper->exam_date?->toDateString(), 'status' => $paper->status,
            'header_template' => in_array($paper->header_template ?? null, ['classic', 'branded', 'compact'], true) ? $paper->header_template : 'classic',
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
            'attachment_name' => $question->attachment?->original_name, 'image_data_uri' => $this->embeddedImage($question->attachment),
            'answer_key' => $markingScheme ? $question->answer_key : null,
            'marking_guidance' => $markingScheme ? $question->marking_guidance : null];
    }

    /**
     * Resolve the question's uploaded diagram to a bounded data URI for the PDF.
     * Only PNG/JPEG are embedded; anything else falls back to the recorded name.
     */
    private function embeddedImage(?ExamPaperAttachment $attachment): ?string
    {
        if (! $attachment) return null;

        try {
            if (! preg_match('~^exam-papers/\d+/attachments/[A-Za-z0-9._-]+$~', (string) $attachment->storage_path)) return null;
            $disk = Storage::disk('private');
            if (! $disk->exists($attachment->storage_path)) return null;
            $bytes = $disk->get($attachment->storage_path);
            if ($bytes === null || strlen($bytes) > self::MAX_EMBED_BYTES) return null;
            $info = @getimagesizefromstring($bytes);
            if (! $info || $info[0] < 1 || $info[1] < 1 || $info[0] > 2048 || $info[1] > 2048) return null;
            if (! in_array($info['mime'], ['image/png', 'image/jpeg'], true)) return null;

            return 'data:'.$info['mime'].';base64,'.base64_encode($bytes);
        } catch (\Throwable) {
            // A missing or unreadable diagram must not block the examination export.
            return null;
        }
    }
}
