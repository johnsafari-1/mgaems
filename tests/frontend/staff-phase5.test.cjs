// Synthetic DOM/API fixtures; these checks do not write school records or claim visual acceptance.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));
const person = (id = 1, extra = {}) => ({ id, first_name: 'Amina', last_name: 'Teacher', staff_type: 'teaching', role_title: 'Class Teacher', status: 'active', department_id: 4, department: { id: 4, name: 'Academics' }, phone: '0700000000', employment_date: '2026-01-05', contract_type: 'Permanent', user_id: 5, qualifications: [{ id: 21, qualification: 'Teaching Diploma', institution: 'Test College', year_obtained: '2020' }], emergency_contacts: [{ id: 31, full_name: 'Synthetic Contact', relationship: 'Sibling', phone: '0700000001' }], documents: [{ id: 41, doc_type: 'Certificate', uploaded_at: '2026-01-04T21:30:00.000Z', file_path: '/private/confidential.pdf' }], ...extra });

function harness({ role = 'head_teacher', get, write, confirm, people = [person(), person(2, { first_name: 'Synthetic', last_name: 'Caretaker', staff_type: 'non_teaching', role_title: 'Caretaker', status: 'on_leave', user_id: null, department_id: null, department: null })] } = {}) {
  const h = createDOM(role, '/staff.html'), reads = [], writes = [], confirmations = [], errors = [], toasts = [];
  h.document.createElement = tag => new h.Element(tag);
  const setAttribute = h.Element.prototype.setAttribute;
  h.Element.prototype.setAttribute = function (name, value) {
    setAttribute.call(this, name, value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  };
  h.document.querySelectorAll = selector => h.ids.get('appMain')?.querySelectorAll(selector) || [];
  h.app.get = async url => {
    reads.push(url); if (get) { const response = await get(url); if (response !== undefined) return response; }
    return { ok: true, data: structuredClone(url === '/api/v1/staff' ? people : url === '/api/v1/departments' ? [{ id: 4, name: 'Academics' }] : people.find(item => String(item.id) === url.split('/').at(-1))) };
  };
  for (const method of ['post', 'patch', 'del']) h.app[method] = async (url, body) => {
    writes.push({ method, url, body: structuredClone(body) });
    return write ? write(url, body, method) : { ok: true, data: { id: 100 } };
  };
  h.app.confirmAction = async (...args) => { confirmations.push(args); return confirm ? confirm(...args) : true; };
  const renderErrors = h.app.showFormErrors;
  h.app.showFormErrors = (form, response) => { errors.push(response); renderErrors(form, response); };
  h.app.toast = (...args) => toasts.push(args);
  return Object.assign(h, {
    reads, writes, confirmations, errors, toasts,
    start() { h.run('staff.js'); return this; },
    async filter(id, value) { const control = h.ids.get(id); control.value = value; control.listeners[id === 'staffSearch' ? 'input' : 'change'](); await settle(); },
    async action(kind, id = null, modal = null) {
      const host = modal?.body || h.ids.get('appMain');
      const button = host.querySelectorAll('[data-staff-action]').find(control => control.dataset.staffAction === kind && (id == null || control.dataset.id === String(id)));
      assert.ok(button, `Missing staff action ${kind} ${id}`);
      host.listeners.click({ target: { closest: () => button } }); await settle(); return h.modals.at(-1);
    },
    async open(id = 1) { return this.action('profile', id); },
    async create() { h.ids.get('addStaff').listeners.click(); await settle(); return h.modals.at(-1); },
    async submit(form, values = {}) { for (const [name, value] of Object.entries(values)) { const control = form.elements.namedItem(name); assert.ok(control, `Missing field ${name}`); control.value = value; } await form.listeners.submit({ preventDefault() {} }); await settle(); },
  });
}

test('only authorized administration roles request Staff and department records', async () => {
  for (const role of ['teacher', 'parent_guardian', 'sponsor', 'sponsor_coordinator', 'health_officer', 'unknown']) {
    const h = harness({ role }).start(); await settle(); assert.deepEqual(h.reads, []); assert.match(h.ids.get('appMain').innerHTML, /authorized school administration/);
  }
  for (const role of ['system_admin', 'head_teacher', 'deputy_head_teacher']) {
    const h = harness({ role }).start(); await settle(); assert.deepEqual(h.reads, ['/api/v1/staff', '/api/v1/departments']);
    assert.equal(h.ids.has('addStaff'), role !== 'deputy_head_teacher');
    const modal = await h.open(); assert.match(modal.body.innerHTML, /Edit employment details/);
  }
});

test('directory distinguishes types, employment, saved identity and actual counts', async () => {
  const h = harness().start(); await settle(); const html = h.ids.get('staffTable').innerHTML;
  for (const value of ['Amina Teacher', 'Teaching', 'Non Teaching', 'Class Teacher', 'Academics', 'Permanent', '5 Jan 2026', 'Active', 'On Leave', 'Account linked', 'No account linked']) assert.match(html, new RegExp(value));
  assert.equal(h.ids.get('staffResultCount').textContent, '2 of 2 staff shown');
  assert.deepEqual(h.ids.get('staffStats').querySelectorAll('[data-staff-count]').map(item => item.textContent), [2, 1, 1, 1]);
});

test('directory filters name, department, type and status without extra requests', async () => {
  const h = harness().start(); await settle(); const before = h.reads.length;
  await h.filter('staffSearch', 'academics'); assert.match(h.ids.get('staffTable').innerHTML, /Amina/); assert.doesNotMatch(h.ids.get('staffTable').innerHTML, /Caretaker/);
  await h.filter('staffSearch', ''); await h.filter('staffTypeFilter', 'non_teaching'); assert.match(h.ids.get('staffTable').innerHTML, /Caretaker/);
  await h.filter('staffStatusFilter', 'active'); assert.match(h.ids.get('staffTable').innerHTML, /No staff match/);
  await h.action('clear'); assert.equal(h.ids.get('staffSearch').value, ''); assert.equal(h.ids.get('staffResultCount').textContent, '2 of 2 staff shown'); assert.equal(h.reads.length, before);
});

test('pending directory loads, empty responses and failures have independent useful states', async () => {
  let resolve; const loading = harness({ get: url => url === '/api/v1/staff' ? new Promise(done => { resolve = done; }) : undefined }).start();
  assert.match(loading.ids.get('staffTable').innerHTML, /Loading staff directory/); assert.equal(loading.ids.get('addStaff').disabled, true);
  resolve({ ok: true, data: [] }); await settle(); assert.match(loading.ids.get('staffTable').innerHTML, /No staff records available/);
  const failed = harness({ get: url => url === '/api/v1/staff' ? { ok: false, error: 'Directory unavailable' } : undefined }).start(); await settle();
  assert.match(failed.ids.get('staffTable').innerHTML, /Directory unavailable|Try again/); assert.equal(failed.ids.get('addStaff').disabled, true);
  assert.deepEqual(failed.ids.get('staffStats').querySelectorAll('[data-staff-count]').map(item => item.textContent), Array(4).fill('Not available'));
});

test('missing departments block employment creation and edits without hiding qualifications', async () => {
  const h = harness({ get: url => url === '/api/v1/departments' ? { ok: false, error: 'Options unavailable' } : undefined }).start(); await settle();
  assert.equal(h.ids.get('addStaff').disabled, true); assert.match(h.ids.get('staffDirectoryNotice').innerHTML, /Options unavailable/);
  const modal = await h.open(); assert.doesNotMatch(modal.body.innerHTML, /data-staff-action="edit"/); assert.match(modal.body.innerHTML, /Add qualification/);
});

test('profile tabs expose correct accessible relationships and arrow/Home/End navigation', async () => {
  const h = harness().start(); await settle(); const modal = await h.open();
  const details = h.ids.get('staffTab_details'), contacts = h.ids.get('staffTab_contacts');
  assert.equal(details.getAttribute('aria-selected'), 'true'); assert.equal(h.ids.get('staffPanel_contacts').hidden, true);
  details.listeners.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(h.ids.get('staffTab_qualifications').getAttribute('aria-selected'), 'true'); assert.equal(h.ids.get('staffPanel_qualifications').hidden, false);
  contacts.listeners.keydown({ key: 'End', preventDefault() {} }); assert.equal(h.document.activeElement, h.ids.get('staffTab_documents'));
  contacts.listeners.keydown({ key: 'Home', preventDefault() {} }); assert.equal(h.document.activeElement, details);
  assert.match(modal.body.innerHTML, /role="tablist"/); assert.match(modal.body.innerHTML, /aria-labelledby="staffTab_documents"/);
});

test('staff branding remains owned by shared navigation and documents expose metadata only', async () => {
  const h = harness().start(); await settle(); const modal = await h.open();
  assert.match(modal.body.innerHTML, /Certificate|On file|5 Jan 2026/); assert.doesNotMatch(modal.body.innerHTML, /confidential\.pdf/);
  assert.match(modal.body.innerHTML, /Account links are managed separately/);
  const script = fs.readFileSync(path.resolve(__dirname, '../../public/assets/staff.js'), 'utf8');
  assert.match(script, /renderAppShell\('\/staff\.html'\)/); assert.doesNotMatch(script, /Logo_Manna|logo\.png|school-logo\.png|onclick=/);
  assert.match(script, /MGAEMS\.openModal/); assert.doesNotMatch(script, /createElement\('div'\).*modal-overlay/);
});

test('employment and document dates use school timezone and missing dates are not invented', async () => {
  const h = harness({ people: [person(1, { employment_date: null, documents: [{ id: 51, doc_type: 'Example', uploaded_at: null }] })] }).start(); await settle();
  assert.match(h.ids.get('staffTable').innerHTML, /Since Not recorded/);
  const modal = await h.open(); assert.match(modal.body.innerHTML, /Uploaded Not recorded/); assert.doesNotMatch(modal.body.innerHTML, /datetime="2026/);
});

test('late profile responses cannot restore a closed dialog or overwrite another staff profile', async () => {
  let resolve; const h = harness({ get: url => url === '/api/v1/staff/1' ? new Promise(done => { resolve = done; }) : undefined }).start(); await settle();
  const first = await h.open(); first.close(); resolve({ ok: true, data: person() }); await settle(); assert.match(first.body.innerHTML, /Loading/);
  let old; const second = harness({ get: url => url === '/api/v1/staff/1' ? new Promise(done => { old = done; }) : undefined }).start(); await settle();
  const a = await second.open(1), b = await second.open(2); old({ ok: true, data: person() }); await settle();
  assert.equal(a.closed, true); assert.match(b.body.innerHTML, /Synthetic Caretaker/); assert.doesNotMatch(b.body.innerHTML, /Amina Teacher/);
});

test('profile mismatch and failed reads show retry and never render another identity', async () => {
  const h = harness({ get: url => url === '/api/v1/staff/1' ? { ok: true, data: person(99) } : undefined }).start(); await settle();
  const modal = await h.open(); assert.match(modal.body.innerHTML, /could not be loaded/); assert.doesNotMatch(modal.body.innerHTML, /Amina/); assert.ok(h.ids.get('staffProfileRetry'));
});

test('create validates required fields, retains error drafts and never links or creates an account', async () => {
  const h = harness({ write: () => ({ ok: false, error: 'Review staff details', fields: { first_name: ['Invalid first name'] } }) }).start(); await settle();
  const modal = await h.create(), form = modal.body.querySelector('form'); assert.equal(form.elements.namedItem('employment_date').value, '');
  await h.submit(form); assert.equal(h.writes.length, 0); assert.match(h.errors[0].error, /required/);
  await h.submit(form, { first_name: 'New', last_name: 'Synthetic', staff_type: 'teaching', role_title: 'Teacher', employment_date: '2026-01-01' });
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].url, '/api/v1/staff');
  assert.equal('user_id' in h.writes[0].body, false); assert.equal('status' in h.writes[0].body, false); assert.deepEqual(h.writes[0].body.qualifications, []);
  assert.equal(modal.closed, false); assert.equal(form.elements.namedItem('first_name').value, 'New'); assert.equal(form.elements.namedItem('first_name').getAttribute('aria-invalid'), 'true');
});

