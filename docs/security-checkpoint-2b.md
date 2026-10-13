# Security Remediation Checkpoint 2B — Laravel 13

Prepared 2026-10-13. This checkpoint changes source and builds isolated images;
it does not deploy, push, migrate development MySQL or activate the new local runtime.

## A. Starting state and isolation

Repository `D:\mgaems`, branch `feature/production-ui`, expected and verified HEAD
`970059389647ec8bc3a111279f58327f552fe1c4`, clean working tree, two local commits
ahead of the remote-tracking reference. Reviewed the 2A plan, staging report,
Composer files, traditional bootstrap/kernels, authentication, middleware,
migration definitions and existing safe tests.

Dependency resolution used PHP **8.3.35**, Composer **2.10.3** and the staging
base's required PHP extensions. A sanitized snapshot contained 271 regular
source/test files; no `.env`, development vendor, dumps, uploads, private school
documents or runtime logs were copied. Candidate dependencies used a separately
owned Linux Docker volume. Tests used read-only source/dependency mounts and RAM
runtime files. No operations targeted the running `mgaems-app` or `mgaems-mysql`
containers or their dependency/data volumes.

Compose bind mounts source, so compatible committed source changes are visible
to the old application until the coordinated transition below. Its PHP image and
installed dependency volume remain unchanged. Legacy framework compatibility and
PHP 8.2 source syntax were checked; this does not upgrade or certify the security
of the still-running Laravel 10 runtime.

## B–D. Dependencies, resolution and audit

| Package | Before | After |
| --- | --- | --- |
| Laravel Framework | 10.50.2 | 13.35.0 |
| Sanctum | 3.3.3 | 4.3.3 |
| Laravel-DOMPDF | 2.2.0 | 3.1.2 |
| DOMPDF | 2.0.8 | 3.1.6 |
| CommonMark | 2.8.3 | 2.10.3 |
| Flysystem | 3.35.2 | 3.36.0 |
| Laravel Excel | 3.1.69 | 3.1.70 |
| PhpSpreadsheet | 1.30.6 | 1.30.7 |
| Carbon | 2.73.0 | 3.14.2 |
| Symfony Console / HttpFoundation | 6.4.43 | 7.4.20 |
| PHPUnit | 10.5.64 | 12.5.39 |
| Faker | 1.24.1 | 1.24.1 |
| Pint | 1.20.0 | 1.32.1 |
| Mockery | 1.6.15 | 1.6.15 |

Production packages: 76 → 89; development packages: 30 → 29. New transitives
include maintained framework support libraries and DOMPDF's renamed font/SVG
dependencies. Essential application dependencies were retained; Excel remains on
its compatible patched 3.1 API rather than adding a separate 4.x migration.

The approved constraints resolved in a PHP 8.3 dry run, then generated a new lock.
An initial Windows bind-mount extraction timed out; installing the same resolved
lock in the owned Linux volume succeeded. This was filesystem extraction latency,
not a dependency conflict. No platform exceptions, advisory ignores, disabled
security blocking or suppressed findings were used. Explicit root floors cover
DOMPDF, CommonMark and Flysystem as reviewed in 2A. Composer strict validation and
actual platform checks passed.

**Production security audit: zero advisories, zero abandoned packages, exit 0.**
The full audit including development packages also returned zero advisories and
zero abandoned packages. All five previously affected packages are patched; the
24 old entries were not filtered or dismissed. Rerun the feed at deployment time.

## E–I. Compatibility, authentication and migrations

The 10→11, 11→12 and 12→13 upgrade guides were evaluated cumulatively. The result
keeps `bootstrap/app.php`, the HTTP/console kernels, exception handler, provider
registration, guards, routes, role middleware and existing API response envelopes.
No new application skeleton, Staff/User relationship, clinical workflow or UI
phase was introduced.

- **Password recovery:** replaces signed `diffInMinutes` with an explicit UTC
  deadline. Existing offset-free database timestamps retain their school-timezone
  interpretation; both instants are compared in UTC. A token expires at exactly
  60 minutes. Future, null, malformed and normalized-invalid timestamps fail
  closed. Single-use consumption, transaction rollback, credential update,
  durable session-version increment and token revocation remain intact.
