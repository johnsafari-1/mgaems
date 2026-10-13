// Synthetic communication workflow checks; no server, browser session or school data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));

const announcements = () => [
  { id: 1, title: '<School update>', body: '<Review the calendar>', audience: 'school_wide', published_at: '2026-10-01T06:00:00Z', published_by: 4 },
  { id: 2, title: 'Staff meeting', body: 'Agenda to follow', audience: 'staff', published_at: '2026-10-02T06:00:00Z', publisher: { username: 'School office' } },
];
const messages = () => [
  { id: 11, sender_id: 4, recipient_id: 7, sender: { username: '<School office>' }, body: '<Unread message>', sent_at: '2026-10-03T06:00:00Z', read_at: null },
  { id: 12, sender_id: 4, recipient_id: 7, sender: { username: 'School office' }, body: 'Read message', sent_at: '2026-10-02T06:00:00Z', read_at: '2026-10-02T07:00:00Z' },
  { id: 13, sender_id: 7, recipient_id: 8, recipient: { username: 'Recipient' }, body: 'Sent message', sent_at: '2026-10-01T06:00:00Z', read_at: null },
  { id: 14, sender_id: 7, recipient_id: 8, recipient: { username: 'Recipient' }, body: 'Acknowledged message', sent_at: '2026-09-30T06:00:00Z', read_at: '2026-10-01T07:00:00Z' },
];
function harness({ role = 'head_teacher', get, write, announcementData = announcements(), messageData = messages(), confirm = true } = {}) {
  const h = createDOM(role, '/communication.html');
  let actor = { id: 7, username: 'Test account', role }, token = 'memory-session';
  const originalStorageRead = h.context.localStorage.getItem;
  h.context.localStorage.getItem = key => key === 'mgaems_token' ? token : originalStorageRead(key);
  h.app.currentUser = () => actor;
  h.app.requireAuth = () => {
    const user = actor;
    if (['parent_guardian', 'sponsor'].includes(role)) h.context.window.location.href = h.app.landingPage(user);
    return user;
  };
  const requests = [], writes = [], errors = [], toasts = [], confirmations = [];
  h.app.get = async url => {
    requests.push(url);
    if (get) { const result = await get(url); if (result !== undefined) return result; }
    return { ok: true, data: structuredClone(url === '/api/v1/announcements' ? announcementData : messageData) };
  };
  for (const method of ['post', 'patch']) h.app[method] = async (url, body) => {
    writes.push({ method, url, body: structuredClone(body) });
    return write ? write(url, body, method) : { ok: true, data: { id: 11, recipient_id: 7, read_at: '2026-10-03T07:00:00Z' } };
  };
  const renderErrors = h.app.showFormErrors;
  h.app.showFormErrors = (form, result) => { errors.push(result); renderErrors(form, result); };
  h.app.toast = (...args) => toasts.push(args);
  h.app.confirmAction = async (...args) => { confirmations.push(args); return confirm; };
  return {
    ...h, requests, writes, errors, toasts, confirmations,
    switchIdentity(change) { actor = { ...actor, ...change }; if ('token' in change) token = change.token; },
    start() { h.run('communication.js'); return this; },
    async click(id) { const control = h.ids.get(id); assert.ok(control, `Missing control ${id}`); await control.listeners.click({ currentTarget: control }); await settle(); return h.modals.at(-1); },
    async change(id, value, type = 'change') { const control = h.ids.get(id); control.value = value; await control.listeners[type]({ target: control }); await settle(); },
    async openMessage(id) { const control = h.ids.get('messageList').querySelectorAll('[data-open-message]').find(button => button.dataset.openMessage === String(id)); assert.ok(control); await control.listeners.click(); await settle(); return h.modals.at(-1); },
    async submit(modal, values) { const form = modal.body.querySelector('form'); for (const [key, value] of Object.entries(values)) form.elements.namedItem(key).value = value; await form.listeners.submit({ preventDefault() {} }); await settle(); return form; },
  };
}

