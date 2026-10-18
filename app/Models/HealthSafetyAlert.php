<?php

namespace App\Models;

class HealthSafetyAlert extends HealthRecord
{
    public const TYPE = 'alert';

    protected $hidden = ['request_hash'];

    protected $casts = ['is_active' => 'boolean', 'starts_on' => 'date', 'ends_on' => 'date', 'verified_at' => 'datetime'];

    public function profile()
    {
        return $this->belongsTo(LearnerHealthProfile::class, 'profile_id');
    }
}
