# Health & Safety pre-migration corrective fixes

## A. Verified checkout

Authoritative root `<repository>`, branch `feature/production-ui`, initial commit
`1e3bcb5fdbd72ea236c7230cbf66f2768aa55b08`, initially clean and one commit ahead
of the locally recorded origin branch. No push, frontend change, backup creation,
ordinary migration, development data mutation or unrelated service restart was
performed. The previous Checkpoint 1A report was read before implementation.

## B. Timestamp root cause

HealthInput converted offset-bearing event times into Africa/Nairobi Carbon
objects. Eloquent's default `fromDateTime()` formatted the object's local clock
as `Y-m-d H:i:s`, discarding the offset. Development MySQL's UTC session treated
`12:00 +03:00` as `12:00 UTC`, rather than the actual `09:00 UTC` instant.
On readback, default Eloquent parsing inherited Nairobi, masking the defect in
some API round trips. Server recording timestamps had the same persistence
problem. Ordinary query bindings also discarded fractional seconds.

The implementation was traced in the installed Laravel/Carbon date casting,
query binding and PDO code. Raw database assertions, rather than round trips
alone, now establish the persistence contract.

## C. Canonical timestamp contract

Health API event instants accept `YYYY-MM-DDTHH:MM:SS` with `Z` or a numeric
offset, optionally with one to six fractional digits. Inputs must represent
valid calendar dates and clock times. Offset-free strings, natural-language
dates, leap seconds, unknown `-00:00` offsets, invalid offsets, excessive
precision, out-of-range UTC dates and future event times receive the existing
Laravel field-validation response. Numeric offsets are bounded to ±14:00.

Normalization converts the actual instant to UTC. The Health-only model trait
persists `Y-m-d H:i:s.u` and explicitly reads offset-free database strings as
UTC. All eight Health models use this trait, including revision and access-log
models. Generated recording/review/verification/created/updated timestamps
follow the same contract. Responses and snapshots use unambiguous UTC ISO
strings, retaining microseconds. Equivalent offsets produce the same canonical
idempotency fingerprint. Corrections preserve omitted timestamps' precision.

Application timezone remains Africa/Nairobi. Alert start/end dates remain
literal calendar DATE values. Historical placement and term decisions explicitly
derive the Nairobi date from the UTC instant; corrections compare Nairobi dates
when deciding whether to recapture context. Incident-versus-child SQL chronology
checks bind a fully formatted UTC string so microseconds survive query binding.
No fixed three-hour arithmetic or global legacy date conversion was introduced.

## D. Schema decision

Development confirmed migration `2026_10_10_000037_create_school_health_records`
pending and all eight new tables absent before its definition was revised.
Only this newly introduced migration was changed. All 25 Health instant columns
now use MySQL `DATETIME(6)`: the 13 event/recording/review/verification/history/audit
fields and 12 created/updated fields on the six operational tables.

DATETIME supports the UTC years 1000–9999 without TIMESTAMP's 2038 ceiling or
session-timezone conversion. Six fractional digits preserve ordering of events
within a second and match Carbon's JSON serialization. Validation applies the
range after offset conversion and separately rejects future events. Supporting
old dates does not assert that historical learner placement is known.

Calendar DATE columns, nullability, defaults, eight table names, ownership,
foreign keys, unique constraints and indexes are unchanged. No data transformation,
import, backfill or legacy table rewrite was added. Migration 000036 and every
historical migration are unchanged. Both new migrations retain forward-only
rollback guards. No development migration was applied.

## E. Credential recovery and revocation

The actual credential-changing endpoint is `POST /api/v1/auth/password/reset`.
No authenticated password-change endpoint exists. User and Guardian account
creation writes an initial password; ordinary user edits do not change passwords.

Successful reset locks the current User and reset-token row in a consistent
user-first order. A single transaction updates the password hash, increments
the durable session version, deletes all Sanctum tokens, consumes the reset link
and records the existing metadata-only success audit. Failure rolls all these
changes back. Issuance locks the same User row, commits the hashed reset link
and request audit, then queues the existing mail after commit. Responses, expiry
semantics, confirmation/length validation and generic forgot response are retained.

The shared authentication gate refreshes the current account and rejects cookie
sessions with an outdated user/version marker. Unmarked pre-checkpoint ordinary
sessions remain usable only at version zero; they cannot survive any reset or
deactivation. Health continues to reject unmarked sessions even at version zero.
Revoked cookie sessions are denied on their next protected request and the
requesting session is invalidated. This works independently of the configured
session storage driver; old stored session rows need not be deleted to deny access.

Login locks the User before token issuance and rechecks the supplied password if
the hash changed since initial verification. An old password verified just before
a reset cannot issue a token after that reset commits. Existing failure responses,
throttling and success payloads remain intact.

Parents, Sponsors and non-Staff administrators can recover and log in without
Staff records. Reset never reactivates an account or changes its role. Existing
deactivation and role-change version increments remain durable across reactivation.
Those increments now also invalidate ordinary cookie sessions, requiring fresh
sign-in; bearer role authorization still uses the current role. Current-device
logout continues to remove only its token/session and preserves other devices.
No credential material, reset link, medical narrative or contact details are
added to audit payloads.

## F. Changed files

