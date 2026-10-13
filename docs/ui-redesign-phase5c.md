# UI Phase 5C — Staff, Communication and Visitor Management

Date: 2026-10-13. Starting repository: `D:\mgaems`, branch
`feature/production-ui`, clean at
`168dfd60253ac1beb8f8c8c3665f5066ba06526f` (three commits ahead of origin).

This checkpoint keeps static HTML, CSS and vanilla JavaScript, using the existing
navy/teal palette and shared navigation, branding, form feedback and dialog helpers.
Laravel APIs, authorization, authentication and school data are unchanged.

## Staff and HR

- Added a labeled search/type/status toolbar, filter reset, honest directory
  totals, employment badges and explicit teaching/non-teaching presentation.
- Profiles show personal/employment information, qualifications, emergency
  contacts and document metadata in keyboard-operable tabs. Each profile is
  pinned to the requested Staff identity; closed or superseded responses cannot
  overwrite another profile.
- Grouped creation and editing forms retain the existing fields and API payloads.
  Optional qualification/contact rows have unique labels and IDs, four-digit
  qualification-year validation, removable draft rows and targeted server errors.
  Nested creation errors are mapped to the corresponding entered fields.
- Confirmations cover employment type/status changes and removal of an existing
  qualification/contact. Pending actions disable controls and prevent duplicate
  submission; failed saves retain the draft. Linked-account eligibility and
  session revocation remain server-controlled.
- Staff creation remains limited to System Administrator and Head Teacher.
  Deputy Head Teacher can manage existing permitted Staff information. Account
  linking stays in its separately authorized Administration workflow: these
  forms neither send `user_id` nor create user accounts.
- Staff uses the shared navigation's saved school logo. Inspection confirmed
  Phase 4 had already removed the old hardcoded URL; this implementation retains
  that single branding source and adds a regression against reintroducing it.
- Documents remain metadata only. No private storage URLs or unimplemented
  upload/download actions are exposed.

## Communication

- Extracted page scripts/styles into dedicated assets. Searchable announcement
  cards display permitted audience, publisher and publication time in
  Africa/Nairobi, with clear available/filter counts.
- The owned-message directory supports search and received, unread, read and
  sent filters. Status text distinguishes unread received messages, read received
  messages, sent messages and messages read by their recipient.
- Native message buttons open accessible dialogs. Opening a message does not
  mark it read. Only its recipient can request the existing read endpoint, and
  the UI updates after a matching server acknowledgement with a valid timestamp.
- Announcement and message forms use labels, fieldsets, focused validation
  feedback, confirmation, frozen submitted values, duplicate prevention and
  retryable drafts. Publication uses only `title`, `body` and the existing
  supported audience; messages retain one existing recipient account number.
- Announcement targeting remains server-controlled. Teacher publication is not
  enabled, no class-targeting or broadcast option is added, and no user directory
  lookup is introduced. Parent/Guardian and Sponsor Coordinator sending remains
  disabled. Existing family/sponsor portal redirects are retained.
- Arrow keys, Home and End operate the announcement/message tabs. Unavailable
  data displays an error and retry instead of invented zero or unread counts.

## Visitor management

- Extracted page scripts/styles into dedicated assets. The directory shows
  visitor type, purpose, actual host Staff, school-calendar visit date and details.
- Added labeled text/type filters and inclusive from/through date filters with
  invalid-range feedback, filter reset and result counts. Totals come from loaded
  records and remain unavailable while loading or after failure.
- Details dialogs display the existing record, including purpose and notes.
  There are no checkout, edit or deletion actions or invented endpoints.
- Registration groups visitor identity and visit arrangements, using the existing
  active-Staff lookup. Missing/failed host choices disable submission with useful
  feedback. School-date defaults, field validation, confirmation, frozen controls
  and duplicate prevention preserve the existing registration payload.
- Administrator, Head Teacher and Deputy Head Teacher retain registration.
  Sponsor Coordinator is read-only and never requests host Staff choices.

## Accessibility, responsive behavior and asynchronous safety

Dedicated CSS uses shared light/dark tokens, visible focus and touch-sized
controls. Directory tables retain captions and column headings; compact layouts
provide labeled rows. Forms and detail grids stack at mobile widths; statistics,
filters and action groups adapt at tablet widths. Long text wraps rather than
overflowing its cards or dialogs.

All three workspaces use shared modal behavior for focus trapping, Escape and
focus restoration. Profile/communication tabs use selected state, associated
panels and roving keyboard focus. Loading, empty and error states are distinct.
Malformed records fail with recoverable feedback; request generations and
token/account/role/page guards prevent stale responses or confirmations from
acting for another session. These UI guards supplement unchanged server policy.

## Changed files

- `public/staff.html`
- `public/assets/staff.js`
- `public/assets/staff.css` (new)
- `public/communication.html`
- `public/assets/communication.js` (new)
- `public/assets/communication.css` (new)
- `public/visitors.html`
- `public/assets/visitors.js` (new)
- `public/assets/visitors.css` (new)
- `tests/frontend/staff-phase5.test.cjs` (new)
- `tests/frontend/communication-phase5.test.cjs` (new)
- `tests/frontend/visitors-phase5.test.cjs` (new)
- `tests/frontend/shell.test.cjs` (loads the extracted communication module;
  existing permission assertions retained)
- `docs/ui-redesign-phase5c.md` (new)

## Validation and limits

| Check | Result |
| --- | --- |
| Complete frontend suite | 432 passed; zero failures, cancellations or skips; 96 new cases |
| Staff regressions | 33 new cases |
| Communication regressions | 34 new cases; existing shared-shell role cases also pass |
| Visitor regressions | 29 new cases |
| Syntax | All 17 public JavaScript modules, four inline scripts and 24 frontend test files compile |
| CSS tokens | All variables referenced by the three dedicated stylesheets exist in the shared theme |
| Static HTTP resources | 17 pages and 27 referenced assets: 44 HTTP 200 responses matching workspace bytes |
| Preservation | Backend, schema, routes, Composer, Docker, shared navigation/helpers and global theme unchanged |
| Uploaded branding | Both existing uploaded logo hashes unchanged |
| Whitespace | `git diff --check` passed |

Tests use synthetic in-memory fixtures, mocked API writes and confirmations.
Static HTTP checks do not execute page scripts or call school APIs. No development
database writes, migrations, seeding, document deletion, artifact overwrite,
container replacement, push or deployment occurred. Backend suites were not
rerun for this frontend-only checkpoint.

Browser visual acceptance is **pending**: the available browser inventory is
empty. Manual desktop/tablet/mobile review remains required in both themes,
including long names and notes, compact table labels, dialogs, focus restoration
and assistive-technology announcements. DOM and source checks do not certify
rendered layouts or screen-reader behavior.

Existing limitations remain: Staff APIs have no revision tokens for concurrent
employment edits; secure Staff document upload/download endpoints are unavailable;
message recipients still require a known account number; the pending family and
Coordinator recipient policy is not implemented; announcements have no edit or
scheduling action; visitors have only the existing read/registration workflows.
