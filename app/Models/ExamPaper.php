<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ExamPaper extends Model
{
    public const STATUSES = ['draft', 'submitted', 'returned', 'approved', 'published', 'archived'];

    protected $fillable = ['class_subject_teacher_id', 'examination_type', 'title', 'instructions', 'duration_minutes', 'exam_date', 'status', 'revision_number', 'review_notes', 'created_by', 'reviewed_by', 'submitted_at', 'reviewed_at', 'published_at'];

    protected $casts = ['exam_date' => 'date', 'submitted_at' => 'datetime', 'reviewed_at' => 'datetime', 'published_at' => 'datetime'];

    public function assignment() { return $this->belongsTo(ClassSubjectTeacher::class, 'class_subject_teacher_id'); }
    public function sections() { return $this->hasMany(ExamPaperSection::class)->orderBy('position')->orderBy('id'); }
    public function questions() { return $this->hasMany(ExamPaperQuestion::class)->orderBy('position')->orderBy('id'); }
    public function attachments() { return $this->hasMany(ExamPaperAttachment::class); }
    public function revisions() { return $this->hasMany(ExamPaperRevision::class)->orderByDesc('revision_number'); }
}
