<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StudentMedicalInfo extends Model
{
    public $timestamps = false;

    protected $table = 'student_medical_info';

    protected $fillable = [
        'student_id',
        'conditions',
        'allergies',
        'emergency_contact_name',
        'emergency_contact_phone',
    ];

    public function student()
    {
        return $this->belongsTo(Student::class);
    }
}
