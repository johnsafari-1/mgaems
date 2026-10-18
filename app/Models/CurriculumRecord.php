<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CurriculumRecord extends Model
{
    protected $guarded = ['id'];

    protected $casts = ['suggested_learning_experiences' => 'array', 'key_inquiry_questions' => 'array', 'assessment_approaches' => 'array'];

    public function version()
    {
        return $this->belongsTo(CurriculumSourceVersion::class, 'curriculum_source_version_id');
    }

    public function outcomes()
    {
        return $this->hasMany(CurriculumLearningOutcome::class)->orderBy('position');
    }
}