- **Password column:** `getAuthPasswordName()` identifies `password_hash`; no
  redundant `password` column was added. Tests cover both the framework provider
  and the custom bearer-login path.
- **Rehashing:** verified current passwords may be rehashed inside the existing
  issuance transaction/row lock on Laravel 11+, respecting `rehash_on_login`.
  Wrong passwords cannot trigger rehash. Rehash preserves the credential and
  account epoch; other bearer devices remain valid. The old Laravel 10 login path
  retains its prior hashing behavior until the controlled runtime transition.
- **Sanctum:** reviewed 4.x session/CSRF keys and session middleware. The legacy
  CSRF key remains as a bridge; the extra Sanctum session middleware is enabled
  only on 4.x. Staging retains bearer mode with an empty stateful-origin list.
- **Request forgery:** the existing custom `VerifyCsrfToken` class remains for
  legacy compatibility; Laravel 13's alias delegates to its new origin-aware
  implementation. Missing, cross-site and same-site requests without credentials
  are rejected; traditional CSRF tokens and Laravel 13 same-origin metadata work.
  No blanket route exemptions or authentication shortcuts were introduced.
- **Sessions/cache:** existing nonstaging sessions explicitly retain PHP
  serialization. New empty staging uses JSON, with encryption/Secure/HttpOnly/Lax
  settings. Integer epoch markers survive both formats. File cache retains scalar
  data and disables arbitrary class restoration.
- **Merged defaults:** Laravel 13 merges framework mailers into application
  configuration. The staging provider now enforces the sole array mailer after
  that merge, so explicit named SMTP/log mailers cannot deliver or log messages.
  The staging connection also explicitly retains the existing no-URL-override
  MySQL configuration contract.
- **Fixture failure handling:** standalone staging checks now exit nonzero on
  assertion/unhandled failures. Runner completion markers prevent Laravel's
  console exception handler from turning an incomplete check into a passing
  process exit. This caught and resolved the merged-mailer issue during testing.

### Sanctum migration ownership

Added `2019_12_14_000001_create_personal_access_tokens_table.php` to application
migrations with the **exact locked Sanctum 3.3.3 definition and original identity**.
It is a new repository-owned file; no previously tracked/applied migration was
rewritten. Sanctum 4 does not automatically load its vendor migration.

This deliberately retains the old VARCHAR token name and unindexed nullable
expiry column. It does not silently adopt the newer vendor TEXT/index changes.
Short existing token names and current token behavior work under Sanctum 4. Any
future widening/index change requires a separately reviewed additive migration.
Do not blindly publish vendor migrations with a new timestamp or manually edit
the migration ledger.

## J–L. Database, regression and image results

| Verification | Result |
| --- | --- |
| Fresh MySQL | All 39 migrations passed, 43 tables, no Streams, no automatic seeding; repeat migration had no pending work |
| Existing-schema transition | Old Laravel 10 image created a disposable baseline and one synthetic token; Laravel 13 preserved every column, index, FK, migration-ledger entry, credential and token record |
| Sanctum compatibility | Original migration identity recorded exactly once; pre-upgrade bearer token authenticated its original owner under Sanctum 4 |
| MySQL upsert | Existing key updated once; empty `uniqueBy` rejected as required by Laravel 13 |
| Existing safe backend | All 14 suites passed: 579 PASS executions, including two new recovery groups |
| Added upgrade suite | 6 new groups plus its 18 authorization prerequisites passed; 24 PASS executions |
| Combined safe backend | 15 suites, 603 PASS executions; reused prerequisites mean this is not a unique assertion count |
| MySQL concurrency/privacy | Health 4, sponsorship 4 and Staff/account links 6 groups passed in three independent disposable fixtures |
| Frontend | All 196 tests passed; no frontend assets changed |
| Staging integration | 27 groups passed: installation/admin, Apache/PORT, simulated HTTPS proxy/cookies, bearer login/logout, Health/anonymous denial, mail sink, private files, PDF/XLSX publication/downloads and volume replacement |
| Existing-schema fixture | 6 PASS groups across baseline/upgrade |
| Image inspection | 50 checks passed, including seven reviewed dependency floors and exclusion of secrets/private files/dev packages |
| Composer | Strict validation, actual PHP 8.3 platform requirements, production and full security audits passed |
| Production image | PHP 8.3/Apache build, no-dev install, authoritative autoload, package discovery and runtime platform checks passed |
| Syntax / static checks | 217 PHP files passed on both PHP 8.2 and 8.3; 15 JS modules, fixture PowerShell, startup shell and whitespace checks passed; 35 unchanged public resources/navigation destinations verified |

