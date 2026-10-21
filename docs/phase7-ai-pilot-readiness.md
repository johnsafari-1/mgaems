# Phase 6 final audit and Phase 7 pilot readiness

Audit date: 19 October 2026. Workspace: `D:\mgaems`.

**Historical Phase 6 snapshot:** the inventory and no-write statements below
describe that audit. The subsequently approved Grade 7 academic changes, selected
teacher/term, audit IDs and remaining blockers are recorded in
[Phase 7 Grade 7 Science setup](phase7-grade7-science-setup.md).

**Engineering readiness: isolated synthetic pilot passes. Real-content pilot:
blocked by source authorization/content and school mapping.** The active
`MGAEMS_AI_DRIVER` remains `disabled`. Existing Phase 6 generators were retained
and hardened. No active database writes, curriculum ingestion, permission or
approval-workflow changes, commits or pushes were performed.

## 1. Final import and acceptance audit

| Area | Result |
| --- | --- |
| Schemes | Fresh authorized GET before writes; existing week numbers excluded initially; fixed planned weeks reconciled by complete saved payload on retries; conflicts stop. A committed week whose response is lost is not posted again. |
| Lesson plans | Single authorized PATCH; repeat application is content-idempotent. Shared busy guard prevents double-click writes. |
| Homework | Fresh GET is mandatory; complete question payloads, not prompt alone, identify duplicates. Planned positions stay fixed across retries; a different question at a planned position stops the import. Existing and planned marks are included in the homework total. |
| Exam papers | Fresh GET is mandatory; section/question positions stay fixed for the dialog. Saved sections are reconciled and their confirmed IDs are required before question writes. Lost section/question responses do not create new sections or shift questions on retry. |
| Partial failure | Stop at first failed write, retain saved items, report progress, keep the dialog open. Reviewed JSON is locked after import starts so a retry cannot silently become a different batch. |
| Teacher acceptance | A successful explicit Import/Apply calls `POST /ai-teaching/runs/{run}/accept`. Content failure never accepts. Acceptance failure offers an acceptance-only retry with no re-import. The endpoint locks the run and atomically saves acceptance plus one `ACCEPT_AI_TEACHING_DRAFT` audit event linked to the target document. Repeated acceptance returns the original actor/time without duplicate audit events. |
| Disabled AI | All four interfaces use the shared status gate; disabled/unconfigured AI issues no draft or document write. Manual authoring remains available. Availability is rechecked on retry. |
| Authorization | Imports use the existing Sanctum/role-guarded document APIs and allocation/status checks. The HTTP pilot confirms foreign teacher reads/acceptance are denied. A grounded draft's allocation/type must match its linked target. |

Additional integration fixes found by the audit:

- Homework's generic `min:2` options rule rejected valid short-answer
  `options: []`. The type-specific `preparedQuestion()` validation remains the
  authority: multiple-choice still needs two options and a matching answer;
  other question types cannot carry nonempty options.
- Ollama now receives the requested marks/duration constraints in its user-data
  prompt; output validation continues to enforce those same constraints.
- Contract limits now match the homework question/position cap (100) and
  document option text cap (255 characters).

### Recovery boundary

These imports are a sequence of existing audited API requests, not an atomic
whole-document transaction. The fixed recovery plan lives in the open dialog.
After cancel/reload, inspect saved content before starting another import.
There is no durable server-side batch receipt associating each child row with a
run, no automatic cross-browser resumption, and no whole-import rollback.
Concurrent conflicting positions fail closed; durable exactly-once batch
semantics across reloads would require a separately approved persistence/API
design. Acceptance records the reviewed AI run and document link, not a complete
immutable copy of the teacher-edited imported JSON.

## 2. Actual active inventory (read-only)

Run the repeatable inventory with:

```powershell
docker exec mgaems-app php tests/safe/ai_pilot_readiness.php
docker exec mgaems-app php tests/safe/ai_pilot_readiness.php --ollama-models
```

The script uses a MySQL **READ ONLY** transaction. The optional second command
makes a server-side model-list GET only; it never generates text or enables AI.

Observed inventory:

| Item | Observed |
| --- | --- |
| AI driver | `disabled` |
| Curriculum schema | All four tables already installed; no migration is needed for this pilot |
| Sources | 2 metadata-only registrations |
| Source versions | 0 |
| Structured curriculum records | 0 |
| Learning outcomes | 0 |
| Grade 7 Integrated Science retrieval | `available: false`, `reason: NO_VERIFIED_CURRICULUM`, `records: []` |
| Ollama | Reachable from the app container; installed model list includes `qwen3:1.7b`; configured timeout 120 seconds |

Existing source registrations:

1. ID **1**, `kicd-integrated-science-grade7-april-2024`, grade **7**, area
   **Integrated Science**, `subject_id: null`, no version/document/records.
2. ID **2**, `kicd-integrated-science-grade1-april-2024`, grade **1**, area
   **Integrated Science**, `subject_id: null`, no version/document/records.
   This is metadata only; its grade/edition appropriateness has not been verified.

**Exactly what is missing:** every qualifying approved/verified curriculum
record and learning outcome is absent, including the entire Grade 7 Integrated
Science pilot. Neither source has any uploaded edition or review evidence.
There are no approved record IDs, strand/sub-strand records or outcome IDs to
list. Exact official strand names, page references and outcomes cannot be
enumerated without the authorized document; none were invented.

This snapshot supersedes older reports describing the curriculum migration as
uninstalled. The present blocker is empty/unreviewed content, not missing schema.

## 3. Numerical grades and school mapping

- The generator explicitly requires an integer grade **1–12**. Retrieval and
  source registration also validate that range. The HTTP pilot verifies that a
  fractional grade is rejected and the wrong whole-number grade returns no data.
- `classes` has `name`, `level`, `sequence`, capacity and class-teacher fields;
  there is **no dedicated numerical grade column**. The UI does not infer grade
  from a class ID or from `level`. A teacher must select the actual numeric grade.
  School staff must verify the grade-to-class match for the pilot.
- The document's exact `class_subject_teacher` allocation pins its subject ID.
  The current server mapping chooses `subjects.learning_area`, falling back to
  `subjects.name`. Supplied client area text cannot override it.
- With a subject ID in retrieval, the source must have that same `subject_id`;
  a source with a null subject link will not satisfy the allocation-pinned query.

Actual subject metadata needing administrator review:

| Subject ID | Stored subject name | Stored `learning_area` |
| --- | --- | --- |
| 1 | mathematics | Numbers |
| 2 | english | Speaking Skills |
| 3 | kiswahili | Lugha |
| 4 | Intergrated Science | Matter |
| 5 | Social Studies | Population |

The stored learning-area strings do not match the registered pilot area
`Integrated Science`; several look like topics/strands. Subject 4 also has a
spelling difference in its name. These values were **not corrected automatically**.
The exact strings must be agreed by the school's administrator before source
linking and approval.

Observed allocation pairs (all reference term ID 1): Grade 1/class 7 has subjects
1 and 3; Grade 3/class 10 has subject 1; Grade 4/class 12 has subject 2; Grade
7/class 11 has subject 5. **There is no Grade 7 Integrated Science allocation**
(class 11, subject 4). No approved curriculum exists for those other allocations
either. Validate the chosen term and active teaching-staff linkage when creating
the authorized pilot allocation; do not derive authority from class names alone.

## 4. Source registration, upload, review and approval

The existing administrator screen is `public/curriculum-library.html`; the API
prefix is `/api/v1/curriculum-library`. These existing permissions are retained:
active **system administrator** for registration/upload/import/review/approval/
withdrawal/private document download; active authorized teaching staff and
leadership for retrieval.

1. `POST /sources` (or `PUT /sources/{source}` while unreviewed): register exact
   title, publisher, HTTPS provenance URL, numeric grade, learning area and
   optional matching subject ID. No URL is fetched automatically. The current
   registration UI does not expose the optional subject ID; use the existing
   administrator update API for the pilot link before approval.
2. `POST /sources/{source}/versions`: authorized multipart PDF upload, edition,
   document URL, optional date and an authorization basis. PDF MIME/header and
   20 MiB limit are checked, SHA256 calculated, and bytes stored privately.
   Duplicate editions or document hashes within the source are rejected.
