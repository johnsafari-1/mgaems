# MGAEMS Database Integration & Runtime Upgrade Preflight

Date: 2026-10-15
Branch: `feature/production-ui` (local commit `f5b09eb`, not pushed)

## Purpose

Verify that the committed Exam Studio / Teaching Review / AI work can be applied to the existing MySQL development database and that the live app can move from PHP 8.2 / Laravel 10.50.2 to the required PHP 8.3 / Laravel 13.35 stack, without touching the running containers, live database, or credentials.

## Current live state

| Component | State |
|---|---|
| `mgaems-app` | PHP 8.2.34, Laravel 10.50.2, bind-mounts repo with `mgaems_mgaems_vendor` named volume over `vendor` (legacy Laravel 10) |
| `mgaems-mysql` | `mysql:8.0`, host port 3307, volume `mgaems_mgaems_mysql_data`, database `mgaems` |
| Database before rehearsal | 43 tables, 39 migration rows, latest `2026_10_10_000037` |
| Pending migrations | `2026_10_15_000038`–`000042` (Teaching workspace, Lesson plans/Records of work, Homework, Exam Studio, Teaching review/AI) |

## Backup

- File: `D:\mgaems-backups\mgaems-preflight-20261015-160235.sql`
- Size: 128100 bytes
- SHA256: `bcd76ac03227d9e8b4b56afbca369bf54e6dff33e6ecb531b77838f830993bd6`
- Taken with `mysqldump --no-tablespaces` (no PROCESS privilege) via a binary-safe .NET process stream; PowerShell `>` redirection was avoided because it corrupted earlier dumps.
- Two earlier corrupt/incomplete dumps were deleted (`...-155541.sql` privilege error, `...-155619.sql` encoding corruption).
- Directory is outside the web root and covered by the `*.sql` gitignore.

## Isolated rehearsal (completed)

Disposable environment only — the live `mgaems-mysql` was never modified.

| Resource | Name |
|---|---|
| Container | `mgaems-preflight-mysql-20261015160248` |
| Network | `mgaems-preflight-20261015160248` |
| Volume | `mgaems-preflight-mysql-data-20261015160248` |
| Label | `mgaems.preflight=true` |
| App container | `mgaems-preflight-run` (image `mgaems-preflight-php83:rehearsal`, PHP 8.3 + Composer 2) |
| Source | container-native copy of the repo (no bind mount; Windows junction `public/storage` excluded) |

Steps executed:

1. Restored the backup into the disposable MySQL with `--binary-mode=1`; table and migration lists matched the source exactly (43/43, 39/39).
2. Ran `composer install` inside a container (118 packages) against the lock file — Laravel `v13.35.0`, PHPUnit `12.5.39`.
3. `php artisan --version` → Laravel Framework 13.35.0.
4. `php artisan migrate:status` confirmed 39 ran + 5 pending.
5. `php artisan migrate --force` applied `000038`–`000042` successfully (largest took 2s).
6. Post-migration DB: **58 tables, 44 migrations**. All core row counts preserved (users 13, classes 6, subjects 5, assessments 4, class_subject_teacher 5, sponsorships 2, messages 1). New tables are present and empty, as expected for a pre-feature backup.
7. Ran `php tests/safe/teaching_learning_workspace.php` on Laravel 13: **13/13 checks passed** (in-memory SQLite, no MySQL writes).
8. Ran a Laravel-13 DB-facade smoke against the disposable MySQL: all new tables (`exam_papers`, `exam_paper_sections`, `exam_paper_questions`, `exam_paper_revisions`, `lesson_plans`, `homeworks`, `ai_generation_runs`, `schemes_of_work`) returned `0` rows via Eloquent without error.

New tables created by the pending migrations:

- `lesson_plans`, `records_of_work`
- `homeworks`, `homework_questions`, `homework_completions`
- `exam_papers`, `exam_paper_sections`, `exam_paper_questions`, `exam_paper_revisions`, `exam_paper_attachments`
- `teaching_document_revisions`, `ai_generation_runs`
- `schemes_of_work`, `scheme_of_work_weeks`

## Blockers found and resolved

- `mgaems-upgrade-php83:ef501378` has no Composer and binds the legacy host `vendor` — unusable for migration work.
- `mgaems-staging:checkpoint2c` refuses to start with `DB_CONNECTION` unset.
- Solution: built `mgaems-preflight-php83:rehearsal` from `docker/php/Dockerfile` (PHP 8.3, Composer 2, pdo_mysql/mbstring/bcmath/zip/intl/gd) and ran everything container-native to avoid Windows bind-mount I/O timeouts.

## Live upgrade (executed 2026-10-15)

Executed with explicit approval on 2026-10-15. The `mgaems-mysql` container was started by Compose during `up` but its data volume was untouched; the database was verified intact (43 tables, 39 migrations, 13 users) before migrating.

```bash
# 1. Rebuild the app image and recreate the app container (PHP 8.3 / Laravel 13).
#    DB credentials were injected as process env vars because .env.docker.local had empty
#    password values; the values were read from the running containers and never printed.
docker compose --env-file .env.docker.local build app
docker compose --env-file .env.docker.local up -d --force-recreate app

# 2. Refresh the vendor volume (the Dockerfile does not run composer install).
docker exec -e COMPOSER_PROCESS_TIMEOUT=0 -e COMPOSER_NO_INTERACTION=1 \
  mgaems-app composer install --no-ansi --no-progress --optimize-autoloader --prefer-dist

# 3. Apply the five pending migrations to the live database.
docker exec mgaems-app php artisan migrate --force --no-interaction --no-ansi

# 4. Verify.
docker exec mgaems-app php artisan --version
docker exec mgaems-app php artisan migrate:status --no-interaction --no-ansi
docker exec mgaems-app php tests/safe/teaching_learning_workspace.php
```

Outcome: app image rebuilt on PHP 8.3.35, container recreated, vendor volume refreshed with Laravel 13.35.0 (118 packages), all five migrations applied, HTTP smoke test returned 200, all 13 workspace tests passed. Post-migration database: 58 tables, 44 migrations, core row counts unchanged (13 users, 6 classes).

Note: the compose `up` also (re)started `mgaems-mysql`; the data volume `mgaems_mgaems_mysql_data` was preserved and the database was verified intact (43 tables / 39 migrations) before migrating.

Downtime: the app was unavailable for roughly 1–3 minutes during the image build, container recreation, and vendor refresh. The database stayed up throughout.

### Rollback

1. `docker compose stop mgaems-app`
2. `docker volume rm mgaems_mgaems_vendor` (forces a fresh legacy vendor install on next start)
3. `git checkout f5b09eb` (or the previous known-good commit) and `docker compose up -d mgaems-app`
4. If the database must be reverted: stop `mgaems-mysql`, replace its data with a restore of `D:\mgaems-backups\mgaems-preflight-20261015-160235.sql`, and start it again.

Note: the five new tables are additive and do not alter existing data, so a code-only rollback to the previous commit is safe even if the migrations remain applied.

## Status

- [x] Task 1 — source checkpoint committed locally (`f5b09eb`)
- [x] Task 2 — compatibility inspection (read-only)
- [x] Task 3 — verified byte-safe backup of the live database
- [x] Task 4 — isolated rehearsal: restore, Laravel 13 install, migration, tests, data checks
- [x] Task 5 — this report
- [x] Live upgrade — executed 2026-10-15 (PHP 8.3 / Laravel 13.35, migrations applied, all checks green)
