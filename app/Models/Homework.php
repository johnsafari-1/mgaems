<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Homework extends Model
{
    public const STATUSES = ['draft', 'published', 'closed', 'archived'];

    protected $table = 'homeworks';

    protected $fillable = [
        'class_subject_teacher_id', 'lesson_plan_id', 'scheme_of_work_week_id',
        'title', 'instructions', 'learning_outcomes', 'total_marks', 'assigned_on',
        'due_on', 'submission_method', 'teacher_notes', 'status', 'created_by',
        'published_at', 'closed_at', 'archived_at',
    ];

    protected $casts = [
        'assigned_on' => 'date',
        'due_on' => 'date',
        'published_at' => 'datetime',
        'closed_at' => 'datetime',
        'archived_at' => 'datetime',
    ];

    public function assignment()
    {
        return $this->belongsTo(ClassSubjectTeacher::class, 'class_subject_teacher_id');
    }

    public function lessonPlan()
    {
        return $this->belongsTo(LessonPlan::class, 'lesson_plan_id');
    }

    public function schemeWeek()
    {
        return $this->belongsTo(SchemeOfWorkWeek::class, 'scheme_of_work_week_id');
    }

    public function questions()
    {
        return $this->hasMany(HomeworkQuestion::class)->orderBy('position')->orderBy('id');
    }

    public function completions()
    {
        return $this->hasMany(HomeworkCompletion::class);
    }
}
