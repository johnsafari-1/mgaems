<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AcademicYear;
use App\Models\Term;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Implements SRS FR-ACAD-01 and UC-ACAD-01: academic years and terms,
 * including "only one current year/term at a time" enforcement.
 */
class AcademicCalendarController extends Controller
{
    // -------- Academic Years --------

    public function indexYears()
    {
        return response()->json(['data' => AcademicYear::orderByDesc('start_date')->get()]);
    }

    public function storeYear(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:20', 'unique:academic_years,name'],
            'start_date' => ['required', 'date'],
            'end_date' => ['required', 'date', 'after:start_date'],
        ]);

        $year = AcademicYear::create($validated + ['is_current' => false]);
        $auditLogger->log('CREATE_ACADEMIC_YEAR', 'AcademicYear', $year->id, $validated);

        return response()->json(['data' => $year], 201);
    }

    public function updateYear(Request $request, AcademicYear $academicYear, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:20'],
            'start_date' => ['sometimes', 'date'],
            'end_date' => ['sometimes', 'date', 'after:start_date'],
        ]);

        $academicYear->update($validated);
        $auditLogger->log('UPDATE_ACADEMIC_YEAR', 'AcademicYear', $academicYear->id, $validated);

        return response()->json(['data' => $academicYear->fresh()]);
    }

    public function activateYear(AcademicYear $academicYear, AuditLogger $auditLogger)
    {
        DB::transaction(function () use ($academicYear) {
            AcademicYear::where('id', '!=', $academicYear->id)->update(['is_current' => false]);
            $academicYear->update(['is_current' => true]);
        });

        $auditLogger->log('ACTIVATE_ACADEMIC_YEAR', 'AcademicYear', $academicYear->id);

        return response()->json(['data' => $academicYear->fresh()]);
    }

    public function destroyYear(AcademicYear $academicYear, AuditLogger $auditLogger)
    {
        if ($academicYear->terms()->exists()) {
            return response()->json([
                'error' => ['code' => 'YEAR_HAS_TERMS', 'message' => 'Remove or reassign this year\'s terms before deleting it.'],
            ], 409);
        }

        $academicYear->delete();
        $auditLogger->log('DELETE_ACADEMIC_YEAR', 'AcademicYear', $academicYear->id);

        return response()->json(['data' => ['message' => 'Academic year deleted.']]);
    }

    // -------- Terms --------

    public function indexTerms(Request $request)
    {
        $terms = Term::with('academicYear:id,name')
            ->when($request->query('academic_year_id'), fn ($q, $id) => $q->where('academic_year_id', $id))
            ->orderByDesc('start_date')
            ->get();

        return response()->json(['data' => $terms]);
    }

    public function storeTerm(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'academic_year_id' => ['required', 'exists:academic_years,id'],
            'name' => ['required', 'string', 'max:20'],
            'start_date' => ['required', 'date'],
            'end_date' => ['required', 'date', 'after:start_date'],
        ]);

        $duplicate = Term::where('academic_year_id', $validated['academic_year_id'])
            ->where('name', $validated['name'])->exists();
        if ($duplicate) {
            return response()->json([
                'error' => ['code' => 'DUPLICATE_TERM', 'message' => 'This term already exists for the selected academic year.'],
            ], 409);
        }

        $term = Term::create($validated + ['is_current' => false]);
        $auditLogger->log('CREATE_TERM', 'Term', $term->id, $validated);

        return response()->json(['data' => $term->load('academicYear')], 201);
    }

    public function updateTerm(Request $request, Term $term, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:20'],
            'start_date' => ['sometimes', 'date'],
            'end_date' => ['sometimes', 'date', 'after:start_date'],
        ]);

        $term->update($validated);
        $auditLogger->log('UPDATE_TERM', 'Term', $term->id, $validated);

        return response()->json(['data' => $term->fresh('academicYear')]);
    }

    /**
     * Sets this term as the current one, unsetting every other term —
     * per the requirement to prevent more than one "active" term at a time.
     */
    public function activateTerm(Term $term, AuditLogger $auditLogger)
    {
        DB::transaction(function () use ($term) {
            Term::where('id', '!=', $term->id)->update(['is_current' => false]);
            $term->update(['is_current' => true]);
        });

        $auditLogger->log('ACTIVATE_TERM', 'Term', $term->id);

        return response()->json(['data' => $term->fresh('academicYear')]);
    }

    public function destroyTerm(Term $term, AuditLogger $auditLogger)
    {
        try {
            $term->delete();
        } catch (\Illuminate\Database\QueryException $e) {
            return response()->json([
                'error' => ['code' => 'TERM_IN_USE', 'message' => 'This term has related records (assessments, attendance, etc.) and cannot be deleted.'],
            ], 409);
        }

        $auditLogger->log('DELETE_TERM', 'Term', $term->id);

        return response()->json(['data' => ['message' => 'Term deleted.']]);
    }
}
