# Phase 2 curriculum reference library

School date: 18 October 2026 (Africa/Nairobi).

## Delivery status

The registry, private authorized-upload/manual-import workflow, structured MySQL
retrieval, prompt-context builder, and four output contracts are implemented and
tested. Teaching generators remain disabled. There are no changes to existing
teaching document screens, persistence, reviews, PDFs, school configuration,
assessments, sponsorship, attendance, or learner records. No streams were added.
No commit, merge, or push was performed.

**The active database migration is not installed.** Automatic approval review
rejected the targeted migration because the earlier user instruction prohibits
executing migrations. No workaround was attempted. Installing the four empty
tables requires explicit user approval of this exact command:

```powershell
docker exec mgaems-app php artisan migrate --path=database/migrations/2026_10_18_000043_create_curriculum_library.php --force
```

Until installation, staff retrieval returns `CURRICULUM_LIBRARY_NOT_INSTALLED`;
administrator library operations return HTTP 503 after authorization. Existing
features do not call these new endpoints. Do not use a general migration command
or run unrelated pending migrations.

## Existing components reused

- `SchoolClass` / `classes`, `Subject` / `subjects`, and term-specific
  `ClassSubjectTeacher` allocations remain authoritative school structures.
  Classes have name/level/sequence rather than a reliable dedicated grade column.
  Curriculum grade is therefore explicit in the library; no school class is
  renamed or created. Optional subject links must match the learning area.
- Existing scheme weeks, lesson planning fields, homework questions, exam sections
  and questions are preserved. The output contracts prepare draft data for those
  editing workflows without saving it to them.
- Sanctum, `EnsureRole`, `TeachingDocumentAccess`, active teaching-staff checks,
  `AuditLogger`, and the existing private filesystem disk are reused.
- `TeachingAssistantProvider`, `TeachingAssistant`, mock/HTTP/unavailable providers,
  `OllamaService`, `AiTeachingAssistantController`, `AiGenerationRun`, retained
  revisions, leadership review, and export utilities are unchanged in this phase.

## Data architecture and new files

The additive migration is
`database/migrations/2026_10_18_000043_create_curriculum_library.php`. It creates:

| Table | Purpose |
| --- | --- |
| `curriculum_sources` | Stable identifier, title, official URL, publisher, grade, learning area, optional existing subject link. |
| `curriculum_source_versions` | Edition, optional publication date, document URL, server-calculated SHA256, private path/size, authorization basis, approval/verification state, review notes/actor/time, content checksum. |
| `curriculum_records` | Edition-specific strand/sub-strand, stable record key, ordered suggested experiences/inquiries/assessment approaches, page or section reference. |
| `curriculum_learning_outcomes` | Individually identified and ordered source outcomes attached to a record. |

Foreign keys restrict deletion. The migration does not alter existing tables.
Its `down()` refuses destructive rollback; archive/withdraw curriculum evidence
instead of deleting referenced content. Applied MySQL DDL is not transactional,
so an installation failure must be investigated before retrying it.

New implementation files:

- Four `app/Models/Curriculum*.php` models.
- `app/Services/CurriculumAccess.php` and `CurriculumLibrary.php`.
- `app/Services/CurriculumRetrieval.php` and `CurriculumPromptContext.php`.
- `app/Services/GroundedDocumentContract.php`.
- `app/Http/Controllers/Api/CurriculumLibraryController.php`.
- `tests/safe/curriculum_library.php`, `curriculum_mysql.cjs`, and
  `curriculum_live_read.php`.
- This report and `docs/curriculum-pilot-grade7-integrated-science.json`.

`routes/api.php` is the only existing application file changed in Phase 2.
The uncommitted Phase 1 `.env.example`, `config/services.php`, `OllamaService`,
Ollama tests and connection report were retained.

## Administrator import and review process

All URLs below have prefix `/api/v1/curriculum-library` and retain Sanctum.
Library administration requires an active system administrator; teaching staff
can retrieve verified references but cannot approve or download source PDFs.

