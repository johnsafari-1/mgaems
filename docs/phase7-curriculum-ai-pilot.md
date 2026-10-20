# Phase 7 — Curriculum-grounded AI pilot findings

Audit date: **21 October 2026**. Workspace: `D:\mgaems`.

## Outcome

**Local connectivity works. The unchanged four-generator pipeline is not ready
for a real-content pilot: all four full generations exceeded its 120-second
timeout.** A separately labelled, test-process-only no-thinking/JSON-schema
experiment returned four completed JSON objects, of which three passed the
existing contract. The scheme was correctly rejected for inconsistent durations.
The examination question passed structural checks but was not self-contained.

The school AI driver remains **disabled**. Active MySQL was inspected inside
explicit **READ ONLY** transactions only. No school records, school-source approvals,
environment files, running services or application deployment were changed.
No protected curriculum was fetched. No AI Records of Work were generated.

## 1. Git and runtime state

| Item | Observed state |
| --- | --- |
| Requested branch context | `feature/production-ui` |
| Actual checked-out branch | `feature/mgaems-curriculum-ai-exam-studio` |
| Starting HEAD | `7043484` — `feat: prepare Grade 7 science pilot and isolated demo` |
| Phase 6 baseline | `87bc93c7` / `87bc93c` — grounded imports and readiness |
| Local `feature/production-ui` tip | `83539ce`; older than the curriculum/AI checkpoints |
| School app container | `mgaems-app`, stopped; not started or rebuilt |
| Original stopped image | `69ce9f2f621e...`; unavailable to a fresh `docker run` |
| School database | Existing `mgaems-mysql`, MySQL 8.0, running/healthy; published on loopback port 3307 |
| Synthetic demo containers | Both stopped; left stopped |
| Isolated audit interpreter | Existing `mgaems-preflight-php83:rehearsal`, PHP **8.3.35** |
| Application dependency volume | `mgaems_mgaems_vendor`, mounted read-only; Laravel **13.35.0** |
| Host CLI/vendor caveat | Host PHP 8.1.25 and local `vendor/` Laravel 10 are not the current Docker dependency set; local vendor also lacks the live Guzzle transport |

The earlier Teaching Oversight task had already produced uncommitted application,
route, navigation and review-page changes when this pilot request arrived.
Those changes were preserved and excluded from the pilot commit. Tests run in
this workspace see that working tree, so this is not a clean-HEAD certification.
No branch checkout, stash, reset, push or deployment was performed. The pilot
report/test commit stays on the actual branch; moving it to the intended release
branch needs an explicit integration decision.

Already completed before this audit: Ollama transport and provider, curriculum
registration/private storage/extraction review/approval, four grounded generators,
retry-aware imports, atomic/idempotent acceptance, authorization regressions,
deterministic end-to-end pilot, and an isolated deterministic browser demo.
These features were reused rather than rebuilt.

## 2. Ollama connectivity and real generation

- Host `GET http://127.0.0.1:11434/api/tags`: succeeds.
- Ollama version: **0.40.6**.
- Installed tag: **`qwen3:1.7b`**, digest
  `8f68893c685c3ddff2aa3fffce2aa60a30bb2da65ca488b61fff134a4d1730e7`.
  The server reports Q4_K_M GGUF and parameter size `2.0B`; that is server
  metadata, not a different model selected by this audit.
- A disposable Laravel/PHP container reaches
  `http://host.docker.internal:11434`; tags, JSON generation and sanitized
  missing-model handling pass. The stopped school app itself could not be
  `docker exec`-tested. A separate read-only inventory container using its
  existing environment and mounts also reaches the model-list endpoint.
- No port publication, firewall, Ollama binding, model installation or active
  provider setting was changed.

### Real latency observations

Single observations on this machine, sequential full-document calls; these are
not throughput, percentile, cold-start or load-test benchmarks.

