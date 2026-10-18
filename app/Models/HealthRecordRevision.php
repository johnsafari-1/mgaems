<?php

namespace App\Models;

class HealthRecordRevision extends ImmutableRevision
{
    use \App\Models\Concerns\UsesHealthUtcDates;

    protected $casts = ['snapshot' => 'array', 'recorded_at' => 'datetime'];
}
