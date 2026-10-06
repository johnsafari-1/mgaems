<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ReportCardResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $snapshot = $this->resource->publishedSnapshot();
        return [
            'id' => $this->id, 'student_id' => $this->student_id, 'term_id' => $this->term_id,
            'overall_remark' => $this->overall_remark, 'generated_at' => $this->generated_at?->toISOString(),
            'revision_number' => (int) $this->revision_number,
            'history_state' => $this->revision_number > 0 ? 'versioned' : 'legacy_artifact',
            'download_available' => $this->file_path && \Illuminate\Support\Facades\Storage::disk('private')->exists($this->file_path),
            'student' => $snapshot ? ['id' => $this->student_id] + $snapshot['student'] : $this->whenLoaded('student', fn () => $this->student?->only(['id', 'first_name', 'last_name', 'admission_no'])),
            'term' => $snapshot ? ['id' => $this->term_id, 'name' => $snapshot['term']['name']] : $this->whenLoaded('term', fn () => $this->term?->only(['id', 'name'])),
        ];
    }
}
