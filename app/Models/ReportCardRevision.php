<?php

namespace App\Models;

class ReportCardRevision extends ImmutableRevision
{
    protected $casts = ['generated_at' => 'datetime', 'created_at' => 'datetime', 'input_snapshot' => 'array', 'source_manifest' => 'array'];
    public function reportCard() { return $this->belongsTo(ReportCard::class); }
}
