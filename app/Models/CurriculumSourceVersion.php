<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CurriculumSourceVersion extends Model
{
    protected $guarded = ['id'];

    protected $hidden = ['document_path', 'authorization_basis', 'verification_notes', 'created_by', 'reviewed_by'];

    protected $casts = ['publication_date' => 'date', 'reviewed_at' => 'datetime', 'document_bytes' => 'integer'];

    public function source()
    {
        return $this->belongsTo(CurriculumSource::class, 'curriculum_source_id');
    }

    public function records()
    {
        return $this->hasMany(CurriculumRecord::class)->orderBy('record_key')->orderBy('id');
    }
}
