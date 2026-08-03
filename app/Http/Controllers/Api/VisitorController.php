<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Visitor;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Implements SRS FR-VIS-01/02/03/04 and UC-VIS-01.
 */
class VisitorController extends Controller
{
    public function index(Request $request)
    {
        $visitors = Visitor::with('hostStaff:id,first_name,last_name')
            ->when($request->query('visitor_type'), fn ($q, $t) => $q->where('visitor_type', $t))
            ->when($request->query('from'), fn ($q, $d) => $q->whereDate('visit_date', '>=', $d))
            ->when($request->query('to'), fn ($q, $d) => $q->whereDate('visit_date', '<=', $d))
            ->orderByDesc('visit_date')
            ->get();

        return response()->json(['data' => $visitors]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'host_staff_id' => ['required', 'exists:staff,id'],
            'visitor_name' => ['required', 'string', 'max:150'],
            'visitor_type' => ['required', Rule::in(['visitor', 'church_team', 'mission_group', 'volunteer', 'donor'])],
            'purpose' => ['nullable', 'string', 'max:255'],
            'visit_date' => ['required', 'date'],
            'notes' => ['nullable', 'string'],
        ]);

        $visitor = Visitor::create($validated);
        $auditLogger->log('RECORD_VISITOR', 'Visitor', $visitor->id, ['visitor_name' => $visitor->visitor_name]);

        return response()->json(['data' => $visitor->load('hostStaff')], 201);
    }
}
