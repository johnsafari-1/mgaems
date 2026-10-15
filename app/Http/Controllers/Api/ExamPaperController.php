<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClassSubjectTeacher;
use App\Models\ExamPaper;
use App\Models\ExamPaperAttachment;
use App\Models\ExamPaperQuestion;
use App\Models\ExamPaperRevision;
use App\Models\ExamPaperSection;
use App\Models\Term;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\ExamPaperExport;
use App\Services\TeachingDocumentAccess;
use App\Services\TeachingDocumentData;
use Barryvdh\DomPDF\Facade\Pdf;
use Carbon\Carbon;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ExamPaperController extends Controller
{
    public const EXAMINATION_TYPES = ['assessment', 'end_term', 'mid_term', 'mock', 'practice'];

    public function __construct(private TeachingDocumentAccess $access, private TeachingDocumentData $data, private ExamPaperExport $export) {}

    public function context(Request $request)
    {
        $user = $this->access->user($request->user());
        $assignments = ClassSubjectTeacher::with(TeachingDocumentData::ASSIGNMENT_RELATIONS)
            ->when(! $this->access->leader($user), fn ($query) => $query->where('staff_id', $this->access->staff($user)->id))
            ->orderBy('term_id')->orderBy('class_id')->orderBy('subject_id')->get();

        return response()->json(['data' => ['scope' => $this->access->leader($user) ? 'school' : 'assigned',
            'assignments' => $assignments->map(fn ($assignment) => $this->data->assignment($assignment)),
            'examination_types' => self::EXAMINATION_TYPES]]);
    }

    public function index(Request $request)
    {
        $user = $this->access->user($request->user());
        $filters = $request->validate(['term_id' => ['sometimes', 'integer', 'exists:terms,id'], 'class_id' => ['sometimes', 'integer', 'exists:classes,id'],
            'status' => ['sometimes', Rule::in(ExamPaper::STATUSES)], 'examination_type' => ['sometimes', Rule::in(self::EXAMINATION_TYPES)]]);
        $papers = $this->access->readable($user, ExamPaper::class)->with($this->relations())
            ->when($filters['term_id'] ?? null, fn ($query, $id) => $query->whereHas('assignment', fn ($assignment) => $assignment->where('term_id', $id)))
            ->when($filters['class_id'] ?? null, fn ($query, $id) => $query->whereHas('assignment', fn ($assignment) => $assignment->where('class_id', $id)))
            ->when($filters['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
            ->when($filters['examination_type'] ?? null, fn ($query, $type) => $query->where('examination_type', $type))
            ->orderByDesc('exam_date')->orderByDesc('id')->get();

        return response()->json(['data' => $papers->map(fn ($paper) => $this->summary($paper))]);
    }

    public function show(Request $request, ExamPaper $examPaper)
    {
        $user = $this->access->user($request->user());
        $paper = $this->access->document($user, ExamPaper::class, $examPaper->id)->load($this->relations());
        return response()->json(['data' => $this->workspace($paper)]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->paperRules());
        return DB::transaction(function () use ($request, $validated, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $assignment = $this->access->assignment($user, (int) $validated['class_subject_teacher_id'], true);
            $paper = ExamPaper::create($this->paperValues($assignment, $validated) + ['status' => 'draft', 'revision_number' => 0, 'created_by' => $user->id]);
            $auditLogger->log('CREATE_EXAM_PAPER', 'ExamPaper', $paper->id, ['class_subject_teacher_id' => $assignment->id]);
            return response()->json(['data' => $this->workspace($paper->load($this->relations()))], 201);
        }, 3);
    }

    public function update(Request $request, ExamPaper $examPaper, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->paperRules(true));
        return DB::transaction(function () use ($request, $validated, $examPaper, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $paper = $this->access->document($user, ExamPaper::class, $examPaper->id, true)->load('assignment');
            $this->editable($paper);
            $paper->update($this->paperValues($paper->assignment, array_replace($this->storedPaperValues($paper), $validated)));
            $auditLogger->log('UPDATE_EXAM_PAPER', 'ExamPaper', $paper->id, ['class_subject_teacher_id' => $paper->class_subject_teacher_id]);
            return response()->json(['data' => $this->workspace($paper->fresh($this->relations()))]);
        }, 3);
    }

    public function destroy(Request $request, ExamPaper $examPaper, AuditLogger $auditLogger)
    {
        return DB::transaction(function () use ($request, $examPaper, $auditLogger) {
            $user = $this->access->user($request->user(), true); $paper = $this->access->document($user, ExamPaper::class, $examPaper->id, true);
            abort_unless($paper->status === 'draft', 409, 'Only draft examination papers can be deleted.');
            $paper->delete(); $auditLogger->log('DELETE_EXAM_PAPER', 'ExamPaper', $paper->id, ['class_subject_teacher_id' => $paper->class_subject_teacher_id]);
            return response()->json(['data' => ['message' => 'Examination paper deleted.']]);
        }, 3);
    }

    public function storeSection(Request $request, ExamPaper $examPaper, AuditLogger $auditLogger) { return $this->sectionWrite($request, $examPaper, null, $auditLogger); }
    public function updateSection(Request $request, ExamPaper $examPaper, ExamPaperSection $section, AuditLogger $auditLogger) { return $this->sectionWrite($request, $examPaper, $section, $auditLogger); }

    public function destroySection(Request $request, ExamPaper $examPaper, ExamPaperSection $section, AuditLogger $auditLogger)
    {
        return DB::transaction(function () use ($request, $examPaper, $section, $auditLogger) {
            $paper = $this->editableDocument($request, $examPaper); abort_unless((int) $section->exam_paper_id === (int) $paper->id, 404);
            $section->delete(); $auditLogger->log('DELETE_EXAM_PAPER_SECTION', 'ExamPaperSection', $section->id, ['exam_paper_id' => $paper->id]);
            return response()->json(['data' => $this->workspace($paper->fresh($this->relations()))]);
        }, 3);
    }

    public function storeQuestion(Request $request, ExamPaper $examPaper, AuditLogger $auditLogger) { return $this->questionWrite($request, $examPaper, null, $auditLogger); }
    public function updateQuestion(Request $request, ExamPaper $examPaper, ExamPaperQuestion $question, AuditLogger $auditLogger) { return $this->questionWrite($request, $examPaper, $question, $auditLogger); }

    public function duplicateQuestion(Request $request, ExamPaper $examPaper, ExamPaperQuestion $question, AuditLogger $auditLogger)
    {
        return DB::transaction(function () use ($request, $examPaper, $question, $auditLogger) {
            $paper = $this->editableDocument($request, $examPaper); abort_unless((int) $question->exam_paper_id === (int) $paper->id, 404);
            $copy = $question->replicate(['position']); $copy->position = (int) $paper->questions()->max('position') + 1; $copy->save();
            $auditLogger->log('DUPLICATE_EXAM_PAPER_QUESTION', 'ExamPaperQuestion', $copy->id, ['exam_paper_id' => $paper->id, 'source_question_id' => $question->id]);
            return response()->json(['data' => $this->workspace($paper->fresh($this->relations()))], 201);
        }, 3);
    }

    public function destroyQuestion(Request $request, ExamPaper $examPaper, ExamPaperQuestion $question, AuditLogger $auditLogger)
    {
        return DB::transaction(function () use ($request, $examPaper, $question, $auditLogger) {
            $paper = $this->editableDocument($request, $examPaper); abort_unless((int) $question->exam_paper_id === (int) $paper->id, 404);
            $question->delete(); $auditLogger->log('DELETE_EXAM_PAPER_QUESTION', 'ExamPaperQuestion', $question->id, ['exam_paper_id' => $paper->id]);
            return response()->json(['data' => $this->workspace($paper->fresh($this->relations()))]);
        }, 3);
    }

    public function uploadAttachment(Request $request, ExamPaper $examPaper, AuditLogger $auditLogger)
    {
        $request->validate(['attachment' => ['required', 'file', 'image', 'mimes:png,jpg,jpeg,webp', 'max:5120']]);
        return DB::transaction(function () use ($request, $examPaper, $auditLogger) {
            $paper = $this->editableDocument($request, $examPaper); $file = $request->file('attachment');
            $path = $file->store('exam-papers/'.$paper->id.'/attachments', 'private');
            $attachment = $paper->attachments()->create(['storage_path' => $path, 'original_name' => $file->getClientOriginalName(), 'mime_type' => $file->getMimeType(), 'byte_size' => $file->getSize(), 'sha256' => hash_file('sha256', $file->getRealPath()), 'uploaded_by' => $request->user()->id]);
            $auditLogger->log('UPLOAD_EXAM_PAPER_ATTACHMENT', 'ExamPaperAttachment', $attachment->id, ['exam_paper_id' => $paper->id]);
            return response()->json(['data' => $this->attachment($attachment)], 201);
        }, 3);
    }

    public function downloadAttachment(Request $request, ExamPaper $examPaper, ExamPaperAttachment $attachment)
    {
        $user = $this->access->user($request->user()); $paper = $this->access->document($user, ExamPaper::class, $examPaper->id);
        abort_unless((int) $attachment->exam_paper_id === (int) $paper->id && Storage::disk('private')->exists($attachment->storage_path), 404);
        return Storage::disk('private')->download($attachment->storage_path, $attachment->original_name, ['Content-Type' => $attachment->mime_type]);
    }

    public function submit(Request $request, ExamPaper $examPaper, AuditLogger $auditLogger) { return $this->teacherTransition($request, $examPaper, $auditLogger, ['draft', 'returned'], 'submitted', 'SUBMIT_EXAM_PAPER'); }
    public function publish(Request $request, ExamPaper $examPaper, AuditLogger $auditLogger) { return $this->leaderTransition($request, $examPaper, $auditLogger, 'approved', 'published', 'PUBLISH_EXAM_PAPER'); }

    public function review(Request $request, ExamPaper $examPaper, AuditLogger $auditLogger)
    {
        $validated = $request->validate(['action' => ['required', Rule::in(['approved', 'returned'])], 'review_notes' => ['nullable', 'string', 'max:4000', 'required_if:action,returned']]);
        return DB::transaction(function () use ($request, $examPaper, $auditLogger, $validated) {
            $user = $this->access->user($request->user(), true); abort_unless($this->access->leader($user), 403, 'Examination paper reviews require school leadership.');
            $paper = $this->access->document($user, ExamPaper::class, $examPaper->id, true)->load($this->relations()); abort_unless($paper->status === 'submitted', 409, 'Only submitted examination papers can be reviewed.');
            $paper->update(['status' => $validated['action'], 'review_notes' => $validated['review_notes'] ?? null, 'reviewed_by' => $user->id, 'reviewed_at' => now()]);
            $this->retain($paper->fresh($this->relations()), $user, $validated['action']); $auditLogger->log(strtoupper($validated['action']).'_EXAM_PAPER', 'ExamPaper', $paper->id, ['class_subject_teacher_id' => $paper->class_subject_teacher_id]);
            return response()->json(['data' => $this->workspace($paper->fresh($this->relations()))]);
        }, 3);
    }

    public function pdf(Request $request, ExamPaper $examPaper) { return $this->render($request, $examPaper, false); }
    public function markingSchemePdf(Request $request, ExamPaper $examPaper) { return $this->render($request, $examPaper, true); }

    private function sectionWrite(Request $request, ExamPaper $examPaper, ?ExamPaperSection $section, AuditLogger $auditLogger)
    {
        $validated = $request->validate(['position' => ['required', 'integer', 'min:1', 'max:100'], 'title' => ['required', 'string', 'max:160'], 'instructions' => ['nullable', 'string', 'max:4000']]);
        return DB::transaction(function () use ($request, $examPaper, $section, $auditLogger, $validated) {
            $paper = $this->editableDocument($request, $examPaper);
            if ($section) abort_unless((int) $section->exam_paper_id === (int) $paper->id, 404);
            $query = $paper->sections()->where('position', $validated['position']); if ($section) $query->where('id', '!=', $section->id);
            if ($query->lockForUpdate()->exists()) return $this->conflict('SECTION_POSITION_EXISTS', 'This paper already has a section at that position.');
            $entry = $section ?: new ExamPaperSection(['exam_paper_id' => $paper->id]); $entry->fill($validated)->save();
            $auditLogger->log(($section ? 'UPDATE' : 'CREATE').'_EXAM_PAPER_SECTION', 'ExamPaperSection', $entry->id, ['exam_paper_id' => $paper->id]);
            return response()->json(['data' => $this->workspace($paper->fresh($this->relations()))], $section ? 200 : 201);
        }, 3);
    }

    private function questionWrite(Request $request, ExamPaper $examPaper, ?ExamPaperQuestion $question, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->questionRules());
        return DB::transaction(function () use ($request, $examPaper, $question, $auditLogger, $validated) {
            $paper = $this->editableDocument($request, $examPaper);
            if ($question) abort_unless((int) $question->exam_paper_id === (int) $paper->id, 404);
            $values = $this->questionValues($paper, $validated); $query = $paper->questions()->where('position', $values['position']); if ($question) $query->where('id', '!=', $question->id);
            if ($query->lockForUpdate()->exists()) return $this->conflict('QUESTION_POSITION_EXISTS', 'This paper already has a question at that position.');
            $entry = $question ?: new ExamPaperQuestion(['exam_paper_id' => $paper->id]); $entry->fill($values)->save();
            $auditLogger->log(($question ? 'UPDATE' : 'CREATE').'_EXAM_PAPER_QUESTION', 'ExamPaperQuestion', $entry->id, ['exam_paper_id' => $paper->id]);
            return response()->json(['data' => $this->workspace($paper->fresh($this->relations()))], $question ? 200 : 201);
        }, 3);
    }

    private function teacherTransition(Request $request, ExamPaper $examPaper, AuditLogger $auditLogger, array $from, string $to, string $action)
    {
        return DB::transaction(function () use ($request, $examPaper, $auditLogger, $from, $to, $action) {
            $user = $this->access->user($request->user(), true); abort_unless(! $this->access->leader($user), 403, 'Only the assigned teacher can submit an examination paper.');
            $paper = $this->access->document($user, ExamPaper::class, $examPaper->id, true)->load($this->relations()); abort_unless(in_array($paper->status, $from, true), 409, 'This paper cannot be submitted from its current status.');
            if ($paper->questions->isEmpty()) throw ValidationException::withMessages(['questions' => 'Add at least one question before submission.']);
            $paper->update(['status' => $to, 'submitted_at' => now()]); $this->retain($paper->fresh($this->relations()), $user, $to);
            $auditLogger->log($action, 'ExamPaper', $paper->id, ['class_subject_teacher_id' => $paper->class_subject_teacher_id]);
            return response()->json(['data' => $this->workspace($paper->fresh($this->relations()))]);
        }, 3);
    }

    private function leaderTransition(Request $request, ExamPaper $examPaper, AuditLogger $auditLogger, string $from, string $to, string $action)
    {
        return DB::transaction(function () use ($request, $examPaper, $auditLogger, $from, $to, $action) {
            $user = $this->access->user($request->user(), true); abort_unless($this->access->leader($user), 403, 'Publishing requires school leadership.');
            $paper = $this->access->document($user, ExamPaper::class, $examPaper->id, true)->load($this->relations()); abort_unless($paper->status === $from, 409, 'Only approved papers can be published.');
            $paper->update(['status' => $to, 'published_at' => now()]); $this->retain($paper->fresh($this->relations()), $user, $to);
            $auditLogger->log($action, 'ExamPaper', $paper->id, ['class_subject_teacher_id' => $paper->class_subject_teacher_id]);
            return response()->json(['data' => $this->workspace($paper->fresh($this->relations()))]);
        }, 3);
    }

    private function retain(ExamPaper $paper, User $user, string $status): void
    {
        $revision = (int) $paper->revision_number + 1; $snapshot = $this->workspace($paper); $encoded = json_encode($snapshot, JSON_THROW_ON_ERROR);
        $paper->update(['revision_number' => $revision]);
        ExamPaperRevision::create(['exam_paper_id' => $paper->id, 'revision_number' => $revision, 'status' => $status, 'snapshot' => $snapshot, 'snapshot_sha256' => hash('sha256', $encoded), 'created_by' => $user->id, 'created_at' => now()]);
    }

    private function render(Request $request, ExamPaper $examPaper, bool $markingScheme)
    {
        $user = $this->access->user($request->user()); $paper = $this->access->document($user, ExamPaper::class, $examPaper->id)->load($this->relations());
        try { return Pdf::loadView('teaching.exam-paper', ['document' => $this->export->paper($paper, $markingScheme)])->download('exam-paper-'.$paper->id.($markingScheme ? '-marking-scheme' : '').'.pdf'); }
        catch (\Throwable $exception) { report($exception); throw new HttpResponseException(response()->json(['error' => ['code' => 'DOCUMENT_EXPORT_FAILED', 'message' => 'The examination paper could not be exported. No file was produced.']], 503)); }
    }

    private function editableDocument(Request $request, ExamPaper $examPaper): ExamPaper
    {
        $user = $this->access->user($request->user(), true); $paper = $this->access->document($user, ExamPaper::class, $examPaper->id, true)->load('assignment'); $this->editable($paper); return $paper;
    }
    private function editable(ExamPaper $paper): void { abort_unless(in_array($paper->status, ['draft', 'returned'], true), 409, 'Submitted, approved, published and archived papers are read-only.'); }
    private function paperRules(bool $updating = false): array { $required = $updating ? ['sometimes', 'required'] : ['required']; return ['class_subject_teacher_id' => $updating ? ['prohibited'] : ['required', 'integer', 'exists:class_subject_teacher,id'], 'examination_type' => [...$required, Rule::in(self::EXAMINATION_TYPES)], 'title' => [...$required, 'string', 'max:160'], 'instructions' => ['sometimes', 'nullable', 'string', 'max:8000'], 'duration_minutes' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:600'], 'exam_date' => ['sometimes', 'nullable', 'date']]; }
    private function questionRules(): array { return ['exam_paper_section_id' => ['sometimes', 'nullable', 'integer', 'exists:exam_paper_sections,id'], 'exam_paper_attachment_id' => ['sometimes', 'nullable', 'integer', 'exists:exam_paper_attachments,id'], 'position' => ['required', 'integer', 'min:1', 'max:200'], 'question_type' => ['required', Rule::in(ExamPaperQuestion::TYPES)], 'prompt' => ['required', 'string', 'max:8000'], 'marks' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000'], 'diagram_reference' => ['sometimes', 'nullable', 'string', 'max:255'], 'options' => ['sometimes', 'nullable', 'array'], 'options.*' => ['string', 'max:255'], 'answer_key' => ['sometimes', 'nullable', 'string', 'max:8000'], 'marking_guidance' => ['sometimes', 'nullable', 'string', 'max:8000'], 'ai_generated' => ['sometimes', 'boolean'], 'ai_source' => ['sometimes', 'nullable', 'string', 'max:80']]; }
    private function paperValues(ClassSubjectTeacher $assignment, array $values): array { if (! empty($values['exam_date'])) { $date = Carbon::parse($values['exam_date'])->toDateString(); $term = Term::whereKey($assignment->term_id)->lockForUpdate()->firstOrFail(); if ($date < $term->start_date->toDateString() || $date > $term->end_date->toDateString()) throw ValidationException::withMessages(['exam_date' => 'The examination date must fall within the assigned academic term.']); $values['exam_date'] = $date; } return $values; }
    private function storedPaperValues(ExamPaper $paper): array { return ['examination_type' => $paper->examination_type, 'title' => $paper->title, 'instructions' => $paper->instructions, 'duration_minutes' => $paper->duration_minutes, 'exam_date' => $paper->exam_date?->toDateString()]; }
    private function questionValues(ExamPaper $paper, array $values): array { if (($values['exam_paper_section_id'] ?? null) && ! $paper->sections()->whereKey($values['exam_paper_section_id'])->exists()) throw ValidationException::withMessages(['exam_paper_section_id' => 'The selected section does not belong to this paper.']); if (($values['exam_paper_attachment_id'] ?? null) && ! $paper->attachments()->whereKey($values['exam_paper_attachment_id'])->exists()) throw ValidationException::withMessages(['exam_paper_attachment_id' => 'The selected attachment does not belong to this paper.']); $options = array_values(array_filter(array_map(fn ($option) => trim((string) $option), $values['options'] ?? []))); if ($values['question_type'] === 'multiple_choice') { if (count($options) < 2) throw ValidationException::withMessages(['options' => 'Multiple-choice questions need at least two options.']); if (! in_array(trim((string) ($values['answer_key'] ?? '')), $options, true)) throw ValidationException::withMessages(['answer_key' => 'The answer key must match one listed option.']); $values['options'] = json_encode($options); } else { if ($options) throw ValidationException::withMessages(['options' => 'Only multiple-choice questions can list options.']); $values['options'] = null; } return $values; }
    private function relations(): array { return ['assignment.schoolClass:id,name,level', 'assignment.subject:id,name,code,learning_area,status', 'assignment.staff:id,first_name,last_name', 'assignment.term:id,academic_year_id,name,start_date,end_date,is_current', 'assignment.term.academicYear:id,name', 'sections', 'questions.attachment']; }
    private function summary(ExamPaper $paper): array { return ['id' => $paper->id, 'class_subject_teacher_id' => $paper->class_subject_teacher_id, 'examination_type' => $paper->examination_type, 'title' => $paper->title, 'status' => $paper->status, 'exam_date' => $paper->exam_date?->toDateString(), 'duration_minutes' => $paper->duration_minutes, 'revision_number' => $paper->revision_number, 'question_count' => $paper->questions->count(), 'total_marks' => (int) $paper->questions->sum(fn ($question) => (int) $question->marks), 'assignment' => $paper->assignment ? $this->data->assignment($paper->assignment) : null]; }
    private function workspace(ExamPaper $paper): array { return $this->summary($paper) + ['instructions' => $paper->instructions, 'review_notes' => $paper->review_notes, 'submitted_at' => $paper->submitted_at?->toISOString(), 'reviewed_at' => $paper->reviewed_at?->toISOString(), 'published_at' => $paper->published_at?->toISOString(), 'sections' => $paper->sections->map(fn ($section) => $section->only(['id', 'position', 'title', 'instructions']))->values(), 'questions' => $paper->questions->map(fn ($question) => ['id' => $question->id, 'exam_paper_section_id' => $question->exam_paper_section_id, 'exam_paper_attachment_id' => $question->exam_paper_attachment_id, 'position' => $question->position, 'question_type' => $question->question_type, 'prompt' => $question->prompt, 'marks' => $question->marks, 'diagram_reference' => $question->diagram_reference, 'options' => $question->optionList(), 'answer_key' => $question->answer_key, 'marking_guidance' => $question->marking_guidance, 'ai_generated' => $question->ai_generated, 'ai_source' => $question->ai_source, 'attachment' => $question->attachment ? $this->attachment($question->attachment) : null])->values(), 'attachments' => $paper->attachments->map(fn ($attachment) => $this->attachment($attachment))->values()]; }
    private function attachment(ExamPaperAttachment $attachment): array { return $attachment->only(['id', 'original_name', 'mime_type', 'byte_size', 'sha256', 'created_at']); }
    private function conflict(string $code, string $message) { return response()->json(['error' => compact('code', 'message')], 409); }
}
