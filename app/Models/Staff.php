<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Placeholder — full implementation (qualifications, documents, emergency
 * contacts, department relation) lands in Phase 4 (HR module) per the
 * Development Roadmap. Table is not yet migrated.
 */
class Staff extends Model
{
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

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
