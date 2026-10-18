// Account inbox tests use synthetic API data only, independent of child/programme fixtures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));
const messages = () => [{ id: 11, sender_id: 4, recipient_id: 7, sender: { username: '<School office>' }, body: '<Owned message>', read_at: null, sent_at: '2026-10-01T21:30:00Z', private: 'PRIVATE-HEALTH' }, { id: 12, sender_id: 4, recipient_id: 7, sender: { username: 'School office' }, body: 'Previously read message', read_at: '2026-10-01T08:00:00Z', sent_at: '2026-10-01T07:00:00Z' }, { id: 13, sender_id: 7, recipient_id: 8, recipient: { username: 'Other account' }, body: 'Sent message', read_at: null, sent_at: '2026-09-30T07:00:00Z' }, { id: 14, sender_id: 7, recipient_id: 8, recipient: { username: 'Other account' }, body: 'Acknowledged message', read_at: '2026-09-30T09:00:00Z', sent_at: '2026-09-30T07:30:00Z' }, { id: 15, sender_id: 98, recipient_id: 99, body: 'FOREIGN-MESSAGE-SENTINEL', read_at: null }];
function harness({ role = 'parent_guardian', pathname = role === 'sponsor' ? '/sponsor-portal.html' : '/parent-portal.html', get, patch, rows = messages() } = {}) {
  const h = createDOM(role, pathname), reads = [], writes = [], toasts = [];
  let actor = { id: 7, username: 'Portal account', role }, token = 'memory-session';
  h.context.localStorage.getItem = key => key === 'mgaems_token' ? token : key === 'mgaems_user' ? JSON.stringify(actor) : null;
  h.app.requireAuth = () => actor; h.app.currentUser = () => actor;
  h.document.createElement = tag => new h.Element(tag);
  const originalSet = h.Element.prototype.setAttribute;
  h.Element.prototype.setAttribute = function (name, value) { originalSet.call(this, name, value); if (name === 'id') h.ids.set(value, this); };
  new h.Element('main', { id: 'appMain' });
  h.app.get = async url => { reads.push(url); return get ? get(url) : { ok: true, data: structuredClone(rows) }; };
  h.app.patch = async (url, body) => { writes.push({ url, body: structuredClone(body) }); return patch ? patch(url, body) : { ok: true, data: { ...messages()[0], read_at: '2026-10-02T08:00:00Z' } }; };
  h.app.post = () => { throw new Error('Portal inbox attempted to send a message'); }; h.app.del = () => { throw new Error('Portal inbox attempted to delete a message'); }; h.app.toast = (...args) => toasts.push(args);
  return Object.assign(h, {
    reads, writes, toasts,
    start() { h.run('portal-messages.js'); return this; },
    async open(id) { const button = h.ids.get('portalMessageList').querySelectorAll('[data-portal-message]').find(button => button.dataset.portalMessage === String(id)); assert.ok(button); button.listeners.click(); await settle(); return h.modals.at(-1); },
    async change(id, value, event = 'change') { const control = h.ids.get(id); control.value = value; control.listeners[event](); await settle(); },
    async read(modal) { await modal.overlay.querySelector('[data-portal-mark-read]').listeners.click(); await settle(); },
    changeIdentity(change) { actor = { ...actor, ...change }; if ('token' in change) token = change.token; if ('path' in change) h.context.window.location.pathname = change.path; },
  });
}

test('both authorized portals load only the existing account-owned message endpoint', async () => {
  for (const role of ['parent_guardian', 'sponsor']) { const h = harness({ role }).start(); await settle(); assert.deepEqual(h.reads, ['/api/v1/messages']); assert.equal(h.writes.length, 0); assert.match(h.ids.get('portalAccountMessages').innerHTML, /Your account messages|Switching a child or programme does not change this inbox/); }
});

test('all other roles and wrong portal paths remain inert without requests or inbox controls', async () => {
  for (const role of ['system_admin', 'head_teacher', 'deputy_head_teacher', 'teacher', 'sponsor_coordinator', 'student', 'unknown']) { const h = harness({ role }).start(); await settle(); assert.deepEqual(h.reads, []); assert.equal(h.ids.has('portalAccountMessages'), false); }
  for (const [role, pathname] of [['parent_guardian', '/sponsor-portal.html'], ['sponsor', '/parent-portal.html'], ['parent_guardian', '/dashboard.html']]) { const h = harness({ role, pathname }).start(); await settle(); assert.deepEqual(h.reads, []); }
});

