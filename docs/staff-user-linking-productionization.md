# Secure Staff/User account linking checkpoint

Date: 2026-10-12. Scope: existing Administration User Management and Staff association security. No live account links were created, removed or replaced.

## A. Initial repository state

Verified repository `D:\mgaems`, branch `feature/production-ui`, clean working tree and HEAD `6ed7861d16523e4c2c4aac3f66dfd8cfe1fc4930`. The branch was six commits ahead of `origin/feature/production-ui`, with none behind. No applicable `AGENTS.md` was found.

Development MySQL was `8.0.46`, database `mgaems`, server UUID `08778507-b858-11f1-a705-a6d841c8094c`. Migrations `2026_10_10_000036_add_user_session_version` and `2026_10_10_000037_create_school_health_records` were already applied. The database had 43 tables and 39 migration-ledger entries. Neither migration was rerun.

## B. Existing architecture

`User::staff()` is the existing one-to-one association; `Staff::user()` is its inverse. `staff.user_id` is nullable, references `users.id`, and already has the unique index `staff_user_id_unique`. The foreign key uses `ON DELETE SET NULL` and `ON UPDATE CASCADE`.

Previously, ordinary Staff creation/editing accepted `user_id`. HR editing was accessible to school leadership, so this allowed account associations outside technical User Management without dedicated identity confirmation, concurrency checks or transactional session/token revocation. The HR frontend displayed link status but had no dedicated account-link control.

Existing authentication refreshes active account state and role on each request. Cookie sessions use `users.session_version`; Sanctum bearer credentials reside in `personal_access_tokens`. Employment gates query the current Staff association. `AuditLogger` remains the common audit writer. No additional identity table, permission system or HR module was introduced.

## C. Read-only onboarding findings

| Finding | Count |
| --- | ---: |
| Active Staff | 6 |
| Inactive Staff | 0 |
| Linked Staff/User relationships | 0 |
| Employment-dependent accounts | 4 |
| Active employment accounts lacking eligible Staff | 4 |
| Broken User references | 0 |
| Duplicate Staff/User claims | 0 |

No names, emails, private contact fields, credentials or tokens were printed during the database inspection. No identity mappings were inferred. The separate [human review summary](staff-user-linking-onboarding-review.md) describes the remaining school verification work.

## D. Implementation

`StaffAccountLinks` operates exclusively on existing `Staff`, `User`, role, session-version and Sanctum records. Administrator routes are:

- `GET /api/v1/users/{user}/staff-link`: current minimal account/Staff context and explicitly searched, paginated Staff choices (20 per page).
- `PATCH /api/v1/users/{user}/staff-link`: create or remove an explicitly reviewed relationship.

Mutation requires `staff_id` (nullable for unlink), `expected_staff_id` (nullable when unlinked), `expected_session_version`, a SHA-256 `staff_revision`, and accepted `identity_confirmed`. Extra fields are rejected. Staff revision covers the visible identity and employment fields, the current claim, department and update timestamp; identity changes within the same timestamp second are detected.

The transaction locks the existing System Administrator role row as the common administrative mutex, then actor/target Users in ID order, then the selected Staff row. It rechecks current administrator authority and actor epoch/token after waiting for locks. It compares the reviewed target version/current link and Staff revision before any write. Existing uniqueness remains the database backstop. Deadlock retries are bounded to three transaction attempts.

An already-linked account cannot receive a replacement link, and an occupied Staff identity cannot be reassigned. Removal must be confirmed separately before a new association can be reviewed. Inactive Users or Staff cannot acquire new links; Teachers require teaching Staff. Incompatible portal/Student roles cannot acquire links. Cleanup unlinking remains possible for inactive or legacy incompatible records.

Responses preserve standard authentication/validation conventions: 401 for invalidated authorization, 403 for unauthorized roles, 404 for missing identities, 422 for invalid or incompatible selections, and 409 for stale/claimed relationships. Existing API throttling remains in place.

Both HR create and update explicitly reject `user_id`, including explicit null. HR employment edits use the same locking order and revoke the linked account when employment status or Staff type changes. User role edits validate any current Staff association; changing to an incompatible role requires a separately confirmed unlink first.

