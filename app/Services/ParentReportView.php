<?php

namespace App\Services;

use App\Models\ReportCard;
use Illuminate\Support\Facades\Storage;

/** Family reads use existing published artifacts, never mutable assessment drafts. */
class ParentReportView
{
    public function publication(ReportCard $card): ?array
    {
        $revision = $card->revision_number > 0
            ? $card->revisions()->where('revision_number', $card->revision_number)->first() : null;
        if ($card->revision_number > 0 && ! $revision) return null;
        $legacy = ! $revision || $revision->provenance === 'legacy_artifact';
        if ($revision && ! in_array($revision->provenance, ['captured', 'legacy_artifact'], true)) return null;
        if (! $legacy && (! is_array($revision->input_snapshot) || ! preg_match('/^[a-f0-9]{64}$/', $revision->artifact_sha256 ?? ''))) return null;
        $date = $revision ? $revision->generated_at : $card->generated_at;
        $path = $revision ? $revision->artifact_path : $card->file_path;
        if (! $date || ! $path) return null;
        $disk = Storage::disk('private');
        $available = $disk->exists($path);
        if ($available && $revision?->artifact_sha256) {
            $available = hash_equals($revision->artifact_sha256, hash('sha256', $disk->get($path)));
        }
        return ['snapshot' => $legacy ? null : $revision->input_snapshot, 'date' => $date, 'available' => $available, 'legacy' => $legacy];
    }

    public function summary(ReportCard $card, array $publication): array
    {
        $snapshot = $publication['snapshot'];
        return ['id' => $card->id,
            'term' => $card->term ? ['id' => $card->term_id, 'name' => $snapshot['term']['name'] ?? $card->term->name] : null,
            'overall_remark' => is_array($snapshot) ? ($snapshot['overall_remark'] ?? null)
                : ($publication['legacy'] ? $card->overall_remark : null),
            'generated_date' => $publication['date']->toDateString(), 'download_available' => $publication['available']];
    }

    public function progress(ReportCard $card, array $publication): array
    {
        if (! $publication['available'] || ! is_array($publication['snapshot'])) return [];
        $snapshot = $publication['snapshot']; $results = [];
        foreach (is_array($snapshot['subject_rows'] ?? null) ? $snapshot['subject_rows'] : [] as $subjects) {
            foreach (['continuous', 'end_term'] as $type) {
                $row = $subjects[$type] ?? null;
                if (! is_array($row)) continue;
                $results[] = ['subject' => $row['subject'] ?? null, 'term' => $snapshot['term']['name'] ?? null,
                    'academic_year' => $snapshot['term']['academic_year'] ?? null, 'assessment_type' => $type,
                    'score' => $row['score'] ?? null, 'competency_rating' => $row['performance_level'] ?? null,
                    'remarks' => $row['remarks'] ?? null, 'recorded_date' => null,
                    'published_date' => $publication['date']->toDateString(), 'report_card_id' => $card->id];
            }
        }
        return $results;
    }
}
