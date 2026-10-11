<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Announcement;
use App\Models\Role;
use App\Services\AuditLogger;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Implements SRS FR-COM-01/03 and UC-COM-01.
 */
class AnnouncementController extends Controller
{
    public function store(Request $request, AuditLogger $auditLogger)
    {
        // There is no persisted class target in this schema. An assignment or
        // client claim cannot make a Teacher's publication safely deliverable.
        if (! in_array($request->user()?->role?->name, [Role::SYSTEM_ADMIN, Role::HEAD_TEACHER,
            Role::DEPUTY_HEAD_TEACHER, Role::SPONSOR_COORDINATOR], true)) {
            $this->deny();
        }

        $validated = $request->validate([
            'title' => ['required', 'string', 'max:200'],
            'body' => ['required', 'string'],
            'audience' => ['required', Rule::in(['school_wide', 'parents', 'sponsors', 'staff'])],
            'class_id' => ['prohibited'],
            'published_by' => ['prohibited'],
            'published_at' => ['prohibited'],
        ]);
        $validated = array_intersect_key($validated, array_flip(['title', 'body', 'audience']));

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
    public function index(Request $request)
    {
        $role = $request->user()->role?->name;
        if ($role === Role::TEACHER
            && ! $request->user()->staff()->where('status', 'active')->where('staff_type', 'teaching')->exists()) {
            $this->deny();
        }

        $roleAudienceMap = [
            'parent_guardian' => 'parents',
            'sponsor' => 'sponsors',
        ];
        $staffRoles = ['system_admin', 'head_teacher', 'deputy_head_teacher', 'sponsor_coordinator', 'teacher'];

        // Legacy "class" rows have no verifiable recipients; never return them.
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

    private function deny(): never
    {
        throw new HttpResponseException(response()->json([
            'error' => ['code' => 'FORBIDDEN', 'message' => 'You do not have permission to access this resource.'],
        ], 403));
    }
}
