<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Assessment extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'student_id',
        'subject_id',
        'term_id',
        'recorded_by',
        'assessment_type',
        'score',
        'competency_rating',
        'remarks',
        'recorded_at',
        'class_id', 'class_subject_id', 'authorization_assignment_id',
        'authority_type', 'context_snapshot', 'revision_number',
    ];

    protected $casts = [
        'recorded_at' => 'datetime',
        'score' => 'decimal:2',
        'context_snapshot' => 'array',
        'revision_number' => 'integer',
    ];

    public function student()
    {
        return $this->belongsTo(Student::class);
    }

    public function subject()
    {
        return $this->belongsTo(Subject::class);
    }

    public function term()
    {
        return $this->belongsTo(Term::class);
    }

    public function recordedBy()
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }

    public function revisions() { return $this->hasMany(AssessmentRevision::class); }

    protected static function booted(): void
    {
        static::updating(function ($assessment) {
            foreach (['student_id', 'subject_id', 'term_id', 'assessment_type', 'class_id', 'class_subject_id', 'authorization_assignment_id', 'authority_type', 'context_snapshot'] as $field) {
                if ($assessment->isDirty($field)) throw new \LogicException('Assessment identity and original context are immutable.');
            }
        });
    }
}
