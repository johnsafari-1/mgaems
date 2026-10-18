// Final Health presentation and leadership report checks use synthetic responses only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const learners = [{ id: 8, first_name: '<Amina>', last_name: 'Learner', admission_no: 'S008', class_id: 10, status: 'active', school_class: { id: 10, name: 'Grade Six' }, health: 'NEVER_RENDER_HEALTH' }];
const stats = () => ({ students: { total: 1, by_status: { active: 1 } }, staff: { total: 2, by_type: { teaching: 1, non_teaching: 1 } }, active_sponsorships: 0, attendance_today: { recorded: 0, rate: null, date: '2026-10-14' } });
const profile = { id: 3, student_id: 8, revision_number: 2, allergy_information_state: 'unknown', allergy_information: null, emergency_information: '<Restricted information>', support_information: null, source: 'guardian_report', source_reference: null, recorded_by: 2, recorded_at: '2026-10-14T06:00:00Z', reviewed_at: null, reviewed_by: null };

function harness({ page = 'reports', role = 'head_teacher', get, write, download, confirm } = {}) {
  const asset = page === 'reports' ? 'reports.js' : 'health-workspace.js';
  const pathname = page === 'reports' ? '/reports.html' : '/health-welfare.html';
  const h = createDOM(role, pathname), reads = [], writes = [], downloads = [], toasts = [];
  let user = { id: 7, role, username: 'Synthetic account' }, token = 'synthetic-session';
  h.context.localStorage.getItem = key => key === 'mgaems_token' ? token : key === 'mgaems_user' ? JSON.stringify(user) : null;
  h.app.get = async url => {
    reads.push(url);
    if (get) { const response = await get(url); if (response !== undefined) return response; }
    if (url === '/api/v1/reports/school-statistics') return { ok: true, data: stats() };
    if (url === '/api/v1/classes') return { ok: true, data: [{ id: 10, name: 'Grade Six' }, { id: 11, name: 'Grade Seven' }] };
    if (url === '/api/v1/academic-years') return { ok: true, data: [{ id: 1, name: 'Current calendar year' }] };
    if (url === '/api/v1/terms') return { ok: true, data: [{ id: 2, name: 'Saved term', academic_year_id: 1 }] };
    if (url.startsWith('/api/v1/students?')) return { ok: true, data: structuredClone(learners), meta: { total: 1, per_page: 20 } };
    if (url === '/api/v1/health/profiles?per_page=1') return { ok: true, data: [], meta: { total: 0, per_page: 1 } };
    if (url.startsWith('/api/v1/health/profiles?student_id=')) return { ok: true, data: [{ id: 3, student_id: 8, revision_number: 2 }], meta: { total: 1, per_page: 20 } };
    if (url === '/api/v1/health/profiles/3') return { ok: true, data: structuredClone(profile) };
    if (url.startsWith('/api/v1/health/profiles/3/alerts?')) return { ok: true, data: [], meta: { total: 0, per_page: 20 } };
    if (url.startsWith('/api/v1/report-cards?')) return { ok: true, data: null };
    throw new Error('Unexpected test read: ' + url);
  };
  for (const method of ['post', 'patch']) h.app[method] = async (url, body) => {
    writes.push({ method, url, body: structuredClone(body) });
    return write ? write(url, body) : { ok: true, data: { id: 3 } };
  };
  h.app.download = async (...args) => { downloads.push(args); return download ? download(...args) : { ok: true }; };
  h.app.toast = (...args) => toasts.push(args);
  h.app.confirmAction = confirm || (async () => true);
  h.app.openReportHistory = () => {};
  return { ...h, reads, writes, downloads, toasts,
    start() { h.run(asset); return this; },
    switchIdentity(change) { user = { ...user, ...change }; if ('token' in change) token = change.token; },
    async click(id) { const control = h.ids.get(id) || h.ids.get('appMain').querySelector(id); assert.ok(control, `Missing ${id}`); const pending = control.listeners.click(); await flush(); return pending; },
    async change(id, value, type = 'change') { const control = h.ids.get(id); control.value = value; await control.listeners[type]?.({ target: control }); await flush(); },
    async choose() { await flush(); const control = h.ids.get('healthLearners').querySelector('[data-health-learner]'); assert.ok(control); control.listeners.click(); await flush(); },
  };
}

test('report overview uses actual totals and keeps unrecorded attendance distinct from zero rate', async () => {
  const h = harness().start(); await flush();
  assert.equal(h.ids.get('studentTotal').textContent, '1'); assert.equal(h.ids.get('staffTotal').textContent, '2');
  assert.equal(h.ids.get('activeSponsorships').textContent, '0'); assert.equal(h.ids.get('todayAttendance').textContent, 'Unrecorded');
  assert.match(h.ids.get('attendanceSummary').innerHTML, /not counted as absent/);
  const zeroRate = harness({ get: url => url.endsWith('school-statistics') ? { ok: true, data: { ...stats(), attendance_today: { recorded: 3, rate: 0, date: '2026-10-14' } } } : undefined }).start(); await flush();
  assert.equal(zeroRate.ids.get('todayAttendance').textContent, '0%');
});

