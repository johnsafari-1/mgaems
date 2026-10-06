<?php

namespace App\Models;

class AssessmentRevision extends ImmutableRevision
{
    protected $casts = ['score' => 'decimal:2', 'recorded_at' => 'datetime', 'created_at' => 'datetime', 'context_snapshot' => 'array'];
    public function assessment() { return $this->belongsTo(Assessment::class); }
    public function actor() { return $this->belongsTo(User::class, 'actor_id'); }
}
