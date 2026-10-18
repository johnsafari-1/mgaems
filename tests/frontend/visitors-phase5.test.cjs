// Synthetic DOM checks cover behavior; browser layout is a separate acceptance gate.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const visitor = (id = 1, extra = {}) => ({ id, visitor_name: `Fixture visitor ${id}`, visitor_type: 'visitor', visit_date: '2026-10-13', purpose: 'Fixture purpose', notes: null,
  host_staff: { first_name: 'Fixture', last_name: 'Host' }, created_at: '2026-10-13T06:00:00Z', updated_at: null, ...extra });
function harness({ role = 'head_teacher', visitors = [visitor()], hosts = [{ id: 7, first_name: 'Fixture', last_name: 'Host', role_title: 'Teacher' }], get, post, confirm = true } = {}) {
  const h = createDOM(role, '/visitors.html');
  h.requests = []; h.writes = []; h.notices = []; h.confirmations = [];
  h.app.get = async url => { h.requests.push(url); const custom = get?.(url); return custom === undefined ? { ok: true, data: structuredClone(url.includes('/staff?') ? hosts : visitors) } : custom; };
  h.app.post = async (url, body) => { h.writes.push({ url, body: structuredClone(body) }); return post ? post(url, body) : { ok: true, data: visitor(3) }; };
  h.app.confirmAction = async (...args) => { h.confirmations.push(args); return typeof confirm === 'function' ? confirm(...args) : confirm; };
  h.app.toast = (...args) => h.notices.push(args);
  const schoolDate = h.app.schoolDate;
  h.app.schoolDate = value => value === undefined ? '2026-10-13' : schoolDate(value);
  h.run('visitors.js');
  h.ready = flush;
  h.open = () => h.ids.get('registerVisitor').listeners.click();
  h.fill = (extra = {}) => { for (const [id, value] of Object.entries({ visitorName: 'Synthetic visitor', visitorHostStaff: '7', visitorDate: '2026-10-13', visitorPurpose: '', visitorNotes: '', ...extra })) h.ids.get(id).value = value; };
  h.submit = () => h.ids.get('visitorForm').listeners.submit({ preventDefault() {} });
  h.filter = (id, value, event = 'change') => { h.ids.get(id).value = value; h.ids.get(id).listeners[event](); };
  return h;
}

for (const role of ['system_admin', 'head_teacher', 'deputy_head_teacher']) {
  test(`${role} reads the register and can open authorized registration`, async () => {
    const h = harness({ role }); await h.ready();
    assert.deepEqual(h.requests, ['/api/v1/visitors']);
    assert.ok(h.ids.has('registerVisitor')); await h.open();
    assert.deepEqual(h.requests, ['/api/v1/visitors', '/api/v1/staff?status=active']);
    assert.ok(h.ids.has('visitorForm')); assert.equal(h.writes.length, 0);
  });
}

test('Coordinator has read-only visitor access with no registration or Staff lookup', async () => {
  const h = harness({ role: 'sponsor_coordinator' }); await h.ready();
  assert.equal(h.ids.has('registerVisitor'), false);
  assert.match(h.ids.get('appMain').innerHTML, /Read-only access/);
  const action = h.ids.get('visitorTable').querySelector('[data-visitor]'); action.listeners.click();
  assert.match(h.modals[0].body.innerHTML, /Fixture visitor 1/);
  assert.deepEqual(h.requests, ['/api/v1/visitors']); assert.equal(h.writes.length, 0);
});

for (const role of ['teacher', 'parent_guardian', 'sponsor', 'student']) {
  test(`${role} cannot request visitor records or registration data`, async () => {
    const h = harness({ role }); await h.ready();
    assert.equal(h.ids.has('appMain'), false); assert.deepEqual(h.requests, []); assert.equal(h.writes.length, 0);
  });
}

test('loading remains visible while filters change and unavailable totals are never invented', async () => {
  let finish;
  const h = harness({ get: url => url.endsWith('/visitors') ? new Promise(resolve => { finish = resolve; }) : undefined });
  h.filter('visitorSearch', 'fixture', 'input');
  assert.match(h.ids.get('visitorTable').innerHTML, /Loading visitor register/);
  assert.equal(h.ids.get('totalVisitors').textContent, '—');
  finish({ ok: true, data: [] }); await h.ready();
  assert.match(h.ids.get('visitorTable').innerHTML, /No visits match these filters/); assert.equal(h.ids.get('totalVisitors').textContent, '0');
});

