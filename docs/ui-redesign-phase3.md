# Role-Specific Workspaces — UI Redesign Phase 3

13 October 2026. Teacher Workspace, Parent/Guardian Portal and Sponsor Coordinator
interfaces, using static HTML, vanilla JavaScript and the Phase 1 navy/teal tokens.

## Starting state and review

Verified `D:\mgaems`, branch `feature/production-ui`, clean working tree and
expected HEAD `076428754100730aa3bbfe03f89e6c3b6dd7517c`. The branch was aligned
with origin at the start. No applicable `AGENTS.md` was found.

Read Phase 1 and Phase 2 design documentation, Teacher, Parent and Coordinator
implementation reports, current frontend modules/tests, and the reused controller
and service contracts. Existing authorized requests, private response allowlists,
ownership checks, shared shell, dialogs and theme behavior remain authoritative.

Source-level presentation findings: Teacher responsibility lists and its wide
timetable needed clearer operational hierarchy; the family page was a long series
of tables without section navigation or a prominent selector; Coordinator directory
tabs lacked tab keyboard semantics, ten summary cards crowded the management page,
and forms needed grouping and persistent Save/Cancel controls. The sponsorship
update API already supported notes and planned-date editing without reassignment,
but the directory did not expose that supported operation.

## Teacher Workspace improvements

- Separate supervision and subject-teaching cards with real assigned classes,
  subjects and current period labels. Existing counts come from authorized arrays.
- Class Teacher Attendance links and Subject Teacher Assessment links retain their
  distinct visibility rules. My Learners, My Timetable and Communication stay in
  the existing authorized workflows.
- Weekly timetable cards group only actual assigned lessons by weekday, then
  start time. Each lesson shows its time, subject, class and current eligibility
  period. No empty-day lesson, invented period number or historical schedule.
- The dedicated timetable includes a return to Teacher Workspace. Dashboard
  timetable errors remain independent from loaded responsibilities.
- Missing assignments, unavailable periods, forbidden responses and retry states
  remain meaningful. Responsibility/timetable request generations are preserved.
- The existing separately authorized actionable-safety reader is unchanged.

## Parent/Guardian Portal improvements

- Prominent full-width native child selector, actual linked-child count, explicit
  selection feedback and retained multiple-child support.
- Six section links lead to labeled, focusable Overview, Attendance, Progress,
  Report cards, Timetable and Announcements targets. School announcements retain
  their shared family audience rather than claiming to be child-specific.
- Attendance uses readable date/class records and labeled text-status badges.
  Four counts and the percentage remain the backend's recorded-day summary.
  Pagination shows real record ranges. No missing day is inferred as an absence.
- Date filters support Clear dates and catch a reversed date range using the
  existing validation rule before sending a request. Errors use shared feedback.
- Progress uses readable cards for individual report-snapshot results. Assessment
  type, year/term, score, stored performance level, remarks and report date remain
  distinct. Zero stays zero; missing values stay Not recorded. No averages or new
  grading rule.
- Available reports show clear Download PDF actions with child/report labels and
  truthful unavailable-file badges. Requests capture child identity before download.
- Current available class lessons are grouped by actual weekday/time, without
  Staff identities or historical scheduling claims. Announcements wrap long text
  and preserve line breaks.
- Existing child/selection epochs, attendance request order, ownership-denial
  clearing and per-section retry are preserved. Late responses cannot populate
  another selected child's sections.

## Sponsor Coordinator improvements

- Dashboard separates operational counts from sponsor/programme and communication
  actions. Sponsor/Sponsorship directory links open their intended tab via supported
  client fragments. No academic/HR/Health query or financial metric.
- Management emphasizes actual sponsor, sponsorship and active counts; native
  disclosure provides status, programme-type and relationship breakdowns.
  Group memberships remain relationships, not a count of unique learners.
- Tabs now use tablist/tab/tabpanel relationships, selected state and roving focus.
  Arrow keys, Home and End select and focus the directory.