for (const [role, publish, send, read] of [
  ['system_admin', true, true, true], ['head_teacher', true, true, true], ['deputy_head_teacher', true, true, true], ['teacher', false, true, true], ['sponsor_coordinator', true, false, true], ['student', false, false, false],
]) test(`${role} communication controls follow announcement and message route permissions`, async () => {
  const h = harness({ role }).start(); await settle();
  assert.equal(h.ids.has('newAnnouncement'), publish);
  assert.equal(h.ids.has('newMessage'), send);
  assert.equal(h.ids.has('messagesPanel'), read);
  assert.equal(h.requests.includes('/api/v1/messages'), read);
  assert.deepEqual(h.requests.filter(url => !['/api/v1/announcements', '/api/v1/messages'].includes(url)), []);
  assert.equal(h.writes.length, 0);
});

test('portal redirects and unknown roles make no communication API requests', async () => {
  for (const role of ['parent_guardian', 'sponsor', 'unrecognized', '__proto__']) {
    const h = harness({ role }).start(); await settle();
    assert.equal(h.requests.length, 0);
    assert.equal(h.ids.has('newMessage'), false);
    if (role === 'parent_guardian') assert.equal(h.context.window.location.href, '/parent-portal.html');
    if (role === 'sponsor') assert.equal(h.context.window.location.href, '/sponsor-portal.html');
  }
});

test('Coordinator message sending is unavailable with an honest recipient-policy notice', async () => {
  const h = harness({ role: 'sponsor_coordinator' }).start(); await settle();
  assert.match(h.ids.get('appMain').innerHTML, /approved recipient policy/);
  assert.equal(h.ids.has('newMessage'), false);
  assert.equal(h.requests.some(url => /\/users/.test(url)), false);
});

test('announcements show escaped content, audience, newest-first publication and school time', async () => {
  const h = harness().start(); await settle();
  const html = h.ids.get('announcementList').innerHTML;
  assert.match(html, /&lt;School update&gt;/);
  assert.match(html, /&lt;Review the calendar&gt;/);
  assert.match(html, /School-wide/); assert.match(html, /Staff/);
  assert.ok(html.indexOf('Staff meeting') < html.indexOf('&lt;School update&gt;'));
  assert.match(html, /2 Oct 2026, 09:00/);
  assert.match(html, /datetime="2026-10-02T06:00:00.000Z"/);
});

test('announcement search and audience filtering use only returned records', async () => {
  const h = harness().start(); await settle(); const count = h.requests.length;
  await h.change('announcementSearch', 'calendar', 'input');
  assert.match(h.ids.get('announcementList').innerHTML, /School update/);
  assert.doesNotMatch(h.ids.get('announcementList').innerHTML, /Staff meeting/);
  await h.change('announcementAudienceFilter', 'staff');
  assert.match(h.ids.get('announcementList').innerHTML, /No announcements match/);
  await h.change('announcementSearch', '', 'input');
  assert.match(h.ids.get('announcementList').innerHTML, /Staff meeting/);
  await h.change('announcementAudienceFilter', 'parents');
  assert.match(h.ids.get('announcementList').innerHTML, /No announcements match/);
  assert.equal(h.requests.length, count);
});

test('tab arrows, Home and End move focus and update panel visibility', async () => {
  const h = harness().start(); await settle(); let prevented = false;
  const first = h.ids.get('announcementsTab'), last = h.ids.get('messagesTab');
  first.listeners.keydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(h.document.activeElement, last);
  assert.equal(first.attrs['aria-selected'], 'false'); assert.equal(last.attrs['aria-selected'], 'true');
  assert.equal(h.ids.get('announcementsPanel').hidden, true); assert.equal(h.ids.get('messagesPanel').hidden, false);
  last.listeners.keydown({ key: 'Home', preventDefault() {} });
  assert.equal(h.document.activeElement, first);
  first.listeners.keydown({ key: 'End', preventDefault() {} });
  assert.equal(h.document.activeElement, last);
  last.listeners.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(h.document.activeElement, first);
});

test('initial pending communication loads show loading rather than invented zero counts', async () => {
  const h = harness({ get: () => new Promise(() => {}) }).start();
  assert.equal(h.ids.get('announcementCount').textContent, 'Loading…');
  assert.equal(h.ids.get('unreadCount').textContent, 'Loading…');
  assert.match(h.ids.get('announcementList').innerHTML, /Loading announcements/);
  assert.match(h.ids.get('messageList').innerHTML, /Loading messages/);
  assert.equal(h.ids.get('announcementList').attrs['aria-busy'], 'true');
});

