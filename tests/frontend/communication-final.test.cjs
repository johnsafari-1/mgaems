// Administrator recipient lookup uses only mocked paginated directory responses.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const createDOM = require('./helpers/dom.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));
const accounts = () => [{ id: 8, username: '<Account Eight>', role: 'teacher', status: 'active', email: 'PRIVATE-EMAIL', account_link: { private: 'PRIVATE-STAFF' } }, { id: 9, username: 'Family account', role: 'parent_guardian', status: 'inactive' }];
function harness({ role = 'system_admin', get, post, confirm = true } = {}) {
  const h = createDOM(role, '/communication.html'), reads = [], writes = [], confirmations = [];
  let actor = { id: 7, role, username: 'Administrator fixture' }, token = 'memory-session';
  h.app.currentUser = () => actor; h.app.requireAuth = () => actor;
  h.context.localStorage.getItem = key => key === 'mgaems_token' ? token : key === 'mgaems_user' ? JSON.stringify(actor) : null;
  h.app.get = async url => {
    reads.push(url); if (get) { const result = await get(url); if (result !== undefined) return result; }
    if (url.startsWith('/api/v1/users?')) { const page = Number(new URLSearchParams(url.split('?')[1]).get('page')); return { ok: true, data: page === 1 ? accounts() : [{ id: 10, username: 'Second-page sponsor', role: 'sponsor', status: 'locked' }], meta: { page, per_page: 15, total: 17 } }; }
    return { ok: true, data: [] };
  };
  h.app.post = async (url, body) => { writes.push({ url, body: structuredClone(body) }); return post ? post(url, body) : { ok: true, data: { id: 1 } }; };
  h.app.confirmAction = async (...args) => { confirmations.push(args); return typeof confirm === 'function' ? confirm(...args) : confirm; };
  h.app.toast = () => {};
  return Object.assign(h, {
    reads, writes, confirmations,
    start() { h.run('communication.js'); return this; },
    async compose() { const button = h.ids.get('newMessage'); assert.ok(button); await button.listeners.click({ currentTarget: button }); await settle(); return h.modals.at(-1); },
    async click(id) { const button = h.ids.get(id); assert.ok(button, 'Missing ' + id); await button.listeners.click(); await settle(); },
    async pick(id) { const button = h.ids.get('recipientMatches').querySelectorAll('[data-recipient-choice]').find(button => button.dataset.recipientChoice === String(id)); assert.ok(button); await button.listeners.click(); await settle(); },
    async search(value) { h.ids.get('recipientPageSearch').value = value; h.ids.get('recipientPageSearch').listeners.input(); await settle(); },
    async submit(modal, values = {}) { const form = modal.body.querySelector('form'); for (const [key, value] of Object.entries(values)) form.elements.namedItem(key).value = value; await form.listeners.submit({ preventDefault() {} }); await settle(); },
    changeIdentity(change) { actor = { ...actor, ...change }; if ('token' in change) token = change.token; if ('path' in change) h.context.window.location.pathname = change.path; },
  });
}

test('administrator lookup is optional and loads no accounts until Find accounts is explicitly used', async () => {
  const h = harness().start(); await settle(); const modal = await h.compose();
  assert.equal(h.reads.some(url => url.startsWith('/api/v1/users')), false); assert.match(modal.body.innerHTML, /Optional administrator account lookup/); assert.match(modal.body.innerHTML, /Search applies only to that loaded page/);
  assert.equal(h.ids.get('messageRecipient').value, ''); await h.click('recipientFind');
  assert.deepEqual(h.reads.filter(url => url.startsWith('/api/v1/users')), ['/api/v1/users?page=1&per_page=15']); assert.equal(h.ids.get('messageRecipient').value, ''); assert.equal(h.writes.length, 0);
});