test('invalid employment dates do not throw or submit and impossible dates receive feedback', async () => {
  const h = harness().start(); await settle(); const modal = await h.create(), form = modal.body.querySelector('form');
  for (const employment_date of ['2026-99-20', '2026-02-30']) await h.submit(form, { first_name: 'New', last_name: 'Synthetic', staff_type: 'teaching', role_title: 'Teacher', employment_date });
  assert.equal(h.writes.length, 0); assert.equal(h.errors.length, 2); assert.ok(h.errors[1].fields.employment_date);
});

test('create qualification and emergency-contact rows use labeled required controls and four-digit year validation', async () => {
  const h = harness().start(); await settle(); const modal = await h.create(), form = modal.body.querySelector('form');
  await h.action('add-qualification', null, modal); await h.action('add-contact', null, modal);
  const entry = { first_name: 'New', last_name: 'Synthetic', staff_type: 'teaching', role_title: 'Teacher', employment_date: '2026-01-01', qualification_1_name: 'Degree', qualification_1_institution: 'Fixture Institute', qualification_1_year: '999', contact_2_name: 'Contact', contact_2_phone: '' };
  await h.submit(form, entry); assert.equal(h.writes.length, 0); assert.ok(h.errors.at(-1).fields.qualification_1_year); assert.ok(h.errors.at(-1).fields.contact_2_phone);
  await h.submit(form, { qualification_1_year: '1899', contact_2_phone: '0700000002' }); assert.equal(h.writes.length, 1);
  assert.deepEqual(h.writes[0].body.qualifications, [{ qualification: 'Degree', institution: 'Fixture Institute', year_obtained: '1899' }]);
  assert.deepEqual(h.writes[0].body.emergency_contacts, [{ full_name: 'Contact', relationship: null, phone: '0700000002' }]);
});

