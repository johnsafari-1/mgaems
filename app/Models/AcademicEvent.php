<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AcademicEvent extends Model
{
    protected $fillable = [
        'academic_year_id', 'term_id', 'title', 'description', 'event_type', 'starts_on', 'ends_on', 'created_by', 'updated_by',
    ];

    protected $casts = [
        'starts_on' => 'date',
        'ends_on' => 'date',
    ];

    public function academicYear()
    {
        return $this->belongsTo(AcademicYear::class);
    }

    public function term()
    {
        return $this->belongsTo(Term::class);
    }
}
