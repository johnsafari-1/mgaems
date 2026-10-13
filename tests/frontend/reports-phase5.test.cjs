// Existing leadership report lookup, with isolated DOM/API fixtures only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const source = fs.readFileSync(path.resolve(__dirname, '../../public/reports.html'), 'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const flush = () => new Promise(resolve => setImmediate(resolve));
const learners = [{ id: 3, first_name: '<Ada>', last_name: 'Learner', admission_no: 'A003', status: 'active' }, { id: 4, first_name: 'Ben', last_name: 'Learner', admission_no: 'A004', status: 'active' }];
const card = { id: 7, student_id: 3, term_id: 2, revision_number: 2, history_state: 'versioned', generated_at: '2026-10-01T08:00:00Z', download_available: true, student: learners[0], term: { id: 2, name: '<Term>' }, file_path: 'PRIVATE_FILE_MUST_NOT_RENDER', health: 'HEALTH_MUST_NOT_RENDER' };

function harness({ role = 'head_teacher', get, download } = {}) {
  const h = createDOM(role, '/reports.html');
  h.Element.prototype.insertAdjacentHTML = function(position, html) { this.innerHTML = this.innerHTML + html; };
  const requests = [], downloads = [], toasts = [];
  h.app.get = async url => {
    requests.push(url);
    if (get) { const result = await get(url); if (result !== undefined) return result; }
    if (url.endsWith('/school-statistics')) return { ok: true, data: { students: { total: 2, by_status: { active: 2 } }, staff: { total: 1, by_type: { teaching: 1 } }, active_sponsorships: 0, attendance_today: { recorded: 0, rate: null } } };
    if (url === '/api/v1/classes') return { ok: true, data: [{ id: 10, name: 'Class A' }, { id: 11, name: 'Class B' }] };
    if (url === '/api/v1/academic-years') return { ok: true, data: [{ id: 1, name: 'Fixture year' }] };
    if (url === '/api/v1/terms') return { ok: true, data: [{ id: 2, name: '<Term>', academic_year_id: 1, academic_year: { name: 'Fixture year' } }] };
    if (url.startsWith('/api/v1/students?')) return { ok: true, data: structuredClone(learners), meta: { total: 2 } };
    if (url.startsWith('/api/v1/report-cards?')) return { ok: true, data: structuredClone(card) };
    return { ok: true, data: [], meta: { total: 0, per_page: 25 } };
  };
  h.app.download = async (...args) => { downloads.push(args); return download ? download(...args) : { ok: true }; };
  h.app.toast = (...args) => toasts.push(args);
  h.app.openReportHistory = () => {};
  vm.runInContext(source, h.context);
  return { ...h, requests, downloads, toasts,
    async change(id, value, event = 'change') { const control = h.ids.get(id); control.value = value; await control.listeners[event]?.({ target: control }); await flush(); },
    async select() { await flush(); await this.change('cardClass', '10'); await this.change('cardTerm', '2'); await this.change('cardStudent', '3'); },
  };
}

test('report lookup remains leadership-only and introduces no report generation action', async () => {
  for (const role of ['teacher', 'parent_guardian', 'sponsor', 'sponsor_coordinator', 'student']) {
    const h = harness({ role }); await flush(); assert.equal(h.requests.length, 0); assert.equal(h.ids.has('reportCardResult'), false);
  }
  for (const role of ['system_admin', 'head_teacher', 'deputy_head_teacher']) {
    const h = harness({ role }); await h.select();
    assert.match(h.ids.get('reportCardResult').innerHTML, /Download latest PDF|Retained revisions/);
    assert.doesNotMatch(h.ids.get('reportCardResult').innerHTML, /Generate revision|publishReport/);
  }
});

test('learner search uses only loaded page identities and clears reports for hidden selections', async () => {
  const h = harness(); await h.select(); const count = h.requests.length;
  await h.change('cardLearnerSearch', 'A004', 'input');
  assert.match(h.ids.get('cardStudent').innerHTML, /Ben/); assert.doesNotMatch(h.ids.get('cardStudent').innerHTML, /Ada/);
  assert.equal(h.ids.get('cardStudent').value, '');
  assert.match(h.ids.get('reportCardResult').innerHTML, /Select a learner and term/);
  assert.equal(h.requests.length, count); assert.equal(h.ids.get('cardLearnerCount').textContent, '1 of 2 learners on this page');
});

test('late learner pages cannot populate a different selected class', async () => {
  let release;
  const h = harness({ get: url => url.includes('/students?class_id=10') ? new Promise(resolve => { release = resolve; }) : url.includes('/students?class_id=11') ? { ok: true, data: [{ id: 9, first_name: 'Latest class learner', last_name: 'Name', admission_no: 'B009' }], meta: { total: 1 } } : undefined });
  await flush(); h.ids.get('cardClass').value = '10'; h.ids.get('cardClass').listeners.change(); await flush();
  await h.change('cardClass', '11'); release({ ok: true, data: learners, meta: { total: 2 } }); await flush();
  assert.match(h.ids.get('cardStudent').innerHTML, /Latest class learner/); assert.doesNotMatch(h.ids.get('cardStudent').innerHTML, /Ada|A003/);
});

