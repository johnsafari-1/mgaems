# Role navigation and announcement authorization

Initial checkout: `D:/mgaems`, `feature/production-ui`, clean working tree,
HEAD `e5d6869e5b38cd3bad2f2e6c9dde63dfd2633ec5`, two commits ahead of origin.
The existing role matrix and SRS FR-AUTH-04 / FR-COM-01 were compared with
current routes, authentication, Staff linkage, page guards and publication
code. Current approved permissions take precedence over disputed older matrix
entries. No other repository was accessed.

## Navigation policy

`public/assets/nav.js` now has one role-to-page policy. Leadership shares a
common list; explicit role lists define the narrower menus and portal entries.
Unknown roles, including inherited JavaScript object property names, receive
no navigation entries.

| Role | Visible destinations |
| --- | --- |
| System Administrator | Dashboard, Students, Guardians, Academics, Attendance, Assessment, Sponsorship, HR / Staff, Communication, Visitors, Reports, Administration |
| Head Teacher | Same destinations as Administrator, with existing Head-specific page controls and backend permissions |
| Deputy Head Teacher | Same leadership destinations except Administration |
| Teacher | Dashboard, Students, Attendance, Assessment, Communication |
| Sponsor Coordinator | Sponsorship first, then Dashboard, Communication, Visitors |
| Parent / Guardian | Existing Parent Portal only |
| Sponsor | Existing Sponsor Portal only |
| Student | Existing Dashboard and Communication announcements only |

The previous default menu exposed Teacher Sponsorship links, Coordinator
learner management/Attendance/Assessment links, and Student operational links.
Those entries are removed. Teacher and Coordinator menus do not expose the
Academic administration page. Existing read-only academic/reference APIs and
their permissions are unchanged. No Teacher timetable link was added.

Parent/Sponsor communication links are deliberately not added: the current
shared `requireAuth()` redirects those roles back to their own portal when
opening `communication.html`. Messaging also uses manual recipient IDs rather
than a portal-specific recipient workflow. Existing portal authorization and
login destinations are unchanged. Coordinator login still lands on the current
Dashboard; no Coordinator dashboard is implemented.

Student has no Student Portal or own-learner account binding. The existing
Dashboard shows school-wide announcements and honest access restrictions for
unavailable cards, without fetching school statistics or learner records.
Communication provides the existing announcement reader with no publication
or messaging controls for Student. No new page, fabricated record or alternate
login redirect was introduced.

Theme, responsive shell, mobile sidebar, active-page highlighting, keyboard
focus handling and login/logout code are preserved. Menu visibility does not
replace API authorization; active Staff linkage and assignment requirements
continue to apply to Staff-dependent destinations.

## Publication weaknesses and correction

The announcement table stores `published_by`, `title`, `body`, `audience` and
`published_at`. It has no class target or recipient relationship. Previously,
an active Teacher with Staff linkage could publish to school-wide, Staff,
Parent or Sponsor audiences. The API also accepted `class` without any actual
class target or assignment verification. The frontend already omitted a class
option but offered Teachers the unrestricted non-class publication form.

Teachers are now denied publication at both the Laravel route and controller.
Even active teaching Staff with a valid current class/subject assignment cannot
publish until the database can represent safe class delivery. No assignment or
client assertion can supply that missing stored relationship.

Administrator, Head, Deputy and Coordinator retain existing school-wide,
Staff, Parent and Sponsor publication permissions. New `class` publications are
rejected with normal 422 validation. Nonempty client-supplied class targets,
publisher identities and publication timestamps are prohibited. An explicit
payload allowlist also discards empty prohibited fields so they cannot override
the authenticated publisher. Teacher publication controls are removed, with an
additional form-opening guard. Success retains the existing `data` envelope;
denials retain `FORBIDDEN`; inactive users retain `ACCOUNT_INACTIVE`.

There is no announcement update/delete route. None was introduced. PUT/PATCH/
DELETE attempts cannot modify an existing row or change its audience/publisher.
Future edit APIs must apply the same actor, ownership and target checks as
creation; unrestricted editing must not be introduced before class targeting.