test('failed register load provides retry without misreporting empty results or zero counts', async () => {
  let first = true;
  const h = harness({ get: () => { if (first) { first = false; return { ok: false, error: '<Unavailable>' }; } return { ok: true, data: [visitor()] }; } }); await h.ready();
  assert.match(h.ids.get('visitorTable').innerHTML, /&lt;Unavailable&gt;/); assert.equal(h.ids.get('totalVisitors').textContent, '—');
  assert.equal(h.ids.get('visitorTable').getAttribute('aria-busy'), 'false');
  await h.ids.get('retryVisitors').listeners.click();
  assert.equal(h.ids.get('totalVisitors').textContent, '1');
});

test('malformed visitor response is a recoverable error instead of an empty register or crash', async () => {
  const h = harness({ visitors: [null] }); await h.ready();
  assert.match(h.ids.get('visitorTable').innerHTML, /could not be loaded/); assert.ok(h.ids.has('retryVisitors')); assert.equal(h.ids.get('totalVisitors').textContent, '—');
});

test('empty read-only directory does not tell the Coordinator to register a visitor', async () => {
  const h = harness({ role: 'sponsor_coordinator', visitors: [] }); await h.ready();
  assert.match(h.ids.get('visitorTable').innerHTML, /No visitor records yet/);
  assert.doesNotMatch(h.ids.get('visitorTable').innerHTML, /Register a visitor/);
});

test('summary counts reflect loaded records and school dates rather than filtered results', async () => {
  const h = harness({ visitors: [visitor(1), visitor(2, { visit_date: '2026-10-12', visitor_type: 'volunteer' }), visitor(3, { visit_date: null })] }); await h.ready();
  assert.equal(h.ids.get('todayVisitors').textContent, '1'); assert.equal(h.ids.get('totalVisitors').textContent, '3'); assert.equal(h.ids.get('volunteerVisitors').textContent, '1');
  h.filter('visitorTypeFilter', 'volunteer'); assert.equal(h.ids.get('totalVisitors').textContent, '3'); assert.match(h.ids.get('visitorResultCount').textContent, /1 of 3/);
});

test('search covers visitor, type, host and notes and escapes all rendered values', async () => {
  const h = harness({ visitors: [visitor(1, { visitor_name: '<Visitor>', notes: '<Private note>', host_staff: { first_name: 'Only', last_name: 'Host' } }), visitor(2, { visitor_type: 'church_team' })] }); await h.ready();
  assert.match(h.ids.get('visitorTable').innerHTML, /&lt;Visitor&gt;/); assert.doesNotMatch(h.ids.get('visitorTable').innerHTML, /<Visitor>/);
  for (const text of ['only host', 'private note']) { h.filter('visitorSearch', text, 'input'); assert.match(h.ids.get('visitorResultCount').textContent, /1 of 2/); }
  h.filter('visitorSearch', 'church team', 'input'); assert.match(h.ids.get('visitorTable').innerHTML, /Fixture visitor 2/); assert.doesNotMatch(h.ids.get('visitorTable').innerHTML, /&lt;Visitor&gt;/);
});

test('date filters are inclusive, invalid ranges explain the error, and clear restores focus', async () => {
  const h = harness({ visitors: [visitor(1), visitor(2, { visit_date: '2026-10-12' })] }); await h.ready();
  h.filter('visitorFrom', '2026-10-13'); h.filter('visitorTo', '2026-10-13');
  assert.match(h.ids.get('visitorResultCount').textContent, /1 of 2/);
  h.filter('visitorTo', '2026-10-12'); assert.match(h.ids.get('visitorFilterFeedback').innerHTML, /through date must/); assert.equal(h.ids.get('visitorTo').getAttribute('aria-invalid'), 'true');
  h.ids.get('clearVisitorFilters').listeners.click(); assert.match(h.ids.get('visitorResultCount').textContent, /2 of 2/); assert.equal(h.document.activeElement, h.ids.get('visitorSearch'));
});

test('native details buttons retain semantic table headings and shared keyboard dialog handling', async () => {
  const h = harness(); await h.ready(); const table = h.ids.get('visitorTable');
  assert.match(table.innerHTML, /scope="col"/); assert.doesNotMatch(table.innerHTML, /<tr[^>]*role="button"/);
  const action = table.querySelector('[data-visitor]'); assert.equal(action.tag, 'button'); assert.match(action.getAttribute('aria-label'), /Fixture visitor/);
  action.listeners.click(); const modal = h.modals[0]; assert.equal(modal.trigger, action);
  assert.match(modal.body.innerHTML, /Recorded · Nairobi/); assert.match(modal.body.innerHTML, /Last updated · Nairobi<\/dt><dd>Not recorded/);
  assert.match(modal.footer, /data-dialog-close/); assert.doesNotMatch(modal.footer, /delete|checkout|edit/i);
});

