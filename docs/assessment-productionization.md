# Assessment and report-card history hardening (Option A)

This work extends `D:/mgaems`, branch `feature/production-ui`, from checkpoint
`2360338`. It preserves the current learner + subject + term + assessment-type
result model. Types remain `continuous` and `end_term`; the existing unique key
is unchanged. No assessment events or curriculum/evidence engine is introduced.

## Additive data model

Forward migration `2026_10_06_000035_add_assessment_and_report_history.php` adds:

| Location | New fields / constraints | Purpose |
| --- | --- | --- |
| `assessments` | Nullable `class_id`, `class_subject_id`, `authorization_assignment_id` with restrictive FKs; `authority_type` default `legacy_unknown`; nullable JSON `context_snapshot`; `revision_number` default 0; class/subject/term index | Capture new result origins without inventing legacy relationships. |
| `assessment_revisions` | Parent FK, sequence, nullable score/rating/remarks, nullable actor FK, saved timestamp, change/authority types, nullable assignment FK, context JSON, capture timestamp; unique parent/sequence | Append-only saved result states, including explicit legacy baselines. |
| `report_cards` | `revision_number` default 0 | Identify the latest published sequence while retaining existing metadata/path projection. |
| `report_card_revisions` | Parent FK, sequence, generation time/user, nullable unique artifact path, SHA-256, byte size, input JSON, source manifest JSON, template version, provenance, capture timestamp; unique parent/sequence | Preserve published PDFs and the exact inputs/results used. |

No historical migration is rewritten. No existing assessment/card/PDF is
deleted, deduplicated, reseeded, or context-backfilled. Migration rollback is
intentionally refused because dropping this history would discard records.
New history parent/actor/assignment references restrict deletion. Revision
models reject normal model updates/deletes; no revision mutation route exists.
Administrative SQL bypassing application safeguards is outside this contract.

The targeted forward migration was tested in explicit SQLite memory fixtures
and applied alone to local Docker MySQL. Read-only inspection confirmed the
new columns and unique indexes; both development history tables remained empty
after testing. Guarded fixtures and report artifacts were never written there.

## Historical context and authority

New saves capture the submitted, authorized class; the existing `class_subjects`
offering ID; and the authorizing subject-teacher assignment when applicable.
Leadership writes explicitly record `leadership` authority with no fabricated
assignment. Parent identity/original context fields are protected from model
updates; corrections retain those original fields.

The compact context snapshot contains class ID/name, subject ID/name/code,
term ID/name, academic-year ID/name, assessment type, and the current performance
vocabulary. `mgaems-performance-v1` is an internal vocabulary identifier, not
an official curriculum code or certification claim. The stored values remain:
Exceeding Expectation, Meeting Expectation, Approaching Expectation, Below
Expectation. Display labels now say **Performance Level**.

No snapshot is fabricated for old rows. Their class/offering/assignment remain
null, authority remains `legacy_unknown`, and context remains unresolved.
Current Student placement is never used to backfill those fields.

## Assessment saves, corrections, and concurrency

`AssessmentAccess` rechecks active authenticated User status. Ordinary teachers
require active teaching Staff linked by `staff.user_id`, plus an exact
class/subject/term assignment. Class Teacher responsibility grants no assessment
permission. Leadership retains school-wide assessment authority without needing
a Staff record. Saves require an active subject and an actual class offering.

Critical checks occur inside the transaction. Class, subject, User/Staff,
term, assignment, offering, learner, and existing result locks protect the
checked context. Parent/authority rows use shared locks, allowing independent
learners to be saved concurrently; learner/result locks are exclusive. Learner
locks coordinate with current Student promotion/
transfer operations and serialize same-learner logical-key creation. Bounded
database deadlock retries apply to assessment writes, and the existing unique
key remains authoritative.

The learner must still be an active member of the requested class for a save.
A matching logical result with a different captured class returns 409 rather
than moving its history. This phase does not add a historical-enrollment
correction workflow: after promotion/exit, saved historical results can be
read under the policy below, but entry through the former current roster is
not enabled. Closed-period/future-term policy remains a school decision.

