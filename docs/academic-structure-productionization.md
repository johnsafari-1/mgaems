# Academic Structure productionization

This work extends the authoritative `D:/mgaems` workspace on
`feature/production-ui`, starting from learner/guardian checkpoint `0904df3`.
It reuses the shared shell, dialogs, design tokens, and Light/Dark theme.
There are no schema changes, migrations, development-data repairs, or changes
to Assessment, Attendance, portal, Sponsorship, or HR business logic.

## Current architecture and audit classification

| Concept | Existing representation | Audit finding and resulting behavior |
| --- | --- | --- |
| Academic year | `academic_years`, `AcademicYear` | Partially supported: CRUD/current flags existed; merged date validation and safe activation/deletion are now enforced. |
| Term | `terms`, `Term`, owning academic year | Partially supported: containment, sibling overlap, immutable ownership, historical dates, and current-year alignment are now enforced. |
| Class / Grade | `classes`, `SchoolClass` | Already configurable; existing name, primary/junior level, sequence, capacity, learners, and class teacher remain. No fixed grade catalogue is introduced. |
| Learning Area / Subject | `subjects`, `Subject` | Already the authoritative assessable entity. Optional `learning_area` is grouping/category text, not a second entity. Existing active/inactive status supports retirement. |
| Curriculum offering | Unique `class_subjects(class_id, subject_id)` pivot | Already supported in schema/API writes, partially exposed in the UI. Listing, class-based management, and safe removal are now implemented. No separate model or offering table is needed. |
| Class teacher | `classes.class_teacher_id` | Existing responsibility is separate from subject teaching. New selections require active teaching staff; responses expose names/IDs only. |
| Subject teacher | Unique `class_subject_teacher(class_id, subject_id, term_id)` | Existing term-specific allocation and assessment authorization remain. New allocations now require an active offered subject and eligible teacher. |
| Timetable | `timetable_entries`, `TimetableEntry` | Existing recurring weekly schedule and teacher-conflict checks remain; class-conflict protection and offered-subject validation were missing and are implemented. |
| Assessment | Learner + subject + term + type | Existing scores, performance ratings, remarks, and assignment-based teacher authorization remain. Class is request/current-learner context, not an assessment snapshot. |

**Already supported:** configured classes/subjects, calendar records, offerings
pivot and uniqueness, term-specific teacher allocation uniqueness, teacher
timetable checks, subject retirement, audit service, leadership middleware,
assessment/report-card relationships, shared themes/dialogs.

**Partially supported and strengthened:** calendar integrity, dependency-aware
removals, active teaching-staff selection, staff response privacy, offering
workflows, escaped output, accessible forms/tabs, validation/error handling,
and transactionally recorded audit events.

**Missing and implemented:** class offering read endpoint, minimal academic
staff options endpoint, class timetable overlap prevention, teacher-allocation
offering validation, ownership-aligned period activation, and practical
class/subject editing and offering-management controls.

**Deferred to Assessment/CBE:** outcomes, criteria/indicators, structured core
competencies, curriculum versions, immutable assessment placement/offering
context, and the related historical authorization design.

**Not required:** duplicate LearningArea/offering models, a national curriculum
or grade catalogue, timetable rebuilding, rooms, or an additional audit system.

## API and integrity rules

- New authenticated `GET /api/v1/class-subjects?class_id=...` lists a real
  class's subjects, including retired subjects already offered. It returns only
  subject ID, name, code, grouping, and status, without pivot metadata.
- New leadership-only `GET /api/v1/academic/staff-options` returns eligible
  active teaching staff as `{id, display_name}`. The UI no longer loads the
  general HR staff endpoint to populate academic selections.
- Existing class list/create/update responses retain the class identifiers,
  name, level, sequence, capacity, and `class_teacher_id`; class teacher data
  is limited to ID/first/last names. Learner and offering counts are included.
  Assignment/timetable staff relations use the same minimal name fields.
