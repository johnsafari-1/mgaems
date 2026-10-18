const { test } = require('node:test');
const assert = require('node:assert/strict');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const staff = (id = 8, extra = {}) => ({ id, name: '<Verified Person>', staff_type: 'teaching', role_title: '<Teacher>', status: 'active', linked: false, revision: 'a'.repeat(64), eligible: true, reason: null, ...extra });
const fixture = (extra = {}) => ({ user: { id: 4, username: '<Account>', role: 'teacher', status: 'active' }, account_link: { required: true, eligible: false, reason: 'An active Staff identity has not been linked.', version: 7, staff: null }, can_link: true, staff_options: [staff(), staff(9, { eligible: false, reason: 'Already linked', linked: true })], meta: { page: 1, per_page: 20, total: 41 }, ...extra });
function harness({ role = 'system_admin', context = fixture(), get, patch, confirm } = {}) {
  const h = createDOM(role, '/administration.html'), reads = [], writes = [], confirmations = [], errors = [];
  h.app.get = async url => { reads.push(url); return get ? get(url) : { ok: true, data: context }; };
  h.app.patch = async (url, data) => { writes.push({ url, data }); return patch ? patch(url, data) : { ok: true, data: {} }; };
  h.app.confirmAction = async (...args) => { confirmations.push(args); return confirm ? confirm(...args) : true; };
  h.app.showFormErrors = (_, result) => errors.push(result);
  h.app.toast = () => {}; h.app.logout = () => { h.loggedOut = true; };
  h.run('account-links.js');
  return Object.assign(h, { api: h.context.window.MGAEMSAccountLinks, reads, writes, confirmations, errors });
}
function select(h, id = '8') { const input = h.ids.get('staffLinkChoice'); input.value = id; input.listeners.change({ target: input }); }
function verify(h) { h.ids.get('staffLinkConfirmed').checked = true; }
function submit(h) { return h.ids.get('staffLinkForm').listeners.submit({ preventDefault() {} }); }

