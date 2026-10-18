<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClassSubjectTeacher;
use App\Models\LessonPlan;
use App\Models\RecordOfWork;
use App\Models\Term;
use App\Services\AuditLogger;
use App\Services\TeachingDocumentAccess;
use App\Services\TeachingDocumentData;
use App\Services\TeachingDocumentExport;
use Barryvdh\DomPDF\Facade\Pdf;
use Carbon\Carbon;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class RecordOfWorkController extends Controller
{
    public function __construct(private TeachingDocumentAccess $access, private TeachingDocumentData $data, private TeachingDocumentExport $export)
    {
    }

    public function context(Request $request)
    {
        $user = $this->access->user($request->user());
        $assignments = ClassSubjectTeacher::with(TeachingDocumentData::ASSIGNMENT_RELATIONS)
            ->when(! $this->access->leader($user), fn ($query) => $query->where('staff_id', $this->access->staff($user)->id))
            ->orderBy('term_id')->orderBy('class_id')->orderBy('subject_id')->get();
        $plans = $this->access->readable($user, LessonPlan::class)
            ->with('assignment:id,class_id,subject_id,staff_id,term_id')
            ->orderBy('lesson_date')->orderBy('id')->get()
            ->map(fn ($plan) => $plan->only(['id', 'title', 'lesson_date', 'class_subject_teacher_id']));

        return response()->json(['data' => [
            'scope' => $this->access->leader($user) ? 'school' : 'assigned',
            'assignments' => $assignments->map(fn ($assignment) => $this->data->assignment($assignment)),
            'lesson_plans' => $plans,
        ]]);
    }

    public function index(Request $request)
    {
        $user = $this->access->user($request->user());
        $filters = $request->validate([
            'term_id' => ['sometimes', 'integer', 'exists:terms,id'],
            'class_id' => ['sometimes', 'integer', 'exists:classes,id'],
            'status' => ['sometimes', Rule::in(['draft', 'submitted', 'returned', 'approved'])],
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date'],
        ]);
        if (isset($filters['from'], $filters['to']) && $filters['from'] > $filters['to']) {
            throw ValidationException::withMessages(['to' => 'The end date must be on or after the start date.']);
        }
        $records = $this->access->readable($user, RecordOfWork::class)
            ->with(TeachingDocumentData::RECORD_RELATIONS)
            ->when($filters['term_id'] ?? null, fn ($query, $id) => $query->whereHas('assignment', fn ($assignment) => $assignment->where('term_id', $id)))
            ->when($filters['class_id'] ?? null, fn ($query, $id) => $query->whereHas('assignment', fn ($assignment) => $assignment->where('class_id', $id)))
            ->when($filters['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
            ->when($filters['from'] ?? null, fn ($query, $date) => $query->where('taught_on', '>=', $date))
            ->when($filters['to'] ?? null, fn ($query, $date) => $query->where('taught_on', '<=', $date));

        return response()->json(['data' => $records->orderBy('taught_on')->orderBy('id')->get()->map(fn ($record) => $this->data->recordOfWork($record))]);
    }

    public function show(Request $request, RecordOfWork $recordOfWork)
    {
        $user = $this->access->user($request->user());
        $record = $this->access->document($user, RecordOfWork::class, $recordOfWork->id)->load(TeachingDocumentData::RECORD_RELATIONS);

        return response()->json(['data' => $this->data->recordOfWork($record)]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->recordRules());

        return DB::transaction(function () use ($request, $validated, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $assignment = $this->access->assignment($user, (int) $validated['class_subject_teacher_id'], true);
            $values = $this->preparedValues($assignment, $validated);
            $record = RecordOfWork::create($values + ['status' => 'draft', 'created_by' => $user->id]);
            $auditLogger->log('CREATE_RECORD_OF_WORK', 'RecordOfWork', $record->id, [
                'class_subject_teacher_id' => $assignment->id, 'taught_on' => $record->taught_on?->toDateString(),
            ]);

            return response()->json(['data' => $this->data->recordOfWork($record->load(TeachingDocumentData::RECORD_RELATIONS))], 201);
        }, 3);
    }

    public function update(Request $request, RecordOfWork $recordOfWork, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->recordRules(true));

        return DB::transaction(function () use ($request, $validated, $recordOfWork, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $record = $this->access->document($user, RecordOfWork::class, $recordOfWork->id, true);
            $this->assertEditable($record);
            $values = $this->preparedValues($record->assignment, array_replace($this->recordValues($record), $validated));
            $record->update($values);
            $auditLogger->log('UPDATE_RECORD_OF_WORK', 'RecordOfWork', $record->id, ['class_subject_teacher_id' => $record->class_subject_teacher_id]);

            return response()->json(['data' => $this->data->recordOfWork($record->load(TeachingDocumentData::RECORD_RELATIONS))]);
        }, 3);
    }

    public function submit(Request $request, RecordOfWork $recordOfWork, AuditLogger $auditLogger)
    {
        return DB::transaction(function () use ($request, $recordOfWork, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            abort_unless(! $this->access->leader($user), 403, 'Only the assigned teacher can submit a record of work for review.');
            $record = $this->access->document($user, RecordOfWork::class, $recordOfWork->id, true);
            abort_unless(in_array($record->status, ['draft', 'returned'], true), 409, 'Only draft or returned records of work can be submitted.');
            $record->update(['status' => 'submitted', 'submitted_at' => now()]);
            $auditLogger->log('SUBMIT_RECORD_OF_WORK', 'RecordOfWork', $record->id, ['class_subject_teacher_id' => $record->class_subject_teacher_id]);

            return response()->json(['data' => $this->data->recordOfWork($record->load(TeachingDocumentData::RECORD_RELATIONS))]);
        }, 3);
    }

    public function review(Request $request, RecordOfWork $recordOfWork, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'action' => ['required', Rule::in(['approved', 'returned'])],
            'review_notes' => ['nullable', 'string', 'max:4000', 'required_if:action,returned'],
        ]);

        return DB::transaction(function () use ($request, $validated, $recordOfWork, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            abort_unless($this->access->leader($user), 403, 'Record of work reviews require school leadership.');
            $record = $this->access->document($user, RecordOfWork::class, $recordOfWork->id, true);
            abort_unless($record->status === 'submitted', 409, 'Only submitted records of work can be reviewed.');
            $record->update([
                'status' => $validated['action'],
                'review_notes' => $validated['review_notes'] ?? null,
                'reviewed_by' => $user->id,
                'reviewed_at' => now(),
            ]);
            $auditLogger->log(strtoupper($validated['action']).'_RECORD_OF_WORK', 'RecordOfWork', $record->id, ['class_subject_teacher_id' => $record->class_subject_teacher_id]);

            return response()->json(['data' => $this->data->recordOfWork($record->load(TeachingDocumentData::RECORD_RELATIONS))]);
        }, 3);
    }

    public function pdf(Request $request, RecordOfWork $recordOfWork)
    {
        $user = $this->access->user($request->user());
        $record = $this->access->document($user, RecordOfWork::class, $recordOfWork->id)->load(TeachingDocumentData::RECORD_RELATIONS);
        try {
            return Pdf::loadView('teaching.record-of-work', ['document' => $this->export->recordOfWork($record)])->download('record-of-work-'.$record->id.'.pdf');
        } catch (\Throwable $exception) {
            report($exception);

            throw new HttpResponseException(response()->json(['error' => ['code' => 'DOCUMENT_EXPORT_FAILED', 'message' => 'The record of work could not be exported. No file was produced.']], 503));
        }
    }

    private function recordRules(bool $updating = false): array
    {
        $required = $updating ? ['sometimes', 'required'] : ['required'];

        return [
            'class_subject_teacher_id' => $updating ? ['prohibited'] : ['required', 'integer', 'exists:class_subject_teacher,id'],
            'lesson_plan_id' => ['sometimes', 'nullable', 'integer', 'exists:lesson_plans,id'],
            'taught_on' => [...$required, 'date'],
            'content_covered' => [...$required, 'string', 'max:8000'],
            'learning_activities_conducted' => [...$required, 'string', 'max:8000'],
            'work_completed' => [...$required, 'string', 'max:8000'],
            'work_not_completed' => ['sometimes', 'nullable', 'string', 'max:8000'],
            'reasons_for_deviations' => ['sometimes', 'nullable', 'string', 'max:8000'],
            'teacher_observations' => [...$required, 'string', 'max:8000'],
            'follow_up_actions' => ['sometimes', 'nullable', 'string', 'max:8000'],
        ];
    }

    private function preparedValues(ClassSubjectTeacher $assignment, array $values): array
    {
        $this->assertWithinTerm($assignment, $values['taught_on'], 'taught_on');

        $values['taught_on'] = Carbon::parse($values['taught_on'])->toDateString();

        return $values + ['lesson_plan_id' => $this->assertLessonPlan($assignment, $values['lesson_plan_id'] ?? null)];
    }

    private function assertWithinTerm(ClassSubjectTeacher $assignment, string $date, string $field): void
    {
        $term = Term::whereKey($assignment->term_id)->lockForUpdate()->firstOrFail();
        if ($date < $term->start_date->toDateString() || $date > $term->end_date->toDateString()) {
            throw ValidationException::withMessages([$field => 'The teaching date must fall within the assigned academic term.']);
        }
    }

    private function assertLessonPlan(ClassSubjectTeacher $assignment, ?int $planId): ?int
    {
        if ($planId === null) return null;
        $plan = LessonPlan::whereKey($planId)->lockForUpdate()->firstOrFail();
        if ((int) $plan->class_subject_teacher_id !== (int) $assignment->id) {
            throw ValidationException::withMessages(['lesson_plan_id' => 'The selected lesson plan does not belong to this teaching allocation.']);
        }

        return $plan->id;
    }

    private function assertEditable(RecordOfWork $record): void
    {
        abort_unless(in_array($record->status, ['draft', 'returned'], true), 409, 'Submitted and approved records of work are read-only until returned for changes.');
    }

    private function recordValues(RecordOfWork $record): array
    {
        return [
            'lesson_plan_id' => $record->lesson_plan_id,
            'taught_on' => $record->taught_on?->toDateString(),
            'content_covered' => $record->content_covered,
            'learning_activities_conducted' => $record->learning_activities_conducted,
            'work_completed' => $record->work_completed,
            'work_not_completed' => $record->work_not_completed,
            'reasons_for_deviations' => $record->reasons_for_deviations,
            'teacher_observations' => $record->teacher_observations,
            'follow_up_actions' => $record->follow_up_actions,
        ];
    }
}