test('duplicate create submissions issue one request and saving dialog cannot close', async () => {
  let resolve; const h = harness({ write: () => new Promise(done => { resolve = done; }) }).start(); await settle(); const modal = await h.create(), form = modal.body.querySelector('form');
  const pending = h.submit(form, { first_name: 'New', last_name: 'Synthetic', staff_type: 'non_teaching', role_title: 'Assistant', employment_date: '2026-01-01' });
  await settle(); await h.submit(form); assert.equal(h.writes.length, 1); assert.equal(modal.busy, true); modal.close(); assert.equal(modal.closed, false);
  resolve({ ok: true, data: person() }); await pending; assert.equal(modal.closed, true); assert.match(h.toasts[0][0], /added/);
});

test('deputy edits existing records while account relationships remain excluded', async () => {
  const h = harness({ role: 'deputy_head_teacher' }).start(); await settle(); const modal = await h.open(); await h.action('edit', null, modal);
  const form = h.ids.get('staffEditForm'); await h.submit(form, { phone: '0700000099', role_title: 'Updated Teacher' });
  assert.equal(h.writes[0].method, 'patch'); assert.equal(h.writes[0].url, '/api/v1/staff/1'); assert.equal('user_id' in h.writes[0].body, false);
  assert.equal(h.writes[0].body.status, 'active'); assert.equal(h.confirmations.length, 0);
});

