# Ollama backend connection checkpoint

## Scope and inspected project

This checkpoint adds a server-side transport only. Git status was clean at the
start. The running application was verified as PHP 8.3.35 / Laravel 13.35.0.
Compose contains the existing `app` and MySQL 8.0 services with persistent vendor
and database volumes. No additional container, dependency, controller, route,
provider binding, migration, curriculum import, or frontend change was added.
No migration, schema command, database reset, seeder, restore, commit, merge, or
push was executed.

The repository uses a Laravel API under `/api/v1`, Sanctum authentication,
`EnsureRole`, and static HTML / vanilla JavaScript under `public/assets`.
The existing teaching modules and their migrations were inspected and retained.
The source database has 58 tables and 44 recorded migrations.

## Existing AI and document components

- `App\Contracts\TeachingAssistantProvider`, `TeachingAssistant`, and the existing
  mock, HTTP, and unavailable providers are selected in `AppServiceProvider`
  through `services.ai.driver`. No existing Ollama integration was found.
- `AiTeachingAssistantController` provides status, draft, and acceptance endpoints.
  `AiGenerationRun` records the input hash, output, provider, state, creator, and
  human acceptance. Migration `2026_10_15_000042` already defines its table and
  teaching revision history. No schema extension is needed for connectivity.
- The AI routes require Sanctum and one of system administrator, head teacher,
  deputy head teacher, or teacher. Teaching documents additionally use
  `TeachingDocumentAccess` for active accounts and allocation-based teacher access.
  Leadership review routes remain restricted to leadership roles.
- Schemes, lesson plans, records of work, homework, exam papers, sections,
  questions, private attachments, and immutable revisions already exist. Relevant
  migrations are `000038` through `000042`; the earlier student, guardian,
  medical, sponsorship, academic, and configuration migrations remain unchanged.
- Existing screens include `schemes-of-work`, `lesson-plans`, `records-of-work`,
  `homework`, `exam-papers`, and `teaching-review` HTML/JS files. The exam question
  editor already loads labelled AI drafts into editable fields before manual save.
- `TeachingDocumentVersions`, `TeachingReviewController`, `TeachingDocumentExport`,
  `HomeworkExport`, and `ExamPaperExport` retain review, versioning, and PDF flows.
  Learner paper exports omit staff-only answer keys and marking guidance.

## Transport and configuration

`App\Services\OllamaService` is resolved through Laravel's existing container:

```php
$ollama = app(\App\Services\OllamaService::class);
$models = $ollama->models();
$result = $ollama->chat([
    ['role' => 'user', 'content' => 'Return only JSON: {"status":"ok"}. /no_think'],
]);
```

Configuration lives in `config/services.php`, with these configurable defaults
also documented in `.env.example`:

```dotenv
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=qwen3:1.7b
OLLAMA_TIMEOUT=120
```

The service uses Laravel HTTP Client, a connection timeout capped at 10 seconds,
the configured total timeout, and no redirects or automatic retries. Chat requests
use `stream: false` and `format: json`. Both the response envelope and generated
content must parse as JSON objects; unfinished and truncated output is rejected.
Connection, timeout, HTTP, missing-model, and malformed-response errors produce
sanitized exceptions without upstream bodies or prompt content.

