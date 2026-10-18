# Teacher Workspace productionization

## A. Verified starting state

Authoritative root `<repository>`, branch `feature/production-ui`, clean working
tree, HEAD `768be958026ecc41e5cb31f3b4f875f8a1932ed4`, three commits ahead of
origin. No additional repository instructions were found. Existing academic,
learner, authorization, Attendance, Assessment and Health documentation and
implementation were reviewed. No other repository was accessed.

## B. Existing functionality reused

The audit covered Staff/User linkage, active-account middleware, class ownership,
subject assignments, offerings, calendar eligibility, timetable administration,
Student resources/list/detail/history, and the Dashboard, Students, Attendance,
Assessment and navigation interfaces.

Existing Attendance and Assessment services already separate Class Teacher
ownership from class/subject/term teaching assignments. They are reused without
changes. Existing learner search/pagination, current placement, summary resources,
static page shells, shared navigation, theme, dialogs and layout styles are reused.
No duplicate learner API or new assignment/timetable schema is introduced.

The gaps were school-wide Teacher learner reads, school-wide counts/Staff names
in class references, leadership-only timetable reads, and a generic Teacher
Dashboard containing inaccessible leadership cards rather than teaching duties.

## C. My Timetable

New read-only `GET /api/v1/teacher/timetable` uses the authenticated account's
current active teaching Staff relationship. Only that Staff member's existing
weekly rows are considered, and each row must match an eligible current
class/subject/term assignment and active offered subject. Class Teacher ownership
alone cannot grant a subject timetable entry.

Responses contain entry ID, weekday, start/end time, minimal class and subject,
and eligible current academic year/term labels. Staff IDs, names, HR fields,
legacy extra columns and unrelated lessons are excluded. Rows are ordered by
weekday, start time and ID. The new `teacher-timetable.html` uses the shared
Teacher reader. Empty, unavailable-period, forbidden and retry states are real;
no lessons, periods, dates or assignments are fabricated.

The existing timetable is recurring and has no term FK. Current year/term
labels describe the assignment eligibility used for this view, not a historical
term stored on the timetable row. Administration endpoints remain leadership-only.

## D. My Learners and generic API hardening

`TeacherWorkspaceAccess` reloads the User and role and requires active User,
Teacher role and current active teaching Staff. Supplied teacher/Staff/role IDs
or class claims cannot establish authority.

The learner scope is the union of current Class Teacher ownership and valid
current subject assignments. The current learner placement must be in that
scope and enrollment must be active. Multiple assignments do not duplicate
learners because filtering uses a class-membership subquery.

Current subject eligibility requires a current term within its current year,
today within both date ranges, term containment in its year, an existing class,
active subject and actual curriculum offering. Expired/future/noncurrent periods,
inactive subjects, removed offerings and reassignment remove subject scope.
Unassigned eligible teachers receive empty results rather than invented records.

Existing APIs are hardened for Teachers:

| Endpoint | Teacher behavior |
| --- | --- |
| `GET /students` | Assigned active learners only; scoped total, search, pagination and class filtering |
| `GET /students/{student}` | Currently assigned active learner only; minimal educational summary |
| `GET /students/{student}/academic-history` | Same learner scope; placement history excludes free-text reasons |
| `GET /classes` | Assigned class references only; no school-wide learner counts or Staff information |

Unauthorized and nonexistent class filters/details/history return the same
generic scoped 404. Read-detail routes resolve the scalar learner ID within the
Teacher scope instead of binding a school-wide Student before authorization.
Existing validation bounds and `data`/`meta` response conventions are preserved.
Leadership reads and Guardian shaping remain; Parent/Sponsor portal domain code
and ownership policies are unchanged.

Teacher detail returns only ID, admission number, names, current class, enrollment
status and minimal class name. No birth date, Guardian contacts, medical data,
safeguarding record, Sponsor administration or Staff HR is returned. No new audit
content or private narrative logging is introduced.

## E-F. Distinct teaching responsibilities

The Teacher Dashboard labels Class Teacher and Subject Teacher responsibilities
separately. Current class owners see their supervised classes, My Learners and
Attendance entry. Subject assignments show class/subject/current period and
Assessment entry, My Learners and My Timetable.

Class Teacher ownership is not term-dated in the existing schema. It remains
current supervision authority when no active academic period exists, consistent
with Attendance and Health's existing class-owner rule. Subject-derived learner
access and timetable entries fail closed without eligible current periods.

Subject assignments alone confer no daily Attendance authority. Class Teacher
ownership alone confers no subject Assessment authority. Existing Assessment
history/correction access continues to use its original assignment policy;
this workspace's current-discovery scope does not revoke historical Assessment
rights or change leadership permissions.

## G. Teacher Dashboard and navigation

The existing `/dashboard.html` now renders the Teacher Workspace for Teachers.
The existing `/students.html` renders My Learners for Teachers. A shared new
`teacher-workspace.js` implements the read interfaces; older generic renderers
yield for the Teacher role. Leadership pages continue using their existing code.

Teacher navigation is Teacher Workspace, My Learners, My Timetable, Attendance,
Assessment and Communication. Login/logout destinations are unchanged. No school
statistics, sponsorship management, Health management or fabricated counters
appear in the Teacher Dashboard. Existing Communication remains available;
Teacher announcement publication remains denied.

