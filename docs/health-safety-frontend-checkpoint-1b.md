# Health & Safety frontend — Checkpoint 1B

Completed 12 October 2026. Scope: static frontend integration, focused tests and
documentation against the existing Health backend. No backend, migration,
Staff/User-linking or academic implementation changes.

## A. Initial repository state

Verified repository `<repository>`, branch `feature/production-ui`, clean working
tree, HEAD `a41489400aacc54ecf32ac56f36ded3823542861`, seven commits ahead of
`origin/feature/production-ui`. No applicable `AGENTS.md` was found.
Existing backend checkpoint and corrective-fix documentation and implementation
were inspected before integration.

## B. Inspected API contract

[The companion contract](health-safety-frontend-api-contract.md) documents all
34 concrete Health routes, methods, input fields/enums/bounds, response allowlists,
authorization, concurrency, idempotency, UTC instants and literal school dates.
The new isolated controller regression verifies the runtime route inventory,
minimal authorized learner lookup, and actual frontend-shaped mutation bodies.
No unsupported endpoint or response field was introduced.

## C. Leadership workspace

`public/health-welfare.html` loads the shared application shell and a dedicated
Health workspace. Head Teacher and Deputy can manage profiles/alerts, incidents,
first aid/actions, notification attempts, referrals, revisions and access logs.
An authenticated backend Health authorization check precedes learner lookup.
Other roles redirect to their existing landing page without requesting Health
management data. Backend Staff authorization remains the security boundary.

The existing authorized learner summaries are paged explicitly. Name/admission
filtering occurs locally on the loaded page, keeping those values out of URLs.
Detail requests are explicit and checked against learner/parent/record identity.

## D. Learner profiles

Create, view, correct and explicitly review profiles with required source,
bounded text and loaded revision. Allergy meanings remain separate: unknown,
none reported by the source, and recorded information. Unknown is the new-profile
default; recorded requires details, while unknown/none reported prohibit them.
Review attribution comes from the server. Legacy `student_medical_info` is neither
fetched for conversion nor modified.

## E. Safety alerts

Minimal list summaries disclose type, active publication and effective dates.
Authorized details/forms support create, factual correction, activate/deactivate,
explicit operational verification and revision history. New alerts default to
inactive; every publication change requires correction reason and loaded revision.
The UI identifies description/instructions as Teacher-visible publication fields.
Operational verification is labelled separately from medical clearance; no source
or verification is fabricated, and legacy text is never automatically published.

## F. Incidents and first aid

Incident forms record actual occurrence time, location, category and an explicit
observed/reported basis. Status/disposition and historical class/term are displayed
from server evidence; unknown context remains unknown. New school actions record
actual action time/type/text/result and can perform a paired operational status/
disposition transition. Historical correction cannot silently replay a transition.
Loaded action history is chronological at microsecond precision, with explicit
paging for additional records.

Event inputs are explicitly EAT (fixed UTC+03:00). Offset requests preserve the
UTC instant and up to six fractional digits. Unchanged correction times preserve
their original UTC value even when a browser normalizes picker fractions. Values
outside the four-digit EAT picker range use explicit UTC/offset text input.

## G. Notifications and referrals

Notification forms record contact attempts that actually occurred; nothing is
sent. Current actual Guardian relationships are loaded only for this workflow,
selection starts blank, and current contact reference appears only after explicit
selection. Actual contact used is never auto-filled. The primary-contact flag is
not treated as disclosure consent. Details/corrections use backend historical
contact snapshots; a correction cannot substitute another Guardian relationship.

Referrals record actual referral time, bounded reason/destination, known
authorization/handover details and follow-up status. There is no hospital or
external notification integration.

## H. Corrections and restricted history

Every correction/review/verification uses the loaded record revision and requires
a reason. Child writes also carry the loaded incident revision, and reload the
parent after success. A 409 blocks further submission until explicit reload;
the UI never guesses a newer version. UUID-backed creates reuse an unchanged
retry UUID; changed facts after uncertain completion require history review.
Duplicate submissions and editing during a pending save are blocked.

Restricted history initially shows metadata; inspect/hide controls disclose only
escaped allowlisted snapshots and correction reasons. Access logs display actor,
operation, record reference and time, without narrative or contact payloads.
Actor IDs are shown because no leadership-authorized User-name lookup is available.

## I. Teacher Safety View

The existing Teacher learner dialog requests only
`GET /api/v1/health/safety/learners/{id}` for actionable safety alerts. It never
fetches full profiles, incident narratives, histories or management controls.
Only ID/type/description/emergency instructions are accepted and rendered.
Empty alerts explicitly do not confirm absence of allergies.

Missing-current-period/empty-scope behavior remains intact. No fabricated
academic or safety records populate an empty workspace. The backend retains its
existing Class Teacher ownership branch and valid-current-subject-assignment
branch; the frontend does not weaken either. Populated Teacher safety behavior
was exercised only with isolated synthetic fixtures; no live alert workflow was
used as a write test.

## J. Navigation, responsive layout and accessibility

Health management navigation is added only for Head Teacher and Deputy. System
Administrator, Teacher, Parent and Sponsor navigation remain excluded. Teacher
overview links to the existing My Learners safety workflow.

