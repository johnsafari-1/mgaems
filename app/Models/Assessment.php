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
    ];

    protected $casts = [
        'recorded_at' => 'datetime',
        'score' => 'decimal:2',
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
}