- Prominent authorized create actions, visible search/type/status filters, immediate
  dropdown filtering, Clear filters, server pagination and real result ranges.
  Invalid response metadata or operational counts show an error rather than a
  fabricated number. Out-of-range pages return to a valid last page.
- Individual, explicit group and school-wide targets have distinct labeled badges,
  readable dates and appropriate details. School-wide records never enumerate
  learners from unexpected payload extras.
- Sponsor and sponsorship forms use labeled fieldsets, existing required-field
  guidance, full-height controls and shared modal footer Save/Cancel actions.
  Sponsor length constraints and sponsorship date bounds mirror backend rules.
- Existing searched allocation lookups remain deliberate; no school roster preload.
  Selections persist across searched pages. Type changes clear learners and now
  invalidate in-flight learner lookups, including hidden school-wide selections.
- Creation reviews the chosen sponsor, type, target and start date. Pause/resume
  describes the affected record and blocks duplicate changes. Permanent ending
  retains required date/reason and now reviews the operation in a confirmation.
  Canceling confirmation keeps the draft and restores Save focus.
- Edit details uses the existing authorized detail GET and update PATCH for status
  preservation, planned end date and notes only. Sponsor, assignment, membership,
  type and start date remain immutable through that form. A freshly ended response
  prevents opening this editor; no reopen action is offered.
- Leadership remains read-only; Administrator and Coordinator retain their existing
  write roles, subject to the unchanged backend eligibility gates.

## Responsive design and accessibility

`role-workspaces.css` uses the existing Light/Dark tokens without palette, font,
logo or branding changes. Duties reflow to one column, weekly lessons reduce from
three/two columns to one, and family progress, date filters and form grids fit
narrow viewports. Native child selection, family links, lookup choices and key
form actions use the shared 44px touch target. Long names and copied text wrap.

Sponsor tables stay in named, keyboard-focusable scroll regions with captions
and column headings. Family result cards use labeled definition lists rather
than requiring mobile horizontal scrolling. Status colors always include text.
Visible focus, live result/selection feedback, labeled section anchors and native
summary disclosure complement the shared modal focus trap, Escape handling,
inert background, busy guards and restoration. No animation or new dependency.

## Security and scope preservation

No backend, route, API contract, schema, Staff/User relationship or branding file
change. Teacher assignment scoping and distinct Attendance/Assessment duties,
Parent current Guardian ownership, Sponsor sponsorship/member boundaries,
Coordinator active-Staff eligibility and Health restrictions remain enforced.
Private extra payload fields are not displayed. Parent progress continues to
use available report snapshots, not mutable assessment drafts/corrections.

No Student Portal, Streams, finance/payment feature, clinical function, new
endpoint, migration, reseed/reset or development school-record write was performed.
Sponsor Portal source and permissions are unchanged. No authenticated live module
request or real-record form submission was used for testing.

## Files changed

- `public/assets/teacher-workspace.js`
- `public/assets/parent-portal.js`
- `public/assets/sponsorship-workspace.js`
- `public/assets/role-workspaces.css`
- `public/dashboard.html`
- `public/teacher-timetable.html`
- `public/students.html`
- `public/parent-portal.html`
- `public/sponsorship.html`
- `tests/frontend/teacher-workspace.test.cjs`
- `tests/frontend/parent-portal.test.cjs`
- `tests/frontend/sponsorship-workspace.test.cjs`
- `tests/frontend/role-workspaces.test.cjs`
- `docs/ui-redesign-phase3.md`

## Verification results