test('duplicate script initialization does not duplicate inboxes or issue another request', async () => {
  const h = harness().start(); await settle(); h.run('portal-messages.js'); await settle(); assert.equal(h.reads.length, 1); assert.equal(h.ids.get('appMain').children.length, 1);
});

test('message presentation includes only owned received/sent rows and honest read/unread counts', async () => {
  const h = harness().start(); await settle(); const html = h.ids.get('portalMessageList').innerHTML;
  assert.match(html, /Unread received|Read received|Read by recipient|Sent/); assert.doesNotMatch(html, /FOREIGN-MESSAGE-SENTINEL|PRIVATE-HEALTH/); assert.match(h.ids.get('portalMessageCount').textContent, /4 of 4 owned messages · 1 unread received/);
});

test('messages are escaped and timestamps display school time without inventing missing dates', async () => {
  const h = harness().start(); await settle(); const html = h.ids.get('portalMessageList').innerHTML;
  assert.match(html, /&lt;School office&gt;|&lt;Owned message&gt;|2 Oct 2026, 00:30/); assert.doesNotMatch(html, /<School office>|<Owned message>/);
  const modal = await h.open(11); assert.match(modal.body.innerHTML, /&lt;Owned message&gt;/); assert.match(modal.body.innerHTML, /school time/);
});