test('partial or invalid report statistics are unavailable and retry without fabricated zeros', async () => {
  for (const data of [{}, { ...stats(), students: { total: -1, by_status: { active: 'bad' } }, active_sponsorships: undefined }, { ...stats(), attendance_today: { recorded: 1, rate: 200 } }]) {
    const h = harness({ get: url => url.endsWith('school-statistics') ? { ok: true, data } : undefined }).start(); await flush();
    assert.ok(h.ids.has('retryOverview'));
    if (!data.students || data.students.total === -1) assert.equal(h.ids.get('studentTotal').textContent, 'Unavailable');
    if (data.attendance_today?.rate === 200) assert.equal(h.ids.get('todayAttendance').textContent, 'Unavailable');
  }
});

test('overview failure and retry have independent loading and unavailable states', async () => {
  let failing = true; const pending = deferred();
  const h = harness({ get: url => url.endsWith('school-statistics') ? failing ? { ok: false, error: '<Statistics failed>' } : pending.promise : undefined }).start(); await flush();
  assert.equal(h.ids.get('studentTotal').textContent, 'Unavailable'); assert.match(h.ids.get('overviewError').innerHTML, /&lt;Statistics failed&gt;/);
  failing = false; const retry = h.ids.get('retryOverview').listeners.click(); await flush();
  assert.equal(h.ids.get('studentTotal').textContent, 'Loading…');
  pending.resolve({ ok: true, data: stats() }); await retry;
  assert.equal(h.ids.get('studentTotal').textContent, '1');
});

test('malformed class/calendar lookups keep unusable selections disabled and offer retry', async () => {
  const h = harness({ get: url => ['/api/v1/classes', '/api/v1/academic-years', '/api/v1/terms'].includes(url) ? { ok: true, data: [null] } : undefined }).start(); await flush();
  for (const id of ['cardClass', 'cardYear', 'cardTerm', 'exportClass', 'previewStudentReport']) assert.equal(h.ids.get(id).disabled, true);
  assert.ok(h.ids.has('retryReportLookups')); assert.ok(h.ids.has('retryExportLookups'));
  assert.match(h.ids.get('reportCardLookupError').innerHTML, /could not be loaded/);
});

test('report preview projects readable register rows, supported filters and no private Health fields', async () => {
  const h = harness().start(); await flush(); await h.change('exportClass', '10'); await h.change('exportStatus', 'active'); await h.click('previewStudentReport');
  assert.match(h.reads.at(-1), /class_id=10&status=active&per_page=25&page=1/);
  const html = h.ids.get('studentExportPreview').innerHTML;
  assert.match(html, /Admission number|&lt;Amina&gt;|Grade Six/); assert.doesNotMatch(html, /NEVER_RENDER_HEALTH|health/);
  assert.match(html, /all matching records/); assert.equal(h.ids.get('downloadStudentReport').disabled, false);
});

test('preview pagination requests only the next backend page and retains filter context', async () => {
  const h = harness({ get: url => url.startsWith('/api/v1/students?') ? { ok: true, data: structuredClone(learners), meta: { total: 26 } } : undefined }).start(); await flush();
  await h.change('exportClass', '10'); await h.click('previewStudentReport');
  const next = h.ids.get('studentExportPreview').querySelector('[data-export-page="1"]'); assert.equal(next.disabled, false); await next.listeners.click(); await flush();
  assert.match(h.reads.at(-1), /class_id=10&per_page=25&page=2/); assert.match(h.ids.get('studentExportPreview').innerHTML, /Page 2 of 2/);
});

test('filter changes invalidate pending previews and prevent stale download enablement', async () => {
  const pending = deferred();
  const h = harness({ get: url => url.startsWith('/api/v1/students?') ? pending.promise : undefined }).start(); await flush();
  h.ids.get('previewStudentReport').listeners.click(); await flush(); await h.change('exportClass', '11');
  pending.resolve({ ok: true, data: structuredClone(learners), meta: { total: 1 } }); await flush();
  assert.match(h.ids.get('studentExportPreview').innerHTML, /Preview required/); assert.equal(h.ids.get('downloadStudentReport').disabled, true);
  assert.equal(h.ids.get('previewStudentReport').disabled, false);
});

