<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\AttendanceRecordResource;
use App\Models\AttendanceStudent;
use App\Models\Student;
use App\Services\AttendanceAccess;
use App\Services\AuditLogger;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AttendanceController extends Controller
{
    public const STATUSES = ['present', 'absent', 'late', 'excused'];
    private const RELATIONS = ['student:id,first_name,last_name,admission_no', 'schoolClass:id,name'];

    public function __construct(private AttendanceAccess $access)
    {
    }

    public function myClasses(Request $request)
    {
        $classes = $this->access->classes($request->user())->orderBy('sequence')->orderBy('name')->get(['id', 'name']);
        return response()->json(['data' => $classes, 'meta' => [
            'today' => $this->today(), 'timezone' => config('app.timezone'),
            'statuses' => self::STATUSES, 'max_records' => 1000,
        ]]);
    }

    public function roster(Request $request)
    {
        $validated = $request->validate([
            'class_id' => ['required', 'integer', 'exists:classes,id'],
            'attendance_date' => $this->dateRules(),
        ]);
        $class = $this->access->authorizeClass($request->user(), (int) $validated['class_id']);
        $date = $validated['attendance_date'];
        // Current eligible learners plus actual historical records for this class/day.
        // Do not reconstruct a past roster from today's placement or invent absences.
        $historicalIds = AttendanceStudent::where('class_id', $class->id)->where('attendance_date', $date)->select('student_id');
        $students = Student::where(fn ($query) => $query
            ->where(fn ($current) => $current->where('class_id', $class->id)->where('status', 'active')
                ->whereDate('admission_date', '<=', $date)
                ->whereDoesntHave('promotionsTransfers', fn ($history) => $history->whereDate('effective_date', '>', $date)))
            ->orWhereIn('id', $historicalIds))
            ->orderBy('last_name')->orderBy('first_name')->orderBy('id')
            ->get(['id', 'admission_no', 'first_name', 'last_name', 'class_id', 'status']);
        $records = AttendanceStudent::whereIn('student_id', $students->pluck('id'))->where('attendance_date', $date)->get()->keyBy('student_id');
        $counts = array_fill_keys(self::STATUSES, 0);
        $unrecorded = 0; $blocked = 0;
        $learners = $students->map(function ($student) use ($records, $class, &$counts, &$unrecorded, &$blocked) {
            $record = $records->get($student->id);
            $foreign = $record && (int) $record->class_id !== (int) $class->id;
            $status = $foreign ? null : $record?->status;
            if ($foreign) $blocked++;
            elseif ($status) $counts[$status]++;
            else $unrecorded++;
            return $student->only(['id', 'admission_no', 'first_name', 'last_name']) + [
                'record_id' => $foreign ? null : $record?->id, 'status' => $status,
                'historical' => (int) $student->class_id !== (int) $class->id || $student->status !== 'active',
                'editable' => ! $foreign,
                'unavailable_reason' => $foreign ? 'Attendance for this learner/date is already recorded in another class. Its historical class cannot be changed.' : null,
            ];
        });
        $recorded = array_sum($counts);
        return response()->json(['data' => [
            'class' => $class->only(['id', 'name']), 'attendance_date' => $date, 'learners' => $learners,
            'counts' => $counts, 'recorded_count' => $recorded, 'unrecorded_count' => $unrecorded,
            'blocked_count' => $blocked, 'total_learners' => $students->count(),
            'recording_state' => $recorded === 0 ? 'not_recorded' : ($unrecorded > 0 ? 'partially_recorded' : 'recorded'),
        ]]);
    }

    public function store(Request $request, AuditLogger $auditLogger)
    {
        $this->access->classes($request->user()); // Fail closed before accepting a roster.
        $validated = $request->validate([
            'class_id' => ['required', 'integer', 'exists:classes,id'],
            'attendance_date' => $this->dateRules(),
            'records' => ['required', 'array', 'min:1', 'max:1000'],
            'records.*' => ['required', 'array:student_id,status'],
            'records.*.student_id' => ['required', 'integer', 'distinct', 'exists:students,id'],
            'records.*.status' => ['required', Rule::in(self::STATUSES)],
        ]);

        return DB::transaction(function () use ($request, $validated, $auditLogger) {
            $class = $this->access->authorizeClass($request->user(), (int) $validated['class_id'], true);
            $date = $validated['attendance_date'];
            $ids = array_column($validated['records'], 'student_id');
            // Learner locks serialize submissions (including different classes) and
            // current Student promotion/transfer operations before rechecking membership.
            $students = Student::whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $existing = AttendanceStudent::whereIn('student_id', $ids)->where('attendance_date', $date)
                ->orderBy('student_id')->lockForUpdate()->get()->keyBy('student_id');
            $latestChanges = DB::table('promotions_transfers')->whereIn('student_id', $ids)
                ->orderBy('student_id')->orderBy('id')->lockForUpdate()->get(['student_id', 'effective_date'])
                ->groupBy('student_id')->map(fn ($history) => substr((string) $history->max('effective_date'), 0, 10));
            $errors = [];
            foreach ($validated['records'] as $index => $input) {
                $student = $students->get($input['student_id']); $record = $existing->get($input['student_id']);
                if ($record && (int) $record->class_id !== (int) $class->id) {
                    $errors["records.$index.student_id"] = 'This learner/date already has attendance in another class. Historical class context cannot be reassigned.';
                } elseif (! $record && (! $student || (int) $student->class_id !== (int) $class->id || $student->status !== 'active')) {
                    $errors["records.$index.student_id"] = 'New attendance requires an active learner in the selected class.';
                } elseif (! $record && ($date < $student->admission_date->toDateString() || $date < ($latestChanges->get($student->id) ?? ''))) {
                    $errors["records.$index.student_id"] = 'New attendance cannot precede admission or the latest recorded placement change. Existing historical records can be corrected in their original class.';
                }
            }
            if ($errors) throw ValidationException::withMessages($errors);

            $saved = []; $changes = []; $created = 0; $updated = 0; $unchanged = 0;
            foreach ($validated['records'] as $input) {
                $record = $existing->get($input['student_id']);
                if (! $record) {
                    $record = AttendanceStudent::create([
                        'student_id' => $input['student_id'], 'class_id' => $class->id,
                        'attendance_date' => $date, 'status' => $input['status'], 'recorded_by' => $request->user()->id,
                    ]);
                    $created++; $before = null;
                } elseif ($record->status !== $input['status']) {
                    $before = $record->status;
                    // Never replace the stored class/date during a correction.
                    $record->update(['status' => $input['status'], 'recorded_by' => $request->user()->id]);
                    $updated++;
                } else {
                    $unchanged++; $saved[] = $record; continue;
                }
                $changes[] = ['attendance_id' => $record->id, 'from' => $before, 'to' => $record->status];
                $saved[] = $record;
            }
            if ($created + $updated > 0) {
                $auditLogger->log('RECORD_ATTENDANCE', 'SchoolClass', $class->id, [
                    'attendance_date' => $date, 'count' => count($saved),
                    'created' => $created, 'updated' => $updated, 'unchanged' => $unchanged, 'changes' => $changes,
                ]);
            }
            return response()->json([
                'data' => collect($saved)->map(fn ($record) => (new AttendanceRecordResource($record))->resolve($request)),
                'meta' => ['created' => $created, 'updated' => $updated, 'unchanged' => $unchanged],
            ], $created > 0 ? 201 : 200);
        }, 3);
    }

    public function index(Request $request)
    {
        $filters = $request->validate([
            'class_id' => ['sometimes', 'integer', 'exists:classes,id'],
            'student_id' => ['sometimes', 'integer', 'exists:students,id'],
            'from' => $this->dateRules(false), 'to' => $this->dateRules(false),
            'page' => ['sometimes', 'integer', 'min:1', 'max:1000000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        $this->assertRange($filters);
        $records = $this->readQuery($request, $filters)->with(self::RELATIONS)
            ->when($filters['from'] ?? null, fn ($query, $date) => $query->where('attendance_date', '>=', $date))
            ->when($filters['to'] ?? null, fn ($query, $date) => $query->where('attendance_date', '<=', $date))
            ->orderByDesc('attendance_date')->orderBy('student_id')->paginate($filters['per_page'] ?? 25);

        return response()->json([
            'data' => $records->getCollection()->map(fn ($record) => (new AttendanceRecordResource($record))->resolve($request)),
            'meta' => ['page' => $records->currentPage(), 'per_page' => $records->perPage(), 'total' => $records->total()],
        ]);
    }

    public function summary(Request $request)
    {
        $filters = $request->validate([
            'class_id' => ['required_without:student_id', 'integer', 'exists:classes,id'],
            'student_id' => ['required_without:class_id', 'integer', 'exists:students,id'],
            'from' => $this->dateRules(), 'to' => $this->dateRules(),
        ]);
        $this->assertRange($filters);
        $counts = $this->readQuery($request, $filters)->whereBetween('attendance_date', [$filters['from'], $filters['to']])
            ->select('status', DB::raw('count(*) as total'))->groupBy('status')->pluck('total', 'status');
        $total = (int) array_sum($counts->toArray());

        return response()->json(['data' => [
            'from' => $filters['from'], 'to' => $filters['to'],
            'counts' => collect(self::STATUSES)->mapWithKeys(fn ($status) => [$status => (int) $counts->get($status, 0)]),
            'total_records' => $total,
            // Keep existing staff summary semantics; Parent Portal includes late separately.
            'attendance_rate' => $total > 0 ? round($counts->get('present', 0) / $total * 100, 1) : null,
        ]]);
    }

    private function readQuery(Request $request, array $filters)
    {
        $classes = $this->access->classes($request->user());
        if (! empty($filters['class_id'])) $this->access->authorizeClass($request->user(), (int) $filters['class_id']);
        return AttendanceStudent::whereIn('class_id', $classes->select('id'))
            ->when($filters['class_id'] ?? null, fn ($query, $id) => $query->where('class_id', $id))
            ->when($filters['student_id'] ?? null, fn ($query, $id) => $query->where('student_id', $id));
    }

    private function dateRules(bool $required = true): array
    {
        return [$required ? 'required' : 'sometimes', 'string', 'regex:/^\d{4}-\d{2}-\d{2}$/', 'date_format:Y-m-d', 'before_or_equal:'.$this->today()];
    }

    private function today(): string
    {
        return Carbon::now(config('app.timezone'))->toDateString();
    }

    private function assertRange(array $filters): void
    {
        if (isset($filters['from'], $filters['to']) && $filters['from'] > $filters['to']) {
            throw ValidationException::withMessages(['to' => 'The end date must be on or after the start date.']);
        }
    }
}
