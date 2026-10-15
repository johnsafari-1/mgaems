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

## Fourth-slice data model: Exam Paper Studio and review

`exam_papers` belongs to the same `class_subject_teacher` allocation as all
other teaching documents. It records a staff-entered examination type, title,
instructions, duration, in-term examination date, workflow state, reviewer
metadata, publication time, and retained revision sequence. Its lifecycle is
`draft`, `submitted`, `returned`, `approved`, `published`, and `archived`.

`exam_paper_sections` and `exam_paper_questions` provide ordered paper
structure. Questions support short-answer, structured, and multiple-choice
types; marks, options, answer keys, and marking guidance are structured fields.
Only multiple-choice questions carry options, and their answer key must match
one recorded option. `exam_paper_attachments` stores only metadata for approved
PNG/JPEG/WebP diagrams in the private filesystem. Files are downloaded through
an allocation-authorized staff endpoint, never a public storage URL.

`exam_paper_revisions` retains a hash-checked snapshot for submitted, reviewed,
and published paper transitions. `teaching_document_revisions` extends retained
approval snapshots to schemes, lesson plans, records of work, and exam papers.
The unified leadership queue reviews submitted documents without exposing them
to parents, learners, sponsors, or unauthorised staff.

## API — Exam, Review, and AI drafts

Exam Paper Studio endpoints are all under `/api/v1/exam-papers`. Staff can read
context/list/detail data, create or edit draft/returned papers, manage sections
and questions, duplicate questions, upload/download approved private images,
submit a paper, and download a learner paper PDF or a staff-only marking-scheme
PDF. Leadership alone may review or publish. The learner paper PDF deliberately
omits answer keys and marking guidance; the marking-scheme endpoint remains
inside staff role middleware.

`GET /teaching-review` lists submitted schemes, lesson plans, records of work,
and examination papers for leadership. `POST /teaching-review/{type}/{id}`
approves or returns a submitted item and records a retained review snapshot.

The optional AI Teaching Assistant is exposed only to staff through
`GET /ai-teaching/status`, `POST /ai-teaching/drafts`, and
`POST /ai-teaching/runs/{run}/accept`. It is disabled by default. No key is sent
to the browser or persisted in a generation run. Inputs containing learner,
family, health, contact, credential, or similar sensitive fields are rejected.
Generated content is returned as a labelled structured draft and cannot create,
update, approve, or publish a teaching document automatically. Staff must review
and manually save any useful material.

The server-side provider selection is `MGAEMS_AI_DRIVER=disabled|mock|http`.
The HTTP provider requires server-only `MGAEMS_AI_ENDPOINT`, `MGAEMS_AI_KEY`,
and optional `MGAEMS_AI_MODEL`; it returns a safe unavailable response when
configuration is absent. The `mock` driver exists for non-production testing.

## MySQL integration boundary

Migrations `2026_10_15_000040` through `000042` are pending repository changes.
They have been exercised only against fresh in-memory SQLite during development.
The current `mgaems-app` container is PHP 8.2/Laravel 10 while this repository
requires PHP 8.3/Laravel 13, so it must not be used to apply migrations.

Before any change to the existing `mgaems-mysql` volume or `mgaems-app`
container, take an encrypted/restorable `mysqldump` backup, restore it into a
separate disposable MySQL 8.0 container and volume, run migration planning and
the pending migrations there using the PHP 8.3 upgrade image, then record the
table/row-count/integrity results and rollback procedure. Applying migrations,
rebuilding the running application container, or resetting the existing volume
requires explicit approval after that rehearsal.

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

## Second-slice data model

Both documents are children of the same `class_subject_teacher` allocation, so
class, learning area, teacher, and term context stay consistent with scheme and
assessment authorization. The allocation row is the historical context; deleting
an allocation that owns teaching documents is refused.

### Lesson plans

`lesson_plans` stores structured planning fields, never one opaque document:

