const { test } = require('node:test');
const assert = require('node:assert/strict');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ role = 'teacher', get, post } = {}) {
  const h = createDOM(role); const requests = [], writes = [], toasts = [], confirmations = [];
  const term = { id: 1, name: '<Term>', academic_year_id: 17, is_current: true, academic_year: { id: 17, name: '<Year>' } };
  const classroom = { id: 10, name: '<Class>' }, subject = { id: 99, name: '<Area>', status: 'active' };
  const leader = role === 'head_teacher';
  const context = { scope: leader ? 'school' : 'assigned', assignments: leader ? [] : [{ id: 5, class_id: 10, subject_id: 99, term_id: 1, school_class: classroom, subject, term }],
    classes: leader ? [classroom] : [], subjects: leader ? [subject] : [], offerings: [{ id: 8, class_id: 10, subject_id: 99 }], terms: leader ? [term] : [],
    assessment_types: ['continuous', 'end_term'], competency_ratings: ['Backend supplied <level>'] };
  const learners = [
    { id: 3, first_name: '<Learner>', last_name: 'Name', admission_no: '<A3>', editable: true, context_state: 'current', assessment: { id: 100, score: '42.00', competency_rating: 'Backend supplied <level>', remarks: '<Saved remark>', revision_number: 3 } },
    { id: 4, first_name: '<Legacy>', last_name: 'Name', admission_no: 'A4', editable: false, context_state: 'legacy_unresolved', assessment: null },
  ];
  h.app.get = async url => {
    requests.push(url); if (get) { const response = await get(url); if (response) return response; }
    if (url.endsWith('/context')) return { ok: true, data: context };
    if (url.includes('/learners?')) return { ok: true, data: structuredClone(learners) };
    if (url.startsWith('/api/v1/students?')) return { ok: true, data: [{ id: 3, first_name: '<Learner>', last_name: 'Name', admission_no: 'A3' }], meta: { total: 1 } };
    if (url.startsWith('/api/v1/report-cards?')) return { ok: true, data: { id: 7, revision_number: 2, generated_at: '2026-10-06', history_state: 'versioned', download_available: true } };
    return { ok: true, data: [], meta: { page: 1, per_page: 25, total: 0 } };
  };
  h.app.post = async (url, body) => { writes.push({ url, body: structuredClone(body) }); return post ? post(url, body) : { ok: true, data: { ...body, id: 100, revision_number: 4 }, meta: { operation: 'corrected' } }; };
  h.app.toast = (...args) => toasts.push(args); h.app.confirmAction = async (...args) => { confirmations.push(args); return true; };
  h.app.download = async () => ({ ok: true });
  h.run('report-history.js'); h.run('assessment.js');
  return { ...h, requests, writes, toasts, confirmations,
    async select() { await flush(); let control = h.ids.get('assessmentClass'); control.value = '10'; await control.listeners.change({ target: control }); control = h.ids.get('assessmentSubject'); control.value = '99'; await control.listeners.change({ target: control }); },
    async load() { await this.select(); h.ids.get('contextForm').listeners.submit({ preventDefault() {} }); await flush(); },
  };
}

test('assessment uses backend vocabulary, escapes API values, and keeps unresolved teacher rows read-only', async () => {
  const h = harness(); await h.load();
  assert.match(h.ids.get('rosterArea').innerHTML, /Performance Level/);
  assert.match(h.ids.get('rosterArea').innerHTML, /Backend supplied &lt;level&gt;/);
  assert.doesNotMatch(h.ids.get('rosterArea').innerHTML, /CBC Competency Rating|<Learner>|<Saved remark>/);
  assert.equal(h.ids.get('score_1').disabled, true);
  assert.equal(h.ids.get('saveRow_1').disabled, true);
  assert.match(h.ids.get('rowState_1').innerHTML || h.ids.get('rosterArea').innerHTML, /Leadership review required/);
});

test('correction submits the loaded revision and blocks context changes/double saves while pending', async () => {
  let resolve; const h = harness({ post: () => new Promise(done => { resolve = done; }) }); await h.load();
  h.ids.get('score_0').value = '88'; h.ids.get('score_0').listeners.input();
  const first = h.ids.get('saveRow_0').listeners.click(); h.ids.get('saveRow_0').listeners.click(); await flush();
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].body.expected_revision, 3);
  assert.equal(h.writes[0].body.class_id, 10); assert.equal(h.writes[0].body.score, 88);
  assert.equal(h.ids.get('assessmentClass').disabled, true); assert.equal(h.ids.get('remarks_0').disabled, true);
  resolve({ ok: true, data: { id: 100, score: '88.00', revision_number: 4 }, meta: { operation: 'corrected' } }); await first;
  assert.match(h.ids.get('rowState_0').textContent, /Corrected.*revision 4/);
  assert.equal(h.ids.get('score_1').disabled, true); assert.equal(h.ids.get('assessmentClass').disabled, false);
});

