<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Maps to the `classes` table. Named SchoolClass, not Class, because
 * "Class" is a reserved word in PHP and cannot be used as a class name.
 */
class SchoolClass extends Model
{
    protected $table = 'classes';

    public $timestamps = false;

    protected $fillable = ['name', 'level', 'sequence'];

    public function streams()
    {
        return $this->hasMany(Stream::class, 'class_id');
    }

    public function students()
    {
        return $this->hasMany(Student::class, 'class_id');
    }

    public function classTeacher()
    {
        return $this->belongsTo(Staff::class, 'class_teacher_id');
    }

    public function subjects()
    {
        return $this->belongsToMany(Subject::class, 'class_subjects', 'class_id', 'subject_id');
    }
}
