<?php

namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class StudentSummaryResource extends JsonResource
{
    public function toArray($request): array
    {
        $class = $this->resource->relationLoaded('schoolClass') ? $this->schoolClass : null;

        return [
            'id' => $this->id,
            'admission_no' => $this->admission_no,
            'first_name' => $this->first_name,
            'last_name' => $this->last_name,
            'class_id' => $this->class_id,
            'status' => $this->status,
            'school_class' => $class ? ['id' => $class->id, 'name' => $class->name] : null,
        ];
    }
}
