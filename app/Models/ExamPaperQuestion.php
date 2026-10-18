<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ExamPaperQuestion extends Model
{
    public const TYPES = ['short_answer', 'essay', 'structured', 'multiple_choice'];
    protected $fillable = ['exam_paper_id', 'exam_paper_section_id', 'exam_paper_attachment_id', 'position', 'question_type', 'prompt', 'marks', 'diagram_reference', 'options', 'answer_key', 'marking_guidance', 'ai_generated', 'ai_source'];
    protected $casts = ['ai_generated' => 'boolean'];
    public function paper() { return $this->belongsTo(ExamPaper::class, 'exam_paper_id'); }
    public function section() { return $this->belongsTo(ExamPaperSection::class, 'exam_paper_section_id'); }
    public function attachment() { return $this->belongsTo(ExamPaperAttachment::class, 'exam_paper_attachment_id'); }
    public function optionList(): array { $items = json_decode($this->options ?? '', true); return is_array($items) ? array_values(array_filter($items, 'is_string')) : []; }
}
