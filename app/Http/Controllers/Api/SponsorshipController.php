<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Sponsorship;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Implements SRS FR-SPN-02/03/04/05/07/08 and UC-SPN-02/03/04.
 * Supports individual, group, and school-wide sponsorship — deliberately
 * has no fee/billing/payment fields, per BRD §5.2.
 */
class SponsorshipController extends Controller
{
    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'sponsor_id' => ['required', 'exists:sponsors,id'],
            'sponsorship_type' => ['required', Rule::in(['individual', 'group', 'school_wide'])],
            'student_id' => ['required_if:sponsorship_type,individual', 'nullable', 'exists:students,id'],
            'program_name' => ['required_if:sponsorship_type,school_wide', 'nullable', 'string', 'max:150'],
            'start_date' => ['required', 'date'],
            'notes' => ['nullable', 'string'],
        ]);

        if ($validated['sponsorship_type'] === 'individual' && ! empty($validated['student_id'])) {
            $alreadySponsored = Sponsorship::where('student_id', $validated['student_id'])
                ->where('sponsorship_type', 'individual')
                ->where('status', 'active')
                ->exists();

            if ($alreadySponsored) {
                return response()->json([
                    'error' => ['code' => 'ALREADY_SPONSORED', 'message' => 'This learner already has an active individual sponsorship. Confirm before adding another.'],
                ], 409);
            }
        }

        $sponsorship = Sponsorship::create($validated + [
            'status' => 'active',
            'created_by' => auth()->id(),
        ]);

        $auditLogger->log('CREATE_SPONSORSHIP', 'Sponsorship', $sponsorship->id, $validated);

        return response()->json(['data' => $sponsorship->load('sponsor', 'student')], 201);
    }

    public function update(Request $request, Sponsorship $sponsorship, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'status' => ['sometimes', Rule::in(['active', 'ended', 'paused'])],
            'end_date' => ['nullable', 'date'],
            'notes' => ['sometimes', 'string'],
        ]);

        // UC-SPN-03 alt flow: ending a sponsorship without a reason is blocked.
        if (($validated['status'] ?? null) === 'ended' && empty($validated['notes']) && empty($sponsorship->notes)) {
            return response()->json([
                'error' => ['code' => 'REASON_REQUIRED', 'message' => 'Please provide a reason (notes) before ending this sponsorship.'],
            ], 422);
        }

        $sponsorship->update($validated);
        $auditLogger->log('UPDATE_SPONSORSHIP', 'Sponsorship', $sponsorship->id, $validated);

        return response()->json(['data' => $sponsorship->fresh(['sponsor', 'student'])]);
    }

    public function index(Request $request)
    {
        $sponsorships = Sponsorship::with(['sponsor:id,name,sponsor_type', 'student:id,first_name,last_name,admission_no'])
            ->when($request->query('sponsor_id'), fn ($q, $id) => $q->where('sponsor_id', $id))
            ->when($request->query('student_id'), fn ($q, $id) => $q->where('student_id', $id))
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->orderByDesc('start_date')
            ->get();

        return response()->json(['data' => $sponsorships]);
    }
}
