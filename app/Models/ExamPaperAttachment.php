<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ExamPaperAttachment extends Model
{
    protected $fillable = ['exam_paper_id', 'storage_path', 'original_name', 'mime_type', 'byte_size', 'sha256', 'uploaded_by'];
    public function paper() { return $this->belongsTo(ExamPaper::class, 'exam_paper_id'); }
}
