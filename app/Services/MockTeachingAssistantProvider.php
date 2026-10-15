<?php

namespace App\Services;

use App\Contracts\TeachingAssistantProvider;

class MockTeachingAssistantProvider implements TeachingAssistantProvider
{
    public function name(): string { return 'mock'; }
    public function available(): bool { return true; }
    public function draft(string $operation, array $input): array
    {
        $topic = trim((string) ($input['topic'] ?? 'the staff-entered topic'));
        $draft = match ($operation) {
            'exam_question', 'alternative_question' => ['question_type' => 'short_answer', 'prompt' => 'Draft question about '.$topic.'.', 'marks' => 5, 'answer_key' => 'Staff review required.', 'marking_guidance' => 'Confirm accuracy, scope and marks before use.'],
            'marking_guidance' => ['marking_guidance' => 'Draft guidance: award marks only for the staff-approved response and method.'],
            'improve_question' => ['prompt' => 'Improved draft: '.trim((string) ($input['prompt'] ?? $topic)), 'notes' => 'Check clarity, suitability and factual accuracy before saving.'],
            default => ['title' => 'AI draft: '.$topic, 'content' => 'This is a generated draft for staff review and manual editing. It is not verified curriculum content.'],
        };

        return ['label' => 'AI-generated draft (mock provider)', 'disclosure' => 'Mock output is synthetic and must be reviewed by a teacher. MGAEMS does not verify CBC alignment or source authority.', 'draft' => $draft];
    }
}
