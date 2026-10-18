# UI Phase 5A — Academic Management

13 October 2026. Frontend-only checkpoint on `feature/production-ui`, starting
from clean HEAD `dec06e405f4a276ac66e5842b138c3d682722c33`.

## Interface changes

Academic Management now uses the Phase 4 shared palette, typography, navigation
and dialog behavior, with a focused academic stylesheet. The heading and current
workflow-period summary introduce the calendar and teaching responsibilities.
Keyboard-accessible section tabs retain roving focus and selected-panel semantics.

Academic years and terms use readable cards with explicit Active/Inactive flags,
owning-year information and labeled start/end dates. Saved current flags are
separate from date-valid workflow readiness. Search and status filters operate
on the loaded configuration without additional API calls. Date display, form
initial values and unchanged-edit comparisons use the existing Nairobi-aware
school-date helper instead of slicing UTC serialization.

Classes show level, capacity, learner count, Class Teacher, subject-offering count
and display order. Missing metadata in a Teacher's assignment-scoped class
response is labeled Not available; no zero count or teacher ownership is invented.
Learning-area cards expose code, optional grouping and active/inactive status.
Search includes class/teacher names and learning-area codes/grouping. Offering
dialogs show the class context, offered areas and active choices while preserving
the existing confirmations and dependency protections.

Subject Teacher cards identify the learning area, class, teacher, term and academic
year. They remain term-specific allocations, distinct from Class Teacher class
ownership. Forms clearly separate teaching responsibility from the academic term,
and only active offered subjects and eligible staff are available for new choices.

The timetable groups actual lessons by weekday and start time, with readable start
and end times, subject, class and assigned teacher. It explicitly describes a
recurring weekly schedule independent of terms; no term field or term-scoped
claim was added. Empty schedules, missing class selection, unavailable data and
malformed entries have honest states. Existing request-generation guards prevent
old class/filter/offering responses from replacing newer selections.

## Forms, accessibility and responsive behavior

Grouped fieldsets and legends distinguish period details, dates, class details,
Class Teacher ownership, learning-area details, term allocations and weekly lessons.
Required fields are explained. Local validation rejects reversed calendar ranges,
term dates outside the selected year, and equal/reversed lesson times, matching
existing server constraints. Same-day calendar ranges remain permitted. Server
messages retain authority for overlaps, uniqueness, history and dependency rules.

Failed saves keep entered values and restore controls. Error summaries are escaped,
focused and linked through the existing field-invalid feedback. Pending saves
prevent duplicate submission and lock their input context. Term edits preserve
their owning year and send only changed allowed fields. Assignment and timetable
workflows retain their existing create/remove contracts; no edit API was invented.

Cards, actions and metadata wrap within the viewport. Weekly grids reflow from
three columns to two and then one; filters stack on mobile. Controls use 44-pixel
targets and shared visible focus. Light/dark colors use existing tokens. Shared
dialogs retain focus trapping, Escape behavior, busy-state protection and focus
restoration. Streams and new external dependencies were not introduced.

## Files changed

- `public/academic.html`
- `public/assets/academic.js`
- `public/assets/academic.css`
- `tests/frontend/academic-phase5.test.cjs`
- `docs/ui-redesign-phase5a.md`

## Validation

| Check | Result |
| --- | --- |
| Complete frontend suite | 257 tests passed, zero failures/skips; 30 new Academic cases |
| Affected Academic tests | 34 tests passed: four existing plus 30 focused cases |
| JavaScript syntax | All 15 public JS modules and six inline page scripts compile |
| Static resources | 17 pages plus 19 referenced assets: all 36 returned HTTP 200 and matched workspace bytes |
| Roles/contracts | Teacher read-only/scoped metadata, Deputy calendar restriction, Parent/Sponsor redirects, payload vocabulary and server conflict handling pass |
| Calendar regression | Nairobi-midnight display/form values and unchanged-date PATCH exclusion pass |
| Timetable regression | Actual lesson grouping/order, no term claims, stale/malformed/cross-class response handling and double-booking feedback pass |
| Forms | Required choices, ranges, active offerings, preserved drafts, owning year, duplicate prevention and retry pass |
| Design system | Existing theme contrast, focus, dialog and responsive checks pass |
| Whitespace | `git diff --check` passes |

Tests use synthetic in-memory DOM/API responses and make no real academic writes.
Static HTTP checks do not execute page scripts or call mutation APIs. Backend,
routes, schema, Composer, Docker, shared authentication/navigation, branding and
existing uploaded assets remain unchanged. No development migration, seeding,
container replacement, deployment or security-maintenance operation was performed.
Backend suites were not rerun for this frontend-only change.

## Browser verification and limits

Browser visual acceptance is **pending**: the browser inventory exposed no enabled
browser surface. Unit tests establish workflow behavior and stylesheet contracts,
not rendered desktop/tablet/mobile layouts. Manual verification remains required
at desktop, tablet and compact mobile widths, in both themes, especially long
class/subject names, weekly lesson cards, tab scrolling, date inputs, dialog focus
and validation announcements.

Searching is local to the loaded configuration. Recurring timetable entries have
no term scope; no edit endpoint exists for assignments or lessons. The backend
continues to enforce double-booking and protected academic history. Nothing is
pushed or deployed as part of this checkpoint.
