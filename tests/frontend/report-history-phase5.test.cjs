const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ role = 'head_teacher', get, download } = {}) {
  const h = createDOM(role); const requests = [], downloads = [], toasts = [];
  h.app.get = async url => {
    requests.push(url);
    return get ? get(url) : { ok: true, data: [
      { id: 77, revision_number: 3, generated_at: '2026-10-13T10:15:00Z', provenance: 'captured', source_count: 0, download_available: true },
      { id: 76, revision_number: 2, generated_at: null, provenance: 'legacy_artifact', source_count: null, download_available: false },
    ], meta: { page: 1, per_page: 25, total: 2 } };
  };
  h.app.download = async (url, filename) => { downloads.push({ url, filename }); return download ? download(url, filename) : { ok: true }; };
  h.app.toast = (...args) => toasts.push(args);
  h.run('report-history.js');
  return { ...h, requests, downloads, toasts };
}

test('school retained revisions are requested only for the three leadership roles', async () => {
  for (const role of ['system_admin', 'head_teacher', 'deputy_head_teacher']) {
    const h = harness({ role }); h.app.openReportHistory(7); await flush();
    assert.deepEqual(h.requests, ['/api/v1/report-cards/7/revisions?page=1']);
  }
  for (const role of ['teacher', 'parent_guardian', 'sponsor', 'sponsor_coordinator', 'secretary', 'health_officer', 'unknown']) {
    const h = harness({ role }); const modal = h.app.openReportHistory(7); await flush();
    assert.equal(h.requests.length, 0); assert.match(modal.body.innerHTML, /authorized school leadership/);
  }
});

test('missing or invalid report identities do not create a revision request', () => {
  for (const id of [undefined, null, '', 0, -1, '7/../../health', '7<script>']) {
    const h = harness(); const modal = h.app.openReportHistory(id);
    assert.equal(h.requests.length, 0); assert.match(modal.body.innerHTML, /Select an existing report/);
  }
});

test('revision cards distinguish captured sources, legacy unknowns, and actual PDF availability', async () => {
  const h = harness(); const modal = h.app.openReportHistory(7); await flush();
  assert.match(modal.body.innerHTML, /Captured assessment snapshot/);
  assert.match(modal.body.innerHTML, /Assessment sources<\/dt><dd>0<\/dd>/);
  assert.match(modal.body.innerHTML, /Legacy PDF · sources unknown/);
  assert.match(modal.body.innerHTML, /Assessment sources<\/dt><dd>Unknown<\/dd>/);
  assert.match(modal.body.innerHTML, /Nairobi time|PDF available|Record only|No retained file/);
  assert.equal(modal.body.querySelectorAll('[data-download]').length, 1);
  assert.match(modal.body.querySelector('[data-download]').getAttribute('aria-label'), /revision 3/);
  assert.equal(modal.body.querySelector('[data-page="-1"]').disabled, true);
  assert.equal(modal.body.querySelector('[data-page="1"]').disabled, true);
});

test('revision metadata is escaped and private artifact/source/Health fields are never rendered', async () => {
  const h = harness({ get: async () => ({ ok: true, data: [{ id: 77, revision_number: '<R>', generated_at: '<When>',
    provenance: '<Legacy>', source_count: '<Sources>', download_available: true, artifact_path: 'private/should-not-render.pdf',
    input_snapshot: { health: 'medical-secret' }, source_manifest: ['unrelated-learner-secret'] }], meta: { total: 1, per_page: 25 } }) });
  const modal = h.app.openReportHistory(7); await flush();
  assert.match(modal.body.innerHTML, /&lt;Legacy&gt;|&lt;Sources&gt;|&lt;R&gt;/);
  assert.doesNotMatch(modal.body.innerHTML, /<Legacy>|<Sources>|<R>|artifact_path|should-not-render|medical-secret|unrelated-learner-secret/);
});

