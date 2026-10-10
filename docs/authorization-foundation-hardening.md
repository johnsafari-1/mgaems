# Authorization foundation security hardening

Workspace: `D:/mgaems`; branch: `feature/production-ui`; baseline:
`d067689fb7c228b6ca0d4e96059551d040f4ca2f`.

The initial verification found six modified application files and an untracked
authorization runner, despite the supplied clean-tree checkpoint. The user
subsequently authorized reviewing, extending, and including those changes in
the single local commit. No unrelated repository was accessed.

## Weaknesses and fixes

* Sanctum authentication previously accepted existing bearer tokens and web
  sessions without a shared current-account status check. `Authenticate` now
  reloads the authenticated account and role, preserving its current token,
  and refuses every non-active account with the existing
  `ACCOUNT_INACTIVE` 403 envelope. A requesting session is logged out,
  invalidated, and given a new CSRF token.
* User PATCH and soft-deactivation previously left Sanctum tokens valid.
  Both now perform the account update, all-target-token revocation, and audit
  write in one transaction. Inactive and locked accounts lose all tokens,
  including expired tokens. Repeated deactivation cleans up stray tokens.
  Reactivation does not restore revoked tokens or invalidate other users'
  tokens.
* Login could issue a token after checking an account that was subsequently
  deactivated. Login now locks and rereads the user inside the issuance
  transaction. Account updates lock the same user. Last-administrator checks
  and changes also serialize on the System Administrator role row.
* Role checks alone allowed employment-derived privileges after Staff was
  terminated, placed on leave, unlinked, or reassigned. `EnsureRole` queries
  the current active `staff.user_id` relationship for Teacher, Head Teacher,
  Deputy Head Teacher, and Sponsor Coordinator. Neither names/emails,
  supplied Staff IDs, nor cached Staff objects establish permission.
* Session-authenticated logout previously attempted to delete Sanctum's
  transient token. Logout now distinguishes persistent personal access
  tokens from sessions, deleting only the current bearer token or
  invalidating the current session, with the same success response.
* Staff updates previously copied personal field values into audit details.
  They now record changed field names only. The new authorization paths add
  no passwords, hashes, bearer tokens, cookies, or Staff personal values to
  audit details.

## Preserved behavior and authorization review

All protected v1 APIs still pass through `auth:sanctum`. No route roles,
Attendance/Assessment services, ownership queries, frontend assets, or
navigation were changed. Missing role authentication returns the existing
401 envelope; normal authentication and Laravel validation responses retain
their existing conventions. Staff-ineligible role permissions return the
existing `FORBIDDEN` 403 envelope.

System Administrator remains independent of Staff, including when a linked
Staff record is terminated. Parent and Sponsor portal roles retain their
own-record policies and also remain independent of Staff. Active Staff-role
users who lose employment permissions can still use shared authenticated
endpoints and logout.

At the protected HTTP boundary, Head Teacher and Deputy Head Teacher now
require active Staff, like the other employment-derived roles. Once eligible,
their school-wide Attendance and Assessment oversight remains intact. An
ordinary teacher still requires active **teaching** Staff and Class Teacher
ownership for Attendance; subject assignments alone grant no Attendance
rights. Assessment continues to require the exact class/subject/term
assignment. System Administrator retains school-wide access without Staff.
This shared gate supersedes older notes describing unlinked Head/Deputy
Teacher access at the API boundary; underlying domain rules are unchanged.

Review covered token/session authentication, cached roles and identities,
Staff status and linkage changes, client ID/role spoofing, portal ownership,
bearer-role demotion, unauthorized user-management requests, the last-admin
guard, transactional rollback, and audit details. No additional bypass was
found in the reviewed application API paths.

## Isolated validation

Run from `D:/mgaems`:

```powershell
php tests/safe/authorization.php
php tests/safe/attendance.php
php tests/safe/assessment_history.php
php tests/safe/learner_guardian.php
node --test tests/frontend/*.test.cjs
git diff --check
```

The authorization runner skips dotenv, refuses cached configuration/routes,
replaces every database connection before providers boot, and accepts only
its sole SQLite `:memory:` connection. Sessions and cache use array storage;
exception logging uses a null handler. HTTP checks use the production router,
real Sanctum bearer tokens, and encrypted session cookies. Guards and session
attributes are cleared between simulated requests; cookie data is retained
only by the in-memory session handler. No repository migrations are run by
this runner.

The existing regression runners likewise replace all connections with
explicit in-memory SQLite fixtures before boot. Assessment history runs its
additive migration only against those fixtures and uses in-process report
storage. No development MySQL tests, database reset/wipe/reseed, `.env.testing`,
or PHPUnit configuration were used or created.

Final results: 18 authorization checks; 18 Attendance checks; 15 Academic
Structure checks and 18 Assessment/report history checks (both run by the
assessment-history command); 12 learner/guardian checks; 33 frontend tests.
All 114 checks passed. Syntax checks on every changed PHP file and whitespace
checks passed. The older Academic Structure and learner/guardian fixtures
now explicitly test denial of unlinked leadership and success with active
Staff; their earlier failures were fixture mismatches with the new gate.

## Limits and deferred work

* SQLite does not validate concurrent MySQL row-lock behavior. The lock order
  was reviewed, but concurrent MySQL execution was deliberately not tested.
* A request already authorized before deactivation can finish; authorization
  is checked on subsequent requests, without globally serializing APIs.
* Sessions are denied while inactive and invalidated when presented. Dormant
  sessions are not globally enumerated or deleted. Reactivation before an old
  session is presented can make that dormant session usable again.
* Token deletion applies to the supported User PATCH/DELETE paths. Direct
  database/bulk status changes are still denied by the per-request gate but
  do not trigger controller token cleanup. Maintenance tools should revoke
  tokens when changing account status outside these APIs.
* Staff activation, linkage, and user reactivation remain explicit existing
  administrative workflows. Deployment should ensure employment-derived
  accounts have an active linked Staff record; no records were backfilled.
* Existing audit behavior outside the changed authorization/Staff-update
  paths was not redesigned. Existing failed-login username logging remains.
* Live browser workflows, production deployment, Health & Welfare, Streams,
  and finance are deferred. No push to GitHub was performed.