| Probe / operation | Wall time | Result |
| --- | ---: | --- |
| Tiny `{"status":"ok"}` through existing transport | 32.571 s | Exact JSON object |
| Synthetic temperature comparison/arithmetic through existing transport | 33.803 s | `{"warmer_celsius":30,"rise_celsius":5}`; correct |
| Scheme, unchanged application transport | 120.466 s | HTTP 503, sanitized timeout; no import |
| Lesson plan, unchanged application transport | 120.688 s | HTTP 503, sanitized timeout; no import |
| Homework, unchanged application transport | 120.315 s | HTTP 503, sanitized timeout; no import |
| Exam paper/questions, unchanged application transport | 120.524 s | HTTP 503, sanitized timeout; no import |

A timeout does **not** establish that the model produced malformed JSON or
completed its generation. No completed response envelope was received for those
four calls. Server-side cancellation/resource recovery after client timeout
has not been established.

### Test-only diagnostic variant

The opt-in `--no-think-diagnostic` flag changes outgoing requests **only inside
the disposable test process**: `think: false`, `format: <existing output schema>`,
`temperature: 0`, `num_predict: 2048`. Application transport, prompts, contracts,
provider configuration and all production import safeguards remain as found.
This experiment changes multiple variables and does not isolate which one
accounts for the difference.

| Operation | Wall time | Completed? | Existing contract / import result |
| --- | ---: | --- | --- |
| Scheme of Work | 98.813 s | Yes, `stop`, 412 output tokens | HTTP 422: `1 lesson × 40 minutes` did not equal recorded `80`; correctly blocked |
| Lesson Plan | 113.991 s | Yes, `stop`, 495 output tokens | HTTP 201; 10+20+10=40 minutes; isolated import and acceptance exercised |
| Homework | 101.218 s | Yes, `stop`, 423 output tokens | HTTP 201; one 5-mark question; isolated import and acceptance exercised |
| Examination questions | 105.466 s | Yes, `stop`, 423 output tokens | HTTP 201; section/question totals both 5; isolated import and acceptance exercised |

All four diagnostic responses were parseable JSON with zero reported thinking
characters. Existing checks verified exact source/version/hash/page references,
outcome IDs/text, selected grade/area, empty official-approval claims, item links,
marks and applicable duration totals. The rejected scheme demonstrates that
schema-constrained JSON alone does not guarantee consistent educational data.

### Quality observations requiring teacher review

- Lesson: stayed on the original temperature topic and used ordered stages,
  resources, inquiry and assessment. Activities are generic; it does not establish
  Grade 7 pedagogical depth or completeness.
- Homework: temperature comparison is correct, but the prompt refers to an
  original sheet that must actually accompany the task. Its marking guidance
  does not allocate all five marks explicitly. A structurally valid draft is
  still an editing task.
- Exam: asks learners to read two thermometer values **without including the
  actual readings or a diagram**. The answer key merely says the higher value is
  warmer. This is unsuitable as a standalone printed question until corrected.
- Source fidelity: the synthetic references/outcomes were preserved; this is
  not evidence of KICD alignment, authorized content coverage or factual quality
  across a real curriculum.
- Actual teacher quality review/acceptance is **pending**. The three acceptance
  calls above use a synthetic test actor to exercise the existing API, not a
  teacher sign-off. All target documents remain drafts.

## 3. School mapping and content blockers — fresh read-only evidence

| Record / prerequisite | Current result |
| --- | --- |
| Subject 4 historical mismatch | Earlier `Intergrated Science` / `Matter` was already corrected to **`Integrated Science` / `Integrated Science`** |
| Grade 7 class | Class 11, junior, sequence 7; class identity preserved |
| Class/subject offering | Offering 10: class 11, subject 4 |
| Teaching allocation | Allocation **6**: class 11, subject 4, staff 4, term 3 |
| Staff/account eligibility | Active teaching staff and active linked account |
| Current term | Term 3, **27 August–23 October 2026**; re-confirm scope before a later pilot |
| Source 1 | Grade 7, area `Integrated Science`, linked to subject 4; April 2024 registration label |
| Source 2 | Grade 1, unlinked metadata only; previously reported Grade 7 URL mismatch still needs source review |
| Library inventory | **2 registrations; 0 versions; 0 records; 0 learning outcomes** |
| Grade 7 retrieval | `available: false`, `NO_VERIFIED_CURRICULUM` |
| Active driver | **`disabled`** |

