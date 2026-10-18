<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ExamPaperRevision extends Model
{
    public $timestamps = false;
    protected $fillable = ['exam_paper_id', 'revision_number', 'status', 'snapshot', 'paper_pdf_path', 'marking_pdf_path', 'snapshot_sha256', 'created_by', 'created_at'];
    protected $casts = ['snapshot' => 'array', 'created_at' => 'datetime'];
    public function paper() { return $this->belongsTo(ExamPaper::class, 'exam_paper_id'); }
}
