<?php

namespace App\Services;

use App\Models\CurriculumRecord;
use App\Models\CurriculumSource;
use App\Models\CurriculumSourceVersion;
use App\Models\Subject;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class CurriculumLibrary
{
    public function installed(): bool
    {
        foreach (['curriculum_sources', 'curriculum_source_versions', 'curriculum_records', 'curriculum_learning_outcomes'] as $table) {
            if (! Schema::hasTable($table)) {
                return false;
            }
        }

        return true;
    }

    public function updateSource(CurriculumSource $source, array $input, AuditLogger $audit): CurriculumSource
    {
        $data = Validator::make($input, [
            'title' => ['required', 'string', 'max:200'], 'official_url' => ['required', 'url:https', 'max:1000'],
            'publisher' => ['required', 'string', 'max:160'], 'grade' => ['required', 'integer', 'between:1,12'],
            'learning_area' => ['required', 'string', 'max:160'], 'subject_id' => ['nullable', 'integer', 'exists:subjects,id'],
        ])->validate();
        $this->subjectMatches($data['subject_id'] ?? null, $data['learning_area']);

        return DB::transaction(function () use ($source, $data, $audit) {
            $source = CurriculumSource::whereKey($source->id)->lockForUpdate()->firstOrFail();
            abort_if($source->versions()->where('approval_status', '!=', 'draft')->exists(), 409, 'Reviewed source metadata is retained. Register a separate source for a different grade or learning area.');
            $source->update(array_replace(['subject_id' => null], $data));
            $audit->log('CORRECT_CURRICULUM_SOURCE', 'CurriculumSource', $source->id);

            return $source;
        });
    }

    public function updateVersion(CurriculumSourceVersion $version, array $input, AuditLogger $audit): CurriculumSourceVersion
    {
        $data = Validator::make($input, [
            'edition' => ['required', 'string', 'max:120'], 'publication_date' => ['nullable', 'date_format:Y-m-d'],
            'document_url' => ['required', 'url:https', 'max:1000'], 'authorization_basis' => ['required', 'string', 'min:20', 'max:2000'],
        ])->validate();

        return DB::transaction(function () use ($version, $data, $audit) {
            CurriculumSource::whereKey($version->curriculum_source_id)->lockForUpdate()->firstOrFail();
            $version = $this->editable($version);
            abort_if($version->source->versions()->where('edition', $data['edition'])->where('id', '!=', $version->id)->exists(), 409, 'Edition already exists.');
            $version->update(array_replace(['publication_date' => null], $data));
            $audit->log('CORRECT_CURRICULUM_VERSION', 'CurriculumSourceVersion', $version->id);

            return $version;
        });
    }

    public function register(array $input, User $actor, AuditLogger $audit): CurriculumSource
    {
        $data = Validator::make($input, [
            'identifier' => ['required', 'string', 'max:120', 'regex:/^[a-z0-9][a-z0-9._-]*$/', 'unique:curriculum_sources,identifier'],
            'title' => ['required', 'string', 'max:200'], 'official_url' => ['required', 'url:https', 'max:1000'],
            'publisher' => ['required', 'string', 'max:160'], 'grade' => ['required', 'integer', 'between:1,12'],
            'learning_area' => ['required', 'string', 'max:160'], 'subject_id' => ['nullable', 'integer', 'exists:subjects,id'],
        ])->validate();
        $this->subjectMatches($data['subject_id'] ?? null, $data['learning_area']);

        return DB::transaction(function () use ($data, $actor, $audit) {
            $source = CurriculumSource::create($data + ['created_by' => $actor->id]);
            $audit->log('REGISTER_CURRICULUM_SOURCE', 'CurriculumSource', $source->id, ['identifier' => $source->identifier]);

            return $source;
        });
    }

    public function addVersion(CurriculumSource $source, array $input, UploadedFile $document, User $actor, AuditLogger $audit): CurriculumSourceVersion
    {
        $data = Validator::make($input + ['document' => $document], [
            'edition' => ['required', 'string', 'max:120'], 'publication_date' => ['nullable', 'date_format:Y-m-d'],
            'document_url' => ['required', 'url:https', 'max:1000'],
            'authorization_basis' => ['required', 'string', 'min:20', 'max:2000'],
            'document' => ['required', 'file', 'mimes:pdf', 'max:20480'],
        ])->validate();
        if (file_get_contents($document->getRealPath(), false, null, 0, 5) !== '%PDF-') {
            throw ValidationException::withMessages(['document' => 'Upload actual PDF document bytes.']);
        }
        unset($data['document']);
        $sha = hash_file('sha256', $document->getRealPath());
        $path = null;
        try {
            return DB::transaction(function () use ($source, $data, $document, $sha, $actor, $audit, &$path) {
                CurriculumSource::whereKey($source->id)->lockForUpdate()->firstOrFail();
                if ($source->versions()->where(fn ($q) => $q->where('edition', $data['edition'])->orWhere('document_sha256', $sha))->exists()) {
                    abort(409, 'This edition or source document has already been registered.');
                }
                $path = $document->store('curriculum/'.$source->id, 'private');
                abort_unless(is_string($path) && $path !== '', 503, 'The private source document could not be stored.');
                $version = $source->versions()->create($data + ['document_sha256' => $sha, 'document_path' => $path,
                    'document_bytes' => $document->getSize(), 'created_by' => $actor->id,
                    'approval_status' => 'draft', 'verification_status' => 'pending']);
                $audit->log('REGISTER_CURRICULUM_VERSION', 'CurriculumSourceVersion', $version->id, ['document_sha256' => $sha]);

                return $version;
            });
        } catch (\Throwable $exception) {
            if ($path) {
                Storage::disk('private')->delete($path);
            }
            throw $exception;
        }
    }

    /** Atomic, administrator-reviewed JSON/manual extraction. Never fetches URLs. */
    public function import(CurriculumSourceVersion $version, array $input, AuditLogger $audit): array
    {
        $data = Validator::make($input, ['records' => ['required', 'array', 'list', 'min:1', 'max:100'], 'records.*' => ['required', 'array']])->validate();
        $records = array_map(fn ($record) => $this->recordData($record), $data['records']);
        $keys = array_column($records, 'record_key');
        if (count(array_unique($keys)) !== count($keys)) {
            throw ValidationException::withMessages(['records' => 'Record keys must be unique within an import.']);
        }

        return DB::transaction(function () use ($version, $records, $keys, $audit) {
            $version = $this->editable($version);
            abort_if($version->records()->whereIn('record_key', $keys)->exists(), 409, 'An imported record key already exists. Use the manual correction endpoint.');
            $created = [];
            foreach ($records as $data) {
                $outcomes = $data['specific_learning_outcomes'];
                unset($data['specific_learning_outcomes']);
                $record = $version->records()->create($data);
                foreach ($outcomes as $index => $text) {
                    $record->outcomes()->create(['position' => $index + 1, 'description' => $text]);
                }
                $created[] = $record->load('outcomes');
            }
            $audit->log('IMPORT_CURRICULUM_RECORDS', 'CurriculumSourceVersion', $version->id, ['count' => count($created)]);

            return $created;
        });
    }

    public function correct(CurriculumSourceVersion $version, CurriculumRecord $record, array $input, AuditLogger $audit): CurriculumRecord
    {
        $data = $this->recordData($input);

        return DB::transaction(function () use ($version, $record, $data, $audit) {
            $version = $this->editable($version);
            abort_unless((int) $record->curriculum_source_version_id === (int) $version->id, 404);
            abort_if($version->records()->where('record_key', $data['record_key'])->where('id', '!=', $record->id)->exists(), 409, 'Record key already exists.');
            $outcomes = $data['specific_learning_outcomes'];
            unset($data['specific_learning_outcomes']);
            $record->update($data);
            foreach ($outcomes as $index => $text) {
                $record->outcomes()->updateOrCreate(['position' => $index + 1], ['description' => $text]);
            }
            $record->outcomes()->where('position', '>', count($outcomes))->delete();
            $audit->log('CORRECT_CURRICULUM_RECORD', 'CurriculumRecord', $record->id);

            return $record->load('outcomes');
        });
    }

    public function approve(CurriculumSourceVersion $version, array $input, User $actor, AuditLogger $audit): CurriculumSourceVersion
    {
        $data = Validator::make($input, [
            'document_sha256' => ['required', 'regex:/^[a-f0-9]{64}$/'], 'content_sha256' => ['required', 'regex:/^[a-f0-9]{64}$/'],
            'actual_document_checked' => ['required', 'accepted'], 'extracted_content_checked' => ['required', 'accepted'],
            'authorized_use_confirmed' => ['required', 'accepted'], 'verification_notes' => ['required', 'string', 'min:20', 'max:4000'],
        ])->validate();

        return DB::transaction(function () use ($version, $data, $actor, $audit) {
            CurriculumSource::whereKey($version->curriculum_source_id)->lockForUpdate()->firstOrFail();
            $version = $this->editable($version);
            abort_unless($version->records()->exists(), 422, 'Import and check curriculum records before approval.');
            $disk = Storage::disk('private');
            abort_unless($disk->exists($version->document_path), 409, 'Source document is missing.');
            $actual = hash_file('sha256', $disk->path($version->document_path));
            abort_unless(hash_equals($version->document_sha256, $actual) && hash_equals($actual, $data['document_sha256']), 409, 'Source document checksum changed.');
            $contentSha = $this->contentChecksum($version);
            abort_unless(hash_equals($contentSha, $data['content_sha256']), 409, 'Curriculum content changed after review. Refresh and review it again.');
            $source = $version->source()->firstOrFail();
            $this->subjectMatches($source->subject_id, $source->learning_area);
            CurriculumSourceVersion::where('curriculum_source_id', $source->id)->where('approval_status', 'approved')->update(['approval_status' => 'superseded']);
            $version->update(['approval_status' => 'approved', 'verification_status' => 'verified', 'content_sha256' => $contentSha,
                'verification_notes' => $data['verification_notes'], 'reviewed_by' => $actor->id, 'reviewed_at' => now()]);
            $audit->log('APPROVE_CURRICULUM_VERSION', 'CurriculumSourceVersion', $version->id, ['document_sha256' => $actual, 'content_sha256' => $contentSha]);

            return $version;
        });
    }

    public function withdraw(CurriculumSourceVersion $version, array $input, User $actor, AuditLogger $audit): CurriculumSourceVersion
    {
        $data = Validator::make($input, ['reason' => ['required', 'string', 'min:20', 'max:2000']])->validate();

        return DB::transaction(function () use ($version, $data, $actor, $audit) {
            CurriculumSource::whereKey($version->curriculum_source_id)->lockForUpdate()->firstOrFail();
            $version = CurriculumSourceVersion::whereKey($version->id)->lockForUpdate()->firstOrFail();
            abort_unless(in_array($version->approval_status, ['approved', 'superseded'], true), 409);
            $version->update(['approval_status' => 'withdrawn', 'verification_status' => 'revoked', 'verification_notes' => $data['reason'], 'reviewed_by' => $actor->id, 'reviewed_at' => now()]);
            $audit->log('WITHDRAW_CURRICULUM_VERSION', 'CurriculumSourceVersion', $version->id);

            return $version;
        });
    }

    public function contentChecksum(CurriculumSourceVersion $version): string
    {
        $records = $version->records()->with('outcomes')->get()->map(fn ($r) => [
            'id' => $r->id, 'record_key' => $r->record_key, 'strand' => $r->strand, 'sub_strand' => $r->sub_strand,
            'specific_learning_outcomes' => $r->outcomes->map->only(['id', 'position', 'description'])->all(),
            'suggested_learning_experiences' => $r->suggested_learning_experiences, 'key_inquiry_questions' => $r->key_inquiry_questions,
            'assessment_approaches' => $r->assessment_approaches, 'page_reference' => $r->page_reference,
        ])->all();

        $source = $version->source()->firstOrFail();

        return hash('sha256', json_encode([
            'source' => $source->only(['id', 'identifier', 'title', 'official_url', 'publisher', 'grade', 'learning_area', 'subject_id']),
            'edition' => $version->only(['edition', 'document_url', 'document_sha256']),
            'publication_date' => $version->publication_date?->toDateString(),
            'records' => $records,
        ], JSON_THROW_ON_ERROR));
    }

    private function editable(CurriculumSourceVersion $version): CurriculumSourceVersion
    {
        $version = CurriculumSourceVersion::whereKey($version->id)->lockForUpdate()->firstOrFail();
        abort_unless($version->approval_status === 'draft' && $version->verification_status === 'pending', 409, 'Reviewed editions are immutable. Register a new source version.');

        return $version;
    }

    private function recordData(array $input): array
    {
        $rules = ['record_key' => ['required', 'string', 'max:80', 'regex:/^[A-Za-z0-9._-]+$/'], 'strand' => ['required', 'string', 'max:200'],
            'sub_strand' => ['required', 'string', 'max:200'], 'page_reference' => ['required', 'string', 'max:200']];
        foreach (['specific_learning_outcomes', 'suggested_learning_experiences', 'key_inquiry_questions', 'assessment_approaches'] as $field) {
            $rules[$field] = [$field === 'specific_learning_outcomes' ? 'required' : 'present', 'array', 'list', $field === 'specific_learning_outcomes' ? 'min:1' : 'min:0', 'max:50'];
            $rules[$field.'.*'] = ['required', 'string', 'max:2000', 'distinct:strict'];
        }
        // Reject unknown extraction columns instead of silently passing private data.
        if (array_diff(array_keys($input), ['record_key', 'strand', 'sub_strand', 'page_reference', 'specific_learning_outcomes', 'suggested_learning_experiences', 'key_inquiry_questions', 'assessment_approaches'])) {
            throw ValidationException::withMessages(['records' => 'Only defined curriculum fields may be imported.']);
        }

        $data = Validator::make($input, $rules)->validate();
        $data['record_key'] = strtolower($data['record_key']);

        return $data;
    }

    private function subjectMatches(?int $subjectId, string $area): void
    {
        if (! $subjectId) {
            return;
        }
        $subject = Subject::findOrFail($subjectId);
        if (! in_array(mb_strtolower(trim($area)), array_map(fn ($value) => mb_strtolower(trim((string) $value)), [$subject->name, $subject->learning_area]), true)) {
            throw ValidationException::withMessages(['subject_id' => 'The subject must match the curriculum learning area.']);
        }
    }
}
