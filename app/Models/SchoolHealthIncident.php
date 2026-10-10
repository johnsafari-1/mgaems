<?php

namespace App\Models;

class SchoolHealthIncident extends HealthRecord
{
    public const TYPE = 'incident';

    protected $hidden = ['request_hash'];

    protected $casts = ['occurred_at' => 'datetime', 'recorded_at' => 'datetime', 'context_snapshot' => 'array'];

    public function student()
    {
        return $this->belongsTo(Student::class);
    }

    public function actions()
    {
        return $this->hasMany(HealthIncidentAction::class, 'incident_id');
    }

    public function notifications()
    {
        return $this->hasMany(HealthGuardianNotification::class, 'incident_id');
    }

    public function referrals()
    {
        return $this->hasMany(HealthExternalReferral::class, 'incident_id');
    }
}
