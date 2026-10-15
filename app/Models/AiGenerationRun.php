<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AiGenerationRun extends Model
{
    protected $fillable = ['operation', 'provider', 'state', 'document_type', 'document_id', 'input_sha256', 'output', 'created_by', 'accepted_by', 'accepted_at'];
    protected $casts = ['output' => 'array', 'accepted_at' => 'datetime'];
}
