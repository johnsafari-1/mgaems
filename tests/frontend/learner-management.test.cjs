// Isolated DOM workflow tests. No requests are sent to the school database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const ok = (data, meta) => ({ ok: true, data, ...(meta ? { meta } : {}) });
const learner = { id: 8, admission_no: '<MGA-8>', first_name: '<Ada>', last_name: 'Learner', class_id: 10, school_class: { id: 10, name: '<Grade 1>' }, status: 'active', gender: 'female', date_of_birth: '2018-01-01', admission_date: '2026-01-01',
  guardians: [{ id: 3, full_name: '<Guardian>', relationship: 'Mother', phone: '0123456789', is_primary_contact: true }], medical_info: 'CONFIDENTIAL-SENTINEL', safeguarding: 'CONFIDENTIAL-SENTINEL' };
const guardian = { id: 3, full_name: '<Guardian>', relationship: 'Mother', phone: '0123456789', email: null, address: null, is_primary_contact: true, access_status: 'active', account: { id: 4, username: '<Family>', email: 'family@example.test', status: 'active' }, students_count: 1, students_truncated: false,
  students: [{ id: 8, name: '<Ada> Learner', admission_no: '<MGA-8>', class: '<Grade 1>', relationship: 'Mother', is_primary_contact: true }] };

