<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ExamPaper;
use App\Models\LessonPlan;
use App\Models\RecordOfWork;
use App\Models\SchemeOfWork;
use App\Services\AuditLogger;
use App\Services\TeachingDocumentAccess;
use App\Services\TeachingDocumentData;
use App\Services\TeachingDocumentVersions;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TeachingReviewController extends Controller
{
    private const TYPES = ['scheme_of_work' => SchemeOfWork::class, 'lesson_plan' => LessonPlan::class, 'record_of_work' => RecordOfWork::class, 'exam_paper' => ExamPaper::class];

    public function __construct(private TeachingDocumentAccess $access, private TeachingDocumentData $data, private TeachingDocumentVersions $versions) {}

    public function index(Request $request)
    {
        $user = $this->access->user($request->user()); abort_unless($this->access->leader($user), 403);
        $filters = $request->validate(['document_type' => ['sometimes', Rule::in(array_keys(self::TYPES))], 'term_id' => ['sometimes', 'integer', 'exists:terms,id'], 'class_id' => ['sometimes', 'integer', 'exists:classes,id'], 'teacher_id' => ['sometimes', 'integer', 'exists:staff,id'], 'q' => ['sometimes', 'string', 'max:120']]);
        $types = isset($filters['document_type']) ? [$filters['document_type'] => self::TYPES[$filters['document_type']]] : self::TYPES;
        $documents = collect();
        foreach ($types as $type => $model) {
            $documents = $documents->merge($this->filtered($model, $filters)->get()->map(fn (Model $document) => $this->row($type, $document)));
        }
        return response()->json(['data' => $documents->sortByDesc('submitted_at')->values()]);
    }

    public function review(Request $request, string $documentType, int $documentId, AuditLogger $auditLogger)
    {
        $validated = $request->validate(['action' => ['required', Rule::in(['approved', 'returned'])], 'review_notes' => ['nullable', 'string', 'max:4000', 'required_if:action,returned']]);
        $class = self::TYPES[$documentType] ?? abort(404);
        return DB::transaction(function () use ($request, $class, $documentType, $documentId, $validated, $auditLogger) {
            $user = $this->access->user($request->user(), true); abort_unless($this->access->leader($user), 403);
            $document = $this->access->document($user, $class, $documentId, true); abort_unless($document->status === 'submitted', 409, 'Only submitted documents can be reviewed.');
            $document->update(['status' => $validated['action'], 'review_notes' => $validated['review_notes'] ?? null, 'reviewed_by' => $user->id, 'reviewed_at' => now()]);
            $this->versions->capture($documentType, $document->fresh(), $validated['action'], $user);
            $auditLogger->log(strtoupper($validated['action']).'_TEACHING_DOCUMENT', class_basename($class), $document->id, ['document_type' => $documentType, 'class_subject_teacher_id' => $document->class_subject_teacher_id]);
            return response()->json(['data' => $this->row($documentType, $document->fresh()->load($this->relations()))]);
        }, 3);
    }

    private function filtered(string $model, array $filters)
    {
        return $model::with($this->relations())->where('status', 'submitted')
            ->when($filters['q'] ?? null, fn ($query, $q) => $model === RecordOfWork::class
                ? $query->where('content_covered', 'like', '%'.$q.'%')
                : $query->where('title', 'like', '%'.$q.'%'))
            ->when($filters['term_id'] ?? null, fn ($query, $id) => $query->whereHas('assignment', fn ($assignment) => $assignment->where('term_id', $id)))
            ->when($filters['class_id'] ?? null, fn ($query, $id) => $query->whereHas('assignment', fn ($assignment) => $assignment->where('class_id', $id)))
            ->when($filters['teacher_id'] ?? null, fn ($query, $id) => $query->whereHas('assignment', fn ($assignment) => $assignment->where('staff_id', $id)));
    }

    private function row(string $type, Model $document): array
    {
        return ['document_type' => $type, 'id' => $document->id, 'title' => $type === 'record_of_work' ? 'Record of work: '.$document->taught_on?->toDateString() : $document->title, 'status' => $document->status,
            'submitted_at' => $document->submitted_at?->toISOString(), 'assignment' => $this->data->assignment($document->assignment)];
    }

    private function relations(): array
    {
        return array_map(fn (string $relation) => 'assignment.'.$relation, TeachingDocumentData::ASSIGNMENT_RELATIONS);
    }
}
