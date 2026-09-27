<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Assessment;
use App\Models\ClassSubjectTeacher;
use App\Models\SchoolClass;
use App\Models\Student;
use App\Models\Subject;
use App\Models\Term;
use App\Services\AuditLogger;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** Implements assessment entry with assignment-level authorization. */
class AssessmentController extends Controller
{
    private const ADMIN_ROLES = ['system_admin', 'head_teacher', 'deputy_head_teacher'];

    private const ASSESSMENT_TYPES = ['continuous', 'end_term'];

    private const COMPETENCY_RATINGS = [
        'Exceeding Expectation',
        'Meeting Expectation',
        'Approaching Expectation',
        'Below Expectation',
    ];

    /** Return the selection data the assessment-entry screen is allowed to use. */
    public function context(Request $request)
    {
        $user = $request->user()->loadMissing('role', 'staff');

        if ($this->isAdministrator($user)) {
            return response()->json(['data' => [
                'scope' => 'school',
                'assignments' => [],
                'classes' => SchoolClass::query()->orderBy('sequence')->orderBy('name')->get(['id', 'name', 'level']),
                'subjects' => Subject::query()->where('status', 'active')->orderBy('name')->get(['id', 'name', 'code']),
                'terms' => Term::with('academicYear:id,name')->orderByDesc('start_date')->get(['id', 'academic_year_id', 'name', 'start_date', 'end_date', 'is_current']),
                'assessment_types' => self::ASSESSMENT_TYPES,
                'competency_ratings' => self::COMPETENCY_RATINGS,
            ]]);
        }

        if (! $user->staff) {
            return $this->forbidden('Your user account is not linked to a staff record.');
        }

        $assignments = ClassSubjectTeacher::with([
            'schoolClass:id,name,level',
            'subject:id,name,code',
            'term:id,academic_year_id,name,start_date,end_date,is_current',
            'term.academicYear:id,name',
        ])->where('staff_id', $user->staff->id)->orderBy('term_id')->orderBy('class_id')->get();

        return response()->json(['data' => [
            'scope' => 'assigned',
            'assignments' => $assignments,
            'classes' => [],
            'subjects' => [],
            'terms' => [],
            'assessment_types' => self::ASSESSMENT_TYPES,
            'competency_ratings' => self::COMPETENCY_RATINGS,
        ]]);
    }

    /** Return active learners and any result already saved for the selected context. */
    public function learners(Request $request)
    {
        $validated = $request->validate($this->contextRules());

        if (! $this->mayManageContext($request, $validated)) {
            return $this->forbidden('You are not assigned to assess this class, subject and term.');
        }

        $students = Student::query()
            ->where('class_id', $validated['class_id'])
            ->where('status', 'active')
            ->with(['assessments' => fn ($query) => $query
                ->where('subject_id', $validated['subject_id'])
                ->where('term_id', $validated['term_id'])
                ->where('assessment_type', $validated['assessment_type'])])
            ->orderBy('first_name')->orderBy('last_name')
            ->get(['id', 'admission_no', 'first_name', 'last_name', 'class_id'])
            ->map(function (Student $student) {
                $student->setAttribute('assessment', $student->assessments->first());
                $student->unsetRelation('assessments');

                return $student;
            });

        return response()->json(['data' => $students]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate($this->contextRules() + [
            'student_id' => ['required', 'integer', 'exists:students,id'],
            'score' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'competency_rating' => ['nullable', Rule::in(self::COMPETENCY_RATINGS)],
            'remarks' => ['nullable', 'string'],
        ]);

        if (! $this->mayManageContext($request, $validated)) {
            return $this->forbidden('You are not assigned to assess this class, subject and term.');
        }

        $studentBelongsToClass = Student::whereKey($validated['student_id'])
            ->where('class_id', $validated['class_id'])->where('status', 'active')->exists();
        if (! $studentBelongsToClass) {
            return $this->forbidden('The learner is not an active member of the selected class.');
        }

        unset($validated['class_id']);
        $identity = collect($validated)->only(['student_id', 'subject_id', 'term_id', 'assessment_type'])->all();
        $values = collect($validated)->only(['score', 'competency_rating', 'remarks'])->all() + [
            'recorded_by' => $request->user()->id,
            'recorded_at' => now(),
        ];

        [$assessment, $created] = DB::transaction(function () use ($identity, $values) {
            $assessment = Assessment::where($identity)->lockForUpdate()->first();
            if ($assessment) {
                $assessment->fill($values)->save();

                return [$assessment, false];
            }

            return [Assessment::create($identity + $values), true];
        });

        $auditLogger->log($created ? 'RECORD_ASSESSMENT' : 'UPDATE_ASSESSMENT', 'Assessment', $assessment->id, $identity + $values);

        return response()->json(['data' => $assessment->load('subject', 'term')], $created ? 201 : 200);
    }

    public function index(Request $request)
    {
        $validated = $request->validate([
            'student_id' => ['nullable', 'integer', 'exists:students,id'],
            'subject_id' => ['nullable', 'integer', 'exists:subjects,id'],
            'term_id' => ['nullable', 'integer', 'exists:terms,id'],
            'assessment_type' => ['nullable', Rule::in(self::ASSESSMENT_TYPES)],
        ]);

        $query = Assessment::with(['subject:id,name', 'term:id,name'])
            ->when($validated['student_id'] ?? null, fn ($q, $id) => $q->where('student_id', $id))
            ->when($validated['subject_id'] ?? null, fn ($q, $id) => $q->where('subject_id', $id))
            ->when($validated['term_id'] ?? null, fn ($q, $id) => $q->where('term_id', $id))
            ->when($validated['assessment_type'] ?? null, fn ($q, $type) => $q->where('assessment_type', $type));

        if (! $this->isAdministrator($request->user()->loadMissing('role'))) {
            $staffId = $request->user()->staff?->id;
            if (! $staffId) {
                return $this->forbidden('Your user account is not linked to a staff record.');
            }
            $query->whereHas('student', function (Builder $student) use ($staffId) {
                $student->whereExists(function ($assignment) use ($staffId) {
                    $assignment->selectRaw('1')->from('class_subject_teacher')
                        ->whereColumn('class_subject_teacher.class_id', 'students.class_id')
                        ->whereColumn('class_subject_teacher.subject_id', 'assessments.subject_id')
                        ->whereColumn('class_subject_teacher.term_id', 'assessments.term_id')
                        ->where('class_subject_teacher.staff_id', $staffId);
                });
            });
        }

        return response()->json(['data' => $query->orderByDesc('recorded_at')->get()]);
    }

    private function contextRules(): array
    {
        return [
            'class_id' => ['required', 'integer', 'exists:classes,id'],
            'subject_id' => ['required', 'integer', 'exists:subjects,id'],
            'term_id' => ['required', 'integer', 'exists:terms,id'],
            'assessment_type' => ['required', Rule::in(self::ASSESSMENT_TYPES)],
        ];
    }

    private function mayManageContext(Request $request, array $context): bool
    {
        $user = $request->user()->loadMissing('role', 'staff');
        if ($this->isAdministrator($user)) {
            return true;
        }

        return $user->staff && ClassSubjectTeacher::where([
            'class_id' => $context['class_id'],
            'subject_id' => $context['subject_id'],
            'term_id' => $context['term_id'],
            'staff_id' => $user->staff->id,
        ])->exists();
    }

    private function isAdministrator($user): bool
    {
        return in_array($user->role?->name, self::ADMIN_ROLES, true);
    }

    private function forbidden(string $message)
    {
        return response()->json(['error' => ['code' => 'FORBIDDEN', 'message' => $message]], 403);
    }
}
