<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AcademicEvent;
use App\Models\AcademicYear;
use App\Models\Term;
use App\Services\AcademicIntegrity;
use App\Services\AuditLogger;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AcademicEventController extends Controller
{
    public const TYPES = ['academic_activity', 'assessment', 'meeting', 'closure', 'school_event'];

    public function __construct(private AcademicIntegrity $integrity)
    {
    }

    public function index(Request $request)
    {
        $filters = $request->validate([
            'academic_year_id' => ['sometimes', 'integer', 'exists:academic_years,id'],
            'term_id' => ['sometimes', 'integer', 'exists:terms,id'],
            'starts_on' => ['sometimes', 'date'],
            'ends_on' => ['sometimes', 'date'],
        ]);
        if (isset($filters['starts_on'], $filters['ends_on']) && $filters['starts_on'] > $filters['ends_on']) {
            throw ValidationException::withMessages(['ends_on' => 'The end date must be on or after the start date.']);
        }
        $events = AcademicEvent::with('academicYear:id,name', 'term:id,academic_year_id,name')
            ->when($filters['academic_year_id'] ?? null, fn ($query, $id) => $query->where('academic_year_id', $id))
            ->when($filters['term_id'] ?? null, fn ($query, $id) => $query->where('term_id', $id))
            ->when($filters['starts_on'] ?? null, fn ($query, $date) => $query->where('ends_on', '>=', $date))
            ->when($filters['ends_on'] ?? null, fn ($query, $date) => $query->where('starts_on', '<=', $date))
            ->orderBy('starts_on')->orderBy('ends_on')->orderBy('id')->get();

        return response()->json(['data' => $events]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->rules());

        return $this->integrity->transaction(function () use ($request, $validated, $auditLogger) {
            $values = $this->validatedPeriod($validated);
            $event = AcademicEvent::create($values + ['created_by' => $request->user()->id, 'updated_by' => $request->user()->id]);
            $auditLogger->log('CREATE_ACADEMIC_EVENT', 'AcademicEvent', $event->id, $this->auditDetails($event));

            return response()->json(['data' => $event->load('academicYear:id,name', 'term:id,academic_year_id,name')], 201);
        });
    }

    public function update(Request $request, AcademicEvent $academicEvent, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->rules($academicEvent));

        return $this->integrity->transaction(function () use ($request, $validated, $academicEvent, $auditLogger) {
            $event = AcademicEvent::whereKey($academicEvent->id)->lockForUpdate()->firstOrFail();
            $values = $this->validatedPeriod(array_replace($this->eventValues($event), $validated));
            $event->update($values + ['updated_by' => $request->user()->id]);
            $auditLogger->log('UPDATE_ACADEMIC_EVENT', 'AcademicEvent', $event->id, $this->auditDetails($event));

            return response()->json(['data' => $event->load('academicYear:id,name', 'term:id,academic_year_id,name')]);
        });
    }

    public function destroy(AcademicEvent $academicEvent, AuditLogger $auditLogger)
    {
        return $this->integrity->transaction(function () use ($academicEvent, $auditLogger) {
            $event = AcademicEvent::whereKey($academicEvent->id)->lockForUpdate()->firstOrFail();
            AcademicYear::whereKey($event->academic_year_id)->lockForUpdate()->firstOrFail();
            if ($event->term_id) Term::whereKey($event->term_id)->lockForUpdate()->firstOrFail();
            $event->delete();
            $auditLogger->log('DELETE_ACADEMIC_EVENT', 'AcademicEvent', $event->id, $this->auditDetails($event));

            return response()->json(['data' => ['message' => 'Academic event deleted.']]);
        });
    }

    private function rules(?AcademicEvent $event = null): array
    {
        $sometimes = $event ? ['sometimes'] : ['required'];

        return [
            'academic_year_id' => [...$sometimes, 'integer', 'exists:academic_years,id'],
            'term_id' => ['sometimes', 'nullable', 'integer', 'exists:terms,id'],
            'title' => [...$sometimes, 'string', 'max:160'],
            'description' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'event_type' => [...$sometimes, Rule::in(self::TYPES)],
            'starts_on' => [...$sometimes, 'date'],
            'ends_on' => [...$sometimes, 'date'],
        ];
    }

    private function validatedPeriod(array $values): array
    {
        $starts = Carbon::parse($values['starts_on'])->toDateString();
        $ends = Carbon::parse($values['ends_on'])->toDateString();
        if ($starts > $ends) throw ValidationException::withMessages(['ends_on' => 'The end date must be on or after the start date.']);
        $year = AcademicYear::whereKey($values['academic_year_id'])->lockForUpdate()->firstOrFail();
        if ($starts < $year->start_date->toDateString() || $ends > $year->end_date->toDateString()) {
            throw ValidationException::withMessages(['starts_on' => 'Event dates must fall within the selected academic year.']);
        }
        $termId = $values['term_id'] ?? null;
        if ($termId) {
            $term = Term::whereKey($termId)->lockForUpdate()->firstOrFail();
            if ((int) $term->academic_year_id !== (int) $year->id) {
                throw ValidationException::withMessages(['term_id' => 'The selected term does not belong to the academic year.']);
            }
            if ($starts < $term->start_date->toDateString() || $ends > $term->end_date->toDateString()) {
                throw ValidationException::withMessages(['starts_on' => 'Term-linked event dates must fall within the selected term.']);
            }
        }

        return array_replace($values, ['starts_on' => $starts, 'ends_on' => $ends]);
    }

    private function eventValues(AcademicEvent $event): array
    {
        return [
            'academic_year_id' => $event->academic_year_id,
            'term_id' => $event->term_id,
            'title' => $event->title,
            'description' => $event->description,
            'event_type' => $event->event_type,
            'starts_on' => $event->starts_on->toDateString(),
            'ends_on' => $event->ends_on->toDateString(),
        ];
    }

    private function auditDetails(AcademicEvent $event): array
    {
        return $event->only(['academic_year_id', 'term_id', 'title', 'event_type', 'starts_on', 'ends_on']);
    }
}
