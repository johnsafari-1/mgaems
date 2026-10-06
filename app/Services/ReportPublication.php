<?php

namespace App\Services;

use App\Models\Assessment;
use App\Models\ReportCard;
use App\Models\ReportCardRevision;
use App\Models\SchoolSetting;
use App\Models\Student;
use App\Models\Term;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ReportPublication
{
    public const TEMPLATE = 'mgaems-term-report-v2';

    public function publish(int $studentId, int $termId, ?string $remark, $user, AuditLogger $audit): ReportCard
    {
        $attempted = []; $published = null;
        try {
            $card = DB::transaction(function () use ($studentId, $termId, $remark, $user, $audit, &$attempted, &$published) {
                $actor = (new AssessmentAccess())->leadership($user, true);
                // Same learner lock as assessment writes: source revisions and
                // publication numbering cannot race with a correction/generation.
                $student = Student::whereKey($studentId)->lockForUpdate()->firstOrFail();
                $term = Term::with('academicYear')->findOrFail($termId);
                $assessments = Assessment::with('subject:id,name,code')->where('student_id', $studentId)->where('term_id', $termId)
                    ->orderBy('subject_id')->orderBy('assessment_type')->orderBy('id')->lockForUpdate()->get()
                    ->filter(fn ($row) => $row->score !== null || $row->competency_rating !== null || trim($row->remarks ?? '') !== '');
                if ($assessments->isEmpty()) throw ValidationException::withMessages(['term_id' => 'No meaningful assessment data exists for this learner and term.']);
                $card = ReportCard::where('student_id', $studentId)->where('term_id', $termId)->lockForUpdate()->first();
                if (! $card) $card = ReportCard::create(['student_id' => $studentId, 'term_id' => $termId, 'revision_number' => 0]);
                $this->retainLegacy($card);
                $history = new AssessmentHistory(); $manifest = []; $rows = [];
                foreach ($assessments as $assessment) {
                    $history->baseline($assessment, $audit);
                    $revision = $assessment->revisions()->where('revision_number', $assessment->revision_number)->firstOrFail();
                    $snapshot = $revision->context_snapshot;
                    $rows[$assessment->subject_id][$assessment->assessment_type] = [
                        'subject' => $snapshot['subject']['name'] ?? $assessment->subject?->name,
                        'class' => $snapshot['class']['name'] ?? 'Legacy class unknown',
                        'score' => $revision->score, 'performance_level' => $revision->competency_rating, 'remarks' => $revision->remarks,
                        'context_state' => $snapshot ? 'captured' : 'legacy_unresolved', 'context_snapshot' => $snapshot,
                    ];
                    $manifest[] = ['assessment_id' => $assessment->id, 'assessment_revision_id' => $revision->id,
                        'revision_number' => $revision->revision_number, 'provenance' => $snapshot ? 'captured' : 'legacy_unresolved'];
                }
                $generatedAt = now()->startOfSecond();
                $number = (int) $card->revision_number + 1;
                $input = [
                    'school' => $this->schoolIdentity(), 'student' => $student->only(['first_name', 'last_name', 'admission_no']),
                    'term' => ['name' => $term->name, 'academic_year' => $term->academicYear?->name],
                    'subject_rows' => array_values($rows), 'overall_remark' => $remark, 'generated_at' => $generatedAt->toISOString(),
                    'compilation_rule' => 'continuous_and_end_term_separate',
                    'revision_number' => $number,
                ];
                $bytes = $this->render($input);
                $disk = Storage::disk('private');
                do { $path = 'report-cards/revisions/'.$studentId.'-'.$termId.'-'.Str::uuid().'.pdf'; } while ($disk->exists($path));
                $attempted[] = $path;
                $hash = hash('sha256', $bytes);
                if (! $disk->put($path, $bytes) || ! $disk->exists($path) || ! hash_equals($hash, hash('sha256', $disk->get($path)))) {
                    throw new HttpResponseException(response()->json(['error' => ['code' => 'REPORT_STORAGE_FAILED', 'message' => 'Report storage could not be verified. No report revision was published.']], 503));
                }
                ReportCardRevision::create([
                    'report_card_id' => $card->id, 'revision_number' => $number, 'generated_at' => $generatedAt, 'generated_by' => $actor->id,
                    'artifact_path' => $path, 'artifact_sha256' => $hash, 'artifact_size' => strlen($bytes),
                    'input_snapshot' => $input, 'source_manifest' => $manifest, 'template_version' => self::TEMPLATE,
                    'provenance' => 'captured', 'created_at' => now(),
                ]);
                $card->update(['revision_number' => $number, 'file_path' => $path, 'overall_remark' => $remark, 'generated_at' => $generatedAt, 'generated_by' => $actor->id]);
                $audit->log('GENERATE_REPORT_CARD', 'ReportCard', $card->id, ['revision_number' => $number, 'source_count' => count($manifest), 'template_version' => self::TEMPLATE]);
                $published = $path;
                return $card;
            }); // No automatic file-producing retries; callers may retry safely.
        } catch (\Throwable $exception) {
            $this->cleanup($attempted);
            if ($exception instanceof ValidationException || $exception instanceof HttpResponseException || $exception instanceof \Symfony\Component\HttpKernel\Exception\HttpException) throw $exception;
            report($exception);
            throw new HttpResponseException(response()->json(['error' => ['code' => 'REPORT_PUBLICATION_FAILED', 'message' => 'The report could not be published. Previous valid reports remain retained.']], 503));
        }
        $this->cleanup(array_diff($attempted, [$published]));
        return $card;
    }

    protected function render(array $input): string
    {
        return Pdf::loadView('reports.report-card', ['input' => $input])->output();
    }

    private function retainLegacy(ReportCard $card): void
    {
        if ($card->revision_number > 0 || (! $card->file_path && ! $card->generated_at)) return;
        $disk = Storage::disk('private');
        $bytes = $card->file_path && $disk->exists($card->file_path) ? $disk->get($card->file_path) : null;
        ReportCardRevision::create([
            'report_card_id' => $card->id, 'revision_number' => 1, 'generated_at' => $card->generated_at, 'generated_by' => $card->generated_by,
            'artifact_path' => $card->file_path, 'artifact_sha256' => $bytes === null ? null : hash('sha256', $bytes),
            'artifact_size' => $bytes === null ? null : strlen($bytes), 'input_snapshot' => null, 'source_manifest' => null,
            'template_version' => null, 'provenance' => 'legacy_artifact', 'created_at' => now(),
        ]);
        $card->update(['revision_number' => 1]);
    }

    private function schoolIdentity(): array
    {
        $settings = SchoolSetting::firstOrFail();
        $identity = ['name' => $settings->school_name, 'motto' => $settings->motto, 'logo_data_uri' => null];
        // Embed only a bounded local raster image from the existing upload area.
        // No external URL fetches, path traversal, or mutable logo references.
        if ($settings->logo_path && preg_match('~^school/[A-Za-z0-9._-]+\.(png|jpe?g)$~i', $settings->logo_path)) {
            $disk = Storage::disk('public');
            if ($disk->exists($settings->logo_path) && $disk->size($settings->logo_path) <= 262144) {
                $bytes = $disk->get($settings->logo_path); $info = @getimagesizefromstring($bytes);
                if ($info && $info[0] <= 2048 && $info[1] <= 2048 && in_array($info['mime'], ['image/png', 'image/jpeg'], true)) $identity['logo_data_uri'] = 'data:'.$info['mime'].';base64,'.base64_encode($bytes);
            }
        }
        return $identity;
    }

    private function cleanup(array $paths): void
    {
        foreach ($paths as $path) {
            try { Storage::disk('private')->delete($path); }
            catch (\Throwable $exception) { report($exception); } // Only this attempt's UUID files, never retained artifacts.
        }
    }
}
