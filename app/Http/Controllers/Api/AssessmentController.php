<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\AssessmentResource;
use App\Models\Assessment;
use App\Models\ClassSubjectTeacher;
use App\Models\SchoolClass;
use App\Models\Student;
use App\Models\Subject;
use App\Models\Term;
use App\Services\AssessmentAccess;
use App\Services\AssessmentHistory;
use App\Services\AuditLogger;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AssessmentController extends Controller
{
    private AssessmentAccess $access;
    private AssessmentHistory $history;

    public function __construct(?AssessmentAccess $access = null, ?AssessmentHistory $history = null)
    {
        $this->access = $access ?? new AssessmentAccess();
        $this->history = $history ?? new AssessmentHistory();
    }

    public function context(Request $request)
    {
        $user = $this->access->user($request->user());
        $data = ['assessment_types' => AssessmentHistory::TYPES, 'competency_ratings' => AssessmentHistory::LEVELS];
        if ($this->access->leader($user)) {
            return response()->json(['data' => $data + [
                'scope' => 'school', 'assignments' => [],
                'classes' => SchoolClass::orderBy('sequence')->orderBy('name')->get(['id', 'name', 'level']),
                'subjects' => Subject::where('status', 'active')->orderBy('name')->get(['id', 'name', 'code']),
                'offerings' => DB::table('class_subjects')->get(['id', 'class_id', 'subject_id']),
                'terms' => Term::with('academicYear:id,name')->orderByDesc('start_date')->get(['id', 'academic_year_id', 'name', 'start_date', 'end_date', 'is_current']),
            ]]);
        }
        $staff = $this->access->staff($user);
        $assignments = ClassSubjectTeacher::with([
            'schoolClass:id,name,level', 'subject:id,name,code,status',
            'term:id,academic_year_id,name,start_date,end_date,is_current', 'term.academicYear:id,name',
        ])->where('staff_id', $staff->id)->orderBy('term_id')->orderBy('class_id')->get()
            ->map(fn ($assignment) => $assignment->only(['class_id', 'subject_id', 'term_id']) + [
                'school_class' => $assignment->schoolClass, 'subject' => $assignment->subject, 'term' => $assignment->term,
            ]);
        return response()->json(['data' => $data + ['scope' => 'assigned', 'assignments' => $assignments, 'classes' => [], 'subjects' => [], 'terms' => []]]);
    }

    public function learners(Request $request)
    {
        $validated = $request->validate($this->contextRules());
        $context = $this->access->context($request->user(), $validated);
        $leader = $this->access->leader($context['user']);
        $students = Student::where('class_id', $validated['class_id'])->where('status', 'active')
            ->with(['assessments' => fn ($query) => $query->where('subject_id', $validated['subject_id'])
                ->where('term_id', $validated['term_id'])->where('assessment_type', $validated['assessment_type'])])
            ->orderBy('first_name')->orderBy('last_name')->get(['id', 'admission_no', 'first_name', 'last_name', 'class_id'])
            ->map(function ($student) use ($request, $leader, $validated) {
                $assessment = $student->assessments->first();
                $legacy = $assessment && ! $assessment->context_snapshot;
                $conflict = $assessment && $assessment->class_id !== null && (int) $assessment->class_id !== (int) $validated['class_id'];
                return $student->only(['id', 'admission_no', 'first_name', 'last_name', 'class_id']) + [
                    'assessment' => $assessment && ! $conflict && (! $legacy || $leader) ? (new AssessmentResource($assessment))->resolve($request) : null,
                    'context_state' => $conflict ? 'historical_context_conflict' : ($legacy ? 'legacy_unresolved' : 'current'),
                    'editable' => ! $conflict && (! $legacy || $leader),
                ];
            });
        return response()->json(['data' => $students]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $this->access->user($request->user());
        $validated = $request->validate($this->contextRules() + [
            'student_id' => ['required', 'integer', 'exists:students,id'],
            'score' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:100'],
            'competency_rating' => ['sometimes', 'nullable', Rule::in(AssessmentHistory::LEVELS)],
            'remarks' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'expected_revision' => ['sometimes', 'integer', 'min:0'],
        ]);
        try {
            return DB::transaction(function () use ($request, $validated, $auditLogger) {
                $context = $this->access->context($request->user(), $validated, true);
                $student = Student::whereKey($validated['student_id'])->lockForUpdate()->firstOrFail();
                abort_unless((int) $student->class_id === (int) $context['class']->id && $student->status === 'active', 403, 'The learner is not an active member of the authorized class.');
                $identity = array_intersect_key($validated, array_flip(['student_id', 'subject_id', 'term_id', 'assessment_type']));
                $assessment = Assessment::where($identity)->lockForUpdate()->first();
                $created = ! $assessment;
                if ($assessment && $assessment->class_id !== null && (int) $assessment->class_id !== (int) $context['class']->id) {
                    return $this->conflict('HISTORICAL_CONTEXT_CONFLICT', 'This logical result belongs to a different captured class. Its history cannot be moved into the selected class.');
                }
                if ($assessment && ! $assessment->context_snapshot && ! $this->access->leader($context['user'])) {
                    abort(403, 'Legacy assessment context is unresolved. Leadership must review corrections; original context remains unknown.');
                }
                if (isset($validated['expected_revision']) && (int) $validated['expected_revision'] !== (int) ($assessment?->revision_number ?? 0)) {
                    return $this->conflict('REVISION_CONFLICT', 'The result changed after loading. Reload it before correcting.');
                }
                $values = array_replace([
                    'score' => $assessment?->score, 'competency_rating' => $assessment?->competency_rating, 'remarks' => $assessment?->remarks,
                ], array_intersect_key($validated, array_flip(['score', 'competency_rating', 'remarks'])));
                $values['score'] = $values['score'] === null ? null : number_format((float) $values['score'], 2, '.', '');
                $remarks = trim($values['remarks'] ?? '');
                $values['remarks'] = $remarks === '' ? null : $remarks;
                if ($values['score'] === null && $values['competency_rating'] === null && $values['remarks'] === null) {
                    throw ValidationException::withMessages(['score' => 'Provide a score, performance level, or meaningful remark. A completely empty result cannot be saved.']);
                }
                $authority = $context['assignment'] ? 'teacher_assignment' : 'leadership';
                if ($assessment) {
                    $this->history->baseline($assessment, $auditLogger);
                    $unchanged = $assessment->score === $values['score'] && $assessment->competency_rating === $values['competency_rating'] && $assessment->remarks === $values['remarks'];
                    if ($unchanged) return response()->json(['data' => (new AssessmentResource($assessment))->resolve($request), 'meta' => ['operation' => 'unchanged']]);
                    $assessment->update($values + ['recorded_by' => $context['user']->id, 'recorded_at' => now()]);
                } else {
                    $assessment = Assessment::create($identity + $values + [
                        'recorded_by' => $context['user']->id, 'recorded_at' => now(),
                        'class_id' => $context['class']->id, 'class_subject_id' => $context['offering']->id,
                        'authorization_assignment_id' => $context['assignment']?->id, 'authority_type' => $authority,
                        'context_snapshot' => $this->history->snapshot($context, $validated['assessment_type']), 'revision_number' => 0,
                    ]);
                }
                $revision = $this->history->append($assessment, $created ? 'creation' : 'correction', $authority, $context['user']->id, $context['assignment']?->id);
                $auditLogger->log($created ? 'RECORD_ASSESSMENT' : 'UPDATE_ASSESSMENT', 'Assessment', $assessment->id, [
                    'revision_number' => $revision->revision_number, 'authority' => $authority,
                    'context_state' => $assessment->context_snapshot ? 'captured' : 'legacy_unresolved',
                ]);
                return response()->json(['data' => (new AssessmentResource($assessment))->resolve($request), 'meta' => ['operation' => $created ? 'created' : 'corrected']], $created ? 201 : 200);
            }, 3);
        } catch (QueryException $exception) {
            if (in_array((string) $exception->getCode(), ['23000', '23505'], true) && (str_contains($exception->getMessage(), 'uq_assessment_student_subject_term_type') || str_contains($exception->getMessage(), 'assessments.student_id'))) {
                return $this->conflict('RESULT_CONFLICT', 'Another request saved this logical result. Reload before retrying.');
            }
            report($exception);
            throw new HttpResponseException(response()->json(['error' => ['code' => 'ASSESSMENT_SAVE_FAILED', 'message' => 'The result could not be saved. No result or revision was committed.']], 503));
        } catch (\Throwable $exception) {
            if ($exception instanceof ValidationException || $exception instanceof \Symfony\Component\HttpKernel\Exception\HttpException || $exception instanceof HttpResponseException) throw $exception;
            report($exception);
            throw new HttpResponseException(response()->json(['error' => ['code' => 'ASSESSMENT_SAVE_FAILED', 'message' => 'The result could not be saved. No result or revision was committed.']], 503));
        }
    }

    public function index(Request $request)
    {
        $filters = $request->validate([
            'student_id' => ['sometimes', 'integer', 'exists:students,id'], 'class_id' => ['sometimes', 'integer', 'exists:classes,id'],
            'subject_id' => ['sometimes', 'integer', 'exists:subjects,id'], 'term_id' => ['sometimes', 'integer', 'exists:terms,id'],
            'assessment_type' => ['sometimes', Rule::in(AssessmentHistory::TYPES)],
            'page' => ['sometimes', 'integer', 'min:1'], 'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        $query = $this->access->readable($request->user())->with('subject:id,name,code', 'term:id,name', 'student:id,first_name,last_name,admission_no');
        foreach (['student_id', 'class_id', 'subject_id', 'term_id', 'assessment_type'] as $field) if (isset($filters[$field])) $query->where($field, $filters[$field]);
        $rows = $query->orderByDesc('recorded_at')->orderByDesc('id')->paginate($filters['per_page'] ?? 25);
        return response()->json(['data' => $rows->getCollection()->map(fn ($assessment) => (new AssessmentResource($assessment))->resolve($request)),
            'meta' => ['page' => $rows->currentPage(), 'per_page' => $rows->perPage(), 'total' => $rows->total()]]);
    }

    public function revisions(Request $request, Assessment $assessment)
    {
        $this->access->leadership($request->user());
        $filters = $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);
        $rows = $assessment->revisions()->with('actor:id,username')->orderByDesc('revision_number')->paginate(25);
        return response()->json(['data' => $rows->getCollection()->map(fn ($revision) => [
            'revision_number' => $revision->revision_number, 'score' => $revision->score, 'competency_rating' => $revision->competency_rating,
            'remarks' => $revision->remarks, 'change_type' => $revision->change_type, 'authority' => $revision->authority_type,
            'actor' => $revision->actor?->username, 'saved_at' => $revision->recorded_at?->toISOString(),
            'context_state' => $revision->context_snapshot ? 'captured' : 'legacy_unresolved',
        ]), 'meta' => ['page' => $rows->currentPage(), 'per_page' => 25, 'total' => $rows->total()]]);
    }

    private function contextRules(): array
    {
        return ['class_id' => ['required', 'integer', 'exists:classes,id'], 'subject_id' => ['required', 'integer', 'exists:subjects,id'],
            'term_id' => ['required', 'integer', 'exists:terms,id'], 'assessment_type' => ['required', Rule::in(AssessmentHistory::TYPES)]];
    }

    private function conflict(string $code, string $message) { return response()->json(['error' => compact('code', 'message')], 409); }
}
