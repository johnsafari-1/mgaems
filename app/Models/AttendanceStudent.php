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

    // Keep the SQL DATE value date-only; Laravel's default date write format
    // includes a time even for date casts (not normalized by SQLite).
    public function setAttendanceDateAttribute($value): void
    {
        $this->attributes['attendance_date'] = $value instanceof \DateTimeInterface ? $value->format('Y-m-d') : $value;
    }

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
