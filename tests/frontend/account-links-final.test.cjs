// Account-link session boundaries use synthetic identities and isolated callbacks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const fixture = () => ({
  user: { id: 4, username: '<Reviewed account>', role: 'teacher', status: 'active' },
  account_link: { required: true, eligible: false, reason: 'Verified Staff link required', version: 7, staff: null },
  can_link: true,
  staff_options: [{ id: 8, name: '<Reviewed Staff>', staff_type: 'teaching', role_title: 'Teacher', status: 'active', revision: 'a'.repeat(64), eligible: true }],
  meta: { page: 1, per_page: 20, total: 21 },
});
function harness({ get, patch, confirm } = {}) {
  const h = createDOM('system_admin', '/administration.html');
  let actor = { id: 50, role: 'system_admin', username: 'Operator fixture' }, token = 'operator-session';
  h.context.localStorage.getItem = key => key === 'mgaems_token' ? token : key === 'mgaems_user' ? JSON.stringify(actor) : null;
  const reads = [], writes = [], toasts = []; let saved = 0, loggedOut = 0;
  h.app.get = async url => { reads.push(url); return get ? get(url) : { ok: true, data: fixture() }; };
  h.app.patch = async (url, body) => { writes.push({ url, body: structuredClone(body) }); return patch ? patch(url, body) : { ok: true, data: {} }; };
  h.app.confirmAction = confirm || (async () => true);
  h.app.toast = (...args) => toasts.push(args);
  h.app.logout = () => { loggedOut++; };
  h.run('account-links.js');
  return { ...h, reads, writes, toasts,
    get saved() { return saved; }, get loggedOut() { return loggedOut; },
    open() { return h.context.window.MGAEMSAccountLinks.open(4, () => { saved++; }); },
    switchIdentity(change) { actor = { ...actor, ...change }; if ('token' in change) token = change.token; },
    verify() { const choice = h.ids.get('staffLinkChoice'); choice.value = '8'; choice.listeners.change({ target: choice }); h.ids.get('staffLinkConfirmed').checked = true; },
    submit() { return h.ids.get('staffLinkForm').listeners.submit({ preventDefault() {} }); },
  };
}

test('late Staff context after a token change is wiped instead of rendered', async () => {
  const pending = deferred(), h = harness({ get: () => pending.promise }); const load = h.open();
  h.switchIdentity({ token: 'replacement' }); pending.resolve({ ok: true, data: fixture() }); await load;
  assert.equal(h.modals[0].body.innerHTML, ''); assert.equal(h.modals[0].closed, true);
  assert.equal(h.ids.has('staffLinkForm'), false); assert.equal(h.writes.length, 0);
});

test('late Staff context cannot cross to another Administrator or a non-admin role', async () => {
  for (const change of [{ id: 51 }, { role: 'head_teacher' }]) {
    const pending = deferred(), h = harness({ get: () => pending.promise }); const load = h.open();
    h.switchIdentity(change); pending.resolve({ ok: true, data: fixture() }); await load;
    assert.equal(h.modals[0].closed, true); assert.equal(h.modals[0].body.innerHTML, '');
    assert.equal(h.toasts.length, 0); assert.equal(h.saved, 0);
  }
});

test('page departure discards pending account-link content and prevents old mutation handlers', async () => {
  const pending = deferred(), h = harness({ get: () => pending.promise }); const load = h.open();
  h.context.window.location.pathname = '/dashboard.html'; pending.resolve({ ok: true, data: fixture() }); await load;
  assert.equal(h.modals[0].closed, true); assert.equal(h.ids.has('staffLinkChoice'), false);
  assert.equal(h.writes.length, 0);
});

test('old Staff search and submit controls cannot act after the operator loses Administrator role', async () => {
  for (const action of ['find', 'submit']) {
    const h = harness(); await h.open(); h.verify();
    const control = action === 'find' ? h.ids.get('staffLinkFind') : h.ids.get('staffLinkForm');
    h.switchIdentity({ role: 'head_teacher' });
    if (action === 'find') await control.listeners.click();
    else await control.listeners.submit({ preventDefault() {} });
    assert.equal(h.reads.length, 1); assert.equal(h.writes.length, 0);
    assert.equal(h.modals[0].closed, true); assert.equal(h.modals[0].body.innerHTML, '');
    await h.open(); assert.equal(h.modals.length, 1);
  }
});

test('a changed token, operator identity or role during human confirmation prevents linking', async () => {
  for (const change of [{ token: 'replacement' }, { id: 51 }, { role: 'head_teacher' }]) {
    const pending = deferred(), h = harness({ confirm: () => pending.promise }); await h.open(); h.verify();
    const save = h.submit(); await flush(); h.switchIdentity(change); pending.resolve(true); await save;
    assert.equal(h.writes.length, 0); assert.equal(h.modals[0].closed, true);
    assert.equal(h.modals[0].body.innerHTML, ''); assert.equal(h.modals[0].busy, false);
  }
});

test('obsolete successful Staff-link acknowledgements cannot refresh, toast or revoke a new session', async () => {
  const pending = deferred(), h = harness({ patch: () => pending.promise }); await h.open(); h.verify();
  const save = h.submit(); await flush(); assert.equal(h.writes.length, 1); assert.equal(h.modals[0].busy, true);
  h.switchIdentity({ token: 'replacement' }); pending.resolve({ ok: true, data: {} }); await save;
  assert.equal(h.modals[0].body.innerHTML, ''); assert.equal(h.modals[0].closed, true);
  assert.equal(h.saved, 0); assert.equal(h.loggedOut, 0); assert.equal(h.toasts.length, 0);
});

test('closing a Staff-link dialog erases retained form contents and invalidates old listeners', async () => {
  const h = harness(); await h.open(); h.verify(); const form = h.ids.get('staffLinkForm');
  h.modals[0].close(); assert.equal(h.modals[0].body.innerHTML, '');
  await form.listeners.submit({ preventDefault() {} }); assert.equal(h.writes.length, 0);
});
