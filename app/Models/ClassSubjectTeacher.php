<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ClassSubjectTeacher extends Model
{
    protected $table = 'class_subject_teacher';

    protected $fillable = ['class_id', 'stream_id', 'subject_id', 'staff_id', 'term_id'];

    public function schoolClass()
    {
        return $this->belongsTo(SchoolClass::class, 'class_id');
    }

    public function stream()
    {
        return $this->belongsTo(Stream::class);
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
}
