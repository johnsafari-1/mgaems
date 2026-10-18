<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Schema;

class ExamPaper extends Model
{
    public const STATUSES = ['draft', 'submitted', 'returned', 'approved', 'published', 'archived'];

    public const HEADER_TEMPLATES = ['classic', 'branded', 'compact'];

    protected $fillable = ['class_subject_teacher_id', 'examination_type', 'title', 'instructions', 'duration_minutes', 'exam_date', 'status', 'revision_number', 'review_notes', 'created_by', 'reviewed_by', 'submitted_at', 'reviewed_at', 'published_at', 'header_template', 'version_number', 'source_exam_paper_id', 'source_revision_number'];

    protected $casts = ['exam_date' => 'date', 'submitted_at' => 'datetime', 'reviewed_at' => 'datetime', 'published_at' => 'datetime'];

    public function assignment() { return $this->belongsTo(ClassSubjectTeacher::class, 'class_subject_teacher_id'); }
    public function sections() { return $this->hasMany(ExamPaperSection::class)->orderBy('position')->orderBy('id'); }
    public function questions() { return $this->hasMany(ExamPaperQuestion::class)->orderBy('position')->orderBy('id'); }
    public function attachments() { return $this->hasMany(ExamPaperAttachment::class); }
    public function revisions() { return $this->hasMany(ExamPaperRevision::class)->orderByDesc('revision_number'); }
    public function source() { return $this->belongsTo(ExamPaper::class, 'source_exam_paper_id'); }
    public function derivedVersions() { return $this->hasMany(ExamPaper::class, 'source_exam_paper_id')->orderBy('version_number'); }

    /**
     * True once the additive version/header-template migration has run. Until then
     * the studio degrades to its original single-version behaviour instead of
     * failing against a database that does not yet carry these columns.
     */
    public static function studioSchemaReady(): bool
    {
        static $ready = null;
        if ($ready === null) {
            $ready = Schema::hasColumn('exam_papers', 'header_template')
                && Schema::hasColumn('exam_papers', 'version_number')
                && Schema::hasColumn('exam_papers', 'source_exam_paper_id')
                && Schema::hasColumn('exam_papers', 'source_revision_number');
        }

        return $ready;
    }
}