A new result appends revision 1 (`creation`). Corrections append subsequent
`correction` states, with current actor/time and current write authority, while
the parent remains the convenient current projection. Original authority and
correction authority are distinct. Result update, revision, and existing audit
event commit/roll back together. Audit events contain revision/authority/state
metadata rather than full learner or remark payloads.

Identical requests do not create extra correction revisions. The UI sends
`expected_revision`; stale edits return 409 and retain draft values. Older
clients omitting this optional field retain serialized last-committed behavior,
with each actual correction preserved. At least one meaningful score, level,
or remark is required; score zero and performance-only results are valid.

On first permitted correction/report use of a legacy row, its known current
saved state is retained as `legacy_baseline`. That actor/timestamp means the
stored row's known last editor/save time, not a guaranteed original assessor or
event. The capture timestamp is separate. Leadership-only legacy corrections
append new editor evidence while leaving original context unresolved.

## Reads, privacy, and API compatibility

Leadership may read captured and unresolved data. Ordinary teachers require
active account/teaching Staff and an allocation matching the assessment's
captured class/subject/term. Reads no longer depend on the learner's current
class. Unresolved legacy results are excluded from teacher history and shown
as non-editable review states in an otherwise authorized current roster.
Inactive subjects remain interpretable in historical reads; new saves are
blocked until the subject is active again.

Current APIs retain the existing result fields and add revision/context state.
`AssessmentResource` shapes result/roster/history data without recorder IDs,
raw snapshots, authorizing Staff/assignment IDs, or unrelated timestamps.
Saved-result history now paginates (default 25, maximum 100). Leadership-only
assessment revision lists paginate at 25 and expose useful values, change type,
authority, actor username, and saved time rather than complete model internals.

Generic report-card lookup/show/download/generation and revision routes are
leadership-only, with active-account checks in controller/service as well as
route middleware. Teacher generic PDF access is removed to match the existing
leadership-managed UI. Parent/Sponsor routes retain their independent ownership
and membership checks; they never receive raw revisions or source manifests.

Portal progress uses captured subject/term labels where available, with existing
legacy fallbacks. Portal card summaries use the latest rendered term label.
Latest downloads retain existing endpoint behavior and use the shared artifact
integrity helper. DTOs expose actual file-existence availability flags rather
than paths, generator IDs, or storage implementation details.

## Report publication and deterministic compilation

`ReportPublication` authorizes leadership and locks the learner, relevant
assessments, and parent card. It captures current saved assessment revisions,
materializing honest legacy baselines if needed. Completely blank legacy rows
do not count as meaningful report data.

Compilation never chooses a performance level or remark by timestamp:

- Continuous score comes only from the continuous saved revision.
- End-term score comes only from the end-term saved revision.
- Each type's performance level and remarks are displayed separately and labeled.
- Missing values display as not recorded; no weighting, average, or precedence
  rule is invented.

Each source manifest entry identifies assessment ID, exact revision ID/number,
and captured-versus-legacy provenance. Render inputs contain only learner display
name/admission number, reporting-period labels, per-type subject/class/result
labels and values/context, overall remark, rendered school identity, generation
time, and compilation rule. Unknown legacy classes are explicitly printed as
unknown; legacy subject rows are marked unresolved.

School name/motto use existing School Settings. A local `school/` PNG/JPEG logo
is embedded only when it is at most 256 KiB and at most 2048 pixels in either
dimension. Unsupported/larger/missing logos are omitted; no external image URL
is fetched. Actual rendered logo bytes are captured, so later uploads/deletions
cannot reinterpret the issued PDF.

The PDF renderer receives the detached snapshot, not mutable Eloquent models.
Template version is `mgaems-term-report-v2`. Publication uses a new server-owned
UUID path under private `report-cards/revisions/`. A successful write, file
existence, and SHA-256 read-back match are required before revision metadata,
latest path/sequence, and audit are committed. Generation time is shared by
the rendered snapshot and published metadata.

If rendering/storage/database/audit fails, publication rolls back and attempts
to remove only this attempt's new UUID artifact. Previous valid paths are never
deleted. File-producing transactions are not automatically retried; explicit
caller retries can produce a new valid revision. Cleanup refusal by the storage
backend can leave an unpublished orphan requiring operational recovery, but
does not publish a broken current pointer.