test('invalid previews and empty results cannot authorize an Excel download', async () => {
  for (const response of [{ ok: true, data: [null], meta: { total: 1 } }, { ok: true, data: [], meta: { total: 0 } }, { ok: false, error: '<Preview denied>' }]) {
    const h = harness({ get: url => url.startsWith('/api/v1/students?') ? response : undefined }).start(); await flush(); await h.click('previewStudentReport');
    assert.equal(h.ids.get('downloadStudentReport').disabled, true);
    await h.click('downloadStudentReport'); assert.equal(h.downloads.length, 0);
    assert.match(h.ids.get('studentExportPreview').innerHTML, /did not match|No students match|&lt;Preview denied&gt;/);
  }
});

test('Excel download freezes context, prevents duplicates and shows inline failure feedback', async () => {
  const pending = deferred(); const h = harness({ download: () => pending.promise }).start(); await flush(); await h.click('previewStudentReport');
  const button = h.ids.get('downloadStudentReport'); const first = button.listeners.click(); button.listeners.click(); await flush();
  assert.equal(h.downloads.length, 1); assert.equal(h.ids.get('exportClass').disabled, true); assert.equal(h.ids.get('exportStatus').disabled, true);
  assert.match(h.downloads[0][0], /^\/api\/v1\/reports\/students\/export\?/); assert.doesNotMatch(h.downloads[0][0], /per_page|page=/);
  pending.resolve({ ok: false, error: '<Download failed>' }); await first;
  assert.match(h.ids.get('excelDownloadFeedback').innerHTML, /&lt;Download failed&gt;/); assert.equal(button.disabled, false);
  assert.equal(h.ids.get('exportClass').disabled, false);
});

test('account changes suppress report responses and guard pending Excel files', async () => {
  const overview = deferred(); const h = harness({ get: url => url.endsWith('school-statistics') ? overview.promise : undefined }).start(); await flush();
  h.switchIdentity({ token: 'replacement' }); overview.resolve({ ok: true, data: stats() }); await flush();
  assert.equal(h.ids.get('studentTotal').textContent, 'Loading…');
  const download = deferred(), d = harness({ download: () => download.promise }).start(); await flush(); await d.click('previewStudentReport');
  const pending = d.ids.get('downloadStudentReport').listeners.click(); await flush(); d.switchIdentity({ id: 19 });
  assert.equal(d.downloads[0][2].isCurrent(), false); download.resolve({ ok: true }); await pending;
  assert.equal(d.toasts.length, 0);
});

test('Health learner selection is labeled, shows loaded-page counts and reflects the chosen learner', async () => {
  const h = harness({ page: 'health' }).start(); await flush();
  assert.equal(h.ids.get('healthLearnerCount').textContent, '1 of 1 learners on this page');
  assert.equal(h.ids.get('healthLearners').attrs['aria-busy'], 'false'); await h.choose();
  assert.equal(h.ids.get('healthLearners').querySelector('[data-health-learner]').attrs['aria-pressed'], 'true');
  assert.match(h.ids.get('healthPanel').innerHTML, /&lt;Restricted information&gt;/);
});

test('Health rejects malformed initial authorization and learner identity responses safely', async () => {
  const initial = harness({ page: 'health', get: url => url === '/api/v1/health/profiles?per_page=1' ? { ok: true, data: [null] } : undefined }).start(); await flush();
  assert.equal(initial.reads.length, 1); assert.match(initial.ids.get('appMain').innerHTML, /Unexpected Health authorization/);
  const roster = harness({ page: 'health', get: url => url.startsWith('/api/v1/students?') ? { ok: true, data: [null], meta: { total: 1, per_page: 20 } } : undefined }).start(); await flush();
  assert.match(roster.ids.get('healthLearners').innerHTML, /Unexpected learner identity/);
  assert.equal(roster.ids.get('healthLearnerCount').textContent, 'Learner page unavailable');
});

test('Health token changes erase pending private responses and selected narratives', async () => {
  const pending = deferred();
  const h = harness({ page: 'health', get: url => url === '/api/v1/health/profiles/3' ? pending.promise : undefined }).start(); await h.choose();
  h.switchIdentity({ token: 'replacement' }); pending.resolve({ ok: true, data: structuredClone(profile) }); await flush();
  assert.match(h.ids.get('appMain').innerHTML, /Health access unavailable/);
  assert.doesNotMatch(h.ids.get('appMain').innerHTML, /Restricted information|Amina/);
});

test('Health confirmation freezes fields and cancellation preserves editable facts', async () => {
  const pending = deferred(); const h = harness({ page: 'health', confirm: () => pending.promise }).start(); await h.choose(); await h.click('healthEditProfile');
  h.ids.get('healthCorrectionReason').value = 'Confirmed source'; const form = h.ids.get('healthRecordForm');
  const save = form.listeners.submit({ preventDefault() {} }); await flush(); const field = h.ids.get('healthField-emergency_information');
  assert.equal(field.disabled, true); assert.equal(h.modals.at(-1).busy, true);
  pending.resolve(false); await save; assert.equal(field.disabled, false); assert.equal(field.value, '<Restricted information>');
  assert.equal(h.writes.length, 0); assert.equal(h.modals.at(-1).busy, false);
});

