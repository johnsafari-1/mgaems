// Synthetic DOM checks exercise UI behavior; browser rendering is a separate gate.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const script = name => fs.readFileSync(path.resolve(__dirname, '../../public/assets', name), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ role = 'teacher', confirm = true, get, post, classes = [{ id: 4, name: 'Permitted class' }] } = {}) {
  const ids = new Map(), requests = [], writes = [], confirmations = [], notices = [], windowEvents = {};
  const document = { activeElement: null, getElementById: id => ids.get(id) || null, querySelectorAll: () => [] };
  class Element {
    constructor(tag = 'div', attrs = {}) {
      this.tag = tag; this.attrs = attrs; this.children = []; this.listeners = {}; this.dataset = {}; this.disabled = 'disabled' in attrs;
      this.hidden = 'hidden' in attrs; this.name = attrs.name || ''; this.value = attrs.value || ''; this.required = 'required' in attrs;
      for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      if (attrs.id) ids.set(attrs.id, this);
      const classes = new Set((attrs.class || '').split(' '));
      this.classList = { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } };
    }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name]; }
    removeAttribute(name) { delete this.attrs[name]; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    focus() { document.activeElement = this; }
    appendChild(child) { this.children.push(child); child.parentElement = this; }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    get elements() { return this.descendants().filter(child => ['input', 'select', 'button'].includes(child.tag)); }
    reportValidity() { return this.elements.every(control => control.disabled || !control.required || control.value !== ''); }
    querySelectorAll(selector) {
      return this.descendants().filter(child => selector.split(',').some(part => {
        part = part.trim();
        if (part.startsWith('[')) { const [, key, value] = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/) || []; return key in child.attrs && (value === undefined || child.attrs[key] === value); }
        return child.tag === part;
      }));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get innerHTML() { return this.html || ''; }
    set innerHTML(html) {
      for (const node of this.descendants()) if (node.attrs.id && ids.get(node.attrs.id) === node) ids.delete(node.attrs.id);
      this.html = html; this.children = []; const stack = [this];
      for (const token of html.matchAll(/<\/?[a-z][^>]*>/gi)) {
        const source = token[0]; const closing = /^<\//.test(source); const tag = source.match(/^<\/?([a-z0-9]+)/i)[1].toLowerCase();
        if (closing) { const index = stack.map(node => node.tag).lastIndexOf(tag); if (index > 0) stack.length = index; continue; }
        const attrs = {};
        for (const match of source.slice(tag.length + 1, -1).matchAll(/([a-z][\w-]*)(?:="([^"]*)")?/gi)) attrs[match[1]] = match[2] || '';
        const node = new Element(tag, attrs); stack.at(-1).appendChild(node);
        if (!['input', 'br', 'hr', 'meta', 'link', 'img'].includes(tag)) stack.push(node);
      }
      for (const control of this.descendants().filter(node => node.tag === 'select')) {
        const choices = control.children.filter(node => node.tag === 'option'); control.value = (choices.find(node => 'selected' in node.attrs) || choices[0])?.attrs.value || '';
      }
    }
  }
  document.documentElement = new Element('html');
  const window = { location: { pathname: '/attendance.html', href: '/attendance.html' }, addEventListener(name, handler) { windowEvents[name] = handler; }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  const context = vm.createContext({ document, window, URLSearchParams, setTimeout,
    localStorage: { getItem: key => key === 'mgaems_token' ? 'synthetic-token' : key === 'mgaems_user' ? JSON.stringify({ username: 'fixture', role }) : null },
    renderAppShell() { new Element('main', { id: 'appMain' }); } });
  vm.runInContext(script('app.js'), context); const app = vm.runInContext('MGAEMS', context);
  const roster = { class: { id: 4, name: 'Permitted class' }, attendance_date: '2026-10-06', counts: { present: 1, absent: 0, late: 0, excused: 0 }, recorded_count: 1, unrecorded_count: 1, blocked_count: 1, recording_state: 'partially_recorded', learners: [
    { id: 10, admission_no: 'A10', first_name: 'Unrecorded', last_name: 'Learner', status: null, editable: true },
    { id: 11, admission_no: 'A11', first_name: 'Recorded', last_name: 'Learner', status: 'present', editable: true, historical: true },
    { id: 12, admission_no: 'A12', first_name: 'Blocked', last_name: 'Learner', status: null, editable: false, unavailable_reason: 'Historical placement conflict' },
  ] };
  app.get = async url => {
    requests.push(url);
    const custom = get ? get(url, roster) : undefined;
    if (custom !== undefined) return custom;
    if (url.endsWith('my-classes')) return { ok: true, data: classes, meta: { today: '2026-10-06', timezone: 'Africa/Nairobi', statuses: ['present', 'absent', 'late', 'excused'] } };
    if (url.includes('/roster?')) return { ok: true, data: structuredClone(roster) };
    if (url.includes('/summary?')) return { ok: true, data: { counts: { present: 0, absent: 0, late: 0, excused: 0 }, total_records: 0, attendance_rate: null } };
    return { ok: true, data: [], meta: { page: 1, per_page: 25, total: 0 } };
  };
  app.post = async (url, body) => { writes.push({ url, body: structuredClone(body) }); return post ? post(url, body) : { ok: true, data: [], meta: { created: 1, updated: 0, unchanged: 1 } }; };
  app.confirmAction = async (...args) => { confirmations.push(args); return typeof confirm === 'function' ? confirm(...args) : confirm; };
  app.toast = (...args) => notices.push(args);
  vm.runInContext(script('attendance.js'), context);
  return { ids, requests, writes, confirmations, notices, windowEvents, roster,
    async load() { await flush(); ids.get('attendanceClass').value = '4'; ids.get('attendanceFilter').listeners.submit({ preventDefault() {} }); await flush(); },
    choose(learner, status) { ids.get(`attendanceChoice_${learner}_${status}`).listeners.click(); },
    submit() { return ids.get('attendanceRosterForm').listeners.submit({ preventDefault() {} }); },
  };
}

test('four explicit attendance choices keep missing records unrecorded and advertise pressed states', async () => {
  const h = harness(); await h.load();
  for (const status of ['present', 'absent', 'late', 'excused']) {
    assert.equal(h.ids.get(`attendanceChoice_10_${status}`).getAttribute('aria-pressed'), 'false');
    h.choose(10, status);
    assert.equal(h.ids.get('attendanceStatus_10').value, status);
    for (const other of ['present', 'absent', 'late', 'excused']) assert.equal(h.ids.get(`attendanceChoice_10_${other}`).getAttribute('aria-pressed'), String(other === status));
  }
  assert.match(h.ids.get('attendanceRoster').innerHTML, /Not yet recorded/);
  assert.equal(h.writes.length, 0);
});

test('selected counts update independently of persisted counts and show exact dirty rows', async () => {
  const h = harness(); await h.load();
  assert.match(h.ids.get('attendanceSelectedCounts').textContent, /Present 1.*Absent 0.*Not selected 1/);
  h.choose(10, 'late');
  assert.match(h.ids.get('attendanceSelectedCounts').textContent, /Present 1.*Late 1.*Not selected 0/);
  assert.match(h.ids.get('attendanceRoster').innerHTML, /Recorded Present<\/dt><dd>1/);
  assert.match(h.ids.get('attendanceUnsaved').textContent, /1 unsaved status change/);
  assert.equal(h.ids.get('attendanceRow_10').classList.contains('attendance-row-dirty'), true);
  assert.equal(h.ids.get('attendanceRow_11').classList.contains('attendance-row-dirty'), false);
});

test('returning to original and blank selections clears dirty state without recording an absence', async () => {
  const h = harness(); await h.load(); h.choose(11, 'absent'); h.choose(11, 'present');
  assert.equal(h.ids.get('saveAttendance').disabled, true);
  h.choose(10, 'late'); const control = h.ids.get('attendanceStatus_10'); control.value = ''; control.listeners.change();
  assert.equal(h.ids.get('saveAttendance').disabled, true);
  assert.match(h.ids.get('attendanceUnsaved').textContent, /No unsaved changes/);
  assert.equal(h.ids.get('attendanceRowState_10').textContent, 'Not yet recorded');
  assert.equal(h.writes.length, 0);
});

test('blocked historical placements disable every status action and cannot enter the bulk payload', async () => {
  const h = harness(); await h.load();
  for (const status of ['present', 'absent', 'late', 'excused']) {
    assert.equal(h.ids.get(`attendanceChoice_12_${status}`).disabled, true);
    h.choose(12, status);
  }
  assert.equal(h.ids.get('attendanceStatus_12').value, '');
  assert.equal(h.ids.get('saveAttendance').disabled, true);
  h.choose(10, 'present'); await h.submit();
  assert.equal(h.writes[0].body.records.some(row => row.student_id === 12), false);
});

test('new-status save confirmation names the loaded class/date and cancellation preserves the draft', async () => {
  const h = harness({ confirm: false }); await h.load(); h.choose(10, 'excused'); await h.submit();
  assert.equal(h.writes.length, 0);
  assert.match(h.confirmations[0][0], /Save marked attendance/);
  assert.match(h.confirmations[0][1], /Permitted class.*6 Oct 2026.*Unselected learners remain unrecorded/);
  assert.equal(h.ids.get('attendanceStatus_10').value, 'excused');
  assert.equal(h.ids.get('saveAttendance').disabled, false);
  assert.match(h.ids.get('attendanceUnsaved').textContent, /1 unsaved/);
});

test('pending confirmation blocks duplicate submits and locks all roster actions', async () => {
  let finish;
  const h = harness({ confirm: () => new Promise(resolve => { finish = resolve; }) }); await h.load(); h.choose(10, 'present');
  const saving = h.submit(); await h.submit();
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.ids.get('attendanceChoice_10_absent').disabled, true);
  assert.equal(h.ids.get('attendanceDate').disabled, true);
  h.choose(10, 'absent'); assert.equal(h.ids.get('attendanceStatus_10').value, 'present');
  finish(false); await saving;
  assert.equal(h.ids.get('attendanceChoice_10_absent').disabled, false);
  assert.equal(h.writes.length, 0);
});

