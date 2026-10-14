<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SchemeOfWork extends Model
{
    protected $table = 'schemes_of_work';

    protected $fillable = [
        'class_subject_teacher_id', 'title', 'curriculum_reference', 'status', 'review_notes', 'created_by', 'reviewed_by', 'submitted_at', 'reviewed_at',
    ];

    protected $casts = [
        'submitted_at' => 'datetime',
        'reviewed_at' => 'datetime',
    ];

    public function assignment()
    {
        return $this->belongsTo(ClassSubjectTeacher::class, 'class_subject_teacher_id');
    }

    public function weeks()
    {
        return $this->hasMany(SchemeOfWorkWeek::class)->orderBy('week_number')->orderBy('id');
    }
}