The persisted approved academic setup is recorded in
[the Grade 7 setup report](phase7-grade7-science-setup.md), including audit IDs
508–511. The mismatch/allocation findings in the earlier Phase 6 inventory are
historical, not instructions to repeat those writes.

**No correction is currently needed for Subject 4.** If a separately approved
deployment still has the old values, update only the existing subject's `name`
and `learning_area` through `PATCH /api/v1/subjects/4`, after confirming ID/code
and dependencies. Preserve its ID/code/status and existing offerings/timetables.
Check for an existing class/subject/term allocation before creating anything.
Do not rename other subjects whose area strings look like topics. No such
operation was performed by this audit.

## 4. Authorized curriculum onboarding workflow

The authorized Grade 7 PDF and usage evidence remain unresolved. The previous
Drive preview filename says **July 2024**, whereas source 1 says **April 2024**.
Neither the filename nor a public URL confirms the internal edition, variant,
publisher, permission or approval. No document was downloaded in this audit.

Use the existing Curriculum Library, initially in the isolated pilot deployment:

1. Obtain an authorized copy and evidence permitting private retention,
   extraction and the intended model-assisted use. Record the grant/reference,
   licensing/permission scope and restrictions in `authorization_basis` (and
   verification notes where needed). Public hosting is not permission evidence.
2. Verify publisher **Kenya Institute of Curriculum Development** against the
   actual document, grade **7**, learning area **Integrated Science**, curriculum
   variant, exact edition/date and HTTPS provenance. Reuse source 1 only if its
   metadata genuinely matches; otherwise use the existing source registration
   workflow for the correct edition/identity with administrator authorization.
3. `POST /api/v1/curriculum-library/sources` retains publisher, source URL, grade,
   area and optional matching subject link. Registration never downloads a URL.
4. `POST /sources/{source}/versions` uploads actual PDF bytes privately with
   edition, document URL/date and authorization basis. The server validates the
   PDF/20-MiB limit and stores its SHA256. Do not enter a guessed checksum.
5. `POST /versions/{version}/records` imports manually reviewed structured JSON:
   stable record key, strand/sub-strand, **page-level provenance**, exact outcomes,
   learning experiences, inquiry questions and assessment approaches. Inspect the
   full version response and private PDF; correct draft records through the
   existing correction endpoint. No automatic source scraping/extraction assumed.
6. The authorized system-administrator reviewer checks the actual PDF, every
   extraction field and permission evidence, then submits the **current** PDF and
   content checksums plus the three attestations and substantive verification
   notes to `POST /versions/{version}/approve`. Approval has not occurred for any
   school curriculum content. Synthetic fixture approval is not school approval.
7. Retrieve exact grade/area/subject and narrow approved record IDs; retain source
   version/hash/page/outcome IDs. Exercise wrong grade, subject, withdrawal,
   unapproved and tampered content only in the isolated environment.

## 5. Isolated pilot implementation and checks

`tests/safe/curriculum_grounded_live_pilot.php` extends the existing synthetic
HTTP pilot. Before providers boot, the prerequisite replaces every database
connection with SQLite **`:memory:`**. A second connection guard and query
listener refuse persistent databases. Private storage uses the fake testing disk
on container tmpfs; it never mounts school private files. Original temperature
text and a generated one-page PDF are the only new source content.

The baseline source is not official curriculum. The synthetic junior class,
offering, allocation, source review and draft targets are created through the
existing APIs. Each live target uses that allocation/term. Existing term/date
validation is exercised by the prerequisite; generated schemas do not invent
term dates or completed teaching records. The successful real-model imports
retain in-term target dates and leave targets in draft state.

