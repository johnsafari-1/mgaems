// Synthetic operational fixtures only. Layout and assistive technology need browser QA.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const sponsor = { id: 5, name: 'Synthetic Sponsor', sponsor_type: 'church', sponsorships_count: 1 };
const learner = (id = 7, extra = {}) => ({ id, first_name: `Synthetic ${id}`, last_name: 'Learner', admission_no: `S-${id}`, status: 'active', school_class: { id: 3, name: 'Fixture class' }, has_active_individual_sponsorship: false, ...extra });
const item = { id: 9, sponsor_id: 5, sponsor, sponsorship_type: 'individual', student: learner(), students: [], status: 'active', start_date: '2026-01-01', end_date: null, notes: 'Synthetic notes' };
const summary = { sponsors: 1, sponsorships: 1, by_type: { individual: 1, group: 0, school_wide: 0 }, by_status: { active: 1, paused: 0, ended: 0 }, individual_assignments: 1, group_memberships: 0 };
function harness({ role = 'sponsor_coordinator', hash = '#sponsors', get, post, patch, confirm = true } = {}) {
  const h = createDOM(role, '/sponsorship.html'); h.context.window.location.hash = hash;
  h.requests = []; h.writes = []; h.notices = []; h.confirmations = [];
  h.app.get = async url => {
    h.requests.push(url); const custom = get?.(url); if (custom !== undefined) return custom;
    if (url.endsWith('/summary')) return { ok: true, data: summary };
    if (url === '/api/v1/sponsors/5') return { ok: true, data: sponsor };
    if (url === '/api/v1/sponsorships/9') return { ok: true, data: item };
    if (/\/sponsorships\/9\/learners\/\d+$/.test(url)) return { ok: true, data: learner(Number(url.split('/').at(-1))) };
    if (url.startsWith('/api/v1/sponsors?')) return { ok: true, data: [sponsor], meta: { total: 1, per_page: 15, page: 1 } };
    if (url.startsWith('/api/v1/sponsorships/learners?')) return { ok: true, data: [learner()], meta: { total: 1, per_page: 10, page: 1 } };
    if (url.startsWith('/api/v1/sponsorships?')) return { ok: true, data: [item], meta: { total: 1, per_page: 15, page: 1 } };
    throw Error('Unexpected operational endpoint: ' + url);
  };
  h.app.post = async (url, body) => { h.writes.push({ url, body: structuredClone(body) }); return post ? post(url, body) : { ok: true, data: item }; };
  h.app.patch = async (url, body) => { h.writes.push({ url, body: structuredClone(body) }); return patch ? patch(url, body) : { ok: true, data: item }; };
  h.app.confirmAction = async (...args) => { h.confirmations.push(args); return typeof confirm === 'function' ? confirm(...args) : confirm; };
  h.app.toast = (...args) => h.notices.push(args);
  // Model the real helper's disabled-button restoration, including original disabled states.
  const open = h.app.openModal;
  h.app.openModal = definition => {
    const modal = open(definition); let snapshot = [];
    modal.setBusy = value => {
      if (modal.busy === value || modal.closed) return;
      modal.busy = value;
      if (value) { snapshot = modal.overlay.querySelectorAll('button').map(button => [button, button.disabled]); snapshot.forEach(([button]) => { button.disabled = true; }); }
      else snapshot.forEach(([button, disabled]) => { button.disabled = disabled; });
    };
    return modal;
  };
  h.run('sponsorship-workspace.js');
  h.newLinked = async () => { await flush(); h.ids.get('spResults').querySelector('[data-assign]').listeners.click(); return h.ids.get('spForm'); };
  h.lookup = async (kind, search = 'Synthetic') => { h.ids.get(kind + 'Lookup').value = search; await h.ids.get(kind + 'Find').listeners.click(); await flush(); };
  h.pick = (kind, id) => { const button = h.ids.get(kind + 'Matches').querySelector(`[data-pick="${id}"]`); assert.ok(button, 'actual lookup choice exists'); button.listeners.click(); };
  h.submit = () => h.ids.get('spForm').listeners.submit({ preventDefault() {} });
  h.changeToken = () => { const read = h.context.localStorage.getItem; h.context.localStorage.getItem = key => key === 'mgaems_token' ? 'different-session' : read(key); };
  return h;
}