test('status and staff-type changes require confirmation and preserve server rejection drafts', async () => {
  for (const change of [{ status: 'on_leave' }, { staff_type: 'non_teaching' }]) {
    const h = harness({ write: () => ({ ok: false, status: 422, error: 'Linked Teacher requires teaching Staff', fields: { staff_type: ['Incompatible linked role'] } }) }).start(); await settle(); const modal = await h.open(); await h.action('edit', null, modal);
    const form = h.ids.get('staffEditForm'); await h.submit(form, change); assert.equal(h.confirmations.length, 1); assert.match(h.confirmations[0][1], /session invalidation/);
    assert.equal(h.writes.length, 1); assert.equal(modal.closed, false); assert.equal(form.elements.namedItem(Object.keys(change)[0]).value, Object.values(change)[0]); assert.match(h.errors[0].error, /Linked Teacher/);
  }
  const canceled = harness({ confirm: () => false }).start(); await settle(); const modal = await canceled.open(); await canceled.action('edit', null, modal); await canceled.submit(canceled.ids.get('staffEditForm'), { status: 'terminated' }); assert.equal(canceled.writes.length, 0);
});

test('changed session during confirmation cannot write and duplicate edit requests are blocked', async () => {
  let confirm; const h = harness({ confirm: () => new Promise(done => { confirm = done; }) }).start(); await settle(); const modal = await h.open(); await h.action('edit', null, modal); const form = h.ids.get('staffEditForm');
  const pending = h.submit(form, { status: 'on_leave' }); await settle(); await h.submit(form); assert.equal(h.confirmations.length, 1);
  assert.equal(form.elements.namedItem('status').disabled, true); modal.close(); assert.equal(modal.closed, false);
  h.app.currentUser = () => ({ username: 'changed-user', role: 'head_teacher' }); confirm(true); await pending; assert.equal(h.writes.length, 0); assert.match(modal.body.innerHTML, /no longer available/);
});

