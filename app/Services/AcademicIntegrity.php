<?php

namespace App\Services;

use App\Models\Assessment;
use App\Models\ClassSubjectTeacher;
use App\Models\PromotionTransfer;
use App\Models\SchoolClass;
use App\Models\Staff;
use App\Models\Subject;
use App\Models\TimetableEntry;
use Illuminate\Database\QueryException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/** Integrity checks over the existing academic tables; no new curriculum model. */
class AcademicIntegrity
{
    public function transaction(callable $operation)
    {
        try {
            return DB::transaction($operation, 3);
        } catch (QueryException $exception) {
            if (! in_array((string) $exception->getCode(), ['23000', '23505'], true)) throw $exception;
            $message = $exception->getMessage();
            foreach ([
                'uq_class_subject_term' => 'subject_id', 'class_subject_teacher.class_id' => 'subject_id',
                'uq_class_subject' => 'subject_id', 'class_subjects.class_id' => 'subject_id',
                'uq_term' => 'name', 'terms.academic_year_id' => 'name',
                'academic_years_name_unique' => 'name', 'academic_years.name' => 'name',
                'classes_name_unique' => 'name', 'classes.name' => 'name',
                'subjects_name_unique' => 'name', 'subjects.name' => 'name',
                'subjects_code_unique' => 'code', 'subjects.code' => 'code',
            ] as $constraint => $field) {
                if (str_contains($message, $constraint) && ! str_contains(strtolower($message), 'foreign key')) {
                    throw ValidationException::withMessages([$field => 'These academic details already exist. Refresh the page and check the existing records.']);
                }
            }
            if (str_contains(strtolower($message), 'foreign key')) {
                throw new HttpResponseException($this->conflict('ACADEMIC_DEPENDENCY', 'Referenced academic data is in use or changed concurrently. Refresh and check its dependencies.'));
            }
            throw $exception;
        }
    }

    public function lockClass(int $id): SchoolClass
    {
        return SchoolClass::whereKey($id)->lockForUpdate()->firstOrFail();
    }

    public function lockSubject(int $id, bool $active = false): Subject
    {
        $subject = Subject::whereKey($id)->lockForUpdate()->firstOrFail();
        if ($active && $subject->status !== 'active') {
            throw ValidationException::withMessages(['subject_id' => 'Choose an active learning area/subject.']);
        }

        return $subject;
    }

    public function lockTeacher(int $id, string $field = 'staff_id'): Staff
    {
        $staff = Staff::whereKey($id)->lockForUpdate()->firstOrFail();
        if ($staff->status !== 'active' || $staff->staff_type !== 'teaching') {
            throw ValidationException::withMessages([$field => 'Choose an active member of teaching staff.']);
        }

        return $staff;
    }

    public function requireOffering(int $classId, int $subjectId): void
    {
        if (! DB::table('class_subjects')->where('class_id', $classId)->where('subject_id', $subjectId)->lockForUpdate()->first()) {
            throw ValidationException::withMessages(['subject_id' => 'This learning area is not offered by the selected class. Configure its offering first.']);
        }
    }

    public function hasClassHistory(int $classId): bool
    {
        return PromotionTransfer::where('from_class_id', $classId)->orWhere('to_class_id', $classId)->exists();
    }

    public function hasAssessments(int $classId, int $subjectId, ?int $termId = null): bool
    {
        // Prefer captured assessment classes. For unresolved legacy rows include
        // recorded placements, rather than relying only on current learner class.
        return Assessment::where('subject_id', $subjectId)
            ->when($termId, fn ($query) => $query->where('term_id', $termId))
            ->where(fn ($query) => $query->where('class_id', $classId)
                ->orWhere(fn ($legacy) => $legacy->whereNull('class_id')->whereHas('student', fn ($student) => $student->where('class_id', $classId)
                    ->orWhereHas('promotionsTransfers', fn ($history) => $history->where('from_class_id', $classId)->orWhere('to_class_id', $classId)))))
            ->exists();
    }

    public function offeringInUse(int $classId, int $subjectId): bool
    {
        return ClassSubjectTeacher::where('class_id', $classId)->where('subject_id', $subjectId)->exists()
            || TimetableEntry::where('class_id', $classId)->where('subject_id', $subjectId)->exists()
            || $this->hasAssessments($classId, $subjectId);
    }

    public function conflict(string $code, string $message)
    {
        return response()->json(['error' => ['code' => $code, 'message' => $message]], 409);
    }
}
