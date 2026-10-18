# Sponsor Coordinator Workspace productionization

## Verification and existing domain

Work began in <repository> on feature/production-ui at
43e59615f6c6a8a09f667e224deba845ae61caee, with a clean working tree five commits ahead of origin.

The existing Sponsor/Sponsorship controllers already supported sponsor categories,
name/type duplicate validation, business contact details, individual assignments,
explicit group membership through sponsorship_student, named school-wide programmes,
and active/paused/ended transitions. Ending requires a date and reason and is terminal.
The group pivot has a unique sponsorship/learner pair and restrictive learner foreign key.
Sponsor.user_id is a nullable unique account link; business CRUD never provisions a login.
There was no membership-edit/reassignment contract or Finance domain to reuse.

The initial read-only aggregate inspection found one sponsor business record (no Portal
account link), one active individual sponsorship, no group memberships or duplicate active
individuals, and one active Coordinator User without an active Staff link. These records
and relationships were not changed. The Coordinator remains correctly denied by the
existing active-Staff requirement; eligibility needs a separately reviewed legitimate link.

## Dashboard, directory and reporting

The existing dashboard.html now loads the Coordinator renderer from the shared
sponsorship-workspace.js; other role renderers retain their own pages and behavior.
The existing sponsorship.html uses the same script and existing CRUD APIs.

GET /api/v1/sponsorships/summary supplies actual sponsor/sponsorship counts, zero-filled
counts by the three types and three statuses, individual assignment counts and group
membership counts. Assignment/membership totals include all statuses. Memberships are
relationships, not deduplicated learner counts. School-wide counts are programme record
summaries, with no inferred beneficiary list. No contribution, payment or balance metrics
were added. The management list is a paginated operational report by sponsor, status,
type, dates and learner/programme targets; group details show explicit memberships.

Sponsor directory and sponsorship filters support stable ordering, bounded page sizes,
search, empty/error/retry states and pagination. Coordinator requests always paginate;
legacy leadership callers without pagination retain the data-array convention. Searches
escape SQL wildcard and escape characters as literal text. Sponsor details fetch business
contacts/notes separately; directory responses contain only ID, name, type and count.
Linked sponsorships use the filtered paginated list instead of unbounded model serialization.

Existing Administrator create/update and leadership read-only capabilities remain.
Shared shell, login/logout, themes, navigation and responsive layouts are reused.
Coordinator navigation names its dashboard workspace and does not fetch academic header
context. Shared accessible dialogs handle focus, inert backgrounds, errors and busy saves.
Pause/resume requires confirmation; the end dialog states that saving confirms a permanent
change and requires the existing end date and reason. Search/page request generations
prevent stale results replacing current filters, and closed dialogs reject late responses.
Allocation selections survive searched pages and clear when the sponsorship type changes.

## Authorization and privacy

All sponsor/sponsorship management reads, summary and the nested learner route remain
inside Sanctum authentication and role:system_admin,sponsor_coordinator,head_teacher,
deputy_head_teacher. Writes retain role:system_admin,sponsor_coordinator. Existing
Authenticate refreshes account state, and EnsureRole requires the Coordinator's current
active Staff relationship on every operation, including cookie-authenticated requests.
Non-Staff Administrator and Sponsor/Parent authentication remain independent.

New GET /sponsorships/{sponsorship}/learners/{student} resolves the learner only through
that individual assignment or explicit group membership, returning generic FORBIDDEN
for missing/foreign learner IDs. School-wide sponsorship returns the existing
SPONSORSHIP_TYPE_UNSUPPORTED convention and never returns a learner list, even with
stray legacy learner/pivot relationships. Operational responses are explicit allowlists:
admission reference, names, status and minimal class reference. No Guardian contacts,
DOB, medical/safeguarding data, academic corrections, Staff HR, pivot metadata, creator
username/account link, credentials or tokens are serialized. Successful operational
responses use private, no-store caching.

The existing allocation endpoint remains an intentional eligibility lookup for assignment
creation. Coordinators must search with at least two non-whitespace characters; it returns
only minimal active-learner references with the existing active-individual eligibility flag,
in bounded pages. It does not preload an unfiltered roster or grant learner-detail access.
This lookup is distinct from sponsorship-owned learner summaries.

Coordinator direct access to classes, subjects and class-subjects is now denied, closing
the prior broad academic reference path containing school-wide class counts/Staff names.
Other legitimate roles retain their existing academic reference behavior and now pass the
shared role/active-Staff gate. Coordinator student administration, Teacher assignments,
Attendance/Assessment entry, Staff HR, system/user/role administration, school reporting,
Parent/Sponsor portals, operational Health and safeguarding remain denied server-side.
No Parent Portal, Teacher scope, Assessment, Attendance or Health code was changed.
Sponsor Portal ownership, group membership, nested report ownership and school-wide
restrictions were regression-tested; its permissions were not expanded.

## Atomicity and audit

