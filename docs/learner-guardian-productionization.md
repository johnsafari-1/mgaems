# Learner and guardian productionization

This work extends the authoritative `D:/mgaems` workspace on
`feature/production-ui`, starting from shell checkpoint `2e1279a`.
The shared sidebar, header, theme architecture, authentication middleware,
and other domain workflows remain unchanged.

## Audit and scope

The repository already supported admissions, generated admission numbers,
class/status discovery, profile editing, promotion/transfer records, grouped
guardian contacts, optional parent accounts, and ownership-scoped Parent Portal
attendance, progress, and report cards. The existing MySQL schema includes a
unique admission-number index, class/guardian/history foreign keys, medical
records, and unique group-sponsorship membership pairs.

Gaps addressed: broad learner model serialization, teacher access to guardian
contacts, medical collection in admissions, unvalidated admission/effective
dates, direct class edits, permissive/repeated lifecycle transitions,
unbounded guardian/account responses, missing learner-specific sponsorship
filtering, unescaped learner output, and inconsistent/inaccessible dialogs.

No schema changes, migrations, new enrollment subsystem, or health workflow
were needed. Existing medical rows and historical records are preserved.

## API contracts

- Learner lists retain `data` and `meta.page/per_page/total`, with a maximum
  page size of 100. Their records contain identifiers, names, current recorded
  class, and lifecycle status. Birth/admission dates and gender are profile-only.
- Profiles omit medical information, photo/filesystem paths, timestamps,
  account identifiers, and audit metadata. Only existing leadership roles
  receive linked guardian names, relationships, primary flags, phone, and email.
  Teachers receive no guardian collection.
- Registration accepts learner fields only. Guardian/medical payloads and
  client-supplied admission numbers/statuses are rejected when nonempty and
  never mass-assigned. Dates must be no later than today and admission cannot
  precede birth. Admission numbers use the admission year; the existing unique
  index remains authoritative, with bounded retries for concurrent collisions.
- Generic profile edits cannot alter class or admission details. Active
  learners may be marked `left`; reactivation uses the existing transfer-in
  operation. Promotions keep active enrollment and reject the current class.
  Transfer-out requires active enrollment; transfer-in requires `transferred`
  or `left` and a real destination class. Effective dates cannot be future or
  precede admission/the latest recorded placement change. Transactions lock
  the learner and append history without rewriting earlier records.
- Academic-history responses contain shaped learner/class/term information
  and dated operations/reasons, without recorder identifiers or audit timestamps.
- Guardian and parent-account lists now paginate in SQL, with a maximum page
  size of 50 (UI: 20). Searches remain server-side. Guardian discovery also
  accepts `student_id`, supporting the learner-profile link.
- Guardian identities retain existing account/contact grouping. Responses
  include at most 100 nested relationship rows, `students_count`, and
  `students_truncated`. A search-matched learner is prioritized so links beyond
  the initial 100 remain discoverable. Link/create submissions accept at most
  100 distinct, existing learner IDs.
- Parent accounts remain optional. Roles/account references are validated,
  already-associated accounts cannot silently join another contact group,
  and `user_id: null` explicitly detaches an association without deleting a user.
  Account uniqueness races produce safe field errors. Duplicate relationships
  are checked inside locked transactions, including updates.
- Primary selection is explicit: selecting a primary contact demotes other
  contacts for that learner. Ordinary contact edits preserve per-learner primary
  and relationship values unless the user changes them. Link submissions may
  specify `is_primary_contact` for the new relationships.
- Unlink removes all matching relationship rows for that identity/learner,
  including legacy duplicates, preventing leftover rows from retaining portal
  access. It preserves other learners and any portal account. Removing the last
  relationship also removes the contact representation under the existing schema.
- `sponsorships?student_id=...` returns minimized individual sponsorships for
  that learner and group sponsorships containing that learner, excluding other
  and school-wide records. Existing sponsorship authorization/lifecycle is intact.

## Frontend and integration

`students.html` and `guardians.html` use extracted `students.js`/`guardians.js`
and the existing shell/design tokens. API values use `MGAEMS.escapeHTML`.
Both pages provide bounded filters/search/pagination, stale-response guards,
real selections, error/empty/loading states, and submission guards.

Shared `MGAEMS.openModal` provides initial focus, Tab/Shift+Tab containment,
Escape dismissal, nested confirmations, busy-dismissal protection, background
inertness, and focus restoration. `showFormErrors` preserves Laravel field
errors and escapes messages. Transfer-out, exit, unlink, and account changes
require explicit UI confirmation.

Learner profiles distinguish recorded/current placement from historical
operations. Sponsorship is requested only for authorized leadership.
Attendance, Assessment/report cards, Sponsorship, and Reports links open their
existing workflows without unsupported filter parameters. Guardian and learner
links use explicitly supported `student_id` parameters on these two pages.
Parent Portal ownership checks and controllers are unchanged.

## Safe verification

```text
php tests/safe/learner_guardian.php
node --test tests/frontend/dialog.test.cjs tests/frontend/shell.test.cjs
node --check public/assets/app.js
node --check public/assets/students.js
node --check public/assets/guardians.js
git diff --check
php artisan route:list --path=api/v1 --json
```

The standalone PHP runner skips dotenv and replaces all connection definitions
before providers boot. It refuses any database except explicit in-memory SQLite.
Its tables and fixtures exist only for that process; it never runs repository
migrations or touches development data. Existing database-refreshing PHPUnit
tests are not part of this verification command.

PHP lint, inline JS/asset/link checks, conflict-marker and excluded-feature
addition checks also apply. Read-only Docker schema inspection and HTTP checks
verified workspace files are served and anonymous domain requests return 401.
Browser UI verification was attempted, but no browser surface was available.
DOM interface tests do not constitute browser rendering or live form verification.

## Deferred work

- A normalized guardian identity with separate per-learner relationships would
  remove inferred identity grouping, support granular relationship editing, and
  permit stronger database-level duplicate constraints. No speculative migration
  or automatic data cleanup was performed. Grouped contact/relationship edits
  remain bulk operations; primary flags are preserved unless explicitly changed.
- Legacy `promoted` status values remain visible and unchanged. New promotions
  retain `active`, matching the existing controller semantics and active-roster
  consumers. Legacy values need a separately reviewed reconciliation; they are
  not silently normalized or treated as active by new transition operations.
- `left` retains the existing immediate status/audit behavior. The historical
  table has no exit event type, so no exit history type was invented. Historical
  class references can still lose names if Academics deletes a referenced class
  under existing foreign-key behavior.
- Large guardian groups deliberately return a bounded nested preview. Search
  finds omitted relationships; a fully normalized detail paginator is future work.
- Live browser rendering and real MySQL concurrent-write behavior remain manual
  verification items. Automated integration coverage uses SQLite memory only.
