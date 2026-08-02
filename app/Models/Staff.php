<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Staff extends Model
{
    // Explicit table name — Eloquent's pluralization of "Staff" is
    // unreliable (English treats "staff" as collective), so don't rely
    // on the convention here.
    protected $table = 'staff';

    protected $fillable = [
        'user_id',
        'department_id',
        'staff_type',
        'role_title',
        'first_name',
        'last_name',
        'phone',
        'employment_date',
        'contract_type',
        'status',
    ];

    protected $casts = [
        'employment_date' => 'date',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function department()
    {
        return $this->belongsTo(Department::class);
    }

    public function qualifications()
    {
        return $this->hasMany(StaffQualification::class);
    }

    public function documents()
    {
        return $this->hasMany(StaffDocument::class);
    }

    public function emergencyContacts()
    {
        return $this->hasMany(StaffEmergencyContact::class);
    }
}
