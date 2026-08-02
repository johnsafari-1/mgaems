<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StaffDocument extends Model
{
    public $timestamps = false;

    protected $fillable = ['staff_id', 'doc_type', 'file_path'];

    protected $casts = ['uploaded_at' => 'datetime'];

    public function staff()
    {
        return $this->belongsTo(Staff::class);
    }
}
