<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LessonPlan extends Model
{
    protected $fillable = [
        'class_subject_teacher_id', 'scheme_of_work_week_id', 'duplicated_from_lesson_plan_id', 'title', 'lesson_date', 'duration_minutes',
        'strand', 'sub_strand', 'specific_learning_outcomes', 'key_inquiry_questions', 'teaching_learning_resources',
        'introduction', 'lesson_development', 'conclusion', 'learning_activities', 'assessment_approach', 'teacher_reflection',
        'status', 'review_notes', 'created_by', 'reviewed_by', 'submitted_at', 'reviewed_at',
    ];

    protected $casts = [
        'lesson_date' => 'date',
        'submitted_at' => 'datetime',
        'reviewed_at' => 'datetime',
    ];

    public function assignment()
    {
        return $this->belongsTo(ClassSubjectTeacher::class, 'class_subject_teacher_id');
    }

    public function schemeWeek()
    {
        return $this->belongsTo(SchemeOfWorkWeek::class, 'scheme_of_work_week_id');
    }

    public function sourcePlan()
    {
        return $this->belongsTo(LessonPlan::class, 'duplicated_from_lesson_plan_id');
    }

    public function recordOfWork()
    {
        return $this->hasOne(RecordOfWork::class, 'lesson_plan_id');
    }
}
