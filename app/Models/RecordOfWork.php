<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RecordOfWork extends Model
{
    protected $table = 'records_of_work';

    protected $fillable = [
        'class_subject_teacher_id', 'lesson_plan_id', 'taught_on', 'content_covered', 'learning_activities_conducted',
        'work_completed', 'work_not_completed', 'reasons_for_deviations', 'teacher_observations', 'follow_up_actions',
        'status', 'review_notes', 'created_by', 'reviewed_by', 'submitted_at', 'reviewed_at',
    ];

    protected $casts = [
        'taught_on' => 'date',
        'submitted_at' => 'datetime',
        'reviewed_at' => 'datetime',
    ];

    public function assignment()
    {
        return $this->belongsTo(ClassSubjectTeacher::class, 'class_subject_teacher_id');
    }

    public function lessonPlan()
    {
        return $this->belongsTo(LessonPlan::class, 'lesson_plan_id');
    }
}