`class_subject_teacher_id`, optional `scheme_of_work_week_id` (must belong to the
same allocation), optional `duplicated_from_lesson_plan_id`, `title`,
`lesson_date`, `duration_minutes`, `strand`, `sub_strand`,
`specific_learning_outcomes`, `key_inquiry_questions`,
`teaching_learning_resources`, `introduction`, `lesson_development`,
`conclusion`, `learning_activities`, `assessment_approach`,
`teacher_reflection`, workflow status, review fields, and timestamps.

`lesson_date` must fall inside the allocation's term. Duplication creates an
independent draft from an existing plan, resets the reflection, records the
source plan, and audits the copy.

### Records of work

`records_of_work` records teaching actually delivered: the owning allocation, an
optional linked `lesson_plan_id` from the same allocation, `taught_on`,
`content_covered`, `learning_activities_conducted`, `work_completed`,
`work_not_completed`, `reasons_for_deviations`, `teacher_observations`,
`follow_up_actions`, workflow status, review fields, and timestamps.

A record is created only by an explicit teacher write. Nothing in the system
infers delivery from a plan, a timetable slot, or a date passing: a lesson plan
reports `has_record_of_work` only when a real record exists, and `taught_on`
must also fall inside the allocation's term.

Workflow for both documents is `draft`, `submitted`, `returned`, and
`approved`, with the same ownership rules as Schemes of Work. A linked scheme
week cannot be deleted while a lesson plan references it.

