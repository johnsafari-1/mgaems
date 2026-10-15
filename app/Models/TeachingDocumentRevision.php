<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TeachingDocumentRevision extends Model
{
    public $timestamps = false;
    protected $fillable = ['document_type', 'document_id', 'revision_number', 'event', 'status', 'snapshot', 'snapshot_sha256', 'acted_by', 'created_at'];
    protected $casts = ['snapshot' => 'array', 'created_at' => 'datetime'];
}