The runner measures all four operations even when one fails, prints model
completion/latency/validation evidence, and exits **2** unless all four outputs
pass. Both real-model runs intentionally exited 2: baseline 0/4, diagnostic 3/4.
That is a pilot finding, not an all-green result. No failed output was imported.
Successful imports exercised foreign-teacher denial, duplicate question
rejection, repeated acceptance and exactly one acceptance audit per run.

| Executed check | Result |
| --- | --- |
| Existing teaching workspace prerequisite | 17 checks passed on Laravel 13 / SQLite memory |
| Existing synthetic HTTP pilot | Four deterministic generation/import/acceptance paths passed, including mapping and source workflow |
| Real-model baseline | 0/4 completed before timeout; no imports |
| Real-model diagnostic | 3/4 contract-valid/importable; one correctly rejected scheme |
| Live transport probes | 4 passed, including correct educational JSON and sanitized missing-model error |
| Isolated transport regressions | 11 passed: malformed/non-object JSON, incomplete/truncated envelopes, errors/timeouts, invalid configuration/messages |
| Curriculum library/contracts | 29 counted checks plus 2 pre-install checks passed |
| Focused frontend regressions | 27 passed: Library, grounded imports/recovery, Exam Studio |
| Real browser, synthetic intercepted APIs | Four interfaces passed the checks described below |

Two narrowly scoped tooling improvements: the Ollama standalone test now defines
its array cache store explicitly (needed by a clean bootstrap), and the read-only
inventory reports runtime versions plus minimal Grade 7 offering/allocation
eligibility/date metadata. No application AI implementation changed for Phase 7.

## 6. Browser review and Rubrica-style gaps

Executed `tests/safe/phase7_browser.cjs --synthetic` in real headless
**Microsoft Edge 155.0.4283.62** via externally installed `playwright-core`.
Actual HTML/CSS/JavaScript runs in the browser. All API responses are intercepted
synthetic fixtures on a reserved `.invalid` origin; external requests are blocked.
This is real browser UI evidence, **not** a browser session against the real
model/database, a manual accessibility audit, or school acceptance.

For Schemes, Lesson Plans, Homework and Exam Studio:

- Loaded the actual page, opened its actual generator entry point, and tested
  disabled AI, loading indication and a model-timeout error.
- Displayed references and editable generated JSON; malformed JSON blocked import.
- Edited instructional content and verified that it reached the import requests.
- Verified no document writes before explicit import, exactly one acceptance
  request afterward and retained draft state.
- No uncaught browser exceptions or unhandled API routes; no document-level
  horizontal overflow at **1440×1000** and **375×812** in these fixtures.
- Exam learner preview hid answers; switching to staff marking view displayed them.

Feature comparison is against the repository's Rubrica-inspired studio target;
no particular external Rubrica release or reference screenshot was supplied.

| Area | Present / remaining gap |
| --- | --- |
| Studio shell | Setup, central saved-paper preview/editor, outline, sections, marks and drag reorder present; not a rich inline page editor |
| Generated preview | Four interfaces expose editable **JSON**, not a semantic weekly grid/lesson timeline/question-card preview before import |
| Live editing | Paper preview reflects the last saved state; unsaved textarea edits are not rendered live |
| Question fields | Plain-text editing with TeX-style text guidance; no rendered equation/rich-text editor established |
| Section selector defect | Real browser showed `Select...`, `No section`, **blank label** after import; selector renders `row.name` while real sections carry `title` |
| Preview structure | Current paper preview flattens questions; section titles/instructions are not laid out as full printable section blocks |
| Marking quality | No semantic check for missing stimulus/readings/diagrams or sufficiently detailed mark allocation; real-model exam example demonstrates this gap |
| AI controls | Whole-document generation/import exists; per-question grounded rewrite/difficulty controls and question-bank browsing are not established |
| Layout/export | A4-style preview, identity templates and PDF exports exist; editable page breaks, full print pagination and physical printing were not browser-accepted here |
| Diagrams | Private upload/sketch and PNG/JPEG PDF embedding exist; WebP PDF embedding remains unsupported |
| Recovery/history | Retained exam revisions/versions and dialog-local retry reconciliation exist; reload/cross-browser batch receipts, whole-import rollback and editor undo/redo are not established |
| Accessibility/devices | Basic real-browser desktop/mobile checks passed; keyboard/screen-reader, contrast, dark mode and manual device/printing acceptance remain pending |