3. `POST /versions/{version}/records`: reviewed structured extraction, up to 100
   records/request, atomically imported. Stable record keys, strand/sub-strand,
   page references and nonempty outcome lists are required; experiences,
   inquiries and assessment approaches are explicit lists. Unknown fields are
   rejected. Corrections use `PUT /versions/{version}/records/{record}`.
4. `GET /versions/{version}` plus `/document`: inspect the actual authorized PDF
   and full extracted JSON, including experiences/inquiries/assessment approaches.
   The summary screen shows strands, pages and outcomes, so use the full review
   API response as well to check every field before attesting approval.
5. `POST /versions/{version}/approve`: send current PDF/content SHA256 values,
   document/content/authorized-use attestations and verification notes. The server
   rechecks bytes, extraction/metadata checksum and subject mapping. Stale hashes
   fail. Approval sets `approved/verified` and supersedes the prior approved
   edition of that source. Reviewed content is immutable.
6. `POST /versions/{version}/withdraw` revokes an edition with a recorded reason;
   superseded editions are not silently reactivated.

Retrieval requires approved/verified records, exact grade/area/subject filters and
intact document/content hashes. More than 20 matching records requires a narrower
selection. Installed-schema status does not certify record coverage or model
health. Neither a URL nor a registered title is evidence of authorized use or
source approval.

### Acceptance criteria for a real source

- An actual authorized copy is available; the school's authority covers private
  retention, extraction and the intended model-assisted use. Document the grant
  and scope in `authorization_basis`; public hosting alone is insufficient.
- Confirm the actual publisher, curriculum variant, grade, learning area,
  edition/date and provenance. Reconcile differing edition labels against the
  document; do not substitute an adapted design for a regular design.
- Upload genuine PDF bytes, retain the server-calculated hash and private file,
  and verify the file is readable and complete.
- Link to the agreed existing school subject before approval. Check every
  imported field and outcome against its cited page/section, preserve exact
  outcome text, record corrections, and include no school personal data.
- Approve only the current PDF/content checksum pair through the existing system
  administrator workflow, with all three attestations and substantive notes.
- Demonstrate exact grade/area/subject retrieval, explicit record/outcome IDs,
  missing/wrong-grade/withdrawn/tampered failure cases, and bounded topic scope.
- Have a teacher assess factual accuracy, age/grade suitability, marks, durations,
  answers and references for all four resulting drafts. Run acceptance must not
  approve or publish a teaching document; its normal review remains separate.

No restricted document was fetched, bypassed, scraped or ingested for this audit.

## 5. Isolated synthetic pilot (prepared and executed)

```powershell
docker exec mgaems-app php tests/safe/curriculum_grounded_pilot.php --synthetic
```

The script requires the explicit flag, reuses the guarded workspace suite's
SQLite `:memory:` bootstrap, replaces the configured connections before providers
boot, uses fake private storage and `Http::preventStrayRequests()`, and calls the
real HTTP kernel/routes/middleware. Sanctum test users are injected only in that
test process. Provider configuration is transient in that process; active
environment settings are untouched. All content is original synthetic fixture
text under `example.invalid`, never KICD-labelled official content.

Executed path:

1. Disabled status/generation failure without an upstream request.
2. Administrator source registration, authorized synthetic PDF upload, extraction,
   current-checksum review and approval; teacher approval denied.
3. Matching retrieval; wrong-grade and fractional-grade rejection.
4. Four server-side Ollama adapter calls with **faked transport**, strict contract
   checks and requested marks/duration constraints. Target allocation mismatches
   are rejected before inference.
5. Create/import into all four teaching documents through their actual APIs;
   duplicate child positions rejected and repeated lesson PATCH safe.
6. Foreign teacher access denied; explicit acceptance linked to the exact run
   and document; retry acceptance produces one audit event. All documents remain
   drafts. No automatic submission, approval or publication.

The complementary frontend tests exercise partial failures, lost section/week/
question responses, conflicting edits, double-clicks and acceptance-only retry.
This pilot proves integration behavior with deterministic responses. It does not
certify real `qwen3:1.7b` content quality, latency or browser layout/usability.