test('empty and pending revision states describe available legacy PDFs without inventing metadata', async () => {
  let resolve; const h = harness({ get: () => new Promise(done => { resolve = done; }) });
  const modal = h.app.openReportHistory(7);
  assert.match(modal.body.innerHTML, /role="status"|Loading retained revisions/);
  assert.equal(modal.body.querySelector('[data-download]'), null);
  resolve({ ok: true, data: [], meta: { total: 0, per_page: 25 } }); await flush();
  assert.match(modal.body.innerHTML, /No revision metadata yet|Any available legacy PDF/);
  assert.equal(modal.body.querySelector('[data-download]'), null);
});

test('failed histories give escaped feedback and retry; denied sessions have no download or retry actions', async () => {
  let count = 0;
  const h = harness({ get: async () => ++count === 1 ? { ok: false, status: 500, error: '<Load failed>' } : { ok: true, data: [], meta: { total: 0, per_page: 25 } } });
  const modal = h.app.openReportHistory(7); await flush();
  assert.match(modal.body.innerHTML, /&lt;Load failed&gt;/);
  modal.body.querySelector('[data-retry]').listeners.click(); await flush();
  assert.equal(h.requests.length, 2); assert.match(modal.body.innerHTML, /No revision metadata/);
  assert.equal(h.document.activeElement, modal.body);
  for (const status of [401, 403]) {
    const denied = harness({ get: async () => ({ ok: false, status, error: 'Denied' }) });
    const dialog = denied.app.openReportHistory(7); await flush();
    assert.match(dialog.body.innerHTML, /active leadership session/);
    assert.equal(dialog.body.querySelector('[data-retry]'), null);
    assert.equal(dialog.body.querySelector('[data-download]'), null);
  }
});

test('malformed revision envelopes and rows report a retryable error instead of fabricated empty history', async () => {
  for (const result of [undefined, null, [], { ok: 'true', data: [], meta: { total: 0, per_page: 25 } },
    ...[undefined, null, {}, 'invalid', [null], [false], ['row'], [[]]].map(data => ({ ok: true, data, meta: { total: 1, per_page: 25 } }))]) {
    const h = harness({ get: async () => result }); const modal = h.app.openReportHistory(7); await flush();
    assert.match(modal.body.innerHTML, /revision history response could not be read/);
    assert.doesNotMatch(modal.body.innerHTML, /No revision metadata yet|0 revisions|report-revision-card/);
    assert.ok(modal.body.querySelector('[data-retry]')); assert.equal(modal.body.querySelector('[data-download]'), null);
  }
});

test('malformed revision pagination reports an error without inventing counts or navigation', async () => {
  for (const meta of [undefined, null, [], {}, { total: '1', per_page: 25 }, { total: -1, per_page: 25 },
    { total: 1.5, per_page: 25 }, { total: 1, per_page: 0 }, { total: 1, per_page: '25' },
    { total: 1, per_page: 1.5 }, { total: 1, per_page: 25, page: 0 }, { total: 1, per_page: 25, page: 2 }]) {
    const h = harness({ get: async () => ({ ok: true, data: [], meta }) });
    const modal = h.app.openReportHistory(7); await flush();
    assert.match(modal.body.innerHTML, /revision history response could not be read/);
    assert.ok(modal.body.querySelector('[data-retry]')); assert.equal(modal.body.querySelector('[data-page]'), null);
  }
  const h = harness({ get: async () => ({ ok: true, data: [{ id: 77 }], meta: { total: 0, per_page: 25 } }) });
  const modal = h.app.openReportHistory(7); await flush();
  assert.match(modal.body.innerHTML, /revision history response could not be read/);
});

