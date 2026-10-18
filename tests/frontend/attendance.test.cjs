// DOM interface checks, not browser rendering or a live authenticated session.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const script = name => fs.readFileSync(path.resolve(__dirname, '../../public/assets', name), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ role = 'teacher', classes = [{ id: 1, name: '<Owned class>' }], denied = false, rosterError = false, post, confirm = true, summary } = {}) {
  const ids = new Map(), requests = [], writes = [], confirmations = [], notifications = [];
  const document = { activeElement: null, getElementById: id => ids.get(id) || null, querySelectorAll: () => [] };
  class Element {
    constructor(tag = 'div', attrs = {}) {
      this.tag = tag; this.attrs = attrs; this.children = []; this.listeners = {}; this.dataset = {}; this.disabled = 'disabled' in attrs;
      this.hidden = 'hidden' in attrs; this.name = attrs.name || ''; this.value = attrs.value || ''; this.required = 'required' in attrs;
      for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      if (attrs.id) ids.set(attrs.id, this);
      this.classList = { toggle() {} };
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
  const window = { location: { pathname: '/attendance.html', href: '/attendance.html' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  const context = vm.createContext({ document, window, URLSearchParams, setTimeout,
    localStorage: { getItem: key => key === 'mgaems_token' ? 'memory-session' : key === 'mgaems_user' ? JSON.stringify({ username: 'test', role }) : null },
    renderAppShell() { new Element('main', { id: 'appMain' }); } });
  vm.runInContext(script('app.js'), context); const app = vm.runInContext('MGAEMS', context);
  const data = {
    class: { id: 1, name: '<Owned class>' }, attendance_date: '2026-10-06', counts: { present: 1, absent: 0, late: 0, excused: 0 }, recorded_count: 1,
    unrecorded_count: 1, blocked_count: 1, recording_state: 'partially_recorded', learners: [
      { id: 10, admission_no: '<A10>', first_name: '<Unrecorded>', last_name: 'Learner', status: null, editable: true, historical: false },
      { id: 11, admission_no: 'A11', first_name: '<Recorded>', last_name: 'Learner', status: 'present', editable: true, historical: true },
      { id: 12, admission_no: 'A12', first_name: 'Unavailable', last_name: 'Learner', status: null, editable: false, historical: false, unavailable_reason: '<Historical conflict>' },
    ],
  };
  app.get = async url => {
    requests.push(url);
    if (url.endsWith('my-classes')) return denied ? { ok: false, status: 403, error: '<Staff link required>' } : { ok: true, data: classes, meta: { today: '2026-10-06', timezone: 'Africa/Nairobi', statuses: ['present', 'absent', 'late', 'excused'], max_records: 1000 } };
    if (url.includes('/roster?')) return rosterError ? { ok: false, status: 503, error: '<Roster unavailable>' } : { ok: true, data: structuredClone(data) };
    if (url.includes('/summary?')) return { ok: true, data: summary || { counts: { present: 0, absent: 0, late: 0, excused: 0 }, total_records: 0, attendance_rate: null } };
    return { ok: true, data: [], meta: { page: 1, per_page: 25, total: 0 } };
  };
  app.post = async (url, body) => { writes.push({ url, body: structuredClone(body) }); return post ? post(url, body) : { ok: true, data: [], meta: { created: 1, updated: 0, unchanged: 1 } }; };
  app.confirmAction = async (...args) => { confirmations.push(args); return confirm; };
  app.toast = (...args) => notifications.push(args);
  vm.runInContext(script('attendance.js'), context);
  return { ids, app, context, requests, writes, confirmations, notifications, data,
    async load() { await flush(); ids.get('attendanceClass').value = '1'; ids.get('attendanceFilter').listeners.submit({ preventDefault() {} }); await flush(); },
  };
}

test('attendance discovers only server-permitted classes and uses the school date', async () => {
  const h = harness(); await flush();
  assert.equal(h.requests[0], '/api/v1/attendance/my-classes');
  assert.equal(h.requests.some(url => /^\/api\/v1\/(classes|students|staff)/.test(url)), false);
  assert.match(h.ids.get('attendanceClass').innerHTML, /&lt;Owned class&gt;/);
  assert.equal(h.ids.get('attendanceDate').value, '2026-10-06');
  assert.equal(h.ids.get('attendanceDate').max, '2026-10-06');
  assert.match(h.ids.get('attendanceDateNote').textContent, /Africa\/Nairobi/);
});

test('no permitted classes and rejected staff linkage fail closed with honest states', async () => {
  const empty = harness({ classes: [] }); const denied = harness({ denied: true }); await flush();
  assert.match(empty.ids.get('attendanceSetup').innerHTML, /No permitted classes/);
  assert.equal(empty.ids.get('attendanceWorkspace').hidden, true);
  assert.equal(empty.requests.length, 1);
  assert.match(denied.ids.get('attendanceSetup').innerHTML, /&lt;Staff link required&gt;/);
  assert.match(denied.ids.get('attendanceSetup').innerHTML, /Try again/);
  assert.equal(denied.requests.length, 1);
});

test('roster preserves unrecorded state, escapes API data, and disables foreign historical conflicts', async () => {
  const h = harness(); await h.load();
  assert.equal(h.ids.get('attendanceStatus_10').value, '');
  assert.equal(h.ids.get('attendanceStatus_11').value, 'present');
  assert.equal(h.ids.get('attendanceStatus_12').disabled, true);
  assert.equal(h.ids.get('saveAttendance').disabled, true);
  assert.match(h.ids.get('attendanceRoster').innerHTML, /Not yet recorded|Historical class record/);
  assert.match(h.ids.get('attendanceRoster').innerHTML, /&lt;Unrecorded&gt;|&lt;Historical conflict&gt;/);
  assert.doesNotMatch(h.ids.get('attendanceRoster').innerHTML, /<Unrecorded>|<Historical conflict>/);
});

test('marked learners save in one bulk request, with duplicate submission blocked while awaiting response', async () => {
  let resolve; const h = harness({ post: () => new Promise(done => { resolve = done; }) }); await h.load();
  const control = h.ids.get('attendanceStatus_10'); control.value = 'late'; control.listeners.change();
  const form = h.ids.get('attendanceRosterForm'); const first = form.listeners.submit({ preventDefault() {} });
  form.listeners.submit({ preventDefault() {} }); await flush();
  assert.equal(h.writes.length, 1);
  assert.equal(h.ids.get('attendanceDate').disabled, true);
  assert.equal(h.ids.get('saveAttendance').disabled, true);
  assert.deepEqual(h.writes[0].body.records, [{ student_id: 10, status: 'late' }, { student_id: 11, status: 'present' }]);
  assert.equal(h.writes[0].body.class_id, 1);
  assert.equal(h.writes[0].body.attendance_date, '2026-10-06');
  resolve({ ok: true, data: [], meta: { created: 1, updated: 0, unchanged: 1 } }); await first;
  assert.equal(h.ids.get('attendanceDate').disabled, false);
  assert.match(h.notifications[0][0], /1 new/);
});

test('correction errors preserve selections, require confirmation, and show escaped field feedback', async () => {
  const h = harness({ post: async () => ({ ok: false, status: 422, error: '<Conflict>', fields: { 'records.0.student_id': ['<Placement changed>'] } }) }); await h.load();
  const control = h.ids.get('attendanceStatus_11'); control.value = 'absent'; control.listeners.change();
  await h.ids.get('attendanceRosterForm').listeners.submit({ preventDefault() {} });
  assert.match(h.confirmations[0][0], /Correct recorded attendance/);
  assert.equal(control.value, 'absent'); assert.equal(control.disabled, false);
  assert.equal(control.getAttribute('aria-invalid'), 'true');
  assert.match(h.ids.get('attendanceRosterForm').querySelector('[data-form-error]').innerHTML, /&lt;Conflict&gt;|&lt;Placement changed&gt;/);
  assert.equal(h.ids.get('saveAttendance').disabled, false);
});

test('failed roster load cannot become an editable fabricated roster', async () => {
  const h = harness({ rosterError: true }); await h.load();
  assert.match(h.ids.get('attendanceRoster').innerHTML, /&lt;Roster unavailable&gt;/);
  assert.match(h.ids.get('attendanceRoster').innerHTML, /Try again/);
  assert.equal(h.ids.has('saveAttendance'), false);
  assert.equal(h.writes.length, 0);
});

test('explicit mark-unrecorded action preserves existing selections and never changes unavailable rows', async () => {
  const h = harness(); await h.load();
  await h.ids.get('markUnrecorded').listeners.click();
  assert.match(h.confirmations[0][0], /Mark unrecorded learners present/);
  assert.equal(h.ids.get('attendanceStatus_10').value, 'present');
  assert.equal(h.ids.get('attendanceStatus_11').value, 'present');
  assert.equal(h.ids.get('attendanceStatus_12').value, '');
  assert.equal(h.ids.get('attendanceStatus_12').disabled, true);
  assert.equal(h.ids.get('saveAttendance').disabled, false);
});

test('parent and sponsor landing remains separate and other roles do not load staff attendance', () => {
  for (const role of ['parent_guardian', 'sponsor', 'secretary']) {
    const h = harness({ role }); assert.equal(h.requests.length, 0);
    if (role !== 'secretary') assert.match(vm.runInContext('window.location.href', h.context), /portal\.html$/);
  }
});

test('cancelled selection change keeps unsaved attendance and restores the loaded class/date', async () => {
  const h = harness({ confirm: false }); await h.load();
  const control = h.ids.get('attendanceStatus_10'); control.value = 'late'; control.listeners.change();
  h.ids.get('attendanceDate').value = '2026-10-05'; await h.ids.get('attendanceDate').listeners.change();
  assert.equal(h.ids.get('attendanceDate').value, '2026-10-06');
  assert.equal(control.value, 'late'); assert.equal(h.ids.get('saveAttendance').disabled, false);
  assert.equal(h.writes.length, 0);
});

test('empty history and zero-record summary do not fabricate absences or an attendance rate', async () => {
  const h = harness({ role: 'head_teacher' }); await flush();
  assert.match(h.ids.get('attendanceHistory').innerHTML, /No recorded attendance matches/);
  h.ids.get('summaryClass').value = '1'; h.ids.get('attendanceSummaryFilter').listeners.submit({ preventDefault() {} }); await flush();
  assert.match(h.ids.get('attendanceSummary').innerHTML, /0 recorded attendance rows/);
  assert.match(h.ids.get('attendanceSummary').innerHTML, /no rate is available/);
  assert.doesNotMatch(h.ids.get('attendanceSummary').innerHTML, /Present-record rate:.*%/);
});