## 6. Ollama runtime prerequisites

- Configure `OLLAMA_BASE_URL` (Docker default
  `http://host.docker.internal:11434`), `OLLAMA_MODEL=qwen3:1.7b` and a positive
  `OLLAMA_TIMEOUT` (currently 120). The app container must resolve/reach the host
  and model server. Container `localhost` refers to the app container, not the host.
- Server-side `GET /api/tags` must return the configured installed model. This
  connectivity check passed. No pull, inference or service change was needed.
- In an explicitly authorized **isolated pilot deployment**, use the existing
  Ollama provider binding; keep the active deployment driver disabled. Coordinate
  PHP/proxy/client timeouts with inference duration and test resource capacity.
- Inference uses server-side `POST /api/chat`, nonstreamed JSON, with no redirect
  following, bounded connection/request timeouts and sanitized upstream errors.
  Browser code uses only authenticated MGAEMS endpoints.
- Before a real pilot, measure valid-output rate, latency, timeouts, completed
  response handling, factual quality, totals and source fidelity with approved
  content. Model presence alone is not an inference-quality sign-off.

## 7. Production-readiness checklist

### Completed engineering checks

- [x] Existing four generators and authorized teaching APIs retained.
- [x] Fresh-read, fixed-position retry reconciliation and conflict handling tested.
- [x] Explicit teacher import linked to atomic, idempotent run acceptance/audit.
- [x] AI-disabled behavior tested for all four operations.
- [x] Synthetic source/upload/review/approval-to-import HTTP pilot passes.
- [x] Unauthorized source approval, foreign documents and foreign run acceptance denied.
- [x] Numerical-grade validation and exact allocation mapping exercised.
- [x] Ollama model-list connectivity confirmed server-side without inference.
- [x] Focused regressions, syntax checks and `git diff --check` pass.
- [x] Active driver disabled; active database and permissions preserved.

### Required before an authorized real-content pilot

- [ ] Name the pilot teacher, administrator, class, term, subject and narrow topics.
- [ ] Approve the exact school metadata/allocation changes and authorized content
  writes, with backup/restore verification appropriate to the target deployment.
- [ ] Correct/agree subject 4's canonical name and learning area, create the
  Grade 7 Science offering/allocation through existing APIs as needed, and link
  source 1 to subject 4. Validate active teaching-staff and term scope.
- [ ] Obtain and document authorized access/use of the actual pilot edition.
- [ ] Upload, extract, review and approve that edition with real current hashes.
- [ ] Retrieve the chosen approved records with `grade=7`, the agreed
  `learning_area`, `subject_id=4` and a suitably narrow topic/strand/record set.
- [ ] Authorize an isolated real-model pilot configuration and perform the four
  generation/import/acceptance flows with a teacher quality rubric.

### Required before broad production enablement

- [ ] Manual browser/device/accessibility verification of each import and retry.
- [ ] Real-model quality, latency/load/timeout and failure-recovery acceptance.
- [ ] Operational ownership for source withdrawal, model failures, audit review,
  backups and reverting the driver to disabled.
- [ ] Agree recovery expectations for reloads/multiple browsers; add durable
  server-side batch receipts if exactly-once cross-session imports are required.
- [ ] Explicit release authorization to enable the driver in the active environment.

## 8. Regression evidence

| Check | Result |
| --- | --- |
| Full frontend suite | 656 passed, 0 failed |
| Focused grounded frontend suite | 12 passed, including lost-response and acceptance retry cases |
| Teaching workspace backend | 17 checks passed (also run as the pilot prerequisite) |
| Curriculum library/contracts | 28 checks passed |
| Ollama transport | 11 checks passed; no live HTTP or database |
| Authorization | 18 checks passed |
| Teacher workspace | 21 checks passed, plus its 18-check authorization prerequisite |
| Synthetic HTTP pilot | Source workflow and all four import/acceptance flows passed; 4 faked inference calls |
| PHP/JavaScript syntax and diff whitespace | Passed |

No isolated-MySQL restore drill or real inference-quality test was claimed for
this finalization. Those require a separately scoped pilot run. No active schema
installation is required by the observed snapshot.
