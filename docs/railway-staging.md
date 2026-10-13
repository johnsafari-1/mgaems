# Railway demonstration staging preparation

Prepared 2026-10-13 from `feature/production-ui`, starting commit
`7ef7edd2650e864de389f5e6668a5bd19aeca49a`. The starting tree was clean.

**Recommendation: NO-GO for public deployment.** Local packaging and fresh
installation work, but the locked dependencies have security advisories and
Laravel 10 is outside security support. No Railway resources were created, no
changes were pushed, and the development database was not connected to, reset,
seeded or migrated. This is preparation for review, not a deployed environment.

## Readiness audit and blockers

| Area | Finding / decision |
| --- | --- |
| Framework | Locked Laravel 10.50.2; security support ended 2025-02-04. Upgrade to a supported release in a separately reviewed task before public access. |
| PHP | Composer requires PHP `^8.1`. The dedicated image uses PHP 8.3 / Apache on Debian Bookworm, within Laravel 10's documented PHP range. PHP 8.3 receives security fixes through 2027-12-31. The local build ran PHP 8.3.35. |
| Dependency audit | `composer audit --locked --no-dev --format=json` failed with **24 advisory entries across five packages**, none abandoned. Counts below are entries in that response, not necessarily distinct CVEs. The lock file was preserved. |
| Local Docker | Existing PHP 8.2 CLI / `artisan serve`, development Compose credentials, bind mounts and MySQL remain unchanged. They are not the staging deployment configuration. |
| Empty database | All 39 existing migrations succeeded on an isolated, initially empty MySQL 8.0 fixture, producing 43 tables. No migration or schema changes were needed. |
| Authentication | Existing API uses bearer tokens stored by the frontend. Staging keeps Sanctum in bearer mode to avoid same-origin login being interpreted as a cookie/CSRF flow. Web CSRF protections and authorization policies remain intact. Existing browser token storage and indefinite token lifetime need a separate security review before handling real data. |
| Sessions | Database sessions, encrypted payloads, host-only Secure / HttpOnly / SameSite=Lax cookies, unique staging cookie, HTTPS proxy handling. |
| Email | Staging registers only an in-memory `array` mailer, including when SMTP variables are inherited. It neither delivers mail nor logs reset messages. No real family addresses or SMTP credentials should be configured. |
| Password recovery | Recovery API regression and HTTP smoke checks pass. Mail is intentionally discarded. The generated `/reset-password` URL has no working reset page in the existing UI, so end-to-end self-service recovery is unavailable. Keep administrator credentials in an operator password vault. |
| Files / PDFs | Private disk remains `storage/app/private`; only `storage/app/public` is linked for public access. Fonts and rendering scratch files are on the application volume. A production-dependency PDF smoke check passed. No real learner documents were used. |
| Health / logs | Staging-only `/healthz` is stateless and returns generic 200/503 readiness after checking the connection and required schema markers. Apache logs to stdout/stderr without query strings; Laravel logs to stderr. Debug and exception argument exposure are disabled. |
| Backups | A `mysqldump` binary is available, but Debian supplies MariaDB client 10.11.18. The existing backup endpoint and restore compatibility with Railway's selected MySQL version have not been certified. Its existing process invocation also passes the password as an argument. Use a reviewed database-and-file-volume backup plan and restore drill before retaining important data. |
| Railway acceptance | Actual Railway networking, TLS, runtime limits, volume permissions, SSH and health-check behavior remain untested. No Railway account or resources were accessed. |

Locked production dependency audit, captured locally on 2026-10-13:

| Package | Advisory entries |
| --- | ---: |
| `dompdf/dompdf` | 6 |
| `laravel/framework` | 4 |
| `league/commonmark` | 12 |
| `league/flysystem` | 1 |
| `maatwebsite/excel` | 1 |

These include file/path handling, XSS, denial-of-service and email validation
issues. Passing authorization regressions does not resolve library advisories.
Reconcile every finding, update the framework and dependencies, rerun the audit
and regressions, and obtain deployment review before public exposure. The local
image is a diagnostic preparation artifact, not a security approval.

## Image and storage

`Dockerfile.staging` is separate from local Docker. It installs production
Composer dependencies from the lock, builds an authoritative autoloader and
checks platform requirements. It includes MySQL PDO, XML/DOM, mbstring, GD with
JPEG/FreeType, ZIP, intl, bcmath, fileinfo, curl and OPcache. Apache serves only
`public/`, forwards Authorization, listens on `PORT` and runs in the foreground.
PHP is configured for production errors, a 128 MB per-request limit and 8 MB
uploads. Apache starts with one worker and caps at four workers; measure memory
before choosing service limits. Composer, PHPUnit, Faker and Mockery are absent
from the final image.