test('qualification editors preserve the API contract and allow all server-compatible four-digit years', async () => {
  const h = harness().start(); await settle(); const modal = await h.open(); await h.action('qualification-edit', 21, modal);
  const form = h.ids.get('staffRecordForm_qualifications'); assert.equal(form.elements.namedItem('qualification').value, 'Teaching Diploma');
  await h.submit(form, { year_obtained: '123' }); assert.equal(h.writes.length, 0); assert.ok(h.errors[0].fields.year_obtained);
  await h.submit(form, { year_obtained: '2201' }); assert.equal(h.writes[0].url, '/api/v1/staff/1/qualifications/21'); assert.equal(h.writes[0].method, 'patch'); assert.equal(h.writes[0].body.year_obtained, '2201');
});

test('emergency contacts validate identity and phone, preserve errors and prevent duplicate saving', async () => {
  let resolve; const h = harness({ write: () => new Promise(done => { resolve = done; }) }).start(); await settle(); const modal = await h.open(); await h.action('contact-add', null, modal); const form = h.ids.get('staffRecordForm_contacts');
  await h.submit(form, { full_name: 'Synthetic Contact' }); assert.equal(h.writes.length, 0); assert.ok(h.errors[0].fields.phone);
  const pending = h.submit(form, { phone: '0700000009', relationship: 'Sibling' }); await settle(); await h.submit(form); assert.equal(h.writes.length, 1);
  assert.deepEqual(h.writes[0], { method: 'post', url: '/api/v1/staff/1/emergency-contacts', body: { full_name: 'Synthetic Contact', relationship: 'Sibling', phone: '0700000009' } });
  resolve({ ok: false, status: 422, error: 'Contact rejected', fields: { phone: ['Phone rejected'] } }); await pending;
  assert.equal(form.elements.namedItem('phone').value, '0700000009'); assert.equal(form.elements.namedItem('phone').getAttribute('aria-invalid'), 'true');
});

test('removing nested records requires confirmation, preserves endpoints and blocks duplicate confirmations', async () => {
  let resolve; const h = harness({ confirm: () => new Promise(done => { resolve = done; }) }).start(); await settle(); const modal = await h.open();
  await h.action('qualification-remove', 21, modal); await h.action('qualification-remove', 21, modal); assert.equal(h.confirmations.length, 1); assert.match(h.confirmations[0][1], /Teaching Diploma.*Amina Teacher/);
  resolve(true); await settle(); assert.deepEqual(h.writes[0], { method: 'del', url: '/api/v1/staff/1/qualifications/21', body: undefined });
  const canceled = harness({ confirm: () => false }).start(); await settle(); const dialog = await canceled.open(); await canceled.action('contact-remove', 31, dialog); assert.equal(canceled.writes.length, 0);
});

test('authorization loss during removal clears protected profile context', async () => {
  const h = harness({ write: () => ({ ok: false, status: 403, error: 'Forbidden' }) }).start(); await settle(); const modal = await h.open(); await h.action('contact-remove', 31, modal);
  assert.match(modal.body.innerHTML, /no longer authorized/); assert.doesNotMatch(modal.body.innerHTML, /Synthetic Contact|Amina Teacher/);
});

test('directory and profile escape untrusted names, metadata and error details', async () => {
  const h = harness({ people: [person(1, { first_name: '<script>', last_name: '<Person>', role_title: '<Role>', phone: '<Phone>', documents: [{ id: 52, doc_type: '<Private>', uploaded_at: null }] })] }).start(); await settle();
  assert.doesNotMatch(h.ids.get('staffTable').innerHTML, /<script>|<Role>|<Phone>/); const modal = await h.open(); assert.match(modal.body.innerHTML, /&lt;script&gt;/); assert.match(modal.body.innerHTML, /&lt;Private&gt;/);
});

test('dedicated styling preserves token themes, mobile directory reflow and keyboard focus', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../public/staff.html'), 'utf8'), css = fs.readFileSync(path.resolve(__dirname, '../../public/assets/staff.css'), 'utf8');
  assert.match(html, /\/assets\/staff\.css/); assert.match(css, /@media \(max-width: 768px\)/); assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /content: attr\(data-label\)/); assert.match(css, /:focus-visible/); assert.match(css, /var\(--touch-target\)/); assert.doesNotMatch(css, /#[a-fA-F0-9]{3,8}|linear-gradient/);
});