The section-selector and preview issues are reported rather than mixed into
the preserved uncommitted application work.

## 7. Reproduction

Run from `D:\mgaems` using the existing compatible image and dependency volume.
These commands mount the source and dependencies read-only, use disposable
private tmpfs storage, publish no ports, and do not join the school DB network:

```powershell
docker run --rm --read-only --tmpfs /tmp --tmpfs /workspace/storage --tmpfs /workspace/storage/framework/views --tmpfs /workspace/bootstrap/cache --mount "type=bind,source=D:\mgaems,target=/workspace,readonly" --mount "type=volume,source=mgaems_mgaems_vendor,target=/workspace/vendor,readonly" --workdir /workspace mgaems-preflight-php83:rehearsal php tests/safe/curriculum_grounded_live_pilot.php --synthetic --live-ollama

# Optional diagnostic only; does not change the application transport:
docker run --rm --read-only --tmpfs /tmp --tmpfs /workspace/storage --tmpfs /workspace/storage/framework/views --tmpfs /workspace/bootstrap/cache --mount "type=bind,source=D:\mgaems,target=/workspace,readonly" --mount "type=volume,source=mgaems_mgaems_vendor,target=/workspace/vendor,readonly" --workdir /workspace mgaems-preflight-php83:rehearsal php tests/safe/curriculum_grounded_live_pilot.php --synthetic --live-ollama --no-think-diagnostic

node --test tests/frontend/grounded-drafts.test.cjs tests/frontend/curriculum-library.test.cjs tests/frontend/exam-papers.test.cjs

# Requires playwright-core outside the application and installed Edge:
$env:NODE_PATH = "C:\Users\safari\AppData\Local\Temp\opencode\node_modules"
node tests/safe/phase7_browser.cjs --synthetic
```

The existing `tests/safe/ai_pilot_readiness.php` remains the read-only inventory
entry point. With the school container stopped, it was run in a disposable PHP
container using the stopped container's existing environment, read-only mounts
and school network, exclusively for its guarded READ ONLY transaction. Its
credentials were not printed or copied into committed files.

## 8. Exact next actions and approvals

1. **Confirm branch integration:** decide how to bring the safe pilot report/tests
   from the actual feature branch to `feature/production-ui`; keep the separate
   Teaching Oversight work out of that pilot integration.
2. **Resolve performance in isolation:** authorize/test any provider request
   changes such as no-thinking or schema-format output separately. Repeat all
   four generations with several runs, realistic narrow source context and a
   teacher quality rubric. Measure cold/warm latency, concurrent load, timeout
   cancellation and output validity. The current diagnostic is not a release fix.
3. **Obtain and verify authorized KICD content:** reconcile April/July edition,
   exact publisher/variant/grade and usage evidence. No authorized school version
   or approved record IDs presently exist.
4. **Review content in the isolated deployment:** privately upload, extract,
   verify pages/checksums and obtain authorized reviewer approval. School-library
   writes or approval require a separate explicit decision; none is authorized
   by synthetic test success.
5. **Reconfirm teacher/topic/term:** allocation 6 already exists, so do not
   recreate it. Term 3 ends on 23 October; agree an appropriate term, narrow
   approved record IDs, marks and durations before the real-content run.
6. **Teacher and browser sign-off:** fix missing stimulus/marking issues, assess
   each real draft, and conduct a browser session against the isolated backend
   and real model, including edit/import/retry, keyboard/mobile and PDF printing.
   Address the blank section selector and section-preview gap in a separately
   scoped application change.
7. **Active enablement/deployment remains a separate approval.** Until then,
   retain `MGAEMS_AI_DRIVER=disabled`. No live migrations, curriculum approvals,
   AI enablement, pushes or deployments were performed in this audit.
