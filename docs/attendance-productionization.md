# Attendance productionization

This work extends the authoritative `D:/mgaems` workspace on
`feature/production-ui` from checkpoint `2841ed5`. It changes daily Attendance
only, retaining the existing Students/Academics/Assessment/portal business
logic, shared shell, dialogs, responsive styles, and Light/Dark theme.

## Architecture and audit findings

The authoritative model is `AttendanceStudent`, not a separate `Attendance`
model. `attendance_students` already stores learner, class, school date,
status, recorder, and timestamps. The existing unique index
`uq_student_attendance(student_id, attendance_date)` permits one state per
learner/day; `idx_attendance_class_date` supports class/date reads. Class and
recorder foreign keys restrict deletion. The learner foreign key cascades
deletion; current learner workflows have no hard-delete endpoint.

The existing vocabulary remains `present`, `absent`, `late`, `excused`.
No record is a separate absence of data, never an inferred `absent` status.
Existing bulk submissions used `updateOrCreate`; corrections were intended
but could overwrite stored class context. Calendar dates accepted arbitrary
date/timestamp strings and future dates. The roster UI defaulted unrecorded
learners to present, loaded only the first 100 learners from the general
Students list, and tolerated failure of the existing-records request.

| Classification | Finding |
| --- | --- |
| Already supported | Historical class/date columns, learner/day uniqueness, bulk writes/corrections, four statuses, class teacher and unique user/staff link, audit infrastructure, leadership route roles, child-owned portal attendance. |
| Partially supported | Atomic bulk persistence, correction audit, read filtering, school-date validation, response privacy, roster loading/error states, missing-record visibility. |
| Missing and implemented | `AttendanceController::myClasses`, scoped roster endpoint, centralized Class Teacher authorization on reads/writes, full-payload membership validation, strict school dates, preserved correction context, bounded history pagination. |
| Unsafe and corrected | Broad teacher access, subject/class responsibility confusion in controller commentary, cross-class learner injection, class reassignment during upsert, implicit present selections, incomplete rosters and duplicate UI submissions. |
| Deferred | Complete historical enrollment reconstruction, submission/finalization/locking entities, legacy-data reconciliation, live browser and concurrent MySQL write verification. |

Read-only inspection of the running MySQL schema confirmed the class/date
columns, learner/day unique index, and `staff.user_id` unique index. No schema
change or migration is necessary; historical migrations remain untouched.

## Ownership, security, and privacy

`AttendanceAccess` centralizes the policy. An active ordinary teacher must
have an active teaching Staff record linked by `staff.user_id` to the
authenticated user. Only classes whose `class_teacher_id` equals that Staff
ID are permitted. Name/email matching and client-supplied staff IDs are never
used. Subject-teacher allocation grants no daily attendance permission.

System administrator, head teacher, and deputy head teacher retain oversight
across configured classes without needing a Staff link. Other roles are
denied. Existing Sanctum and role middleware remain in place on every staff
Attendance route. Teachers with missing/ineligible staff links fail closed;
linked teachers without class ownership receive an honest empty class list.

Explicit foreign-class requests are refused. Unfiltered, student-filtered,
and summary reads always scope attendance by its stored class through the
same permitted-class policy. A current class-teacher reassignment changes
who may administer that class's historical attendance; leadership retains
oversight. Parent/Sponsor own-learner endpoints use their separate ownership
rules and do not depend on Class Teacher authorization.

Class selections expose only ID/name. Learner roster/history responses contain
only identifiers, admission number, names, recorded status/date/class, and
operational eligibility information. HR/contact, guardian, authentication,
recorder, and audit timestamp fields are omitted. An existing other-class
record for a current learner appears unavailable without exposing its status,
record ID, or other class details.

## API contracts and submission semantics

- Existing `GET /api/v1/attendance/my-classes` is now implemented. It returns
  permitted classes and metadata for the school-local current date/timezone,
  existing status choices, and a 1000-record bulk request limit.
