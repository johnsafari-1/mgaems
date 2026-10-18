<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CurriculumLearningOutcome extends Model
{
    public $timestamps = false;

    protected $fillable = ['curriculum_record_id', 'position', 'description'];

    protected $casts = ['position' => 'integer'];

    public function record()
    {
        return $this->belongsTo(CurriculumRecord::class, 'curriculum_record_id');
    }
}
