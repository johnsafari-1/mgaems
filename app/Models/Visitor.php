<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Visitor extends Model
{
    protected $fillable = [
        'host_staff_id',
        'visitor_name',
        'visitor_type',
        'purpose',
        'visit_date',
        'notes',
    ];

    protected $casts = ['visit_date' => 'date'];

    public function hostStaff()
    {
        return $this->belongsTo(Staff::class, 'host_staff_id');
    }
}