| Method / path | Operation |
| --- | --- |
| GET /sources | Paginated registry and editions, including draft states; administrators only. |
| POST /sources | Register source metadata. |
| PUT /sources/{source} | Correct metadata only before any edition is reviewed. |
| POST /sources/{source}/versions | Multipart authorized PDF upload plus edition metadata. |
| GET /versions/{version} | Review records, outcomes, provenance, notes, and current review-content checksum. |
| PUT /versions/{version} | Correct edition metadata while still draft. |
| GET /versions/{version}/document | Private administrator download of the authorized uploaded PDF. |
| POST /versions/{version}/records | Atomic structured import of up to 100 records. |
| PUT /versions/{version}/records/{record} | Correct a draft record manually. |
| POST /versions/{version}/approve | Attest actual document/content/authorization checks and approve the exact reviewed checksums. |
| POST /versions/{version}/withdraw | Revoke an approved or superseded edition with a reason. |
| GET /retrieve | Verified, bounded curriculum retrieval for authorized teaching staff/leadership. |

Register metadata using the pilot manifest's `source_registration_payload`,
linking `subject_id` only if the school already has the matching subject.
Version creation accepts `edition`, optional `publication_date`, `document_url`,
`authorization_basis` (20–2000 characters), and an authorized `document` PDF up to
20 MiB. HTTPS metadata URLs are stored, never fetched by the application.

For manual entry or reviewed extraction, POST a `records` list. Each item requires
`record_key`, `strand`, `sub_strand`, `page_reference`, and a nonempty
`specific_learning_outcomes` list of strings. Supply lists for
`suggested_learning_experiences`, `key_inquiry_questions`, and
`assessment_approaches`; an empty list records that no verified text was entered.
Unknown columns and malformed arrays are rejected. No automatic extraction,
bulk scraping, curriculum seeding, or public document redistribution is enabled.

Duplicate source identifiers, editions, document checksums within a source,
and record keys cannot silently create duplicate or overwrite existing records.
Imports are atomic; manual corrections are restricted to unreviewed drafts.
Record keys are normalized to lower case. Approved editions and source metadata
are retained; a new edition is needed for later curriculum changes.

After inspecting the actual PDF and every imported record against its cited
pages, retrieve the edition's `review_content_sha256`. Approval requires:

```json
{
  "document_sha256": "<server-calculated SHA256 from edition>",
  "content_sha256": "<review_content_sha256 from current review response>",
  "actual_document_checked": true,
  "extracted_content_checked": true,
  "authorized_use_confirmed": true,
  "verification_notes": "Record the actual document and cited pages checked, extraction corrections, and authorized-use basis."
}
```

The server rechecks PDF bytes and a checksum covering source metadata, edition
metadata, record content, and outcome identifiers. Concurrent corrections make
the review checksum stale and block approval. Approval marks the new edition
verified and supersedes the prior approved edition of the same source in one
transaction. Withdrawal never silently reactivates an older edition. URL host,
PDF MIME/header, and checksum alone never count as curriculum verification.

## Retrieval and prompt architecture

`CurriculumRetrieval::retrieve()` accepts grade and learning area, plus optional
subject ID, strand, sub-strand, topic, source-version ID, or explicit record IDs.
Strand/sub-strand are exact case-normalized filters; topic is a literal substring
of the sub-strand/outcomes, with SQL wildcards escaped. Results are ordered and
limited to 20 records. A broader selection returns `SELECTION_TOO_BROAD`.
Only approved/verified editions qualify; superseded, withdrawn, missing,
unverified, mismatched, or altered references never produce fake fallback data.
Source-version selection can disambiguate competing editions or variants.

Results include exact learning outcome text and IDs, record IDs, source
identifiers/URLs, edition, document/content checksums, and page references.
Private storage paths, school relations, contact data, review notes and
authorization notes are excluded. Missing/tampered source files, metadata or
records fail closed with `CURRICULUM_INTEGRITY_FAILED`.