- New `GET /api/v1/attendance/roster?class_id=...&attendance_date=...` returns
  the authorized class/date, eligible learners, retained historical rows,
  status counts, recorded/unrecorded/unavailable counts, and an operational
  recording state. This is not a fabricated class submission/finalization flag.
- Existing `POST /api/v1/attendance/students` remains one bulk request. IDs
  must be distinct, valid, and match the authorized class/date workflow. All
  validation finishes before any record changes; mixed-class payloads are
  rejected entirely, including leadership payloads. Unsubmitted learners are
  unchanged; omissions do not delete or mark learners absent.
- New rows require current active membership in the requested class and a
  date on/after admission and the latest recorded placement/transfer change.
  This avoids inventing past membership using today's class. Existing rows
  are correctable only through their stored class snapshot, including after
  promotion, transfer-out, or exit. An existing learner/date row in a different
  class cannot be overwritten or moved, even by leadership.
- Transactions lock the requested class, linked teacher where applicable,
  all learners in ID order, existing attendance rows, and placement history.
  Learner locks serialize requests through this endpoint and existing Student
  promotion/transfer operations. Locked reads avoid using an old transaction
  snapshot after waiting for a concurrent placement change. Existing database
  uniqueness remains authoritative; bounded deadlock retries are used.
- Corrections change status/recorder only. IDs, class, date, and original
  creation timestamps remain. Identical retries do not rewrite actor/timestamps
  or create redundant audit records. Concurrent valid corrections serialize;
  the last committed change wins. No optimistic revision/conflict or approval
  workflow is invented.
- Responses return shaped attendance rows and `meta.created/updated/unchanged`.
  HTTP status is 201 when new rows are created, otherwise 200.
- Existing history `GET /attendance/students` retains class/student/date
  filters and adds bounded SQL pagination (`page`, `per_page`, maximum 100,
  default 25), returning `data` and `meta.page/per_page/total`.
- Existing summary `GET /attendance/students/summary` retains required date
  ranges and class/student filters. It counts recorded statuses only and
  retains the staff endpoint's present-record rate. Zero records return a
  null rate. Parent Portal's existing present-plus-late percentage is unchanged.

Dates are strict `YYYY-MM-DD` strings, validated as real dates and no later
than the school-local current date from `config('app.timezone')`
(`Africa/Nairobi`). Timestamp/offset inputs are rejected rather than converted
to another day. No weekend/holiday rules are invented. The model writes its
DATE attribute as date-only while preserving timestamp precision for normal
created/updated fields, including in the SQLite verification environment.

## Historical context and operational roster

Attendance retains its stored class ID and school date when the learner's
current class changes. Class names displayed in history come from that stored
class relation, not the learner's current class relation. The class foreign key
prevents deletion of that referenced class. Existing class labels can still be
renamed; this schema does not store a separate historical label snapshot.

The roster combines eligible current active learners with actual attendance
records for the selected historical class/date. Former learners with records
remain visible and correctable. Current learners whose admission or latest
placement change is after the date are excluded from new entry. A same-day
other-class record prevents new entry without leaking that record's details.
The response is complete for this operational scope, without the old 100-row
Students paginator truncation.

This is deliberately not a reconstructed historical enrollment register.
Former learners with no attendance record are not invented into a past roster,
and no absence is inferred. Recording-state/count labels describe the returned
roster, not proof that every historical class member has been submitted.

## UI, audit, and integration

`attendance.html` loads extracted `public/assets/attendance.js`. Class
selectors use the scoped endpoint; school date defaults/maxima come from the
server rather than UTC `toISOString`. Accessible tabs separate Record/Review,
paginated History, and Summary. Each roster row shows its saved status and
an explicitly labeled selection. New records begin with no selection.

