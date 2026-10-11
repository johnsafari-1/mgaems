<?php

namespace App\Services;

use App\Models\Sponsor;
use App\Models\Sponsorship;
use App\Models\Student;
use Illuminate\Http\Request;

/** Operational responses deliberately exclude authentication, HR and family records. */
class SponsorshipView
{
    public const RELATIONS = ['sponsor:id,name,sponsor_type',
        'student:id,first_name,last_name,admission_no,class_id,status', 'student.schoolClass:id,name',
        'students:id,first_name,last_name,admission_no,class_id,status', 'students.schoolClass:id,name'];

    public static function learner(Student $student): array
    {
        return ['id' => $student->id, 'admission_no' => $student->admission_no,
            'first_name' => $student->first_name, 'last_name' => $student->last_name, 'status' => $student->status,
            'school_class' => $student->schoolClass ? ['id' => $student->schoolClass->id, 'name' => $student->schoolClass->name] : null];
    }

    public static function item(Sponsorship $item): array
    {
        return ['id' => $item->id, 'sponsor_id' => $item->sponsor_id,
            'sponsor' => $item->sponsor ? ['id' => $item->sponsor->id, 'name' => $item->sponsor->name, 'sponsor_type' => $item->sponsor->sponsor_type] : null,
            'sponsorship_type' => $item->sponsorship_type, 'status' => $item->status,
            'start_date' => $item->start_date?->toDateString(), 'end_date' => $item->end_date?->toDateString(),
            'program_name' => $item->sponsorship_type === 'school_wide' ? $item->program_name : null,
            'student' => $item->sponsorship_type === 'individual' && $item->student ? self::learner($item->student) : null,
            'students' => $item->sponsorship_type === 'group' ? $item->students->map(fn ($student) => self::learner($student))->values()->all() : [],
            'notes' => $item->notes];
    }

    public static function sponsor(Sponsor $sponsor, bool $detail = false): array
    {
        $data = ['id' => $sponsor->id, 'name' => $sponsor->name, 'sponsor_type' => $sponsor->sponsor_type,
            'sponsorships_count' => (int) $sponsor->sponsorships_count];
        if ($detail) $data += ['contact_person' => $sponsor->contact_person, 'phone' => $sponsor->phone,
            'email' => $sponsor->email, 'address' => $sponsor->address, 'notes' => $sponsor->notes];
        return $data;
    }

    public static function listing($query, Request $request, callable $shape, array $filters)
    {
        // Preserve legacy leadership consumers; the Coordinator workspace always pages.
        if ($request->user()?->hasRole('sponsor_coordinator') || isset($filters['per_page']) || isset($filters['page'])) {
            $page = $query->paginate($filters['per_page'] ?? 15);
            return response()->json(['data' => $page->getCollection()->map($shape)->values(),
                'meta' => ['page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total()]])
                ->header('Cache-Control', 'private, no-store');
        }
        return response()->json(['data' => $query->get()->map($shape)->values()])->header('Cache-Control', 'private, no-store');
    }

    public static function filters(): array
    {
        return ['search' => ['sometimes', 'nullable', 'string', 'max:150'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:1000000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100']];
    }

    public static function pattern(string $search): string
    {
        return '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $search).'%';
    }
}
