<?php

namespace App\Services;

use App\Models\Assessment;
use App\Models\AssessmentRevision;

class AssessmentHistory
{
    public const TYPES = ['continuous', 'end_term'];
    public const LEVELS = ['Exceeding Expectation', 'Meeting Expectation', 'Approaching Expectation', 'Below Expectation'];
    public const SCALE = 'mgaems-performance-v1'; // Internal vocabulary identifier, not a curriculum claim.

    public function snapshot(array $context, string $type): array
    {
        return [
            'class' => $context['class']->only(['id', 'name']),
            'subject' => $context['subject']->only(['id', 'name', 'code']),
            'term' => ['id' => $context['term']->id, 'name' => $context['term']->name,
                'academic_year' => $context['term']->academicYear?->only(['id', 'name'])],
            'assessment_type' => $type,
            'performance_scale' => ['identifier' => self::SCALE, 'levels' => self::LEVELS],
        ];
    }

    // Caller holds the learner/assessment locks. Baselines preserve only the
    // known saved row, not a guessed original class, creator or assessment event.
    public function baseline(Assessment $assessment, AuditLogger $audit): ?AssessmentRevision
    {
        if ($assessment->revision_number > 0) return null;
        $revision = $this->append($assessment, 'legacy_baseline', 'legacy_unknown', $assessment->recorded_by, null);
        $audit->log('CAPTURE_LEGACY_ASSESSMENT_BASELINE', 'Assessment', $assessment->id, ['revision_number' => $revision->revision_number]);
        return $revision;
    }

    public function append(Assessment $assessment, string $change, string $authority, ?int $actor, ?int $assignment): AssessmentRevision
    {
        $number = (int) $assessment->revision_number + 1;
        $revision = AssessmentRevision::create([
            'assessment_id' => $assessment->id, 'revision_number' => $number,
            'score' => $assessment->score, 'competency_rating' => $assessment->competency_rating, 'remarks' => $assessment->remarks,
            'actor_id' => $actor, 'recorded_at' => $assessment->recorded_at,
            'change_type' => $change, 'authority_type' => $authority, 'assignment_id' => $assignment,
            'context_snapshot' => $assessment->context_snapshot, 'created_at' => now(),
        ]);
        $assessment->update(['revision_number' => $number]);
        return $revision;
    }
}