for (const role of ['system_admin', 'sponsor_coordinator']) {
  test(`${role} can start learner linking directly from a selected sponsor`, async () => {
    const h = harness({ role }); const form = await h.newLinked();
    assert.match(h.ids.get('sponsorSelected').innerHTML, /Selected sponsor: Synthetic Sponsor/);
    assert.match(h.modals.at(-1).body.innerHTML, /1\. Choose the sponsor.*2\. Choose the support type/);
    assert.equal(form.elements.sponsorship_type.value, 'individual'); assert.equal(h.ids.get('learnerSelectionCount').textContent, 'No learners selected');
    assert.equal(h.requests.some(url => url.includes('/sponsorships/learners')), false);
  });
}

for (const role of ['head_teacher', 'deputy_head_teacher']) {
  test(`${role} sees assignment information without learner-linking or write actions`, async () => {
    const h = harness({ role }); await flush();
    assert.equal(h.ids.get('spResults').querySelector('[data-assign]'), null);
    await h.ids.get('spResults').querySelector('[data-view]').listeners.click();
    assert.equal(h.modals[0].body.querySelector('[data-create-linked]'), null); assert.equal(h.writes.length, 0);
  });
}

test('Sponsor sessions retain the own-portal destination and do not render operational management', async () => {
  const h = harness({ role: 'sponsor' }); await flush();
  assert.equal(h.context.window.location.href, '/sponsor-portal.html'); assert.deepEqual(h.requests, []); assert.equal(h.ids.has('appMain'), false);
});

test('sponsor details expose a linking action that retains the selected sponsor', async () => {
  const h = harness(); await flush(); await h.ids.get('spResults').querySelector('[data-view]').listeners.click();
  h.modals[0].body.querySelector('[data-create-linked]').listeners.click();
  assert.equal(h.modals[0].closed, true); assert.match(h.ids.get('sponsorSelected').innerHTML, /Synthetic Sponsor/);
  h.ids.get('sponsorSelected').querySelector('[data-clear-sponsor]').listeners.click();
  assert.equal(h.ids.get('sponsorSelected').innerHTML, 'No sponsor selected'); assert.equal(h.document.activeElement, h.ids.get('sponsorLookup'));
});

test('a delayed sponsor edit cannot open over a newer learner-linking form', async () => {
  let finish; const h = harness({ get: url => url === '/api/v1/sponsors/5' ? new Promise(resolve => { finish = resolve; }) : undefined }); await flush();
  const editing = h.ids.get('spResults').querySelector('[data-edit]').listeners.click();
  h.ids.get('spResults').querySelector('[data-assign]').listeners.click();
  finish({ ok: true, data: sponsor }); await editing;
  assert.equal(h.modals.length, 1); assert.equal(h.modals[0].title, 'New Sponsorship'); assert.ok(h.ids.has('learnerLookup'));
});

test('individual learner action uses the authorized sponsorship endpoint and excludes private payload fields', async () => {
  const h = harness({ hash: '#sponsorships', get: url => url === '/api/v1/sponsorships/9/learners/7' ? { ok: true, data: { ...learner(), medical_info: 'secret-health', guardian_phone: 'secret-family', password_hash: 'secret-password' } } : undefined }); await flush();
  await h.ids.get('spResults').querySelector('[data-view]').listeners.click();
  await h.modals[0].body.querySelector('[data-scoped-learner]').listeners.click();
  assert.equal(h.requests.at(-1), '/api/v1/sponsorships/9/learners/7');
  assert.match(h.modals[1].body.innerHTML, /S-7|Fixture class/); assert.doesNotMatch(h.modals[1].body.innerHTML, /secret-/);
  assert.equal(h.requests.some(url => /^\/api\/v1\/(students|health|guardians)/.test(url)), false);
});

test('group membership details expose only explicit learner relationships', async () => {
  const group = { ...item, sponsorship_type: 'group', student: null, students: [learner(7), learner(8)] };
  const h = harness({ hash: '#sponsorships', get: url => url === '/api/v1/sponsorships/9' ? { ok: true, data: group } : undefined }); await flush();
  await h.ids.get('spResults').querySelector('[data-view]').listeners.click();
  assert.equal(h.modals[0].body.querySelectorAll('[data-scoped-learner]').length, 2);
  await h.modals[0].body.querySelector('[data-scoped-learner="8"]').listeners.click();
  assert.equal(h.requests.at(-1), '/api/v1/sponsorships/9/learners/8'); assert.match(h.modals[0].body.innerHTML, /Group members are fixed/);
});

