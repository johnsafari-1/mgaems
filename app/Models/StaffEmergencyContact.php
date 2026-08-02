<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StaffEmergencyContact extends Model
{
    public $timestamps = false;

    protected $fillable = ['staff_id', 'full_name', 'relationship', 'phone'];

    public function staff()
    {
        return $this->belongsTo(Staff::class);
    }
}
