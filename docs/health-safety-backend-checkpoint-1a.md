# Health & Safety backend — Checkpoint 1A

## A. Initial repository state

Verified before changes with the requested Git commands:

* Root: `D:/mgaems`.
* Branch: `feature/production-ui`.
* Clean working tree.
* HEAD: `b92951d9d0f4fdf50cade003d3a26a40d7b74a58`, authorization foundation.

No additional `AGENTS.md` was found in the workspace. Existing Student,
Guardian, Staff/User, academic assignment, Sanctum, audit, and immutable
revision patterns were inspected. No other repository was accessed.

## B. Models and additive migrations

`2026_10_10_000036_add_user_session_version.php` adds only
`users.session_version`, an unsigned counter defaulting to zero.

`2026_10_10_000037_create_school_health_records.php` creates eight empty tables:

| Model/table | Purpose |
| --- | --- |
| `LearnerHealthProfile` / `learner_health_profiles` | Unique Student; explicit allergy-information state and bounded reported details; emergency/support information; actual source; server recording attribution; explicit human review metadata; revision number |
| `HealthSafetyAlert` / `health_safety_alerts` | Profile-owned operational type, teacher-actionable description/instructions, active flag, effective dates, actual source, optional explicit operational verification and revision number |
| `SchoolHealthIncident` / `school_health_incidents` | Student; observed/reported information; occurrence and recording times; location/category; recorder; evidence-backed historical context; status/disposition and revision number |
| `HealthIncidentAction` / `health_incident_actions` | Incident-owned first-aid/observation/follow-up/handover/status action, actor, actual and recording times, bounded action/result and explicit transition |
| `HealthGuardianNotification` / `health_guardian_notifications` | Existing Guardian reference where known; channel, attempt time, outcome, actor, and minimal known contact snapshot |
| `HealthExternalReferral` / `health_external_referrals` | Incident-owned actual referral time, operational reason, optional destination/authorization/handover facts and follow-up state |
| `HealthRecordRevision` / `health_record_revisions` | Immutable creation/correction/review/activation/verification/aggregate histories for the six operational record types |
| `HealthAccessLog` / `health_access_logs` | Immutable restricted read/mutation metadata, separate from the general audit feed |

The shared revision table is the deliberate deviation from one history table
per conceptual entity. Internal type constants select its owner; no arbitrary
record-type API exists. Owner/type/revision sequences are database-unique.
Polymorphic owner IDs have no database FK; controlled writes, no delete routes,
and model deletion guards preserve them at the application boundary.

Student, profile, incident, historical class/term, and actor references use
restrictive FKs. Guardian references become null on ordinary Guardian
unlinking; original known identity/contact facts remain in protected snapshots
and revisions. This preserves the existing Guardian domain and unlink workflow.

There are no diagnoses, severity scales, clinical treatment models, medication
records, clinical integrations, or medical attachment storage. Notification and
referral endpoints record completed/attempted school actions; they send no
messages and contact no external provider.

## C. API and authorization matrix

All 34 new route definitions are under `/api/v1/health` and require
`auth:sanctum` plus `health.access:manage` or `health.access:safety`.

| Role | Management/detail/history/access-log | Teacher safety view |
| --- | --- | --- |
| Active Head Teacher with active Staff | Read/manage | Uses the management alert boundary |
| Active Deputy Head Teacher with active Staff | Read/manage | Uses the management alert boundary |
| Active Teacher with active **teaching** Staff | Denied | Read only for currently assigned active learners |
| System Administrator | Denied | Denied |
| Parent, Sponsor, Sponsor Coordinator, Student | Denied | Denied |
| Inactive/locked account or ineligible Staff | Denied | Denied |

The management boundary exposes:

| Relative path | Methods |
| --- | --- |
| `/profiles` | GET summaries, POST create |
| `/profiles/{profile}` | GET detail, PATCH correction |
| `/profiles/{profile}/review` | POST explicit human review |
| `/profiles/{profile}/revisions` | GET restricted history |
| `/profiles/{profile}/alerts` | GET summaries, POST create |
| `/profiles/{profile}/alerts/{alert}` | GET detail, PATCH correction/activation/deactivation |
| `/profiles/{profile}/alerts/{alert}/verify` | POST explicit operational verification with a known basis |
| `/profiles/{profile}/alerts/{alert}/revisions` | GET restricted history |
| `/incidents` | GET summaries, POST create |
| `/incidents/{incident}` | GET detail, PATCH factual correction |
| `/incidents/{incident}/revisions` | GET restricted history |
| `/incidents/{incident}/{collection}` | GET summaries, POST append |
| `/incidents/{incident}/{collection}/{entry}` | GET detail, PATCH correction/follow-up |
| `/incidents/{incident}/{collection}/{entry}/revisions` | GET restricted history |
| `/access-log` | GET restricted access metadata |

