<?php

namespace App\Services;

use Illuminate\Validation\Rule;

class HealthInput
{
    public const SOURCES = ['guardian_report', 'learner_report', 'staff_observation', 'external_document', 'other_report'];

    public const STATES = ['unknown', 'none_reported', 'recorded'];

    public const STATUSES = ['open', 'monitoring', 'closed'];

    public const DISPOSITIONS = ['none', 'monitoring', 'returned_to_class', 'guardian_handover', 'external_referral'];

    public const TYPES = ['action', 'notification', 'referral'];

    public function time(): array
    {
        return ['required', 'date_format:Y-m-d\TH:i:sP', 'before_or_equal:now'];
    }

    public function source(): array
    {
        return ['required', Rule::in(self::SOURCES)];
    }

    public function correction(): array
    {
        return ['expected_revision' => ['required', 'integer', 'min:1'], 'correction_reason' => ['required', 'string', 'max:500']];
    }

    public function page(): array
    {
        return ['page' => ['sometimes', 'integer', 'min:1', 'max:1000000'], 'per_page' => ['sometimes', 'integer', 'min:1', 'max:50']];
    }

    public function profile(): array
    {
        return ['allergy_information_state' => ['required', Rule::in(self::STATES)],
            'allergy_information' => ['nullable', 'string', 'max:1000'], 'emergency_information' => ['nullable', 'string', 'max:1000'],
            'support_information' => ['nullable', 'string', 'max:1000'], 'source' => $this->source(),
            'source_reference' => ['nullable', 'string', 'max:200']];
    }

    public function alert(): array
    {
        return ['alert_type' => ['required', Rule::in(['allergy', 'emergency_support', 'activity_precaution', 'other_safety'])],
            'description' => ['required', 'string', 'max:500'], 'emergency_instructions' => ['nullable', 'string', 'max:500'],
            'is_active' => ['required', 'boolean'], 'source' => $this->source(), 'source_reference' => ['nullable', 'string', 'max:200'],
            'starts_on' => ['required', 'date_format:Y-m-d'], 'ends_on' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:starts_on']];
    }

    public function incident(): array
    {
        return ['occurred_at' => $this->time(), 'location' => ['required', 'string', 'max:120'],
            'category' => ['required', Rule::in(['illness_concern', 'injury', 'exposure', 'other_safety'])],
            'observations' => ['required', 'string', 'max:2000'], 'information_basis' => ['required', Rule::in(['observed', 'reported'])]];
    }

    public function entry(string $type): array
    {
        return match ($type) {
            'action' => ['action_type' => ['required', Rule::in(['first_aid', 'observation', 'follow_up', 'handover', 'status_change'])],
                'action_at' => $this->time(), 'action' => ['required', 'string', 'max:1000'], 'result' => ['nullable', 'string', 'max:1000'],
                'status_after' => ['nullable', Rule::in(self::STATUSES)], 'disposition_after' => ['nullable', Rule::in(self::DISPOSITIONS)]],
            'notification' => ['channel' => ['required', Rule::in(['phone', 'sms', 'email', 'in_person', 'other'])],
                'attempted_at' => $this->time(), 'outcome' => ['required', Rule::in(['contacted', 'no_answer', 'message_left', 'failed'])],
                'contact_used' => ['nullable', 'string', 'max:200']],
            'referral' => ['referred_at' => $this->time(), 'reason' => ['required', 'string', 'max:1000'],
                'destination' => ['nullable', 'string', 'max:200'], 'authorization_details' => ['nullable', 'string', 'max:1000'],
                'handover_details' => ['nullable', 'string', 'max:1000'],
                'follow_up_status' => ['required', Rule::in(['pending', 'handed_over', 'completed', 'cancelled'])]],
        };
    }

    public function merged(\Illuminate\Http\Request $request, \App\Models\HealthRecord $record, array $rules): array
    {
        $data = $record->only(array_keys($rules));
        foreach ($data as $key => $value) {
            if ($value instanceof \DateTimeInterface) {
                $data[$key] = $value->format(in_array($key, ['starts_on', 'ends_on'], true) ? 'Y-m-d' : 'Y-m-d\TH:i:sP');
            }
        }

        return \Illuminate\Support\Facades\Validator::make(array_replace($data, $request->only(array_keys($rules))), $rules)->validate();
    }

    public function normalize(array $data): array
    {
        foreach (['occurred_at', 'action_at', 'attempted_at', 'referred_at'] as $key) {
            if (isset($data[$key])) {
                $data[$key] = \Carbon\Carbon::parse($data[$key])->setTimezone(config('app.timezone'));
            }
        }

        return $data;
    }

    public function profileState(array $data): void
    {
        $hasInformation = trim($data['allergy_information'] ?? '') !== '';
        if (($data['allergy_information_state'] === 'recorded') !== $hasInformation) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'allergy_information' => 'Recorded allergy information requires details; unknown or none reported must not contain recorded allergy details.',
            ]);
        }
    }
}
