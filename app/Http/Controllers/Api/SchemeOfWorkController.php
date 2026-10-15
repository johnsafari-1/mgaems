<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClassSubjectTeacher;
use App\Models\Homework;
use App\Models\LessonPlan;
use App\Models\SchemeOfWork;
use App\Models\SchemeOfWorkWeek;
use App\Services\AuditLogger;
use App\Services\TeachingDocumentAccess;
use App\Services\TeachingDocumentData;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class SchemeOfWorkController extends Controller
{
    private const ASSIGNMENT_RELATIONS = TeachingDocumentData::ASSIGNMENT_RELATIONS;

    public function __construct(private TeachingDocumentAccess $access, private TeachingDocumentData $data)
    {
    }

    public function context(Request $request)
    {
        $user = $this->access->user($request->user());
        $query = ClassSubjectTeacher::with(self::ASSIGNMENT_RELATIONS)->orderBy('term_id')->orderBy('class_id')->orderBy('subject_id');
        $scope = 'school';
        if (! $this->access->leader($user)) {
            $query->where('staff_id', $this->access->staff($user)->id);
            $scope = 'assigned';
        }

        return response()->json(['data' => ['scope' => $scope, 'assignments' => $query->get()->map(fn ($assignment) => $this->assignmentData($assignment))]]);
    }

    public function index(Request $request)
    {
        $user = $this->access->user($request->user());
        $filters = $request->validate([
            'term_id' => ['sometimes', 'integer', 'exists:terms,id'],
            'class_id' => ['sometimes', 'integer', 'exists:classes,id'],
            'status' => ['sometimes', Rule::in(['draft', 'submitted', 'returned', 'approved'])],
        ]);
        $schemes = $this->access->readable($user, SchemeOfWork::class);
        $schemes->with(self::schemeRelations())
            ->when($filters['term_id'] ?? null, fn ($query, $id) => $query->whereHas('assignment', fn ($assignment) => $assignment->where('term_id', $id)))
            ->when($filters['class_id'] ?? null, fn ($query, $id) => $query->whereHas('assignment', fn ($assignment) => $assignment->where('class_id', $id)))
            ->when($filters['status'] ?? null, fn ($query, $status) => $query->where('status', $status));

        return response()->json(['data' => $schemes->orderByDesc('updated_at')->orderByDesc('id')->get()->map(fn ($scheme) => $this->schemeData($scheme))]);
    }

    public function show(Request $request, SchemeOfWork $schemeOfWork)
    {
        $user = $this->access->user($request->user());
        $scheme = $this->access->document($user, SchemeOfWork::class, $schemeOfWork->id)->load(self::schemeRelations(), 'weeks');

        return response()->json(['data' => $this->schemeData($scheme, true)]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'class_subject_teacher_id' => ['required', 'integer', 'exists:class_subject_teacher,id'],
            'title' => ['required', 'string', 'max:160'],
            'curriculum_reference' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        return DB::transaction(function () use ($request, $validated, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $assignment = $this->access->assignment($user, (int) $validated['class_subject_teacher_id'], true);
            if (SchemeOfWork::where('class_subject_teacher_id', $assignment->id)->lockForUpdate()->exists()) {
                return $this->conflict('SCHEME_EXISTS', 'A scheme of work already exists for this class, learning area, teacher and term allocation.');
            }
            $scheme = SchemeOfWork::create($validated + ['status' => 'draft', 'created_by' => $user->id]);
            $auditLogger->log('CREATE_SCHEME_OF_WORK', 'SchemeOfWork', $scheme->id, ['class_subject_teacher_id' => $assignment->id]);

            return response()->json(['data' => $this->schemeData($scheme->load(self::schemeRelations()))], 201);
        }, 3);
    }

    public function update(Request $request, SchemeOfWork $schemeOfWork, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:160'],
            'curriculum_reference' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        return DB::transaction(function () use ($request, $validated, $schemeOfWork, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $scheme = $this->access->document($user, SchemeOfWork::class, $schemeOfWork->id, true);
            $this->assertEditable($scheme);
            $scheme->update($validated);
            $auditLogger->log('UPDATE_SCHEME_OF_WORK', 'SchemeOfWork', $scheme->id, array_keys($validated));

            return response()->json(['data' => $this->schemeData($scheme->load(self::schemeRelations()))]);
        }, 3);
    }

    public function storeWeek(Request $request, SchemeOfWork $schemeOfWork, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->weekRules());

        return DB::transaction(function () use ($request, $validated, $schemeOfWork, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $scheme = $this->access->document($user, SchemeOfWork::class, $schemeOfWork->id, true)->load('assignment.term');
            $this->assertEditable($scheme);
            $values = $this->weekDates($scheme, $validated);
            if ($scheme->weeks()->where('week_number', $values['week_number'])->lockForUpdate()->exists()) {
                return $this->conflict('WEEK_EXISTS', 'This scheme already has a plan for that week number.');
            }
            $week = $scheme->weeks()->create($values);
            $auditLogger->log('CREATE_SCHEME_OF_WORK_WEEK', 'SchemeOfWorkWeek', $week->id, ['scheme_of_work_id' => $scheme->id, 'week_number' => $week->week_number]);

            return response()->json(['data' => $this->weekData($week)], 201);
        }, 3);
    }

    public function updateWeek(Request $request, SchemeOfWork $schemeOfWork, SchemeOfWorkWeek $week, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->weekRules(true));

        return DB::transaction(function () use ($request, $validated, $schemeOfWork, $week, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $scheme = $this->access->document($user, SchemeOfWork::class, $schemeOfWork->id, true)->load('assignment.term');
            abort_unless((int) $week->scheme_of_work_id === (int) $scheme->id, 404);
            $this->assertEditable($scheme);
            $week = SchemeOfWorkWeek::whereKey($week->id)->lockForUpdate()->firstOrFail();
            $values = $this->weekDates($scheme, array_replace($this->weekValues($week), $validated));
            if (SchemeOfWorkWeek::where('scheme_of_work_id', $scheme->id)->where('week_number', $values['week_number'])->where('id', '!=', $week->id)->lockForUpdate()->exists()) {
                return $this->conflict('WEEK_EXISTS', 'This scheme already has a plan for that week number.');
            }
            $week->update($values);
            $auditLogger->log('UPDATE_SCHEME_OF_WORK_WEEK', 'SchemeOfWorkWeek', $week->id, ['scheme_of_work_id' => $scheme->id, 'week_number' => $week->week_number]);

            return response()->json(['data' => $this->weekData($week)]);
        }, 3);
    }

    public function destroyWeek(Request $request, SchemeOfWork $schemeOfWork, SchemeOfWorkWeek $week, AuditLogger $auditLogger)
    {
        return DB::transaction(function () use ($request, $schemeOfWork, $week, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $scheme = $this->access->document($user, SchemeOfWork::class, $schemeOfWork->id, true);
            abort_unless((int) $week->scheme_of_work_id === (int) $scheme->id, 404);
            $this->assertEditable($scheme);
            $week = SchemeOfWorkWeek::whereKey($week->id)->lockForUpdate()->firstOrFail();
            // Planned teaching keeps its link to this weekly entry; deleting the
            // entry would silently discard teaching history.
            if (LessonPlan::where('scheme_of_work_week_id', $week->id)->exists() || Homework::where('scheme_of_work_week_id', $week->id)->exists()) {
                return $this->conflict('WEEK_IN_USE', 'A lesson plan or homework is linked to this weekly plan. Remove or re-link it before deleting the week.');
            }
            $week->delete();
            $auditLogger->log('DELETE_SCHEME_OF_WORK_WEEK', 'SchemeOfWorkWeek', $week->id, ['scheme_of_work_id' => $scheme->id]);

            return response()->json(['data' => ['message' => 'Weekly plan deleted.']]);
        }, 3);
    }

    public function submit(Request $request, SchemeOfWork $schemeOfWork, AuditLogger $auditLogger)
    {
        return DB::transaction(function () use ($request, $schemeOfWork, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            abort_unless(! $this->access->leader($user), 403, 'Only the assigned teacher can submit a scheme for review.');
            $scheme = $this->access->document($user, SchemeOfWork::class, $schemeOfWork->id, true);
            abort_unless(in_array($scheme->status, ['draft', 'returned'], true), 409, 'Only draft or returned schemes can be submitted.');
            if (! $scheme->weeks()->lockForUpdate()->exists()) {
                throw ValidationException::withMessages(['weeks' => 'Add at least one complete weekly plan before submitting for review.']);
            }
            $scheme->update(['status' => 'submitted', 'submitted_at' => now()]);
            $auditLogger->log('SUBMIT_SCHEME_OF_WORK', 'SchemeOfWork', $scheme->id, ['class_subject_teacher_id' => $scheme->class_subject_teacher_id]);

            return response()->json(['data' => $this->schemeData($scheme->load(self::schemeRelations()))]);
        }, 3);
    }

    public function review(Request $request, SchemeOfWork $schemeOfWork, AuditLogger $auditLogger)
    {
        $validated = $request->validate([
            'action' => ['required', Rule::in(['approved', 'returned'])],
            'review_notes' => ['nullable', 'string', 'max:4000', 'required_if:action,returned'],
        ]);

        return DB::transaction(function () use ($request, $validated, $schemeOfWork, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            abort_unless($this->access->leader($user), 403, 'Scheme reviews require school leadership.');
            $scheme = $this->access->document($user, SchemeOfWork::class, $schemeOfWork->id, true);
            abort_unless($scheme->status === 'submitted', 409, 'Only submitted schemes can be reviewed.');
            $scheme->update([
                'status' => $validated['action'],
                'review_notes' => $validated['review_notes'] ?? null,
                'reviewed_by' => $user->id,
                'reviewed_at' => now(),
            ]);
            $auditLogger->log(strtoupper($validated['action']).'_SCHEME_OF_WORK', 'SchemeOfWork', $scheme->id, ['class_subject_teacher_id' => $scheme->class_subject_teacher_id]);

            return response()->json(['data' => $this->schemeData($scheme->load(self::schemeRelations()))]);
        }, 3);
    }

    private static function schemeRelations(): array
    {
        return TeachingDocumentData::SCHEME_RELATIONS;
    }

    private function assertEditable(SchemeOfWork $scheme): void
    {
        abort_unless(in_array($scheme->status, ['draft', 'returned'], true), 409, 'Submitted and approved schemes are read-only until returned for changes.');
    }

    private function weekRules(bool $updating = false): array
    {
        $required = $updating ? ['sometimes', 'required'] : ['required'];

        return [
            'week_number' => [...$required, 'integer', 'min:1', 'max:53'],
            'starts_on' => ['sometimes', 'nullable', 'date'],
            'ends_on' => ['sometimes', 'nullable', 'date'],
            'strand' => [...$required, 'string', 'max:255'],
            'sub_strand' => [...$required, 'string', 'max:255'],
            'learning_outcomes' => [...$required, 'string', 'max:8000'],
            'learning_activities' => [...$required, 'string', 'max:8000'],
            'resources' => [...$required, 'string', 'max:8000'],
        ];
    }

    private function weekDates(SchemeOfWork $scheme, array $values): array
    {
        $starts = $values['starts_on'] ?? null;
        $ends = $values['ends_on'] ?? null;
        if (($starts === null) !== ($ends === null)) {
            throw ValidationException::withMessages(['starts_on' => 'Provide both weekly start and end dates, or leave both blank.']);
        }
        if ($starts === null) return $values;
        $starts = Carbon::parse($starts)->toDateString();
        $ends = Carbon::parse($ends)->toDateString();
        if ($starts > $ends) throw ValidationException::withMessages(['ends_on' => 'The weekly end date must be on or after the start date.']);
        $term = $scheme->assignment->term;
        if ($starts < $term->start_date->toDateString() || $ends > $term->end_date->toDateString()) {
            throw ValidationException::withMessages(['starts_on' => 'Weekly plan dates must fall within the assigned term.']);
        }

        return array_replace($values, ['starts_on' => $starts, 'ends_on' => $ends]);
    }

    private function weekValues(SchemeOfWorkWeek $week): array
    {
        return [
            'week_number' => $week->week_number,
            'starts_on' => $week->starts_on?->toDateString(),
            'ends_on' => $week->ends_on?->toDateString(),
            'strand' => $week->strand,
            'sub_strand' => $week->sub_strand,
            'learning_outcomes' => $week->learning_outcomes,
            'learning_activities' => $week->learning_activities,
            'resources' => $week->resources,
        ];
    }

    private function assignmentData(ClassSubjectTeacher $assignment): array
    {
        return $this->data->assignment($assignment);
    }

    private function schemeData(SchemeOfWork $scheme, bool $detail = false): array
    {
        return [
            'id' => $scheme->id,
            'class_subject_teacher_id' => $scheme->class_subject_teacher_id,
            'title' => $scheme->title,
            'curriculum_reference' => $scheme->curriculum_reference,
            'status' => $scheme->status,
            'review_notes' => $scheme->review_notes,
            'submitted_at' => $scheme->submitted_at?->toISOString(),
            'reviewed_at' => $scheme->reviewed_at?->toISOString(),
            'created_at' => $scheme->created_at?->toISOString(),
            'updated_at' => $scheme->updated_at?->toISOString(),
            'assignment' => $this->assignmentData($scheme->assignment),
            ...($detail ? ['weeks' => $scheme->weeks->map(fn ($week) => $this->weekData($week))->values()] : []),
        ];
    }

    private function weekData(SchemeOfWorkWeek $week): array
    {
        return [
            'id' => $week->id,
            'week_number' => $week->week_number,
            'starts_on' => $week->starts_on?->toDateString(),
            'ends_on' => $week->ends_on?->toDateString(),
            'strand' => $week->strand,
            'sub_strand' => $week->sub_strand,
            'learning_outcomes' => $week->learning_outcomes,
            'learning_activities' => $week->learning_activities,
            'resources' => $week->resources,
        ];
    }

    private function conflict(string $code, string $message)
    {
        return response()->json(['error' => compact('code', 'message')], 409);
    }
}
