<?php

namespace App\Services;

use App\Models\HealthRecord;
use DateTimeInterface;

class HealthView
{
    public const FIELDS = [
        'profile' => ['student_id', 'allergy_information_state', 'allergy_information', 'emergency_information', 'support_information',
            'source', 'source_reference', 'recorded_by', 'recorded_at', 'reviewed_by', 'reviewed_at'],
        'alert' => ['profile_id', 'alert_type', 'description', 'emergency_instructions', 'is_active', 'source', 'source_reference',
            'starts_on', 'ends_on', 'verified_by', 'verified_at', 'verification_basis'],
        'incident' => ['student_id', 'occurred_at', 'recorded_at', 'location', 'category', 'observations', 'information_basis',
            'recorded_by', 'historical_class_id', 'historical_term_id', 'context_snapshot', 'status', 'disposition'],
        'action' => ['incident_id', 'actor_id', 'recorded_at', 'action_type', 'action_at', 'action', 'result', 'status_after', 'disposition_after'],
        'notification' => ['incident_id', 'actor_id', 'recorded_at', 'guardian_id', 'channel', 'attempted_at', 'outcome', 'contact_snapshot'],
        'referral' => ['incident_id', 'actor_id', 'recorded_at', 'referred_at', 'reason', 'destination', 'authorization_details', 'handover_details', 'follow_up_status'],
    ];

    public const SUMMARY = [
        'profile' => ['student_id'], 'alert' => ['profile_id', 'alert_type', 'is_active', 'starts_on', 'ends_on'],
        'incident' => ['student_id', 'occurred_at', 'category', 'status', 'disposition'],
        'action' => ['incident_id', 'action_type', 'action_at'],
        'notification' => ['incident_id', 'channel', 'attempted_at', 'outcome'],
        'referral' => ['incident_id', 'referred_at', 'follow_up_status'],
    ];

    public function record(HealthRecord $record, bool $summary = false): array
    {
        $fields = ($summary ? self::SUMMARY : self::FIELDS)[$record::TYPE];
        $data = ['id' => $record->id, 'revision_number' => (int) $record->revision_number];
        foreach ($fields as $field) {
            $value = $record->getAttribute($field);
            $data[$field] = $value instanceof DateTimeInterface
                ? (in_array($field, ['starts_on', 'ends_on'], true) ? $value->format('Y-m-d') : $value->toISOString()) : $value;
        }

        return $data;
    }
}
