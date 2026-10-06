<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AssessmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $snapshot = $this->context_snapshot;
        return [
            'id' => $this->id, 'student_id' => $this->student_id, 'subject_id' => $this->subject_id, 'term_id' => $this->term_id,
            'assessment_type' => $this->assessment_type, 'score' => $this->score,
            'competency_rating' => $this->competency_rating, 'remarks' => $this->remarks,
            'revision_number' => (int) $this->revision_number,
            'context_state' => $snapshot ? 'captured' : 'legacy_unresolved',
            'class' => $snapshot['class'] ?? null,
            'subject' => $snapshot['subject'] ?? $this->whenLoaded('subject', fn () => $this->subject?->only(['id', 'name', 'code'])),
            'term' => $snapshot['term'] ?? $this->whenLoaded('term', fn () => $this->term?->only(['id', 'name'])),
            'student' => $this->whenLoaded('student', fn () => $this->student?->only(['id', 'first_name', 'last_name', 'admission_no'])),
        ];
    }
}