`CurriculumPromptContext::build($operation, $selection)` re-retrieves the selected
records from the database; it does not trust a caller-supplied "verified" flag.
The system message treats all source text as untrusted reference data. Only
allowlisted educational selection inputs and JSON-encoded reference data enter
the user message. No learner, guardian, sponsor, medical, financial, staff-profile,
or other personal model is queried. Review/upload actor IDs are excluded.
The builder returns messages and context without invoking inference or saving
teaching documents. Reference text can contain adversarial instructions; role
separation is a guardrail, not proof that a model will resist every injection.

In Phase 3, extend the existing provider interface with an Ollama adapter that
uses this builder, `OllamaService`, and contract validation. Keep inference outside
long database transactions, recheck authorization, then use existing audited draft
and human review/manual-save workflows. No adapter is bound or enabled here.

## Four output contracts

`GroundedDocumentContract::schema()` emits strict JSON Schema 2020-12 objects for
`scheme_of_work`, `lesson_plan`, `homework`, and `exam_paper`.
`validate()` enforces the exact emitted vocabulary and semantic checks; it is
not a general third-party JSON Schema engine.

Every contract requires `status: draft`, grade, learning area, title, all selected
source/page/checksum references, exact identified learning outcomes, and an empty
`curriculum_claims` list. Unknown fields are rejected. Activities/questions must
reference outcomes belonging to their selected records and cover the selected
outcomes. Grade, subject, IDs, checksums, references and outcome text are checked
against freshly retrieved verified data, rather than trusting model assertions.

- Schemes require unique weeks, lesson counts and durations, activities and
  assessment approaches; weekly multiplication and overall duration must agree.
- Lesson plans require resources, assessment approach, ordered introduction,
  development and conclusion stages; stage minutes must equal lesson duration.
- Homework requires instructions and structured questions with matching marks.
- Exam papers require duration, sections and questions; section totals and
  document totals must agree. Positions are unique, marks positive, and
  multiple-choice answers must match distinct recorded options.
- Optional trusted constraints preserve requested marks and duration totals.
  Explicit alignment/approval claims, altered outcomes, foreign references and
  unsupported extra fields are rejected. Human review is still required for
  factual correctness, teaching suitability, less obvious unsupported claims,
  privacy in generated prose, and assessment quality.

No generated result is approved, published, or saved automatically.

## Official pilot source verification

