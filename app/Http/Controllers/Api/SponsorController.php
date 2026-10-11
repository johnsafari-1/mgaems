<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Sponsor;
use App\Services\AuditLogger;
use App\Services\SponsorshipView;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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
        $filters = $request->validate(SponsorshipView::filters() + ['sponsor_type' => ['sometimes', Rule::in(['individual', 'church', 'ministry', 'ngo', 'foundation', 'general'])]]);
        $sponsors = Sponsor::when($filters['sponsor_type'] ?? null, fn ($q, $t) => $q->where('sponsor_type', $t))
            ->when($filters['search'] ?? null, fn ($q, $s) => $q->whereRaw("name LIKE ? ESCAPE '!'", [SponsorshipView::pattern($s)]))
            ->withCount('sponsorships')
            ->orderBy('name')->orderBy('id');

        return SponsorshipView::listing($sponsors, $request, fn ($sponsor) => SponsorshipView::sponsor($sponsor), $filters);
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

        $sponsor = DB::transaction(function () use ($validated, $auditLogger) {
            $sponsor = Sponsor::create($validated);
            $auditLogger->log('CREATE_SPONSOR', 'Sponsor', $sponsor->id, ['type' => $sponsor->sponsor_type]);
            return $sponsor;
        });

        return response()->json(['data' => SponsorshipView::sponsor($sponsor->loadCount('sponsorships'), true)], 201)->header('Cache-Control', 'private, no-store');
    }

    public function show(Sponsor $sponsor)
    {
        // Linked sponsorships use the paginated /sponsorships?sponsor_id= endpoint.
        return response()->json(['data' => SponsorshipView::sponsor($sponsor->loadCount('sponsorships'), true)])->header('Cache-Control', 'private, no-store');
    }

    public function update(Request $request, Sponsor $sponsor, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'sponsor_type' => ['sometimes', 'required', Rule::in(['individual', 'church', 'ministry', 'ngo', 'foundation', 'general'])],
            'name' => ['sometimes', 'required', 'string', 'max:150'],
            'contact_person' => ['nullable', 'string', 'max:150'],
            'phone' => ['nullable', 'string', 'max:20'],
            'email' => ['nullable', 'email', 'max:150'],
            'address' => ['nullable', 'string'],
            'notes' => ['nullable', 'string'],
        ]);

        $name = $validated['name'] ?? $sponsor->name;
        $type = $validated['sponsor_type'] ?? $sponsor->sponsor_type;
        if (Sponsor::where('name', $name)->where('sponsor_type', $type)->whereKeyNot($sponsor->id)->exists()) {
            return response()->json([
                'error' => ['code' => 'DUPLICATE_SPONSOR', 'message' => 'A sponsor with this name and type already exists.'],
            ], 409);
        }

        $sponsor = DB::transaction(function () use ($sponsor, $validated, $auditLogger) {
            $current = Sponsor::whereKey($sponsor->id)->lockForUpdate()->firstOrFail();
            $current->update($validated);
            $auditLogger->log('UPDATE_SPONSOR', 'Sponsor', $current->id, ['fields' => array_keys($validated)]);
            return $current;
        });

        return response()->json(['data' => SponsorshipView::sponsor($sponsor->loadCount('sponsorships'), true)])->header('Cache-Control', 'private, no-store');
    }
}
