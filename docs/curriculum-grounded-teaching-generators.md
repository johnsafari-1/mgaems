# Curriculum-grounded teaching generators

## Scope

This phase connects the four existing teaching modules (Schemes of Work, Lesson
Plans, Homework & Assignments, Examination Papers) to the existing grounded AI
pipeline. No live generation is enabled: `services.ai.driver` stays `disabled`
unless an operator explicitly opts in. No active database migration, schema
change, reset, commit, merge, or push was executed. Test migrations run only in
guarded, isolated test databases.

Generation remains a server-side, curriculum-grounded, human-reviewed draft.
Drafts are labelled, audited and never written to a teaching document without an
explicit teacher action that goes through the existing document APIs.

## Reused components

- `App\Contracts\TeachingAssistantProvider`, `TeachingAssistant`, and the mock,
  HTTP, Ollama and unavailable providers selected through `services.ai.driver`.
- `OllamaTeachingAssistantProvider` (server-side only) and `OllamaService`
  transport. Ollama is never called from the browser and prompt content is never
  logged.
- `CurriculumPromptContext` and `GroundedDocumentContract` (strict per-operation
  JSON schema plus deterministic validation).
- `CurriculumRetrieval` and `CurriculumLibrary` (verified, approved records only;
  fails closed with `CURRICULUM_LIBRARY_NOT_INSTALLED`).
- `AiTeachingAssistantController`, routes `GET /ai-teaching/status`,
  `POST /ai-teaching/drafts`, `POST /ai-teaching/runs/{run}/accept`.
- `AiGenerationRun` for audited run state; `TeachingDocumentAccess` for
  allocation-based authorization.

## Backend hardening

- Nested `input.selection` / `input.constraints` keys and scalar types are now
  preserved (previously associative keys were dropped).
- The privacy blocklist rejects learner, family, contact, health, sponsorship,
  financial and credential fields before any prompt is built.
- Selection is pinned to the caller's exact allocation through
  `class_subject_teacher_id`; the internal id is resolved, then removed before the
  prompt and replaced with the allocation's `subject_id` and learning area.
- A supplied `document_type`/`document_id` must belong to the caller's allocation
  and, for examination papers, be in `draft` or `returned`.
- Inference no longer runs inside a database transaction. Runs move through
  `requested → generated | unavailable | rejected | failed`, with `accepted`
  recorded separately on human acceptance.
- `status` now reports `grounded_operations` and
  `capabilities.{grounded,curriculum_library}` so clients can present an
  informative unavailable state instead of attempting generation.
- A linked document pins the curriculum allocation and grounded operation type.
  Teacher import calls the existing run acceptance endpoint after content is
  saved. Acceptance and its audit event are atomic and idempotent on retry;
  the audit includes the target document type and ID.
- Requested duration/marks constraints are included in the server-side Ollama
  prompt as well as checked against the generated output.

## Contract additions

`GroundedDocumentContract` now carries the fields the modules store:

- scheme-of-work weeks: `strand`, `sub_strand`, `resources`.
- lesson plan: `key_inquiry_questions`.
- Homework is bounded to 100 questions/positions; multiple-choice option text is
  bounded to the document APIs' 255 characters.

## Frontend

- `MGAEMS.groundedDraft(options)` in `app.js` is the single entry point. It checks
  `/ai-teaching/status`, blocks generation unless `capabilities.grounded` is true,
  shows a labelled, editable JSON draft with its verified references, rejects
  invalid JSON on import, and only writes on explicit confirmation. Feedback is
  non-fatal outside the browser shell.
- `schemes-of-work.js`: "Generate weekly plans (AI)" imports weeks through
  `POST /schemes-of-work/{id}/weeks`.
- `lesson-plans.js`: "Curriculum AI draft" applies reviewed content through
  `PATCH /lesson-plans/{id}`.
- `homework.js`: "Curriculum AI draft" updates instructions/outcomes through
  `PATCH /homework/{id}` and adds questions through
  `POST /homework/{id}/questions`.
- `exam-papers.js`: replaces the display-only draft with the shared helper and
  imports sections/questions through `POST /exam-papers/{id}/sections` and
  `POST /exam-papers/{id}/questions` (`ai_generated: true`).

No module auto-saves a whole new document; imports target an existing editable
draft and surface partial-failure counts.

Imports re-read current document state and stop if that read fails. A dialog
retains a fixed import plan across retries, reconciles complete saved payloads
at their intended week/position, and stops on conflicting edits. Lost responses
do not move exam sections or repeat saved questions. Reviewed JSON is locked
once import starts. A failed acceptance call offers an acceptance-only retry
without repeating document writes. These are resumable multi-request imports,
not whole-document transactions; reload/cross-dialog recovery requires manual
inspection of the persisted document (see the readiness report).

Homework accepts an empty options array for non-multiple-choice questions;
`preparedQuestion()` still requires at least two options and a matching answer
for multiple-choice questions.

## Tests

- `docker exec mgaems-app php tests/safe/teaching_learning_workspace.php`
  (17 checks: capabilities, nested-key preservation, privacy blocklist, run
  states, document linkage, atomic and idempotent acceptance).
- `docker exec mgaems-app php tests/safe/curriculum_library.php` (28 checks,
  including the extended contract fixtures).
- `docker exec mgaems-app php tests/safe/ollama.php` (11 checks).
- `node --test tests/frontend/grounded-drafts.test.cjs` (12 checks, including
  partial/lost responses, conflicting edits, disabled states and acceptance retries).
- `node --test "tests/frontend/*.test.cjs"` (656 checks).
- `docker exec mgaems-app php tests/safe/curriculum_grounded_pilot.php --synthetic`
  (isolated HTTP source-to-import-to-acceptance pilot for all four modules).

## Enabling grounded generation

Live generation stays disabled until all of the following hold:

1. An authorized curriculum source is registered, its PDF/hash verified, and the
   version explicitly approved. `CURRICULUM_LIBRARY_NOT_INSTALLED` means missing
   tables; installed tables with no qualifying records return
   `NO_VERIFIED_CURRICULUM`. Status capabilities indicate provider/schema readiness,
   not verified content coverage or live model health.
2. A provider is configured (`MGAEMS_AI_DRIVER=ollama` plus `services.ollama`
   base URL/model) and connectivity, timeouts and model quality are signed off.
3. Integration testing is completed with real approved content and explicit
   authorization to enable the driver. Synthetic fixtures must never be imported
   into the active library or labelled official.

See [Phase 7 readiness and pilot checklist](phase7-ai-pilot-readiness.md) for the
actual read-only inventory, mapping blockers and exact authorization steps.
