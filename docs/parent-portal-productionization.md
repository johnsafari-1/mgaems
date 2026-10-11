# Parent Guardian Portal productionization

## A. Initial repository state

Verified `D:/mgaems`, `feature/production-ui`, clean working tree, expected HEAD
`91f0721911ded28c759a8a2f034609d305730f99`, four commits ahead of origin.
No additional repository instructions were found. No other repository was used.

## B. Existing capabilities and audit

The existing Parent Portal already listed linked children and provided owned
attendance, current assessment progress, report summaries and downloads. Guardian
linking is maintained by authorized school administration; links are stored per
learner with an optional Parent User association. There is no separate identity
verification flag to invent. Account identity verification remains an onboarding
responsibility; the Portal verifies the current stored association on the server.

The audit found missing timetable/overview APIs, no attendance history controls,
no integrated announcement reader, and no stale-response protection when switching
children. Progress read mutable assessment projections with no release state;
report remarks could come from a mutable projection rather than a published
snapshot. Messaging accepted any existing User recipient. Generic class references
also exposed unrelated class counts and Staff identities to Parents.

## C-D. Guardian ownership and overview

All family routes retain Sanctum and `role:parent_guardian`. The controller also
reloads the current User/role, requires an active Parent account, checks current
Guardian links and resolves the learner within that ownership boundary. Parent
accounts do not require Staff linkage. Browser Guardian IDs, User IDs and ownership
claims never grant access. Scalar route IDs avoid school-wide model binding before
ownership checks; missing/foreign IDs use the established generic `FORBIDDEN` 403.

The learner selector deduplicates multiple Guardian relationships using a subquery
and consistently selects one child across overview, attendance, progress, reports
and timetable. No-child accounts see a clear empty state. Refresh preserves a
still-authorized selection; failed ownership clears all selected-child information.
Removing the last valid relationship ends that account's access without removing
history or another Guardian's access.

Overview is an explicit allowlist: learner ID, admission identifier, names,
enrollment status, minimal class/level and currently eligible school period names.
No birth date, family contacts, medical/safeguarding records, Sponsor administration,
Staff HR or audit data is added. Family JSON and download responses use
`Cache-Control: private, no-store`. Generic Parent class references are now limited
to linked learners' classes and expose only class ID/name/level.

## E. Attendance and academic progress

Attendance retains actual recorded dates/statuses and stored historical class
context, including after placement changes. Unknown historical class context is
not inferred from today's class. Bounded date filtering and pagination are added.
The existing `summary` and date/status-only `recent` shape are preserved; the new
`records` array carries paginated historical class context. Attendance percentages
retain the existing present-plus-late divided by recorded-days rule. Missing rows
remain unknown; no absence, expected day, weighting or new attendance rule is added.
Parents cannot enter or correct attendance.

Individual assessments have no reliable publication/release field. Family progress
therefore fails closed on mutable assessment projections and corrections. It uses
educational values already present in available captured report snapshots, keeping
continuous/end-term results, scores, stored performance levels and remarks separate.
Zero remains zero; missing values remain not recorded. Internal context/revision
manifests and actor IDs are excluded. Report dates are labeled as publication dates;
unknown original assessment dates are not reconstructed.

Legacy PDFs without captured snapshots remain available under existing artifact
policy but yield no reconstructed progress rows. This deliberately narrows the old
live-assessment disclosure path rather than silently publishing drafts/corrections.

## F. Report disclosure and download protection

The existing `ReportPublication` service publishes verified private PDFs and
immutable revision snapshots. Generation, compilation, correction and revision
business rules are unchanged. The new family read helper uses latest published
revision metadata, excluding mutable report remarks, raw paths, actor IDs, input
snapshots and source manifests. New captured publications require known provenance,
snapshot and SHA-256 integrity metadata. Draft/missing publication pointers are
not disclosed. Missing/corrupt files do not make progress available; download
errors preserve neutral 404/409 conventions.

Direct downloads recheck Guardian ownership and report-to-learner ownership, even
between two children linked to the same Parent account. Shared artifact handling
continues to verify retained hashes. Existing legacy PDF availability and retained
artifact/revision history are preserved. No parent revision-history route is added.

There is no separate formal approval/release flag distinguishing report generation
from school release. The interface says **Available report cards**, preserving
existing publication availability without inventing approval. A separate release
workflow and assessment-level publication require a school decision and reviewed
schema/authorization proposal before implementation.

## G. Current available timetable

The new child timetable API is ownership-scoped to the child's current stored
class, active enrollment and applicable current academic context. Lessons require
active teaching Staff, active subject, actual offering and matching current
class/subject/term/staff assignment. Only weekday, actual start/end time and minimal
subject fields are returned; no Staff identities or unrelated classes are exposed.

The existing timetable has no term-specific FK or historical schedule evidence.
The view is labeled current available weekly class timetable. It never infers past
classes/lessons, period numbers or lesson dates. Missing term/class/eligible rows or
former enrollment produces an unavailable state rather than a fabricated schedule.
Current calendar eligibility is reused from the Teacher Workspace read service.

## H. Announcements and communication

The Portal reads the existing announcement API with its server-side audience
rules: school-wide and Parent only. Staff, Sponsor and legacy unscoped class rows
are excluded. No announcement compose/edit interface or permission is added.

Parent message sending now fails closed at route and controller because the old
recipient validation allowed any User ID. Existing owned legacy message reads and
mark-read ownership checks are retained; the Portal does not expose a new messaging
workflow, recipient directory or arbitrary compose form. Other roles' existing
message permissions are unchanged. The school must approve recipient eligibility,
learner/assignment contact relationships, inactive/historical contact handling and
visibility before Parent messaging can be introduced. Existing message timestamp
mass-assignment behavior also needs review in that future workflow.

