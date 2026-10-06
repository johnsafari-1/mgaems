<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\ReportCardResource;
use App\Models\ReportCard;
use App\Models\ReportCardRevision;
use App\Models\Student;
use App\Services\AssessmentAccess;
use App\Services\AuditLogger;
use App\Services\ReportArtifacts;
use App\Services\ReportPublication;
use Illuminate\Http\Request;

class ReportCardController extends Controller
{
    public function index(Request $request)
    {
        (new AssessmentAccess())->leadership($request->user());
        $validated = $request->validate(['student_id' => ['required', 'integer', 'exists:students,id'], 'term_id' => ['required', 'integer', 'exists:terms,id']]);
        $card = ReportCard::with('student:id,first_name,last_name,admission_no', 'term:id,name')->where($validated)->first();
        return response()->json(['data' => $card ? (new ReportCardResource($card))->resolve($request) : null]);
    }

    public function generate(Request $request, Student $student, AuditLogger $auditLogger, ReportPublication $publication)
    {
        (new AssessmentAccess())->leadership($request->user());
        $validated = $request->validate(['term_id' => ['required', 'integer', 'exists:terms,id'], 'overall_remark' => ['sometimes', 'nullable', 'string', 'max:4000']]);
        $card = $publication->publish($student->id, (int) $validated['term_id'], trim($validated['overall_remark'] ?? '') ?: null, $request->user(), $auditLogger);
        return response()->json(['data' => (new ReportCardResource($card))->resolve($request)], 201);
    }

    public function show(Request $request, ReportCard $reportCard)
    {
        (new AssessmentAccess())->leadership($request->user());
        return response()->json(['data' => (new ReportCardResource($reportCard->load('student:id,first_name,last_name,admission_no', 'term:id,name')))->resolve($request)]);
    }

    public function download(Request $request, ReportCard $reportCard)
    {
        (new AssessmentAccess())->leadership($request->user());
        return (new ReportArtifacts())->download($reportCard);
    }

    public function revisions(Request $request, ReportCard $reportCard)
    {
        (new AssessmentAccess())->leadership($request->user());
        $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);
        $rows = $reportCard->revisions()->orderByDesc('revision_number')->paginate(25);
        return response()->json(['data' => $rows->getCollection()->map(fn ($row) => [
            'id' => $row->id, 'revision_number' => $row->revision_number, 'generated_at' => $row->generated_at?->toISOString(),
            'provenance' => $row->provenance, 'download_available' => $row->artifact_path && \Illuminate\Support\Facades\Storage::disk('private')->exists($row->artifact_path),
            'source_count' => $row->source_manifest === null ? null : count($row->source_manifest),
        ]), 'meta' => ['page' => $rows->currentPage(), 'per_page' => 25, 'total' => $rows->total()]]);
    }

    public function downloadRevision(Request $request, ReportCard $reportCard, ReportCardRevision $revision)
    {
        (new AssessmentAccess())->leadership($request->user());
        return (new ReportArtifacts())->download($reportCard, $revision);
    }
}