## E. Authorization

Only an active System Administrator can read account-link context or mutate links. Route middleware and fresh server-side service checks both enforce this; browser role checks only control presentation. Head Teacher, Deputy Head Teacher, Teacher, Sponsor Coordinator, Parent/Guardian, Sponsor and Student cannot manage links. No new delegated permission was added.

Head, Deputy, Teacher and Sponsor Coordinator continue to require active Staff. Teacher-specific permissions continue to require teaching Staff and actual academic assignments. Linking creates no class/subject assignment or learner ownership. Parent/Guardian and Sponsor ownership scopes remain unchanged. System Administrator membership is optional and creates no operational Health access; the explicit Health exclusion remains intact.

## F. Session/token invalidation

Every successful link or unlink advances only the affected User's `session_version` and deletes all of that User's Sanctum tokens in the same transaction as the Staff relationship and success audit. Old cookies and bearer tokens cannot inherit the new relationship. Affected users must sign in again; unlinked employment accounts still fail employment gates after fresh authentication.

Employment status/type changes also advance the linked User epoch and revoke tokens, including reactivation. User role changes now revoke bearer tokens as well as advancing the existing cookie epoch. Unrelated accounts, sessions and tokens remain untouched. Current-device logout behavior and the last-active-administrator protection are preserved.

## G. Administrative interface

The existing Users table shows Staff link and employment eligibility, with an accessible per-account management button. The shared modal displays account role/status, current link, eligibility, explicit Staff search/pagination, disabled incompatible/occupied choices, an initially blank selection, a required human identity attestation and a second confirmation naming the exact pair. No automatic match or default identity is selected.

The reviewed pair and session version are frozen before confirmation. Pending submissions cannot duplicate the mutation. Conflicts block resubmission until an explicit reload, which clears selection and verification. Authorization loss removes private identity context. Self-account changes sign the administrator out. The existing HR profile directs account-link management to Administration.

The workflow uses existing theme variables, the responsive Administration table/detail layout, wrapping action controls and the shared keyboard focus trap, Escape handling, background inertness and focus restoration. Async content moves focus into the loaded form. Checkbox sizing is explicitly corrected against the shared full-width field rule.

No browser was connected to the computer-use tool (browser inventory was empty), so screenshot-based Light/Dark and narrow-screen visual inspection could not run. Static theme/responsive review and automated interface/shared keyboard-dialog tests passed; browser visual verification remains a stated validation limitation.

## H. Audit behavior

Success actions are `LINK_STAFF_ACCOUNT` and `UNLINK_STAFF_ACCOUNT`, recording administrator, target User and Staff ID inside the transaction. An audit failure rolls back the relationship, epoch and token deletions.

Global failure middleware records `STAFF_ACCOUNT_LINK_REJECTED` for rejected link mutations and legacy HR `user_id` claims, including failures before the controller from authentication/role middleware. It stores target ID, HTTP status and a safe classification only. It never records submitted identities, contact details, passwords, tokens, cookies or revision values. Successful HR edits continue to audit changed field names only. Audit infrastructure failure fails the operation rather than silently committing an unaudited link.

## I. Tests and results

All final safe suite runs passed:

| SQLite-memory suite | PASS lines |
| --- | ---: |
| Staff account links, including shared authorization | 28 |
| Health timestamps, including Health authorization | 61 |
| Password recovery and authentication | 63 |
| Attendance | 18 |
| Assessment history | 33 |
| Learner/Guardian | 12 |
| Teacher Workspace | 39 |
| Parent Portal | 57 |
| Sponsor Coordinator Workspace | 82 |
| Academic structure | 15 |
| Announcements | 32 |
| **Total (shared prerequisites repeat across suites)** | **440** |

The new linking suite covers all allowed employment roles, every excluded role, optional administrator membership/Health denial, minimal projections/no-store, explicit confirmation, old bearer/cookie rejection, unrelated sessions, no inferred academic assignment, duplicate claims, direct replacement, stale account versions and same-second Staff changes, inactive/incompatible cases, raw HR claims, linked-role compatibility, employment revocation/reactivation, success/rejection audit safety and link/unlink rollback.