## I. Student release policy

The approved release excludes a standalone Student Portal. No Student page,
Guardian impersonation, Student-to-Parent redirect, role deletion or historical
migration rewrite occurred. Routine Student account creation and conversion of
other accounts into Student role are blocked in Administrator APIs and role
selectors. Existing Student accounts remain reviewable/editable without silent
deletion or deactivation. Existing limited reference/school-announcement reads
remain; learner, operational, family and confidential routes remain denied.

Read-only anonymized development counts found one active Student account and two
active Parent accounts, with zero unlinked Parent accounts. No actual account or
Guardian link was modified. Reviewing the legacy Student account and deciding any
status/role changes remains an explicit school account-review action.

The approved policy is recorded in `family-portal-release-policy.md`, including
exact SRS FR-PAR-01..06, role-matrix and roadmap updates. DOCX files are preserved:
managed authoring/dependency-loader and rendering tools are unavailable. The task
permits reporting required changes; deterministic ZIP text reads were used for
inspection only, never unverified DOCX rewriting.

## J. Routes and frontend

Added Parent-only GET routes:

- `/api/v1/portal/parent/children/{student}` for overview.
- `/api/v1/portal/parent/children/{student}/timetable` for current available lessons.

Existing family attendance/progress/report/download routes are reused and hardened.
POST messages excludes Parents; owned message reads remain as before. Generic class
references and Administrator Student provisioning are narrowed as described above.

`parent-portal.html` now uses new `assets/parent-portal.js`. Shared CSS, themes,
responsive tables/cards, mobile shell, accessible native selector/labels, logout
and authentication are reused. Per-section loading/error/retry states preserve
available sections if another fails. Every response captures child identity and
selection epoch; attendance filtering also guards request order. Downloads capture
child ID and filename before the request. Parent navigation remains Portal-only.
Administrator role selectors match the new Student provisioning policy.

## K. Tests and results

All available safe suites ran; none was omitted. Unique counts (reused bootstrap
suites counted once):

| Suite | Passed |
| --- | ---: |
| Parent Portal | 18 |
| Teacher Workspace | 21 |
| Shared authorization | 18 |
| Academic Structure | 15 |
| Assessment/report history | 18 |
| Attendance | 18 |
| Learner/Guardian/portal | 12 |
| Announcements | 14 |
| Health & Safety | 36 |
| Health timestamps | 7 |
| Password recovery/session invalidation | 9 |
| Disposable MySQL UTC checks | 4 |
| Frontend, including 12 new family/policy checks | 67 |
| **Total** | **257** |

PHP and JavaScript syntax checks, whitespace review, all-role navigation/asset
checks and final authorization/privacy review pass. Three served HTML/JavaScript
assets match workspace bytes. Frontend tests cover native learner switching,
delayed responses across every section, exact download identity, zero/missing
results, empty families, retry, role redirects, announcement-only requests and
Administrator Student selector restrictions.

PHP HTTP/Sanctum and controller regressions use guarded sole SQLite-memory
connections with fake storage/mail and no dotenv/development connection. Existing
safe suites exercise migration definitions only on RAM fixtures. MySQL checks use
pinned cached images, network-none isolation, RAM storage, read-only source/vendor
mounts and ownership-checked cleanup. The owned disposable container was removed.

## L. Privacy and development data verification

Before/after read-only comparison confirmed identical counts, native checksums and
schema fingerprints for all 35 development tables. Aggregate fingerprint:
`b85797aac91a1601cffee199e6d67604b96963f3f7b845408e535669febb437f`.
The same database identity was checked; credentials, contacts, learner records and
medical information were not printed. Health migrations 000036 and 000037 remain
pending. No ordinary migration, reset, wipe, reseed, backup/restore or learner-data
write was performed. No service was restarted and no push made.

Review covered current Guardian/user/role associations, duplicate/unlinked families,
cross-family and nested child/report IDs, invalid/missing IDs, stale selection,
private fields, published-versus-current projection, file integrity, historical
attendance, current timetable eligibility, audience rules, recipient guessing,
routine account provisioning, sessions and audit payloads. Denial logs retain
reason/identifier metadata only. Teacher, Sponsor, Attendance, Assessment generation,
Health safety and session/recovery domain policies remain intact.

## M. Deferred decisions and coverage limits

Separate assessment release and formal report approval are not invented. Secure
Parent messaging and legacy Student-account status review require school decisions.
DOCX merges await the required managed authoring/render tools; exact changes are
provided in the approved release policy. New Parent APIs use already-applied schema;
existing recovery/deactivation/role-change session-version dependence on pending
migration 000036 is unchanged and needs its separately approved rollout.

No Health/Safeguarding family disclosure, Student Portal, new clinical functionality,
Streams, finance or unrelated module is implemented. Teacher and Sponsor domain code
is unchanged. DOM mocks verify behavior/request isolation, not visual browser layout
or screen-reader certification. New family queries are verified on SQLite fixtures;
the disposable MySQL suite covers existing Health UTC behavior, not full Parent
query or concurrent unlink/streaming behavior. Ownership is checked per request;
information already legitimately delivered cannot be recalled after unlinking.

## N-P. Changed files and completion

Backend: `ParentPortalController.php`, new `ParentReportView.php`,
`AcademicStructureController.php`, `MessageController.php`, `UserController.php`,
`routes/api.php`. Frontend: `parent-portal.html`, new `assets/parent-portal.js`,
`administration.html`. Tests: new `tests/safe/parent_portal.php` and
`tests/frontend/parent-portal.test.cjs`. Documentation: this report and
`family-portal-release-policy.md`.

Create one local commit after these checks, verify clean Git status and report its
hash in the completion response. Stop for review; no further module begins.
