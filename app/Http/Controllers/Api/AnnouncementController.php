<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Announcement;
use App\Services\AuditLogger;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Implements SRS FR-COM-01/03 and UC-COM-01.
 */
class AnnouncementController extends Controller
{
    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:200'],
            'body' => ['required', 'string'],
            'audience' => ['required', Rule::in(['school_wide', 'class', 'parents', 'sponsors', 'staff'])],
        ]);

        $announcement = Announcement::create($validated + [
            'published_by' => auth()->id(),
            'published_at' => now(),
        ]);

        // FR-COM-03: email notifications — deferred to a follow-up increment
        // that wires this into a queued Mailable per recipient audience,
        // reusing the same Mail pattern as PasswordResetMail.

        $auditLogger->log('PUBLISH_ANNOUNCEMENT', 'Announcement', $announcement->id, ['audience' => $announcement->audience]);

        return response()->json(['data' => $announcement], 201);
    }

    /**
     * Returns school-wide announcements plus whichever audience category
     * maps to the viewer's own role.
     */
    public function index()
    {
        $role = auth()->user()->role?->name;

        $roleAudienceMap = [
            'parent_guardian' => 'parents',
            'sponsor' => 'sponsors',
        ];
        $staffRoles = ['system_admin', 'head_teacher', 'deputy_head_teacher', 'sponsor_coordinator', 'teacher'];

        $audiences = ['school_wide'];
        if (isset($roleAudienceMap[$role])) {
            $audiences[] = $roleAudienceMap[$role];
        } elseif (in_array($role, $staffRoles, true)) {
            $audiences[] = 'staff';
        }

        $announcements = Announcement::whereIn('audience', $audiences)
            ->orderByDesc('published_at')
            ->get();

        return response()->json(['data' => $announcements]);
    }
}