SponsorshipOperations retains existing validation/transition rules and makes assignment,
group pivot and audit persistence atomic. Sorted learner locks recheck active eligibility
at creation. Individual create/resume locks the same learner and uses a locking read of
committed active individual assignments. A competing active assignment returns the
existing ALREADY_SPONSORED 409 without side effects. Updates reload/lock the current
sponsorship, preserving terminal-state enforcement under concurrency. The update API
explicitly rejects assignment/type/sponsor/start-date edits; it does not add new policies.
Audit actions and entity IDs remain; sponsor audit details now record only type or changed
field names, and sponsorship audits only transition/type/member-count metadata. Business
names, contacts, free-text notes and ending reasons are not copied into new audit entries.
Sponsor writes and audit entries also commit/roll back together; updates lock their row.

## Communication and Visitors

Coordinator announcement publishing and audience-filtered reads remain authorized.
Owned sent/received message history and recipient-owned mark-read authorization remain.
The existing new-message form accepted arbitrary User IDs, and the backend validated
only recipient existence. New Coordinator sends therefore fail closed both at route and
controller, and the UI removes that action until an approved recipient policy exists.
No extra recipients or messaging capabilities were introduced. Parent send denial remains.
Other roles' existing sends are outside this checkpoint. Read-only Visitor access remains;
Coordinator visitor creation and Staff directory access are denied. No Visitor feature was added.

## Safe verification

All fixtures use either the sole guarded SQLite :memory: connection without dotenv or a
pinned-image disposable MySQL container with no host ports/network or development data
mount. MySQL data lives in tmpfs; source/vendor mounts are read-only; cleanup verifies the
container ID/name/label/network/tmpfs before removing only that fixture instance.
No .env.testing, phpunit.xml, real account/password attempts or persisted report fixtures
were created. The wrapper now selects only the two allowlisted suites, waits for final
TCP readiness (not the temporary initialization socket server) and hides exception arguments.

| Safe suite | Unique checks |
| --- | ---: |
| Authorization | 18 |
| Academic structure | 15 |
| Assessment history/report artifacts | 18 |
| Attendance | 18 |
| Learner/Guardian | 12 |
| Announcements/roles | 14 |
| Teacher Workspace | 21 |
| Parent Portal | 18 |
| Sponsor Coordinator | 25 |
| Health authorization | 36 |
| Health timestamps | 7 |
| Password recovery/session invalidation | 9 |
| Disposable MySQL Health | 4 |
| Disposable MySQL Sponsorship | 4 |
| Frontend workflow/shell tests | 85 |
| Total (bootstrap repeats excluded) | 304 |

The 25 new backend checks cover active/non-teaching Staff eligibility, inactive accounts
and sessions, missing/inactive/unlinked Staff, direct role denial, pagination/filter validation,
response privacy, duplicate sponsor checks, immutable assignment boundaries, one-active
individual create/resume, explicit groups, school-wide behavior, terminal transitions,
audit rollback, protected academic/Health/system routes, message ownership and family,
Sponsor and Teacher isolation. Four real MySQL checks prove competing creates and
create/resume wait on the learner lock, recheck committed state, roll back group pivots on
audit failure and treat search wildcards literally. Eighteen new frontend checks cover
operational dashboards, role isolation, search/pagination, stale responses, escaped details,
searched selections, explicit group creation, school-wide privacy, field errors, duplicate-save prevention and confirmations.
Existing shell tests now assert Coordinator send denial and its role-specific dashboard.
PHP/JavaScript syntax, production route middleware/order, served asset content and Git
whitespace are checked in addition to these suites. DOM tests do not replace visual browser
or screen-reader review; no real Coordinator account was modified for a live sign-in test.

## Limitations and remaining policy decisions

- Coordinator access requires an active Staff link. Review legitimate employment
  linkage through the authorized account/HR process; never bypass the Staff requirement.
- Group membership is selected at creation and reviewed thereafter. Editing/removal,
  reassignment and cancellation policies need approval before extending the current API.
- Approve Coordinator messaging recipients/relationships before re-enabling sends. Other
  roles still have the pre-existing broad recipient policy. The pre-existing Message model
  does not fill sent_at/read_at; this task tests ownership and does not claim that legacy
  mark-read persistence was repaired.
- Sponsor name/type duplicate validation remains application-level; there is no database
  unique name/type constraint. Simultaneous Sponsor CRUD still needs separately reviewed
  uniqueness hardening/schema approval. Individual assignment concurrency is tested and fixed.
- Existing group details include all explicit members; very large groups may need separate
  membership pagination. Free-text business notes must not be used for confidential medical,
  safeguarding or authentication information; stored legacy notes/audit content were not rewritten.
- Sponsor Portal's existing comments endpoint reads mutable assessment remarks. This
  checkpoint preserves its scope without expanding it; a separate Sponsor publication-policy
  task should address formal release/confidential-correction behavior.
- Both Health migrations 000036 and 000037 remain pending. Sponsorship changes require no
  schema change. Existing login/read fallback works before 000036, but existing password
  reset, account status/role changes and session-version invalidation depend on its rollout.
  This checkpoint neither applies migrations nor changes authentication code.

Development checks used read-only metadata/data comparisons. This checkpoint
issued no school-data writes or migrations. Any concurrent application activity
limits whole-database equality claims; no records were altered to force a match.
Detailed population counts, activity metadata, timestamps and fingerprints are
retained in operator-controlled private audit evidence rather than public source.
