<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceStudent;
use App\Models\ReportCard;
use App\Models\Sponsor;
use App\Models\Sponsorship;
use App\Services\AuditLogger;
use Illuminate\Support\Facades\DB;

/**
 * Implements SRS FR-SPP-01..06 and UC-SPP-01. Same "re-verify ownership
 * on every request" pattern as ParentPortalController — a sponsor may
 * only ever see the learner(s)/program(s) they actually sponsor.
 */
class SponsorPortalController extends Controller
{
    public function mySponsorships()
    {
        $sponsor = Sponsor::where('user_id', auth()->id())->first();

        if (! $sponsor) {
            return response()->json(['data' => []]);
        }

        $sponsorships = Sponsorship::where('sponsor_id', $sponsor->id)
            ->with('student:id,first_name,last_name,admission_no')
            ->get();

        return response()->json(['data' => $sponsorships]);
    }

    public function sponsorshipAttendance(Sponsorship $sponsorship, AuditLogger $auditLogger)
    {
        if (! $this->isOwnSponsorship($sponsorship) || ! $sponsorship->student_id) {
            $auditLogger->log('PORTAL_ACCESS_DENIED', 'Sponsorship', $sponsorship->id, ['reason' => 'not_own_sponsorship']);

            return $this->forbidden();
        }

        $counts = AttendanceStudent::where('student_id', $sponsorship->student_id)
            ->select('status', DB::raw('count(*) as total'))
            ->groupBy('status')
            ->pluck('total', 'status');

        return response()->json([
            'data' => [
                'counts' => [
                    'present' => $counts->get('present', 0),
                    'absent' => $counts->get('absent', 0),
                    'late' => $counts->get('late', 0),
                    'excused' => $counts->get('excused', 0),
                ],
            ],
        ]);
    }

    public function sponsorshipReportCards(Sponsorship $sponsorship, AuditLogger $auditLogger)
    {
        if (! $this->isOwnSponsorship($sponsorship) || ! $sponsorship->student_id) {
            $auditLogger->log('PORTAL_ACCESS_DENIED', 'Sponsorship', $sponsorship->id, ['reason' => 'not_own_sponsorship']);

            return $this->forbidden();
        }

        $reportCards = ReportCard::where('student_id', $sponsorship->student_id)->with('term')->get();

        return response()->json(['data' => $reportCards]);
    }

    /**
     * FR-SPP-04: teacher comments — surfaced via assessment remarks,
     * since a dedicated comments/messaging thread doesn't exist yet.
     */
    public function sponsorshipComments(Sponsorship $sponsorship, AuditLogger $auditLogger)
    {
        if (! $this->isOwnSponsorship($sponsorship) || ! $sponsorship->student_id) {
            $auditLogger->log('PORTAL_ACCESS_DENIED', 'Sponsorship', $sponsorship->id, ['reason' => 'not_own_sponsorship']);

            return $this->forbidden();
        }

        $comments = \App\Models\Assessment::where('student_id', $sponsorship->student_id)
            ->whereNotNull('remarks')
            ->with('subject:id,name', 'term:id,name')
            ->orderByDesc('recorded_at')
            ->get(['id', 'subject_id', 'term_id', 'remarks', 'recorded_at']);

        return response()->json(['data' => $comments]);
    }

    private function isOwnSponsorship(Sponsorship $sponsorship): bool
    {
        $sponsor = Sponsor::where('user_id', auth()->id())->first();

        return $sponsor && $sponsorship->sponsor_id === $sponsor->id;
    }

    private function forbidden()
    {
        return response()->json([
            'error' => ['code' => 'FORBIDDEN', 'message' => 'This sponsorship is not linked to your account.'],
        ], 403);
    }
}