`{collection}` is a configured route for `actions`, `notifications`, or
`referrals`, each with its own concrete controller/model. It is not an
arbitrary client-selected table. Parent ownership is checked on every nested
detail, correction, and history read. No DELETE route exists.

The separate teacher endpoint is
`GET /api/v1/health/safety/learners/{student}`.

Lists are explicit summary allowlists, with `page` and `per_page` (maximum 50).
Profile and incident lists accept an exact `student_id` filter. Detail and
history reads have their own restricted boundaries. Scalar route IDs prevent
model binding from exposing record existence before authorization.

Success retains `data`/`meta`. Denial uses the established `FORBIDDEN` envelope;
the shared foundation retains `ACCOUNT_INACTIVE`. Validation uses Laravel's
422 convention. Stale revisions and conflicting UUID reuse return safe 409
codes. Scoped missing records return a generic JSON 404. Unexpected health
failures return a generic 503 without SQL, bindings, or exception text.
Successful health responses use `Cache-Control: private, no-store`; health
validation always produces JSON and never flashes sensitive form input.

## D. Teacher safety behavior

Class Teacher scope comes from the actual `classes.class_teacher_id` Staff
relationship. Subject Teacher scope requires the existing class/subject/Staff/
term assignment, actual subject offering, active subject, current term and
academic year flags, and calendar dates containing the school-local day.
No new supervision domain or unrestricted Teacher-role access was introduced.

Learners must be active and remain in the scoped current class. Account/Staff
eligibility is rechecked in the middleware and operation transaction. Changes
to assignments, class ownership, placement or employment affect later reads.
Supplied role/Staff IDs cannot establish scope. Unknown and foreign learners
receive the same authorization denial.

Only active alerts within their inclusive effective dates are returned. The
response contains `student_id` and `alerts`; each alert contains exactly `id`,
`alert_type`, `description`, and `emergency_instructions`. It contains no full
profile, source/review/verification metadata, incident narrative, referral,
contact/notification history, revision, Staff object or Guardian object.

Alert description/instruction fields are explicitly teacher-disclosable
operational publication fields. An empty alert list means no current published
operational alerts; it never asserts no allergies or no health risks.
Publication does not fabricate medical verification.

## E. Integrity, history and confidential auditing

All operations run transactionally, with current account/Staff checks and
row locks. Mutations, immutable revision snapshots, and health audit rows
commit together. Audit failure prevents sensitive read responses; unexpected
exceptions are not reported with raw SQL or narratives.

Mutable facts require `expected_revision` and a nonempty bounded
`correction_reason`. Creation starts sequence 1. Profile reviews and alert
verification are explicit operations attributed to the current actor and
time. Profile edits clear review metadata; alert edits clear stale verification.
Activation/deactivation revisions retain their previous state.

Alert, incident, action, notification, and referral creates require a UUID
`request_id`. Exact same-actor payload retries return the existing record with
`meta.operation = replayed`, without duplicate content/history. Different
payload/owner reuse conflicts. Fingerprints are keyed HMACs and are never
returned. Profile uniqueness prevents duplicate learner profiles with a 409.

Incident child creates/corrections require `expected_incident_revision`.
Each append/correction advances the aggregate incident revision, as well as
the child's own history. First-aid is a bounded school action, not a treatment
subsystem. Operational transitions require both status and disposition;
closing requires a disposition, and reopening uses an explicit follow-up or
status-change action. Correcting an old action cannot replay a historical
transition against current incident state. Actual action/notification/referral
times cannot precede the incident or be in the future. Timestamps require
an explicit offset and are normalized to the application's timezone.

