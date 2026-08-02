<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PromotionTransfer extends Model
{
    protected $table = 'promotions_transfers';

    public $timestamps = false;

    protected $fillable = [
        'student_id',
        'type',
        'from_class_id',
        'to_class_id',
        'term_id',
        'reason',
        'effective_date',
        'recorded_by',
    ];

    protected $casts = [
        'effective_date' => 'date',
        'created_at' => 'datetime',
    ];

    public function student()
    {
        return $this->belongsTo(Student::class);
    }

    public function fromClass()
    {
        return $this->belongsTo(SchoolClass::class, 'from_class_id');
    }

    public function toClass()
    {
        return $this->belongsTo(SchoolClass::class, 'to_class_id');
    }

    public function term()
    {
        return $this->belongsTo(Term::class);
    }

    public function recordedBy()
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }
}