The reader supports search, scoped class choices, pagination, safe learner
dialogs, escaped API values, refresh/retry, independent timetable errors and
stale-response protection. It reuses responsive tables/cards, accessible labels,
live states, shared keyboard-safe dialogs, mobile sidebar and Light/Dark themes.

## H. Student-role safety and deferred lifecycle policy

The approved product decision excludes a standalone Student Portal this release.
The Parent/Guardian Portal is the family-facing interface; enhancements belong
to its separate checkpoint. No Student page, guardian impersonation or Student
redirect to Parent Portal is created.

Student accounts cannot access generic learner list/detail/history, Teacher
endpoints, school statistics, Attendance/Assessment management or Sponsorship
operations. Their existing class reference response now returns only ID/name/
level, closing school-wide count and Staff-name exposure. Basic academic reference
and school-wide announcement reads remain available; operational writes stay
denied. No Student account or role definition is changed or deleted.

The upcoming role-policy checkpoint must review existing Student accounts,
restrict routine creation (still present in the existing Administrator account
workflow), and implement reviewed account restrictions without silent deletion.
SRS, role matrix and roadmap updates for the approved family-interface decision
remain part of that separately authorized policy/Parent Portal work.

## I-J. Routes and files

Only two routes are added, both GET under Sanctum and `role:teacher`:
`/api/v1/teacher/context` and `/api/v1/teacher/timetable`. The context provides
school date, eligible periods, separate supervision/subject responsibilities and
deduplicated learner class choices. Existing learner/class routes are reused.

New backend files are `TeacherWorkspaceAccess.php` and
`TeacherWorkspaceController.php`; existing `StudentController.php`,
`AcademicStructureController.php` and `routes/api.php` are modified.

Frontend changes: new `assets/teacher-workspace.js` and `teacher-timetable.html`;
modified `dashboard.html`, `students.html`, `assets/nav.js`, `assets/dashboard.js`
and `assets/students.js`. Tests add `tests/safe/teacher_workspace.php` and
`tests/frontend/teacher-workspace.test.cjs`; update `shell.test.cjs` expectations
and `learner_guardian.php` RAM fixtures to include legitimate Teacher employment
and assignment scope. This report is the only documentation addition.

## K. Tests and results

All existing safe suites ran, including the MySQL wrapper; none was omitted.
Unique regression counts (reused bootstrap suites counted once):

| Suite | Passed |
| --- | ---: |
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
| Frontend, including 11 new Teacher checks | 55 |
| **Total** | **227** |

PHP 8.2 syntax checks pass for all changed/new PHP files. Node syntax checks pass
for changed/new JavaScript and tests; the HTML shells reference real assets.
Frontend shell tests cover all eight role menus, existing destinations/assets,
active highlighting, themes, keyboard sidebar, portals and logout. Real in-memory
HTTP tests exercise production routes, bearer tokens and encrypted Sanctum
sessions. Git whitespace and final authorization/privacy diff reviews pass.
Five HTTP-served page/script assets were compared with workspace file bytes;
all match. Non-Teacher direct timetable visits return to their own existing
landing pages and make no Teacher API requests.

PHP runners skip dotenv and replace database connections before provider boot
with guarded SQLite memory. Mail/report fixtures are in-process fakes. Existing
safe suites exercise migration definitions on disposable memory fixtures; no
development migration command is run. MySQL checks use pinned cached images,
network-none isolation, RAM-only database, read-only source/vendor mounts and
ownership-checked cleanup. The owned disposable container was removed.

## L. Development data and security review

Development checks used read-only metadata/data comparisons. This checkpoint
issued no school-data writes or migrations. Any concurrent application activity
limits whole-database equality claims; no records were altered to force a match.
Detailed population counts, activity metadata, timestamps and fingerprints are
retained in operator-controlled private audit evidence rather than public source.

Review covered role/account changes, current Staff linkage/status/type, query
identity spoofing, unrelated/nonexistent class/learner IDs, ownership reassignment,
learner transfer, current period boundaries, subject/offering eligibility,
deduplicated pagination, minimized responses and UI stale requests. Existing
Attendance, Assessment, Health safety-alert boundaries, announcement denial,
Parent/Sponsor isolation, password recovery and session invalidation remain intact.

No migration, new role, Streams, finance, clinical feature, Student Portal,
Parent enhancement, Coordinator Workspace, Health frontend or unrelated HR/
Visitor/Reporting change was introduced. Historical migrations were not edited;
development data was not reset/reseeded. No services were restarted or push made.

## M. Limitations

The timetable is a current recurring projection, not historical term scheduling.
Inactive/exited learners are excluded from My Learners; retained historical
Attendance/Assessment remains available through its established authorization.
Current class supervision lacks a dated appointment history in the existing
schema. No Teacher generic report-card access or publishing permission is added.
New Teacher APIs use only the already-applied schema. Existing account recovery/
session-revocation dependence on pending `users.session_version` (000036) is
unchanged and requires the separately approved migration rollout.

DOM mocks establish behavior and request isolation, not visual browser layout or
screen-reader certification. The disposable MySQL suite validates existing Health
UTC behavior; Teacher scope queries are tested on SQLite, not live MySQL fixtures
or concurrent assignment changes. The read-only database comparison is bounded
to the before/after fingerprints. A reviewed role-policy/account-onboarding task
is still needed for Student lifecycle and legitimate Staff/User linkage.

## N-O. Completion

Create one local commit after the reported checks, then verify a clean working
tree on the required branch. The commit hash and final Git status are supplied
in the completion response. Stop for review; no other module begins.