Class context uses recorded placement history preceding occurrence. No history,
transfer-out, or same-day date-only placement ambiguity leaves class unknown.
Term context uses a unique existing calendar period covering the occurrence.
Names are explicitly labeled as known at recording time. Promotion does not
rewrite captured context. A correction to the occurrence day recomputes context
from historical evidence while retaining the prior revision.

Notification snapshots contain the known Guardian ID/name at recording,
caller-supplied actual contact used where known, and capture basis/time. Current
phone/email is never silently substituted for a historical attempted contact.
Guardian unlinking leaves known snapshots intact, and exact original notification
retries remain idempotent after unlinking. No automatic notification is sent.

`AuditLogger` was inspected and left unchanged. Its general feed is visible to
System Administrator and therefore cannot safely hold health associations.
`HealthAudit` records read/list/history/replay/mutation events in the new
restricted log, with actor ID, operation, record type/ID and server timestamp.
It duplicates no narratives, instructions, contact snapshots, source notes,
correction reasons or reporter names. Only eligible Head/Deputy Staff can read
this log. Access-log reads are themselves audited there.

## F. Legacy preservation

`student_medical_info`, `StudentMedicalInfo`, and ordinary Student resources
were not changed. The migrations neither read nor modify legacy content.
No legacy-to-profile conversion, source/verification fabrication, or medical
response expansion was introduced. Isolated tests compare legacy sentinel
rows before migration and after all workflows. New profiles default to
`unknown`; `none_reported` requires an explicit assertion. `recorded` requires
bounded details, while unknown/none-reported states reject such details.

## G. Authentication and session findings

Dormant pre-deactivation sessions could otherwise regain health access after
reactivation. A narrowly scoped durable session epoch now closes that path:

* Supported User PATCH/DELETE paths increment `session_version` in their
  existing transaction when blocking the account. Managed role changes also
  increment it. Reactivation never resets it; clients cannot assign it.
* An actual active-account `web` Login event stamps the user ID and current
  epoch into the authenticated session. It never stamps an inactive login.
* Health requests using cookie authentication require a matching user/epoch.
  Old, unversioned or mismatched sessions are invalidated and receive the
  existing unauthenticated 401 convention.
* Bearer login/logout shapes, current-token logout, and normal non-health
  routing remain intact. Existing bearer revocation on deactivation remains.

There is no new session-login endpoint or unrelated authentication refactor.
Pre-checkpoint sessions need fresh authentication before sensitive use.
General APIs retain the prior dormant-session behavior; this checkpoint's
epoch enforcement is deliberately at the health boundary. Direct privileged
SQL/bulk status changes must also advance the epoch and revoke tokens.

## H. Isolated tests and results

```powershell
php tests/safe/health_safety.php
php tests/safe/attendance.php
php tests/safe/assessment_history.php
php tests/safe/learner_guardian.php
node --test tests/frontend/*.test.cjs
```

The health runner reuses the guarded memory-only bootstrap, including all 18
authorization regressions, then adds 36 health checks. It skips dotenv,
refuses cached configuration/routes, and replaces every connection before
providers boot. Only SQLite `:memory:` is available; sessions/cache use arrays
and exception logging is null. New migrations are executed only against memory
fixtures. Fixed-clock health batches clear only their in-process array limiter
cache; production throttling is unchanged and its login behavior is tested.

| Suite | Passing checks |
| --- | ---: |
| Health & Safety | 36 |
| Authorization foundation | 18 |
| Attendance | 18 |
| Academic Structure (included by assessment-history runner) | 15 |
| Assessment/report history | 18 |
| Learner/guardian | 12 |
| Existing frontend regressions | 33 |
| Total | 150 |

Coverage includes permissions, current eligibility, teacher scope, unknown
allergies, source/bounds/date validation, nested ownership, histories,
idempotency, conflicts, audit/revision rollback, privacy allowlists, no caching,
no session flashing, legacy preservation, Guardian unlinking, durable session
revocation, identity binding, and forward-only rollback guards.

All changed PHP files pass syntax checks; new application/migration files pass
Laravel Pint; Git whitespace checks pass. No persisted learner/demo health
records were created. No `.env.testing` or `phpunit.xml` was created.

## I. Migration application and data safety

Both new migrations were delivered unapplied. The development preflight confirmed
both pending; production application status is unverified and must be checked
independently before any deployment. The later corrective work and UTC timestamp
contract are documented in [health-safety-corrective-fixes.md](health-safety-corrective-fixes.md).
No development database connection, migration, reset/wipe/reseed, or data write
was performed. Thus this task did not alter or remove development data.

