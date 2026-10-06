<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ReportCard extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'student_id',
        'term_id',
        'overall_remark',
        'file_path',
        'generated_at',
        'generated_by',
        'revision_number',
    ];

    protected $casts = [
        'generated_at' => 'datetime',
        'revision_number' => 'integer',
    ];

    public function student()
    {
        return $this->belongsTo(Student::class);
    }

    public function term()
    {
        return $this->belongsTo(Term::class);
    }

    public function generatedBy()
    {
        return $this->belongsTo(User::class, 'generated_by');
    }

    public function revisions() { return $this->hasMany(ReportCardRevision::class); }

    public function publishedSnapshot(): ?array
    {
        if (! $this->revision_number) return null;
        return $this->revisions()->where('revision_number', $this->revision_number)->first()?->input_snapshot;
    }
}
