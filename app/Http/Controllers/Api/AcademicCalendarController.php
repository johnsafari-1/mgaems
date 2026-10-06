<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AcademicYear;
use App\Models\Assessment;
use App\Models\ClassSubjectTeacher;
use App\Models\PromotionTransfer;
use App\Models\ReportCard;
use App\Models\Term;
use App\Services\AcademicIntegrity;
use App\Services\AuditLogger;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AcademicCalendarController extends Controller
{
    public function __construct(private AcademicIntegrity $integrity)
    {
    }

    public function indexYears()
    {
        return response()->json(['data' => AcademicYear::orderByDesc('start_date')->orderByDesc('id')->get()]);
    }

    public function storeYear(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->yearRules());
        return $this->integrity->transaction(function () use ($validated, $auditLogger) {
            $dates = $this->dateRange($validated['start_date'], $validated['end_date']);
            $year = AcademicYear::create(array_replace($validated, $dates, ['is_current' => false]));
            $auditLogger->log('CREATE_ACADEMIC_YEAR', 'AcademicYear', $year->id, $validated);

            return response()->json(['data' => $year], 201);
        });
    }

    public function updateYear(Request $request, AcademicYear $academicYear, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->yearRules($academicYear));
        return $this->integrity->transaction(function () use ($validated, $academicYear, $auditLogger) {
            $year = AcademicYear::whereKey($academicYear->id)->lockForUpdate()->firstOrFail();
            $dates = $this->dateRange($validated['start_date'] ?? $year->start_date->toDateString(), $validated['end_date'] ?? $year->end_date->toDateString());
            if ($year->terms()->where(fn ($query) => $query->where('start_date', '<', $dates['start_date'])->orWhere('end_date', '>', $dates['end_date']))->exists()) {
                throw ValidationException::withMessages(['start_date' => 'The year must continue to contain all of its existing terms.']);
            }
            $year->update(array_replace($validated, $dates));
            $auditLogger->log('UPDATE_ACADEMIC_YEAR', 'AcademicYear', $year->id, $validated);

            return response()->json(['data' => $year]);
        });
    }

    public function activateYear(AcademicYear $academicYear, AuditLogger $auditLogger)
    {
        return $this->integrity->transaction(function () use ($academicYear, $auditLogger) {
            $years = AcademicYear::orderBy('id')->lockForUpdate()->get();
            $year = $years->firstWhere('id', $academicYear->id);
            if (! $year) abort(404);
            $previousYearIds = $years->where('is_current', true)->pluck('id')->all();
            AcademicYear::where('id', '!=', $year->id)->update(['is_current' => false]);
            $year->update(['is_current' => true]);
            $currentTerms = Term::where('is_current', true)->orderBy('id')->lockForUpdate()->get();
            // Preserve a single current term only when it belongs to this year.
            foreach ($currentTerms as $term) {
                if ((int) $term->academic_year_id !== (int) $year->id || $currentTerms->count() > 1) {
                    $term->update(['is_current' => false]);
                    $auditLogger->log('DEACTIVATE_TERM', 'Term', $term->id, ['reason' => 'academic_year_activation']);
                }
            }
            $auditLogger->log('ACTIVATE_ACADEMIC_YEAR', 'AcademicYear', $year->id, ['previous_current_year_ids' => $previousYearIds]);

            return response()->json(['data' => $year]);
        });
    }

    public function destroyYear(AcademicYear $academicYear, AuditLogger $auditLogger)
    {
        return $this->integrity->transaction(function () use ($academicYear, $auditLogger) {
            $year = AcademicYear::whereKey($academicYear->id)->lockForUpdate()->firstOrFail();
            if ($year->is_current) return $this->integrity->conflict('YEAR_CURRENT', 'Activate another academic year before deleting the current year.');
            if ($year->terms()->exists()) return $this->integrity->conflict('YEAR_HAS_TERMS', 'This year has terms. Preserve its historical periods; remove only unused terms first.');
            $year->delete();
            $auditLogger->log('DELETE_ACADEMIC_YEAR', 'AcademicYear', $year->id);

            return response()->json(['data' => ['message' => 'Academic year deleted.']]);
        });
    }

    public function indexTerms(Request $request)
    {
        $filters = $request->validate(['academic_year_id' => ['sometimes', 'integer', 'exists:academic_years,id']]);
        $terms = Term::with('academicYear:id,name')
            ->when($filters['academic_year_id'] ?? null, fn ($query, $id) => $query->where('academic_year_id', $id))
            ->orderByDesc('start_date')->orderByDesc('id')->get();

        return response()->json(['data' => $terms]);
    }

    public function storeTerm(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->termRules());
        return $this->integrity->transaction(function () use ($validated, $auditLogger) {
            $year = AcademicYear::whereKey($validated['academic_year_id'])->lockForUpdate()->firstOrFail();
            $dates = $this->dateRange($validated['start_date'], $validated['end_date']);
            if (Term::where('academic_year_id', $year->id)->where('name', $validated['name'])->exists()) {
                return $this->integrity->conflict('DUPLICATE_TERM', 'A term with this name already exists in the academic year.');
            }
            $this->assertTermRange($year, $dates);
            $term = Term::create(array_replace($validated, $dates, ['is_current' => false]));
            $auditLogger->log('CREATE_TERM', 'Term', $term->id, $validated);

            return response()->json(['data' => $term->load('academicYear:id,name')], 201);
        });
    }

    public function updateTerm(Request $request, Term $term, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->termRules($term));
        $validated = array_intersect_key($validated, array_flip(['name', 'start_date', 'end_date']));
        return $this->integrity->transaction(function () use ($validated, $term, $auditLogger) {
            $year = AcademicYear::whereKey($term->academic_year_id)->lockForUpdate()->firstOrFail();
            $term = Term::whereKey($term->id)->lockForUpdate()->firstOrFail();
            $dates = $this->dateRange($validated['start_date'] ?? $term->start_date->toDateString(), $validated['end_date'] ?? $term->end_date->toDateString());
            $changedDates = $dates['start_date'] !== $term->start_date->toDateString() || $dates['end_date'] !== $term->end_date->toDateString();
            if ($changedDates && $this->termHasHistory($term->id)) {
                throw ValidationException::withMessages(['start_date' => 'Dates of a term with recorded assessments, report cards, or learner history cannot be changed.']);
            }
            $this->assertTermRange($year, $dates, $term->id);
            if (isset($validated['name']) && Term::where('academic_year_id', $year->id)->where('name', $validated['name'])->where('id', '!=', $term->id)->exists()) {
                return $this->integrity->conflict('DUPLICATE_TERM', 'A term with this name already exists in the academic year.');
            }
            $term->update(array_replace($validated, $dates));
            $auditLogger->log('UPDATE_TERM', 'Term', $term->id, $validated);

            return response()->json(['data' => $term->load('academicYear:id,name')]);
        });
    }

    public function activateTerm(Term $term, AuditLogger $auditLogger)
    {
        return $this->integrity->transaction(function () use ($term, $auditLogger) {
            $years = AcademicYear::orderBy('id')->lockForUpdate()->get();
            $terms = Term::orderBy('id')->lockForUpdate()->get();
            $selected = $terms->firstWhere('id', $term->id);
            if (! $selected) abort(404);
            $year = $years->firstWhere('id', $selected->academic_year_id);
            if (! $year) abort(404);
            $this->assertTermRange($year, $this->dateRange($selected->start_date->toDateString(), $selected->end_date->toDateString()), $selected->id);
            foreach ($years as $item) {
                $active = $item->id === $year->id;
                if ($item->is_current !== $active) {
                    $item->update(['is_current' => $active]);
                    $auditLogger->log($active ? 'ACTIVATE_ACADEMIC_YEAR' : 'DEACTIVATE_ACADEMIC_YEAR', 'AcademicYear', $item->id, ['reason' => 'term_activation']);
                }
            }
            foreach ($terms as $item) {
                $active = $item->id === $selected->id;
                if ($item->is_current !== $active) {
                    $item->update(['is_current' => $active]);
                    if (! $active) $auditLogger->log('DEACTIVATE_TERM', 'Term', $item->id, ['reason' => 'term_activation']);
                }
            }
            $auditLogger->log('ACTIVATE_TERM', 'Term', $selected->id);

            return response()->json(['data' => $selected->load('academicYear:id,name')]);
        });
    }

    public function destroyTerm(Term $term, AuditLogger $auditLogger)
    {
        return $this->integrity->transaction(function () use ($term, $auditLogger) {
            AcademicYear::whereKey($term->academic_year_id)->lockForUpdate()->firstOrFail();
            $term = Term::whereKey($term->id)->lockForUpdate()->firstOrFail();
            if ($term->is_current) return $this->integrity->conflict('TERM_CURRENT', 'Activate another term before deleting the current term.');
            if ($this->termHasHistory($term->id) || ClassSubjectTeacher::where('term_id', $term->id)->exists()) {
                return $this->integrity->conflict('TERM_IN_USE', 'This term has teacher assignments, assessments, report cards, or learner history and cannot be deleted.');
            }
            $term->delete();
            $auditLogger->log('DELETE_TERM', 'Term', $term->id);

            return response()->json(['data' => ['message' => 'Term deleted.']]);
        });
    }

    private function dateRange(string $start, string $end): array
    {
        $start = Carbon::parse($start)->toDateString();
        $end = Carbon::parse($end)->toDateString();
        if ($start > $end) throw ValidationException::withMessages(['end_date' => 'The end date must be on or after the start date.']);

        return ['start_date' => $start, 'end_date' => $end];
    }

    private function assertTermRange(AcademicYear $year, array $dates, ?int $exceptId = null): void
    {
        if ($dates['start_date'] < $year->start_date->toDateString() || $dates['end_date'] > $year->end_date->toDateString()) {
            throw ValidationException::withMessages(['start_date' => 'Term dates must fall within their academic year.']);
        }
        if ($year->terms()->when($exceptId, fn ($query) => $query->where('id', '!=', $exceptId))
            ->where('start_date', '<=', $dates['end_date'])->where('end_date', '>=', $dates['start_date'])->exists()) {
            throw ValidationException::withMessages(['start_date' => 'This term overlaps another term in the same school academic year.']);
        }
    }

    private function termHasHistory(int $id): bool
    {
        return Assessment::where('term_id', $id)->exists()
            || ReportCard::where('term_id', $id)->exists()
            || PromotionTransfer::where('term_id', $id)->exists();
    }

    private function yearRules(?AcademicYear $year = null): array
    {
        return [
            'name' => [$year ? 'sometimes' : 'required', 'required', 'string', 'max:20', Rule::unique('academic_years', 'name')->ignore($year?->id)],
            'start_date' => [$year ? 'sometimes' : 'required', 'required', 'date'],
            'end_date' => [$year ? 'sometimes' : 'required', 'required', 'date'],
        ];
    }

    private function termRules(?Term $term = null): array
    {
        return [
            'academic_year_id' => $term ? ['prohibited'] : ['required', 'integer', 'exists:academic_years,id'],
            'name' => [$term ? 'sometimes' : 'required', 'required', 'string', 'max:20'],
            'start_date' => [$term ? 'sometimes' : 'required', 'required', 'date'],
            'end_date' => [$term ? 'sometimes' : 'required', 'required', 'date'],
        ];
    }
}
