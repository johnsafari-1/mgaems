// In-memory DOM/API fixtures only. No real authentication, backups or school writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const settings = { school_name: 'Fixture School', logo_path: 'school/fixture.png' };
const account = (id = 8) => ({ id, username: `Fixture ${id}`, email: 'fixture@example.invalid', role: 'teacher', status: 'active', account_link: { required: true, eligible: false, staff: null } });
function admin({ role = 'system_admin', get, write, confirm = true } = {}) {
  const h = createDOM(role, '/administration.html');
  const setter = h.Element.prototype.setAttribute;
  h.Element.prototype.setAttribute = function (name, value) { setter.call(this, name, value); if (name === 'name') this.name = value; };
  h.Element.prototype.insertAdjacentHTML = function (position, html) { assert.equal(position, 'beforeend'); this.innerHTML += html; };
  h.reads = []; h.writes = []; h.notices = []; h.confirmations = []; h.links = [];
  h.app.schoolSettings = async () => ({ ok: true, data: settings });
  h.app.get = async url => {
    h.reads.push(url);
    if (get) { const result = await get(url); if (result !== undefined) return result; }
    if (url === '/api/v1/roles') return { ok: true, data: [{ id: 1, name: 'teacher' }, { id: 2, name: 'head_teacher' }, { id: 3, name: 'student' }] };
    if (/\/users\?/.test(url)) return { ok: true, data: [account()], meta: { page: Number(new URLSearchParams(url.split('?')[1]).get('page')), per_page: 15, total: 17 } };
    if (/\/users\/\d+$/.test(url)) return { ok: true, data: account(Number(url.split('/').at(-1))) };
    if (/audit-logs/.test(url)) return { ok: true, data: [{ id: 1, action: 'FIXTURE_ACTION', created_at: '2026-10-14T07:00:00Z', user: { username: 'Fixture actor' } }], meta: { page: 1, per_page: 25, total: 1 } };
    if (url === '/api/v1/backups') return { ok: true, data: [{ filename: 'fixture.sql', size_bytes: 64, created_at: '2026-10-14T07:00:00Z' }] };
    return { ok: false, status: 404, error: 'Fixture endpoint unavailable' };
  };
  for (const method of ['post', 'patch', 'del']) h.app[method] = async (url, body) => { h.writes.push({ method, url, body: structuredClone(body) }); return write ? write(url, body) : { ok: true, data: account() }; };
  h.app.confirmAction = async (...args) => { h.confirmations.push(args); return typeof confirm === 'function' ? confirm(...args) : confirm; };
  h.app.toast = (...args) => h.notices.push(args);
  h.app.download = async (...args) => { h.downloads = args; return { ok: true }; };
  h.context.window.MGAEMSAccountLinks = { status: () => 'Verified Staff linking required', open: (...args) => h.links.push(args) };
  h.run('administration.js');
  h.ready = flush;
  return h;
}
const click = (h, id) => h.ids.get(id).listeners.click();
const field = (h, id, value) => { h.ids.get(id).value = value; };
const submit = h => h.ids.get('adminUserForm').listeners.submit({ preventDefault() {} });