Startup validates the environment, prepares runtime directories and the public
storage link, rebuilds configuration/view caches, then starts Apache. **It never
runs migrations, seeders or administrator creation.** Keep the image entrypoint;
do not configure `php artisan serve` or override it with a migration command.

The build context uses a source allowlist and additional sensitive-file
exclusions. Local `.env` files, Git metadata, dumps, backups, private documents,
uploads, logs, archives, generated caches and development exports are excluded.
No local sensitive files were deleted. Application storage is freshly created
in the image, not copied from the workstation. Branding assets were not edited.
LF attributes protect the shell entrypoint when checked out on Windows.

For a future approved deployment, use one application replica and one fresh
MySQL service in the same private Railway environment. Attach an application
volume at **`/var/www/html/storage`** and a separate database volume managed by
the MySQL service. The app volume retains private uploads, report PDFs and fonts.
Without it these files disappear on replacement. Back up both volumes. Mounted
volumes exist at runtime; do not assume access during builds or pre-deploy jobs.
Allow for deployment downtime with a single volume-backed replica.

File cache and synchronous queues avoid extra Redis/worker services. The current
schema has no database cache or jobs tables; do not switch those drivers to
database without a separately reviewed change. Use private MySQL networking,
no public database TCP proxy, conservative resource limits and account spending
alerts. This work did not estimate a guaranteed monthly cost.

## Required Railway configuration

The examples below are references or non-secret settings, not credentials.
Adjust the reference namespace if the database service is not named `MySQL`.
Never import the workstation `.env`, a database dump, school records, real family
email addresses or local private storage.

| Variable / setting | Required value or source |
| --- | --- |
| Repository root | `/` |
| `RAILWAY_DOCKERFILE_PATH` | `Dockerfile.staging` (custom filename must be selected explicitly) |
| Build / start override | Leave unset; use the Dockerfile and its entrypoint |
| Pre-deploy command | Leave unset; no automatic migrations or seeding |
| `APP_NAME` | `MGAEMS Staging` |
| `APP_ENV` | `production` |
| `MGAEMS_STAGING` | `true` |
| `APP_DEBUG` | `false` |
| `APP_KEY` | Fresh secret generated for this staging environment only; never use the development key |
| `APP_URL` | Exact future public HTTPS origin, without a path, query or credentials |
| `PORT` | Railway's configured/injected HTTP port; image defaults to `8080`. Domain target port must match. |
| `DB_CONNECTION` | `mysql` |
| `DB_HOST` | `${{MySQL.MYSQLHOST}}`, private hostname of the new service |
| `DB_PORT` | `${{MySQL.MYSQLPORT}}` |
| `DB_DATABASE` | `${{MySQL.MYSQLDATABASE}}`; choose a fresh name distinct from development `mgaems` |
| `DB_USERNAME` | `${{MySQL.MYSQLUSER}}` |
| `DB_PASSWORD` | `${{MySQL.MYSQLPASSWORD}}`, stored only as a Railway secret/reference |
| `DB_SOCKET` | Unset; use the TCP connection above |
| `SESSION_DRIVER` | `database` |
| `SESSION_SECURE_COOKIE` | `true` |
| `SESSION_ENCRYPT` | `true` |
| `SESSION_COOKIE` | `mgaems_staging_session`, unique from other environments |
| `SESSION_LIFETIME` | `120` minutes (or a reviewed shorter value) |
| `SESSION_DOMAIN` | Unset; host-only cookie |
| `SESSION_CONNECTION`, `SESSION_STORE` | Unset; default staging database/session configuration |
| `SANCTUM_STATEFUL_DOMAINS` | Empty/unset; staging config enforces bearer mode |
| `CACHE_DRIVER` | `file` |
| `CACHE_PREFIX` | A unique staging prefix, e.g. `mgaems_staging` |
| `QUEUE_CONNECTION` | `sync` |
| `FILESYSTEM_DISK` | `private` |
| `LOG_CHANNEL` | `stderr` |
| `LOG_LEVEL` | `warning` |
| `MAIL_MAILER` | `array`; staging forces this sink and removes alternative transports |
| `MAIL_FROM_ADDRESS` | Optional demonstration-only address such as `noreply@example.invalid` |
| `MAIL_HOST`, `MAIL_USERNAME`, `MAIL_PASSWORD`, other SMTP settings | Do not configure |
| `ADMIN_PASSWORD` / legacy seeder variables | Do not configure; use the interactive command below |

