<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AttendanceRecordResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'student_id' => $this->student_id,
            'class_id' => $this->class_id,
            'attendance_date' => $this->attendance_date->toDateString(),
            'status' => $this->status,
            'student' => $this->whenLoaded('student', fn () => $this->student?->only(['id', 'admission_no', 'first_name', 'last_name'])),
            'school_class' => $this->whenLoaded('schoolClass', fn () => $this->schoolClass?->only(['id', 'name'])),
        ];
    }
}
