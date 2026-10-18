<?php

namespace App\Services;

use App\Contracts\TeachingAssistantProvider;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/** Generates only drafts grounded in currently verified curriculum. */
class OllamaTeachingAssistantProvider implements TeachingAssistantProvider
{
    private const OPERATIONS = ['scheme_of_work', 'lesson_plan', 'homework', 'exam_paper'];

    public function __construct(
        private OllamaService $ollama,
        private CurriculumPromptContext $context,
        private GroundedDocumentContract $contract,
    ) {}

    public function name(): string { return 'ollama'; }

    public function available(): bool
    {
        return is_string(config('services.ollama.base_url')) && config('services.ollama.base_url') !== ''
            && is_string(config('services.ollama.model')) && config('services.ollama.model') !== '';
    }

    public function draft(string $operation, array $input): array
    {
        if (! in_array($operation, self::OPERATIONS, true)) {
            throw ValidationException::withMessages(['operation' => 'Ollama supports only grounded teaching-document drafts.']);
        }
        if (! $this->available()) {
            throw new RuntimeException('No AI Teaching Assistant provider is configured. Manual authoring remains available.');
        }
        $data = Validator::make($input, ['selection' => ['required', 'array'], 'constraints' => ['sometimes', 'array']])->validate();
        if (array_diff(array_keys($input), ['selection', 'constraints'])) {
            throw ValidationException::withMessages(['input' => 'Only curriculum selection and draft constraints are allowed.']);
        }
        $constraints = $this->constraints($operation, $data['constraints'] ?? []);
        $built = $this->context->build($operation, $data['selection']);
        if (! $built['available']) {
            throw new RuntimeException('Verified curriculum context is unavailable. Manual authoring remains available.');
        }
        $draft = $this->contract->validate($operation, $this->ollama->chat($built['messages']), $data['selection'], $constraints);

        return ['label' => 'AI-generated curriculum-grounded draft (Ollama)',
            'disclosure' => 'This editable draft is grounded only in cited verified curriculum records. It requires teacher review and is never saved, approved or published automatically.',
            'draft' => $draft];
    }

    private function constraints(string $operation, array $input): array
    {
        $allowed = match ($operation) {
            'lesson_plan' => ['duration_minutes'],
            'scheme_of_work' => ['total_duration_minutes'],
            'homework' => ['total_marks'],
            'exam_paper' => ['duration_minutes', 'total_marks'],
        };
        if (array_diff(array_keys($input), $allowed)) {
            throw ValidationException::withMessages(['constraints' => 'Unsupported draft constraint.']);
        }
        $result = [];
        foreach ($input as $key => $value) {
            $number = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if ($number === false) throw ValidationException::withMessages(['constraints.'.$key => 'A positive whole number is required.']);
            $result[$key] = $number;
        }

        return $result;
    }
}