test('empty communication data has truthful zero counts and separate empty states', async () => {
  const h = harness({ announcementData: [], messageData: [] }).start(); await settle();
  assert.equal(h.ids.get('announcementCount').textContent, '0');
  assert.equal(h.ids.get('unreadCount').textContent, '0');
  assert.match(h.ids.get('announcementList').innerHTML, /No announcements available/);
  assert.match(h.ids.get('messageList').innerHTML, /No messages yet/);
  assert.equal(h.ids.get('messageList').attrs['aria-busy'], 'false');
});

test('failed or malformed loads report unavailable counts and retry independently', async () => {
  let failing = true;
  const h = harness({ get: url => failing ? { ok: false, error: '<Temporary failure>' } : undefined }).start(); await settle();
  assert.equal(h.ids.get('announcementCount').textContent, 'Unavailable');
  assert.equal(h.ids.get('unreadCount').textContent, 'Unavailable');
  assert.match(h.ids.get('messageList').innerHTML, /&lt;Temporary failure&gt;/);
  failing = false; await h.click('retryAnnouncements');
  assert.equal(h.ids.get('announcementCount').textContent, '2');
  assert.equal(h.ids.get('unreadCount').textContent, 'Unavailable');
  await h.click('retryMessages');
  assert.equal(h.ids.get('unreadCount').textContent, '1');
  const malformed = harness({ get: () => ({ ok: true, data: {} }) }).start(); await settle();
  assert.equal(malformed.ids.get('announcementCount').textContent, 'Unavailable');
});

test('message directory distinguishes unread, read received, sent and recipient-read states', async () => {
  const h = harness().start(); await settle(); const html = h.ids.get('messageList').innerHTML;
  assert.match(html, /Unread/); assert.match(html, />Read</); assert.match(html, />Sent</); assert.match(html, /Read by recipient/);
  assert.match(html, /&lt;School office&gt;/); assert.match(html, /&lt;Unread message&gt;/);
  assert.equal(h.ids.get('unreadCount').textContent, '1');
  assert.equal(h.ids.get('totalMessageCount').textContent, '4');
});

test('message filtering distinguishes received unread and sent without loading other records', async () => {
  const h = harness().start(); await settle(); const count = h.requests.length;
  await h.change('messageFilter', 'unread');
  assert.equal(h.ids.get('messageList').querySelectorAll('[data-open-message]').length, 1);
  await h.change('messageFilter', 'sent');
  assert.equal(h.ids.get('messageList').querySelectorAll('[data-open-message]').length, 2);
  await h.change('messageSearch', 'Acknowledged', 'input');
  assert.equal(h.ids.get('messageList').querySelectorAll('[data-open-message]').length, 1);
  await h.change('messageSearch', 'Missing', 'input');
  assert.match(h.ids.get('messageList').innerHTML, /No messages match/);
  assert.equal(h.requests.length, count);
});

test('foreign message rows are not displayed or included in summary', async () => {
  const h = harness({ messageData: [...messages(), { id: 99, sender_id: 3, recipient_id: 5, body: 'Unrelated message', sent_at: '2026-10-05T00:00:00Z' }] }).start(); await settle();
  assert.doesNotMatch(h.ids.get('messageList').innerHTML, /Unrelated message/);
  assert.equal(h.ids.get('totalMessageCount').textContent, '4');
});

test('opening an unread message never marks it automatically; only its recipient may mark it', async () => {
  const h = harness().start(); await settle();
  const unreadModal = await h.openMessage(11);
  assert.equal(h.writes.length, 0); assert.ok(unreadModal.overlay.querySelector('[data-mark-read]'));
  assert.equal(unreadModal.trigger.dataset.openMessage, '11');
  unreadModal.close();
  const sentModal = await h.openMessage(13);
  assert.equal(sentModal.overlay.querySelector('[data-mark-read]'), null);
  assert.equal(h.writes.length, 0);
});

