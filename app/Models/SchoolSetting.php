<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SchoolSetting extends Model
{
    protected $fillable = [
        'school_name',
        'motto',
        'vision',
        'mission',
        'address',
        'phone',
        'email',
        'logo_path',
    ];
}