test('row-level server conflicts map submitted indexes to the right learner and preserve corrections', async () => {
  const h = harness({ post: () => ({ ok: false, status: 422, error: 'Review the roster.', fields: { 'records.0.student_id': ['<Placement changed>'] } }) });
  await h.load(); h.choose(11, 'absent'); await h.submit();
  assert.equal(h.writes[0].body.records[0].student_id, 11);
  assert.equal(h.ids.get('attendanceRowError_11').textContent, '<Placement changed>');
  assert.equal(h.ids.get('attendanceRowError_10').textContent || '', '');
  assert.equal(h.ids.get('attendanceStatus_11').getAttribute('aria-invalid'), 'true');
  assert.equal(h.ids.get('attendanceRow_11').classList.contains('attendance-row-error-state'), true);
  assert.match(h.ids.get('attendanceRosterForm').querySelector('[data-form-error]').innerHTML, /&lt;Placement changed&gt;/);
  h.choose(11, 'late');
  assert.equal(h.ids.get('attendanceRowError_11').textContent, '');
  assert.equal(h.ids.get('attendanceStatus_11').getAttribute('aria-invalid'), undefined);
});

test('Class Teacher discovery is the sole roster scope and denied role pages never fetch attendance', async () => {
  const teacher = harness(); await teacher.load();
  assert.equal(teacher.requests[0], '/api/v1/attendance/my-classes');
  assert.match(teacher.requests.find(url => url.includes('/roster?')), /class_id=4/);
  assert.equal(teacher.requests.some(url => /^\/api\/v1\/(classes|students|staff)/.test(url)), false);
  for (const role of ['secretary', 'sponsor_coordinator', 'parent_guardian', 'sponsor', 'health_worker']) {
    const h = harness({ role }); await flush(); assert.equal(h.requests.length, 0);
  }
});