These calls follow Ollama's official [chat](https://docs.ollama.com/api/chat) and
[model-list](https://docs.ollama.com/api/tags) APIs. The local checks below verify
compatibility with the installed server rather than assuming every documented
feature is supported locally.

Existing `MGAEMS_AI_DRIVER` behavior is retained. The transport is deliberately
not selectable as a teaching generator yet: JSON syntax alone does not establish
safe, operation-specific draft content. No model calls or configuration reach the
browser. The service has no database access, school-data retrieval, or persistence.

## Backup procedure and evidence

The existing `BackupController` runs a local dump binary and writes private
storage. Earlier preflight documentation records byte corruption from PowerShell
redirection; the controller also passes a password as a process argument and does
not request a single-transaction snapshot. It was not used or modified here.

For this checkpoint, the existing MySQL container's native MySQL 8.0.46 dump
client was used with credentials expanded only inside that container:
`--single-transaction --quick --no-tablespaces --set-gtid-purged=OFF --hex-blob
--routines --events --triggers --skip-extended-insert`. All source tables were
confirmed InnoDB. Node captured stdout directly as binary bytes into ignored
private storage, avoiding PowerShell text redirection. The complete dump contains
school records and must remain private; it is excluded from Git and Docker builds.

- File: `storage/app/private/ollama-preflight/mgaems-before-ollama-2026-10-17T20-47-48-001Z.sql`
- Size: **184386 bytes**.
- SHA256: `798ce70d4367cd95ab251129db624afb311c3922af84b67d64b946a73bd08db3`.
- Verification: saved bytes equal captured dump bytes; completion marker present;
  all 58 table definitions match; per-table INSERT counts match source counts;
  source row counts and MySQL table checksums match before and after capture.
- The `.sql.verification.json` file beside the dump contains per-table evidence.
  The ignored `backup.cjs` beside it records the exact repeatable procedure.
- This is a verified dump, **not a restore drill**. No restore was executed.

The backup includes all student, guardian, medical, sponsorship, configuration,
teaching, migration, and other database tables. No school data was sent to Ollama.

## Actual validation results

Executed in the existing `mgaems-app` PHP container:

```text
php tests/safe/ollama.php
11 isolated checks passed; no database connections or live HTTP allowed.

php tests/safe/ollama.php --live
PASS PHP container GET /api/tags lists configured model
PASS PHP container POST /api/chat returns parsed JSON object
PASS live missing model produces sanitized model-unavailable error
3 live checks passed; no database connection configured.
```

The isolated checks cover provider selection preservation, URL/model/payload and
timeout settings, connection/timeout exceptions, HTTP failures, missing models,
invalid envelopes, malformed model lists, invalid generated JSON, incomplete
responses, invalid configuration, and invalid message inputs. Timeout/connection
exceptions are simulated; model listing, successful inference, and missing-model
handling are exercised against the real server. Live input is a fixed synthetic
JSON probe. No school records or arbitrary command-line prompts are accepted.

PHP syntax checks passed for the service, test script, and service configuration.
The two new PHP files also passed `vendor/bin/pint --test`.
Read-only `route:list --path=api/v1/ai-teaching -vv` confirmed all three existing
AI endpoints retain Sanctum and staff-role middleware. `git diff --check` passed.
Existing tests that create schemas were not run under this task's prohibition
on schema operations. This checkpoint does not claim a full application test run.

## Architecture decision and remaining work

Extend the existing provider contract with an Ollama adapter in a later task,
using this transport. Do not add a second AI controller or persistence workflow.
The intended flow is approved curriculum retrieval, educational-context allowlist,
structured prompt construction, transport inference, operation-specific JSON schema
and semantic validation, labelled editable draft, teacher acceptance/manual save,
then existing document submission, leadership review, revisions, and exports.
Generation must have no independent write path into grades, attendance, learner,
guardian, medical, sponsorship, or financial records.

Before enabling that adapter:

- Establish curriculum source provenance/retrieval and operation-specific prompt
  builders and JSON schemas; none are implemented in this connection checkpoint.
- Strengthen the existing controller's sensitive-key filter with educational field
  allowlists and privacy controls. It does not explicitly cover sponsorship or
  financial keys and cannot establish that unrestricted free text contains no
  identifying information. Its recursive array mapping also discards associative
  keys; preserve structure when introducing typed inputs. Do not send model
  relations, raw school records, personal details, or sensitive text to inference.
- Move long inference outside the existing draft controller's database transaction
  while retaining authorization rechecks and audited request/result transitions.
  The existing controller currently keeps that transaction open across inference.
- Keep human review distinct from document approval, and validate output before
  allowing existing editing and saving workflows to use it.

There are no unresolved blockers for the backend connection. Generator activation,
curriculum imports, and Rubrica authoring/UI changes remain outside this task.