test('invalid staff or department rows fail safely without rendering incomplete records', async () => {
  for (const people of [[null], [person(0)], [person(1, { department: [null] })], [person(1, { status: 'invented' })]]) {
    const h = harness({ people }).start(); await settle(); assert.match(h.ids.get('staffTable').innerHTML, /could not be loaded/); assert.equal(h.ids.get('addStaff').disabled, true);
  }
  const h = harness({ get: url => url === '/api/v1/departments' ? { ok: true, data: [null] } : undefined }).start(); await settle(); assert.equal(h.ids.get('addStaff').disabled, true); assert.match(h.ids.get('staffDirectoryNotice').innerHTML, /Department options are unavailable/);
});

test('malformed profile record arrays fail closed while absent optional arrays use empty states', async () => {
  for (const data of [person(1, { qualifications: [null] }), person(1, { emergency_contacts: { id: 3 } }), person(1, { documents: [null] })]) {
    const h = harness({ get: url => url === '/api/v1/staff/1' ? { ok: true, data } : undefined }).start(); await settle(); const modal = await h.open(); assert.match(modal.body.innerHTML, /could not be loaded/); assert.doesNotMatch(modal.body.innerHTML, /Amina/);
  }
  const h = harness({ people: [person(1, { qualifications: undefined, emergency_contacts: undefined, documents: undefined })] }).start(); await settle(); const modal = await h.open(); assert.match(modal.body.innerHTML, /No qualifications recorded/); assert.match(modal.body.innerHTML, /No emergency contacts recorded/); assert.match(modal.body.innerHTML, /No documents recorded/);
});

test('directory refresh removes stale rows and counts while filters cannot repaint old responses', async () => {
  let next = false, resolve; const h = harness({ get: url => next && url === '/api/v1/staff' ? new Promise(done => { resolve = done; }) : undefined }).start(); await settle();
  next = true; const clear = h.ids.get('appMain').querySelectorAll('[data-staff-action]').find(item => item.dataset.staffAction === 'clear'); clear.dataset.staffAction = 'retry';
  await h.action('retry'); assert.match(h.ids.get('staffTable').innerHTML, /Loading/); assert.deepEqual(h.ids.get('staffStats').querySelectorAll('[data-staff-count]').map(item => item.textContent), Array(4).fill('—'));
  await h.filter('staffSearch', 'amina'); assert.match(h.ids.get('staffTable').innerHTML, /Loading/); assert.doesNotMatch(h.ids.get('staffTable').innerHTML, /Amina Teacher/);
  resolve({ ok: true, data: [] }); await settle(); assert.match(h.ids.get('staffTable').innerHTML, /No staff match/);
});

test('late responses after token or user identity changes never render confidential staff data', async () => {
  for (const change of ['token', 'identity', 'role', 'path']) {
    let resolve; const h = harness({ get: url => url === '/api/v1/staff/1' ? new Promise(done => { resolve = done; }) : undefined }).start(); await settle(); const modal = await h.open();
    if (change === 'token') h.context.localStorage.getItem = key => key === 'mgaems_token' ? 'different-session' : JSON.stringify({ username: 'test-user', role: 'head_teacher' });
    if (change === 'identity') h.app.currentUser = () => ({ username: 'different-user', role: 'head_teacher' });
    if (change === 'role') h.app.currentUser = () => ({ username: 'test-user', role: 'teacher' });
    if (change === 'path') h.context.window.location.pathname = '/dashboard.html';
    resolve({ ok: true, data: person() }); await settle(); assert.doesNotMatch(modal.body.innerHTML, /Amina Teacher|Synthetic Contact/); assert.match(modal.body.innerHTML, /no longer available/);
  }
});

test('saved form cannot submit after account, role or page changes', async () => {
  for (const change of ['role', 'path']) {
    const h = harness().start(); await settle(); const modal = await h.open(); await h.action('edit', null, modal); const form = h.ids.get('staffEditForm');
    if (change === 'role') h.app.currentUser = () => ({ username: 'test-user', role: 'teacher' }); else h.context.window.location.pathname = '/visitors.html';
    await h.submit(form, { phone: '0700000099' }); assert.equal(h.writes.length, 0); assert.match(modal.body.innerHTML, /no longer available/);
  }
});

