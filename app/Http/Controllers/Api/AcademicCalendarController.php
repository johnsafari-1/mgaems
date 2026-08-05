<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AcademicYear;
use App\Models\Term;
use App\Services\AuditLogger;
use Illuminate\Http\Request;

/**
 * Implements SRS FR-ACAD-01. Read endpoints for academic years/terms so
 * the frontend can populate selectors (e.g. for promotions/transfers).
 * Write endpoints (create/edit years & terms) land with the full
 * Academic Structure frontend module.
 */
class AcademicCalendarController extends Controller
{
    public function indexYears()
    {
        return response()->json(['data' => AcademicYear::orderByDesc('start_date')->get()]);
    }

    public function indexTerms(Request $request)
    {
        $terms = Term::with('academicYear:id,name')
            ->when($request->query('academic_year_id'), fn ($q, $id) => $q->where('academic_year_id', $id))
            ->orderByDesc('start_date')
            ->get();

        return response()->json(['data' => $terms]);
    }
}
