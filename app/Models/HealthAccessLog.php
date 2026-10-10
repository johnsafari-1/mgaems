<?php

namespace App\Models;

class HealthAccessLog extends ImmutableRevision
{
    protected $casts = ['recorded_at' => 'datetime'];
}
