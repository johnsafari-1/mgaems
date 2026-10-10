<?php

namespace App\Models;

class HealthExternalReferral extends HealthRecord
{
    public const TYPE = 'referral';

    protected $hidden = ['request_hash'];

    protected $casts = ['referred_at' => 'datetime', 'recorded_at' => 'datetime'];

    public function incident()
    {
        return $this->belongsTo(SchoolHealthIncident::class, 'incident_id');
    }
}