test('roster loading and empty states never create editable or inferred rows', async () => {
  let resolve;
  const h = harness({ get: (url, data) => url.includes('/roster?') ? new Promise(done => { resolve = () => done({ ok: true, data: { ...data, learners: [], counts: { present: 0, absent: 0, late: 0, excused: 0 }, recorded_count: 0, unrecorded_count: 0, blocked_count: 0, recording_state: 'not_recorded' } }); }) : undefined });
  await h.load();
  assert.match(h.ids.get('attendanceRoster').innerHTML, /Loading attendance roster/);
  assert.equal(h.ids.get('attendanceRoster').getAttribute('aria-busy'), 'true');
  assert.equal(h.ids.get('attendanceClass').disabled, true);
  assert.equal(h.ids.has('saveAttendance'), false);
  resolve(); await flush();
  assert.match(h.ids.get('attendanceRoster').innerHTML, /No eligible learners or retained records.*No absences have been inferred/s);
  assert.equal(h.ids.has('saveAttendance'), false);
});

test('readable history keeps recorded class and escaped learner details without mutation controls', async () => {
  const h = harness({ get: url => url.includes('/attendance/students?') ? { ok: true, data: [{ attendance_date: '2026-10-01', status: 'late', school_class: { name: '<Original class>' }, student: { first_name: '<Learner>', last_name: 'Fixture', admission_no: '<A1>' } }], meta: { total: 1, page: 1, per_page: 25 } } : undefined }); await flush();
  const html = h.ids.get('attendanceHistory').innerHTML;
  assert.match(html, /1 Oct 2026/); assert.match(html, /&lt;Original class&gt;/); assert.match(html, /&lt;A1&gt;/);
  assert.doesNotMatch(html, /data-attendance-status|data-learner|<Learner>/);
  assert.equal(h.writes.length, 0);
});

