<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class HomeworkQuestion extends Model
{
    public const TYPES = ['short_answer', 'structured', 'multiple_choice'];

    protected $fillable = [
        'homework_id', 'position', 'question_type', 'prompt', 'marks', 'diagram_reference', 'options', 'answer_key', 'marking_guidance',
    ];

    public function homework()
    {
        return $this->belongsTo(Homework::class);
    }

    /** Multiple-choice options are stored as a JSON array of strings. */
    public function optionList(): array
    {
        $decoded = json_decode($this->options ?? '', true);

        return is_array($decoded) ? array_values(array_filter($decoded, 'is_string')) : [];
    }
}
