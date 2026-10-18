<?php

namespace App\Services;

use Illuminate\Validation\ValidationException;

/** Strict contracts and deterministic checks only; no inference or persistence. */
class GroundedDocumentContract
{
    public function schema(string $operation): array
    {
        $text = fn (int $max = 2000) => ['type' => 'string', 'minLength' => 1, 'maxLength' => $max];
        $integer = fn (int $max = 10000) => ['type' => 'integer', 'minimum' => 1, 'maximum' => $max];
        $list = fn (array $item, int $max = 50) => ['type' => 'array', 'minItems' => 1, 'maxItems' => $max, 'items' => $item];
        $object = fn (array $properties) => ['type' => 'object', 'additionalProperties' => false, 'required' => array_keys($properties), 'properties' => $properties];
        $ids = $list($integer(PHP_INT_MAX));
        $reference = $object(['record_id' => $integer(PHP_INT_MAX), 'source_version_id' => $integer(PHP_INT_MAX),
            'document_sha256' => ['type' => 'string', 'pattern' => '^[a-f0-9]{64}$'], 'page_reference' => $text(200), 'outcome_ids' => $ids]);
        $properties = ['status' => ['type' => 'string', 'enum' => ['draft']], 'grade' => $integer(12), 'learning_area' => $text(160), 'title' => $text(200),
            'curriculum_references' => $list($reference, 20),
            'specific_learning_outcomes' => $list($object(['id' => $integer(PHP_INT_MAX), 'text' => $text()]), 1000),
            'curriculum_claims' => ['type' => 'array', 'maxItems' => 0, 'items' => $text()]];
        $links = ['curriculum_record_ids' => $ids, 'learning_outcome_ids' => $ids];
        $question = $object($links + ['position' => $integer(200), 'question_type' => ['type' => 'string', 'enum' => ['short_answer', 'structured', 'multiple_choice']],
            'prompt' => $text(4000), 'marks' => $integer(1000),
            'options' => ['type' => 'array', 'maxItems' => 8, 'items' => $text(500)], 'answer_key' => $text(4000), 'marking_guidance' => $text(4000)]);
        $specific = match ($operation) {
            'scheme_of_work' => ['total_duration_minutes' => $integer(100000), 'weeks' => $list($object($links + [
                'week_number' => $integer(53), 'lessons_per_week' => $integer(40), 'lesson_duration_minutes' => $integer(240),
                'total_duration_minutes' => $integer(10000), 'learning_activities' => $list($text()), 'assessment_approach' => $text()]), 53)],
            'lesson_plan' => ['duration_minutes' => $integer(240), 'resources' => $list($text(500)), 'assessment_approach' => $text(),
                'stages' => $list($object($links + ['phase' => ['type' => 'string', 'enum' => ['introduction', 'development', 'conclusion']],
                    'duration_minutes' => $integer(240), 'activities' => $list($text())]), 30)],
            'homework' => ['instructions' => $text(4000), 'total_marks' => $integer(), 'questions' => $list($question, 200)],
            'exam_paper' => ['instructions' => $text(4000), 'duration_minutes' => $integer(600), 'total_marks' => $integer(),
                'sections' => $list($object(['position' => $integer(50), 'title' => $text(160), 'total_marks' => $integer(), 'questions' => $list($question, 200)]), 50)],
            default => throw ValidationException::withMessages(['operation' => 'Unsupported grounded document operation.']),
        };

        return ['$schema' => 'https://json-schema.org/draft/2020-12/schema', 'title' => $operation.' editable draft'] + $object($properties + $specific);
    }