test('late directory response after authentication changes cannot repaint protected records', async () => {
  let finish; const h = harness({ get: () => new Promise(resolve => { finish = resolve; }) });
  const read = h.context.localStorage.getItem; h.context.localStorage.getItem = key => key === 'mgaems_token' ? 'changed-token' : read(key);
  finish({ ok: true, data: [visitor()] }); await h.ready();
  assert.doesNotMatch(h.ids.get('visitorTable').innerHTML, /Fixture visitor/); assert.equal(h.ids.get('totalVisitors').textContent, '—');
});

test('closing host loading dialog prevents the late response from reopening or painting a form', async () => {
  let finish; const h = harness({ get: url => url.includes('/staff?') ? new Promise(resolve => { finish = resolve; }) : undefined }); await h.ready();
  const opening = h.open(); const modal = h.modals[0]; modal.close(); finish({ ok: true, data: [{ id: 7, first_name: 'Later', last_name: 'Host' }] }); await opening;
  assert.equal(h.ids.has('visitorForm'), false); assert.equal(modal.closed, true); assert.equal(h.modals.length, 1);
});

test('host errors support retry and empty host lists keep registration unavailable', async () => {
  let first = true;
  const h = harness({ get: url => url.includes('/staff?') ? first ? (first = false, { ok: false, error: 'Host lookup unavailable' }) : { ok: true, data: [] } : undefined }); await h.ready(); await h.open();
  assert.match(h.modals[0].body.innerHTML, /Host lookup unavailable/); assert.equal(h.ids.get('saveVisitor').disabled, true);
  await h.ids.get('retryVisitorHosts').listeners.click(); assert.equal(h.ids.get('saveVisitor').disabled, true); assert.match(h.modals[0].body.innerHTML, /No active Staff members/);
  h.fill(); await h.submit(); assert.equal(h.writes.length, 0); assert.equal(h.ids.get('visitorHostStaff').getAttribute('aria-invalid'), 'true');
});

test('registration defaults to the Nairobi school date and uses only actual Staff choices', async () => {
  const h = harness(); await h.ready(); await h.open(); assert.equal(h.ids.get('visitorDate').value, '2026-10-13');
  assert.match(h.modals[0].body.innerHTML, /Host, Fixture · Teacher/); assert.equal(h.document.activeElement, h.ids.get('visitorName'));
  h.fill({ visitorHostStaff: '999' }); await h.submit(); assert.equal(h.writes.length, 0); assert.equal(h.ids.get('visitorHostStaff').getAttribute('aria-invalid'), 'true');
});

test('invalid registration fields are highlighted and preserve entered drafts', async () => {
  const h = harness(); await h.ready(); await h.open(); h.fill({ visitorName: ' ', visitorType: 'unsupported', visitorDate: '2026-02-30', visitorPurpose: 'x'.repeat(256) }); await h.submit();
  for (const id of ['visitorName', 'visitorType', 'visitorDate', 'visitorPurpose']) assert.equal(h.ids.get(id).getAttribute('aria-invalid'), 'true');
  assert.equal(h.document.activeElement, h.ids.get('visitorFormAlert')); assert.equal(h.writes.length, 0); assert.equal(h.ids.get('visitorPurpose').value.length, 256);
});

test('cancelled confirmation preserves drafts with no visitor write', async () => {
  const h = harness({ confirm: false }); await h.ready(); await h.open(); h.fill(); await h.submit();
  assert.equal(h.writes.length, 0); assert.equal(h.modals[0].closed, false); assert.equal(h.ids.get('visitorName').value, 'Synthetic visitor'); assert.equal(h.ids.get('saveVisitor').disabled, false);
  assert.match(h.confirmations[0][1], /Synthetic visitor.*13 Oct 2026/);
});

test('pending confirmation locks the form and prevents duplicate submits', async () => {
  let finish; const h = harness({ confirm: () => new Promise(resolve => { finish = resolve; }) }); await h.ready(); await h.open(); h.fill(); const pending = h.submit(); await h.submit();
  assert.equal(h.confirmations.length, 1); assert.equal(h.ids.get('visitorName').disabled, true); assert.equal(h.ids.get('saveVisitor').disabled, true); assert.equal(h.modals[0].busy, true);
  finish(false); await pending; assert.equal(h.ids.get('visitorName').disabled, false); assert.equal(h.writes.length, 0);
});

