<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ClassSubjectTeacher extends Model
{
    protected $table = 'class_subject_teacher';

    protected $fillable = ['class_id', 'subject_id', 'staff_id', 'term_id'];

    public function schoolClass()
    {
        return $this->belongsTo(SchoolClass::class, 'class_id');
    }

    public function subject()
    {
        return $this->belongsTo(Subject::class);
    }

    public function staff()
    {
        return $this->belongsTo(Staff::class);
    }

    public function term()
    {
        return $this->belongsTo(Term::class);
    }

    public function schemeOfWork()
    {
        return $this->hasOne(SchemeOfWork::class, 'class_subject_teacher_id');
    }

    public function lessonPlans()
    {
        return $this->hasMany(LessonPlan::class, 'class_subject_teacher_id');
    }

    public function recordsOfWork()
    {
        return $this->hasMany(RecordOfWork::class, 'class_subject_teacher_id');
    }

    public function homeworks()
    {
        return $this->hasMany(Homework::class, 'class_subject_teacher_id');
    }
}