The official [regular-designs index](https://kicd.ac.ke/cbc-materials/curriculum-designs/regular-curriculum-designs/)
and [Grade Seven page](https://kicd.ac.ke/cbc-materials/curriculum-designs/grade-seven-designs/)
were checked. The Integrated Science embed links to
[this Google Drive preview](https://drive.google.com/file/d/1jbicj1qkLFEV_ZXwO8Kmlw7KzGhZD2ri/preview),
labelled "Integrated Science Grade 7 - July 2024.pdf". Its public download
response says the owner has not permitted downloads. The response was HTML,
not PDF bytes, and was retained privately as evidence rather than mistaken for
a source PDF. No bypass of that restriction was attempted.

The actual regular-design document, PDF checksum, page text and extracted
curriculum content could therefore **not** be verified. The manifest marks it
not verified/not approved, with no curriculum records and no invented date,
strand, sub-strand or outcome. Officially hosted adapted designs surfaced in
search, but were not substituted for the requested regular-curriculum pilot.
An authorized copy and administrator page-by-page review are needed to populate
the pilot. The application has imported no KICD document or curriculum content.

## Backup, isolated restore and active database safety

The original Phase 1 backup was revalidated against its size and SHA256 and
restored only into a new MySQL 8.0 container with no network, host ports, or
persistent mounts. All 58 restored table inventories and row counts matched.

A fresh private snapshot was also created before the attempted installation:

- `storage/app/private/curriculum-pilot/mgaems-before-curriculum-2026-10-17T21-30-24-311Z.sql`
- **185249 bytes**, **58 tables**.
- SHA256 `0bf2a57330a95930235195f79dedb3c9b4f8060f10c28ff9dcbdb0ca067c70d5`.
- Verified saved bytes, completion marker, all table definitions and INSERT row
  counts, and stable source counts/checksums. Backup bytes stayed private and
  ignored by Git. All source tables were InnoDB; native MySQL 8.0 `mysqldump`
  used single-transaction capture without PowerShell text redirection.
- The fresh snapshot was independently restored into a second isolated container;
  all 58 table inventories and row counts matched again.
- The new migration was applied only to those disposable copies. Existing table
  checksums were identical before/after the additive schema test. Synthetic
  test writes ran in a rollback-only transaction, never against the active DB.
- Owned disposable containers were verified by exact identity/label and removed.
  No active container or persistent database volume was removed or restored.
- Private restore evidence is in
  `storage/app/private/curriculum-pilot/restore-test-evidence*.json`.
  The exact read-only backup procedure is retained beside the fresh dump as
  ignored `backup.cjs` and its `.verification.json` evidence.

The active installation command was rejected before execution. No active schema
change or migration row was added. The read-only verification helper compares
existing checksums with the pre-install baseline and records the actual pending
retrieval response. Revalidate a fresh backup if installation occurs later.

## Validation and sample retrieval

Run the curriculum suite only with its default in-memory SQLite mode, or through
the guarded isolated MySQL runner. The MySQL test script refuses any database
other than `mgaems_curriculum_test` at `127.0.0.1` with the expected server UUID.
It refuses to overwrite an existing curriculum library.

```powershell
docker exec mgaems-app php tests/safe/curriculum_library.php
node tests/safe/curriculum_mysql.cjs storage/app/private/curriculum-pilot/mgaems-before-curriculum-2026-10-17T21-30-24-311Z.sql
docker exec mgaems-app php tests/safe/teaching_learning_workspace.php
docker exec mgaems-app php tests/safe/ollama.php
node --test tests/frontend/schemes-of-work.test.cjs tests/frontend/lesson-plans.test.cjs tests/frontend/records-of-work.test.cjs tests/frontend/homework.test.cjs
```

Curriculum test cases use clearly labelled synthetic documents and learning
outcomes under an invalid example domain; none are KICD curriculum or live school
data. Coverage includes registration, authorization, private PDF checksums,
duplicate imports, versioning, malformed extraction, manual correction,
approval/stale review, missing/unverified content, grade/subject mismatch,
retrieval references, prompt construction, all four strict contracts, marks and
duration totals, integrity failures, existing provider selection, and route roles.

Actual results: **27/27 curriculum checks passed on in-memory SQLite and
27/27 on isolated restored MySQL 8.0**, with additional pre-install availability
guards checked before the schema was created. Existing regressions passed:
**13/13 teaching-workspace backend checks**, **11/11 isolated Ollama checks**, and
**23/23 teaching frontend tests**. All 13 new PHP files passed the project's
formatting check, the Node restore runner passed syntax validation, and
`git diff --check` passed. Read-only live verification confirmed unchanged
migration count and checksums for all 57 existing non-migration tables.

After installation, an authenticated grade-only query can discover references:
`GET /api/v1/curriculum-library/retrieve?grade=7&learning_area=Integrated%20Science`.
Strand/sub-strand filters or explicit IDs can then narrow the verified context.
The actual active-service response while installation is pending is:

```json
{
  "data": {
    "available": false,
    "reason": "CURRICULUM_LIBRARY_NOT_INSTALLED",
    "selection": {"grade": 7, "learning_area": "Integrated Science", "subject_id": null},
    "records": []
  }
}
```

With the schema installed but no administrator-approved pilot content, the reason
becomes `NO_VERIFIED_CURRICULUM`; `records` stays empty. A successful reference
shape is demonstrated by synthetic fixtures in the tests, not by fabricated
official curriculum. The current limits are pending installation approval,
authorized access to the regular pilot document, manual source/content review,
and the intentionally deferred teaching-generator integration.