test('successful registration sends unchanged API fields, closes the modal and refreshes the directory', async () => {
  const h = harness(); await h.ready(); await h.open(); h.fill({ visitorName: '  Synthetic visitor  ', visitorPurpose: '  Purpose  ', visitorNotes: '  Note  ' }); await h.submit();
  assert.deepEqual(h.writes[0], { url: '/api/v1/visitors', body: { visitor_name: 'Synthetic visitor', visitor_type: 'visitor', host_staff_id: 7, visit_date: '2026-10-13', purpose: 'Purpose', notes: 'Note' } });
  assert.equal(h.modals[0].closed, true); assert.equal(h.requests.filter(url => url === '/api/v1/visitors').length, 2); assert.equal(h.notices[0][1], 'success');
});

test('server validation feedback is escaped and retains a retryable draft', async () => {
  const h = harness({ post: () => ({ ok: false, error: 'Host changed', fields: { host_staff_id: ['<Select host again>'] } }) }); await h.ready(); await h.open(); h.fill(); await h.submit();
  assert.equal(h.modals[0].closed, false); assert.equal(h.ids.get('visitorHostStaff').getAttribute('aria-invalid'), 'true'); assert.equal(h.ids.get('visitorName').value, 'Synthetic visitor');
  assert.match(h.ids.get('visitorFormAlert').innerHTML, /&lt;Select host again&gt;/); assert.equal(h.ids.get('saveVisitor').disabled, false); assert.equal(h.ids.get('saveVisitor').textContent, 'Register visit');
});

test('identity change during confirmation prevents a subsequent visitor write', async () => {
  let finish; const h = harness({ confirm: () => new Promise(resolve => { finish = resolve; }) }); await h.ready(); await h.open(); h.fill(); const pending = h.submit();
  const read = h.context.localStorage.getItem; h.context.localStorage.getItem = key => key === 'mgaems_token' ? 'different-token' : read(key);
  finish(true); await pending; assert.equal(h.writes.length, 0);
});

test('pending registration locks fields and ignores a save response after identity changes', async () => {
  let finish;
  const h = harness({ post: () => new Promise(resolve => { finish = resolve; }) }); await h.ready(); await h.open(); h.fill();
  const pending = h.submit(); await flush();
  assert.equal(h.ids.get('visitorName').disabled, true); assert.equal(h.modals[0].busy, true);
  const read = h.context.localStorage.getItem; h.context.localStorage.getItem = key => key === 'mgaems_token' ? 'new-account-token' : read(key);
  finish({ ok: true, data: visitor(3) }); await pending;
  assert.equal(h.modals[0].closed, true); assert.equal(h.notices.length, 0); assert.equal(h.requests.filter(url => url === '/api/v1/visitors').length, 1);
});

test('newer directory retry wins when overlapping loads resolve out of order', async () => {
  const finishes = [];
  let initial = true;
  const h = harness({ get: url => {
    if (!url.endsWith('/visitors')) return undefined;
    if (initial) { initial = false; return { ok: false, error: 'Retry fixture' }; }
    return new Promise(resolve => finishes.push(resolve));
  } }); await h.ready();
  const retry = h.ids.get('retryVisitors'); const older = retry.listeners.click(); const newer = retry.listeners.click();
  finishes[1]({ ok: true, data: [visitor(2)] }); await newer;
  finishes[0]({ ok: true, data: [visitor(1)] }); await older;
  assert.match(h.ids.get('visitorTable').innerHTML, /Fixture visitor 2/); assert.doesNotMatch(h.ids.get('visitorTable').innerHTML, /Fixture visitor 1/);
});

test('page extraction and responsive theme styling retain the shared shell and accessible controls', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../public/visitors.html'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../../public/assets/visitors.css'), 'utf8');
  assert.match(html, /assets\/visitors.js/); assert.match(html, /assets\/visitors.css/); assert.doesNotMatch(html, /<style>|style=/);
  assert.match(css, /max-width: 1100px/); assert.match(css, /max-width: 640px/); assert.match(css, /var\(--touch-target\)/); assert.match(css, /var\(--surface\)|var\(--gray-50\)/);
  assert.match(css, /td\[data-label\]::before/); assert.match(css, /clip-path: inset\(50%\)/);
});
