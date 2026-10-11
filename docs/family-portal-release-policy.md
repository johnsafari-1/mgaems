# Family Portal release policy

Manna Goodnews Academy has approved the Parent/Guardian Portal as the official
family-facing interface for this release. A standalone Student Portal is
excluded. This release policy supersedes conflicting older portal assumptions
while preserving existing role definitions and historical records/migrations.

## Family access

An active Parent/Guardian account reads only learners linked through current,
school-maintained Guardian-to-User and Guardian-to-learner relationships. Names,
contacts, supplied Guardian IDs and browser ownership claims do not establish
access. School identity verification remains part of Guardian onboarding; the
database has no separate Guardian verification flag to manufacture.

One account can have several linked children. Duplicate valid relationships do
not duplicate learners. Removing all of that account's relationships to a child
removes access without deleting learner, academic, attendance or report history.

The Portal provides linked-child overview, recorded attendance/history, educational
results already contained in available report snapshots, existing available report
PDFs, current available class timetable and Parent/school-wide announcements.
Family class references are limited to linked learners' classes and exclude
school-wide counts and Staff identities. School calendar reference permission is
preserved. Parent access does not require Staff employment.

Health, medical and safeguarding content, private correction/revision manifests,
administrative logs, other families' learner data, Sponsor administration and
Staff/Guardian personal contacts are outside this family interface. Any future
Health or safeguarding disclosure needs a separately approved policy.

## Publication decisions

Individual assessments have no reliable release state. Saved projections and
later corrections are not newly disclosed through family progress. Progress
comes only from immutable snapshots of reports available through the existing
report-publication workflow, keeping continuous and end-term values separate.
No weighting, averages, inferred levels, grades or curriculum framework is added.
Legacy PDFs without snapshots remain downloadable under their existing policy;
live assessment rows are not used to reconstruct their unknown published results.

`ReportPublication` already stores a verified PDF and immutable revision as a
publication, and existing Parent access to those artifacts is preserved. There
is no separate school approval/release flag distinguishing generation from formal
release. The Portal therefore says **Available report cards**, not a fabricated
released/approved state. Report generation rules are unchanged. Introducing
assessment-level release or a separate report approval stage requires a reviewed
policy, schema proposal and authorization design before implementation.

The timetable is a current available weekly class schedule, validated against
current academic eligibility, offerings, active teaching Staff and matching
assignments. It does not assert historical lessons, term-specific stored timetable
membership or dates that the database does not contain.

## Communication

Parents receive existing school-wide and Parent announcements only. Staff,
Sponsor and legacy unscoped class announcements are excluded. Parent publication
and editing are denied.

The messaging API previously accepted any existing recipient User ID. Parent
sending now fails closed at route and controller; no compose/directory workflow
is added to the Portal. Existing owned historical reads remain ownership-scoped
and are not presented as a new authorized contact workflow. The school must
define approved contacts, learner/assignment relationships, historical visibility
and inactive-contact handling before secure Parent messaging can be implemented.
That review should also address existing message timestamp mass-assignment behavior
before treating send/read-state operations as a production-ready workflow.

## Student role and Teacher workspace

Routine creation of Student-role login accounts and conversion of other accounts
into Student accounts are blocked in Administrator APIs and role selectors.
Existing Student accounts remain available for explicit review; their role may be
retained while existing metadata is edited. No account is automatically deleted,
deactivated, redirected into Parent Portal or given Guardian relationships.
Student roles retain existing limited reference/school-announcement access but
cannot read other learners or perform school operations.

The Teacher Workspace remains assignment-scoped. Class Teacher supervision and
Subject Teacher assessment duties remain distinct. Parent access is independent
of Teacher Staff membership and does not broaden Teacher or Sponsor permissions.

## Required DOCX specification updates

The existing DOCX files are preserved. Managed document authoring/dependency
loader and render/visual-verification tooling are unavailable in this environment;
the task explicitly permits reporting the needed updates. Apply this approved
release policy to the documents below once that tooling is available:

| Document | Exact release-scoped updates |
| --- | --- |
| `MGAEMS_SRS.docx` | In intended audiences/account rules, state that families use Parent/Guardian Portal and no standalone Student Portal or routine Student provisioning is included. FR-PAR-01: recorded own-child attendance with historical class context and no inferred absences. FR-PAR-02: available published artifacts with nested ownership, retained revisions and no raw paths; identify separate formal release approval as unresolved. FR-PAR-03: educational progress from available report snapshots; individual assessment release is deferred; continuous/end-term values remain separate. FR-PAR-04: Parent/school-wide announcement audiences. Preserve FR-PAR-05 school calendar access. FR-PAR-06: current Guardian linkage, multiple-child deduplication, immediate unlink revocation and per-resource ownership. Add a reviewed timetable requirement for the current available class schedule without historical/term-specific claims. Record Parent messaging as awaiting approved recipient scope. Exclude confidential Health/safeguarding disclosures. |
| `MGAEMS_UserRoleMatrix.docx` | Describe Parent/Guardian as the sole family-facing role in this release, with read-only own-linked-child access to the capabilities above. Mark standalone Student portal/own-learner access as excluded/deferred while retaining the Student role for historical review and existing limited references/announcements. Clarify that routine Student provisioning is disabled. Preserve Teacher assignment scope, Sponsor ownership and approved leadership policy. Replace conflicting legacy medical-access assumptions with the approved Health boundary, which grants Parents/Students no operational Health access. |
| `MGAEMS_DevelopmentRoadmap.docx` | Update the Parent Portal checkpoint to cover multiple linked children, overview, historical attendance, report-snapshot progress, available artifacts, current class timetable, relevant announcements and ownership/privacy tests. Remove standalone Student Portal from this release. List assessment/report release policy, approved Parent messaging contacts, existing Student-account review and separately approved confidential-disclosure policies as deferred work. Retain Sponsor/Teacher checkpoints and avoid unrelated architecture changes. |

No DOCX ZIP/XML is rewritten without the required render and visual review.