test('school-wide details never create learner links even when unexpected roster data is present', async () => {
  const h = harness({ hash: '#sponsorships', get: url => url === '/api/v1/sponsorships/9' ? { ok: true, data: { ...item, sponsorship_type: 'school_wide', program_name: 'School programme', student: learner(), students: [learner(8)] } } : undefined }); await flush();
  await h.ids.get('spResults').querySelector('[data-view]').listeners.click();
  assert.match(h.modals[0].body.innerHTML, /School programme/); assert.equal(h.modals[0].body.querySelector('[data-scoped-learner]'), null);
  assert.doesNotMatch(h.modals[0].body.innerHTML, /Synthetic 7|Synthetic 8/);
});

test('mismatched scoped learner identity fails closed instead of displaying another learner', async () => {
  const h = harness({ hash: '#sponsorships', get: url => url === '/api/v1/sponsorships/9/learners/7' ? { ok: true, data: learner(999) } : undefined }); await flush();
  await h.ids.get('spResults').querySelector('[data-view]').listeners.click(); await h.modals[0].body.querySelector('[data-scoped-learner]').listeners.click();
  assert.match(h.modals[1].body.innerHTML, /identity could not be verified/); assert.doesNotMatch(h.modals[1].body.innerHTML, /Synthetic 999/);
});

test('denied learner information clears the detail body and offers no unauthorized retry', async () => {
  const h = harness({ hash: '#sponsorships', get: url => url === '/api/v1/sponsorships/9/learners/7' ? { ok: false, status: 403 } : undefined }); await flush();
  await h.ids.get('spResults').querySelector('[data-view]').listeners.click(); await h.modals[0].body.querySelector('[data-scoped-learner]').listeners.click();
  assert.match(h.modals[1].body.innerHTML, /Access restricted/); assert.equal(h.modals[1].body.querySelector('[data-retry]'), null);
});

test('malformed directory rows and malformed group memberships produce a recoverable error', async () => {
  for (const bad of [null, { ...item, sponsorship_type: 'group', students: [null] }]) {
    const h = harness({ hash: '#sponsorships', get: url => url.startsWith('/api/v1/sponsorships?') ? { ok: true, data: [bad], meta: { total: 1, per_page: 15 } } : undefined }); await flush();
    assert.match(h.ids.get('spResults').innerHTML, /unexpected directory response/); assert.equal(h.ids.get('spNext').disabled, true);
  }
});

test('malformed allocation responses preserve selected relationships and offer retry', async () => {
  const h = harness({ get: url => url.startsWith('/api/v1/sponsorships/learners?') ? { ok: true, data: [null], meta: { total: 1, per_page: 10 } } : undefined }); await h.newLinked(); await h.lookup('learner');
  assert.match(h.ids.get('learnerMatches').innerHTML, /unexpected response/); assert.match(h.ids.get('sponsorSelected').innerHTML, /Synthetic Sponsor/); assert.equal(h.ids.get('learnerMore').hidden, true);
});

test('changing search text invalidates an in-flight learner lookup without losing selections', async () => {
  let finish; const h = harness({ get: url => url.startsWith('/api/v1/sponsorships/learners?') ? new Promise(resolve => { finish = resolve; }) : undefined }); await h.newLinked();
  h.ids.get('learnerLookup').value = 'Previous'; const pending = h.ids.get('learnerFind').listeners.click();
  h.ids.get('learnerLookup').value = 'Changed'; h.ids.get('learnerLookup').listeners.input();
  finish({ ok: true, data: [learner()], meta: { total: 1, per_page: 10 } }); await pending; await flush();
  assert.equal(h.ids.get('learnerMatches').innerHTML, ''); assert.equal(h.ids.get('learnerSelectionCount').textContent, 'No learners selected');
});

test('active individual assignments remain visible but unavailable for another individual assignment', async () => {
  const h = harness({ get: url => url.startsWith('/api/v1/sponsorships/learners?') ? { ok: true, data: [learner(7, { has_active_individual_sponsorship: true })], meta: { total: 1, per_page: 10 } } : undefined }); await h.newLinked(); await h.lookup('learner');
  assert.match(h.ids.get('learnerMatches').innerHTML, /Already has active individual support/); assert.equal(h.ids.get('learnerMatches').querySelector('[data-pick]').disabled, true);
  h.pick('learner', 7); assert.equal(h.ids.get('learnerSelectionCount').textContent, 'No learners selected');
});