test('Health account changes during confirmation prevent the mutation and wipe the private modal', async () => {
  const pending = deferred(); const h = harness({ page: 'health', confirm: () => pending.promise }).start(); await h.choose(); await h.click('healthEditProfile');
  h.ids.get('healthCorrectionReason').value = 'Confirmed source'; const modal = h.modals.at(-1), save = h.ids.get('healthRecordForm').listeners.submit({ preventDefault() {} }); await flush();
  h.switchIdentity({ role: 'system_admin' }); pending.resolve(true); await save;
  assert.equal(h.writes.length, 0); assert.equal(modal.body.innerHTML, ''); assert.equal(modal.closed, true);
  assert.match(h.ids.get('appMain').innerHTML, /Health access unavailable/);
});

test('Health account changes during saving wipe confidential state without success or reload', async () => {
  const pending = deferred(); const h = harness({ page: 'health', write: () => pending.promise }).start(); await h.choose(); await h.click('healthEditProfile');
  h.ids.get('healthCorrectionReason').value = 'Confirmed source'; const modal = h.modals.at(-1), save = h.ids.get('healthRecordForm').listeners.submit({ preventDefault() {} }); await flush();
  const readCount = h.reads.length; h.switchIdentity({ token: 'replacement' }); pending.resolve({ ok: true, data: { id: 3 } }); await save;
  assert.equal(modal.body.innerHTML, ''); assert.equal(modal.closed, true); assert.equal(h.toasts.length, 0); assert.equal(h.reads.length, readCount);
});

test('Health and Reports use dedicated responsive assets and Health adds no persistent response storage', () => {
  const root = path.resolve(__dirname, '../..');
  for (const [html, css] of [['health-welfare.html', 'health-workspace.css'], ['reports.html', 'reports.css']]) {
    const page = fs.readFileSync(path.join(root, 'public', html), 'utf8'); assert.match(page, new RegExp(`/assets/${css.replace('.', '\\.')}`)); assert.doesNotMatch(page, /<style>/);
    const source = fs.readFileSync(path.join(root, 'public/assets', css), 'utf8'); assert.match(source, /max-width: 640px/); assert.match(source, /var\(--touch-target\)/); assert.match(source, /var\(--gray-/);
  }
  const health = fs.readFileSync(path.join(root, 'public/assets/health-workspace.js'), 'utf8'); assert.match(health, /MGAEMS.sessionGuard/); assert.doesNotMatch(health, /localStorage|sessionStorage|caches\.|console\./);
});

test('retrying calendar filters invalidates an older export preview response', async () => {
  let calendarFailed = true; const pending = deferred();
  const h = harness({ get: url => url === '/api/v1/academic-years' && calendarFailed ? { ok: false, error: 'Calendar unavailable' } : url.startsWith('/api/v1/students?') ? pending.promise : undefined }).start(); await flush();
  h.ids.get('previewStudentReport').listeners.click(); await flush();
  calendarFailed = false; await h.ids.get('retryReportLookups').listeners.click(); await flush();
  pending.resolve({ ok: true, data: structuredClone(learners), meta: { total: 1 } }); await flush();
  assert.equal(h.ids.get('downloadStudentReport').disabled, true); assert.match(h.ids.get('studentExportPreview').innerHTML, /Preview required/);
});

test('cleared report selections cancel old PDF ownership without unlocking a newer duplicate request', async () => {
  const firstDownload = deferred(), secondDownload = deferred(); let calls = 0;
  const card = { id: 7, student_id: 8, term_id: 2, revision_number: 2, history_state: 'versioned', generated_at: '2026-10-14T06:00:00Z', download_available: true };
  const h = harness({ get: url => url.startsWith('/api/v1/report-cards?') ? { ok: true, data: card } : undefined, download: () => ++calls === 1 ? firstDownload.promise : secondDownload.promise }).start(); await flush();
  await h.change('cardClass', '10'); await h.change('cardTerm', '2'); await h.change('cardStudent', '8');
  const first = h.ids.get('downloadReportCard').listeners.click(); await flush();
  await h.change('cardStudent', ''); await h.change('cardStudent', '8');
  assert.equal(h.downloads[0][2].isCurrent(), false);
  const latestButton = h.ids.get('downloadReportCard'), second = latestButton.listeners.click(); await flush();
  firstDownload.resolve({ ok: true }); await first;
  latestButton.listeners.click(); assert.equal(h.downloads.length, 2); assert.equal(h.toasts.length, 0);
  secondDownload.resolve({ ok: false, error: 'Retry current PDF' }); await second;
  assert.match(h.ids.get('reportDownloadState').innerHTML, /Retry current PDF/); assert.equal(latestButton.disabled, false);
});