test('Administrator sees account management, Head sees permitted review/settings only', async () => {
  const a = admin(); await a.ready(); assert.ok(a.ids.has('usersTable')); assert.equal(a.ids.get('usersSummary').textContent, '17');
  const head = admin({ role: 'head_teacher' }); await head.ready();
  assert.equal(head.ids.has('usersTable'), false); assert.equal(head.ids.has('createBackupBtn'), false);
  assert.equal(head.reads.some(url => /users|roles|staff/.test(url)), false);
  assert.ok(head.ids.has('schoolSettingsForm')); assert.equal(head.ids.get('backupTable').querySelector('[data-download-backup]'), null);
});
for (const role of ['deputy_head_teacher', 'teacher', 'parent_guardian', 'sponsor', 'sponsor_coordinator', 'student']) test(`${role} cannot initialize Administration operations`, async () => {
  const h = admin({ role }); await h.ready(); assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.ids.has('usersTable'), false);
});
test('administration tabs support arrows, Home/End, panel semantics and selected focus', async () => {
  const h = admin(); await h.ready(); let prevented = false;
  h.ids.get('usersTab').listeners.keydown({ key: 'End', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(h.document.activeElement, h.ids.get('backupsTab')); assert.equal(h.ids.get('backupsPanel').hidden, false); assert.equal(h.ids.get('usersPanel').hidden, true);
  assert.equal(h.ids.get('settingsTab').getAttribute('aria-controls'), 'settingsPanel');
});
test('page-local account search, role/status filters and bounded server pagination stay honest', async () => {
  const h = admin(); await h.ready(); field(h, 'userSearch', 'missing'); h.ids.get('userSearch').listeners.input({ target: h.ids.get('userSearch') });
  assert.match(h.ids.get('usersTable').innerHTML, /No accounts match this page search/); assert.equal(h.ids.get('usersSummary').textContent, '17');
  field(h, 'userRoleFilter', 'teacher'); h.ids.get('userRoleFilter').listeners.change({ target: h.ids.get('userRoleFilter') }); await h.ready();
  assert.match(h.reads.at(-1), /role=teacher/);
  const next = h.ids.get('usersPagination').querySelectorAll('[data-delta]').find(button => button.dataset.delta === '1'); next.listeners.click(); await h.ready();
  assert.match(h.reads.at(-1), /page=2/); assert.match(h.ids.get('usersPagination').innerHTML, /Page 2 of 2/);
});
test('malformed lists and failed lookup roles display retry and unavailable instead of fabricated counts', async () => {
  const h = admin({ get: url => /users\?|audit-logs|backups/.test(url) ? { ok: true, data: [null], meta: { page: 1, per_page: 15, total: 0 } } : undefined }); await h.ready();
  for (const id of ['usersSummary', 'auditSummary', 'backupSummary']) assert.equal(h.ids.get(id).textContent, 'Unavailable');
  for (const id of ['retryUsers', 'retryAudit', 'retryBackups']) assert.ok(h.ids.has(id));
  const roles = admin({ get: url => url === '/api/v1/roles' ? { ok: false, error: '<Role failure>' } : undefined }); await roles.ready(); assert.ok(roles.ids.has('retryRoles')); assert.match(roles.ids.get('usersTable').innerHTML, /&lt;Role failure&gt;/);
});
test('stale account list cannot repaint after an account token change', async () => {
  let finish; const h = admin({ get: url => /users\?/.test(url) ? new Promise(resolve => { finish = resolve; }) : undefined }); await h.ready();
  const read = h.context.localStorage.getItem; h.context.localStorage.getItem = key => key === 'mgaems_token' ? 'changed' : read(key);
  finish({ ok: true, data: [account()], meta: { page: 1, per_page: 15, total: 1 } }); await h.ready(); assert.doesNotMatch(h.ids.get('appMain').innerHTML, /Fixture 8/); assert.match(h.ids.get('appMain').innerHTML, /session changed/);
});
test('audit date range and actor validation prevent invalid requests, with inclusive school dates', async () => {
  const h = admin(); await h.ready(); const initial = h.reads.length;
  field(h, 'auditUser', '-1'); click(h, 'applyAuditFilters'); assert.equal(h.reads.length, initial);
  field(h, 'auditUser', '8'); field(h, 'auditFrom', '2026-10-14'); field(h, 'auditTo', '2026-10-13'); click(h, 'applyAuditFilters'); assert.equal(h.reads.length, initial);
  field(h, 'auditTo', '2026-10-14'); click(h, 'applyAuditFilters'); await h.ready(); const params = new URLSearchParams(h.reads.at(-1).split('?')[1]); assert.equal(params.get('to'), '2026-10-14 23:59:59'); assert.equal(params.get('user_id'), '8');
});
test('offset-free backup timestamps retain school time instead of the browser timezone', async () => {
  const h = admin({ get: url => url === '/api/v1/backups' ? { ok: true, data: [{ filename: 'fixture.sql', created_at: '2026-10-14 07:00:00', size_bytes: 64 }] } : undefined }); await h.ready(); assert.match(h.ids.get('backupTable').innerHTML, /14 Oct 2026, 07:00/);
});
test('create account uses a native shared dialog form, excludes Student and does not link Staff automatically', async () => {
  const h = admin(); await h.ready(); await click(h, 'addUserBtn'); const modal = h.modals[0];
  assert.ok(modal.body.querySelector('form')); assert.doesNotMatch(h.ids.get('newRole').innerHTML, /value="student"/);
  field(h, 'newUsername', 'Synthetic account'); field(h, 'newEmail', 'fixture@example.invalid'); field(h, 'newRole', 'teacher'); field(h, 'newPassword', 'Synthetic-only-pass'); await submit(h); await h.ready();
  assert.deepEqual(h.writes[0], { method: 'post', url: '/api/v1/users', body: { username: 'Synthetic account', email: 'fixture@example.invalid', role: 'teacher', password: 'Synthetic-only-pass' } }); assert.equal(modal.closed, true); assert.equal(h.writes.length, 1);
});
test('Staff-link action delegates only the selected account to its existing authorized workflow', async () => {
  const h = admin(); await h.ready(); h.ids.get('usersTable').querySelector('[data-link-user]').listeners.click(); assert.equal(h.links[0][0], 8); assert.equal(h.writes.length, 0);
});
test('account role/status confirmation freezes fields and cancelled change preserves the draft', async () => {
  let finish; const h = admin({ confirm: () => new Promise(resolve => { finish = resolve; }) }); await h.ready();
  h.ids.get('usersTable').querySelector('[data-edit-user]').listeners.click(); await h.ready(); field(h, 'editUserStatus', 'locked'); submit(h); await h.ready();
  assert.equal(h.ids.get('editUserEmail').disabled, true); assert.equal(h.modals[0].busy, true); assert.equal(h.confirmations.length, 1);
  finish(false); await h.ready(); assert.equal(h.writes.length, 0); assert.equal(h.ids.get('editUserEmail').disabled, false); assert.equal(h.ids.get('editUserStatus').value, 'locked');
});
test('account conflicts preserve draft and target backend fields without closing the dialog', async () => {
  const h = admin({ write: () => ({ ok: false, status: 409, error: '<Last administrator protected>', fields: { email: ['Invalid email'] } }) }); await h.ready();
  h.ids.get('usersTable').querySelector('[data-edit-user]').listeners.click(); await h.ready(); field(h, 'editUserEmail', 'changed@example.invalid'); await submit(h); await h.ready();
  assert.equal(h.modals[0].closed, false); assert.equal(h.ids.get('editUserEmail').getAttribute('aria-invalid'), 'true'); assert.match(h.ids.get('userFormAlert').innerHTML, /&lt;Last administrator protected&gt;/); assert.equal(h.ids.get('editUserEmail').value, 'changed@example.invalid');
});
test('closed account details ignore late identities and show no passwords or token data', async () => {
  let finish; const h = admin({ get: url => /users\/8$/.test(url) ? new Promise(resolve => { finish = resolve; }) : undefined }); await h.ready(); h.ids.get('usersTable').querySelector('[data-view-user]').listeners.click(); const modal = h.modals[0]; modal.close(); finish({ ok: true, data: { ...account(), password_hash: 'PRIVATE', token: 'PRIVATE' } }); await h.ready(); assert.doesNotMatch(modal.body.innerHTML, /PRIVATE|Fixture 8/);
});
test('backup creation is confirmed, duplicate-protected, and uses the existing endpoint only', async () => {
  let finish; const h = admin({ confirm: () => new Promise(resolve => { finish = resolve; }), write: () => ({ ok: true, data: { filename: 'fixture-new.sql' } }) }); await h.ready(); const pending = click(h, 'createBackupBtn'); await click(h, 'createBackupBtn'); assert.equal(h.confirmations.length, 1); finish(true); await pending; assert.equal(h.writes.length, 1); assert.equal(h.writes[0].url, '/api/v1/backups');
});
test('obsolete logo-upload 401 cannot log out the replacement account or publish branding', async () => {
  const h = admin(); await h.ready(); let finish; let logouts = 0;
  h.context.FormData = class { append() {} };
  h.context.fetch = () => new Promise(resolve => { finish = resolve; }); h.app.logout = () => { logouts++; };
  h.ids.get('schoolLogo').files = [{ type: 'image/png', size: 100 }];
  const pending = h.ids.get('schoolLogoForm').listeners.submit({ preventDefault() {} });
  const read = h.context.localStorage.getItem; h.context.localStorage.getItem = key => key === 'mgaems_token' ? 'replacement-session' : read(key);
  finish({ ok: false, status: 401, json: async () => ({}) }); await pending;
  assert.equal(logouts, 0); assert.match(h.ids.get('appMain').innerHTML, /session changed/);
});

function login(response = { ok: true, data: { token: 'synthetic-token', user: { id: 3, username: 'Fixture', role: 'teacher' } } }) {
  const h = createDOM('teacher', '/login.html'); const root = new h.Element(); root.innerHTML = fs.readFileSync(path.resolve(__dirname, '../../public/login.html'), 'utf8');
  h.ids.get('password').type = 'password'; h.requests = []; h.saved = new Map();
  h.context.localStorage.setItem = (key, value) => h.saved.set(key, value); h.context.localStorage.removeItem = key => h.saved.delete(key);
  h.context.fetch = async (url, options) => { h.requests.push({ url, options }); const result = typeof response === 'function' ? await response() : response; return { ok: result.ok, status: result.status || 200, json: async () => result.ok ? { data: result.data } : { error: { message: result.error } } }; };
  h.run('login.js'); h.submit = () => h.ids.get('loginForm').listeners.submit({ preventDefault() {} });
  return h;
}
test('public login has a safe identity fallback, labels and no protected settings or temporary logo request', () => {
  const h = login(); assert.equal(h.requests.length, 0); const html = fs.readFileSync(path.resolve(__dirname, '../../public/login.html'), 'utf8'); assert.doesNotMatch(html, /\/storage\/|onclick=|onerror=|settings\/school/); assert.match(html, /loginForm/); assert.match(html, /autocomplete="current-password"/);
});
test('password visibility is keyboard-native and preserves value with pressed state', () => {
  const h = login(); field(h, 'password', ' entered value '); click(h, 'passwordToggle'); assert.equal(h.ids.get('password').type, 'text'); assert.equal(h.ids.get('passwordToggle').getAttribute('aria-pressed'), 'true'); click(h, 'passwordToggle'); assert.equal(h.ids.get('password').type, 'password'); assert.equal(h.ids.get('password').value, ' entered value ');
});
test('blank sign-in validates both fields without creating an authentication request', async () => {
  const h = login(); await h.submit(); assert.equal(h.requests.length, 0); assert.equal(h.ids.get('username').getAttribute('aria-invalid'), 'true'); assert.equal(h.ids.get('password').getAttribute('aria-invalid'), 'true'); assert.equal(h.document.activeElement, h.ids.get('alertBox'));
});
for (const [role, destination] of [['teacher', '/dashboard.html'], ['parent_guardian', '/parent-portal.html'], ['sponsor', '/sponsor-portal.html']]) test(`successful ${role} login retains its existing landing destination`, async () => {
  const h = login({ ok: true, data: { token: 'synthetic-token', user: { id: 3, username: 'Fixture', role } } }); field(h, 'username', '  Fixture  '); field(h, 'password', ' Exact password '); await h.submit(); assert.equal(h.context.window.location.href, destination); assert.equal(h.saved.size, 2); assert.equal(JSON.parse(h.requests[0].options.body).password, ' Exact password '); assert.equal(JSON.parse(h.requests[0].options.body).username, 'Fixture'); assert.equal(h.ids.get('password').value, '');
});
test('failed and malformed authentication responses retain retry state and never save credentials', async () => {
  for (const response of [{ ok: false, status: 401, error: '<Wrong credentials>' }, { ok: true, data: { token: 'invalid', user: {} } }]) {
    const h = login(response); field(h, 'username', 'Fixture'); field(h, 'password', 'Wrong'); await h.submit(); assert.equal(h.saved.size, 0); assert.equal(h.ids.get('loginBtn').disabled, false); assert.equal(h.ids.get('loginStatus').textContent, ''); assert.equal(h.context.window.location.href, '/login.html'); assert.doesNotMatch(h.ids.get('alertBox').innerHTML, /<Wrong credentials>/);
  }
});
test('pending sign-in freezes submitted fields and duplicate Enter/submission creates only one request', async () => {
  let finish; const h = login(() => new Promise(resolve => { finish = resolve; })); field(h, 'username', 'Fixture'); field(h, 'password', 'Value'); const pending = h.submit(); await h.submit(); assert.equal(h.requests.length, 1); assert.equal(h.ids.get('username').disabled, true); finish({ ok: false, error: 'Try again' }); await pending; assert.equal(h.ids.get('username').disabled, false);
});
test('network and browser storage failures give focused recoverable feedback', async () => {
  const offline = login(() => { throw new Error('Fixture network failure'); }); field(offline, 'username', 'Fixture'); field(offline, 'password', 'Value'); await offline.submit(); assert.match(offline.ids.get('alertBox').innerHTML, /Could not reach the server/);
  const storage = login(); storage.context.localStorage.setItem = () => { throw new Error('No storage'); }; field(storage, 'username', 'Fixture'); field(storage, 'password', 'Value'); await storage.submit(); assert.match(storage.ids.get('alertBox').innerHTML, /browser could not save/); assert.equal(storage.context.window.location.href, '/login.html');
});
test('late login cannot overwrite a different account signed in while the request was pending', async () => {
  let finish; const h = login(() => new Promise(resolve => { finish = resolve; })); field(h, 'username', 'Fixture'); field(h, 'password', 'Value'); const pending = h.submit();
  const read = h.context.localStorage.getItem; h.context.localStorage.getItem = key => key === 'mgaems_token' ? 'replacement-session' : read(key);
  finish({ ok: true, data: { token: 'old-new-token', user: { id: 3, username: 'Fixture', role: 'teacher' } } }); await pending;
  assert.equal(h.saved.size, 0); assert.equal(h.context.window.location.href, '/login.html'); assert.match(h.ids.get('alertBox').innerHTML, /Another sign-in changed/);
});