test('revision-conflict response retains edits for review and escapes feedback', async () => {
  const h = harness({ post: async () => ({ ok: false, status: 409, error: '<Changed elsewhere>' }) }); await h.load();
  h.ids.get('score_0').value = '90'; h.ids.get('score_0').listeners.input(); await h.ids.get('saveRow_0').listeners.click();
  assert.equal(h.ids.get('score_0').value, '90'); assert.equal(h.ids.get('saveRow_0').disabled, false);
  assert.match(h.ids.get('rowState_0').innerHTML, /&lt;Changed elsewhere&gt;/);
});

test('blank assessment edits are refused locally without inventing a score requirement', async () => {
  const h = harness(); await h.load();
  h.ids.get('score_0').value = ''; h.ids.get('level_0').value = ''; h.ids.get('remarks_0').value = ' '; h.ids.get('score_0').listeners.input();
  await h.ids.get('saveRow_0').listeners.click(); assert.equal(h.writes.length, 0);
  h.ids.get('level_0').value = 'Backend supplied <level>'; h.ids.get('level_0').listeners.input(); await h.ids.get('saveRow_0').listeners.click();
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].body.score, null);
});

test('stale roster responses cannot populate a different teaching context', async () => {
  let resolve; const h = harness({ get: url => url.includes('/learners?') ? new Promise(done => { resolve = done; }) : null });
  await h.select(); h.ids.get('contextForm').listeners.submit({ preventDefault() {} }); await flush();
  const control = h.ids.get('assessmentTerm'); control.value = ''; await control.listeners.change({ target: control });
  resolve({ ok: true, data: [{ id: 900, first_name: 'Stale learner', editable: true }] }); await flush();
  assert.equal(h.ids.has('score_0'), false); assert.doesNotMatch(h.ids.get('rosterArea').innerHTML, /Stale learner/);
});

test('leadership report UI uses availability flags and retained revisions without storage paths', async () => {
  const h = harness({ role: 'head_teacher' }); await flush();
  const classControl = h.ids.get('reportClass'); classControl.value = '10'; classControl.listeners.change(); await flush();
  h.ids.get('reportTerm').value = '1'; h.ids.get('reportLearner').value = '3'; h.ids.get('reportLearner').listeners.change(); await flush();
  assert.match(h.ids.get('reportArea').innerHTML, /Generate new revision|Retained revisions|Download latest PDF/);
  assert.doesNotMatch(h.ids.get('reportArea').innerHTML, /file_path|report-cards\/revisions\//);
  h.ids.get('publishReport').listeners.click();
  assert.match(h.modals.at(-1).body.innerHTML, /Earlier PDFs remain retained|without weighting or precedence/);
});

test('parent/sponsor sessions stay in their portals and do not request staff assessment data', () => {
  for (const role of ['parent_guardian', 'sponsor']) { const h = harness({ role }); assert.equal(h.requests.length, 0); assert.match(h.context.window.location.href, /portal\.html$/); }
});

test('retained report viewer escapes metadata and downloads only through the scoped revision route', async () => {
  const h = harness({ role: 'head_teacher', get: async url => url.includes('/7/revisions?') ? { ok: true, data: [{ id: 77, revision_number: 2, generated_at: '<When>', provenance: '<Legacy>', source_count: null, download_available: true, artifact_path: 'private/should-not-render.pdf' }], meta: { total: 1, per_page: 25 } } : null });
  const downloads = []; h.app.download = async url => { downloads.push(url); return { ok: true }; };
  const modal = h.app.openReportHistory(7); await flush();
  assert.match(modal.body.innerHTML, /&lt;When&gt;|&lt;Legacy&gt;/);
  assert.doesNotMatch(modal.body.innerHTML, /should-not-render|artifact_path/);
  await modal.body.querySelector('[data-download]').listeners.click();
  assert.deepEqual(downloads, ['/api/v1/report-cards/7/revisions/77/download']);
});
