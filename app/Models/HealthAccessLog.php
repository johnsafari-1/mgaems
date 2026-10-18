<?php

namespace App\Models;

class HealthAccessLog extends ImmutableRevision
{
    use \App\Models\Concerns\UsesHealthUtcDates;

    protected $casts = ['recorded_at' => 'datetime'];
}