test('group membership accepts active individual support without adding duplicate members', async () => {
  const h = harness({ get: url => url.startsWith('/api/v1/sponsorships/learners?') ? { ok: true, data: [learner(7, { has_active_individual_sponsorship: true })], meta: { total: 1, per_page: 10 } } : undefined }); const form = await h.newLinked();
  form.elements.sponsorship_type.value = 'group'; form.elements.sponsorship_type.listeners.change(); await h.lookup('learner');
  assert.equal(h.ids.get('learnerMatches').querySelector('[data-pick]').disabled, false); h.pick('learner', 7); h.pick('learner', 7);
  assert.equal(h.ids.get('learnerSelectionCount').textContent, '1 learner selected'); assert.equal(h.ids.get('learnerMatches').querySelector('[data-pick]').getAttribute('aria-pressed'), 'true');
  form.elements.start_date.value = '2026-10-14'; await h.submit(); assert.deepEqual(h.writes[0].body.student_ids, [7]); assert.equal('student_id' in h.writes[0].body, false);
});

test('individual selection replaces the previous choice and removing it updates the selection count', async () => {
  const h = harness({ get: url => url.startsWith('/api/v1/sponsorships/learners?') ? { ok: true, data: [learner(7), learner(8)], meta: { total: 2, per_page: 10 } } : undefined }); await h.newLinked(); await h.lookup('learner'); h.pick('learner', 7); h.pick('learner', 8);
  assert.match(h.ids.get('learnerSelected').innerHTML, /Synthetic 8/); assert.doesNotMatch(h.ids.get('learnerSelected').innerHTML, /Synthetic 7/); assert.equal(h.ids.get('learnerSelectionCount').textContent, '1 learner selected');
  h.ids.get('learnerSelected').querySelector('[data-remove]').listeners.click(); assert.equal(h.ids.get('learnerSelectionCount').textContent, 'No learners selected');
  assert.equal(h.ids.get('learnerMatches').querySelector('[data-pick="8"]').getAttribute('aria-pressed'), 'false');
});

test('school-wide creation hides the entire learner picker and retains programme-only fields', async () => {
  const h = harness(); const form = await h.newLinked();
  form.elements.sponsorship_type.value = 'school_wide'; form.elements.sponsorship_type.listeners.change();
  assert.equal(h.ids.get('learnerPicker').hidden, true); assert.equal(form.elements.program_name.required, true); assert.equal(form.elements.program_name.disabled, false);
  form.elements.sponsorship_type.value = 'group'; form.elements.sponsorship_type.listeners.change(); assert.equal(h.ids.get('learnerPicker').hidden, false);
});

test('missing learner selections show focused actionable feedback without creating a record', async () => {
  const h = harness(); const form = await h.newLinked(); form.elements.start_date.value = '2026-10-14'; await h.submit();
  assert.equal(h.writes.length, 0); assert.match(h.ids.get('spFormAlert').innerHTML, /Search and select the learner/); assert.equal(h.ids.get('learnerLookup').getAttribute('aria-invalid'), 'true');
  assert.equal(h.document.activeElement, h.ids.get('spFormAlert'));
});

test('invalid dates, reversed end dates and blank programme names receive inline errors', async () => {
  const h = harness(); const form = await h.newLinked(); form.elements.sponsorship_type.value = 'school_wide'; form.elements.sponsorship_type.listeners.change();
  form.elements.program_name.value = ' '; form.elements.start_date.value = '2026-02-30'; form.elements.end_date.value = '2025-01-01'; await h.submit();
  for (const name of ['program_name', 'start_date', 'end_date']) assert.equal(form.elements[name].getAttribute('aria-invalid'), 'true');
  assert.equal(h.writes.length, 0); assert.equal(h.modals[0].closed, false);
});

test('duplicate assignment feedback retains the draft and restores lookup buttons and fields', async () => {
  const h = harness({ post: () => ({ ok: false, status: 409, error: '<Already sponsored>' }) }); const form = await h.newLinked(); await h.lookup('learner'); h.pick('learner', 7); form.elements.start_date.value = '2026-10-14'; await h.submit();
  assert.match(h.ids.get('spFormAlert').innerHTML, /&lt;Already sponsored&gt;.*existing sponsor or learner assignment/);
  assert.match(h.ids.get('learnerSelected').innerHTML, /Synthetic 7/); assert.equal(form.elements.start_date.value, '2026-10-14');
  assert.equal(h.ids.get('learnerFind').disabled, false); assert.equal(h.ids.get('learnerLookup').disabled, false); assert.equal(form.elements.program_name.disabled, true); assert.equal(h.modals[0].closed, false);
});

