<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AttendanceStudent extends Model
{
    protected $fillable = [
        'student_id',
        'class_id',
        'attendance_date',
        'status',
        'recorded_by',
    ];

    protected $casts = [
        'attendance_date' => 'date',
    ];

    public function student()
    {
        return $this->belongsTo(Student::class);
    }

    public function schoolClass()
    {
        return $this->belongsTo(SchoolClass::class, 'class_id');
    }

    public function recordedBy()
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }
}
