<?php

namespace App\Services;

use App\Models\Sponsorship;
use App\Models\Student;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/** Keep assignment, transition and audit writes atomic without changing domain policy. */
class SponsorshipOperations
{
    public function create(array $data, int $userId, AuditLogger $audit): array
    {
        return DB::transaction(function () use ($data, $userId, $audit) {
            $ids = $data['student_ids'] ?? (isset($data['student_id']) ? [$data['student_id']] : []);
            // Stable learner locks serialize competing individual creates/resumes on MySQL.
            $learners = Student::whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get(['id', 'status']);
            if ($learners->count() !== count($ids) || $learners->contains(fn ($student) => $student->status !== 'active')) {
                throw ValidationException::withMessages(['student_id' => ['Select currently active learners.']]);
            }
            if ($data['sponsorship_type'] === 'individual' && $this->activeIndividual($data['student_id'])) return $this->conflict();
            unset($data['student_ids']);
            $item = Sponsorship::create($data + ['status' => 'active', 'created_by' => $userId]);
            if ($item->sponsorship_type === 'group') $item->students()->sync($ids);
            $audit->log('CREATE_SPONSORSHIP', 'Sponsorship', $item->id,
                ['type' => $item->sponsorship_type, 'member_count' => $item->sponsorship_type === 'group' ? count($ids) : 0]);
            return ['item' => $item];
        }, 3);
    }

    public function update(Sponsorship $original, array $data, AuditLogger $audit): array
    {
        return DB::transaction(function () use ($original, $data, $audit) {
            // Assignment/type are immutable through the current update contract.
            if ($original->sponsorship_type === 'individual' && $original->student_id) {
                Student::whereKey($original->student_id)->lockForUpdate()->firstOrFail();
            }
            $item = Sponsorship::whereKey($original->id)->lockForUpdate()->firstOrFail();
            if ($item->status === 'ended' && $data['status'] !== 'ended') return ['error' => ['code' => 'TERMINAL_STATE', 'message' => 'An ended sponsorship cannot be reopened.'], 'status' => 422];
            $allowed = ['active' => ['paused', 'ended'], 'paused' => ['active', 'ended'], 'ended' => ['ended']];
            if ($data['status'] !== $item->status && ! in_array($data['status'], $allowed[$item->status], true)) {
                return ['error' => ['code' => 'INVALID_TRANSITION', 'message' => 'That sponsorship status transition is not allowed.'], 'status' => 422];
            }
            if ($item->sponsorship_type === 'individual' && $data['status'] === 'active'
                && $this->activeIndividual($item->student_id, $item->id)) return $this->conflict();
            $previous = $item->status;
            $item->update($data);
            $action = match ([$previous, $item->status]) {
                ['active', 'paused'] => 'PAUSE_SPONSORSHIP', ['paused', 'active'] => 'RESUME_SPONSORSHIP',
                ['active', 'ended'], ['paused', 'ended'] => 'END_SPONSORSHIP', default => 'UPDATE_SPONSORSHIP',
            };
            $audit->log($action, 'Sponsorship', $item->id, ['from' => $previous, 'to' => $item->status]);
            return ['item' => $item];
        }, 3);
    }

    private function activeIndividual(int $student, ?int $except = null): bool
    {
        // A locking read sees the latest committed state after waiting for the learner lock.
        return Sponsorship::where('student_id', $student)->where('sponsorship_type', 'individual')->where('status', 'active')
            ->when($except, fn ($query) => $query->whereKeyNot($except))->lockForUpdate()->get(['id'])->isNotEmpty();
    }

    private function conflict(): array
    {
        return ['error' => ['code' => 'ALREADY_SPONSORED', 'message' => 'This learner already has an active individual sponsorship.'], 'status' => 409];
    }
}