Schema impact was reviewed: one additive User counter, eight new empty tables,
indexes/FKs on new tables, no existing health or academic table rewrite, and
no data backfill. Tests exercise the exact new migration definitions safely
in memory. Both `down()` methods refuse destructive rollback.

A reviewed operator must apply both migrations before activating this code;
User deactivation now expects the epoch column. Verify existing prerequisites,
backups and table-name/column collisions first. MySQL DDL is not necessarily
atomic: partial deployment requires a reviewed forward repair, not automatic
table dropping or forced migration reruns. No production schema change was
automatically applied, and concurrent MySQL execution was not tested.

## J. Limits and unresolved school decisions

This backend checkpoint is ready for code review. Activation remains pending
the schema work and the following deployment/governance safeguards:

* Existing full-database backup creation/download remains a technical-admin
  capability. Such dumps can include health records and restricted access logs.
  Operational API denial does not protect those dumps or direct database access.
  Backup segregation, encryption, access approvals and infrastructure audit
  must be established separately before confidential data is enabled.
* Existing technical User/Staff administration can grant operational roles.
  Independent approval and oversight of Head/Deputy role grants is a school
  governance decision; this checkpoint introduces no automatic admin health role.
* School approval is still needed for retention/access-log retention, alert
  publication wording, source verification practice, emergency escalation and
  guardian/referral authorization standards. No clinical authority is inferred.
* Staff reactivation restores currently authorized permissions; this checkpoint
  does not introduce a separate durable employment-session epoch. All supported
  requests still require current account and Staff eligibility.
* SQLite validates behavior/constraints, not concurrent MySQL row-lock semantics.
  In-flight requests can finish within their authorized transaction; later
  requests recheck scope. Calendar/placement history gaps remain explicitly
  unknown rather than reconstructed from current placement.
* Application revision immutability is not database tamper-proofing. Direct SQL,
  database/backup administrators and telemetry outside this application require
  infrastructure safeguards. Request-body/SQL tracing must not capture sensitive
  health payloads. Application failure responses deliberately omit raw diagnostics.
* Idempotency keys identify exact same-actor submissions, not semantic duplicates.
  New UUIDs intentionally create new events. Application-key rotation may cause
  old submission fingerprints to conflict safely rather than replay.
* Existing ordinary audit behavior outside this module was not redesigned.
  No new health associations are written to that general feed.

No Phase 2 safeguarding/welfare cases, frontend, medication/prescription work,
vaccination/lab/radiology, FHIR/HL7, finance, Streams, health portals or medical
attachments were implemented. Restricted health reporting is deferred.

## K. Changed files

Existing files changed: `app/Http/Controllers/Api/UserController.php`,
`app/Http/Kernel.php`, `app/Providers/AppServiceProvider.php`, `routes/api.php`,
and `tests/safe/authorization.php`.

New controllers under `app/Http/Controllers/Api/`: `HealthController.php`,
`HealthProfileController.php`, `HealthAlertController.php`,
`HealthIncidentController.php`, `HealthIncidentEntryController.php`,
`HealthActionController.php`, `HealthNotificationController.php`,
`HealthReferralController.php`, `HealthSafetyController.php`, and
`HealthAccessLogController.php`.

New middleware: `app/Http/Middleware/EnsureHealthAccess.php`.

New models under `app/Models/`: `HealthRecord.php`, `LearnerHealthProfile.php`,
`HealthSafetyAlert.php`, `SchoolHealthIncident.php`, `HealthIncidentAction.php`,
`HealthGuardianNotification.php`, `HealthExternalReferral.php`,
`HealthRecordRevision.php`, and `HealthAccessLog.php`.

New services under `app/Services/`: `HealthAccess.php`, `HealthAudit.php`,
`HealthContext.php`, `HealthHistory.php`, `HealthInput.php`, `HealthOperations.php`,
and `HealthView.php`.

The two new migrations above, `tests/safe/health_safety.php`, and this report
complete the 36 changed files. No frontend, historical migration, legacy
medical model, Attendance service or Assessment service was modified.

## L–M. Commit and final Git state

The accompanying completion report records the single local commit hash and
verified final Git status. No push or frontend implementation was performed.
