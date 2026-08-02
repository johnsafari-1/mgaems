<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Sponsor extends Model
{
    protected $fillable = [
        'user_id',
        'sponsor_type',
        'name',
        'contact_person',
        'phone',
        'email',
        'address',
        'notes',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function sponsorships()
    {
        return $this->hasMany(Sponsorship::class);
    }
}