The safe suites cover Head/Deputy leadership, active Staff eligibility, Teacher
class/subject/term scoping, Class Teacher attendance, Parent ownership and
child-switch protection, Sponsor/Coordinator boundaries, System Admin Health
exclusion, confidential incident revisions/audit payloads, published report
access, UTC health precision and durable session/token invalidation. Negative
requests are tested alongside authorized requests.

Actual production dependencies generated a retained PDF through the publication
API, verified its stored SHA-256, downloaded identical bytes, and retained that
artifact after a later revision. XLSX output was opened and checked for headings,
dates, filters and learner values. Anonymous downloads/exports were denied.
DOMPDF remote fetch and PHP execution remained disabled. All data was synthetic
and confined to owned fixtures, never the school database.

MySQL fixtures used the cached 8.0 image (8.0.46), network `none`, no published
ports and RAM-only database files. Application containers shared only the owned
fixture's network namespace. No development `.env`, data volume or vendor volume
was mounted. Ownership labels/IDs/names were verified before cleanup. Test a
maintained engine version selected for Railway before provisioning; this result
does not certify every MySQL version or a live-school migration ledger.

Existing feature files using unrestricted `RefreshDatabase` defaults were not
launched against the workstation. The designated safe suites and guarded staging/
MySQL fixtures were used. PHP 8.2/8.3 source syntax, JavaScript, shell/PowerShell,
navigation and asset checks accompany the report's final verification evidence.
Manual browser/PDF visual QA and actual Railway acceptance remain pending.

### Repeating guarded staging checks

```powershell
docker build -f Dockerfile.staging -t mgaems-staging:security2b .
powershell -NoProfile -File tests/safe/staging_mysql.ps1 -Image mgaems-staging:security2b
powershell -NoProfile -File tests/safe/staging_schema_mysql.ps1 -Image mgaems-staging:security2b -LegacyImage mgaems-staging:review
```

The last command requires a retained **Laravel 10** baseline image; the script
refuses an upgraded baseline. The prior image ID is
`sha256:05a4a6fc88c7746f23f2923155a6127a721add0e450cfbe0ee5d15e8dfd28c3e`.
Do not overwrite it before retaining the baseline. The scripts mount only their
fixture PHP files and newly owned storage, not the repository's private files.
Backend orchestration and complete captured output are retained locally under
Git-ignored `storage/app/private/security-checkpoint-2b-20261013/`.

Final repository image: `mgaems-staging:security2b`, inspected ID
`sha256:a87afcedcb977173b693a7b92e13c192b4f0045d79c4b24530a6e143beb20591`.
Final fresh evidence: `storage/app/private/staging-check-a991dcd7/`; final
existing-schema evidence is under `storage/app/private/schema-check-<run-id>/`.
Owned fixture containers/file volumes and the separate candidate dependency
volume were removed after verification. Production images and local evidence
remain for review; no development container or volume was removed.

## M. Controlled development PHP 8.3 transition — not executed

`docker/php/Dockerfile` now declares PHP 8.3 and GD JPEG/FreeType support for
runtime parity. Compose, MySQL configuration, local volumes and the local
`artisan serve` command are unchanged. The running image/dependency volume was
not rebuilt, replaced or updated. **Do not install this lock in the current
PHP 8.2 container.** Do not mount its dependency volume into upgrade tests.

After review, coordinate an operator maintenance window:

1. Record the current app image/container identity and lockfile; retain the old
   image and an isolated backup of the old dependency volume. Confirm normal
   database/file backups and the actual token-table schema/ledger using read-only
   checks. If the original migration identity is missing or schema differs from
   the tested baseline, stop for a specific plan; do not force a migration.
2. Stop **only the application**; keep MySQL and its data volume intact. Build
   the prepared app image without bringing Compose services up automatically.
3. Run one-off PHP 8.3 containers against the normal development mounts only in
   this reviewed transition. Verify PHP. Clear configuration/routes/views using
   the compatible old vendor before installing the new lock, preventing old
   cached provider/configuration manifests from being reused.