The runtime refuses debug mode, insecure URL/cookies, missing key/database
credentials, known local development database settings, a shared session domain,
SMTP, incompatible drivers or a malformed port. These checks cannot identify
every possible development database: the operator must verify the project,
environment, private host and database service identity before any command.

Generate a new 32-byte application key in an operator-controlled PHP terminal:

```sh
php -r 'echo "base64:".base64_encode(random_bytes(32)).PHP_EOL;'
```

Paste it directly into the staging secret variable. Do not save it in this file,
commit it, pass it as a build argument or print it in CI logs. Retain it across
redeployments; changing it invalidates encrypted sessions. Do not use generic
`SESSION_SECRET` or `FILE_STORAGE_PATH` advice from the older deployment guide;
this Laravel application uses `APP_KEY` and the configured storage disks.

Staging trusts forwarded headers from Railway's ingress to recognize HTTPS.
Railway's edge must be the sole public ingress: do not expose a direct container
port, put untrusted services on the private network or bypass the edge. Only
approved operators should access the project and logs.

## First installation and administrator plan — review required before execution

These are future operator steps; none were run on Railway in this task.

1. Resolve the dependency blockers and review a clean audit. Select and test the
   actual MySQL version intended for Railway; the local fixture used 8.0. Do not
   assume a newer template version has the same migration/backup compatibility.
2. After deployment approval, create an empty, separate MySQL service and app
   service with their volumes and the variables above. Keep public routing
   disabled during initial installation, using the planned HTTPS origin in
   `APP_URL`. Do not enable Railway's `/healthz` deployment gate yet: it returns
   503 until schema installation and would reject the first deployment.
3. Connect to the running **staging application container**, preferably an
   interactive Railway SSH session. Confirm the linked project, environment,
   service and database reference. Local `railway run` executes locally and is
   not a substitute for access to private database DNS. Confirm this is a new
   database with no application tables; do not import or mount development data.
4. From `/var/www/html` in that container, execute explicitly:

   ```sh
   php artisan migrate --force
   php artisan staging:bootstrap-admin
   ```

   Do not run `migrate:fresh`, `db:seed`, `DatabaseSeeder` or legacy
   `AdminUserSeeder`. There is no migration command on startup or pre-deploy.
5. The administrator command requires staging/production mode, MySQL, completed
   migrations, an interactive operator and a database with **no users**. Type
   the exact database name, a unique username and a demonstration email. Enter
   a unique password twice through masked prompts (at least 16 characters and
   at most 72 bytes, avoiding bcrypt truncation). Keep it in the operator vault;
   do not pass it on a command line or store it as a service variable.
6. Bootstrap creates the eight reference roles, one active System Admin and
   minimal school settings using `APP_NAME`, without an uploaded logo, contacts,
   Staff relationship, learners, guardians, sponsors or clinical records. A
   transaction and database lock prevent duplicate bootstrap; existing users
   cause refusal rather than overwrite. The existing System Admin Health
   restriction remains enforced. There is no default or hardcoded password.
7. Verify `curl --fail http://127.0.0.1:$PORT/healthz` inside the container returns
   200. Configure Railway's health-check path `/healthz`, then redeploy and
   enable the approved public HTTPS domain with its target port matching `PORT`.
   The Docker health check may show unhealthy before migration but does not
   stop Apache. Readiness tests connectivity/schema, not that an admin exists.
8. Check login/logout, secure cookies and redirects through Railway TLS,
   authorized role workflows, private uploads, PDF creation, storage retention
   after a redeploy and logs. Verify mail remains disabled. Test desktop/mobile
   rendering with an operator account. Take and restore a disposable backup
   before relying on the backup feature. Use demonstration data only under a
   separate approval; never copy real school records into this environment.

No automatic seed, migration, email delivery, payment feature, Student Portal,
Streams, clinical functionality or Phase 4 UI work was introduced. Existing
Staff/User relationships, API contracts, authorization and historical migrations
remain unchanged. An empty staging database has no linked family, teacher or
sponsor assignments, so those workspaces initially show their existing empty
states. An uploaded school-logo URL may be absent until separately configured;
the school's branding assets were not modified or copied from private storage.

## Local verification and results

```powershell
docker build -f Dockerfile.staging -t mgaems-staging:review .
docker run --rm --network none --read-only --mount type=bind,source=D:\mgaems\tests\safe\staging_image.php,target=/tests/staging_image.php,readonly --entrypoint php mgaems-staging:review /tests/staging_image.php
powershell -NoProfile -File tests/safe/staging_mysql.ps1
```