| Verification | Result |
| --- | --- |
| Entire frontend suite | **196 tests passed**, zero failures/skips; 19 new workspace cases plus existing assertions updated for semantic result cards |
| Safe backend regressions | **14 suites passed**, 577 printed PASS executions, 225 distinct PASS labels; repeated inherited labels are not unique assertions |
| JavaScript syntax | All three modified workspace modules pass `node --check` |
| PHP syntax | Reused TeacherWorkspaceController, ParentPortalController, SponsorController and SponsorshipController pass lint |
| Navigation and assets | Existing role-menu/route contracts and new workspace links pass; all local page assets exist |
| Served resources | 17 HTML pages, 35 distinct referenced page/assets, all return 200 with exact workspace bytes |
| Whitespace | `git diff --check` passes |
| Database schemas | All 43 schemas unchanged |
| Staff links, Health and school settings | Complete snapshots unchanged |

Safe suites: authorization, staff_account_links, health_safety, health_timestamps,
health_frontend_contract, password_recovery, teacher_workspace, parent_portal,
sponsorship_workspace, attendance, assessment_history, learner_guardian,
academic_structure and announcements. Each ran in a disposable network-disabled
container with read-only source/vendor mounts and explicit guarded SQLite memory.
No development MySQL regression or migration ran. Frontend fixtures stay in memory.
Static served-asset GETs execute no scripts and make no authenticated API requests.

New cases cover actual weekday/time ordering, malformed schedules, refreshed
assignments, child selection/section targets, reversed and stale attendance ranges,
missing/zero progress, unavailable reports, scoped timetable extras, tab keyboard
interaction and initial directory links, server filters/ranges, invalid counts,
mutable-only editing, terminal-state refresh, creation/ending cancellation, stale
type-change allocation, duplicate status updates and responsive/token contracts.
Existing cross-role, session, ownership, unlink, private-field, Health-race and
shell tests remain passing.

## Development preservation exception

Guarded read-only snapshots span **09:38:36–09:57:52 UTC on 13 October 2026**.
All 43 schemas and 36 complete table contents/column hashes/checksums/sequences
match. Seven tables differ during concurrent application activity:

| Table | Initial rows | Final rows |
| --- | ---: | ---: |
| students | 5 | 6 |
| guardians | 2 | 4 |
| attendance_students | 19 | 25 |
| sponsors | 2 | 3 |
| users | 11 | 12 |
| audit_logs | 328 | 343 |
| personal_access_tokens | 4 | 4 |

Additional SELECT-only inspection compared baseline primary-key-bounded column
hashes. All pre-existing learner, guardian, attendance, sponsor and audit rows
remain unchanged. Original User differences are confined to last_login_at and
updated_at; Staff/User links, original account roles/statuses and credentials match.
Audit action metadata includes CREATE_STUDENT, CREATE_GUARDIAN,
LINK_GUARDIAN_STUDENTS, RECORD_ATTENDANCE, CREATE_SPONSOR and login/dashboard
activity. The activity is consistent with concurrent app use; no actor identity
is inferred or exposed. This task's network-isolated RAM tests and static GETs
cannot produce those school-record writes. No records were restored or altered
to force a baseline match. Whole-database equality is **not certified**.

Snapshots, aggregate comparisons, audit action metadata and regression output
remain local and Git-ignored. No names, contact contents or credentials are printed.

## Browser QA and remaining limitations

**Visual QA pending.** Browser inventory returned no connected surfaces and opening
the local portal in the in-app browser returned `Browser is not available: iab`.
No desktop/mobile screenshot, Light/Dark rendered acceptance or screen-reader
certification is claimed. Native date controls, long mobile names and nested
confirmation focus still need visual/assistive review. No real-record write smoke
test was performed.

Existing domain limits remain: timetable rows are recurring rather than historical
term schedules; family progress depends on available report snapshots; group
membership/reassignment editing is unsupported; Coordinator eligibility requires
legitimate active Staff linkage. The sponsorship update API has no revision
token; the new details editor uses the loaded status and existing backend transition
validation, without adding a concurrency contract. The live database was active
concurrently, so preservation certification is limited as described above.

## Commit and final state

One local commit contains the fourteen files above. Its hash and clean final Git
status are supplied in the completion response. No push; stop after reporting.