| Area | Files |
| --- | --- |
| UTC parsing and persistence | `app/Rules/HealthInstant.php`, `app/Models/Concerns/UsesHealthUtcDates.php`, `app/Models/HealthRecord.php`, `app/Models/HealthRecordRevision.php`, `app/Models/HealthAccessLog.php` |
| Health input/context/chronology | `app/Services/HealthInput.php`, `app/Services/HealthContext.php`, `app/Http/Controllers/Api/HealthIncidentController.php` |
| Credential/session revocation | `app/Http/Controllers/Api/PasswordResetController.php`, `app/Http/Controllers/Api/AuthController.php`, `app/Http/Middleware/Authenticate.php`, `app/Providers/AppServiceProvider.php` |
| Unapplied schema | `database/migrations/2026_10_10_000037_create_school_health_records.php` |
| Safe regressions | `tests/safe/health_timestamps.php`, `tests/safe/password_recovery.php`, `tests/safe/health_mysql.php`, `tests/safe/health_mysql.ps1` |
| Reports | This file and `docs/health-safety-backend-checkpoint-1a.md` (corrected unverified production-status claim) |

## G. Tests and isolation

| Check | Unique passing checks |
| --- | ---: |
| Authorization foundation | 18 |
| Health & Safety boundaries/workflows | 36 |
| New raw-storage/HTTP timestamp regressions | 7 |
| New credential recovery/session regressions | 9 |
| New isolated MySQL date/precision regressions | 4 |
| Attendance | 18 |
| Academic structure | 15 |
| Assessment/reports/history | 18 |
| Student/Guardian/portal workflows | 12 |
| Existing frontend behavior | 33 |
| Total, excluding repeated prerequisite runs | 170 |

The existing fail-closed SQLite memory suites boot without dotenv, refuse cached
configuration/routes, replace every database connection, and use in-process
session/cache/storage and null logging. Mail is faked for recovery tests. The
existing targeted schema definitions execute only in RAM; no ordinary Artisan
migration command or persistent fixture database is used.

The MySQL launcher uses cached MySQL 8.0 and PHP 8.2 images, creates a uniquely
named, labelled, unnetworked test container, puts its database on tmpfs, publishes
no host ports, and shares only that isolated network namespace with its temporary
PHP process. Source and existing vendor mounts are read-only. The PHP bootstrap
skips dotenv and exposes only the named disposable connection at loopback; it
refuses a nonempty database. The real migration is compiled using `DB::pretend`,
without applying it. Narrow fixture DDL verifies actual MySQL DATETIME metadata,
all eight model casts, raw UTC storage, readback, JSON/view serialization and
microsecond comparisons. Tests cover 1960, 2026, 2040 and DATETIME bounds under
MySQL session timezones +00:00, +03:00 and -05:00. Every owned disposable container
was removed after verified ownership checks, including failed launcher attempts.

The first launcher attempts exposed Windows PowerShell quoting/readiness issues
and an omitted isolated array-cache definition. These were corrected; the final
MySQL run passed all four checks and cleanup. No application defect remained
from those harness failures.

Safe commands, run from `<repository>`:

```powershell
& D:\xampp\php\php.exe tests/safe/health_timestamps.php
& D:\xampp\php\php.exe tests/safe/password_recovery.php
& .\tests\safe\health_mysql.ps1
& D:\xampp\php\php.exe tests/safe/attendance.php
& D:\xampp\php\php.exe tests/safe/assessment_history.php
& D:\xampp\php\php.exe tests/safe/learner_guardian.php
node --test tests/frontend/*.test.cjs
```

PHP syntax checks cover all changed PHP files; PowerShell parsing covers the
launcher. Laravel Pint checks all 13 changed application/migration PHP files;
standalone regressions retain the existing safe-suite formatting style. Git
whitespace checks pass. No `.env.testing` or `phpunit.xml` was created.

## H. Development database safety

Read-only inspections of the existing Compose app/mysql services verified both
000036 and 000037 still pending, the User counter absent and all eight Health
tables absent. The development MySQL services were not restarted. Opaque extended
table checksums captured before implementation and after all isolated tests
matched for Users, Staff, Students, Guardians, legacy medical information,
Assessments, Assessment revisions, Attendance, sessions, Sanctum tokens, reset
tokens and the migration ledger. No learner records or secrets were printed.
Development access in this task was limited to metadata, migration status and
read-only checksums. No backup was created or restored.

## I. Review and remaining limitations

The 34 Health routes and existing authorization rules are unchanged. Regression
coverage preserves active Head/Deputy access, scoped Teacher safety information,
current active User/Staff requirements, nested ownership, and denial to System
Administrator, Parent, Sponsor, Sponsor Coordinator and Student. General learner
APIs still exclude medical content; restricted access logs remain restricted.

Deployment must remain coordinated. On the old schema, ordinary login/read APIs
can use the version-zero fallback, but successful reset and existing account
deactivation require migration 000036. Health operations require 000037. A reviewed
operator must verify a private backup and recovery readiness, pause relevant writes,
apply 000036 then the corrected 000037, verify the schema and enable the new code
before reopening those workflows. No startup migration was found in Compose or
the PHP Dockerfile. The current frontend can coexist with the additive backend;
no Health frontend or Checkpoint 1B was implemented.

Only the development target's unapplied state was independently confirmed. Any
other target must be checked before rollout. If an earlier 000037 was applied
elsewhere, do not rerun/rewrite that installed history or blindly adjust its
timestamps: stop for a separate forward migration and evidence-based data review.
Production state is not inferred from repository history.

MySQL fixture tests prove storage semantics, not a full production migration or
multi-process credential-reset concurrency stress test. Deterministic race,
single-use and transaction rollback regressions complement the reviewed user-row
lock order. Already authorized in-flight requests can finish; subsequent requests
check current account/session authorization. Staff reactivation behavior and
application-level revision immutability remain as described in Checkpoint 1A.
Infrastructure request/SQL tracing and backup access require separate controls.
The local test launcher depends on the verified cached image IDs/vendor volume;
other machines must review those fixtures and isolation before using it.

## J–K. Local commit and final Git state

The accompanying completion report records the single local commit hash and
final clean Git status. No push occurred. Migrations and subsequent implementation
remain withheld pending the user's review.