test('backend nested qualification and contact validation maps to visible create controls', async () => {
  const h = harness({ write: () => ({ ok: false, error: 'Check nested details', fields: { 'qualifications.0.year_obtained': ['Year rejected'], 'emergency_contacts.0.phone': ['Phone rejected'] } }) }).start(); await settle(); const modal = await h.create(), form = modal.body.querySelector('form');
  await h.action('add-qualification', null, modal); await h.action('add-contact', null, modal);
  await h.submit(form, { first_name: 'New', last_name: 'Synthetic', staff_type: 'teaching', role_title: 'Teacher', employment_date: '2026-01-01', qualification_1_name: 'Degree', qualification_1_year: '2020', contact_2_name: 'Contact', contact_2_phone: '0700000008' });
  assert.equal(form.elements.namedItem('qualification_1_year').getAttribute('aria-invalid'), 'true'); assert.equal(form.elements.namedItem('contact_2_phone').getAttribute('aria-invalid'), 'true'); assert.match(form.querySelector('[data-form-error]').innerHTML, /Year rejected/); assert.match(form.querySelector('[data-form-error]').innerHTML, /Phone rejected/);
});

test('confirmation freezes form controls and cancellation restores exactly their previous enabled state', async () => {
  let resolve; const h = harness({ confirm: () => new Promise(done => { resolve = done; }) }).start(); await settle(); const modal = await h.open(); await h.action('edit', null, modal); const form = h.ids.get('staffEditForm'), phone = form.elements.namedItem('phone'); phone.disabled = true;
  const pending = h.submit(form, { status: 'on_leave' }); await settle(); assert.ok(form.elements.filter(control => control.tag !== 'button').every(control => control.disabled));
  resolve(false); await pending; assert.equal(form.elements.namedItem('status').disabled, false); assert.equal(phone.disabled, true); assert.equal(h.writes.length, 0);
});

test('tab switching and profile navigation cannot interrupt an active record save', async () => {
  let resolve; const h = harness({ write: () => new Promise(done => { resolve = done; }) }).start(); await settle(); const modal = await h.open(); await h.action('qualification-add', null, modal); const form = h.ids.get('staffRecordForm_qualifications');
  const pending = h.submit(form, { qualification: 'Fixture Diploma' }); await settle(); const initial = h.ids.get('staffTab_details').getAttribute('aria-selected');
  h.ids.get('staffTab_contacts').listeners.click(); assert.equal(h.ids.get('staffTab_details').getAttribute('aria-selected'), initial); await h.open(2); assert.equal(h.modals.length, 1); assert.equal(h.reads.includes('/api/v1/staff/2'), false);
  resolve({ ok: false, error: 'Save unavailable' }); await pending;
});

test('editing separate profile panels keeps control IDs and label targets unique', async () => {
  const h = harness().start(); await settle(); const modal = await h.open(); await h.action('edit', null, modal); await h.action('contact-add', null, modal); await h.action('qualification-add', null, modal);
  const ids = modal.body.querySelectorAll('[id]').map(control => control.getAttribute('id')); assert.equal(new Set(ids).size, ids.length);
  for (const input of modal.body.querySelectorAll('input')) assert.equal(modal.body.querySelectorAll('label').filter(label => label.getAttribute('for') === input.getAttribute('id')).length, 1);
});

test('authorization errors on Staff reads or writes clear private directory and profile context', async () => {
  const directory = harness({ get: url => url === '/api/v1/staff' ? { ok: false, status: 403, error: 'Forbidden' } : undefined }).start(); await settle(); assert.match(directory.ids.get('appMain').innerHTML, /session changed/); assert.doesNotMatch(directory.ids.get('appMain').innerHTML, /Amina/);
  const h = harness({ write: () => ({ ok: false, status: 403, error: 'Forbidden' }) }).start(); await settle(); const modal = await h.open(); await h.action('edit', null, modal); await h.submit(h.ids.get('staffEditForm'), { phone: '0700000099' });
  assert.match(modal.body.innerHTML, /no longer authorized/); assert.doesNotMatch(modal.body.innerHTML, /Amina Teacher/); assert.match(h.ids.get('appMain').innerHTML, /session changed/);
});