`tests/safe/staff_account_links_mysql.ps1` passed six MySQL cases: two actual concurrent claim races, reviewed unlink, full rollback after an audit insert, queued administrator demotion and queued actor epoch/token revocation. Each race starts independent PHP processes with reviewed requests behind a held administrative row lock, then releases the lock. Exactly one claim succeeds and one returns conflict, with only the winning account revoked. The fixture uses cached images, no host ports, network `none`, RAM-only MySQL storage and read-only application/vendor mounts. Its database name and UUID guards reject development. Every owned fixture container was removed.

All **94 frontend tests** passed, including nine new account-link cases plus existing scoped workspaces, portals, navigation, form errors and shared keyboard/modal behavior. PHP lint passed all ten changed/new PHP files. JavaScript syntax checks passed account-links, HR Staff and Administration inline scripts. PowerShell launcher parsing, Pint's six application PHP checks and `git diff --check` passed.

Backend SQLite suites ran in unnetworked containers with read-only source/vendor mounts and explicitly configured `:memory:` databases. The standalone linking suite also passed using host PHP. No destructive development tests ran. Temporary approval-service HTTP 429 failures affected some launches; retries through the same approval path succeeded.

Reproduction from the repository root:

```powershell
D:\xampp\php\php.exe tests\safe\staff_account_links.php
powershell -NoProfile -File tests\safe\staff_account_links_mysql.ps1
node --test tests/frontend/*.test.cjs
```

The SQLite harness explicitly skips dotenv, refuses cached configuration/routes and allows only its memory connection. The MySQL script refuses ordinary execution without its paired disposable launcher.

## J. Schema/migrations

None. The existing nullable unique foreign key and already-applied session-version column suffice. No historical migration was edited. No reset, reseed, wipe or development migration command was run.

## K. Development preservation

Before/after read-only snapshots covered all 43 tables: schema definitions, indexes/FKs/checks, row counts, ordered row and per-column fingerprints, native MySQL checksums, table metadata/sequences, migration ledger and aggregate linkage counts. The two complete snapshot files were **byte-identical**, SHA-256 `8D66517552B12177FCE859E24B77475D69032D678DA840246E56AC040C1B6C4E`.

All live school, Staff/User, learner, Guardian, academic, sponsorship and Health data remained unchanged. There are still six active unlinked Staff and four ineligible active employment accounts. No live identities were created and no relationship was modified. Source migrations remain applied exactly once. Protected inspection/test evidence stays in ignored `storage/app/private/staff-user-linking-20261012T083252Z-3e92b7a1/`; it is not committed.

## L. Required human verification

Follow the separate [onboarding review](staff-user-linking-onboarding-review.md). The school must establish account ownership and Staff identity using authoritative records and the person's confirmation, verify current employment/role/type and review the exact User/Staff pair before an administrator acts. Names, email similarity and job titles alone are insufficient. This checkpoint implements the capability only; all real mappings remain pending school verification.

## M. Files changed

- `app/Services/StaffAccountLinks.php`
- `app/Http/Middleware/AuditStaffAccountLinkFailures.php`
- `app/Http/Controllers/Api/StaffController.php`
- `app/Http/Controllers/Api/UserController.php`
- `app/Http/Kernel.php`
- `routes/api.php`
- `public/administration.html`
- `public/assets/account-links.js`
- `public/assets/staff.js`
- `tests/safe/authorization.php`
- `tests/safe/password_recovery.php`
- `tests/safe/staff_account_links.php`
- `tests/safe/staff_account_links_mysql.php`
- `tests/safe/staff_account_links_mysql.ps1`
- `tests/frontend/account-links.test.cjs`
- This checkpoint report and `docs/staff-user-linking-onboarding-review.md`.

## N. Local commit

One local commit contains the implementation, safe tests and these reports, titled `Secure administrator Staff/User account linking`. Its hash is returned in the completion message and available with `git log -1 --format=%H`. It is intentionally not embedded in its own committed tree. No push is authorized or performed.

## O. Final Git state

Completion requires a clean working tree on `feature/production-ui`, seven commits ahead of the existing origin tracking reference and none behind. The actual post-commit status and hash are verified and returned in the completion message. No Health frontend or other module follows this checkpoint.