The explicit mark-unrecorded-present action requires confirmation and does
not alter existing or unavailable rows. Saving sends one request for selected
eligible rows. Busy controls prevent duplicate submits or selection changes;
failed saves retain selections and display shared field errors. Corrections
and discarding unsaved selections use shared confirmations. Loading/error/retry
states, keyboard controls, escaped API values, responsive tables/forms, toasts,
and honest empty/zero-record summaries use existing shared utilities/styles.
No shell/theme/CSS system changes or fictional attendance data are introduced.

The existing `RECORD_ATTENDANCE` audit event is recorded inside the same
transaction as changed rows. Metadata includes class, school date, affected
counts, and attendance record IDs with old/new statuses. Actor identity is
provided by the existing logger. Names, contacts, and full learner payloads
are not logged. Audit failure rolls back attendance changes.

ParentPortalController and SponsorPortalController are untouched. Parent
attendance remains own-child scoped, with the same summary and date/status
history response. Tests cover promotion, ownership denial, and revocation after
unlink. Students, Academics, Assessment, Report Cards, Guardians, Sponsorship,
HR, and other domain controllers/business rules remain unchanged.

## Files and safe verification

Changed: `AttendanceController.php`, `AttendanceStudent.php`,
`public/attendance.html`, and `routes/api.php`.

Added: `AttendanceAccess.php`, `AttendanceRecordResource.php`,
`public/assets/attendance.js`, `tests/safe/attendance.php`,
`tests/frontend/attendance.test.cjs`, and this report.

```text
php tests/safe/attendance.php
php tests/safe/learner_guardian.php
php tests/safe/academic_structure.php
node --test tests/frontend/attendance.test.cjs tests/frontend/academic.test.cjs tests/frontend/dialog.test.cjs tests/frontend/shell.test.cjs
php artisan route:list --path=api/v1/attendance --json
git diff --check
```

Executed results: 18 Attendance, 12 learner/guardian, and 15 Academic Structure
checks pass using guarded in-memory SQLite. All 25 frontend/shared-dialog/shell
checks pass. The PHP runner skips dotenv and replaces all connection
definitions before providers boot; it refuses anything except SQLite memory.
It does not run migrations or use the database-refreshing PHPUnit suites.

PHP/JavaScript syntax and diff whitespace checks pass. All five Attendance
routes retain Sanctum and the expected role middleware. Twenty-one local HTML
assets/links and 14 shell links resolve; three inline scripts parse. Five
HTTP-served Attendance/shared files exactly match the workspace, and five
anonymous Attendance/Parent Portal API requests return 401. Repository source
conflict-marker and excluded-feature/fake-data addition scans pass. No schema,
test environment/configuration, or unrelated domain files were changed.
These HTTP and schema checks are read-only. Browser rendering and real
concurrent MySQL writes are not claimed as verified by DOM/in-memory tests.

## Genuine remaining debt

- Old unrestricted upserts may already have overwritten class context or
  recorded invalid membership/dates. No data is silently repaired; reviewed
  reconciliation would require independent evidence.
- Newly missing historical attendance cannot be backfilled for a former class
  merely from current placement. A complete historical roster would require
  reviewed enrollment/history semantics, especially exits without dated
  history and same-day movements; no enrollment redesign is introduced here.
- No formal class/day submission, approval, finalization, or historical cutoff
  exists. Record counts describe data only; authorized corrections remain open.
- Attendance's existing learner FK cascades a future hard learner deletion.
  Current lifecycle endpoints preserve learner records. Any future hard-delete
  feature must review this history constraint rather than relying on that cascade.
- Stored class IDs persist; renamed class labels are not immutable historical
  snapshots. Concurrent corrections use last committed status with audit deltas,
  rather than optimistic edit-conflict detection.
- Bulk requests are bounded at 1000 entries. A larger operational roster would
  require explicit reviewed batching; it is not silently truncated. Browser
  rendering/accessibility and concurrent MySQL writes remain manual verification
  items beyond the safe automated checks.