test('non-administrator roles never get account chooser controls or directory reads', async () => {
  for (const role of ['head_teacher', 'deputy_head_teacher', 'teacher', 'sponsor_coordinator', 'parent_guardian', 'sponsor', 'student', 'unknown']) {
    const h = harness({ role }).start(); await settle();
    if (['head_teacher', 'deputy_head_teacher', 'teacher'].includes(role)) { const modal = await h.compose(); assert.match(modal.body.innerHTML, /existing account number/); }
    else assert.equal(h.ids.has('newMessage'), false);
    assert.equal(h.ids.has('recipientFind'), false); assert.equal(h.reads.some(url => url.startsWith('/api/v1/users')), false);
  }
});

test('returned account choices are escaped, accessible and exclude directory email or Staff metadata', async () => {
  const h = harness().start(); await settle(); await h.compose(); await h.click('recipientFind'); const html = h.ids.get('recipientMatches').innerHTML;
  assert.match(html, /&lt;Account Eight&gt;|Account #8|Teacher|Active|Parent Guardian|Inactive/); assert.doesNotMatch(html, /<Account Eight>|PRIVATE-EMAIL|PRIVATE-STAFF/);
  const choice = h.ids.get('recipientMatches').querySelector('[data-recipient-choice]'); assert.match(choice.getAttribute('aria-label'), /Choose .*account 8.*Teacher.*active/);
});

test('choosing an account fills one recipient number and preserves the message draft without sending', async () => {
  const h = harness().start(); await settle(); await h.compose(); h.ids.get('messageBody').value = 'Existing draft'; await h.click('recipientFind'); await h.pick(8);
  assert.equal(h.ids.get('messageRecipient').value, '8'); assert.equal(h.ids.get('messageBody').value, 'Existing draft'); assert.equal(h.document.activeElement, h.ids.get('messageRecipient')); assert.equal(h.writes.length, 0); assert.equal(h.confirmations.length, 0);
  assert.match(h.ids.get('recipientChosen').textContent, /Account #8/);
});

test('page-local account search filters returned names roles and numbers without changing API parameters', async () => {
  const h = harness().start(); await settle(); await h.compose(); await h.click('recipientFind'); const before = h.reads.length;
  await h.search('teacher'); assert.match(h.ids.get('recipientMatches').innerHTML, /Account #8/); assert.doesNotMatch(h.ids.get('recipientMatches').innerHTML, /Family account/);
  await h.search('9'); assert.match(h.ids.get('recipientMatches').innerHTML, /Family account/); await h.search('not on this page'); assert.match(h.ids.get('recipientMatches').innerHTML, /No accounts match on this page/); assert.equal(h.reads.length, before);
  assert.match(h.ids.get('recipientPageInfo').textContent, /0 of 2 loaded accounts shown/);
});

test('lookup search Enter is handled locally and cannot submit the composed message', async () => {
  const h = harness().start(); await settle(); await h.compose(); await h.click('recipientFind'); let prevented = false;
  h.ids.get('recipientPageSearch').listeners.keydown({ key: 'Enter', preventDefault() { prevented = true; } }); await settle();
  assert.equal(prevented, true); assert.equal(h.writes.length, 0); assert.equal(h.confirmations.length, 0); assert.equal(h.reads.filter(url => url.startsWith('/api/v1/users')).length, 1);
});

test('lookup pagination uses real metadata and retains only one explicitly chosen recipient', async () => {
  const h = harness().start(); await settle(); await h.compose(); await h.click('recipientFind'); await h.pick(8);
  assert.equal(h.ids.get('recipientPrevious').disabled, true); assert.equal(h.ids.get('recipientNext').disabled, false); await h.click('recipientNext');
  assert.match(h.reads.at(-1), /page=2/); assert.match(h.ids.get('recipientPageInfo').textContent, /Page 2 of 2.*17 directory accounts/); assert.equal(h.ids.get('recipientNext').disabled, true); assert.equal(h.ids.get('recipientPrevious').disabled, false);
  assert.equal(h.ids.get('messageRecipient').value, '8'); await h.pick(10); assert.equal(h.ids.get('messageRecipient').value, '10'); await h.click('recipientPrevious'); assert.match(h.reads.at(-1), /page=1/);
});

test('clear lookup removes loaded account data and a matching chosen number, while manual edits remain intact', async () => {
  const h = harness().start(); await settle(); await h.compose(); await h.click('recipientFind'); await h.pick(8); await h.click('recipientClear');
  assert.equal(h.ids.get('messageRecipient').value, ''); assert.equal(h.ids.get('recipientMatches').innerHTML, ''); assert.equal(h.ids.get('recipientNext').disabled, true); assert.equal(h.document.activeElement, h.ids.get('recipientFind'));
  await h.click('recipientFind'); await h.pick(8); h.ids.get('messageRecipient').value = '99'; h.ids.get('messageRecipient').listeners.input(); await h.click('recipientClear'); assert.equal(h.ids.get('messageRecipient').value, '99'); assert.equal(h.ids.get('recipientChosen').textContent, '');
});

test('manual account entry and existing confirmation/send payload remain available to administrators', async () => {
  const h = harness().start(); await settle(); const modal = await h.compose(); await h.submit(modal, { recipient_id: '8', body: 'Review this message' });
  assert.deepEqual(h.writes, [{ url: '/api/v1/messages', body: { recipient_id: 8, body: 'Review this message' } }]); assert.equal(h.reads.some(url => url.startsWith('/api/v1/users')), false); assert.match(h.confirmations[0][1], /account #8/);
});

test('chosen existing account sends through the same one-recipient API and remains server validated', async () => {
  const h = harness({ post: () => ({ ok: false, status: 422, error: 'Recipient unavailable', fields: { recipient_id: ['Review this account.'] } }) }).start(); await settle(); const modal = await h.compose(); await h.click('recipientFind'); await h.pick(9); await h.submit(modal, { body: 'Please review' });
  assert.deepEqual(h.writes[0].body, { recipient_id: 9, body: 'Please review' }); assert.equal(modal.closed, false); assert.equal(h.ids.get('messageRecipient').getAttribute('aria-invalid'), 'true'); assert.equal(h.ids.get('messageBody').value, 'Please review');
});

test('known existing Student accounts remain visible but cannot be chosen for an unavailable inbox', async () => {
  const h = harness({ get: url => url.startsWith('/api/v1/users?') ? { ok: true, data: [{ id: 22, username: 'Existing Student account', role: 'student', status: 'active' }], meta: { page: 1, per_page: 15, total: 1 } } : undefined }).start(); await settle(); await h.compose(); await h.click('recipientFind'); const choice = h.ids.get('recipientMatches').querySelector('[data-recipient-choice]'); assert.equal(choice.disabled, true); await h.pick(22); assert.equal(h.ids.get('messageRecipient').value, ''); assert.equal(h.writes.length, 0); assert.match(h.ids.get('recipientMatches').innerHTML, /announcements only|message inbox is unavailable/); assert.doesNotMatch(h.ids.get('recipientMatches').innerHTML, /href=.*student/);
});

test('known Staff-link ineligible accounts are disabled using existing eligibility without exposing Staff detail', async () => {
  const h = harness({ get: url => url.startsWith('/api/v1/users?') ? { ok: true, data: [{ id: 22, username: 'Ineligible Teacher', role: 'teacher', status: 'active', account_link: { required: true, eligible: false, staff: { name: 'PRIVATE-STAFF-NAME' }, reason: 'PRIVATE-STAFF-REASON' } }, { id: 23, username: 'Eligible Teacher', role: 'teacher', status: 'active', account_link: { required: true, eligible: true } }], meta: { page: 1, per_page: 15, total: 2 } } : undefined }).start(); await settle(); await h.compose(); await h.click('recipientFind');
  const buttons = h.ids.get('recipientMatches').querySelectorAll('[data-recipient-choice]'); assert.equal(buttons[0].disabled, true); assert.equal(buttons[1].disabled, false); await h.pick(22); assert.equal(h.ids.get('messageRecipient').value, ''); await h.pick(23); assert.equal(h.ids.get('messageRecipient').value, '23'); assert.match(h.ids.get('recipientMatches').innerHTML, /Staff-link eligibility is not currently met/); assert.doesNotMatch(h.ids.get('recipientMatches').innerHTML, /PRIVATE-STAFF-NAME|PRIVATE-STAFF-REASON/);
});

test('empty directory lookup has an honest empty state and no automatic recipient choice', async () => {
  const h = harness({ get: url => url.startsWith('/api/v1/users?') ? { ok: true, data: [], meta: { page: 1, per_page: 15, total: 0 } } : undefined }).start(); await settle(); await h.compose(); await h.click('recipientFind'); assert.match(h.ids.get('recipientMatches').innerHTML, /No accounts on this page/); assert.equal(h.ids.get('messageRecipient').value, ''); assert.equal(h.ids.get('recipientPrevious').disabled, true); assert.equal(h.ids.get('recipientNext').disabled, true);
});

test('malformed directory rows roles status or metadata fail closed without selectable accounts', async () => {
  for (const result of [{ ok: true, data: [null], meta: { page: 1, per_page: 15, total: 1 } }, { ok: true, data: [{ ...accounts()[0], role: 'unknown' }], meta: { page: 1, per_page: 15, total: 1 } }, { ok: true, data: [{ ...accounts()[0], id: 0 }], meta: { page: 1, per_page: 15, total: 1 } }, { ok: true, data: [accounts()[0], accounts()[0]], meta: { page: 1, per_page: 15, total: 2 } }, { ok: true, data: accounts(), meta: { page: 1, per_page: 0, total: 2 } }, { ok: true, data: accounts(), meta: { page: 99, per_page: 15, total: 2 } }]) {
    const h = harness({ get: url => url.startsWith('/api/v1/users?') ? result : undefined }).start(); await settle(); await h.compose(); await h.click('recipientFind'); assert.match(h.ids.get('recipientMatches').innerHTML, /unexpected information/); assert.equal(h.ids.get('recipientMatches').querySelector('[data-recipient-choice]'), null); assert.equal(h.ids.get('messageRecipient').value, '');
  }
});

test('directory failures show escaped feedback and retain the manual number workflow', async () => {
  const h = harness({ get: url => url.startsWith('/api/v1/users?') ? { ok: false, status: 503, error: '<Account directory unavailable>' } : undefined }).start(); await settle(); const modal = await h.compose(); h.ids.get('messageRecipient').value = '88'; await h.click('recipientFind');
  assert.match(h.ids.get('recipientMatches').innerHTML, /&lt;Account directory unavailable&gt;/); assert.equal(h.ids.get('messageRecipient').value, '88'); assert.equal(h.ids.get('recipientFind').disabled, false); assert.equal(modal.closed, false);
});

test('pending lookup shows loading and duplicate Find requests are blocked', async () => {
  let release; const h = harness({ get: url => url.startsWith('/api/v1/users?') ? new Promise(resolve => { release = resolve; }) : undefined }).start(); await settle(); await h.compose(); const pending = h.ids.get('recipientFind').listeners.click(); await settle();
  assert.match(h.ids.get('recipientMatches').innerHTML, /Loading administrator account directory/); assert.equal(h.ids.get('recipientFind').disabled, true); await h.click('recipientFind'); assert.equal(h.reads.filter(url => url.startsWith('/api/v1/users')).length, 1);
  release({ ok: true, data: accounts(), meta: { page: 1, per_page: 15, total: 17 } }); await pending; assert.equal(h.ids.get('recipientFind').disabled, false);
});

test('clear lookup invalidates a pending response without restoring confidential account data', async () => {
  let release; const h = harness({ get: url => url.startsWith('/api/v1/users?') ? new Promise(resolve => { release = resolve; }) : undefined }).start(); await settle(); await h.compose(); const pending = h.ids.get('recipientFind').listeners.click(); await settle(); await h.click('recipientClear');
  release({ ok: true, data: accounts(), meta: { page: 1, per_page: 15, total: 17 } }); await pending; assert.equal(h.ids.get('recipientMatches').innerHTML, ''); assert.equal(h.ids.get('recipientFind').disabled, false); assert.equal(h.ids.get('messageRecipient').value, '');
});

test('closing a dialog or changing token account role or page suppresses pending directory replies', async () => {
  for (const change of ['close', { token: 'replacement' }, { id: 90 }, { role: 'teacher' }, { path: '/dashboard.html' }]) {
    let release; const h = harness({ get: url => url.startsWith('/api/v1/users?') ? new Promise(resolve => { release = resolve; }) : undefined }).start(); await settle(); const modal = await h.compose(); const pending = h.ids.get('recipientFind').listeners.click(); await settle();
    if (change === 'close') modal.close(); else h.changeIdentity(change);
    release({ ok: true, data: accounts(), meta: { page: 1, per_page: 15, total: 17 } }); await pending; assert.doesNotMatch(h.ids.get('recipientMatches').innerHTML, /Account Eight|Family account/); assert.equal(h.writes.length, 0);
  }
});

test('old or forged choice controls cannot select an account outside the current loaded page', async () => {
  const h = harness().start(); await settle(); await h.compose(); await h.click('recipientFind'); const old = h.ids.get('recipientMatches').querySelector('[data-recipient-choice]'); await h.click('recipientNext'); old.listeners.click(); assert.equal(h.ids.get('messageRecipient').value, '');
  const choice = h.ids.get('recipientMatches').querySelector('[data-recipient-choice]'); choice.dataset.recipientChoice = '999'; choice.listeners.click(); assert.equal(h.ids.get('messageRecipient').value, '');
});

test('message confirmation freezes lookup and selected account controls, and cancellation restores the draft', async () => {
  let accept; const h = harness({ confirm: () => new Promise(resolve => { accept = resolve; }) }).start(); await settle(); const modal = await h.compose(); await h.click('recipientFind'); await h.pick(8);
  const form = modal.body.querySelector('form'); form.elements.namedItem('body').value = 'Existing draft'; const pending = form.listeners.submit({ preventDefault() {} }); await settle(); const before = h.reads.length;
  assert.equal(h.ids.get('recipientFind').disabled, true); assert.equal(h.ids.get('recipientPageSearch').disabled, true); await h.click('recipientFind'); assert.equal(h.reads.length, before);
  accept(false); await pending; assert.equal(h.ids.get('recipientFind').disabled, false); assert.equal(h.ids.get('recipientPageSearch').disabled, false); assert.equal(h.ids.get('messageRecipient').value, '8'); assert.equal(h.writes.length, 0);
});

test('submitting during a pending lookup invalidates that response and cancellation restores usable lookup controls', async () => {
  let release, accept; const h = harness({ get: url => url.startsWith('/api/v1/users?') ? new Promise(resolve => { release = resolve; }) : undefined, confirm: () => new Promise(resolve => { accept = resolve; }) }).start(); await settle(); const modal = await h.compose(); const lookup = h.ids.get('recipientFind').listeners.click(); await settle();
  const form = modal.body.querySelector('form'); form.elements.namedItem('recipient_id').value = '88'; form.elements.namedItem('body').value = 'Review'; const pending = form.listeners.submit({ preventDefault() {} }); await settle();
  release({ ok: true, data: accounts(), meta: { page: 1, per_page: 15, total: 17 } }); await lookup; assert.doesNotMatch(h.ids.get('recipientMatches').innerHTML, /Account Eight/); accept(false); await pending;
  assert.equal(h.ids.get('recipientFind').disabled, false); assert.equal(h.ids.get('messageRecipient').value, '88'); assert.equal(h.writes.length, 0);
});
