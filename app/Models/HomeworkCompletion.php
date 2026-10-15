<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class HomeworkCompletion extends Model
{
    public const STATUSES = ['submitted', 'completed', 'missing'];

    protected $fillable = ['homework_id', 'student_id', 'status', 'notes', 'recorded_by', 'recorded_at'];

    protected $casts = ['recorded_at' => 'datetime'];

    public function homework()
    {
        return $this->belongsTo(Homework::class);
    }

    public function student()
    {
        return $this->belongsTo(Student::class);
    }
}
