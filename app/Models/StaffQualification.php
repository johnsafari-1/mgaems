<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StaffQualification extends Model
{
    public $timestamps = false;

    protected $fillable = ['staff_id', 'qualification', 'institution', 'year_obtained'];

    public function staff()
    {
        return $this->belongsTo(Staff::class);
    }
}
