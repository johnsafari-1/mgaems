<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AiGenerationRun;
use App\Models\ExamPaper;
use App\Models\Homework;
use App\Models\LessonPlan;
use App\Models\SchemeOfWork;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\CurriculumLibrary;
use App\Services\CurriculumPromptContext;
use App\Services\TeachingAssistant;
use App\Services\TeachingDocumentAccess;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * Single AI drafting entry point. Long inference never runs inside a database
 * transaction: the request is recorded, the provider is called with no held
 * locks, then the outcome is recorded. Drafts are labelled, audited and never
 * written to a teaching document. Saving always continues through the existing
 * authorized document APIs.
 */
class AiTeachingAssistantController extends Controller
{
    private const OPERATIONS = ['scheme_outline', 'scheme_of_work', 'lesson_plan', 'homework', 'exam_paper', 'exam_question', 'alternative_question', 'improve_question', 'marking_guidance'];
    private const DOCUMENT_TYPES = ['scheme_of_work', 'lesson_plan', 'homework', 'exam_paper'];
    private const SENSITIVE = ['learner', 'student', 'parent', 'guardian', 'admission', 'health', 'medical', 'disability', 'phone', 'email', 'address', 'password', 'token',
        'sponsor', 'scholarship', 'financial', 'finance', 'bank', 'mpesa', 'nhif', 'insurance', 'salary', 'donation', 'payment', 'transaction', 'invoice',
        'diagnosis', 'prescription', 'allergy', 'next_of_kin', 'date_of_birth', 'dob'];

    public function __construct(private TeachingDocumentAccess $access, private TeachingAssistant $assistant, private ?CurriculumLibrary $library = null) {}

    public function status(Request $request)
    {
        $this->access->user($request->user());
        $provider = $this->assistant->provider();
        $grounded = $provider->available() && $this->library()->installed();

        return response()->json(['data' => ['available' => $provider->available(), 'provider' => $provider->name(),
            'notice' => $provider->available() ? 'Generated material is a labelled draft and requires human review.' : 'AI drafting is not configured. Manual authoring remains available.',
            'operations' => self::OPERATIONS,
            'grounded_operations' => CurriculumPromptContext::OPERATIONS,
            'capabilities' => ['grounded' => $grounded, 'curriculum_library' => $this->library()->installed()]]]);
    }

    public function draft(Request $request, AuditLogger $auditLogger)
    {
        $validated = $request->validate(['operation' => ['required', Rule::in(self::OPERATIONS)], 'input' => ['required', 'array', 'max:30'],
            'document_type' => ['nullable', 'required_with:document_id', Rule::in(self::DOCUMENT_TYPES)], 'document_id' => ['nullable', 'required_with:document_type', 'integer', 'min:1']]);
        $user = $this->access->user($request->user(), true);
        $document = $this->assertDocumentAccess($user, $validated['document_type'] ?? null, $validated['document_id'] ?? null);
        $input = $this->clean($validated['input'], '', 0);
        if (isset($input['selection']) && is_array($input['selection'])) {
            if ($document) {
                if (in_array($validated['operation'], CurriculumPromptContext::OPERATIONS, true) && $validated['operation'] !== $validated['document_type']) {
                    throw ValidationException::withMessages(['document_type' => 'The grounded operation must match its target document type.']);
                }
                if (isset($input['selection']['class_subject_teacher_id']) && (int) $input['selection']['class_subject_teacher_id'] !== (int) $document->class_subject_teacher_id) {
                    throw ValidationException::withMessages(['selection' => 'The curriculum allocation must match the target document.']);
                }
                $input['selection']['class_subject_teacher_id'] = (int) $document->class_subject_teacher_id;
            }
            $input['selection'] = $this->normalizeSelection($user, $input['selection']);
        }

        $provider = $this->assistant->provider();
        $run = AiGenerationRun::create(['operation' => $validated['operation'], 'provider' => $provider->name(), 'state' => 'requested',
            'document_type' => $validated['document_type'] ?? null, 'document_id' => $validated['document_id'] ?? null,
            'input_sha256' => hash('sha256', json_encode($input, JSON_THROW_ON_ERROR)), 'created_by' => $user->id]);

        try {
            $result = $provider->draft($validated['operation'], $input);
        } catch (ValidationException $exception) {
            $this->finish($run, 'rejected');
            $auditLogger->log('REJECT_AI_TEACHING_DRAFT', 'AiGenerationRun', $run->id, ['operation' => $validated['operation'], 'provider' => $provider->name()]);

            throw $exception;
        } catch (RuntimeException $exception) {
            $this->finish($run, 'unavailable');

            return response()->json(['error' => ['code' => 'AI_UNAVAILABLE', 'message' => $exception->getMessage()]], 503);
        } catch (\Throwable $exception) {
            report($exception);
            $this->finish($run, 'failed');

            return response()->json(['error' => ['code' => 'AI_GENERATION_FAILED', 'message' => 'The AI draft could not be generated. Manual authoring remains available.']], 502);
        }

        $run->update(['state' => 'generated', 'output' => $result]);
        $auditLogger->log('GENERATE_AI_TEACHING_DRAFT', 'AiGenerationRun', $run->id, ['operation' => $validated['operation'], 'provider' => $provider->name()]);

        return response()->json(['data' => ['run_id' => $run->id] + $result], 201);
    }