test('stale report responses cannot restore a cleared learner selection', async () => {
  let release;
  const h = harness({ get: url => url.startsWith('/api/v1/report-cards?') ? new Promise(resolve => { release = resolve; }) : undefined });
  await flush(); await h.change('cardClass', '10'); await h.change('cardTerm', '2');
  h.ids.get('cardStudent').value = '3'; const pending = h.ids.get('cardStudent').listeners.change(); await flush();
  await h.change('cardStudent', ''); release({ ok: true, data: card }); await pending;
  assert.match(h.ids.get('reportCardResult').innerHTML, /Select a learner and term/); assert.equal(h.ids.has('downloadReportCard'), false);
});

test('current report metadata is escaped and availability does not expose private fields', async () => {
  const h = harness(); await h.select(); const html = h.ids.get('reportCardResult').innerHTML;
  assert.match(html, /&lt;Ada&gt;|&lt;Term&gt;/); assert.match(html, /PDF available|Retained revisions/);
  assert.doesNotMatch(html, /<Ada>|PRIVATE_FILE_MUST_NOT_RENDER|HEALTH_MUST_NOT_RENDER|file_path/);
  assert.equal(h.ids.get('reportCardResult').attrs['aria-busy'], 'false');
});

test('a record without a retained PDF shows unavailable feedback and no download control', async () => {
  const h = harness({ get: url => url.startsWith('/api/v1/report-cards?') ? { ok: true, data: { ...card, download_available: false } } : undefined }); await h.select();
  assert.match(h.ids.get('reportCardResult').innerHTML, /Record only|No PDF file is available/); assert.equal(h.ids.has('downloadReportCard'), false);
});

test('mismatched report identity and malformed learner collections fail without foreign records', async () => {
  const wrong = harness({ get: url => url.startsWith('/api/v1/report-cards?') ? { ok: true, data: { ...card, student_id: 900 } } : undefined }); await wrong.select();
  assert.match(wrong.ids.get('reportCardResult').innerHTML, /did not match/); assert.equal(wrong.ids.has('downloadReportCard'), false);
  const malformed = harness({ get: url => url.startsWith('/api/v1/students?') ? { ok: true, data: null } : undefined }); await flush(); await malformed.change('cardClass', '10');
  assert.match(malformed.ids.get('reportCardResult').innerHTML, /could not be loaded/); assert.equal(malformed.ids.get('cardStudent').disabled, true);
  for (const value of [false, [], { ...card, id: true }, { ...card, download_available: 'yes' }, { ...card, student: { ...learners[0], id: 900 } }]) {
    const invalid = harness({ get: url => url.startsWith('/api/v1/report-cards?') ? { ok: true, data: value } : undefined }); await invalid.select();
    assert.match(invalid.ids.get('reportCardResult').innerHTML, /did not match/); assert.equal(invalid.ids.has('downloadReportCard'), false);
  }
});

test('lookup errors can retry and empty reports remain honest empty states', async () => {
  let failed = true;
  const h = harness({ get: url => url.startsWith('/api/v1/report-cards?') ? failed ? { ok: false, error: '<Report unavailable>' } : { ok: true, data: null } : undefined }); await h.select();
  assert.match(h.ids.get('reportCardResult').innerHTML, /&lt;Report unavailable&gt;/); failed = false;
  await h.ids.get('reportCardResult').querySelector('[data-retry]').listeners.click();
  assert.match(h.ids.get('reportCardResult').innerHTML, /No report card found/);
});

test('PDF download is scoped, prevents duplicate requests and shows escaped retry feedback', async () => {
  let release;
  const h = harness({ download: () => new Promise(resolve => { release = resolve; }) }); await h.select();
  const button = h.ids.get('downloadReportCard'); const first = button.listeners.click(); button.listeners.click(); await flush();
  assert.equal(h.downloads.length, 1); assert.equal(h.downloads[0][0], '/api/v1/report-cards/7/download'); assert.equal(button.disabled, true);
  release({ ok: false, error: '<PDF unavailable>' }); await first;
  assert.equal(button.disabled, false); assert.match(h.ids.get('reportDownloadState').innerHTML, /&lt;PDF unavailable&gt;/);
});

test('report category tabs retain keyboard navigation and selected panel semantics', async () => {
  const h = harness(); await flush();
  h.ids.get('overviewTab').listeners.keydown({ key: 'End', preventDefault() {} });
  assert.equal(h.document.activeElement, h.ids.get('reportCardsTab')); assert.equal(h.ids.get('reportCardsTab').attrs['aria-selected'], 'true');
  assert.equal(h.ids.get('reportCardsPanel').hidden, false); assert.equal(h.ids.get('overviewPanel').hidden, true);
});