Existing PDFs remain downloadable before any regeneration. When regenerating
an old card, its existing path/bytes/hash and known generation metadata become
an explicit `legacy_artifact` revision, with null input/source/template data.
The next revision is captured normally. No original inputs are reconstructed.
Latest and retained downloads verify stored hashes where available; missing
files and mismatches return neutral errors without exposing paths.

## UI and integration

`assessment.html` now loads `assessment.js`; shared `report-history.js` is used
by both Assessment and Reports. Shared shell/theme/CSS remain unchanged. Context
and offered-subject selections remain API driven, and performance options come
only from the backend. Current roster entry, saved-result history, and leadership
report publication use escaped output, accessible labels/tabs, loading/error/
retry states, and shared dialogs/toasts.

Context/row controls are locked during saves; duplicate submits and stale roster/
save/card responses are guarded. Errors retain drafts. Legacy corrections require
an explicit explanatory confirmation. Report generation creates a retained
revision; bounded history allows leadership to download earlier versions.
Report learner selection now paginates and includes inactive lifecycle records.

The Academic dependency helper uses captured assessment classes for new rows,
retaining conservative placement-history checks only for legacy rows. Students,
Attendance, teacher allocation roles, HR, Guardians, Sponsorship, and other
domain business logic remain unchanged. Portal integration is limited to frozen
display labels and latest verified artifact delivery.

## Verification and remaining policy

```text
php tests/safe/assessment_history.php
php tests/safe/learner_guardian.php
php tests/safe/attendance.php
node --test tests/frontend/assessment.test.cjs tests/frontend/attendance.test.cjs tests/frontend/academic.test.cjs tests/frontend/dialog.test.cjs tests/frontend/shell.test.cjs
```

Executed checks: 18 Option A checks plus 15 Academic checks, 12 learner/guardian
checks, 18 Attendance checks, and 33 frontend/shared-dialog/shell checks pass.
The Option A runner reuses guarded connection replacement before providers boot,
exercises the new migration in SQLite memory, and stores report fixtures only
in an in-process memory disk. One actual DomPDF render produced valid PDF bytes
in memory; this does not constitute visual/browser verification. The existing
PHPUnit correction fixture's array-union bug and private Staff-ID assertion
were corrected, but database-refreshing PHPUnit suites were not run.

PHP/JavaScript syntax and diff whitespace checks pass. Eleven Assessment/report
routes and nine educational portal routes have the expected authentication/roles.
Twenty-seven local HTML assets/links and 14 shell links resolve; three inline
scripts parse. Seven HTTP-served page/shared files exactly match the workspace;
nine anonymous domain/portal API requests return 401. Conflict, excluded-feature,
fake-data, unapproved CBE entity, response privacy/raw-model, and historical
migration modification checks pass. Roster responses use explicit arrays and
Assessment Resources; result models are not serialized directly.
No `.env.testing`, PHPUnit configuration change, development reset/reseed, or
development fixture generation is part of verification. Real simultaneous
MySQL writes and browser/PDF visual QA remain unverified by the memory/DOM tests.

Head Teacher/school decisions still required:

1. Whether any teacher role should read full report PDFs. Current safe policy
   is leadership-only generic access, with separately scoped portals.
2. Historical correction rights after promotion/exit, period finalization, and
   whether new results may target historical/future terms. No arbitrary cutoff
   or historical roster reconstruction is invented.
3. Same-term class changes requiring multiple results under the same logical
   key. Option A rejects moving an existing result rather than changing the key.
4. Whether future reports should summarize performance/remarks across types.
   Current publication shows both separately until a policy is approved.
5. Evidence-based reconciliation of unresolved legacy rows/artifacts. Neither
   current placement nor last edit time proves original context.
6. A future approved performance/curriculum-version evolution. Existing strings
   and captured vocabulary must not be silently redefined by editing constants.

Strands, sub-strands, outcomes, criteria, indicators, rubric engines, core
competency/observation catalogues, values/PCIs, assessment events, differentiated
arrangements, and general evidence uploads remain outside this phase. Current
official-source verification and separate approval are needed for that work.
No KICD certification or compliance is claimed.
