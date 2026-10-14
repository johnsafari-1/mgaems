<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClassSubjectTeacher;
use App\Models\LessonPlan;
use App\Models\SchemeOfWork;
use App\Models\SchemeOfWorkWeek;
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

class LessonPlanController extends Controller
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
        $schemes = $this->access->readable($user, SchemeOfWork::class)
            ->with('weeks:id,scheme_of_work_id,week_number,strand,sub_strand,starts_on,ends_on')
            ->orderByDesc('updated_at')->orderByDesc('id')->get()
            ->map(fn ($scheme) => $scheme->only(['id', 'title', 'status', 'class_subject_teacher_id'])
                + ['weeks' => $scheme->weeks->map(fn ($week) => $week->only(['id', 'week_number', 'strand', 'sub_strand', 'starts_on', 'ends_on']))->values()]);

        return response()->json(['data' => [
            'scope' => $this->access->leader($user) ? 'school' : 'assigned',
            'assignments' => $assignments->map(fn ($assignment) => $this->data->assignment($assignment)),
            'schemes' => $schemes,
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
        $plans = $this->access->readable($user, LessonPlan::class)
            ->with(TeachingDocumentData::LESSON_PLAN_RELATIONS)
            ->when($filters['term_id'] ?? null, fn ($query, $id) => $query->whereHas('assignment', fn ($assignment) => $assignment->where('term_id', $id)))
            ->when($filters['class_id'] ?? null, fn ($query, $id) => $query->whereHas('assignment', fn ($assignment) => $assignment->where('class_id', $id)))
            ->when($filters['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
            ->when($filters['from'] ?? null, fn ($query, $date) => $query->where('lesson_date', '>=', $date))
            ->when($filters['to'] ?? null, fn ($query, $date) => $query->where('lesson_date', '<=', $date));

        return response()->json(['data' => $plans->orderBy('lesson_date')->orderBy('id')->get()->map(fn ($plan) => $this->data->lessonPlan($plan))]);
    }

    public function show(Request $request, LessonPlan $lessonPlan)
    {
        $user = $this->access->user($request->user());
        $plan = $this->access->document($user, LessonPlan::class, $lessonPlan->id)->load(TeachingDocumentData::LESSON_PLAN_RELATIONS);

        return response()->json(['data' => $this->data->lessonPlan($plan)]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->planRules());

        return DB::transaction(function () use ($request, $validated, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $assignment = $this->access->assignment($user, (int) $validated['class_subject_teacher_id'], true);
            $values = $this->preparedValues($assignment, $validated);
            $values['title'] = $this->title($validated);
            $values['teacher_reflection'] = null;
            $plan = LessonPlan::create($values + ['status' => 'draft', 'created_by' => $user->id]);
            $auditLogger->log('CREATE_LESSON_PLAN', 'LessonPlan', $plan->id, [
                'class_subject_teacher_id' => $assignment->id, 'lesson_date' => $plan->lesson_date?->toDateString(),
            ]);

            return response()->json(['data' => $this->data->lessonPlan($plan->load(TeachingDocumentData::LESSON_PLAN_RELATIONS))], 201);
        }, 3);
    }

    public function update(Request $request, LessonPlan $lessonPlan, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->planRules(true));

        return DB::transaction(function () use ($request, $validated, $lessonPlan, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $plan = $this->access->document($user, LessonPlan::class, $lessonPlan->id, true);
            $this->assertEditable($plan);
            $values = $this->preparedValues($plan->assignment, array_replace($this->planValues($plan), $validated));
            $plan->update($values);
            $auditLogger->log('UPDATE_LESSON_PLAN', 'LessonPlan', $plan->id, ['class_subject_teacher_id' => $plan->class_subject_teacher_id]);

            return response()->json(['data' => $this->data->lessonPlan($plan->load(TeachingDocumentData::LESSON_PLAN_RELATIONS))]);
        }, 3);
    }

    public function duplicate(Request $request, LessonPlan $lessonPlan, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'lesson_date' => ['sometimes', 'required', 'date'],
            'title' => ['sometimes', 'required', 'string', 'max:160'],
            'duration_minutes' => ['sometimes', 'required', 'integer', 'min:1', 'max:600'],
            'scheme_of_work_week_id' => ['sometimes', 'nullable', 'integer', 'exists:scheme_of_work_weeks,id'],
        ]);

        return DB::transaction(function () use ($request, $validated, $lessonPlan, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $source = $this->access->document($user, LessonPlan::class, $lessonPlan->id, true)->load('assignment');
            $values = array_replace($this->planValues($source), [
                'title' => $validated['title'] ?? $source->title,
                'lesson_date' => $validated['lesson_date'] ?? $source->lesson_date?->toDateString(),
                'duration_minutes' => $validated['duration_minutes'] ?? $source->duration_minutes,
                'scheme_of_work_week_id' => array_key_exists('scheme_of_work_week_id', $validated) ? $validated['scheme_of_work_week_id'] : $source->scheme_of_work_week_id,
                'teacher_reflection' => null,
            ]);
            $values = $this->preparedValues($source->assignment, $values);
            $plan = LessonPlan::create($values + [
                'class_subject_teacher_id' => $source->class_subject_teacher_id,
                'status' => 'draft', 'created_by' => $user->id, 'duplicated_from_lesson_plan_id' => $source->id,
            ]);
            $auditLogger->log('DUPLICATE_LESSON_PLAN', 'LessonPlan', $plan->id, [
                'source_lesson_plan_id' => $source->id, 'class_subject_teacher_id' => $source->class_subject_teacher_id,
            ]);

            return response()->json(['data' => $this->data->lessonPlan($plan->load(TeachingDocumentData::LESSON_PLAN_RELATIONS))], 201);
        }, 3);
    }

    public function submit(Request $request, LessonPlan $lessonPlan, AuditLogger $auditLogger)
    {
        return DB::transaction(function () use ($request, $lessonPlan, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            abort_unless(! $this->access->leader($user), 403, 'Only the assigned teacher can submit a lesson plan for review.');
            $plan = $this->access->document($user, LessonPlan::class, $lessonPlan->id, true);
            abort_unless(in_array($plan->status, ['draft', 'returned'], true), 409, 'Only draft or returned lesson plans can be submitted.');
            $plan->update(['status' => 'submitted', 'submitted_at' => now()]);
            $auditLogger->log('SUBMIT_LESSON_PLAN', 'LessonPlan', $plan->id, ['class_subject_teacher_id' => $plan->class_subject_teacher_id]);

            return response()->json(['data' => $this->data->lessonPlan($plan->load(TeachingDocumentData::LESSON_PLAN_RELATIONS))]);
        }, 3);
    }

    public function review(Request $request, LessonPlan $lessonPlan, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'action' => ['required', Rule::in(['approved', 'returned'])],
            'review_notes' => ['nullable', 'string', 'max:4000', 'required_if:action,returned'],
        ]);

        return DB::transaction(function () use ($request, $validated, $lessonPlan, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            abort_unless($this->access->leader($user), 403, 'Lesson plan reviews require school leadership.');
            $plan = $this->access->document($user, LessonPlan::class, $lessonPlan->id, true);
            abort_unless($plan->status === 'submitted', 409, 'Only submitted lesson plans can be reviewed.');
            $plan->update([
                'status' => $validated['action'],
                'review_notes' => $validated['review_notes'] ?? null,
                'reviewed_by' => $user->id,
                'reviewed_at' => now(),
            ]);
            $auditLogger->log(strtoupper($validated['action']).'_LESSON_PLAN', 'LessonPlan', $plan->id, ['class_subject_teacher_id' => $plan->class_subject_teacher_id]);

            return response()->json(['data' => $this->data->lessonPlan($plan->load(TeachingDocumentData::LESSON_PLAN_RELATIONS))]);
        }, 3);
    }

    public function pdf(Request $request, LessonPlan $lessonPlan)
    {
        $user = $this->access->user($request->user());
        $plan = $this->access->document($user, LessonPlan::class, $lessonPlan->id)->load(TeachingDocumentData::LESSON_PLAN_RELATIONS);
        try {
            return Pdf::loadView('teaching.lesson-plan', ['document' => $this->export->lessonPlan($plan)])->download('lesson-plan-'.$plan->id.'.pdf');
        } catch (\Throwable $exception) {
            report($exception);

            throw new HttpResponseException(response()->json(['error' => ['code' => 'DOCUMENT_EXPORT_FAILED', 'message' => 'The lesson plan could not be exported. No file was produced.']], 503));
        }
    }

    private function planRules(bool $updating = false): array
    {
        $required = $updating ? ['sometimes', 'required'] : ['required'];

        return [
            'class_subject_teacher_id' => $updating ? ['prohibited'] : ['required', 'integer', 'exists:class_subject_teacher,id'],
            'scheme_of_work_week_id' => ['sometimes', 'nullable', 'integer', 'exists:scheme_of_work_weeks,id'],
            'title' => [...$required, 'string', 'max:160'],
            'lesson_date' => [...$required, 'date'],
            'duration_minutes' => [...$required, 'integer', 'min:1', 'max:600'],
            'strand' => [...$required, 'string', 'max:255'],
            'sub_strand' => [...$required, 'string', 'max:255'],
            'specific_learning_outcomes' => [...$required, 'string', 'max:8000'],
            'key_inquiry_questions' => [...$required, 'string', 'max:8000'],
            'teaching_learning_resources' => [...$required, 'string', 'max:8000'],
            'introduction' => [...$required, 'string', 'max:8000'],
            'lesson_development' => [...$required, 'string', 'max:8000'],
            'conclusion' => [...$required, 'string', 'max:8000'],
            'learning_activities' => [...$required, 'string', 'max:8000'],
            'assessment_approach' => [...$required, 'string', 'max:8000'],
            'teacher_reflection' => ['sometimes', 'nullable', 'string', 'max:8000'],
        ];
    }

    private function preparedValues(ClassSubjectTeacher $assignment, array $values): array
    {
        $this->assertWithinTerm($assignment, $values['lesson_date'], 'lesson_date');
        $values['lesson_date'] = Carbon::parse($values['lesson_date'])->toDateString();

        return $values + ['scheme_of_work_week_id' => $this->assertWeek($assignment, $values['scheme_of_work_week_id'] ?? null)];
    }

    private function assertWithinTerm(ClassSubjectTeacher $assignment, string $date, string $field): void
    {
        $term = Term::whereKey($assignment->term_id)->lockForUpdate()->firstOrFail();
        if ($date < $term->start_date->toDateString() || $date > $term->end_date->toDateString()) {
            throw ValidationException::withMessages([$field => 'The date must fall within the assigned academic term.']);
        }
    }

    private function assertWeek(ClassSubjectTeacher $assignment, ?int $weekId): ?int
    {
        if ($weekId === null) return null;
        $week = SchemeOfWorkWeek::whereKey($weekId)->lockForUpdate()->firstOrFail();
        $owner = SchemeOfWork::whereKey($week->scheme_of_work_id)->lockForUpdate()->value('class_subject_teacher_id');
        if ((int) $owner !== (int) $assignment->id) {
            throw ValidationException::withMessages(['scheme_of_work_week_id' => 'The selected weekly plan does not belong to this teaching allocation.']);
        }

        return $week->id;
    }

    private function assertEditable(LessonPlan $plan): void
    {
        abort_unless(in_array($plan->status, ['draft', 'returned'], true), 409, 'Submitted and approved lesson plans are read-only until returned for changes.');
    }

    private function title(array $values): string
    {
        return trim($values['title']);
    }

    private function planValues(LessonPlan $plan): array
    {
        return [
            'title' => $plan->title,
            'lesson_date' => $plan->lesson_date?->toDateString(),
            'duration_minutes' => $plan->duration_minutes,
            'scheme_of_work_week_id' => $plan->scheme_of_work_week_id,
            'strand' => $plan->strand,
            'sub_strand' => $plan->sub_strand,
            'specific_learning_outcomes' => $plan->specific_learning_outcomes,
            'key_inquiry_questions' => $plan->key_inquiry_questions,
            'teaching_learning_resources' => $plan->teaching_learning_resources,
            'introduction' => $plan->introduction,
            'lesson_development' => $plan->lesson_development,
            'conclusion' => $plan->conclusion,
            'learning_activities' => $plan->learning_activities,
            'assessment_approach' => $plan->assessment_approach,
            'teacher_reflection' => $plan->teacher_reflection,
        ];
    }
}
