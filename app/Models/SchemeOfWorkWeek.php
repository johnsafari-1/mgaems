<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SchemeOfWorkWeek extends Model
{
    protected $fillable = [
        'scheme_of_work_id', 'week_number', 'starts_on', 'ends_on', 'strand', 'sub_strand', 'learning_outcomes', 'learning_activities', 'resources',
    ];

    protected $casts = [
        'starts_on' => 'date',
        'ends_on' => 'date',
    ];

    public function scheme()
    {
        return $this->belongsTo(SchemeOfWork::class, 'scheme_of_work_id');
    }
}
