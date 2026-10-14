# Teaching & Learning Workspace Blueprint

## Scope and guardrails

This workspace extends the existing Laravel API, static HTML, vanilla JavaScript,
and shared MGAEMS design system. It does not replace the academic calendar,
classes, subjects, class offerings, term-specific subject-teacher assignments, or
recurring timetable.

No national curriculum catalogue, learning outcome, or other curriculum content
is seeded by MGAEMS. Planning fields are entered by staff and the application
does not claim official CBC alignment or validate curriculum-source authority.
`Stream` is not used: its database table was removed by the existing migration.

## Existing foundation reused

| Need | Existing authoritative record | Workspace use |
| --- | --- | --- |
| School year | `academic_years` / `AcademicYear` | Contains event dates and owning terms. |
| Term | `terms` / `Term` | Contains term-linked events and scheme assignments. |
| Class and learning area | `classes`, `subjects`, `class_subjects` | Defines real school offerings. |
| Teaching responsibility | `class_subject_teacher` / `ClassSubjectTeacher` | The scheme owner and teacher authorization anchor. |
| Weekly lessons | `timetable_entries` | Remains a recurring schedule only; it is not a calendar event or scheme plan. |
| Authorization | Sanctum, `EnsureRole`, active Staff links | Preserves role middleware and active teaching-staff checks. |
| Auditing | `AuditLogger` | Records significant calendar and teaching-document mutations in the same transaction. |

## First-slice data model

### Calendar events

`academic_events` is a dated, all-day school event/activity record. It belongs to
an academic year and may additionally belong to one of that year's terms.

| Field | Purpose |
| --- | --- |
| `academic_year_id` | Required owning school year. |
| `term_id` | Optional term context; must belong to the selected year. |
| `title`, `description` | Staff-entered event details. |
| `event_type` | One of `academic_activity`, `assessment`, `meeting`, `closure`, or `school_event`; these are operational categories, not curriculum claims. |
| `starts_on`, `ends_on` | Inclusive event dates, contained by the owning period. |
| `created_by`, `updated_by` | Accountability references plus normal timestamps. |

Events use restrictive foreign keys. Year/term date edits and deletions retain
events rather than silently moving or deleting them.

### Schemes of work

`schemes_of_work` has one document per `class_subject_teacher` allocation. This
keeps a plan in the actual class, learning-area, teacher, and term context
already used by assessment authorization. It has staff-entered `title`, optional
`curriculum_reference`, workflow state, creator/reviewer references, and
timestamps.

`scheme_of_work_weeks` is the ordered weekly plan child. Each row stores the
week number, optional date range, strand, sub-strand, learning outcomes,
learning activities, and resources. These are free-text planning fields, not a
shipped or verified curriculum catalogue. Week dates, when supplied, must fall
inside the allocation's term.

Workflow states are `draft`, `submitted`, `returned`, and `approved`:

1. An assigned teacher creates and edits a draft or returned scheme.
2. The teacher submits only after at least one complete weekly plan exists.
3. Leadership approves it or returns it with a review note.
4. A returned scheme can be edited and resubmitted. Submitted and approved
   content is read-only to the teacher.

The initial slice intentionally does not claim immutable document versions or
official curriculum verification. Those belong in the later review/approval
and source-governance phases.

## API

All endpoints are under `/api/v1`, authenticated with Sanctum, and return the
existing `{data: ...}` or standard validation/error shapes.

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /academic-events` | Authenticated users | Read school events; optional year, term, and date-range filters. |
| `POST /academic-events` | System Administrator, Head Teacher | Create an event. |
| `PATCH /academic-events/{event}` | System Administrator, Head Teacher | Update an event. |
| `DELETE /academic-events/{event}` | System Administrator, Head Teacher | Remove an event. |
| `GET /schemes-of-work/context` | Leadership and Teacher | Returns leadership assignment options or the caller's real allocations. |
| `GET /schemes-of-work` | Leadership and Teacher | Lists school-wide documents for leadership or only the teacher's assigned documents. |
| `GET /schemes-of-work/{scheme}` | Leadership and assigned Teacher | Reads a document and weekly plans. |
| `POST /schemes-of-work` | Leadership and Teacher | Creates a draft in an authorized allocation. |
| `PATCH /schemes-of-work/{scheme}` | Leadership and assigned Teacher | Edits an editable draft/returned document. |
| `POST /schemes-of-work/{scheme}/weeks` | Leadership and assigned Teacher | Adds a weekly plan. |
| `PATCH /schemes-of-work/{scheme}/weeks/{week}` | Leadership and assigned Teacher | Edits a weekly plan. |
| `DELETE /schemes-of-work/{scheme}/weeks/{week}` | Leadership and assigned Teacher | Removes a weekly plan. |
| `POST /schemes-of-work/{scheme}/submit` | Assigned Teacher | Moves a complete plan to review. |
| `POST /schemes-of-work/{scheme}/review` | System Administrator, Head Teacher, Deputy Head Teacher | Approves or returns a submitted plan. |

Teachers are authorized from the authenticated user's active teaching `Staff`
record and the exact allocation. Class-teacher ownership, client-supplied staff
IDs, and timetable rows never grant scheme rights. Leadership receives
school-wide oversight; only the teacher submission action is teacher-owned.

## UI

The existing Academic Management page gains a responsive read-only/managed
**Calendar events** tab. Teachers can read events; System Administrators and
Head Teachers can add, edit, and delete them using the shared accessible modal,
form error, confirmation, and escaped-rendering patterns.

`schemes-of-work.html` is a dedicated responsive Teaching & Learning page. It
uses the shared shell and new page-local CSS/JavaScript. Teachers see only real
subject-teacher allocations and their own scheme documents. Leadership can
inspect all documents and review submitted plans. The page makes the
staff-entered, unverified nature of curriculum references explicit.

## Permissions

| Role | Calendar events | Schemes of work |
| --- | --- | --- |
| System Administrator | Read/manage | Read/create/edit, review |
| Head Teacher | Read/manage | Read/create/edit, review |
| Deputy Head Teacher | Read | Read/create/edit, review |
| Teacher | Read | Read/create/edit only in exact assigned allocations; submit own work |
| Parent/Guardian, Sponsor, Student, Sponsor Coordinator | Read API only where existing authenticated metadata access permits it | No access |

Existing route middleware remains the first authorization boundary. The scheme
service additionally verifies active account, active teaching staff, and exact
assignment ownership on every document operation.

## Implementation sequence

1. Add calendar-event and scheme/week migrations, models, relations, scoped
   access service, controllers, routes, validation, transactional audit events,
   and dependency protections.
2. Extend Academic Management with event management and add the dedicated
   Scheme of Work page/navigation using the existing design tokens.
3. Add guarded SQLite-only backend checks and DOM-interface frontend checks.
4. Run isolated tests, syntax/route checks, whitespace checks, then commit the
   checkpoint locally. Do not migrate or alter the running MySQL database or
   Docker containers.

## Subsequent modules

1. Lesson Plans linked to an approved scheme week, with a separate review
   history.
2. Records of Work linked to planned weeks and actual delivery dates.
3. Homework and assignments tied to authorized allocations and learner scope.
4. Exam Paper Studio, retained artifacts, printing, and PDF export.
5. AI assistance behind source disclosure, human confirmation, and audit
   records; it must not generate or present unverified official curriculum
   content.
6. Teaching-document versioning, review queues, approval delegation, and
   notification policy after the school's governance requirements are defined.
