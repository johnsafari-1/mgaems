<?php

namespace App\Services;

use App\Models\ReportCard;
use App\Models\ReportCardRevision;
use Illuminate\Support\Facades\Storage;

class ReportArtifacts
{
    public function download(ReportCard $card, ?ReportCardRevision $revision = null)
    {
        if ($revision) abort_unless((int) $revision->report_card_id === (int) $card->id, 404);
        elseif ($card->revision_number > 0) $revision = $card->revisions()->where('revision_number', $card->revision_number)->firstOrFail();
        $path = $revision ? $revision->artifact_path : $card->file_path;
        $disk = Storage::disk('private');
        if (! $path || ! $disk->exists($path)) return response()->json(['error' => ['code' => 'FILE_NOT_FOUND', 'message' => 'The report card file could not be found.']], 404);
        if ($revision?->artifact_sha256 && ! hash_equals($revision->artifact_sha256, hash('sha256', $disk->get($path)))) {
            return response()->json(['error' => ['code' => 'ARTIFACT_MISMATCH', 'message' => 'The retained report failed its integrity check. Contact school leadership.']], 409);
        }
        return $disk->download($path, 'report-card-'.$card->student_id.'-'.$card->term_id.($revision ? '-r'.$revision->revision_number : '').'.pdf');
    }
}