test('paging clears stale actions, keeps keyboard focus, and ignores rapid duplicate page activation', async () => {
  let resolve; const h = harness({ get: async url => url.endsWith('page=1') ? { ok: true, data: [{ id: 77, revision_number: 26, download_available: true }], meta: { total: 26, per_page: 25 } } : new Promise(done => { resolve = done; }) });
  const modal = h.app.openReportHistory(7); await flush();
  const next = modal.body.querySelector('[data-page="1"]');
  next.listeners.click(); next.listeners.click(); await flush();
  assert.deepEqual(h.requests, ['/api/v1/report-cards/7/revisions?page=1', '/api/v1/report-cards/7/revisions?page=2']);
  assert.equal(h.document.activeElement, modal.body);
  assert.equal(modal.body.querySelector('[data-download]'), null);
  resolve({ ok: true, data: [{ id: 51, revision_number: 1, download_available: false }], meta: { page: 2, total: 26, per_page: 25 } }); await flush();
  assert.match(modal.body.innerHTML, /Page 2/);
  assert.equal(modal.body.querySelector('[data-page="1"]').disabled, true);
});

test('late history responses cannot modify a closed revision dialog', async () => {
  let resolve; const h = harness({ get: () => new Promise(done => { resolve = done; }) });
  const modal = h.app.openReportHistory(7); modal.close();
  resolve({ ok: true, data: [{ id: 999, revision_number: 'Stale revision', download_available: true }], meta: { total: 1 } }); await flush();
  assert.doesNotMatch(modal.body.innerHTML, /Stale revision/); assert.equal(modal.body.querySelector('[data-download]'), null);
});

test('revision download keeps scoped route, locks duplicate actions and reports completion', async () => {
  let resolve; const h = harness({ download: () => new Promise(done => { resolve = done; }) });
  const modal = h.app.openReportHistory(7); await flush();
  const button = modal.body.querySelector('[data-download]'); const first = button.listeners.click(); button.listeners.click();
  assert.equal(h.downloads.length, 1); assert.deepEqual(h.downloads[0], { url: '/api/v1/report-cards/7/revisions/77/download', filename: 'report-card-r3.pdf' });
  assert.equal(modal.busy, true); assert.match(modal.body.querySelector('[data-feedback]').textContent, /Preparing revision 3/);
  resolve({ ok: true }); await first;
  assert.equal(modal.busy, false); assert.equal(button.disabled, false);
  assert.match(modal.body.querySelector('[data-feedback]').textContent, /download started/);
});

test('missing/integrity-failed retained files keep readable feedback and remain retryable', async () => {
  const h = harness({ download: async () => ({ ok: false, status: 409, error: '<Integrity check failed>' }) });
  const modal = h.app.openReportHistory(7); await flush();
  const button = modal.body.querySelector('[data-download]'); await button.listeners.click();
  const feedback = modal.body.querySelector('[data-feedback]');
  assert.equal(feedback.textContent, '<Integrity check failed>'); assert.equal(feedback.getAttribute('role'), 'alert');
  assert.equal(button.disabled, false); assert.equal(h.toasts.length, 1);
  await button.listeners.click(); assert.equal(h.downloads.length, 2);
});

test('unexpected revision and download transport failures produce safe retry feedback', async () => {
  const failed = harness({ get: async () => { throw new Error('transport'); } });
  const modal = failed.app.openReportHistory(7); await flush();
  assert.match(modal.body.innerHTML, /could not be loaded/); assert.ok(modal.body.querySelector('[data-retry]'));
  const h = harness({ download: async () => { throw new Error('transport'); } });
  const downloadModal = h.app.openReportHistory(7); await flush(); await downloadModal.body.querySelector('[data-download]').listeners.click();
  assert.equal(downloadModal.busy, false); assert.match(downloadModal.body.querySelector('[data-feedback]').textContent, /could not be downloaded/);
});

test('report card styling reuses theme tokens, keyboard focus and tablet/mobile layouts', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../../public/assets/report-cards.css'), 'utf8');
  assert.match(css, /var\(--surface\)/); assert.match(css, /var\(--touch-target\)/);
  assert.match(css, /:focus-visible/); assert.match(css, /max-width: 900px/); assert.match(css, /max-width: 640px/);
  assert.match(css, /report-revision-meta \{ grid-template-columns: 1fr/);
});
