# Phase 7: Grade 7 Integrated Science setup

Updated: 19 October 2026. Workspace: `D:\mgaems`.
Branch: `feature/mgaems-curriculum-ai-exam-studio`.
Phase 6 baseline: `87bc93c`.

## Approval and execution

The operator approved proceeding with the previously reported academic changes,
selected the existing teacher (staff ID 4, account ID 32), selected current 2026 Term 3
(ID 3), and confirmed that the authorized curriculum PDF is **not available yet**.

The four configuration operations below were applied together in one MySQL
transaction through the existing application controllers, validation and audit
services. This was local maintenance under the existing active `admin` account
(ID 26), not a browser login or bearer-token API session. Preconditions were
checked and relevant rows locked before writing. All four existing audit events
and the resulting configuration were checked before the transaction committed.

No application source, RBAC, active AI configuration or schema was changed.
No curriculum content was downloaded, uploaded, extracted or approved. No Git
commit or push was performed during this setup.

## Completed configuration

| Record | Previous state | Saved state |
| --- | --- | --- |
| Subject ID 4: name | `Intergrated Science` | `Integrated Science` |
| Subject ID 4: learning area | `Matter` | `Integrated Science` |
| Subject ID 4: identity/code/status | ID 4 / `SCIE` / active | Preserved |
| Grade 7/class 11 Science offering | Absent | Offering ID 10; subject ID 4 |
| Grade 7 Science teacher allocation | Absent | Allocation ID 6; class 11, subject 4, staff 4, term 3 |
| Curriculum source ID 1 subject link | null | Subject ID 4 |

Source 1 remains `kicd-integrated-science-grade7-april-2024`, grade 7, learning
area `Integrated Science`. Its other registered metadata was preserved. Source
linking does not verify its publisher, edition, authorization or content.

Class 11 remains `Grade 7`, level `junior`, sequence 7. Its class teacher remains
staff ID 5; the new subject allocation does not transfer class-teacher ownership.

Term 3 belongs to academic year 1 (`2026`) and runs from 27 August to 23 October
2026. Reconfirm the intended term if the pilot takes place after that period.

### Existing relationships retained

- Subject count remains five; no replacement or duplicate subject was created.
- Existing Science offerings IDs 2 and 7 remain linked to classes 9 and 7.
- Existing Science timetable entries IDs 3 and 7 were compared against the
  pre-change snapshot and remained unchanged.
- All five pre-existing teacher allocations remained unchanged, including the
  historical Grade 7 Social Studies allocation.
- Exactly one class 11/subject 4 offering and one class 11/subject 4/term 3
  allocation exist.

The pre-change metadata and relationships were captured during maintenance.
No full database backup/restore drill was performed or claimed by this setup.

### Persisted audit trail

All four audit entries belong to administrator account ID 26:

| Audit ID | Existing action | Entity |
| --- | --- | --- |
| 508 | `UPDATE_SUBJECT` | Subject 4 |
| 509 | `ATTACH_SUBJECT_TO_CLASS` | SchoolClass 11 |
| 510 | `CORRECT_CURRICULUM_SOURCE` | CurriculumSource 1 |
| 511 | `CREATE_TEACHER_ASSIGNMENT` | ClassSubjectTeacher 6 |

## Post-change verification

A fresh application process used a MySQL **READ ONLY** transaction and confirmed:

- The selected teacher's active staff/account relationship resolves to staff ID 4.
- Allocation 6 is visible in the current-term Teacher Workspace scope.
- Scheme of Work, Lesson Plan, Homework and Exam Paper context controllers each
  expose the exact class 11/subject 4/term 3 allocation to the selected teacher.
- Another teacher is denied allocation 6 with HTTP status 403.
- The original subject ID/code, single offering/allocation, source link and four
  audit records persisted.
- Exact grade 7 / `Integrated Science` / subject 4 retrieval now passes metadata
  validation and returns `NO_VERIFIED_CURRICULUM`, rather than a subject mismatch.
- Curriculum source versions, records and learning outcomes remain at zero.
- The active driver remains `disabled` and the resolved provider is unavailable.

Fourteen verification assertions passed, including the MySQL connection guard.
The verification transaction was rolled back after its reads.

The existing read-only inventory/model-list command also passed after setup:

```powershell
docker exec mgaems-app php tests/safe/ai_pilot_readiness.php --ollama-models
```

Ollama is reachable from the application container at `host.docker.internal`;
`qwen3:1.7b` is installed and the configured timeout is 120 seconds. Only the
model-list GET was made; no live inference was performed.