test('successful mark-as-read uses the server timestamp and updates the owned unread count', async () => {
  const h = harness().start(); await settle(); const modal = await h.openMessage(11);
  await modal.overlay.querySelector('[data-mark-read]').listeners.click(); await settle();
  assert.deepEqual(h.writes, [{ method: 'patch', url: '/api/v1/messages/11/read', body: {} }]);
  assert.equal(modal.closed, true); assert.equal(h.ids.get('unreadCount').textContent, '0');
});

test('invalid read acknowledgements and denied writes retain unread status and permit retry', async () => {
  for (const result of [{ ok: false, error: 'Read denied' }, { ok: true, data: { id: 11, recipient_id: 5, read_at: '2026-10-03T07:00:00Z' } }, { ok: true, data: { id: 12, recipient_id: 7, read_at: '2026-10-03T07:00:00Z' } }, { ok: true, data: { id: 11, recipient_id: 7 } }]) {
    const h = harness({ write: () => result }).start(); await settle(); const modal = await h.openMessage(11);
    await modal.overlay.querySelector('[data-mark-read]').listeners.click(); await settle();
    assert.equal(modal.closed, false); assert.equal(h.ids.get('unreadCount').textContent, '1');
    assert.match(modal.body.querySelector('#messageReadAlert').innerHTML, /Read denied|could not be confirmed/);
    assert.equal(modal.busy, false);
  }
});

test('announcement form restricts supported audiences and validates title/body inline', async () => {
  const h = harness().start(); await settle(); const modal = await h.click('newAnnouncement');
  const form = await h.submit(modal, { title: ' ', audience: 'class', body: ' ' });
  assert.equal(h.writes.length, 0);
  assert.equal(form.elements.namedItem('title').attrs['aria-invalid'], 'true');
  assert.equal(form.elements.namedItem('audience').attrs['aria-invalid'], 'true');
  assert.equal(form.elements.namedItem('body').attrs['aria-invalid'], 'true');
  assert.doesNotMatch(modal.body.innerHTML, /value="class"|class_id|published_at/);
});

test('publishing confirms audience and posts only existing contract fields', async () => {
  const h = harness().start(); await settle(); const modal = await h.click('newAnnouncement');
  await h.submit(modal, { title: ' New announcement ', audience: 'parents', body: ' Family update ' });
  assert.equal(modal.closed, true);
  assert.deepEqual(h.writes[0], { method: 'post', url: '/api/v1/announcements', body: { title: 'New announcement', body: 'Family update', audience: 'parents' } });
  assert.match(h.confirmations[0][1], /Parents \/ Guardians/);
  assert.equal(h.requests.filter(url => url === '/api/v1/announcements').length, 2);
});

test('declining publication or sending confirmation keeps the draft without a mutation', async () => {
  const h = harness({ confirm: false }).start(); await settle(); const modal = await h.click('newMessage');
  const form = await h.submit(modal, { recipient_id: '8', body: 'Draft message' });
  assert.equal(modal.closed, false); assert.equal(form.elements.namedItem('body').value, 'Draft message');
  assert.equal(form.elements.namedItem('body').disabled, false); assert.equal(form.elements.namedItem('recipient_id').disabled, false);
  assert.equal(modal.busy, false);
  assert.equal(h.writes.length, 0);
});

test('message validation rejects empty text and invalid account numbers without directory lookup', async () => {
  const h = harness().start(); await settle(); const modal = await h.click('newMessage');
  const form = await h.submit(modal, { recipient_id: '0', body: ' ' });
  assert.equal(h.writes.length, 0);
  assert.equal(form.elements.namedItem('recipient_id').attrs['aria-invalid'], 'true');
  assert.equal(form.elements.namedItem('body').attrs['aria-invalid'], 'true');
  assert.equal(h.requests.some(url => /\/users/.test(url)), false);
  assert.doesNotMatch(modal.body.innerHTML, /multiple|broadcast.*option|recipient_ids/);
});