    public function validate(string $operation, array $output, array $selection, array $constraints = []): array
    {
        $errors = [];
        $this->shape($this->schema($operation), $output, 'draft', $errors);
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }
        $context = app(CurriculumRetrieval::class)->retrieve($selection);
        if (! $context['available']) {
            throw ValidationException::withMessages(['curriculum' => 'Verified curriculum context is unavailable.']);
        }
        $normal = fn ($text) => mb_strtolower(trim($text));
        if ($output['grade'] !== $context['selection']['grade'] || $normal($output['learning_area']) !== $normal($context['selection']['learning_area'])) {
            $errors['draft.grade'] = 'Grade and learning area must match the selected context.';
        }
        $records = array_column($context['records'], null, 'record_id');
        $expectedOutcomes = [];
        foreach ($records as $record) {
            foreach ($record['specific_learning_outcomes'] as $outcome) {
                $expectedOutcomes[$outcome['id']] = $outcome['text'];
            }
        }
        $refs = [];
        foreach ($output['curriculum_references'] as $ref) {
            $record = $records[$ref['record_id']] ?? null;
            if (! $record || isset($refs[$ref['record_id']])) {
                $errors['draft.curriculum_references'] = 'References must identify each selected curriculum record exactly once.';

                continue;
            }
            $refs[$ref['record_id']] = true;
            if ($ref['source_version_id'] !== $record['source']['version_id'] || $ref['document_sha256'] !== $record['source']['document_sha256']
                || $ref['page_reference'] !== $record['source']['page_reference'] || ! $this->sameIds($ref['outcome_ids'], array_column($record['specific_learning_outcomes'], 'id'))) {
                $errors['draft.curriculum_references'] = 'Source references and learning outcomes must match verified records.';
            }
        }
        if (! $this->sameIds(array_keys($refs), array_keys($records))) {
            $errors['draft.curriculum_references'] = 'Preserve all selected curriculum records.';
        }
        $seenOutcomes = [];
        foreach ($output['specific_learning_outcomes'] as $outcome) {
            if (isset($seenOutcomes[$outcome['id']]) || ($expectedOutcomes[$outcome['id']] ?? null) !== $outcome['text']) {
                $errors['draft.specific_learning_outcomes'] = 'Learning outcome IDs and text must match the verified source exactly.';
            }
            $seenOutcomes[$outcome['id']] = true;
        }
        if (! $this->sameIds(array_keys($seenOutcomes), array_keys($expectedOutcomes))) {
            $errors['draft.specific_learning_outcomes'] = 'Preserve all selected learning outcomes.';
        }
        $items = match ($operation) {
            'scheme_of_work' => $output['weeks'], 'lesson_plan' => $output['stages'], 'homework' => $output['questions'],
            'exam_paper' => array_merge(...array_column($output['sections'], 'questions')),
        };
        foreach ($items as $index => $item) {
            $validOutcomes = [];
            foreach ($item['curriculum_record_ids'] as $id) {
                if (! isset($records[$id])) {
                    $errors['draft.items.'.$index] = 'Item references an unselected curriculum record.';

                    continue;
                }
                $validOutcomes = array_merge($validOutcomes, array_column($records[$id]['specific_learning_outcomes'], 'id'));
            }
            if (count(array_unique($item['curriculum_record_ids'])) !== count($item['curriculum_record_ids'])
                || count(array_unique($item['learning_outcome_ids'])) !== count($item['learning_outcome_ids'])
                || array_diff($item['learning_outcome_ids'], $validOutcomes)) {
                $errors['draft.items.'.$index] = 'Item learning outcomes must belong to its selected curriculum records.';
            }
        }
        if (! $this->sameIds(array_values(array_unique(array_merge(...array_column($items, 'learning_outcome_ids')))), array_keys($expectedOutcomes))) {
            $errors['draft.items'] = 'The document activities or questions must cover all selected learning outcomes.';
        }
        if ($operation === 'lesson_plan') {
            if (array_sum(array_column($items, 'duration_minutes')) !== $output['duration_minutes']) {
                $errors['draft.duration_minutes'] = 'Lesson stage durations must equal the lesson duration.';
            }
            $phases = array_column($items, 'phase');
            if ($phases[0] !== 'introduction' || end($phases) !== 'conclusion' || ! in_array('development', $phases, true)) {
                $errors['draft.stages'] = 'Include introduction, development and conclusion in order.';
            }
            $lastPhase = 0;
            foreach ($phases as $phase) {
                $rank = ['introduction' => 0, 'development' => 1, 'conclusion' => 2][$phase];
                if ($rank < $lastPhase) {
                    $errors['draft.stages'] = 'Lesson phases must progress from introduction through development to conclusion.';
                }
                $lastPhase = $rank;
            }
        }
        if ($operation === 'scheme_of_work') {
            foreach ($items as $week) {
                if ($week['total_duration_minutes'] !== $week['lessons_per_week'] * $week['lesson_duration_minutes']) {
                    $errors['draft.weeks'] = 'Weekly duration must equal lessons multiplied by lesson duration.';
                }
            }
            if (array_sum(array_column($items, 'total_duration_minutes')) !== $output['total_duration_minutes']) {
                $errors['draft.total_duration_minutes'] = 'Scheme duration must equal its weekly durations.';
            }
            $this->uniquePositions($items, 'week_number', 'draft.weeks', $errors);
        }
        if (in_array($operation, ['homework', 'exam_paper'], true)) {
            if (count($items) > 200) {
                $errors['draft.questions'] = 'A document is limited to 200 questions.';
            }
            if (array_sum(array_column($items, 'marks')) !== $output['total_marks']) {
                $errors['draft.total_marks'] = 'Question marks must equal document total marks.';
            }
            foreach ($items as $question) {
                if ($question['question_type'] === 'multiple_choice') {
                    if (count($question['options']) < 2 || count(array_unique($question['options'])) !== count($question['options']) || ! in_array($question['answer_key'], $question['options'], true)) {
                        $errors['draft.questions'] = 'Multiple-choice questions need distinct options and a matching answer key.';
                    }
                } elseif ($question['options'] !== []) {
                    $errors['draft.questions'] = 'Only multiple-choice questions may have options.';
                }
            }
            if ($operation === 'homework') {
                $this->uniquePositions($items, 'position', 'draft.questions', $errors);
            }
            if ($operation === 'exam_paper') {
                $this->uniquePositions($output['sections'], 'position', 'draft.sections', $errors);
                $this->uniquePositions($items, 'position', 'draft.questions', $errors);
                foreach ($output['sections'] as $section) {
                    if (array_sum(array_column($section['questions'], 'marks')) !== $section['total_marks']) {
                        $errors['draft.sections'] = 'Section marks must equal its question marks.';
                    }
                }
            }
        }
        foreach (['duration_minutes', 'total_marks', 'total_duration_minutes'] as $field) {
            if (isset($constraints[$field]) && ($output[$field] ?? null) !== $constraints[$field]) {
                $errors['draft.'.$field] = 'The draft must preserve the requested '.$field.'.';
            }
        }
        $narrative = $output;
        unset($narrative['curriculum_references'], $narrative['specific_learning_outcomes']);
        array_walk_recursive($narrative, function ($value) use (&$errors) {
            if (is_string($value) && preg_match('/\b(?:KICD|CBC|curriculum)\s*[-:]?\s*(?:approved|certified|verified|compliant|aligned)\b|\bofficial(?:ly)?\s+(?:approved|verified|aligned|certified)\b/i', $value)) {
                $errors['draft.curriculum_claims'] = 'A generated draft cannot claim official approval, certification or alignment.';
            }
        });
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        return $output;
    }

    /** Validator for exactly the JSON Schema vocabulary emitted above. */
    private function shape(array $schema, mixed $value, string $path, array &$errors): void
    {
        $valid = match ($schema['type']) {
            'object' => is_array($value) && (! array_is_list($value) || $value === []),
            'array' => is_array($value) && array_is_list($value), 'string' => is_string($value), 'integer' => is_int($value),
        };
        if (! $valid) {
            $errors[$path] = 'Invalid '.$schema['type'].' value.';

            return;
        }
        if (isset($schema['enum']) && ! in_array($value, $schema['enum'], true)) {
            $errors[$path] = 'Unsupported value.';
        }
        if ($schema['type'] === 'object') {
            foreach (array_diff($schema['required'], array_keys($value)) as $key) {
                $errors[$path.'.'.$key] = 'Required field is missing.';
            }
            foreach (array_diff(array_keys($value), array_keys($schema['properties'])) as $key) {
                $errors[$path.'.'.$key] = 'Unsupported field or curriculum claim.';
            }
            foreach ($schema['properties'] as $key => $child) {
                if (array_key_exists($key, $value)) {
                    $this->shape($child, $value[$key], $path.'.'.$key, $errors);
                }
            }
        } elseif ($schema['type'] === 'array') {
            if (count($value) < ($schema['minItems'] ?? 0) || count($value) > $schema['maxItems']) {
                $errors[$path] = 'Array size is outside the contract.';

                return;
            }
            foreach ($value as $index => $item) {
                $this->shape($schema['items'], $item, $path.'.'.$index, $errors);
            }
        } elseif ($schema['type'] === 'string') {
            if (mb_strlen(trim($value)) < ($schema['minLength'] ?? 0) || mb_strlen($value) > ($schema['maxLength'] ?? PHP_INT_MAX)
                || (isset($schema['pattern']) && ! preg_match('/'.$schema['pattern'].'/', $value))) {
                $errors[$path] = 'Invalid text length or format.';
            }
        } elseif ($value < $schema['minimum'] || $value > $schema['maximum']) {
            $errors[$path] = 'Number is outside the contract.';
        }
    }

    private function sameIds(array $left, array $right): bool
    {
        sort($left);
        sort($right);

        return $left === $right;
    }

    private function uniquePositions(array $items, string $field, string $path, array &$errors): void
    {
        $positions = array_column($items, $field);
        if (count(array_unique($positions)) !== count($positions)) {
            $errors[$path] = 'Positions must be unique.';
        }
    }
}
