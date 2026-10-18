<?php

namespace App\Models;

class HealthGuardianNotification extends HealthRecord
{
    public const TYPE = 'notification';

    protected $hidden = ['request_hash'];

    protected $casts = ['attempted_at' => 'datetime', 'recorded_at' => 'datetime', 'contact_snapshot' => 'array'];

    public function incident()
    {
        return $this->belongsTo(SchoolHealthIncident::class, 'incident_id');
    }

    public function guardian()
    {
        return $this->belongsTo(Guardian::class);
    }
}