- Year and term edits validate the persisted and submitted dates together.
  Start must be on/before end. Terms must fit their owning year and may not
  overlap sibling terms in the existing single school calendar (inclusive
  endpoints). Years cannot be shortened around existing terms.
- A term cannot move to another academic year. Dates are protected once
  assessments, report cards, or learner placement history reference the term;
  labels remain editable. No term count or naming convention is prescribed.
- Activating a term atomically activates its owning year and clears other
  current flags. Activating a year clears current terms from other years,
  allowing no current term until one is selected. Current periods cannot be
  deleted. Activation changes use ordered calendar row locks.
- New offerings require valid classes and active subjects. Existing pivot
  uniqueness remains authoritative. Duplicate requests return usable errors.
  Detach is refused for assignments, timetable entries, or assessment history.
- New subject allocations require a real class/term, an active offered subject,
  and active teaching staff. Existing class/subject/term uniqueness is retained.
  Removal is refused when assessments or a matching recurring timetable entry
  depend on the allocation, preserving existing teacher authorization records.
- New timetable lessons require an active offered subject, eligible teacher,
  day 1-7, valid `H:i` times, and start strictly before end. Same-day teacher
  and class overlaps are rejected; adjacent slots are allowed. Parent class,
  subject, and staff locks serialize conflicting writes through these workflows.
  Explicit lesson removal retains the existing recurring-schedule semantics
  and records an audit event.
- Class deletion refuses current learner records, historical placements,
  offerings, allocations, or timetable entries. This prevents the existing
  promotion foreign keys from silently losing class references and addresses
  the class-deletion debt identified in the prior learner/guardian report.
- Subject deletion refuses offerings, assignments, timetable, or assessments.
  Inactivation retains all existing records and blocks new configuration.
  Period deletion refuses assignments, assessments, report cards, and placement
  history; year deletion refuses terms. Unused records remain explicitly removable.
- `AcademicIntegrity` wraps writes and the existing `AuditLogger` in one
  transaction, with bounded database deadlock retries and friendly unique/FK
  conflict responses. Assessment dependency checks include current class and
  recorded promotions/transfers because assessments lack stored class context.
  This deliberately errs toward retaining history.

## UI, authorization, and integration

The academic page uses `public/assets/academic.js`, the existing shell, and
shared `MGAEMS.openModal`, `confirmAction`, and `showFormErrors`. It has six
leadership sections: years, terms, Classes / Grades, Learning Areas / Subjects,
subject teachers, and timetable. Class rows open offered-learning-area
management; offerings do not become a second curriculum page.

Forms use real API selections, explicit labels, field errors, save guards, and
confirmations. Subject selectors for allocations/lessons load only active
offerings for the selected class, with loading/failure/retry states. Tabs
support keyboard navigation. Tables/forms use existing responsive styles;
API output is escaped. Independent panel failures do not erase other panels,
and stale responses are rejected. No page-specific CSS or fictional records
are introduced.

Existing Sanctum and role middleware are unchanged. Calendar mutations remain
restricted to system administrator/head teacher. Structure, allocations,
timetable administration, and the new staff selector remain restricted to
system administrator/head teacher/deputy head teacher. Teachers receive
read-only configuration and cannot gain administration rights via allocations.
Parents/sponsors still land in their own portals; metadata API reads retain
their existing broad authenticated policy.

Significant create/edit/activate/delete, offering, allocation, and timetable
operations use the existing audit log. Audit failures roll back configuration
changes. Year activation records previous current-year IDs; term activation
records affected year/term changes. No contacts, contracts, documents, or
authentication fields are returned by academic staff selectors/relations.

Student current-class/history semantics, guardian links, Attendance,
Assessment, Report Cards, Sponsorship, HR, and Parent/Sponsor portal controllers
are untouched. Assessment continues using the existing teacher-assignment
relationship and historical performance-rating strings. Response minimization
retains identifiers/names consumed by current repository pages. Compatibility
is checked in memory and by unchanged module code, not by claiming a full live
regression test of every module.