The fixture runner owns randomly named, labeled containers; MySQL has network
`none`, no published ports, no development mounts and RAM-only data. Application
containers share only the fixture's network namespace. It requires the fixture
database name/marker and rejects the known development server UUID. The temporary
file volume is separately owned. Cleanup checks names, IDs and labels before
removal. No existing database or volume is removed. Fixture secrets are random
and disposable, and evidence remains under Git-ignored private storage.

| Check | Result |
| --- | --- |
| Staging Docker build | PASS; production Composer install, package discovery and platform requirements passed |
| Syntax / whitespace | PASS: 210 PHP files, 15 frontend JavaScript modules, shell entrypoint, PowerShell fixture runner and `git diff --check` |
| Static pages / navigation / assets | PASS: all 35 public HTML/JS/CSS resources match source hashes in the image; referenced static assets and navigation destinations exist |
| Cold image inspection / unsafe environment cases | 43 PASS checks; no local secrets, private storage, development artifacts or development dependencies found |
| Empty MySQL installation and runtime integration | 21 PASS groups; 39 migrations, 43 tables, no automatic seed, repeat migration safe |
| Administrator checks | PASS: masked hashing, no school records or Staff links; noninteractive, wrong database confirmation, short/overlong password and existing-account refusal |
| HTTP through Apache on nondefault port 8087 | PASS: readiness, simulated HTTPS proxy/cookies, same-origin bearer login, authorization, Health 403, anonymous learner 401, recovery sink, private-file denial, public-file serving, uploaded PHP denial, logout/revocation |
| PDF / mail / persistence | PASS: PDF signature from production dependencies; only array mailer; private file survived container replacement |
| Existing frontend regressions | 196 tests passed |
| Existing safe backend regressions | All 14 suites passed; 577 PASS executions / 225 distinct labels (suite processes reuse labels; not a PHPUnit assertion count) |
| Dependency security audit | FAIL: 24 advisory entries in five production packages; deployment blocker |
| Real browser / Railway visual QA | Pending; local HTTP simulation is not a browser or Railway deployment check |

Backend suites cover authorization, Teacher assignment scoping, Parent ownership
and child-switch contracts, sponsorship boundaries, restricted Health access,
learner/guardian workflows, academic structure, attendance, assessment history,
announcements, staff/account links and password recovery. They use isolated
SQLite fixtures, read-only source/vendor mounts and RAM bootstrap caches, with
no network access. An initial read-only cache error in the authorization wrapper
was fixed by providing a disposable writable cache; all suites then passed.

Full audit/build/regression evidence is local and intentionally uncommitted under
`storage/app/private/railway-preparation-20261013/`; fresh fixture evidence is
under `storage/app/private/staging-check-<random-id>/`. Tests and documentation
are excluded from the production image. No package-level OS vulnerability scan,
load test, external penetration test or real report-card publication was claimed.
Dependency remediation and actual Railway acceptance remain required.

Final local image tag: `mgaems-staging:review`; inspected image ID:
`sha256:05a4a6fc88c7746f23f2923155a6127a721add0e450cfbe0ee5d15e8dfd28c3e`.
Final fresh fixture run: `staging-check-3fa957ba`. All owned fixture containers
and the temporary file volume were removed after verification.

## Changed files

- `.dockerignore`, `.gitattributes`, `Dockerfile.staging`
- `docker/staging/apache.conf`, `php.ini`, `start.sh`, `validate.php`
- `app/Console/Commands/BootstrapStagingAdmin.php`
- `app/Http/Controllers/StagingHealthController.php`
- `app/Http/Middleware/TrustProxies.php`
- `app/Providers/StagingServiceProvider.php`
- `config/app.php`, `logging.php`, `mail.php`, `sanctum.php`, `session.php`, `staging.php`
- `tests/safe/staging_image.php`, `staging_install.php`, `staging_mysql.ps1`
- `docs/railway-staging.md`

## Primary references consulted

- [Laravel 10 release/support and PHP compatibility](https://laravel.com/framework/docs/10.x/releases)
- [Laravel deployment configuration](https://laravel.com/framework/docs/10.x/deployment)
- [PHP supported versions](https://www.php.net/supported-versions.php)
- [Official PHP Docker image](https://hub.docker.com/_/php)
- [Railway custom Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Railway MySQL variables and private connections](https://docs.railway.com/databases/mysql)
- [Railway volumes](https://docs.railway.com/volumes)
- [Railway deployment health checks](https://docs.railway.com/deployments/healthchecks)
- [Railway CLI](https://docs.railway.com/cli)
- [Laravel maintainer security advisory](https://github.com/laravel/framework/security/advisories/GHSA-5vg9-5847-vvmq)
- [Dompdf maintainer security advisory](https://github.com/dompdf/dompdf/security/advisories/GHSA-cx96-42px-69fm)
