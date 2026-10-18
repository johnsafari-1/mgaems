<?php

namespace App\Http\Resources;

class StudentResource extends StudentSummaryResource
{
    public function toArray($request): array
    {
        $data = parent::toArray($request) + [
            'gender' => $this->gender,
            'date_of_birth' => $this->date_of_birth?->toDateString(),
            'admission_date' => $this->admission_date?->toDateString(),
        ];

        // General learner access does not grant access to family contact records.
        if (in_array($request->user()?->role?->name, ['system_admin', 'head_teacher', 'deputy_head_teacher'], true)
            && $this->resource->relationLoaded('guardians')) {
            $data['guardians'] = $this->guardians->map(fn ($guardian) => [
                'id' => $guardian->id,
                'full_name' => $guardian->full_name,
                'relationship' => $guardian->relationship,
                'is_primary_contact' => $guardian->is_primary_contact,
                'phone' => $guardian->phone,
                'email' => $guardian->email,
            ])->values()->all();
        }

        return $data;
    }
}
