<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Role extends Model
{
    public $timestamps = false;

    protected $fillable = ['name'];

    // Canonical role names, per docs/MGAEMS_UserRoleMatrix.docx
    public const SYSTEM_ADMIN = 'system_admin';
    public const HEAD_TEACHER = 'head_teacher';
    public const DEPUTY_HEAD_TEACHER = 'deputy_head_teacher';
    public const SPONSOR_COORDINATOR = 'sponsor_coordinator';
    public const TEACHER = 'teacher';
    public const PARENT_GUARDIAN = 'parent_guardian';
    public const SPONSOR = 'sponsor';
    public const STUDENT = 'student';

    public function users()
    {
        return $this->hasMany(User::class);
    }
}