test('sending uses one recipient and server validation keeps drafts and marks affected controls', async () => {
  const h = harness({ write: () => ({ ok: false, error: 'Recipient unavailable', fields: { recipient_id: ['Choose an existing account.'] } }) }).start(); await settle();
  const modal = await h.click('newMessage'); const form = await h.submit(modal, { recipient_id: '8', body: 'Please review' });
  assert.deepEqual(h.writes[0], { method: 'post', url: '/api/v1/messages', body: { recipient_id: 8, body: 'Please review' } });
  assert.equal(modal.closed, false); assert.equal(modal.busy, false);
  assert.equal(form.elements.namedItem('body').value, 'Please review');
  assert.equal(form.elements.namedItem('recipient_id').attrs['aria-invalid'], 'true');
  assert.match(form.querySelector('[data-form-error]').innerHTML, /Choose an existing account/);
  assert.match(h.confirmations[0][1], /account #8/);
});

test('pending communication saves prevent duplicate submission and show progress', async () => {
  let resolve;
  const h = harness({ write: () => new Promise(done => { resolve = done; }) }).start(); await settle();
  const modal = await h.click('newMessage'), form = modal.body.querySelector('form');
  form.elements.namedItem('recipient_id').value = '8'; form.elements.namedItem('body').value = 'Please review';
  const pending = form.listeners.submit({ preventDefault() {} }); await settle();
  assert.equal(modal.busy, true); assert.equal(modal.overlay.querySelector('[data-save-communication]').textContent, 'Sending…');
  assert.equal(form.elements.namedItem('body').disabled, true); assert.equal(form.elements.namedItem('recipient_id').disabled, true);
  await form.listeners.submit({ preventDefault() {} });
  assert.equal(h.writes.length, 1); modal.close(); assert.equal(modal.closed, false);
  resolve({ ok: true, data: { id: 100 } }); await pending; await settle();
  assert.equal(modal.closed, true); assert.equal(h.toasts[0][0], 'Message sent.');
});

test('older announcement loads cannot replace a post-publication reload', async () => {
  let initial, calls = 0;
  const h = harness({ get: url => {
    if (url !== '/api/v1/announcements') return undefined;
    if (++calls === 1) return new Promise(resolve => { initial = resolve; });
    return { ok: true, data: [{ id: 9, title: 'Latest announcement', body: 'Current directory', audience: 'staff', published_at: '2026-10-03T06:00:00Z' }] };
  } }).start();
  const modal = await h.click('newAnnouncement');
  await h.submit(modal, { title: 'Latest announcement', audience: 'staff', body: 'Current directory' });
  initial({ ok: true, data: [{ title: 'Stale announcement', body: 'Old directory', audience: 'staff' }] }); await settle();
  assert.match(h.ids.get('announcementList').innerHTML, /Latest announcement/);
  assert.doesNotMatch(h.ids.get('announcementList').innerHTML, /Stale announcement/);
});

test('communication page uses dedicated assets and shared accessible dialogs and responsive tokens', () => {
  const root = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(root, 'public/communication.html'), 'utf8');
  assert.match(html, /\/assets\/communication.js/); assert.match(html, /\/assets\/communication.css/);
  assert.doesNotMatch(html, /<style>|<script>/);
  const js = fs.readFileSync(path.join(root, 'public/assets/communication.js'), 'utf8');
  assert.match(js, /MGAEMS.openModal/); assert.doesNotMatch(js, /document.createElement/);
  const css = fs.readFileSync(path.join(root, 'public/assets/communication.css'), 'utf8');
  assert.match(css, /max-width: 900px/); assert.match(css, /max-width: 640px/);
  assert.match(css, /var\(--touch-target\)/); assert.match(css, /var\(--surface\)/);
});

test('malformed announcement records fail safely without replacing a usable message directory', async () => {
  for (const announcementData of [[null], [{ id: 0, title: 'Invalid', body: 'Text', audience: 'staff' }], [{ id: Number.MAX_SAFE_INTEGER + 1, title: 'Invalid', body: 'Text', audience: 'staff' }], [{ id: 1, title: 'Invalid', body: {}, audience: 'staff' }], [{ id: 1, title: 'Invalid', body: 'Text', audience: 'class' }]]) {
    const h = harness({ announcementData }).start(); await settle();
    assert.equal(h.ids.get('announcementCount').textContent, 'Unavailable');
    assert.match(h.ids.get('announcementList').innerHTML, /could not be loaded/);
    assert.equal(h.ids.get('totalMessageCount').textContent, '4');
  }
});

