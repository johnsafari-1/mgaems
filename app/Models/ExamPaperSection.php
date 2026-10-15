<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ExamPaperSection extends Model
{
    protected $fillable = ['exam_paper_id', 'position', 'title', 'instructions'];
    public function paper() { return $this->belongsTo(ExamPaper::class, 'exam_paper_id'); }
}
