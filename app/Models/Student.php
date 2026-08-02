<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Student extends Model
{
    protected $fillable = [
        'admission_no',
        'first_name',
        'last_name',
        'date_of_birth',
        'gender',
        'class_id',
        'stream_id',
        'photo_path',
        'status',
        'admission_date',
    ];

    protected $casts = [
        'date_of_birth' => 'date',
        'admission_date' => 'date',
    ];

    public function schoolClass()
    {
        return $this->belongsTo(SchoolClass::class, 'class_id');
    }

    public function stream()
    {
        return $this->belongsTo(Stream::class, 'stream_id');
    }

    public function guardians()
    {
        return $this->hasMany(Guardian::class);
    }

    public function medicalInfo()
    {
        return $this->hasOne(StudentMedicalInfo::class);
    }

    public function promotionsTransfers()
    {
        return $this->hasMany(PromotionTransfer::class)->orderByDesc('effective_date');
    }
}