test('module is inert until administrator opens an existing account', async () => {
  for (const role of ['head_teacher', 'deputy_head_teacher', 'teacher', 'parent_guardian', 'sponsor', 'sponsor_coordinator']) {
    const h = harness({ role }); await h.api.open(4); assert.equal(h.reads.length, 0); assert.equal(h.modals.length, 0);
  }
  const h = harness(); assert.equal(h.reads.length, 0);
  await h.api.open(-1); await h.api.open('invalid'); assert.equal(h.reads.length, 0);
  await h.api.open(4); assert.equal(h.reads.length, 1); assert.equal(h.writes.length, 0);
});
test('identities are escaped, choice starts blank, incompatible options disabled and keyboard focus enters search', async () => {
  const h = harness(); await h.api.open(4);
  const html = h.modals[0].body.innerHTML;
  assert.match(html, /&lt;Account&gt;/); assert.match(html, /&lt;Verified Person&gt;/); assert.doesNotMatch(html, /<Verified Person>/);
  assert.equal(h.ids.get('staffLinkChoice').value, '');
  assert.equal(h.ids.get('staffLinkChoice').children[2].disabled, true);
  assert.equal(h.document.activeElement, h.ids.get('staffLinkSearch'));
  await submit(h); select(h); await submit(h);
  assert.equal(h.confirmations.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.errors.length, 2);
});
test('reviewed identity and epoch are frozen across confirmation; duplicate submits issue one request', async () => {
  let resolve; const h = harness({ context: fixture({ staff_options: [staff(), staff(10)] }), confirm: () => new Promise(done => { resolve = done; }) });
  await h.api.open(4); select(h); verify(h); const pending = submit(h);
  await submit(h); select(h, '10'); resolve(true); await pending;
  assert.equal(h.writes.length, 1); assert.equal(h.confirmations.length, 1);
  assert.match(h.confirmations[0][1], /Staff #8/);
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0])), { url: '/api/v1/users/4/staff-link', data: { staff_id: 8, expected_staff_id: null, expected_session_version: 7, staff_revision: 'a'.repeat(64), identity_confirmed: true } });
  assert.equal(h.modals[0].closed, true);
});
test('canceled confirmation or closed dialog cannot create a relationship', async () => {
  const h = harness({ confirm: () => false }); await h.api.open(4); select(h); verify(h); await submit(h); assert.equal(h.writes.length, 0);
  let resolve; const other = harness({ confirm: () => new Promise(done => { resolve = done; }) });
  await other.api.open(4); select(other); verify(other); const promise = submit(other); other.modals[0].close(); resolve(true); await promise; assert.equal(other.writes.length, 0);
});
test('conflicts require explicit reload and fresh human verification without automatic retry', async () => {
  const h = harness({ patch: () => ({ ok: false, status: 409, error: 'Reload identities' }) });
  await h.api.open(4); select(h); verify(h); await submit(h);
  assert.equal(h.writes.length, 1); assert.equal(h.reads.length, 1);
  assert.equal(h.ids.get('staffLinkSave').disabled, true); assert.equal(h.ids.get('staffLinkReload').hidden, false);
  await submit(h); assert.equal(h.writes.length, 1);
  await h.ids.get('staffLinkReload').listeners.click(); assert.equal(h.reads.length, 2);
  assert.equal(h.ids.get('staffLinkChoice').value, ''); assert.ok(!h.ids.get('staffLinkConfirmed').checked);
});
test('search and pagination are explicit and clear the selected identity', async () => {
  const h = harness(); await h.api.open(4); select(h); verify(h);
  h.ids.get('staffLinkSearch').value = 'Human & name'; h.ids.get('staffLinkFind').listeners.click(); await flush();
  let params = new URLSearchParams(h.reads.at(-1).split('?')[1]); assert.equal(params.get('search'), 'Human & name'); assert.equal(params.get('page'), '1');
  assert.equal(h.ids.get('staffLinkChoice').value, '');
  h.ids.get('staffLinkNext').listeners.click(); await flush(); params = new URLSearchParams(h.reads.at(-1).split('?')[1]); assert.equal(params.get('page'), '2'); assert.equal(h.writes.length, 0);
});
test('authorization loss clears private identity context and selection', async () => {
  for (const status of [401, 403]) {
    const h = harness({ patch: () => ({ ok: false, status, error: 'Denied' }) }); await h.api.open(4); select(h); verify(h); await submit(h);
    assert.equal(h.ids.has('staffLinkChoice'), false); assert.doesNotMatch(h.modals[0].body.innerHTML, /Account&gt;|Verified Person/); assert.match(h.modals[0].body.innerHTML, /no longer authorized/);
  }
});
test('unlink reviews existing pair and self-service security change signs out administrator', async () => {
  const linked = fixture({ user: { id: 4, username: 'Admin fixture', role: 'system_admin', status: 'active' }, account_link: { required: false, eligible: true, version: 3, staff: staff() }, can_link: false });
  const h = harness({ context: linked }); h.app.currentUser = () => ({ id: 4, role: 'system_admin' }); await h.api.open(4);
  assert.equal(h.ids.has('staffLinkChoice'), false); assert.equal(h.document.activeElement, h.ids.get('staffLinkConfirmed'));
  verify(h); await submit(h); assert.equal(h.writes[0].data.staff_id, null); assert.equal(h.writes[0].data.expected_staff_id, 8); assert.equal(h.loggedOut, true);
});
test('closed dialog ignores late context and unexpected target identity is rejected', async () => {
  let resolve; const h = harness({ get: () => new Promise(done => { resolve = done; }) }); const promise = h.api.open(4); h.modals[0].close(); resolve({ ok: true, data: fixture() }); await promise; assert.equal(h.ids.has('staffLinkForm'), false);
  const wrong = harness({ context: fixture({ user: { id: 99 } }) }); await wrong.api.open(4); assert.equal(wrong.ids.has('staffLinkForm'), false); assert.match(wrong.modals[0].body.innerHTML, /identity differs/);
});