## API — Lesson Plans and Records of Work

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /lesson-plans/context` | Leadership and Teacher | Authorized assignments plus schemes with weekly entries for linking. |
| `GET /lesson-plans` | Leadership and Teacher | Lists permitted plans; term, class, status, and date-range filters. |
| `GET /lesson-plans/{lessonPlan}` | Leadership and assigned Teacher | Reads one structured plan. |
| `POST /lesson-plans` | Leadership and Teacher | Creates a draft in an authorized allocation. |
| `PATCH /lesson-plans/{lessonPlan}` | Leadership and assigned Teacher | Edits an editable draft/returned plan. |
| `POST /lesson-plans/{lessonPlan}/duplicate` | Leadership and assigned Teacher | Copies a plan into a new editable draft. |
| `POST /lesson-plans/{lessonPlan}/submit` | Assigned Teacher | Moves a plan to review. |
| `POST /lesson-plans/{lessonPlan}/review` | System Administrator, Head Teacher, Deputy Head Teacher | Approves or returns a submitted plan. |
| `GET /lesson-plans/{lessonPlan}/pdf` | Leadership and assigned Teacher | Printable PDF export through the existing dompdf utility. |
| `GET /records-of-work/context` | Leadership and Teacher | Authorized assignments plus permitted lesson plans for linking. |
| `GET /records-of-work` | Leadership and Teacher | Lists permitted records; term, class, status, and date-range filters. |
| `GET /records-of-work/{recordOfWork}` | Leadership and assigned Teacher | Reads one delivery record. |
| `POST /records-of-work` | Leadership and Teacher | Records delivery in an authorized allocation. |
| `PATCH /records-of-work/{recordOfWork}` | Leadership and assigned Teacher | Edits an editable draft/returned record. |
| `POST /records-of-work/{recordOfWork}/submit` | Assigned Teacher | Moves a record to review. |
| `POST /records-of-work/{recordOfWork}/review` | System Administrator, Head Teacher, Deputy Head Teacher | Approves or returns a submitted record. |
| `GET /records-of-work/{recordOfWork}/pdf` | Leadership and assigned Teacher | Printable PDF export through the existing dompdf utility. |

A document belonging to a different allocation is not distinguishable to a
teacher: the same 404-not-200 convention as other workspace reads is used, and
no existence is disclosed.

## UI — Lesson Plans and Records of Work

`lesson-plans.html` and `records-of-work.html` are dedicated responsive
Teaching & Learning pages using the shared shell, dialogs, toasts, form-error
contracts, and `teaching-documents.css` (navy/teal tokens, light and dark
themes, mobile reflow, touch targets, focus rings).

Lesson Plans offer term/status/date-range filters, search, a structured create
and edit dialog for every planning field, optional scheme-week linking, plan
detail with all sections, duplication, submission, leadership approve/return,
and a PDF download. Records of Work offer the same filters plus an explicit
"actual teaching date", optional lesson-plan linking, delivered-content
sections, deviation and follow-up fields, review workflow, and PDF export. Both
pages state in the interface that a plan never marks a lesson as delivered.

## Permissions — Lesson Plans and Records of Work

| Role | Lesson Plans | Records of Work |
| --- | --- | --- |
| System Administrator | Read/create/edit (school-wide), review, export | Read/create/edit (school-wide), review, export |
| Head Teacher | Read/create/edit (school-wide), review, export | Read/create/edit (school-wide), review, export |
| Deputy Head Teacher | Read/create/edit (school-wide), review, export | Read/create/edit (school-wide), review, export |
| Teacher | Read/create/edit only in exact assigned allocations; submit and duplicate own work; export | Read/create/edit only in exact assigned allocations; submit own work; export |
| Parent/Guardian, Sponsor, Student, Sponsor Coordinator | No access | No access |

Administrative roles receive school-wide visibility but not teacher-only
submission rights; a leadership member cannot submit a teacher's document for
review. Every significant write and status transition uses the existing
`AuditLogger` inside the same transaction.

## Third-slice data model: Homework and assignments

`homeworks` belongs to the same historical `class_subject_teacher` allocation.
It stores a staff-entered title, learner instructions, learning outcomes,
optional total marks, assigned and due dates inside the allocation's term,
expected submission method, optional links to one lesson plan and one scheme
week from that allocation, staff-only notes, creator and lifecycle timestamps.
Its states are `draft`, `published`, `closed`, and `archived`.

`homework_questions` is an ordered child table with short-answer, structured,
and multiple-choice question types, optional diagram reference and marks, and
staff-only answer keys and marking guidance. Multiple-choice options are stored
as a JSON string list and the recorded answer must be one of those options.

`homework_completions` contains a row only after an assigned teacher records
evidence for an active learner in the allocated class. It records `submitted`,
`completed`, or `missing`, a note, recorder, and timestamp. No row means **not
yet recorded**, never missing. Rows are removable so a mistaken entry returns
the learner to that unrecorded state.

## API and permissions: Homework

Staff endpoints are under `/api/v1/homework`. `GET /context`, `GET /`, and
`GET /{homework}` provide allocation-scoped authoring data, with term, class,
status, and due-date filtering. Leadership can read, create, and edit across
the school; a teacher is limited to their exact active teaching allocation.

Draft homework and its questions support create, edit, and delete endpoints.
Only the assigned teacher can publish, close, archive, record completion, or
remove a completion record. Publishing requires at least one question and
checks that configured total marks do not fall below question marks. Drafts can
be deleted; published work must be retained through closure or archiving.

`GET /{homework}/pdf` creates a learner worksheet without answers. `GET
/{homework}/answer-key/pdf` is a staff-only restricted export with answer keys
and marking guidance. Assignment deletion and scheme-week deletion are refused
when homework retains their historical context.

`GET /api/v1/portal/parent/children/{student}/homework` is available only to a
linked Parent/Guardian account. It returns published homework for the child's
active current class and current eligible period. The family response includes
learner questions but excludes answer keys, marking guidance, teacher notes,
completion records, and every write action.

## UI: Homework

`homework.html` provides responsive filters, allocation-bound draft authoring,
question editing, a learner worksheet preview, lifecycle actions, separate
worksheet/answer-key downloads, and explicit completion tracking. The page
states the distinction between unrecorded and missing completion. The Parent /
Guardian Portal has a read-only Published homework section with learner-safe
questions only. Homework is included in Teaching & Learning navigation for
leadership and teachers.

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

Lesson Plans, Records of Work, and Homework follow the same pattern: additive
migrations, a shared access service and response presenter, allocation-scoped
authorization, term/date validation, dedicated responsive pages, and isolated
regression suites before the local commit.

## Subsequent modules

1. Exam Paper Studio, retained artifacts, printing, and PDF export.
2. AI assistance behind source disclosure, human confirmation, and audit
   records; it must not generate or present unverified official curriculum
   content.
3. Teaching-document versioning, review queues, approval delegation, and
   notification policy after the school's governance requirements are defined.
