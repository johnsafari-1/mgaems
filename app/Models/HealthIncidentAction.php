<?php

namespace App\Models;

class HealthIncidentAction extends HealthRecord
{
    public const TYPE = 'action';

    protected $hidden = ['request_hash'];

    protected $casts = ['action_at' => 'datetime', 'recorded_at' => 'datetime'];

    public function incident()
    {
        return $this->belongsTo(SchoolHealthIncident::class, 'incident_id');
    }
}
