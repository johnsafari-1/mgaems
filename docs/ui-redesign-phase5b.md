# UI Phase 5B — Attendance, CBC Assessment and Report Cards

13 October 2026. Frontend-only checkpoint on `feature/production-ui`, starting
from clean HEAD `9ec8b21b49187d21c33dca3187be8ca35bf50f67`.

## Attendance

Class and school-date selection remain based on `/attendance/my-classes` and
its server-provided date/timezone. A Teacher receives only authorized Class
Teacher classes; Subject Teacher allocations do not grant attendance ownership.

The roster has readable learner/admission identities, distinct Present, Absent,
Late and Excused buttons, and the existing labeled select control. Saved badges
remain separate from draft selections. Recorded counts use the loaded roster;
live selection counts explicitly describe editable rows. Unrecorded and unavailable
rows remain distinct; no missing record is automatically marked Absent.

Per-row draft indicators, an unsaved summary and save/correction confirmations
identify the loaded class/date. Field errors are mapped to the affected selected
row, escaped and associated with its control. Canceling a context change preserves
the draft; pending saves prevent duplicate submissions. An incomplete save
acknowledgement retains the draft for roster verification instead of claiming success.

History displays readable school dates, recorded class and learner identity.
Summary cards show recorded status totals and the existing present-record rate;
missing records are excluded and a zero-record range has no invented rate.
Reversed ranges receive field feedback. Invalid setup/roster/history/summary
responses produce error states without fabricated rows or counts.

## CBC Assessment

The existing context API supplies authorized academic year, term, class, learning
area, assessment types and performance levels. Teacher choices remain scoped to
Subject Teacher assignments; leadership retains the existing school context.
No new competency or assessment vocabulary was introduced.

Entry rows separate score, performance level and remarks, with learner names and
admission numbers, explicit saved revisions and unsaved counts. Inline feedback
checks score range, supplied performance levels, remark length and meaningful
content. Zero scores and level-only/remark-only results remain supported.
Context and row inputs are locked during saves; normalized unchanged values do
not create drafts.

Corrections submit the loaded `expected_revision`. Revision conflicts retain
the draft and require an explicit, confirmed reload; conflicted rows display a
disabled Reload required action. Bulk saving remains available for other eligible
draft rows. Unverifiable save acknowledgements also require review/reload because
the save may already have occurred. No automatic conflict retry or overwrite was added.

Saved-result history retains captured class/term context and leadership-only
revision administration. Malformed contexts, rosters and report identities fail
without exposing unrelated learner data or actions.

## Report cards

Leadership Assessment retains the existing generation workflow and payload.
Current cards distinguish generated metadata, retained revisions and actual PDF
availability. No separate draft/published flag was invented. Generation dialogs
reject changed learner/term context and prevent duplicate submissions; unverified
generation acknowledgements require report verification before another generation.

The read-only Reports lookup adds page-local learner search, clearer metadata,
keyboard tabs, visible PDF actions and inline download feedback. Stale learner
pages/report responses cannot populate a newer selection. Empty pages, absent
cards, unavailable files and failed lookups remain distinct. Downloads are scoped
to the selected report and protected against duplicate requests.

The retained-revision viewer shows responsive cards with Nairobi timestamps,
captured/legacy provenance, known/unknown source counts and available PDF actions.
Only the existing three leadership roles can initiate the school-level viewer.
Paging and download feedback preserve keyboard usability. Malformed revision
responses show recoverable errors instead of invented empty histories/counts.
Private storage paths, snapshots, source manifests and Health fields are not rendered.

## Design and files

Dedicated stylesheets reuse Phase 1–5A navy/teal, neutral, status and focus tokens.
Tables remain readable on desktop and become labeled learner rows on compact
screens. Filters, metadata and actions reflow; controls use 44-pixel targets.
Shared dialog focus trapping, Escape behavior, busy-state protection and focus
restoration remain intact. Light/dark compatibility is retained.

Changed files:

- `public/attendance.html`
- `public/assets/attendance.js`
- `public/assets/attendance.css`
- `public/assessment.html`
- `public/assets/assessment.js`
- `public/assets/assessment.css`
- `public/assets/report-history.js`
- `public/assets/report-cards.css`
- `public/reports.html`
- `tests/frontend/attendance-phase5.test.cjs`
- `tests/frontend/assessment-phase5.test.cjs`
- `tests/frontend/report-history-phase5.test.cjs`
- `tests/frontend/reports-phase5.test.cjs`
- `tests/frontend/assessment.test.cjs`
- `tests/frontend/helpers/dom.cjs`
- `docs/ui-redesign-phase5b.md`

The synthetic DOM helper now decodes selected option values as a browser does.
The existing conflict assertion now expects the disabled reload-required action;
draft-retention and escaped-feedback assertions remain.

## Validation and limits

| Check | Result |
| --- | --- |
| Complete frontend suite | 336 tests passed; zero failures/skips; 79 new cases |
| Attendance | 29 affected cases: ten existing and 19 new |
| Assessment | 44 affected cases: eight existing and 36 new |
| Retained report viewer | 14 new cases; existing viewer regression also passes |
| Read-only report lookup | Ten new cases |
| Syntax | All 15 public JS modules and six inline page scripts compile; changed test files pass syntax checks |
| Static resources | All 17 pages and 22 referenced assets (39 resources) returned HTTP 200 and matched workspace bytes |
| Preservation | Backend, routes, schema, API contracts, authentication/navigation, Composer and Docker configuration unchanged |
| Branding | Both existing uploaded logo hashes unchanged |
| Whitespace | `git diff --check` passed |

Tests use synthetic in-memory fixtures and mocked API mutations/downloads.
Static HTTP checks do not execute page scripts or call school mutation APIs.
No development database writes, migrations, seeding, report generation, artifact
overwrites, container replacement, security maintenance or deployment occurred.
Backend suites were not rerun for this frontend-only change.

Browser visual acceptance is **pending**: the browser inventory exposed no
enabled surfaces. DOM tests do not certify rendered layouts. Manual desktop,
tablet and mobile review remains required in both themes, including long rosters,
status controls/live announcements, compact table labels, inline errors, revision
cards, modal focus and download feedback. Attendance retains its existing API's
confirmation-based correction model; assessment revisions remain server-controlled.
Nothing is pushed or deployed as part of this checkpoint.