CSS uses shared light/dark theme variables, wrapping controls, a responsive
learner/detail grid, single-column narrow forms, bounded/wrapping narrative
surfaces and the existing modal focus trap/keyboard dismissal. Forms have labels,
required fields, validation alerts, status/live regions and explicit confirmation.
Revision disclosure exposes `aria-expanded` and `aria-controls`.

No connected browser was available (`apps: []`, `browsers: []`), so actual visual,
viewport and assistive-technology review remains pending. DOM workflow tests and
static responsive rules are evidence of implementation, not a substitute for a
rendered browser review.

## K. Security, privacy and development preservation

Confidential content is escaped and projected through explicit fields. Health
requests use browser `cache: no-store`; backend private/no-store headers remain
intact. No Health narratives are written to browser storage, caches, console,
URLs or toasts. Generic confirmation/save messages contain no narratives.
Private modal contents and references clear on close, learner/section changes,
authorization loss and departure. Restoring a page from browser history rechecks
authorization and reloads scope without restoring private dialog content.
Generation/identity guards discard stale
responses; Teacher denial wipes the entire learner dialog.

No live Health HTTP requests, account/link changes, learner/academic writes,
Health records, migration execution, seeding, production access or destructive
development commands occurred. Development verification used a UUID-bound
read-only SQL session/transaction with a SELECT/SHOW/CHECKSUM guard. Evidence is
retained in the existing protected, Git-ignored private evidence directory;
no credentials, real contact details or medical narratives are published.

Development checks used read-only metadata/data comparisons. This checkpoint
issued no school-data writes or migrations. Any concurrent application activity
limits whole-database equality claims; no records were altered to force a match.
Detailed population counts, activity metadata, timestamps and fingerprints are
retained in operator-controlled private audit evidence rather than public source.

## L. Tests and results

| Verification | Result |
| --- | --- |
| Entire frontend suite, `node --test tests/frontend/*.test.cjs` | **124 passed**, zero failures/skips |
| New Health workspace tests | **23 passed**: roles, allergy states, profiles/review, alerts, incidents/actions, contact snapshots, referrals, EAT/fractions, conflicts/retries, paging, pending/422, stale responses, XSS and memory clearing |
| Added Teacher safety tests | **6 passed**, including revoked scope/session, unexpected identity, late responses, empty/missing period and safe retry |
| Shared frontend regression | Existing Teacher/Parent/Sponsor, administration, academic, Attendance, Assessment and shell checks pass; Health request no-store and role navigation covered |
| 14 safe backend suite invocations | **577 PASS lines**, exit 0, no stderr; includes inherited authorization checks repeated by independent suite harnesses, not 577 unique tests |
| New real-controller contract harness | **4 new checks**, 65 including inherited Health/UTC/authorization checks; included in the 577 above |
| Existing isolated MySQL Health regression | **4 passed**: migration SQL compilation without execution, DATETIME(6) fixture metadata, UTC storage/readback across MySQL session timezones and bounds, microsecond ordering |
| JavaScript syntax | All four changed public JS files and four changed frontend test/helper files pass `node --check` |
| PHP test syntax | New contract test passes `php -l` |
| Assets, role navigation, diff whitespace | Covered by shell suite and final `git diff --check` |
| Development preservation | Read-only evidence retained privately; no school writes issued |

Backend invocations: authorization, staff_account_links, health_safety,
health_timestamps, health_frontend_contract, password_recovery, attendance,
assessment_history, learner_guardian, teacher_workspace, parent_portal,
sponsorship_workspace, academic_structure and announcements. They use disposable
network-disabled containers, read-only source/vendor mounts and SQLite `:memory:`.
The MySQL regression uses an owned isolated container, no host ports or development
DB mounts, RAM-only fixtures, and verified cleanup. Synthetic fixtures never
enter development records. No backend application code changed.

## M. Known limitations

- Rendered browser, mobile viewport and screen-reader review remains pending
  because no browser surface was connected.
- Real learner Health write smoke tests were intentionally not performed; safe
  real-controller fixture tests validate request/response integration instead.
- Only isolated fixtures were used for populated Health and Teacher scenarios, so
  populated workflows are validated through isolated fixtures.
- Learner filtering applies to the explicitly loaded authorized page. There is
  no invented Health-specific global search or extra actor-directory permission.
- History/contact snapshots reflect recording-time evidence, not invented event-
  time contact consent, historical placement or medical verification.
- Welfare/Safeguarding, medications, diagnoses, automated contact delivery,
  attachments, portals and other excluded modules remain outside this checkpoint.

## N. Changed files

Frontend: `public/health-welfare.html`, `public/assets/health-workspace.js`,
`public/assets/teacher-workspace.js`, `public/assets/nav.js`,
`public/assets/app.js`, `public/assets/app.css`.

Tests: `tests/frontend/health-workspace.test.cjs`,
`tests/frontend/teacher-workspace.test.cjs`, `tests/frontend/shell.test.cjs`,
`tests/frontend/helpers/dom.cjs`, `tests/safe/health_frontend_contract.php`.

Documentation: this report and `docs/health-safety-frontend-api-contract.md`.

## O. Local commit

One local checkpoint commit contains only the 13 files above. Its resulting hash
is reported in the completion response; a commit cannot embed its own hash.
No push is authorized or performed.

## P. Final Git status

The completion response records the post-commit HEAD, clean working tree and
ahead count. Work stops after reporting; no next module begins.
