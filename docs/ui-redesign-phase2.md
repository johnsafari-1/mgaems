# Learner & Guardian Management UI — Phase 2

13 October 2026. Static HTML, vanilla JavaScript and existing Phase 1 design
tokens. One local commit; no push and no Phase 3 work.

## A. Starting repository state

Verified `<repository>`, branch `feature/production-ui`, clean working tree and
expected HEAD `e9425ab4dbd780c34f78deb4a03fc49e2f281ae4`. The branch started ten
commits ahead of origin. No applicable `AGENTS.md` was found. Read the README,
Phase 1 report, learner/guardian productionization and approved family-access
policy, alongside controllers, resources, relationships, shell/dialog patterns
and existing frontend and safe backend tests.

## B. Existing UI findings

Admissions, generated admission numbers, profile edits, server search/filtering,
pagination, promotion/transfer history, guardian grouping, primary contacts,
optional accounts, linking and unlinking already worked. Existing APIs minimized
learner data and denied family contacts to Teachers. The Teacher Workspace
already owned the assignment-scoped learner page; Parents and Sponsors had
separate portals. These workflows and response contracts were reused.

Presentation gaps were hidden filter labels, result counts confined to the
pagination footer, a generic profile modal without a learner identity summary,
unstructured registration fields and a separate guardian page that lost learner
context when searching existing contacts. The empty-history message incorrectly
implied that a currently recorded class was necessarily the admission class.
These are source-level findings; no rendered visual defect is claimed.

## C. Learner Directory improvements

- Clear introduction and prominent authorized Add learner action.
- Visible search, class and enrollment labels, plus Clear filters.
- Existing SQL-backed search and filters, 15-record pages, real result ranges
  and filtered-result wording. Invalid pagination responses show an error.
- Readable admission number, name, recorded class and enrollment columns.
- View profile and direct Edit actions. Direct edits fetch the authorized profile
  and ignore responses after directory context or edit selection changes.
- Legacy `promoted` records remain labeled explicitly; no status normalization.
- Loading, empty, failure/retry states and existing stale-query protection.

The Teacher directory uses the same visual treatment with visible assigned-class
filters, an explicit Active learners only scope, accessible contained table and
read-only view actions. Its authorized context and API request set are preserved.

## D. Learner Profile improvements

The existing shared modal is widened to a responsive 960px maximum panel. It
adds learner initials, name, admission/class context and a text status badge.
Overview, Guardians, Academic history and permitted Sponsorship tabs retain
proper tab/panel relationships and roving focus. Arrow keys, Home and End select
and focus tabs; panels and wide tables can receive keyboard focus.

Overview separates recorded details, enrollment actions and existing module
links. Guardians show relationships, primary badges and a clear Manage guardians
link scoped to the learner. Academic history retains dates, earlier placements,
term and reason, without asserting an unknown admission class. Sponsorship uses
only the existing learner-filtered response. Secondary-load errors retain the
overview and have a retry. Profile reloads retain the selected tab and ignore
late responses after closing or a newer load.

## E. Admission Form improvements

The existing required learner fields are grouped under Learner information and
Admission & placement. Labels, required-field guidance, full-height controls,
name autocomplete, date bounds and concise help text improve entry. Admission
defaults to the Nairobi school date, including the UTC day boundary.

No new requirement or payload field was introduced. Backend date validation and
admission-number generation remain authoritative. Generic edits retain their
existing exclusion of class/admission fields. Native validation, escaped Laravel
field-error summaries, focus handling, Cancel/Save and duplicate-save guards are
preserved. Lifecycle term-choice failures now have a retry action.

## F. Guardian Management improvements

The directory adds visible search, real result ranges, Clear search, readable
per-learner relationship/primary badges and optional Parent Portal association.
Contact, relationship, account and learner-selection sections use grouped forms.
The page explains that contact records alone do not grant account access and
encourages searching existing contacts before adding a new one.

From a learner profile, Find existing guardian exposes the existing directory
while retaining a return link and that learner's context. Add/link forms preselect
the learner only after a successful authorized profile read. Existing links are
excluded, selection remains removable, and the 100-learner bound is preserved.
One account can still access several legitimately linked children.

Existing-account choices continue to disable accounts associated with another
contact group. Backend duplicate checks and optional account creation remain.
Ordinary edits preserve per-child primary/relationship values unless changed.
The form explicitly explains that relationship/primary changes are group-wide
under the existing schema. Account changes and unlinking retain confirmation,
including access revocation, other-child preservation and final-link behavior.

## G. Learner Lifecycle presentation

Active learners expose promotion, transfer out and leaving; transferred/left
learners expose transfer in. Legacy promoted status exposes neither transition.
The interface describes each enrollment effect and preserves server rules.

