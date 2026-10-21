# Isolated Grade 7 Science browser demo

Prepared and verified: 19 October 2026.

Status: the operator confirmed the demo was working and requested its closure.
Both demo containers were stopped on 19 October 2026. Demo data was retained;
the main school application continues separately on port 8000.

## Open the demo

Guide: **http://localhost:8010/demo**
Sign in: **http://localhost:8010/login.html**

| Account | Username | Password |
| --- | --- | --- |
| Fictional teacher | `demo.teacher` | `DemoOnly!2026` |
| Fictional administrator | `demo.admin` | `DemoOnly!2026` |

These are public fixture credentials for the loopback-only demo. They do not
authenticate to the school application on port 8000.

No PDF upload is needed. The demo already contains an original temperature-reading
PDF, its matching reviewed record, a Grade 7 allocation and four editable drafts.

## Try the workflow

1. Sign in as `demo.teacher`.
2. Open Schemes of Work and view `DEMO - Temperature scheme`.
3. Click **Generate weekly plans (AI)**. Grade 7, Integrated Science and the
   temperature-reading unit are prefilled by the demo-only UI helper.
4. Click **Generate draft**, review/edit the returned JSON, then **Import weekly
   plans**. Saving and acceptance use the ordinary application APIs and audits.
5. Repeat for:
   - Lesson Plans: `DEMO - Temperature lesson` → **Curriculum AI draft** →
     **Apply to this draft**.
   - Homework: `DEMO - Temperature homework` → **Curriculum AI draft** →
     **Import questions**.
   - Exam Papers: `DEMO - Temperature paper` → **Curriculum AI draft** →
     **Import sections & questions**.
6. Inspect the saved content and marking guidance. Imports leave documents in
   draft state. Normal submit/review/publish actions remain explicit.
7. Sign out and sign in as `demo.admin` to inspect Curriculum Library, the
   original synthetic PDF, extracted fields, mapping and checksum evidence.

The sample provider is **deterministic**, not live AI. It is explicitly labelled
as such in the page banner and returned draft. It generates contract-validated
samples from the approved original demo record and honours the requested totals
within its stated limits. This lets the user test the end-to-end editing/import
workflow without third-party curriculum or model variability.

Original fixture topic: read thermometer values, compare 20 and 30 degrees Celsius,
and calculate the difference between 22 and 27 degrees Celsius. It is original
software-test material, not official KICD curriculum or a claim of curriculum
alignment. The shared Google Drive PDF is not included.

## Isolation and lifecycle

Start/retain the demo from `D:\mgaems`:

```powershell
docker compose -f compose.synthetic-demo.yaml up -d
```

Stop the demo while retaining its data:

```powershell
docker compose -f compose.synthetic-demo.yaml stop
```

- Compose project: `mgaems-synthetic-demo`.
- App: `mgaems-synthetic-demo-app`, published on `127.0.0.1:8010` only.
- MySQL: `mgaems-synthetic-demo-mysql`, on its own network, no host database port.
- Database: `mgaems_synthetic_demo`, with a marker tied to its MySQL server UUID.
- Separate named database and `/synthetic-storage` volumes. The source tree and
  existing dependency volume are read-only. Bootstrap caches are separate tmpfs.
- Seeder refuses a nonempty unmarked database or the active application
  environment. It uses ordinary migrations on the new empty demo database only.
  It never resets a database and does not overwrite seeded fixtures on restart.
- Each served demo request checks the isolated configuration and database marker.
  No synthetic provider is added to the active application's provider selection.
- The original app stays on port 8000 with `MGAEMS_AI_DRIVER=disabled`.

The local image `mgaems-app` and dependency volume `mgaems_mgaems_vendor` must exist;
these are reused read-only from the existing local Docker setup.

## Verification performed

```powershell
node docker/synthetic-demo/smoke.cjs
docker exec mgaems-synthetic-demo-app php docker/synthetic-demo/verify.php
docker exec mgaems-synthetic-demo-app php tests/safe/ollama.php --live
docker exec mgaems-app php tests/safe/ai_pilot_readiness.php
```

- Real HTTP sign-in, account identity, sample-provider availability, exact
  curriculum retrieval, all four HTML pages, teacher contexts and draft listings
  passed.
- The MySQL/kernel verification passed generation, document imports, duplicate
  guards, repeated lesson apply, acceptance retries and single acceptance audits
  for all four teaching operations. Its writes were rolled back, leaving the
  initial documents ready for browser imports. Run it before importing into the
  initial demo documents; it expects their original empty child rows.
- The real Ollama transport probe passed three checks from the new demo container:
  installed model list, tiny synthetic JSON generation and sanitized missing-model
  handling. It configured no database connections. This is separate from the
  deterministic four-document demo; real-model teaching quality was not claimed.
- Restarting the seeder retained existing demo fixtures without overwriting them.
- Invoking the seeder in `mgaems-app` correctly refused before database access.
- PHP/JavaScript syntax and Compose configuration validation passed.
- A fresh active read-only inventory confirmed the original driver is disabled,
  approved academic mapping is retained, and active curriculum versions, records
  and outcomes remain zero.

The tests do not certify actual browser layout, keyboard interactions or device
usability. Those can be exercised manually after starting the isolated demo.
