<?php

namespace App\Models;

class HealthRecordRevision extends ImmutableRevision
{
    protected $casts = ['snapshot' => 'array', 'recorded_at' => 'datetime'];
}