## CBE boundary, inclusivity, and next phase

The resulting structure describes configured school periods, class offerings,
eligible teachers, and recurring lessons. It prepares a coherent foundation
for later Assessment work; it does not claim KICD certification or compliance.

Current assessments accept class context, subject, term, continuous/end-term
type, score, `competency_rating`, and remarks. That rating represents existing
performance/proficiency levels. It is not a structured core competency and is
not relabeled. Learning outcomes, criteria/indicators, and Kenya's core
competencies are not structured entities today and were not added here.

Precise remaining work:

1. Design immutable assessment class/offering context and historical teacher
   authorization. Current authorization follows the learner's current class;
   promotion can change access to older assessments. Conservative removal
   checks cannot reconstruct an exact assessment-time class if placement data
   is absent, and may protect more offerings than strictly necessary.
2. Review assessment recording alongside offering/assignment changes. Existing
   assessment writers do not participate in the new parent-lock protocol;
   offering removal versus a concurrent first assessment is not a fully
   serialized cross-module invariant. No existing data was silently repaired.
3. Decide curriculum/outcome/criterion/core-competency versioning, rating
   semantics, and report-card migration through an explicit Assessment design.
   Subject retirement currently governs new academic configuration; existing
   Assessment active-subject/staff and closed-period policies are unchanged.
4. Offerings are class-scoped, not term/version/learner-scoped. Timetable entries
   are recurring and have neither term scope nor immutable historical versions;
   removed lessons are represented in audit records, not a schedule-history
   entity. Term-specific allocation removal is therefore conservative where a
   recurring lesson still references its teacher/class/subject.
5. Preserve future differentiated curriculum options. Names and offerings are
   data driven without a national catalogue or new grade restrictions. The
   existing primary/junior enum and single-calendar overlap rule remain;
   learner-specific offerings, differentiated calendars, and special-needs
   arrangements require reviewed future extensions rather than hard-coded lists.
6. Attendance has a pre-existing `/attendance/my-classes` route targeting a
   missing `AttendanceController::myClasses` method, and broader existing
   attendance authorization. Class teachers remain distinct; repair and
   authorization changes belong to the Attendance phase.
7. Legacy inconsistent periods/allocations are not automatically reconciled.
   Newly enforced validation can require a reviewed configuration correction.
   Live concurrent MySQL writes and browser form/rendering checks remain
   verification items beyond the in-memory/DOM checks.

## Safe verification

```text
php tests/safe/academic_structure.php
php tests/safe/learner_guardian.php
node --test tests/frontend/academic.test.cjs tests/frontend/dialog.test.cjs tests/frontend/shell.test.cjs
php artisan route:list --path=api/v1 --json
git diff --check
```

The new guarded PHP runner skips dotenv and replaces all connection definitions
before providers boot. It requires explicit in-memory SQLite, creates tables
only in that process, and never runs repository migrations. No development
database write/reset/reseed, destructive PHPUnit suite, test environment file,
or PHPUnit configuration change is part of verification.

Results: 15 Academic Structure checks, 12 learner/guardian checks, and 15
frontend/shared-dialog/shell checks pass. Coverage includes calendar ranges and
activation, staff eligibility/privacy, offerings, allocations, both timetable
overlaps, history/report-card protection, unused deletion, audit rollback,
and unchanged teacher assessment authorization. Frontend checks use a DOM
interface harness, not a browser.

PHP/JavaScript syntax and diff whitespace checks pass. All 29 academic routes
retain expected authentication/roles; 24 local HTML assets/links and 14 shell
links resolve, and four inline scripts parse. Five HTTP-served academic/shared
files exactly match the workspace; eight anonymous academic API requests
return 401. Conflict-marker and excluded feature/catalogue/fake-data addition
scans pass, with no prohibited identifier or schema/test-config introduction.
Read-only Docker schema inspection confirmed existing tables and uniqueness
constraints. Browser rendering/live interaction is not claimed as verified.