    // Acceptance records human review. Drafts are never saved to teaching documents automatically.
    public function accept(Request $request, AiGenerationRun $run, AuditLogger $auditLogger)
    {
        return DB::transaction(function () use ($request, $run, $auditLogger) {
            $user = $this->access->user($request->user(), true);
            $run = AiGenerationRun::whereKey($run->id)->lockForUpdate()->firstOrFail();
            abort_unless((int) $run->created_by === (int) $user->id || $this->access->leader($user), 403);
            if ($run->state !== 'accepted') {
                abort_unless($run->state === 'generated', 409, 'Only a generated draft can be accepted for manual use.');
                $run->update(['state' => 'accepted', 'accepted_by' => $user->id, 'accepted_at' => now()]);
                $auditLogger->log('ACCEPT_AI_TEACHING_DRAFT', 'AiGenerationRun', $run->id, [
                    'operation' => $run->operation, 'document_type' => $run->document_type, 'document_id' => $run->document_id,
                ]);
            }

            return response()->json(['data' => ['id' => $run->id, 'state' => $run->state, 'accepted_at' => $run->accepted_at?->toISOString()]]);
        }, 3);
    }

    private function finish(AiGenerationRun $run, string $state): void
    {
        $run->update(['state' => $state]);
    }

    /** Reject any identifiable learner, family, health, sponsorship, financial or credential field. */
    private function clean(mixed $value, string $key, int $depth): mixed
    {
        if ($depth > 6) abort(422, 'AI input is nested too deeply.');
        $normalised = strtolower($key);
        foreach (self::SENSITIVE as $term) {
            if ($normalised !== '' && str_contains($normalised, $term)) {
                abort(422, 'AI input must not include learner, family, health, sponsorship, financial, contact or credential data.');
            }
        }
        if (is_array($value)) {
            if (count($value) > 60) abort(422, 'AI input contains too many entries.');
            $cleaned = [];
            foreach ($value as $childKey => $child) $cleaned[$childKey] = $this->clean($child, (string) $childKey, $depth + 1);

            return $cleaned;
        }
        if ($value === null || is_bool($value) || is_int($value) || is_float($value)) return $value;
        if (! is_scalar($value)) abort(422, 'AI input must contain only plain structured values.');
        $text = trim((string) $value);
        if (mb_strlen($text) > 4000) abort(422, 'Each AI input field is limited to 4,000 characters.');

        return $text;
    }

    /**
     * Pin a grounded selection to the teacher's exact allocation. The internal
     * allocation id is resolved and removed before the prompt is built; the
     * learning area and subject follow the authorized allocation, never the
     * client-supplied values.
     */
    private function normalizeSelection(User $user, array $selection): array
    {
        if (isset($selection['class_subject_teacher_id'])) {
            $assignment = $this->access->assignment($user, (int) $selection['class_subject_teacher_id'], true);
            $selection['subject_id'] = (int) $assignment->subject_id;
            $selection['learning_area'] = $assignment->subject?->learning_area ?: $assignment->subject?->name ?: ($selection['learning_area'] ?? null);
            unset($selection['class_subject_teacher_id']);
        }

        return array_filter($selection, fn ($value) => $value !== null && $value !== '');
    }

    /** A supplied document link must belong to the caller's allocation and be editable. */
    private function assertDocumentAccess(User $user, ?string $type, ?int $id): ?Model
    {
        if ($type === null || $id === null) return null;
        $models = ['scheme_of_work' => SchemeOfWork::class, 'lesson_plan' => LessonPlan::class, 'homework' => Homework::class, 'exam_paper' => ExamPaper::class];
        $document = $this->access->document($user, $models[$type], $id, true);
        if ($type === 'exam_paper') abort_unless(in_array($document->status, ['draft', 'returned'], true), 409, 'Examination paper drafts can only be generated for an editable paper.');

        return $document;
    }

    private function library(): CurriculumLibrary
    {
        return $this->library ??= app(CurriculumLibrary::class);
    }
}
