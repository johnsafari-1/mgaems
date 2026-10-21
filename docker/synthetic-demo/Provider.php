<?php

namespace MgaemsSyntheticDemo;

use App\Contracts\TeachingAssistantProvider;
use App\Services\CurriculumRetrieval;
use App\Services\GroundedDocumentContract;
use Illuminate\Validation\ValidationException;

/** Deterministic, explicitly labelled sample drafts for the isolated browser demo. */
class Provider implements TeachingAssistantProvider
{
    public function name(): string { return 'synthetic_demo'; }
    public function available(): bool { return config('app.env') === 'synthetic_demo' && getenv('MGAEMS_SYNTHETIC_DEMO') === '1'; }

    public function draft(string $operation, array $input): array
    {
        if (!$this->available()) throw new \RuntimeException('Synthetic provider is restricted to the isolated demo.');
        $selection = $input['selection'] ?? [];
        $context = app(CurriculumRetrieval::class)->retrieve($selection);
        if (!$context['available']) throw new \RuntimeException('Select Grade 7 Integrated Science and the original temperature-reading unit.');
        if (count($context['records']) !== 1 || $context['records'][0]['record_key'] !== 'original.temperature.1') {
            throw ValidationException::withMessages(['selection' => 'This sample provider supports only the original temperature-reading demo record.']);
        }
        $record = $context['records'][0];
        $outcomes = $record['specific_learning_outcomes'];
        $links = ['curriculum_record_ids' => [$record['record_id']], 'learning_outcome_ids' => array_column($outcomes, 'id')];
        $constraints = $input['constraints'] ?? [];
        $duration = (int) ($constraints['duration_minutes'] ?? 40);
        $marks = (int) ($constraints['total_marks'] ?? 10);
        $schemeMinutes = (int) ($constraints['total_duration_minutes'] ?? 80);
        if ($duration < 3 || $duration > 240 || $marks < 2 || $marks > 1000 || $schemeMinutes < 1 || $schemeMinutes > 240) {
            throw ValidationException::withMessages(['constraints' => 'Demo limits: duration 3–240 minutes, total marks 2–1000, scheme duration 1–240 minutes.']);
        }
        $common = ['status' => 'draft', 'grade' => 7, 'learning_area' => 'Integrated Science',
            'title' => 'Synthetic demo: reading and comparing temperatures', 'curriculum_claims' => [],
            'curriculum_references' => [['record_id' => $record['record_id'], 'source_version_id' => $record['source']['version_id'],
                'document_sha256' => $record['source']['document_sha256'], 'page_reference' => $record['source']['page_reference'], 'outcome_ids' => $links['learning_outcome_ids']]],
            'specific_learning_outcomes' => $outcomes];
        $questions = [
            $links + ['position' => 1, 'question_type' => 'short_answer', 'prompt' => 'Two thermometer diagrams show 20 degrees Celsius and 30 degrees Celsius. Record both temperatures and identify the warmer sample.',
                'marks' => intdiv($marks, 2), 'options' => [], 'answer_key' => '20 degrees Celsius and 30 degrees Celsius; the 30-degree sample is warmer.', 'marking_guidance' => 'Award the available marks for accurate readings and correctly identifying the warmer sample.'],
            $links + ['position' => 2, 'question_type' => 'short_answer', 'prompt' => 'A sample changes from 22 degrees Celsius to 27 degrees Celsius. State whether it became warmer or cooler and calculate the change.',
                'marks' => $marks - intdiv($marks, 2), 'options' => [], 'answer_key' => 'It became warmer by 5 degrees Celsius.', 'marking_guidance' => 'Credit the warmer comparison and the difference of 5 degrees Celsius.'],
        ];
        $draft = $common + match ($operation) {
            'scheme_of_work' => ['total_duration_minutes' => $schemeMinutes, 'weeks' => [$links + [
                'week_number' => 1, 'strand' => 'Observing and measuring', 'sub_strand' => 'Temperature readings', 'lessons_per_week' => 1,
                'lesson_duration_minutes' => $schemeMinutes, 'total_duration_minutes' => $schemeMinutes,
                'learning_activities' => ['Read original thermometer diagrams marked 20 and 30 degrees Celsius.', 'Compare the readings and explain which sample is warmer.'],
                'resources' => ['Original thermometer diagrams', 'Pencils and exercise books'], 'assessment_approach' => 'Check both recorded temperatures and ask for the reason behind the warmer comparison.']]],
            'lesson_plan' => ['duration_minutes' => $duration, 'key_inquiry_questions' => ['How can we compare two temperature readings?'],
                'resources' => ['Original thermometer diagrams', 'Pencils and exercise books'], 'assessment_approach' => 'Use two new thermometer diagrams as an individual exit task.',
                'stages' => [
                    $links + ['phase' => 'introduction', 'duration_minutes' => 1, 'activities' => ['Discuss the difference between a warmer sample and a cooler sample.']],
                    $links + ['phase' => 'development', 'duration_minutes' => $duration - 2, 'activities' => ['Model reading 20 and 30 degrees Celsius from original diagrams.', 'Pairs record the readings and explain which sample is warmer.']],
                    $links + ['phase' => 'conclusion', 'duration_minutes' => 1, 'activities' => ['Complete an individual temperature comparison and review the answer.']],
                ]],
            'homework' => ['instructions' => 'Synthetic practice material. Read each temperature carefully and show your comparison.', 'total_marks' => $marks, 'questions' => $questions],
            'exam_paper' => ['instructions' => 'Synthetic demonstration paper. Answer both questions and include units.', 'duration_minutes' => $duration, 'total_marks' => $marks,
                'sections' => [['position' => 1, 'title' => 'Temperature observations', 'total_marks' => $marks, 'questions' => $questions]]],
            default => throw ValidationException::withMessages(['operation' => 'Use one of the four grounded teaching-document operations in this demo.']),
        };
        $draft = app(GroundedDocumentContract::class)->validate($operation, $draft, $selection, $constraints);

        return ['label' => 'Synthetic demonstration draft — deterministic sample, not live AI',
            'disclosure' => 'Original test material only; not official curriculum. Review and explicitly import to test the workflow.', 'draft' => $draft];
    }
}