Promotion and transfers now review the learner, effective date, destination where
applicable and enrollment outcome in confirmation. Leaving retains its existing
confirmation with an additional duplicate-action guard. Effective-date minimum
uses the latest recorded history date independent of response order. Earlier
history is never rewritten. No exit-history type or automatic promotion is added.

## H. Responsive and accessibility improvements

New module CSS uses only Phase 1 theme tokens: navy/teal text, surfaces, borders,
badges, spacing and focus colors work with both Light and Dark themes. Filter
grids reflow at 900px and become one column at 640px. Forms reflow, long values
wrap, profile sections remain in a viewport-bounded shared modal, and wide
tables scroll in named, keyboard-focusable regions. Touch-height form controls,
visible focus, captions, table headings, live result feedback and text statuses
remain practical. No new animation, framework, dependency or branding asset.

Shared dialog Escape, Tab/Shift+Tab containment, inert backgrounds, busy-dismissal
protection and focus restoration are unchanged and covered by existing tests.
DOM/CSS contracts do not replace browser or assistive-technology acceptance.

## I. Role-based permissions and data safety

No controller, route, resource, authorization policy or schema change. Existing
leadership role gates and employment eligibility remain server enforced.
Teachers retain assignment-scoped active learners without guardian contacts,
sponsorship or edit actions. Parents retain own-linked-child ownership; Sponsors
and Coordinators retain their established sponsorship interfaces and scopes.
No standalone Student Portal or general Health/safeguarding disclosure is added.

The existing separately authorized Teacher actionable-safety projection is
unchanged; complete Health records and general learner payload privacy remain
restricted. Logo assets, settings and default-logo behavior are untouched.
No migration, reseed, reset, Staff/User link edit or real school-record mutation.

## J. Files changed

- `public/students.html`
- `public/guardians.html`
- `public/assets/students.js`
- `public/assets/guardians.js`
- `public/assets/teacher-workspace.js`
- `public/assets/learner-management.css`
- `tests/frontend/helpers/dom.cjs`
- `tests/frontend/learner-management.test.cjs`
- `tests/frontend/teacher-workspace.test.cjs`
- `docs/ui-redesign-phase2.md`

The DOM helper now supports collection `namedItem`, selection after replacing
select options and timer cancellation needed for realistic form/query tests.

## K. Tests and preservation evidence

| Check | Result |
| --- | --- |
| Entire frontend suite | 177 tests passed, zero failures/skips; 27 new learner/guardian cases and strengthened Teacher assertions |
| Safe backend regressions | Seven suites passed: learner_guardian, authorization, teacher_workspace, parent_portal, sponsorship_workspace, health_frontend_contract, academic_structure |
| Backend execution count | 288 printed PASS executions, 156 distinct PASS labels, including repeated inherited checks; not a count of unique PHP assertions |
| JavaScript syntax | students.js, guardians.js and teacher-workspace.js pass `node --check` |
| PHP syntax | Reused StudentController, GuardianController and StudentResource pass PHP lint |
| Assets/navigation | 17 static HTML pages and 34 distinct referenced resources return 200 with exact workspace bytes; local asset links exist |
| Whitespace | `git diff --check` passes |
| Development schema | All 43 complete schema hashes unchanged |
| School data | Read-only verification evidence retained privately; no school-data writes issued |

Backend tests ran in disposable, network-disabled, read-only source/vendor
containers with explicit SQLite `:memory:` and connection guards. No repository
migrations or development MySQL tests ran. Frontend fixtures and requests exist
only in isolated DOM tests. Asset verification used anonymous static GETs; it
did not execute scripts or call authenticated module APIs.

Development checks used read-only metadata/data comparisons. This checkpoint
issued no school-data writes or migrations. Any concurrent application activity
limits whole-database equality claims; no records were altered to force a match.
Detailed population counts, activity metadata, timestamps and fingerprints are
retained in operator-controlled private audit evidence rather than public source.

## L. Browser QA status

**Pending.** Browser inventory returned no connected surfaces; opening the local
page in the in-app browser returned `Browser is not available: iab`. No rendered
desktop/mobile, Light/Dark screenshot or screen-reader acceptance is claimed.

## M. Remaining limitations

Manual desktop/mobile, keyboard, on-screen-keyboard and Light/Dark visual review
is still needed. No live real-record write smoke test was performed.

The existing inferred Guardian identity schema supports group contact/relationship
edits rather than independent relationship editing for each child. Groups remain
bounded to a 100-row relationship preview; learner search finds omitted links.
Legacy promoted states remain historical values. Mark as left retains its
existing immediate status/audit behavior because no exit-history event exists.
Guardian management opens its established scoped page from the profile; no new
inline CRUD subsystem or speculative endpoint was introduced.

## N–O. Commit and final Git state

One local commit contains the ten files above. The resulting commit hash and
clean Git status are reported in the completion response. No push; stop here.