4. Install the exact lock in the development dependency volume. Validate Composer
   consistency/platform requirements and rerun the current production audit.
   Discovery/caches are filesystem operations; do not invoke migrations or seeding.
5. Clear/rebuild appropriate runtime caches and start only the application service.
   Preserve `APP_KEY`, school timezone, database references, cookie identity and
   nonstaging PHP session format. Confirm login/read-only role workflows and
   credential/session behavior. Do not invent school records for smoke tests.

Example commands for that **future reviewed window**, not this checkpoint:

```powershell
docker compose stop app
docker compose build app
docker compose run --rm --no-deps app php -v
docker compose run --rm --no-deps app php artisan config:clear
docker compose run --rm --no-deps app php artisan route:clear
docker compose run --rm --no-deps app php artisan view:clear
docker compose run --rm --no-deps app composer install --prefer-dist --no-interaction --no-progress
docker compose run --rm --no-deps app composer validate --strict
docker compose run --rm --no-deps app composer check-platform-reqs
docker compose run --rm --no-deps app composer audit --locked --no-dev
docker compose run --rm --no-deps app php artisan config:clear
docker compose up -d --no-deps app
```

Never run `docker compose down -v`, `migrate:fresh`, `db:wipe`, general seeders or
automatic real-database migrations. No schema migration is needed for a runtime
transition matching the verified existing ledger/schema. A rollback restores
the previous app source/image/vendor together, leaving MySQL/file volumes and
`APP_KEY` intact; do not reinstall the old framework into the new vendor blindly.
Do not use old test wrappers' hardcoded PHP 8.2/development vendor defaults with
the new lock; recreate sanitized PHP 8.3 fixtures as described in the 2A strategy.

## N–R. Changed files, limitations and recommendation

Changed source/configuration: Composer files, User/password authentication and
recovery, staging provider, cache/Sanctum/session configuration, staging and
development Dockerfiles. Added the owned token migration. Added upgrade and
existing-schema tests; strengthened recovery, staging image/integration tests and
fixture runners. Updated deployment documentation and added this report. The final
Git file list is the authoritative enumeration:

- `composer.json`, `composer.lock`, `Dockerfile.staging`, `docker/php/Dockerfile`
- `app/Models/User.php`, `app/Http/Controllers/Api/AuthController.php`,
  `app/Http/Controllers/Api/PasswordResetController.php`, `app/Providers/StagingServiceProvider.php`
- `config/cache.php`, `config/sanctum.php`, `config/session.php`
- `database/migrations/2019_12_14_000001_create_personal_access_tokens_table.php`
- `tests/safe/password_recovery.php`, `tests/safe/framework_upgrade.php`,
  `tests/safe/staging_install.php`, `tests/safe/staging_image.php`,
  `tests/safe/staging_mysql.ps1`, `tests/safe/staging_schema.php`,
  `tests/safe/staging_schema_mysql.ps1`
- `docs/railway-staging.md`, `docs/security-checkpoint-2b.md`

Remaining limits: browser/PDF visual review, actual Railway networking/TLS/volume
acceptance, chosen supported MySQL validation, load/OS image scanning and backup/
restore certification. The MariaDB dump-client compatibility and existing backup
process password argument remain separate hardening work. Mail is intentionally
discarded in staging, and the existing reset-page UI is incomplete. LocalStorage
bearer tokens and indefinite token lifetime, spreadsheet formula-like text and
eventual Excel 4 migration remain separately reviewed risks. No real-school data
belongs in this demonstration staging environment.

**GO for the reviewed controlled local PHP 8.3 transition**, subject to the actual
ledger/schema preflight and coordinated image/vendor/cache procedure. Current
running development Laravel 10 remains unsupported until that transition occurs.

**Conditional GO for an empty demonstration Railway staging installation using
the upgraded image and runbook; no deployment authorization or resources were
created here.** Complete operator review, supported-engine checks and external
TLS/storage/health acceptance before public use. No unresolved production advisory
or critical upgraded regression remains in the verified local artifact. Real
school/clinical deployment is outside this demonstration checkpoint.

One local commit is required after final verification. Nothing is pushed or
deployed; the final completion message records the actual commit and Git status.
