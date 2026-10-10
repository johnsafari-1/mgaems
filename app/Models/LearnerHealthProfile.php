<?php

namespace App\Models;

class LearnerHealthProfile extends HealthRecord
{
    public const TYPE = 'profile';

    protected $casts = ['recorded_at' => 'datetime', 'reviewed_at' => 'datetime'];

    public function student()
    {
        return $this->belongsTo(Student::class);
    }

    public function alerts()
    {
        return $this->hasMany(HealthSafetyAlert::class, 'profile_id');
    }
}
