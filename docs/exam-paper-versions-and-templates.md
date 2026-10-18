# Exam Paper Studio: embedded diagrams, header templates, and editable versions

This checkpoint completes the Rubrica-inspired work in the MGAEMS Exam Paper
Studio with three additive capabilities. Nothing existing was changed
destructively: authoring, review, publishing, revisions, RBAC, audit,
allocation scoping and private attachment storage all behave as before.

## 1. Diagrams embedded in examination PDFs

- `app/Services/ExamPaperExport.php` now resolves each question's uploaded
  diagram to a bounded data URI (`image_data_uri`) alongside the existing
  `attachment_name`.
- Only validated local PNG/JPEG uploads are embedded: the storage path must
  match `exam-papers/{id}/attachments/...`, the file must be at most 3 MiB and
  at most 2048 x 2048 px, and the MIME must be `image/png` or `image/jpeg`.
  Anything else falls back to the recorded attachment name. No remote fetch and
  no path traversal. WebP is intentionally not embedded (GD in this image has no
  WebP support) and remains viewable in the browser only.
- `resources/views/teaching/exam-paper.blade.php` renders the embedded image for
  learner papers and marking schemes alike.

## 2. Persistent per-paper header templates

- New `exam_papers.header_template` column (`classic` default; also `branded`,
  `compact`). The value is validated against `ExamPaper::HEADER_TEMPLATES` and
  settable while the paper is editable (draft/returned), via the existing
  `PATCH /exam-papers/{examPaper}` endpoint and the "Paper settings" dialog.
- `resources/views/teaching/partials/school-header.blade.php` now renders all
  three templates; other teaching documents keep the `classic` header because
  they never set the field. The A4 preview (`public/assets/exam-papers.js`) mirrors
  the same template classes (`is-classic` / `is-branded` / `is-compact`) for
  preview/export consistency.

## 3. Independent editable versions

- New columns: `version_number` (editable version label, default 1),
  `source_exam_paper_id` (self-referencing parent) and `source_revision_number`
  (the reviewed revision the version was branched from), plus a unique
  `(source_exam_paper_id, version_number)` index so concurrent branches cannot
  collide.
- `POST /exam-papers/{examPaper}/versions` (`ExamPaperController::createVersion`)
  clones a reviewed/locked paper into a new `draft` inside one transaction:
  sections, questions, options and answer keys are copied; attachment records
  and their private files are copied to the new paper's folder and re-linked;
  the version number is the max of the source and any siblings plus one. The
  original paper and its immutable `exam_paper_revisions` snapshots are
  untouched. Branching is allocation-scoped (a foreign teacher is denied with a
  404), and the action is audited as `CREATE_EXAM_PAPER_VERSION`.
- `GET /exam-papers/{examPaper}` (`workspace`) now returns `version_number`,
  `header_template`, `source` and `derived_versions`; the studio shows a version
  badge, a version lineage list and a "Create editable version" action on
  read-only papers.

## Graceful degradation

`ExamPaper::studioSchemaReady()` checks for the new columns. Until the migration
runs, the studio reports capabilities `false`, hides the template/version
controls, and the header/version fields are simply omitted instead of failing
against a database that does not yet carry them. After the migration the
capabilities flip to `true`.

## Migration

`database/migrations/2026_10_18_000044_add_exam_paper_versions_and_header_templates.php`
is idempotent (`Schema::hasColumn` / `Schema::hasIndex` guarded) and additive.

Apply on the active database:

```
docker exec mgaems-app php artisan migrate --force --path=database/migrations/2026_10_18_000044_add_exam_paper_versions_and_header_templates.php
```

Isolated verification (restores a verified private backup into a throwaway,
network-isolated MySQL 8.0 container, runs only this migration, then proves the
columns/index exist and every row count is unchanged):

```
node tests/safe/exam_paper_versions_mysql.cjs
```

The active database was backed up first to
`storage/app/private/exam-paper-versions/mgaems-before-exam-version-*.sql` with
a `.verification.json` (SHA256, byte size, table inventory and row counts).

## Tests

- `tests/safe/teaching_learning_workspace.php`: header template persistence,
  export template, version branching (status, lineage, cloned structure and
  diagrams, audit record), embedded diagram export, and foreign-teacher denial.
- `tests/frontend/exam-papers.test.cjs`: static contracts plus an execution test
  that renders the studio with capabilities, template switching and version
  lineage, asserting no exceptions or `undefined`.
- `tests/safe/exam_paper_versions_mysql.cjs`: the isolated MySQL migration drill.
