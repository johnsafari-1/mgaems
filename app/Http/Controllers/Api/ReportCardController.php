<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Assessment;
use App\Models\ReportCard;
use App\Models\Student;
use App\Services\AuditLogger;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Implements SRS FR-ASM-06/07 and UC-ASM-03.
 *
 * Compiles a student's continuous + end-term assessments for a term into
 * a PDF report card, storing it on the 'private' disk (outside the web
 * root, per SRS FR-AUTH-11) and recording the file path in report_cards.
 */
class ReportCardController extends Controller
{
    public function generate(Request $request, Student $student, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'term_id' => ['required', 'exists:terms,id'],
            'overall_remark' => ['nullable', 'string'],
        ]);

        $assessments = Assessment::with('subject')
            ->where('student_id', $student->id)
            ->where('term_id', $validated['term_id'])
            ->get();

        if ($assessments->isEmpty()) {
            return response()->json([
                'error' => ['code' => 'NO_ASSESSMENT_DATA', 'message' => 'No assessment records exist for this student and term yet.'],
            ], 422);
        }

        // Compile one row per subject, combining continuous + end_term entries.
        $subjectRows = $assessments->groupBy('subject_id')->map(function ($rows) {
            $ca = $rows->firstWhere('assessment_type', 'continuous');
            $exam = $rows->firstWhere('assessment_type', 'end_term');
            $latest = $rows->sortByDesc('recorded_at')->first();

            return [
                'subject' => $latest->subject->name,
                'ca_score' => $ca->score ?? null,
                'exam_score' => $exam->score ?? null,
                'competency_rating' => $latest->competency_rating,
                'remarks' => $latest->remarks,
            ];
        })->values();

        $term = \App\Models\Term::with('academicYear')->findOrFail($validated['term_id']);
        $student->load('schoolClass');

        $pdf = Pdf::loadView('reports.report-card', [
            'student' => $student,
            'term' => $term,
            'subjectRows' => $subjectRows,
            'overallRemark' => $validated['overall_remark'] ?? null,
        ]);

        $filename = "report-cards/{$student->id}-{$term->id}.pdf";
        Storage::disk('private')->put($filename, $pdf->output());

        $reportCard = ReportCard::updateOrCreate(
            ['student_id' => $student->id, 'term_id' => $term->id],
            [
                'overall_remark' => $validated['overall_remark'] ?? null,
                'file_path' => $filename,
                'generated_at' => now(),
                'generated_by' => auth()->id(),
            ]
        );

        $auditLogger->log('GENERATE_REPORT_CARD', 'ReportCard', $reportCard->id, ['student_id' => $student->id, 'term_id' => $term->id]);

        return response()->json(['data' => $reportCard], 201);
    }

    public function show(ReportCard $reportCard)
    {
        return response()->json(['data' => $reportCard->load('student:id,first_name,last_name,admission_no', 'term:id,name')]);
    }

    /**
     * Streams the actual PDF file for download.
     */
    public function download(ReportCard $reportCard)
    {
        if (! $reportCard->file_path || ! Storage::disk('private')->exists($reportCard->file_path)) {
            return response()->json([
                'error' => ['code' => 'FILE_NOT_FOUND', 'message' => 'The report card file could not be found.'],
            ], 404);
        }

        return Storage::disk('private')->download($reportCard->file_path, "report-card-{$reportCard->student_id}-{$reportCard->term_id}.pdf");
    }
}
