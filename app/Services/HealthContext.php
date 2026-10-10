<?php

namespace App\Services;

use App\Models\PromotionTransfer;
use App\Models\SchoolClass;
use App\Models\Student;
use App\Models\Term;
use Carbon\Carbon;

class HealthContext
{
    public function capture(Student $student, Carbon $occurred): array
    {
        $date = $occurred->toDateString();
        // Current placement alone does not prove historical placement.
        $placement = PromotionTransfer::where('student_id', $student->id)->where('effective_date', '<=', $date)
            ->orderByDesc('effective_date')->orderByDesc('id')->sharedLock()->first();
        $class = $placement && $placement->effective_date->toDateString() !== $date
            && in_array($placement->type, ['promotion', 'transfer_in'], true)
            ? SchoolClass::whereKey($placement->to_class_id)->sharedLock()->first() : null;
        $terms = Term::where('start_date', '<=', $date)->where('end_date', '>=', $date)
            ->whereHas('academicYear', fn ($year) => $year->where('start_date', '<=', $date)->where('end_date', '>=', $date))
            ->sharedLock()->limit(2)->get();
        $term = $terms->count() === 1 ? $terms->first() : null;

        return ['historical_class_id' => $class?->id, 'historical_term_id' => $term?->id,
            'context_snapshot' => [
                'class_basis' => $class ? 'recorded_placement_history' : 'unknown', 'placement_record_id' => $class ? $placement->id : null,
                'class_name_at_recording' => $class?->name, 'term_basis' => $term ? 'unique_calendar_period' : 'unknown',
                'term_name_at_recording' => $term?->name,
            ]];
    }
}
