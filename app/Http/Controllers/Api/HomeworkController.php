<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClassSubjectTeacher;
use App\Models\Homework;
use App\Models\HomeworkCompletion;
use App\Models\HomeworkQuestion;
use App\Models\LessonPlan;
use App\Models\SchemeOfWork;
use App\Models\SchemeOfWorkWeek;
use App\Models\Student;
use App\Models\Term;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\HomeworkExport;
use App\Services\TeachingDocumentAccess;
use App\Services\TeachingDocumentData;
use Barryvdh\DomPDF\Facade\Pdf;
use Carbon\Carbon;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class HomeworkController extends Controller
{
    public const SUBMISSION_METHODS = ['exercise_book', 'class_collection', 'oral', 'project'];

    public function __construct(private TeachingDocumentAccess $access, private TeachingDocumentData $data, private HomeworkExport $export)
    {
    }

    public function context(Request $request)
    {
        $user = $this->access->user($request->user());
        $assignments = ClassSubjectTeacher::with(TeachingDocumentData::ASSIGNMENT_RELATIONS)
            ->when(! $this->access->leader($user), fn ($query) => $query->where('staff_id', $this->access->staff($user)->id))
            ->orderBy('term_id')->orderBy('class_id')->orderBy('subject_id')->get();
        $plans = $this->access->readable($user, LessonPlan::class)
            ->orderBy('lesson_date')->orderBy('id')->get()
            ->map(fn ($plan) => $plan->only(['id', 'title', 'lesson_date', 'class_subject_teacher_id']));
        $schemes = $this->access->readable($user, SchemeOfWork::class)
            ->with('weeks:id,scheme_of_work_id,week_number,strand,sub_strand')
            ->orderByDesc('updated_at')->orderByDesc('id')->get()
            ->map(fn ($scheme) => $scheme->only(['id', 'title', 'status', 'class_subject_teacher_id'])
                + ['weeks' => $scheme->weeks->map(fn ($week) => $week->only(['id', 'week_number', 'strand', 'sub_strand']))->values()]);

        return response()->json(['data' => [
            'scope' => $this->access->leader($user) ? 'school' : 'assigned',
            'assignments' => $assignments->map(fn ($assignment) => $this->data->assignment($assignment)),
            'lesson_plans' => $plans,
            'schemes' => $schemes,
            'submission_methods' => self::SUBMISSION_METHODS,
        ]]);
    }

    public function index(Request $request)
    {
        $user = $this->access->user($request->user());
        $filters = $request->validate([
            'term_id' => ['sometimes', 'integer', 'exists:terms,id'],
            'class_id' => ['sometimes', 'integer', 'exists:classes,id'],
            'status' => ['sometimes', Rule::in(Homework::STATUSES)],
            'due_from' => ['sometimes', 'date'],
            'due_to' => ['sometimes', 'date'],
        ]);
        if (isset($filters['due_from'], $filters['due_to']) && $filters['due_from'] > $filters['due_to']) {
            throw ValidationException::withMessages(['due_to' => 'The end date must be on or after the start date.']);
        }
        $homeworks = $this->access->readable($user, Homework::class)
            ->with(TeachingDocumentData::HOMEWORK_RELATIONS)
            ->when($filters['term_id'] ?? null, fn ($query, $id) => $query->whereHas('assignment', fn ($assignment) => $assignment->where('term_id', $id)))
            ->when($filters['class_id'] ?? null, fn ($query, $id) => $query->whereHas('assignment', fn ($assignment) => $assignment->where('class_id', $id)))
            ->when($filters['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
            ->when($filters['due_from'] ?? null, fn ($query, $date) => $query->where('due_on', '>=', $date))
            ->when($filters['due_to'] ?? null, fn ($query, $date) => $query->where('due_on', '<=', $date))
            ->orderBy('due_on')->orderBy('id')->get()
            ->map(fn ($homework) => $this->data->homeworkSummary($homework, $this->eligibleCount($homework)));

        return response()->json(['data' => $homeworks]);
    }

    public function show(Request $request, Homework $homework)
    {
        $user = $this->access->user($request->user());
        $document = $this->access->document($user, Homework::class, $homework->id)->load(TeachingDocumentData::HOMEWORK_RELATIONS);

        return response()->json(['data' => $this->data->homeworkWorkspace($document)]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->homeworkRules());

        return DB::transaction(function () use ($request, $validated, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $assignment = $this->access->assignment($user, (int) $validated['class_subject_teacher_id'], true);
            $values = $this->preparedValues($assignment, $validated);
            $homework = Homework::create($values + ['status' => 'draft', 'created_by' => $user->id]);
            $auditLogger->log('CREATE_HOMEWORK', 'Homework', $homework->id, [
                'class_subject_teacher_id' => $assignment->id, 'due_on' => $homework->due_on?->toDateString(),
            ]);

            return response()->json(['data' => $this->data->homeworkSummary($homework->load(TeachingDocumentData::HOMEWORK_RELATIONS))], 201);
        }, 3);
    }

    public function update(Request $request, Homework $homework, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->homeworkRules(true));

        return DB::transaction(function () use ($request, $validated, $homework, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $document = $this->access->document($user, Homework::class, $homework->id, true)->load('assignment');
            $this->assertEditable($document);
            $values = $this->preparedValues($document->assignment, array_replace($this->homeworkValues($document), $validated));
            $document->update($values);
            $auditLogger->log('UPDATE_HOMEWORK', 'Homework', $document->id, ['class_subject_teacher_id' => $document->class_subject_teacher_id]);

            return response()->json(['data' => $this->data->homeworkWorkspace($document->load(TeachingDocumentData::HOMEWORK_RELATIONS))]);
        }, 3);
    }

    public function destroy(Request $request, Homework $homework, AuditLogger $auditLogger)
    {
        return DB::transaction(function () use ($request, $homework, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $document = $this->access->document($user, Homework::class, $homework->id, true);
            abort_unless($document->status === 'draft', 409, 'Only draft homework can be deleted. Archive published homework instead.');
            $document->delete();
            $auditLogger->log('DELETE_HOMEWORK', 'Homework', $document->id, ['class_subject_teacher_id' => $document->class_subject_teacher_id]);

            return response()->json(['data' => ['message' => 'Homework deleted.']]);
        }, 3);
    }

    public function storeQuestion(Request $request, Homework $homework, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->questionRules());

        return DB::transaction(function () use ($request, $validated, $homework, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $document = $this->access->document($user, Homework::class, $homework->id, true);
            $this->assertEditable($document);
            $values = $this->preparedQuestion($validated);
            if ($document->questions()->where('position', $values['position'])->lockForUpdate()->exists()) {
                return $this->conflict('QUESTION_POSITION_EXISTS', 'This homework already has a question in that position.');
            }
            $question = $document->questions()->create($values);
            $auditLogger->log('CREATE_HOMEWORK_QUESTION', 'HomeworkQuestion', $question->id, ['homework_id' => $document->id, 'position' => $question->position]);

            return response()->json(['data' => $this->data->homeworkWorkspace($document->fresh(TeachingDocumentData::HOMEWORK_RELATIONS))], 201);
        }, 3);
    }

    public function updateQuestion(Request $request, Homework $homework, HomeworkQuestion $question, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->questionRules(true));

        return DB::transaction(function () use ($request, $validated, $homework, $question, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $document = $this->access->document($user, Homework::class, $homework->id, true);
            abort_unless((int) $question->homework_id === (int) $document->id, 404);
            $this->assertEditable($document);
            $values = $this->preparedQuestion(array_replace($this->questionValues($question), $validated));
            if ($document->questions()->where('position', $values['position'])->where('id', '!=', $question->id)->lockForUpdate()->exists()) {
                return $this->conflict('QUESTION_POSITION_EXISTS', 'This homework already has a question in that position.');
            }
            $question->update($values);
            $auditLogger->log('UPDATE_HOMEWORK_QUESTION', 'HomeworkQuestion', $question->id, ['homework_id' => $document->id, 'position' => $question->position]);

            return response()->json(['data' => $this->data->homeworkWorkspace($document->fresh(TeachingDocumentData::HOMEWORK_RELATIONS))]);
        }, 3);
    }

    public function destroyQuestion(Request $request, Homework $homework, HomeworkQuestion $question, AuditLogger $auditLogger)
    {
        return DB::transaction(function () use ($request, $homework, $question, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $document = $this->access->document($user, Homework::class, $homework->id, true);
            abort_unless((int) $question->homework_id === (int) $document->id, 404);
            $this->assertEditable($document);
            HomeworkQuestion::whereKey($question->id)->lockForUpdate()->firstOrFail()->delete();
            $auditLogger->log('DELETE_HOMEWORK_QUESTION', 'HomeworkQuestion', $question->id, ['homework_id' => $document->id]);

            return response()->json(['data' => $this->data->homeworkWorkspace($document->fresh(TeachingDocumentData::HOMEWORK_RELATIONS))]);
        }, 3);
    }

    public function publish(Request $request, Homework $homework, AuditLogger $auditLogger)
    {
        return DB::transaction(function () use ($request, $homework, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $this->assertOwner($user);
            $document = $this->access->document($user, Homework::class, $homework->id, true)->load('questions');
            abort_unless($document->status === 'draft', 409, 'Only draft homework can be published.');
            if ($document->questions->isEmpty()) {
                throw ValidationException::withMessages(['questions' => 'Add at least one question before publishing homework.']);
            }
            if ($document->total_marks !== null && (int) $document->questions->sum('marks') > (int) $document->total_marks) {
                throw ValidationException::withMessages(['total_marks' => 'The total marks must be at least the sum of all question marks.']);
            }
            $document->update(['status' => 'published', 'published_at' => now()]);
            $auditLogger->log('PUBLISH_HOMEWORK', 'Homework', $document->id, ['class_subject_teacher_id' => $document->class_subject_teacher_id]);

            return response()->json(['data' => $this->data->homeworkSummary($document->fresh(TeachingDocumentData::HOMEWORK_RELATIONS), $this->eligibleCount($document))]);
        }, 3);
    }

    public function close(Request $request, Homework $homework, AuditLogger $auditLogger)
    {
        return $this->transition($request, $homework, $auditLogger, 'published', 'closed', 'closed_at', 'CLOSE_HOMEWORK');
    }

    public function archive(Request $request, Homework $homework, AuditLogger $auditLogger)
    {
        return $this->transition($request, $homework, $auditLogger, null, 'archived', 'archived_at', 'ARCHIVE_HOMEWORK');
    }

    public function completions(Request $request, Homework $homework)
    {
        $user = $this->access->user($request->user());
        $document = $this->access->document($user, Homework::class, $homework->id)->load('completions');
        $learners = $this->learners($document)->get()
            ->map(fn ($student) => [
                'student_id' => $student->id,
                'first_name' => $student->first_name,
                'last_name' => $student->last_name,
                'admission_no' => $student->admission_no,
                'completion_id' => $document->completions->firstWhere('student_id', $student->id)?->id,
                'status' => $document->completions->firstWhere('student_id', $student->id)?->status,
                'notes' => $document->completions->firstWhere('student_id', $student->id)?->notes,
                'recorded_at' => $document->completions->firstWhere('student_id', $student->id)?->recorded_at?->toISOString(),
            ]);

        return response()->json(['data' => ['homework_id' => $document->id, 'status' => $document->status,
            'eligible_learner_count' => $learners->count(), 'learners' => $learners->values()]]);
    }

    public function recordCompletion(Request $request, Homework $homework, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'student_id' => ['required', 'integer', 'exists:students,id'],
            'status' => ['required', Rule::in(HomeworkCompletion::STATUSES)],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        return DB::transaction(function () use ($request, $validated, $homework, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $this->assertOwner($user);
            $document = $this->access->document($user, Homework::class, $homework->id, true);
            abort_unless(in_array($document->status, ['published', 'closed'], true), 409, 'Completion can only be recorded for published or closed homework.');
            $this->assertEligibleLearner($document, (int) $validated['student_id']);
            $values = array_intersect_key($validated, array_flip(['student_id', 'status', 'notes']));
            $values['notes'] = trim($values['notes'] ?? '') ?: null;
            $values['recorded_by'] = $user->id;
            $values['recorded_at'] = now();
            $completion = HomeworkCompletion::updateOrCreate(
                ['homework_id' => $document->id, 'student_id' => $validated['student_id']],
                $values
            );
            $auditLogger->log('RECORD_HOMEWORK_COMPLETION', 'HomeworkCompletion', $completion->id, [
                'homework_id' => $document->id, 'student_id' => $completion->student_id, 'status' => $completion->status,
            ]);

            return response()->json(['data' => ['homework_id' => $document->id, 'student_id' => $completion->student_id,
                'status' => $completion->status, 'notes' => $completion->notes, 'recorded_at' => $completion->recorded_at?->toISOString()]]);
        }, 3);
    }

    public function destroyCompletion(Request $request, Homework $homework, HomeworkCompletion $completion, AuditLogger $auditLogger)
    {
        return DB::transaction(function () use ($request, $homework, $completion, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $this->assertOwner($user);
            $document = $this->access->document($user, Homework::class, $homework->id, true);
            abort_unless((int) $completion->homework_id === (int) $document->id, 404);
            abort_unless(in_array($document->status, ['published', 'closed'], true), 409, 'Completion can only be changed for published or closed homework.');
            $record = HomeworkCompletion::whereKey($completion->id)->lockForUpdate()->firstOrFail();
            $record->delete();
            $auditLogger->log('DELETE_HOMEWORK_COMPLETION', 'HomeworkCompletion', $record->id, [
                'homework_id' => $document->id, 'student_id' => $record->student_id, 'reason' => 'teacher_removed_record',
            ]);

            return response()->json(['data' => ['message' => 'Completion record removed.']]);
        }, 3);
    }

    public function pdf(Request $request, Homework $homework)
    {
        $user = $this->access->user($request->user());
        $document = $this->access->document($user, Homework::class, $homework->id)->load(TeachingDocumentData::HOMEWORK_RELATIONS);

        return $this->render('teaching.homework-worksheet', $this->export->worksheet($document), 'homework-'.$document->id.'.pdf');
    }

    public function answerKeyPdf(Request $request, Homework $homework)
    {
        $user = $this->access->user($request->user());
        $document = $this->access->document($user, Homework::class, $homework->id)->load(TeachingDocumentData::HOMEWORK_RELATIONS);

        return $this->render('teaching.homework-answer-key', $this->export->answerKey($document), 'homework-'.$document->id.'-answer-key.pdf');
    }

    private function render(string $view, array $input, string $filename)
    {
        try {
            return Pdf::loadView($view, ['document' => $input])->download($filename);
        } catch (\Throwable $exception) {
            report($exception);

            throw new HttpResponseException(response()->json(['error' => ['code' => 'DOCUMENT_EXPORT_FAILED', 'message' => 'The document could not be exported. No file was produced.']], 503));
        }
    }

    private function homeworkRules(bool $updating = false): array
    {
        $required = $updating ? ['sometimes', 'required'] : ['required'];

        return [
            'class_subject_teacher_id' => $updating ? ['prohibited'] : ['required', 'integer', 'exists:class_subject_teacher,id'],
            'lesson_plan_id' => ['sometimes', 'nullable', 'integer', 'exists:lesson_plans,id'],
            'scheme_of_work_week_id' => ['sometimes', 'nullable', 'integer', 'exists:scheme_of_work_weeks,id'],
            'title' => [...$required, 'string', 'max:160'],
            'instructions' => [...$required, 'string', 'max:8000'],
            'learning_outcomes' => [...$required, 'string', 'max:8000'],
            'total_marks' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000'],
            'assigned_on' => [...$required, 'date'],
            'due_on' => [...$required, 'date'],
            'submission_method' => [...$required, Rule::in(self::SUBMISSION_METHODS)],
            'teacher_notes' => ['sometimes', 'nullable', 'string', 'max:4000'],
        ];
    }

    private function questionRules(bool $updating = false): array
    {
        $required = $updating ? ['sometimes', 'required'] : ['required'];

        return [
            'position' => [...$required, 'integer', 'min:1', 'max:100'],
            'question_type' => [...$required, Rule::in(HomeworkQuestion::TYPES)],
            'prompt' => [...$required, 'string', 'max:4000'],
            'marks' => [...$required, 'integer', 'min:1', 'max:1000'],
            'diagram_reference' => ['sometimes', 'nullable', 'string', 'max:255'],
            'options' => ['sometimes', 'nullable', 'array'],
            'options.*' => ['string', 'max:255'],
            'answer_key' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'marking_guidance' => ['sometimes', 'nullable', 'string', 'max:4000'],
        ];
    }

    private function preparedValues(ClassSubjectTeacher $assignment, array $values): array
    {
        $assigned = $this->assertWithinTerm($assignment, $values['assigned_on'], 'assigned_on');
        $due = $this->assertWithinTerm($assignment, $values['due_on'], 'due_on');
        if ($due < $assigned) {
            throw ValidationException::withMessages(['due_on' => 'The due date must be on or after the assigned date.']);
        }
        $values['assigned_on'] = $assigned;
        $values['due_on'] = $due;
        $values['teacher_notes'] = trim($values['teacher_notes'] ?? '') ?: null;

        return array_replace($values, [
            'lesson_plan_id' => $this->assertLessonPlan($assignment, $values['lesson_plan_id'] ?? null),
            'scheme_of_work_week_id' => $this->assertSchemeWeek($assignment, $values['scheme_of_work_week_id'] ?? null),
        ]);
    }

    private function preparedQuestion(array $values): array
    {
        $values['prompt'] = trim($values['prompt']);
        $values['diagram_reference'] = trim($values['diagram_reference'] ?? '') ?: null;
        $values['marking_guidance'] = trim($values['marking_guidance'] ?? '') ?: null;
        if ($values['question_type'] === 'multiple_choice') {
            $options = array_values(array_filter(array_map(fn ($option) => trim((string) $option), $values['options'] ?? []), fn ($option) => $option !== ''));
            if (count($options) < 2) {
                throw ValidationException::withMessages(['options' => 'Multiple-choice questions need at least two options.']);
            }
            $answer = trim($values['answer_key'] ?? '');
            if ($answer === '' || ! in_array($answer, $options, true)) {
                throw ValidationException::withMessages(['answer_key' => 'The answer key must match one of the listed options.']);
            }
            $values['options'] = json_encode($options);
            $values['answer_key'] = $answer;

            return $values;
        }
        if (! empty($values['options'])) {
            throw ValidationException::withMessages(['options' => 'Only multiple-choice questions can list options.']);
        }
        $values['options'] = null;
        $values['answer_key'] = trim($values['answer_key'] ?? '') ?: null;

        return $values;
    }

    private function assertWithinTerm(ClassSubjectTeacher $assignment, string $date, string $field): string
    {
        $term = Term::whereKey($assignment->term_id)->lockForUpdate()->firstOrFail();
        $date = Carbon::parse($date)->toDateString();
        if ($date < $term->start_date->toDateString() || $date > $term->end_date->toDateString()) {
            throw ValidationException::withMessages([$field => 'The date must fall within the assigned academic term.']);
        }

        return $date;
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

    private function assertSchemeWeek(ClassSubjectTeacher $assignment, ?int $weekId): ?int
    {
        if ($weekId === null) return null;
        $week = SchemeOfWorkWeek::whereKey($weekId)->lockForUpdate()->firstOrFail();
        $owner = SchemeOfWork::whereKey($week->scheme_of_work_id)->lockForUpdate()->value('class_subject_teacher_id');
        if ((int) $owner !== (int) $assignment->id) {
            throw ValidationException::withMessages(['scheme_of_work_week_id' => 'The selected scheme of work entry does not belong to this teaching allocation.']);
        }

        return $week->id;
    }

    private function homeworkValues(Homework $homework): array
    {
        return [
            'lesson_plan_id' => $homework->lesson_plan_id,
            'scheme_of_work_week_id' => $homework->scheme_of_work_week_id,
            'title' => $homework->title,
            'instructions' => $homework->instructions,
            'learning_outcomes' => $homework->learning_outcomes,
            'total_marks' => $homework->total_marks,
            'assigned_on' => $homework->assigned_on?->toDateString(),
            'due_on' => $homework->due_on?->toDateString(),
            'submission_method' => $homework->submission_method,
            'teacher_notes' => $homework->teacher_notes,
        ];
    }

    private function questionValues(HomeworkQuestion $question): array
    {
        return [
            'position' => $question->position,
            'question_type' => $question->question_type,
            'prompt' => $question->prompt,
            'marks' => $question->marks,
            'diagram_reference' => $question->diagram_reference,
            'options' => $question->optionList(),
            'answer_key' => $question->answer_key,
            'marking_guidance' => $question->marking_guidance,
        ];
    }

    private function assertEditable(Homework $homework): void
    {
        abort_unless($homework->status === 'draft', 409, 'Published, closed and archived homework cannot be edited.');
    }

    /** State transitions that publish or close a class assignment are teacher-owned. */
    private function assertOwner(User $user): void
    {
        abort_unless(! $this->access->leader($user), 403, 'Only the assigned teacher can publish, close or archive homework.');
    }

    private function transition(Request $request, Homework $homework, AuditLogger $auditLogger, ?string $from, string $to, string $stamp, string $action)
    {
        return DB::transaction(function () use ($request, $homework, $auditLogger, $from, $to, $stamp, $action) {
            $user = $this->access->user($request->user(), true);
            $this->assertOwner($user);
            $document = $this->access->document($user, Homework::class, $homework->id, true);
            abort_unless($from === null ? in_array($document->status, ['published', 'closed'], true) : $document->status === $from, 409, 'This homework cannot move to '.$to.' from its current status.');
            $document->update(['status' => $to, $stamp => now()]);
            $auditLogger->log($action, 'Homework', $document->id, ['class_subject_teacher_id' => $document->class_subject_teacher_id]);

            return response()->json(['data' => $this->data->homeworkSummary($document->fresh(TeachingDocumentData::HOMEWORK_RELATIONS), $this->eligibleCount($document))]);
        }, 3);
    }

    private function learners(Homework $homework)
    {
        return Student::where('class_id', $homework->assignment?->class_id)->where('status', 'active')
            ->orderBy('first_name')->orderBy('last_name')->orderBy('id');
    }

    private function eligibleCount(Homework $homework): int
    {
        return $homework->assignment ? $this->learners($homework)->count() : 0;
    }

    private function assertEligibleLearner(Homework $homework, int $studentId): void
    {
        if (! $this->learners($homework)->whereKey($studentId)->exists()) {
            throw ValidationException::withMessages(['student_id' => 'This learner is not an active member of the assigned class.']);
        }
    }

    private function conflict(string $code, string $message)
    {
        return response()->json(['error' => compact('code', 'message')], 409);
    }
}
