<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AiGenerationRun;
use App\Services\AuditLogger;
use App\Services\TeachingAssistant;
use App\Services\TeachingDocumentAccess;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use RuntimeException;

class AiTeachingAssistantController extends Controller
{
    private const OPERATIONS = ['scheme_outline', 'scheme_of_work', 'lesson_plan', 'homework', 'exam_paper', 'exam_question', 'alternative_question', 'improve_question', 'marking_guidance'];
    private const SENSITIVE = ['learner', 'student', 'parent', 'guardian', 'admission', 'health', 'medical', 'disability', 'phone', 'email', 'address', 'password', 'token'];

    public function __construct(private TeachingDocumentAccess $access, private TeachingAssistant $assistant) {}

    public function status(Request $request)
    {
        $this->access->user($request->user());
        $provider = $this->assistant->provider();
        return response()->json(['data' => ['available' => $provider->available(), 'provider' => $provider->name(),
            'notice' => $provider->available() ? 'Generated material is a labelled draft and requires human review.' : 'AI drafting is not configured. Manual authoring remains available.',
            'operations' => self::OPERATIONS]]);
    }

    public function draft(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate(['operation' => ['required', Rule::in(self::OPERATIONS)], 'input' => ['required', 'array', 'max:30'], 'document_type' => ['nullable', 'string', 'max:40'], 'document_id' => ['nullable', 'integer', 'min:1']]);
        $input = $this->safeInput($validated['input']);

        return DB::transaction(function () use ($request, $validated, $input, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $provider = $this->assistant->provider();
            $run = AiGenerationRun::create(['operation' => $validated['operation'], 'provider' => $provider->name(), 'state' => 'requested',
                'document_type' => $validated['document_type'] ?? null, 'document_id' => $validated['document_id'] ?? null,
                'input_sha256' => hash('sha256', json_encode($input, JSON_THROW_ON_ERROR)), 'created_by' => $user->id]);
            try {
                $result = $provider->draft($validated['operation'], $input);
                $run->update(['state' => 'generated', 'output' => $result]);
                $auditLogger->log('GENERATE_AI_TEACHING_DRAFT', 'AiGenerationRun', $run->id, ['operation' => $validated['operation'], 'provider' => $provider->name()]);
                return response()->json(['data' => ['run_id' => $run->id] + $result], 201);
            } catch (RuntimeException $exception) {
                $run->update(['state' => 'unavailable']);
                return response()->json(['error' => ['code' => 'AI_UNAVAILABLE', 'message' => $exception->getMessage()]], 503);
            }
        }, 3);
    }

    // Acceptance records human review. Drafts are never saved to teaching documents automatically.
    public function accept(Request $request, AiGenerationRun $run, AuditLogger $auditLogger)
    {
        return DB::transaction(function () use ($request, $run, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            abort_unless((int) $run->created_by === (int) $user->id || $this->access->leader($user), 403);
            abort_unless($run->state === 'generated', 409, 'Only a generated draft can be accepted for manual use.');
            $run->update(['state' => 'accepted', 'accepted_by' => $user->id, 'accepted_at' => now()]);
            $auditLogger->log('ACCEPT_AI_TEACHING_DRAFT', 'AiGenerationRun', $run->id, ['operation' => $run->operation]);
            return response()->json(['data' => ['id' => $run->id, 'state' => $run->state, 'accepted_at' => $run->accepted_at?->toISOString()]]);
        }, 3);
    }

    private function safeInput(array $input): array
    {
        $walk = function (mixed $value, string $key = '') use (&$walk): mixed {
            $normalisedKey = strtolower($key);
            if (collect(self::SENSITIVE)->contains(fn (string $sensitive) => str_contains($normalisedKey, $sensitive))) {
                abort(422, 'AI input must not include learner, family, health, contact or credential data.');
            }
            if (is_array($value)) return array_map(fn ($item, $itemKey) => $walk($item, (string) $itemKey), $value, array_keys($value));
            if (! is_scalar($value) && $value !== null) abort(422, 'AI input must contain only plain structured values.');
            $text = trim((string) $value);
            if (mb_strlen($text) > 4000) abort(422, 'Each AI input field is limited to 4,000 characters.');
            return $text;
        };
        return $walk($input);
    }
}