Phase 6 regression evidence remains in
[the original readiness report](phase7-ai-pilot-readiness.md#8-regression-evidence).
The academic configuration operation did not change application implementation.
The subsequent implementation fixes and tests are recorded below.

## Follow-up Library fixes and testing

After the operator requested direct system fixes and testing, the Library was
updated without additional active database writes:

- Source registration/editing now offers an optional selector of existing school
  subjects. It retains the current link while the lookup is pending or unavailable;
  an explicit `Not linked` choice sends null.
- The backend now preserves `subject_id` when it is omitted from a draft-source
  update, validates the retained link against the edited learning area under the
  source lock, and still permits explicit unlinking. Reviewed-source immutability
  and existing role checks remain in place.
- Version review now shows every structured extraction field, authorization basis,
  verification notes and subject mapping. Private PDF download remains available
  for reviewed editions through the existing administrator-only endpoint.
- The isolated HTTP pilot now configures its synthetic junior Grade 7 class,
  corrects its synthetic subject in place, creates its offering/allocation through
  the real APIs, tests duplicate rejection, and verifies that source edits retain
  the link before running all four generator/import/acceptance flows.

Executed results:

| Check | Result |
| --- | --- |
| Full frontend suite | 663 passed, 0 failed |
| Focused Library + grounded frontend suite | 22 passed |
| Curriculum Library/contracts | 29 counted checks passed, plus two pre-install checks; SQLite memory only |
| Extended synthetic HTTP pilot | Grade 7 mapping and source-to-import-to-acceptance workflow passed for all four generators; 17 workspace prerequisite checks passed |
| Live Ollama synthetic probe | 3 passed: model list, real JSON response, sanitized missing-model failure; no database connection configured |
| PHP/JavaScript syntax and diff whitespace | Passed |

The live probe command was:

```powershell
docker exec mgaems-app php tests/safe/ollama.php --live
```

It used only the original tiny synthetic JSON probe. The four full teaching
generations still used faked transport in isolated SQLite. This does not establish
real-model teaching quality, curriculum fidelity or browser layout/usability.
A fresh read-only active inventory after the tests confirmed the driver remains
disabled, source 1 remains linked to subject 4, the approved school allocation
remains, and versions/records/outcomes remain at zero.

The operator also supplied a Google Drive link. Only its preview page metadata
was inspected: the displayed filename is `Integrated Science Grade 7 - July
2024.pdf`. Actual PDF bytes, internal edition, authorization and content have not
been checked. This differs from the April 2024 label of source 1; reconcile the
actual edition before choosing an existing source or registering a distinct one.

## Next isolated pilot

An interactive original-content demonstration is available separately at
**http://localhost:8010/demo**. See the
[synthetic browser demo guide](synthetic-browser-demo.md) for the fictional
accounts, four-module walkthrough, isolation controls and executed checks. Its
four-document drafts are explicitly labelled deterministic samples. A separate
live Ollama JSON probe passed; the active school driver remains disabled.
The operator subsequently confirmed the demo was working and requested its
closure. Both demo containers are now stopped with their data retained; work has
returned to the main project on port 8000.

The agreed mapping is:

```json
{
  "grade": 7,
  "learning_area": "Integrated Science",
  "subject_id": 4,
  "class_id": 11,
  "staff_id": 4,
  "term_id": 3,
  "class_subject_teacher_id": 6
}
```

These are school mapping values, not an arbitrary API payload. Grounded drafting
accepts `grade`, `learning_area` and `class_subject_teacher_id` in
`input.selection`; the server resolves subject identity from the allocation.
Run, document, version, record and outcome IDs must come from the deployment in
which the pilot executes. An isolated database must verify its own IDs rather
than blindly reusing active IDs.

1. Obtain the authorized Grade 7 edition and evidence covering private retention,
   extraction and intended model-assisted use. Record the grant/reference and
   scope in `authorization_basis`; public hosting alone is insufficient.
2. Confirm the actual publisher, variant, grade, edition/date and provenance.
   Use the existing source only if that metadata genuinely matches the edition.
3. Use the existing system-administrator Library workflow for private PDF upload,
   reviewed structured JSON import, page-by-page correction and approval of the
   current document/content checksum pair. No automatic PDF extraction is
   assumed. Check the full review API response as well as the summary UI.
4. Select a teacher-agreed narrow strand/sub-strand or explicit record set and
   verify exact approved grade/area/subject retrieval, references and outcome IDs.
   Test wrong-grade, wrong-subject, unapproved/withdrawn and integrity failures
   only in an isolated environment.
5. Establish a separate pilot database, private storage and runtime with verified
   isolation and recovery. Reproduce only the necessary academic mapping and
   synthetic actor identities; do not copy unrelated school personal data.
6. Authorize real-model inference in that isolated runtime using the existing
   Ollama provider. Keep the active deployment's driver disabled.
7. Generate a Scheme of Work, Lesson Plan, Homework and Exam Paper from the same
   approved bounded context. Agree marks/durations and assess factual accuracy,
   grade suitability, source fidelity, answers and latency with the teacher.
8. Explicitly review/edit/import each draft through its existing document APIs.
   Verify lost-response reconciliation, partial failures, conflicts, foreign
   teacher denial and acceptance-only retries. Acceptance must produce one
   `ACCEPT_AI_TEACHING_DRAFT` event per run and leave documents in draft state.

The existing synthetic prerequisite remains:

```powershell
docker exec mgaems-app php tests/safe/curriculum_grounded_pilot.php --synthetic
```

It uses in-memory SQLite, synthetic source text and faked inference transport.
It does not qualify real-model output or authorize real curriculum ingestion.

## Outstanding blockers and workflow details

- **Authorized PDF and usage evidence:** a Drive link was subsequently supplied,
  with a July 2024 filename. Usage evidence and the internal edition still need
  verification before download/ingestion. Onboarding, content approval, approved
  retrieval and real-content generation remain pending.
- **Pilot scope:** exact topics, approved record IDs, marks and durations have
  not yet been chosen.
- **Source 2:** its Grade 1 registration points to the same Grade 7 PDF URL as
  source 1. It remains unlinked and metadata-only, pending separate review.
- **Source editing UI:** the previously observed omission/clearing bug is fixed
  in both the form and backend. Use the new subject selector and verify the
  displayed subject mapping before approving an edition.
- **Recovery boundary:** import retry plans live in the open dialog. Reload or
  cross-browser recovery requires reviewing saved content; durable server-side
  whole-import receipts have not been implemented.

Active AI enablement, source approval and teaching-document publication remain
separate decisions. No enablement or publication was performed in this setup.