test('summary validates date ordering before requesting and zero records never invent a rate', async () => {
  const h = harness(); await flush(); h.ids.get('summaryClass').value = '4';
  h.ids.get('summaryFrom').value = '2026-10-06'; h.ids.get('summaryTo').value = '2026-10-01';
  h.ids.get('attendanceSummaryFilter').listeners.submit({ preventDefault() {} }); await flush();
  assert.equal(h.requests.some(url => url.includes('/summary?')), false);
  assert.equal(h.ids.get('summaryTo').getAttribute('aria-invalid'), 'true');
  h.ids.get('summaryFrom').value = '2026-10-01'; h.ids.get('summaryTo').value = '2026-10-06';
  h.ids.get('attendanceSummaryFilter').listeners.submit({ preventDefault() {} }); await flush();
  assert.match(h.ids.get('attendanceSummary').innerHTML, /Permitted class summary.*1 Oct 2026.*6 Oct 2026/s);
  assert.match(h.ids.get('attendanceSummary').innerHTML, /no rate is available/);
  assert.doesNotMatch(h.ids.get('attendanceSummary').innerHTML, /Present-record rate:/);
  assert.equal(h.ids.get('summaryTo').getAttribute('aria-invalid'), undefined);
});

test('pending summary response retains its loaded context when selectors change without a new request', async () => {
  let finish;
  const h = harness({ get: url => url.includes('/summary?') ? new Promise(resolve => { finish = resolve; }) : undefined }); await flush();
  h.ids.get('summaryClass').value = '4'; h.ids.get('summaryFrom').value = '2026-10-01'; h.ids.get('summaryTo').value = '2026-10-06';
  h.ids.get('attendanceSummaryFilter').listeners.submit({ preventDefault() {} });
  h.ids.get('summaryFrom').value = '2026-10-05';
  finish({ ok: true, data: { counts: { present: 1, absent: 0, late: 0, excused: 0 }, total_records: 1, attendance_rate: 100 } }); await flush();
  assert.match(h.ids.get('attendanceSummary').innerHTML, /1 Oct 2026.*6 Oct 2026/s);
  assert.doesNotMatch(h.ids.get('attendanceSummary').innerHTML, /5 Oct 2026/);
});