Audit logging remains metadata-only (`audience`); titles and message bodies
are not added to audit details.

## Recipient boundary

GET announcements now uses the existing role middleware for all eight canonical
roles. Staff-dependent roles require a current active Staff relationship;
Teacher additionally requires active teaching Staff before reading Staff content.
System Administrator remains eligible without a Staff link. Parent and Sponsor
also remain independent of Staff.

| Eligible reader | Returned audiences |
| --- | --- |
| Administrator, Head, Deputy, Coordinator, Teacher | School-wide and Staff |
| Parent / Guardian | School-wide and Parents |
| Sponsor | School-wide and Sponsors |
| Student | School-wide only |

The Parent/Sponsor announcement audiences are role-wide, as before; they are
not individual learner messages. Own-child/sponsorship isolation remains in
the portal APIs. Legacy `class` rows stay stored but are never returned, since
their recipients cannot be established. No historical records are rewritten.

## Future class-targeting proposal and policy decisions

A separately reviewed additive migration must persist a real class relationship
(a class FK for single-class publication, or an explicit target pivot if multiple
classes are approved). Class audience and stored targets must be mutually
validated; legacy targets must not be guessed. A later implementation must
verify active User, active teaching Staff, permitted current supervision or
class/subject assignment, offered active subject and current academic eligibility,
and the requested audience. Target changes and reads must recheck actual scope.
Guardian reads must use learner/guardian links; Student reads need a real
own-learner account relationship before that recipient channel can be enabled.

School decisions still needed include allowed Teacher recipient types, whether
publication can cover multiple assigned classes, historical visibility after
reassignment, correction/approval rules, and reconciliation of disputed Deputy
and leadership permissions in the old matrix. This checkpoint does not decide
those policies or grant additional permissions.

Student Portal, Teacher timetable APIs/report views, Coordinator dashboard and
portal-compatible communication workflows remain separate interface gaps.
Health frontend and pending Health migrations remain out of scope.

## Validation and safety

Run from the verified MGAEMS checkout:

```powershell
node --test tests/frontend/*.test.cjs
node --check public/assets/nav.js
node --check tests/frontend/shell.test.cjs
docker compose exec -T app php tests/safe/announcements.php
docker compose exec -T app php tests/safe/attendance.php
docker compose exec -T app php tests/safe/assessment_history.php
docker compose exec -T app php tests/safe/health_safety.php
docker compose exec -T app php -l app/Http/Controllers/Api/AnnouncementController.php
docker compose exec -T app php -l routes/api.php
docker compose exec -T app php -l tests/safe/announcements.php
git diff --check
```

All pass: 44 frontend tests, 14 new announcement/page-role checks, 18 shared
authorization checks, 18 Attendance checks, 15 Academic Structure checks,
18 Assessment/report history checks and 36 Health checks. Shared authorization
checks are reused by two runners; they are counted once (163 unique checks).

Frontend tests execute all eight menus, verify each destination and local asset
exists, check active links, and exercise the existing Communication reader for
the six non-portal roles. Representative page API role gates are checked for
all eight roles using production routes and the real middleware. Existing
request/controller regressions cover actual learner/assignment/portal ownership,
Health exclusions and nested resources. JavaScript tests use mocked DOM/network
interfaces; visual browser rendering and MySQL concurrency are not claimed.

PHP runs in the existing PHP 8.2 app container. The safe runners skip dotenv and
replace connection definitions before provider boot with sole in-memory SQLite
connections, with explicit driver/database guards. The new runner reuses the
existing guarded authentication bootstrap and creates announcements only in RAM.
Existing suites exercise migration definitions on disposable memory fixtures;
no migration command or development-schema migration was run. Report artifacts
use in-process memory storage. Development MySQL is not used by these tests.

Only navigation, Communication controls, announcement authorization, focused
tests and this report changed. Attendance, Assessment, Health, authentication,
historical migrations and portal domain code are unchanged. No framework,
new migration, testing environment/configuration, new role, Streams or finance
functionality was introduced. No development records were edited, reset or
reseeded. No services were restarted and no push was performed.