function harness({ role = 'head_teacher', page = 'students', get, write, search = '' } = {}) {
  const h = createDOM(role, `/${page}.html`), requests = [], writes = [], errors = [], toasts = [], confirmations = [];
  h.context.window.location.search = search;
  h.context.FormData = class {
    constructor(form) { this.entries = form.elements.filter(control => control.name && !control.disabled && (control.attrs.type !== 'checkbox' || control.checked)).map(control => [control.name, control.value]); }
    [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
  };
  h.document.createElement = tag => new h.Element(tag);
  h.app.showFormErrors = (form, result) => { errors.push(result); };
  h.app.toast = (message, type) => { toasts.push({ message, type }); };
  h.app.confirmAction = async (...args) => { confirmations.push(args); return true; };
  h.app.get = async url => {
    requests.push(url);
    if (get) { const result = await get(url); if (result) return result; }
    if (url === '/api/v1/classes') return ok([{ id: 10, name: '<Grade 1>' }, { id: 20, name: 'Grade 2' }]);
    if (url === '/api/v1/terms') return ok([{ id: 1, name: 'Term 1' }]);
    if (url.startsWith('/api/v1/students?')) return ok([learner], { page: Number(new URLSearchParams(url.split('?')[1]).get('page')), per_page: 15, total: 16 });
    if (url === '/api/v1/students/8') return ok(learner);
    if (url.endsWith('/academic-history')) return ok({ promotions_transfers: [] });
    if (url.startsWith('/api/v1/sponsorships?')) return ok([]);
    if (url.startsWith('/api/v1/guardians/accounts?')) return ok([{ ...guardian.account, linked: true }], { page: 1, per_page: 20, total: 1 });
    if (url.startsWith('/api/v1/guardians?')) return ok([guardian], { page: 1, per_page: 20, total: 1 });
    throw new Error('Unexpected request: ' + url);
  };
  for (const method of ['post', 'patch', 'del']) h.app[method] = async (url, payload) => { writes.push({ method, url, payload }); return write ? write(url, payload) : ok(learner); };
  h.run(page + '.js');
  const click = control => control.listeners.click({ currentTarget: control, preventDefault() {} });
  const submit = form => form.listeners.submit({ preventDefault() {} });
  return { ...h, requests, writes, errors, toasts, confirmations, click, submit };
}

test('leadership directory has real ranges, escaped values, labeled filters and profile/edit actions', async () => {
  const h = harness(); await flush();
  assert.equal(h.ids.get('learnerResultsSummary').textContent, 'Showing 1–1 of 16 learners');
  assert.match(h.ids.get('appMain').innerHTML, /<label for="searchInput">|<label for="classFilter">/);
  const html = h.ids.get('studentsTableWrap').innerHTML;
  assert.match(html, /&lt;Ada&gt;|&lt;MGA-8&gt;/); assert.doesNotMatch(html, /<Ada>|CONFIDENTIAL-SENTINEL/);
  assert.match(html, /role="region"[^>]*tabindex="0"/); assert.match(html, /data-edit="8"/);
  assert.equal(h.ids.get('addStudentBtn').disabled, false);
});

test('search, class and status are encoded server filters; changing them resets the page', async () => {
  const h = harness(); await flush();
  await h.click(h.ids.get('paginationBar').querySelector('[data-page="1"]')); await flush();
  assert.match(h.requests.at(-1), /page=2/);
  h.ids.get('searchInput').value = 'Ada & MGA'; h.ids.get('classFilter').value = '10'; h.ids.get('statusFilter').value = 'left';
  h.ids.get('statusFilter').listeners.change(); await flush();
  const params = new URLSearchParams(h.requests.at(-1).split('?')[1]);
  assert.equal(params.get('page'), '1'); assert.equal(params.get('search'), 'Ada & MGA'); assert.equal(params.get('class_id'), '10'); assert.equal(params.get('status'), 'left');
  await h.click(h.ids.get('clearFilters')); await flush();
  assert.equal(h.ids.get('searchInput').value, ''); assert.equal(h.ids.get('classFilter').value, ''); assert.equal(h.ids.get('statusFilter').value, '');
  assert.equal(h.document.activeElement, h.ids.get('searchInput'));
});

test('typing invalidates pending directory requests before the debounce completes', async () => {
  const pending = deferred(); let count = 0;
  const h = harness({ get: url => url.startsWith('/api/v1/students?') && ++count === 1 ? pending.promise : null });
  h.ids.get('searchInput').value = 'latest'; h.ids.get('searchInput').listeners.input();
  pending.resolve(ok([{ ...learner, first_name: 'STALE-NAME' }], { page: 1, per_page: 15, total: 1 })); await flush();
  assert.doesNotMatch(h.ids.get('studentsTableWrap').innerHTML, /STALE-NAME/);
  await h.click(h.ids.get('clearFilters')); await flush();
});

test('invalid pagination and recoverable errors never invent counts and offer retry', async () => {
  let count = 0;
  const h = harness({ get: url => url.startsWith('/api/v1/students?') && ++count === 1 ? ok([], { total: -1, per_page: 0 }) : null }); await flush();
  assert.equal(h.ids.get('learnerResultsSummary').textContent, 'Learners could not be loaded.');
  assert.equal(h.ids.get('paginationBar').hidden, true);
  await h.click(h.ids.get('studentsTableWrap').querySelector('button')); await flush();
  assert.match(h.ids.get('studentsTableWrap').innerHTML, /&lt;Ada&gt;/);
});

test('filtered empty results display zero without fake learner statistics', async () => {
  const h = harness({ get: url => url.startsWith('/api/v1/students?') ? ok([], { page: 1, total: 0, per_page: 15 }) : null }); await flush();
  h.ids.get('searchInput').value = 'absent'; h.ids.get('statusFilter').listeners.change(); await flush();
  assert.match(h.ids.get('studentsTableWrap').innerHTML, /No learners match/);
  assert.equal(h.ids.get('learnerResultsSummary').textContent, 'Showing 0–0 of 0 learners matching filters');
});

test('profile sections omit confidential fields and support arrows, Home and End with roving focus', async () => {
  const h = harness(); await flush(); await h.click(h.ids.get('studentsTableWrap').querySelector('[data-profile]')); await flush();
  const modal = h.modals[0], tabs = modal.body.querySelectorAll('[role="tab"]');
  assert.equal(tabs.length, 4); assert.match(modal.body.innerHTML, /Primary contact|Manage guardians/); assert.doesNotMatch(modal.body.innerHTML, /CONFIDENTIAL-SENTINEL/);
  assert.equal(h.document.activeElement, tabs[0]);
  tabs[0].listeners.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true'); assert.equal(h.ids.get('learnerPanel_overview').hidden, true); assert.equal(h.ids.get('learnerPanel_guardians').hidden, false);
  tabs[1].listeners.keydown({ key: 'End', preventDefault() {} }); assert.equal(h.document.activeElement, tabs[3]);
  tabs[3].listeners.keydown({ key: 'Home', preventDefault() {} }); assert.equal(h.document.activeElement, tabs[0]);
});

test('dismissed learner profiles ignore late responses', async () => {
  const pending = deferred(); const h = harness({ get: url => url === '/api/v1/students/8' ? pending.promise : null }); await flush();
  await h.click(h.ids.get('studentsTableWrap').querySelector('[data-profile]')); h.modals[0].close(); pending.resolve(ok(learner)); await flush();
  assert.doesNotMatch(h.modals[0].body.innerHTML, /&lt;Ada&gt;/);
});

test('history and sponsorship failures remain separate from a loaded overview and can be retried', async () => {
  let failing = true;
  const h = harness({ get: url => failing && (url.endsWith('/academic-history') || url.startsWith('/api/v1/sponsorships?')) ? { ok: false, error: 'Temporarily unavailable' } : null }); await flush();
  await h.click(h.ids.get('studentsTableWrap').querySelector('[data-profile]')); await flush();
  const modal = h.modals[0]; assert.match(modal.body.innerHTML, /&lt;Ada&gt;|Retry profile records/);
  await h.click(h.ids.get('learnerTab_history')); failing = false;
  await h.click(modal.body.children.at(-1)); await flush();
  assert.equal(h.ids.get('learnerTab_history').getAttribute('aria-selected'), 'true'); assert.match(modal.body.innerHTML, /No promotion or transfer history/);
});

for (const status of ['active', 'transferred', 'left', 'promoted']) test(`lifecycle actions respect ${status} enrollment`, async () => {
  const h = harness({ get: url => url === '/api/v1/students/8' ? ok({ ...learner, status }) : null }); await flush();
  await h.click(h.ids.get('studentsTableWrap').querySelector('[data-profile]')); await flush();
  const actions = h.modals[0].body.querySelectorAll('[data-action]').map(control => control.dataset.action);
  assert.deepEqual(actions, status === 'active' ? ['edit', 'promote', 'transfer_out', 'left'] : status === 'promoted' ? ['edit'] : ['edit', 'transfer_in']);
});

test('admission form groups existing requirements, blocks incomplete/double saves and retains backend errors', async () => {
  const pending = deferred(), h = harness({ write: () => pending.promise }); await flush();
  await h.click(h.ids.get('addStudentBtn')); await flush();
  const modal = h.modals[0], form = modal.body.querySelector('form');
  assert.equal(form.querySelectorAll('fieldset').length, 2);
  assert.deepEqual(form.elements.filter(control => control.required).map(control => control.name), ['first_name', 'last_name', 'date_of_birth', 'gender', 'class_id', 'admission_date']);
  await h.submit(form); assert.equal(h.writes.length, 0);
  for (const [name, value] of Object.entries({ first_name: ' Ada ', last_name: 'Learner', date_of_birth: '2018-01-01', gender: 'female', class_id: '10', admission_date: '2026-01-01' })) form.elements.namedItem(name).value = value;
  form.elements.date_of_birth.listeners.change(); assert.equal(form.elements.admission_date.min, '2018-01-01');
  const saving = h.submit(form); await h.submit(form); assert.equal(h.writes.length, 1); assert.equal(modal.busy, true);
  assert.equal(h.writes[0].payload.first_name, 'Ada'); assert.equal('status' in h.writes[0].payload, false); assert.equal('medical' in h.writes[0].payload, false);
  pending.resolve({ ok: false, error: 'Check dates', fields: { admission_date: ['Admission cannot precede birth.'] } }); await saving;
  assert.equal(modal.closed, false); assert.equal(modal.busy, false); assert.equal(h.errors[0].fields.admission_date[0], 'Admission cannot precede birth.');
});

test('admission date defaults to the school timezone at a UTC day boundary', async () => {
  const h = harness(); h.context.Date = class extends Date { constructor() { super('2026-10-12T22:00:00Z'); } }; await flush();
  await h.click(h.ids.get('addStudentBtn')); await flush(); assert.equal(h.ids.get('learner_admission_date').value, '2026-10-13');
});

test('editing uses the authorized profile and never submits class or admission fields', async () => {
  const h = harness(); await flush(); await h.click(h.ids.get('studentsTableWrap').querySelector('[data-edit]')); await flush();
  const form = h.modals[0].body.querySelector('form'); await h.submit(form); await flush();
  assert.equal(h.writes[0].method, 'patch'); assert.equal(h.writes[0].url, '/api/v1/students/8');
  for (const field of ['class_id', 'admission_date', 'admission_no', 'status', 'medical']) assert.equal(field in h.writes[0].payload, false);
});

test('a late directory edit response cannot open a form after the filters change', async () => {
  const pending = deferred(), h = harness({ get: url => url === '/api/v1/students/8' ? pending.promise : null }); await flush();
  const editing = h.click(h.ids.get('studentsTableWrap').querySelector('[data-edit]'));
  h.ids.get('statusFilter').value = 'left'; h.ids.get('statusFilter').listeners.change(); await flush();
  pending.resolve(ok(learner)); await editing; assert.equal(h.modals.length, 0);
});

test('promotion excludes current class, uses the latest dated history and reviews the destination before saving', async () => {
  const h = harness({ get: url => url.endsWith('/academic-history') ? ok({ promotions_transfers: [{ effective_date: '2026-02-01', type: 'promotion' }, { effective_date: '2026-03-01', type: 'promotion' }] }) : null }); await flush();
  await h.click(h.ids.get('studentsTableWrap').querySelector('[data-profile]')); await flush();
  await h.click(h.modals[0].body.querySelector('[data-action="promote"]')); await flush();
  const form = h.modals[1].body.querySelector('form');
  assert.deepEqual(form.elements.to_class_id.children.map(choice => choice.attrs.value), ['', '20']);
  assert.equal(form.elements.effective_date.attrs.min, '2026-03-01');
  form.elements.to_class_id.value = '20'; form.elements.term_id.value = '1'; await h.submit(form); await flush();
  assert.match(h.confirmations[0][1], /Grade 2|Enrollment remains active/); assert.equal(h.writes[0].url, '/api/v1/students/8/promote');
});

test('canceling lifecycle confirmation sends no mutation', async () => {
  const h = harness(); h.app.confirmAction = async () => false; await flush();
  await h.click(h.ids.get('studentsTableWrap').querySelector('[data-profile]')); await flush();
  await h.click(h.modals[0].body.querySelector('[data-action="left"]')); assert.equal(h.writes.length, 0);
});

test('guardian directory displays per-learner primary status and existing portal association', async () => {
  const h = harness({ page: 'guardians', search: '?student_id=8' }); await flush();
  assert.match(h.requests[0], /student_id=8/); assert.match(h.ids.get('guardiansTable').innerHTML, /Primary contact|Active account|&lt;Family&gt;/);
  assert.equal(h.ids.get('guardianResultsSummary').textContent, 'Showing 1–1 of 1 guardian contacts matching filters');
  await h.click(h.ids.get('clearLearnerFilter')); await flush(); assert.equal(new URLSearchParams(h.requests.at(-1).split('?')[1]).has('student_id'), false);
  assert.equal(h.document.activeElement, h.ids.get('guardianSearch'));
});

test('guardian creation preselects the contextual learner and keeps account creation optional', async () => {
  const h = harness({ page: 'guardians', search: '?student_id=8' }); await flush(); await h.click(h.ids.get('addGuardianBtn')); await flush();
  const form = h.modals[0].body.querySelector('form');
  assert.match(h.ids.get('selectedLearners').innerHTML, /1 learner\(s\) selected/); assert.equal(h.ids.get('accountMode').value, 'none');
  form.elements.full_name.value = 'Guardian'; form.elements.relationship.value = 'Mother'; form.elements.phone.value = '0123456789'; await h.submit(form); await flush();
  assert.deepEqual(Array.from(h.writes[0].payload.student_ids), [8]); assert.equal(h.writes[0].payload.user_id, null); assert.equal('account' in h.writes[0].payload, false);
});

test('guardian edit preserves unmodified per-child primary and relationship fields', async () => {
  const h = harness({ page: 'guardians' }); await flush(); await h.click(h.ids.get('guardiansTable').querySelector('[data-edit]')); await flush();
  const form = h.modals[0].body.querySelector('form'); form.elements.full_name.value = 'Updated guardian'; await h.submit(form); await flush();
  assert.equal(h.writes[0].payload.full_name, 'Updated guardian'); assert.equal('relationship' in h.writes[0].payload, false); assert.equal('is_primary_contact' in h.writes[0].payload, false); assert.equal(h.confirmations.length, 0);
});

test('linking excludes existing children and blocks empty/double submissions', async () => {
  const pending = deferred(), h = harness({ page: 'guardians', write: () => pending.promise, get: url => url.startsWith('/api/v1/students?') ? ok([learner, { ...learner, id: 9 }], { page: 1, total: 2, per_page: 25 }) : null }); await flush();
  await h.click(h.ids.get('guardiansTable').querySelector('[data-link]')); await flush();
  assert.deepEqual(h.ids.get('learnerChoices').querySelectorAll('[data-choice]').map(control => control.dataset.choice), ['9']);
  const form = h.modals[0].body.querySelector('form'); await h.submit(form); assert.equal(h.writes.length, 0); assert.match(h.errors[0].error, /Select at least/);
  const choice = h.ids.get('learnerChoices').querySelector('[data-choice]'); choice.checked = true; choice.listeners.change();
  const saving = h.submit(form); await h.submit(form); assert.equal(h.writes.length, 1); assert.deepEqual(Array.from(h.writes[0].payload.student_ids), [9]);
  pending.resolve(ok({})); await saving;
});

test('guardian search uses server pagination, rejects stale results and can clear its query', async () => {
  const pending = deferred(); let count = 0;
  const h = harness({ page: 'guardians', get: url => url.startsWith('/api/v1/guardians?') && ++count === 1 ? pending.promise : null });
  h.ids.get('guardianSearch').value = 'Family & child'; h.ids.get('guardianSearch').listeners.input({ target: h.ids.get('guardianSearch') });
  pending.resolve(ok([{ ...guardian, full_name: 'STALE-CONTACT' }], { page: 1, per_page: 20, total: 1 })); await flush();
  assert.doesNotMatch(h.ids.get('guardiansTable').innerHTML, /STALE-CONTACT/);
  await new Promise(resolve => setTimeout(resolve, 320)); await flush();
  const params = new URLSearchParams(h.requests.at(-1).split('?')[1]); assert.equal(params.get('search'), 'Family & child'); assert.equal(params.get('per_page'), '20');
  await h.click(h.ids.get('clearGuardianSearch')); await flush(); assert.equal(h.ids.get('guardianSearch').value, ''); assert.equal(new URLSearchParams(h.requests.at(-1).split('?')[1]).has('search'), false);
});

test('canceling a Parent Portal association change preserves access and sends no write', async () => {
  const h = harness({ page: 'guardians' }); h.app.confirmAction = async (...args) => { h.confirmations.push(args); return false; }; await flush();
  await h.click(h.ids.get('guardiansTable').querySelector('[data-edit]')); await flush();
  h.ids.get('accountMode').value = 'none'; h.ids.get('accountMode').listeners.change();
  await h.submit(h.modals[0].body.querySelector('form'));
  assert.match(h.confirmations[0][1], /all of this contact/); assert.equal(h.writes.length, 0); assert.equal(h.modals[0].closed, false);
});

test('unlink requires a confirmation and duplicate clicks cannot issue a second delete', async () => {
  const pending = deferred(), h = harness({ page: 'guardians', write: () => pending.promise }); await flush();
  const button = h.ids.get('guardiansTable').querySelector('[data-unlink]'); const removing = h.click(button); await flush(); await h.click(button);
  assert.match(h.confirmations[0][1], /portal access|Other learner links remain|account is retained/); assert.equal(h.writes.length, 1); assert.equal(h.writes[0].method, 'del');
  pending.resolve(ok({})); await removing;
});

test('parent, sponsor, coordinator and student roles request no general learner or guardian data', async () => {
  for (const role of ['parent_guardian', 'sponsor', 'sponsor_coordinator', 'student']) for (const page of ['students', 'guardians']) {
    const h = harness({ role, page }); await flush(); assert.equal(h.requests.length, 0); assert.equal(h.writes.length, 0);
  }
  const teacher = harness({ role: 'teacher' }); await flush(); assert.equal(teacher.requests.length, 0); // The assignment-scoped Workspace owns this role.
});

test('learner pages include token-based responsive styling and all referenced local assets exist', () => {
  const root = path.resolve(__dirname, '../../public');
  for (const page of ['students', 'guardians']) {
    const html = fs.readFileSync(path.join(root, page + '.html'), 'utf8'); assert.match(html, /learner-management.css/);
    for (const [, asset] of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) assert.ok(fs.existsSync(path.join(root, asset)), asset);
  }
  const css = fs.readFileSync(path.join(root, 'assets/learner-management.css'), 'utf8');
  assert.doesNotMatch(css, /#[a-f0-9]{3,8}\b|@import|animation:/i); assert.match(css, /max-width: 900px|:focus-visible/); assert.match(css, /max-width: 640px/); assert.match(css, /grid-template-columns: 1fr/); assert.match(css, /var\(--touch-target\)/);
});