test('tab keyboard navigation and unload warnings follow the current dirty state', async () => {
  const h = harness(); await h.load(); const history = h.ids.get('attendanceTab_history'); let prevented = false;
  history.listeners.keydown({ key: 'End', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(h.ids.get('attendanceTab_summary').getAttribute('aria-selected'), 'true');
  assert.equal(h.ids.get('attendancePanel_summary').hidden, false);
  let warned = false; h.windowEvents.beforeunload({ preventDefault() { warned = true; } }); assert.equal(warned, false);
  h.choose(10, 'late'); const event = { preventDefault() { warned = true; } }; h.windowEvents.beforeunload(event);
  assert.equal(warned, true); assert.equal(event.returnValue, '');
});

test('dedicated styling preserves token colors, touch controls, focus and mobile roster labels', () => {
  const css = script('attendance.css');
  const html = fs.readFileSync(path.resolve(__dirname, '../../public/attendance.html'), 'utf8');
  assert.match(html, /href="\/assets\/attendance\.css"/);
  assert.match(css, /var\(--touch-target\)/); assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 640px\)/); assert.match(css, /content: attr\(data-label\)/);
  assert.match(css, /var\(--surface\)/); assert.doesNotMatch(css, /#[a-f0-9]{6}/i);
});

test('malformed permitted-class and school-date responses fail closed without a fabricated workspace', async () => {
  const valid = { ok: true, data: [{ id: 4, name: 'Permitted class' }], meta: { today: '2026-10-06', timezone: 'Africa/Nairobi', statuses: ['present', 'absent', 'late', 'excused'] } };
  for (const result of [
    { ...valid, data: null }, { ...valid, data: [{ id: 4 }] }, { ...valid, data: [{ id: true, name: 'Invalid identifier' }] }, { ...valid, meta: null },
    { ...valid, meta: { ...valid.meta, today: '2026-02-30' } },
    { ...valid, meta: { ...valid.meta, statuses: ['present', 'absent', 'late', 'late'] } },
    { ...valid, meta: { ...valid.meta, statuses: ['present', 'absent', 'late', {}] } },
  ]) {
    const h = harness({ get: url => url.endsWith('my-classes') ? result : undefined }); await flush();
    assert.match(h.ids.get('attendanceSetup').innerHTML, /could not be verified.*Try again/s);
    assert.equal(h.ids.get('attendanceWorkspace').hidden, true); assert.equal(h.requests.length, 1); assert.equal(h.writes.length, 0);
  }
});

test('malformed or wrong-context rosters offer retry without editable rows or inferred counts', async () => {
  const malformed = [
    data => null, data => ({ ...data, learners: null }),
    data => ({ ...data, class: { id: 99, name: 'Different class' } }),
    data => ({ ...data, attendance_date: '2026-10-05' }),
    data => ({ ...data, counts: { ...data.counts, present: -1 } }),
    data => ({ ...data, counts: { ...data.counts, present: '1' } }),
    data => ({ ...data, learners: [{ ...data.learners[0], status: {} }, ...data.learners.slice(1)] }),
    data => ({ ...data, learners: [data.learners[0], data.learners[0], data.learners[2]] }),
    data => ({ ...data, recorded_count: 2 }),
  ];
  for (const change of malformed) {
    const h = harness({ get: (url, data) => url.includes('/roster?') ? { ok: true, data: change(data) } : undefined }); await h.load();
    assert.match(h.ids.get('attendanceRoster').innerHTML, /could not be verified.*Try again/s);
    assert.equal(h.ids.get('attendanceRoster').getAttribute('aria-busy'), 'false');
    assert.equal(h.ids.get('attendanceClass').disabled, false); assert.equal(h.ids.has('saveAttendance'), false); assert.equal(h.writes.length, 0);
  }
});

test('history refuses malformed envelopes and unknown statuses instead of rendering incomplete rows', async () => {
  const valid = { ok: true, data: [{ attendance_date: '2026-10-01', status: 'present' }], meta: { total: 1, page: 1, per_page: 25 } };
  for (const result of [{ ...valid, data: null }, { ...valid, data: [null] }, { ...valid, data: [{ attendance_date: '2026-10-01', status: null }] }, { ...valid, meta: null }]) {
    const h = harness({ get: url => url.includes('/attendance/students?') ? result : undefined }); await flush();
    assert.match(h.ids.get('attendanceHistory').innerHTML, /history could not be verified.*Try again/s);
    assert.equal(h.ids.get('attendanceHistory').getAttribute('aria-busy'), 'false'); assert.equal(h.writes.length, 0);
  }
});

test('summary refuses malformed, inconsistent and wrong-date totals without invented statistics', async () => {
  const valid = { counts: { present: 0, absent: 0, late: 0, excused: 0 }, total_records: 0, attendance_rate: null };
  for (const data of [null, { ...valid, counts: null }, { ...valid, total_records: 1 }, { ...valid, attendance_rate: 0 }, { ...valid, from: '2026-10-02' }, { ...valid, counts: { ...valid.counts, absent: '0' } }]) {
    const h = harness({ get: url => url.includes('/summary?') ? { ok: true, data } : undefined }); await flush();
    h.ids.get('summaryClass').value = '4'; h.ids.get('attendanceSummaryFilter').listeners.submit({ preventDefault() {} }); await flush();
    assert.match(h.ids.get('attendanceSummary').innerHTML, /totals could not be verified.*Try again/s);
    assert.doesNotMatch(h.ids.get('attendanceSummary').innerHTML, /attendance-summary-cards|Present-record rate/);
    assert.equal(h.ids.get('attendanceSummary').getAttribute('aria-busy'), 'false'); assert.equal(h.writes.length, 0);
  }
});

test('incomplete save acknowledgement preserves the draft and asks to verify the recorded roster', async () => {
  const h = harness({ post: () => ({ ok: true, data: [], meta: null }) }); await h.load(); h.choose(10, 'late'); await h.submit();
  assert.equal(h.writes.length, 1); assert.equal(h.notices.length, 0);
  assert.equal(h.ids.get('attendanceStatus_10').value, 'late'); assert.equal(h.ids.get('saveAttendance').disabled, false);
  assert.match(h.ids.get('attendanceRosterForm').querySelector('[data-form-error]').innerHTML, /save response was incomplete.*Reload the roster/s);
  assert.match(h.ids.get('attendanceUnsaved').textContent, /1 unsaved/);
});
