<?php

namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class AcademicClassResource extends JsonResource
{
    public function toArray($request): array
    {
        $teacher = $this->resource->relationLoaded('classTeacher') ? $this->classTeacher : null;

        return [
            'id' => $this->id, 'name' => $this->name, 'level' => $this->level,
            'sequence' => $this->sequence, 'capacity' => $this->capacity,
            'class_teacher_id' => $this->class_teacher_id,
            'class_teacher' => $teacher ? ['id' => $teacher->id, 'first_name' => $teacher->first_name, 'last_name' => $teacher->last_name] : null,
            'students_count' => $this->students_count,
            'subjects_count' => $this->subjects_count,
        ];
    }
}
