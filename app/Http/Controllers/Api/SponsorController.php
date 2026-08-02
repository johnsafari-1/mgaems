<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Sponsor;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Implements SRS FR-SPN-01/06 and UC-SPN-01.
 * Access restricted to Sponsor Coordinator and System Administrator per
 * the User Role Matrix (Head Teacher/Deputy get read-only, wired in routes).
 */
class SponsorController extends Controller
{
    public function index(Request $request)
    {
        $sponsors = Sponsor::when($request->query('sponsor_type'), fn ($q, $t) => $q->where('sponsor_type', $t))
            ->when($request->query('search'), fn ($q, $s) => $q->where('name', 'like', "%{$s}%"))
            ->withCount('sponsorships')
            ->orderBy('name')
            ->get();

        return response()->json(['data' => $sponsors]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'sponsor_type' => ['required', Rule::in(['individual', 'church', 'ministry', 'ngo', 'foundation', 'general'])],
            'name' => ['required', 'string', 'max:150'],
            'contact_person' => ['nullable', 'string', 'max:150'],
            'phone' => ['nullable', 'string', 'max:20'],
            'email' => ['nullable', 'email', 'max:150'],
            'address' => ['nullable', 'string'],
            'notes' => ['nullable', 'string'],
        ]);

        $duplicate = Sponsor::where('name', $validated['name'])->where('sponsor_type', $validated['sponsor_type'])->exists();
        if ($duplicate) {
            return response()->json([
                'error' => ['code' => 'DUPLICATE_SPONSOR', 'message' => 'A sponsor with this name and type already exists. Please verify before creating a duplicate.'],
            ], 409);
        }

        $sponsor = Sponsor::create($validated);
        $auditLogger->log('CREATE_SPONSOR', 'Sponsor', $sponsor->id, ['name' => $sponsor->name]);

        return response()->json(['data' => $sponsor], 201);
    }

    public function show(Sponsor $sponsor)
    {
        return response()->json(['data' => $sponsor->load('sponsorships.student:id,first_name,last_name,admission_no')]);
    }

    public function update(Request $request, Sponsor $sponsor, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'sponsor_type' => ['sometimes', Rule::in(['individual', 'church', 'ministry', 'ngo', 'foundation', 'general'])],
            'name' => ['sometimes', 'string', 'max:150'],
            'contact_person' => ['nullable', 'string', 'max:150'],
            'phone' => ['nullable', 'string', 'max:20'],
            'email' => ['nullable', 'email', 'max:150'],
            'address' => ['nullable', 'string'],
            'notes' => ['nullable', 'string'],
        ]);

        $sponsor->update($validated);
        $auditLogger->log('UPDATE_SPONSOR', 'Sponsor', $sponsor->id, $validated);

        return response()->json(['data' => $sponsor->fresh()]);
    }
}