test('malformed message records fail safely without an invented unread zero', async () => {
  for (const messageData of [[null], [{ id: -1, sender_id: 4, recipient_id: 7, body: 'Invalid' }], [{ id: 1, sender_id: true, recipient_id: 7, body: 'Invalid' }], [{ id: 1, sender_id: 4, recipient_id: 7, body: {} }], [{ id: 'invalid', sender_id: 4, recipient_id: 7, body: 'Invalid' }]]) {
    const h = harness({ messageData }).start(); await settle();
    assert.equal(h.ids.get('unreadCount').textContent, 'Unavailable');
    assert.equal(h.ids.get('totalMessageCount').textContent, 'Unavailable');
    assert.match(h.ids.get('messageList').innerHTML, /could not be loaded/);
    assert.equal(h.ids.get('announcementCount').textContent, '2');
  }
});

test('token, account, role or page changes discard pending communication loads', async () => {
  for (const change of [{ token: 'replacement' }, { id: 90 }, { role: 'teacher' }, { path: '/dashboard.html' }]) {
    const pending = new Map();
    const h = harness({ get: url => new Promise(resolve => pending.set(url, resolve)) }).start();
    if (change.path) h.context.window.location.pathname = change.path;
    else h.switchIdentity(change);
    pending.get('/api/v1/announcements')({ ok: true, data: announcements() });
    pending.get('/api/v1/messages')({ ok: true, data: messages() }); await settle();
    assert.match(h.ids.get('announcementList').innerHTML, /Loading announcements/);
    assert.match(h.ids.get('messageList').innerHTML, /Loading messages/);
    assert.equal(h.ids.get('unreadCount').textContent, 'Loading…');
  }
});

test('changed account identity prevents old controls opening a form or marking a message', async () => {
  const h = harness().start(); await settle(); const readModal = await h.openMessage(11);
  h.switchIdentity({ token: 'replacement' });
  await readModal.overlay.querySelector('[data-mark-read]').listeners.click();
  assert.equal(h.writes.length, 0);
  readModal.close();
  await h.click('newAnnouncement'); await h.click('newMessage');
  assert.equal(h.modals.length, 1);
});

test('confirmation freezes fields and an account switch before acceptance prevents sending', async () => {
  let accept;
  const h = harness().start(); await settle();
  h.app.confirmAction = () => new Promise(resolve => { accept = resolve; });
  const modal = await h.click('newMessage'), form = modal.body.querySelector('form');
  form.elements.namedItem('recipient_id').value = '8'; form.elements.namedItem('body').value = 'Review';
  const pending = form.listeners.submit({ preventDefault() {} }); await settle();
  assert.equal(modal.busy, true); assert.equal(form.elements.namedItem('body').disabled, true);
  assert.equal(modal.overlay.querySelector('[data-save-communication]').textContent, 'Confirming…');
  h.switchIdentity({ id: 90 }); accept(true); await pending;
  assert.equal(h.writes.length, 0); assert.equal(h.toasts.length, 0);
  assert.equal(modal.busy, false); assert.equal(modal.closed, true);
});

test('identity changes discard successful send and read acknowledgements without stale UI effects', async () => {
  for (const mode of ['send', 'read']) {
    let resolve;
    const h = harness({ write: () => new Promise(done => { resolve = done; }) }).start(); await settle();
    const modal = mode === 'send' ? await h.click('newMessage') : await h.openMessage(11);
    let pending;
    if (mode === 'send') {
      const form = modal.body.querySelector('form'); form.elements.namedItem('recipient_id').value = '8'; form.elements.namedItem('body').value = 'Review';
      pending = form.listeners.submit({ preventDefault() {} });
    } else pending = modal.overlay.querySelector('[data-mark-read]').listeners.click();
    await settle(); const readCount = h.requests.length;
    h.switchIdentity({ token: 'replacement' });
    resolve({ ok: true, data: { id: 11, recipient_id: 7, read_at: '2026-10-03T07:00:00Z' } }); await pending;
    assert.equal(h.ids.get('unreadCount').textContent, '1');
    assert.equal(h.toasts.length, 0); assert.equal(h.requests.length, readCount);
    assert.equal(modal.busy, false); assert.equal(modal.closed, true);
  }
});
