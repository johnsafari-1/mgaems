<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CurriculumSource extends Model
{
    protected $fillable = ['identifier', 'title', 'official_url', 'publisher', 'grade', 'learning_area', 'subject_id', 'created_by'];

    protected $casts = ['grade' => 'integer'];

    public function subject()
    {
        return $this->belongsTo(Subject::class);
    }

    public function versions()
    {
        return $this->hasMany(CurriculumSourceVersion::class);
    }
}
