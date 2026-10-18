<?php

namespace App\Services;

use App\Models\CurriculumRecord;
use App\Models\Subject;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class CurriculumRetrieval
{
    public function __construct(private CurriculumLibrary $library) {}

    public function retrieve(array $input): array
    {
        $allowed = ['grade', 'learning_area', 'subject_id', 'strand', 'sub_strand', 'topic', 'source_version_id', 'record_ids'];
        if (array_diff(array_keys($input), $allowed)) {
            throw ValidationException::withMessages(['context' => 'Only curriculum selection fields are allowed.']);
        }
        $data = Validator::make($input, [
            'grade' => ['required', 'integer', 'between:1,12'], 'learning_area' => ['required', 'string', 'max:160'],
            'subject_id' => ['nullable', 'integer', 'exists:subjects,id'],
            'strand' => ['sometimes', 'string', 'max:200'], 'sub_strand' => ['sometimes', 'string', 'max:200'],
            'topic' => ['nullable', 'string', 'max:120'], 'source_version_id' => ['nullable', 'integer', 'min:1'],
            'record_ids' => ['sometimes', 'array', 'list', 'min:1', 'max:20'], 'record_ids.*' => ['required', 'integer', 'min:1', 'distinct'],
        ])->validate();
        $selection = ['grade' => (int) $data['grade'], 'learning_area' => trim($data['learning_area']), 'subject_id' => $data['subject_id'] ?? null];
        if (! $this->library->installed()) {
            return $this->unavailable($selection, 'CURRICULUM_LIBRARY_NOT_INSTALLED');
        }
        if (! empty($data['subject_id'])) {
            $subject = Subject::findOrFail($data['subject_id']);
            if (! in_array($this->normal($data['learning_area']), [$this->normal($subject->name), $this->normal($subject->learning_area ?? '')], true)) {
                throw ValidationException::withMessages(['subject_id' => 'Subject and learning area do not match.']);
            }
        }
        $query = CurriculumRecord::with(['outcomes', 'version.source'])->whereHas('version', function ($q) use ($data) {
            $q->where('approval_status', 'approved')->where('verification_status', 'verified')
                ->when($data['source_version_id'] ?? null, fn ($q, $id) => $q->whereKey($id))
                ->whereHas('source', function ($q) use ($data) {
                    $q->where('grade', (int) $data['grade'])->whereRaw('LOWER(learning_area) = ?', [$this->normal($data['learning_area'])]);
                    if (! empty($data['subject_id'])) {
                        $q->where('subject_id', $data['subject_id']);
                    }
                });
        });
        if (isset($data['record_ids'])) {
            $query->whereIn('id', $data['record_ids']);
        }
        foreach (['strand', 'sub_strand'] as $field) {
            if (isset($data[$field])) {
                $query->whereRaw('LOWER('.$field.') = ?', [$this->normal($data[$field])]);
            }
        }
        if (! empty($data['topic'])) {
            // Literal substring matching, not SQL wildcard interpretation.
            $topic = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $data['topic']).'%';
            $query->where(fn ($q) => $q->whereRaw("sub_strand LIKE ? ESCAPE '!'", [$topic])
                ->orWhereHas('outcomes', fn ($q) => $q->whereRaw("description LIKE ? ESCAPE '!'", [$topic])));
        }
        $records = $query->orderBy('curriculum_source_version_id')->orderBy('record_key')->orderBy('id')->limit(21)->get();
        if ($records->isEmpty()) {
            return $this->unavailable($selection, 'NO_VERIFIED_CURRICULUM');
        }
        if ($records->count() > 20) {
            return $this->unavailable($selection, 'SELECTION_TOO_BROAD');
        }
        if (isset($data['record_ids']) && $records->count() !== count($data['record_ids'])) {
            return $this->unavailable($selection, 'CURRICULUM_SELECTION_MISMATCH');
        }
        foreach ($records->pluck('version')->unique('id') as $version) {
            $disk = Storage::disk('private');
            if (! $version->content_sha256 || ! hash_equals($version->content_sha256, $this->library->contentChecksum($version))
                || ! $disk->exists($version->document_path) || ! hash_equals($version->document_sha256, hash_file('sha256', $disk->path($version->document_path)))) {
                return $this->unavailable($selection, 'CURRICULUM_INTEGRITY_FAILED');
            }
        }

        return ['available' => true, 'selection' => $selection, 'records' => $records->map(fn ($record) => $this->reference($record))->all()];
    }

    private function reference(CurriculumRecord $record): array
    {
        $version = $record->version;
        $source = $version->source;

        return ['record_id' => $record->id, 'record_key' => $record->record_key, 'grade' => $source->grade, 'learning_area' => $source->learning_area,
            'strand' => $record->strand, 'sub_strand' => $record->sub_strand,
            'specific_learning_outcomes' => $record->outcomes->map(fn ($o) => ['id' => $o->id, 'text' => $o->description])->all(),
            'suggested_learning_experiences' => $record->suggested_learning_experiences, 'key_inquiry_questions' => $record->key_inquiry_questions,
            'assessment_approaches' => $record->assessment_approaches,
            'source' => ['id' => $source->id, 'identifier' => $source->identifier, 'title' => $source->title, 'publisher' => $source->publisher,
                'official_url' => $source->official_url, 'version_id' => $version->id, 'edition' => $version->edition,
                'publication_date' => $version->publication_date?->toDateString(), 'document_url' => $version->document_url,
                'document_sha256' => $version->document_sha256, 'content_sha256' => $version->content_sha256,
                'page_reference' => $record->page_reference, 'approval_status' => $version->approval_status, 'verification_status' => $version->verification_status]];
    }

    private function unavailable(array $selection, string $reason): array
    {
        return ['available' => false, 'reason' => $reason, 'selection' => $selection, 'records' => []];
    }

    private function normal(string $value): string
    {
        return mb_strtolower(trim($value));
    }
}