test('pending confirmation locks submitted fields and prevents changes to selected relationships', async () => {
  let finish; const h = harness({ confirm: () => new Promise(resolve => { finish = resolve; }) }); const form = await h.newLinked(); await h.lookup('learner'); h.pick('learner', 7); form.elements.start_date.value = '2026-10-14';
  const pending = h.submit(); assert.equal(form.elements.start_date.disabled, true); assert.equal(h.ids.get('learnerFind').disabled, true);
  h.ids.get('learnerSelected').querySelector('[data-remove]').listeners.click(); assert.match(h.ids.get('learnerSelected').innerHTML, /Synthetic 7/);
  await h.submit(); assert.equal(h.confirmations.length, 1); finish(false); await pending;
  assert.equal(h.ids.get('learnerFind').disabled, false); assert.equal(form.elements.start_date.disabled, false); assert.equal(h.writes.length, 0);
});

test('an authentication change during creation confirmation prevents the mutation', async () => {
  let finish; const h = harness({ confirm: () => new Promise(resolve => { finish = resolve; }) }); const form = await h.newLinked(); await h.lookup('learner'); h.pick('learner', 7); form.elements.start_date.value = '2026-10-14';
  const pending = h.submit(); h.changeToken(); finish(true); await pending; assert.equal(h.writes.length, 0); assert.equal(h.notices.length, 0);
});

test('stale directory and summary responses cannot render another session’s sponsorship records', async () => {
  const finish = {}; const h = harness({ get: url => new Promise(resolve => { finish[url.endsWith('/summary') ? 'summary' : 'directory'] = resolve; }) });
  h.changeToken(); finish.directory({ ok: true, data: [sponsor], meta: { total: 1, per_page: 15 } }); finish.summary({ ok: true, data: summary }); await flush();
  assert.doesNotMatch(h.ids.get('spResults').innerHTML, /Synthetic Sponsor/); assert.doesNotMatch(h.ids.get('spSummary').innerHTML, /class="num">1/);
});

test('stale scoped learner response cannot repaint a previously authenticated detail dialog', async () => {
  let finish; const h = harness({ hash: '#sponsorships', get: url => url === '/api/v1/sponsorships/9/learners/7' ? new Promise(resolve => { finish = resolve; }) : undefined }); await flush();
  await h.ids.get('spResults').querySelector('[data-view]').listeners.click(); const pending = h.modals[0].body.querySelector('[data-scoped-learner]').listeners.click(); h.changeToken(); finish({ ok: true, data: learner() }); await pending;
  assert.doesNotMatch(h.modals[1].body.innerHTML, /S-7|Fixture class/);
});

test('pending status updates lock competing edit/end actions and cancellation restores them', async () => {
  let finish; const h = harness({ hash: '#sponsorships', confirm: () => new Promise(resolve => { finish = resolve; }) }); await flush();
  const result = h.ids.get('spResults'); const pending = result.querySelector('[data-status]').listeners.click();
  assert.equal(result.querySelector('[data-edit-item]').disabled, true); assert.equal(result.querySelector('[data-end]').disabled, true);
  await result.querySelector('[data-edit-item]').listeners.click(); result.querySelector('[data-end]').listeners.click(); assert.equal(h.modals.length, 0);
  finish(false); await pending; assert.equal(result.querySelector('[data-edit-item]').disabled, false); assert.equal(h.writes.length, 0);
});

test('ending validates the start-date boundary and never offers membership reassignment', async () => {
  const h = harness({ hash: '#sponsorships' }); await flush(); h.ids.get('spResults').querySelector('[data-end]').listeners.click(); const form = h.ids.get('spForm');
  form.elements.end_date.value = '2025-12-31'; form.elements.notes.value = 'Synthetic reason'; await h.submit();
  assert.equal(form.elements.end_date.getAttribute('aria-invalid'), 'true'); assert.equal(h.writes.length, 0); assert.equal(form.elements.student_ids, undefined);
});

test('sponsorship styling supports the shared themes, mobile cards and touch-sized keyboard controls', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../public/sponsorship.html'), 'utf8'); const css = fs.readFileSync(path.resolve(__dirname, '../../public/assets/sponsorship.css'), 'utf8');
  assert.match(html, /assets\/sponsorship.css/); assert.match(html, /script defer src="https:\/\/unpkg/);
  assert.match(css, /max-width: 900px/); assert.match(css, /max-width: 640px/); assert.match(css, /var\(--touch-target\)/); assert.match(css, /var\(--teal-light\)/); assert.match(css, /td\[data-label\]::before/);
});