test('participant fallback uses only the owned counterpart account number', async () => {
  const h = harness({ rows: [{ id: 20, sender_id: 7, recipient_id: 9, body: 'Owned outgoing', sent_at: null, read_at: null }] }).start(); await settle(); assert.match(h.ids.get('portalMessageList').innerHTML, /Account #9|Date unavailable/);
});

test('message filters and search apply locally to the owned history without directory reads', async () => {
  const h = harness().start(); await settle(); await h.change('portalMessageFilter', 'unread'); assert.equal(h.ids.get('portalMessageList').querySelectorAll('[data-portal-message]').length, 1);
  await h.change('portalMessageFilter', 'sent'); assert.equal(h.ids.get('portalMessageList').querySelectorAll('[data-portal-message]').length, 2); await h.change('portalMessageSearch', 'Acknowledged', 'input'); assert.equal(h.ids.get('portalMessageList').querySelectorAll('[data-portal-message]').length, 1);
  await h.change('portalMessageSearch', 'not on this page', 'input'); assert.match(h.ids.get('portalMessageList').innerHTML, /No messages match/); assert.deepEqual(h.reads, ['/api/v1/messages']);
});

test('initial loading and empty inboxes do not invent unread counts while unavailable', async () => {
  let release; const h = harness({ get: () => new Promise(resolve => { release = resolve; }) }).start(); assert.match(h.ids.get('portalMessageCount').textContent, /Loading/); assert.match(h.ids.get('portalMessageList').innerHTML, /Loading your account messages/);
  release({ ok: true, data: [] }); await settle(); assert.match(h.ids.get('portalMessageList').innerHTML, /No account messages/); assert.match(h.ids.get('portalMessageCount').textContent, /0 of 0 owned messages · 0 unread/);
});

test('read failures and malformed history have unavailable states and explicit retry', async () => {
  let calls = 0; const h = harness({ get: () => ++calls === 1 ? { ok: false, status: 503, error: '<Inbox unavailable>' } : { ok: true, data: messages() } }).start(); await settle(); assert.match(h.ids.get('portalMessageList').innerHTML, /&lt;Inbox unavailable&gt;/); assert.equal(h.ids.get('portalMessageCount').textContent, 'Account messages unavailable');
  h.ids.get('portalMessageRetry').listeners.click(); await settle(); assert.match(h.ids.get('portalMessageCount').textContent, /4 of 4/);
  for (const rows of [[null], [{ ...messages()[0], id: 0 }], [{ ...messages()[0], sender_id: true }], [{ ...messages()[0], body: {} }], [{ ...messages()[0], read_at: 'invalid' }], [messages()[0], messages()[0]]]) { const broken = harness({ rows }).start(); await settle(); assert.equal(broken.ids.get('portalMessageCount').textContent, 'Account messages unavailable'); assert.equal(broken.ids.get('portalMessageList').querySelector('[data-portal-message]'), null); }
});

test('opening a message never acknowledges it automatically and only unread received messages expose Mark as read', async () => {
  const h = harness().start(); await settle(); const unread = await h.open(11); assert.ok(unread.overlay.querySelector('[data-portal-mark-read]')); assert.equal(h.writes.length, 0); unread.close();
  for (const id of [12, 13, 14]) { const modal = await h.open(id); assert.equal(modal.overlay.querySelector('[data-portal-mark-read]'), null); modal.close(); }
});

test('explicit read acknowledgement uses the existing PATCH endpoint and verified server timestamp', async () => {
  for (const role of ['parent_guardian', 'sponsor']) { const h = harness({ role }).start(); await settle(); const modal = await h.open(11); await h.read(modal); assert.deepEqual(h.writes, [{ url: '/api/v1/messages/11/read', body: {} }]); assert.equal(modal.closed, true); assert.match(h.ids.get('portalMessageCount').textContent, /0 unread received/); assert.equal(h.toasts[0][0], 'Message marked as read.'); }
});

test('acknowledgement must match the selected message sender recipient and a valid read timestamp', async () => {
  for (const data of [{ ...messages()[0], id: 99, read_at: '2026-10-02T08:00:00Z' }, { ...messages()[0], recipient_id: 8, read_at: '2026-10-02T08:00:00Z' }, { ...messages()[0], sender_id: 9, read_at: '2026-10-02T08:00:00Z' }, { ...messages()[0], read_at: null }, { ...messages()[0], read_at: 'invalid' }]) {
    const h = harness({ patch: () => ({ ok: true, data }) }).start(); await settle(); const modal = await h.open(11); await h.read(modal); assert.equal(modal.closed, false); assert.match(h.ids.get('portalMessageAlert').innerHTML, /could not be confirmed/); assert.match(h.ids.get('portalMessageCount').textContent, /1 unread received/); assert.equal(h.toasts.length, 0);
  }
});

test('failed acknowledgement retains unread status, enables retry and focuses the error', async () => {
  const h = harness({ patch: () => ({ ok: false, status: 503, error: '<Read acknowledgement unavailable>' }) }).start(); await settle(); const modal = await h.open(11); await h.read(modal); assert.equal(modal.busy, false); assert.match(h.ids.get('portalMessageAlert').innerHTML, /&lt;Read acknowledgement unavailable&gt;/); assert.equal(h.document.activeElement, h.ids.get('portalMessageAlert')); assert.match(h.ids.get('portalMessageCount').textContent, /1 unread/);
});

test('duplicate read clicks issue one request and busy dialogs cannot close', async () => {
  let release; const h = harness({ patch: () => new Promise(resolve => { release = resolve; }) }).start(); await settle(); const modal = await h.open(11), button = modal.overlay.querySelector('[data-portal-mark-read]'); const pending = button.listeners.click(); await button.listeners.click();
  assert.equal(h.writes.length, 1); assert.equal(modal.busy, true); modal.close(); assert.equal(modal.closed, false); release({ ok: true, data: { ...messages()[0], read_at: '2026-10-02T08:00:00Z' } }); await pending; assert.equal(modal.closed, true);
});

test('token account role and path changes suppress pending history responses and clear confidential content', async () => {
  for (const change of [{ token: 'replacement' }, { id: 99 }, { role: 'teacher' }, { path: '/dashboard.html' }]) {
    let release; const h = harness({ get: () => new Promise(resolve => { release = resolve; }) }).start(); h.changeIdentity(change); release({ ok: true, data: messages() }); await settle(); assert.match(h.ids.get('portalAccountMessages').innerHTML, /session changed/); assert.doesNotMatch(h.ids.get('portalAccountMessages').innerHTML, /Owned message|School office/);
  }
});

test('account changes after opening a message cannot acknowledge it', async () => {
  const h = harness().start(); await settle(); const modal = await h.open(11); h.changeIdentity({ id: 99 }); await h.read(modal); assert.equal(h.writes.length, 0); assert.equal(modal.closed, true); assert.doesNotMatch(modal.body.innerHTML, /Owned message/);
});

test('late read acknowledgements cannot update counts or toast for a replacement session', async () => {
  let release; const h = harness({ patch: () => new Promise(resolve => { release = resolve; }) }).start(); await settle(); const modal = await h.open(11), pending = modal.overlay.querySelector('[data-portal-mark-read]').listeners.click(); h.changeIdentity({ token: 'replacement' }); release({ ok: true, data: { ...messages()[0], read_at: '2026-10-02T08:00:00Z' } }); await pending;
  assert.equal(modal.closed, true); assert.equal(h.toasts.length, 0); assert.match(h.ids.get('portalAccountMessages').innerHTML, /session changed/);
});

test('ownership or authorization denial removes private history and any open message body', async () => {
  const h = harness({ patch: () => ({ ok: false, status: 403, error: 'Forbidden' }) }).start(); await settle(); const modal = await h.open(11); await h.read(modal); assert.match(h.ids.get('portalAccountMessages').innerHTML, /access is unavailable/); assert.equal(modal.closed, true); assert.doesNotMatch(modal.body.innerHTML, /Owned message/);
  const denied = harness({ get: () => ({ ok: false, status: 403 }) }).start(); await settle(); assert.match(denied.ids.get('portalAccountMessages').innerHTML, /access is unavailable/);
});

test('refresh loading prevents stale history filters and older replies from repainting current results', async () => {
  let calls = 0, old; const h = harness({ get: () => ++calls === 2 ? new Promise(resolve => { old = resolve; }) : { ok: true, data: calls === 3 ? [] : messages() } }).start(); await settle(); h.ids.get('portalMessageRefresh').listeners.click(); await settle(); await h.change('portalMessageFilter', 'unread'); assert.match(h.ids.get('portalMessageList').innerHTML, /Loading/);
  h.ids.get('portalMessageRefresh').listeners.click(); await settle(); old({ ok: true, data: messages() }); await settle(); assert.match(h.ids.get('portalMessageList').innerHTML, /No account messages/);
});

test('read acknowledgement invalidates an older pending refresh without restoring unread status', async () => {
  let calls = 0, old; const h = harness({ get: () => ++calls === 2 ? new Promise(resolve => { old = resolve; }) : { ok: true, data: calls >= 3 ? messages().map(row => row.id === 11 ? { ...row, read_at: '2026-10-02T08:00:00Z' } : row) : messages() } }).start(); await settle(); const modal = await h.open(11); h.ids.get('portalMessageRefresh').listeners.click(); await settle(); await h.read(modal); old({ ok: true, data: messages() }); await settle(); assert.match(h.ids.get('portalMessageCount').textContent, /0 unread received/);
});

test('child or programme selection changes do not alter the account inbox or add learner/roster API calls', async () => {
  const h = harness({ role: 'sponsor' }).start(); await settle(); const before = h.ids.get('portalMessageList').innerHTML; const programme = new h.Element('div', { id: 'sponsorView' }); h.ids.get('appMain').appendChild(programme); programme.innerHTML = '<h2>School-wide programme</h2>'; assert.equal(h.ids.get('portalMessageList').innerHTML, before); assert.deepEqual(h.reads, ['/api/v1/messages']);
});

test('portal inboxes never compose, reply, broadcast, read User directories or persist history', async () => {
  const h = harness().start(); await settle(); const modal = await h.open(11); assert.doesNotMatch(modal.body.innerHTML + modal.overlay.innerHTML, /<textarea|recipient_id|data-reply|data-send/);
  const source = fs.readFileSync(path.resolve(__dirname, '../../public/assets/portal-messages.js'), 'utf8'); assert.doesNotMatch(source, /MGAEMS\.post|MGAEMS\.del|\/api\/v1\/users|\/api\/v1\/health|localStorage\.setItem|sessionStorage|recipient_ids/); assert.ok(h.reads.every(url => url === '/api/v1/messages'));
});

test('both portal shells load scoped inbox assets with theme tokens, touch controls and mobile focus support', () => {
  for (const portal of ['parent-portal', 'sponsor-portal']) { const html = fs.readFileSync(path.resolve(__dirname, '../../public/' + portal + '.html'), 'utf8'); assert.match(html, /assets\/portal-messages\.css/); assert.match(html, /assets\/portal-messages\.js/); }
  const css = fs.readFileSync(path.resolve(__dirname, '../../public/assets/portal-messages.css'), 'utf8'); assert.match(css, /@media \(max-width: 640px\)/); assert.match(css, /:focus-visible/); assert.match(css, /var\(--touch-target\)/); assert.doesNotMatch(css, /#[a-f\d]{3,8}\b|linear-gradient|animation:/i);
});
