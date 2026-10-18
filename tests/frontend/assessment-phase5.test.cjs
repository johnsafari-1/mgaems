// Synthetic API/DOM checks only; this suite never contacts the school application.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixtures(role) {
  const term = { id: 11, name: 'First Term', academic_year_id: 1, is_current: true, academic_year: { id: 1, name: '2026' } };
  const other = { id: 12, name: 'Second Term', academic_year_id: 1, academic_year: term.academic_year };
  const classroom = { id: 2, name: 'Grade Six' }, subject = { id: 20, name: 'Mathematics', status: 'active' };
  const context = { scope: ['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(role) ? 'school' : 'assigned', assignments: [{ term_id: 11, class_id: 2, subject_id: 20, term, school_class: classroom, subject }], terms: [term, other], classes: [classroom], subjects: [subject], offerings: [{ class_id: 2, subject_id: 20 }], assessment_types: ['continuous', 'end_term'], competency_ratings: ['Exceeding <expectation>', 'Meeting expectation'] };
  const learners = [{ id: 3, first_name: 'Amina', last_name: 'Learner', admission_no: 'SYN-3', editable: true, context_state: 'current', assessment: { score: '42.00', competency_rating: 'Exceeding <expectation>', remarks: 'Saved remark', revision_number: 3 } }, { id: 4, first_name: 'Brian', last_name: 'Learner', admission_no: 'SYN-4', editable: true, context_state: 'current', assessment: null }, { id: 5, first_name: 'Previous', last_name: 'Context', admission_no: 'SYN-5', editable: false, context_state: 'historical_context_conflict', assessment: null }];
  const card = { id: 7, student_id: 3, term_id: 11, student: { first_name: 'Amina', last_name: 'Learner', admission_no: 'SYN-3' }, term: { name: 'First Term' }, revision_number: 2, generated_at: '2026-10-12T21:30:00Z', history_state: 'versioned', download_available: true, overall_remark: 'Saved report remark' };
  return { context, learners, card };
}
function harness({ role = 'teacher', get, post, data = fixtures(role) } = {}) {
  const h = createDOM(role), requests = [], writes = [], errors = [], downloads = [], confirmations = [];
  h.app.get = async url => {
    requests.push(url); if (get) { const result = await get(url); if (result !== undefined) return result; }
    if (url.endsWith('/context')) return { ok: true, data: structuredClone(data.context) };
    if (url.includes('/learners?')) return { ok: true, data: structuredClone(data.learners) };
    if (url.startsWith('/api/v1/students?')) return { ok: true, data: [{ id: 3, first_name: 'Amina', last_name: 'Learner', admission_no: 'SYN-3' }], meta: { total: 1 } };
    if (url.startsWith('/api/v1/report-cards?')) return { ok: true, data: structuredClone(data.card) };
    return { ok: true, data: [], meta: { total: 0, per_page: 25 } };
  };
  h.app.post = async (url, body) => { writes.push({ url, body: structuredClone(body) }); return post ? post(url, body) : { ok: true, data: { ...body, revision_number: 4 }, meta: { operation: 'corrected' } }; };
  h.app.toast = () => {}; h.app.showFormErrors = (form, result) => { errors.push(result); form.querySelector('[data-form-error]').textContent = result.error; };
  h.app.download = async (...args) => { downloads.push(args); return { ok: true }; };
  h.app.confirmAction = async (...args) => { confirmations.push(args); return true; };
  h.run('report-history.js'); h.run('assessment.js');
  return { ...h, data, requests, writes, errors, downloads, confirmations,
    async change(id, value, name = 'change') { const control = h.ids.get(id); control.value = value; await control.listeners[name]({ target: control }); await settle(); },
    async load() { await settle(); await this.change('assessmentClass', '2'); await this.change('assessmentSubject', '20'); h.ids.get('contextForm').listeners.submit({ preventDefault() {} }); await settle(); },
    edit(id, value) { const control = h.ids.get(id); control.value = value; control.listeners.input(); },
    async report() { await settle(); await this.change('reportClass', '2'); await this.change('reportLearner', '3'); },
  };
}

test('entry headings identify the authorized year, term, class, area and assessment type', async () => {
  const h = harness(); await h.load(); const html = h.ids.get('rosterArea').innerHTML;
  assert.match(html, /2026 · First Term · Grade Six · Mathematics · Continuous/);
  assert.match(html, /Admission: SYN-3/); assert.match(html, /Score \(0–100\)|Performance Level|Remarks/);
  assert.match(h.ids.get('contextArea').innerHTML, /Subject Teacher assignments|Class Teacher ownership alone does not grant assessment rights/);
});
test('missing results remain not recorded and historical-context rows stay read-only', async () => {
  const h = harness(); await h.load(); assert.match(h.ids.get('rosterArea').innerHTML, /Not recorded/);
  assert.equal(h.ids.get('score_1').value, ''); assert.equal(h.ids.get('score_2').disabled, true);
  assert.match(h.ids.get('rosterArea').innerHTML, /Historical class context conflict/);
});
test('undoing normalized score and trimmed remark changes removes dirty state', async () => {
  const h = harness(); await h.load(); h.edit('score_0', '99'); assert.match(h.ids.get('assessmentSaveSummary').textContent, /1 unsaved/);
  h.edit('score_0', '42'); h.edit('remarks_0', ' Saved remark '); assert.equal(h.ids.get('saveModified').disabled, true);
  assert.match(h.ids.get('rowState_0').textContent, /Saved revision 3/);
});
test('beforeunload warns only while draft results are unsaved', async () => {
  const h = harness(); await h.load(); let blocked = 0; const event = { preventDefault() { blocked++; } };
  h.events.beforeunload[0](event); assert.equal(blocked, 0); h.edit('score_0', '80'); h.events.beforeunload[0](event); assert.equal(blocked, 1);
  h.edit('score_0', '42'); h.events.beforeunload[0](event); assert.equal(blocked, 1);
});
test('invalid score has linked inline feedback and cannot be sent', async () => {
  const h = harness(); await h.load(); h.edit('score_0', '101'); await h.ids.get('saveRow_0').listeners.click();
  assert.equal(h.writes.length, 0); assert.equal(h.ids.get('score_0').getAttribute('aria-invalid'), 'true');
  assert.match(h.ids.get('scoreError_0').textContent, /0 to 100/); assert.equal(h.ids.get('score_0').getAttribute('aria-describedby'), 'scoreError_0');
});
test('score zero and performance-level-only results remain valid', async () => {
  const h = harness(); await h.load(); h.edit('score_1', '0'); await h.ids.get('saveRow_1').listeners.click();
  assert.equal(h.writes[0].body.score, 0); assert.equal(h.writes[0].body.expected_revision, 0);
  h.edit('score_1', ''); h.edit('level_1', 'Meeting expectation'); await h.ids.get('saveRow_1').listeners.click();
  assert.equal(h.writes[1].body.score, null); assert.equal(h.writes[1].body.competency_rating, 'Meeting expectation');
});
test('unapproved performance values and oversized remarks are refused', async () => {
  const h = harness(); await h.load(); h.edit('level_0', 'Invented level'); await h.ids.get('saveRow_0').listeners.click();
  assert.equal(h.writes.length, 0); assert.equal(h.ids.get('level_0').getAttribute('aria-invalid'), 'true');
  h.edit('level_0', 'Meeting expectation'); h.edit('remarks_0', 'x'.repeat(1001)); await h.ids.get('saveRow_0').listeners.click();
  assert.equal(h.writes.length, 0); assert.match(h.ids.get('remarksError_0').textContent, /1,000/);
});
test('pending saves lock textareas and context, show progress, and reject duplicate submissions', async () => {
  const wait = pending(), h = harness({ post: () => wait.promise }); await h.load(); h.edit('score_0', '80');
  const saving = h.ids.get('saveRow_0').listeners.click(); await settle(); assert.equal(h.ids.get('remarks_0').disabled, true); assert.equal(h.ids.get('assessmentClass').disabled, true);
  assert.match(h.ids.get('rowState_0').textContent, /Saving/); await h.ids.get('saveRow_0').listeners.click(); assert.equal(h.writes.length, 1);
  wait.resolve({ ok: true, data: { ...h.writes[0].body, revision_number: 4 }, meta: { operation: 'corrected' } }); await saving;
  assert.equal(h.ids.get('remarks_0').disabled, false); assert.match(h.ids.get('assessmentSaveSummary').textContent, /No unsaved/);
});
test('server field errors preserve drafts and attach to the matching controls', async () => {
  const h = harness({ post: async () => ({ ok: false, status: 422, error: 'Validation failed', fields: { score: ['Server score rule'], competency_rating: ['Server level rule'] } }) }); await h.load(); h.edit('score_0', '80'); await h.ids.get('saveRow_0').listeners.click();
  assert.equal(h.ids.get('score_0').value, '80'); assert.match(h.ids.get('scoreError_0').textContent, /Server score rule/);
  assert.match(h.ids.get('levelError_0').textContent, /Server level rule/); assert.equal(h.ids.get('saveRow_0').disabled, false);
});
test('revision conflicts retain drafts and refuse automatic or repeat writes until reload', async () => {
  const h = harness({ post: async () => ({ ok: false, status: 409, error: '<Concurrent correction>' }) }); await h.load(); h.edit('score_0', '80');
  await h.ids.get('saveRow_0').listeners.click(); await h.ids.get('saveModified').listeners.click(); h.edit('score_0', '81'); await h.ids.get('saveRow_0').listeners.click();
  assert.equal(h.writes.length, 1); assert.equal(h.ids.get('score_0').value, '81'); assert.match(h.ids.get('rowState_0').innerHTML, /&lt;Concurrent correction&gt;|Your draft is retained|Reload saved results/);
  assert.equal(h.ids.get('saveRow_0').disabled, true); assert.equal(h.ids.get('saveRow_0').textContent, 'Reload required'); assert.equal(h.ids.get('saveModified').disabled, true);
  h.edit('score_1', '50'); assert.equal(h.ids.get('saveModified').disabled, false); h.edit('score_1', ''); assert.equal(h.ids.get('saveModified').disabled, true);
  h.app.confirmAction = async () => false; await h.ids.get('reloadResults').listeners.click(); assert.equal(h.ids.get('score_0').value, '81');
  h.app.confirmAction = async () => true; await h.ids.get('reloadResults').listeners.click(); assert.equal(h.ids.get('score_0').value, '42.00');
});
test('batch saving preserves failed rows and marks only successful rows saved', async () => {
  const h = harness({ post: async (url, body) => body.student_id === 3 ? { ok: true, data: { ...body, revision_number: 4 }, meta: { operation: 'corrected' } } : { ok: false, status: 503, error: 'Retry later' } });
  await h.load(); h.edit('score_0', '80'); h.edit('score_1', '50'); await h.ids.get('saveModified').listeners.click();
  assert.equal(h.writes.length, 2); assert.equal(h.ids.get('saveRow_0').disabled, true); assert.equal(h.ids.get('saveRow_1').disabled, false);
  assert.match(h.ids.get('assessmentSaveSummary').textContent, /1 unsaved/); assert.equal(h.ids.get('score_1').value, '50');
});
test('declined context discard restores the selector and retains the draft', async () => {
  const h = harness(); await h.load(); h.edit('score_0', '80'); h.app.confirmAction = async () => false;
  await h.change('assessmentClass', ''); assert.equal(h.ids.get('assessmentClass').value, '2'); assert.equal(h.ids.get('score_0').value, '80'); assert.equal(h.writes.length, 0);
});
test('no Subject Teacher assignment gives an explicit scope empty state and no class choices', async () => {
  const data = fixtures('teacher'); data.context.assignments = []; const h = harness({ data }); await settle();
  assert.match(h.ids.get('contextArea').innerHTML, /No subject-teacher assignments/); assert.equal(h.ids.get('assessmentClass').children.length, 1);
});
test('empty, loading and failed assessment rosters are explicit and retryable', async () => {
  const wait = pending(); let response = wait.promise; const h = harness({ get: url => url.includes('/learners?') ? response : undefined });
  await h.load(); assert.match(h.ids.get('rosterArea').innerHTML, /Loading authorized learners/); assert.equal(h.ids.get('rosterArea').getAttribute('aria-busy'), 'true');
  wait.resolve({ ok: false, error: '<Unavailable>' }); await settle(); assert.match(h.ids.get('rosterArea').innerHTML, /&lt;Unavailable&gt;|Try again/);
  response = { ok: true, data: [] }; await h.ids.get('rosterArea').querySelector('[data-retry]').listeners.click(); assert.match(h.ids.get('rosterArea').innerHTML, /No active learners/);
});
test('saved-results history shows loading before empty or error feedback', async () => {
  const wait = pending(), h = harness({ get: url => url.startsWith('/api/v1/assessments?') ? wait.promise : undefined }); await settle();
  assert.match(h.ids.get('historyArea').innerHTML, /Loading permitted saved results/); wait.resolve({ ok: false, error: '<History failure>' }); await settle();
  assert.match(h.ids.get('historyArea').innerHTML, /&lt;History failure&gt;|Try again/);
});
test('report generation and school revision access remain leadership-only', async () => {
  const teacher = harness(); await settle(); assert.equal(teacher.ids.has('assessmentTab_reports'), false); assert.equal(teacher.ids.has('reportClass'), false); assert.equal(teacher.requests.some(url => url.startsWith('/api/v1/report-cards')), false);
  for (const role of ['system_admin', 'head_teacher', 'deputy_head_teacher']) { const h = harness({ role }); await settle(); assert.equal(h.ids.has('reportClass'), true); }
});
test('report selectors distinguish term/year and learner/admission identifiers', async () => {
  const h = harness({ role: 'head_teacher' }); await h.report(); assert.match(h.ids.get('reportFilters').innerHTML, /First Term · 2026|Learner and admission number/);
  assert.match(h.ids.get('reportLearner').innerHTML, /Amina Learner · SYN-3/); assert.equal(h.ids.get('reportTerm').value, '11');
});
test('report status uses generated metadata and PDF availability without inventing a draft flag', async () => {
  const data = fixtures('head_teacher'); data.card.download_available = false; data.card.file_path = 'private/must-not-render.pdf'; data.card.history_state = 'legacy_artifact';
  const h = harness({ role: 'head_teacher', data }); await h.report(); const html = h.ids.get('reportArea').innerHTML;
  assert.match(html, /PDF unavailable|Legacy artifact|original source snapshot unknown/); assert.equal(h.ids.has('downloadReport'), false);
  assert.doesNotMatch(html, /Draft|is_published|file_path|must-not-render/);
});
test('report timestamps use school timezone and missing report generation remains explicit', async () => {
  const h = harness({ role: 'head_teacher' }); await h.report(); assert.match(h.ids.get('reportArea').innerHTML, /13 Oct 2026|Nairobi/);
  const data = fixtures('head_teacher'); data.card = null; const empty = harness({ role: 'head_teacher', data }); await empty.report();
  assert.match(empty.ids.get('reportArea').innerHTML, /No report generated|Not generated|meaningful saved results/); assert.equal(empty.ids.has('reportHistory'), false);
});
test('stale report lookup cannot show another learner after class selection clears', async () => {
  const wait = pending(), h = harness({ role: 'head_teacher', get: url => url.startsWith('/api/v1/report-cards?') ? wait.promise : undefined }); await h.report();
  assert.match(h.ids.get('reportArea').innerHTML, /Loading the selected learner/); await h.change('reportClass', '');
  wait.resolve({ ok: true, data: { ...h.data.card, student: { first_name: 'Stale secret', last_name: '' } } }); await settle();
  assert.doesNotMatch(h.ids.get('reportArea').innerHTML, /Stale secret/); assert.equal(h.ids.has('publishReport'), false);
});
test('stale class learner response cannot repopulate a cleared selector', async () => {
  const wait = pending(), h = harness({ role: 'head_teacher', get: url => url.startsWith('/api/v1/students?') ? wait.promise : undefined }); await settle();
  await h.change('reportClass', '2'); await h.change('reportClass', ''); wait.resolve({ ok: true, data: [{ id: 99, first_name: 'Stale learner' }], meta: { total: 1 } }); await settle();
  assert.doesNotMatch(h.ids.get('reportLearner').innerHTML, /Stale learner/); assert.equal(h.ids.get('reportLearner').disabled, true);
});
test('missing class learners and failed report lookups keep useful empty and retry states', async () => {
  const empty = harness({ role: 'head_teacher', get: url => url.startsWith('/api/v1/students?') ? { ok: true, data: [], meta: { total: 0 } } : undefined }); await settle(); await empty.change('reportClass', '2');
  assert.match(empty.ids.get('reportArea').innerHTML, /No learners on this page/);
  const failed = harness({ role: 'head_teacher', get: url => url.startsWith('/api/v1/report-cards?') ? { ok: false, error: '<Report failure>' } : undefined }); await failed.report();
  assert.match(failed.ids.get('reportArea').innerHTML, /&lt;Report failure&gt;|Try again/);
});
test('download feedback prevents duplicate requests and keeps failures visible for retry', async () => {
  const h = harness({ role: 'head_teacher' }); await h.report(); const wait = pending(); let count = 0;
  h.app.download = async url => { count++; assert.equal(url, '/api/v1/report-cards/7/download'); return wait.promise; };
  const downloading = h.ids.get('downloadReport').listeners.click(); await h.ids.get('downloadReport').listeners.click(); assert.equal(count, 1);
  wait.resolve({ ok: false, error: 'PDF could not be read' }); await downloading; assert.match(h.ids.get('reportDownloadFeedback').textContent, /PDF could not be read/); assert.equal(h.ids.get('downloadReport').disabled, false);
});
test('generation rejects a stale modal selection without writing', async () => {
  const h = harness({ role: 'head_teacher' }); await h.report(); h.ids.get('publishReport').listeners.click(); const modal = h.modals.at(-1);
  await h.change('reportTerm', '12'); await modal.body.querySelector('form').listeners.submit({ preventDefault() {} });
  assert.equal(h.writes.length, 0); assert.match(h.errors.at(-1).error, /selection|term changed/); assert.equal(modal.closed, false);
});
test('generation locks report selections and duplicate submits, preserving remark on failure', async () => {
  const wait = pending(), h = harness({ role: 'head_teacher', post: () => wait.promise }); await h.report(); h.ids.get('publishReport').listeners.click(); const modal = h.modals.at(-1), form = modal.body.querySelector('form');
  form.elements.overall_remark.value = 'Synthetic revision remark'; const saving = form.listeners.submit({ preventDefault() {} }); await settle(); await form.listeners.submit({ preventDefault() {} });
  assert.equal(h.writes.length, 1); assert.equal(h.ids.get('reportClass').disabled, true); assert.equal(h.ids.get('reportTerm').disabled, true);
  assert.deepEqual(h.writes[0], { url: '/api/v1/students/3/report-cards/generate', body: { term_id: 11, overall_remark: 'Synthetic revision remark' } });
  wait.resolve({ ok: false, error: 'No saved results' }); await saving; assert.equal(modal.closed, false); assert.equal(form.elements.overall_remark.value, 'Synthetic revision remark'); assert.equal(h.ids.get('reportTerm').disabled, false);
});
test('keyboard section tabs retain selection and panel semantics', async () => {
  const h = harness(); await settle(); const tab = h.ids.get('assessmentTab_entry'); let prevented = false;
  tab.listeners.keydown({ key: 'End', preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.equal(h.document.activeElement, h.ids.get('assessmentTab_history'));
  assert.equal(h.ids.get('assessmentPanel_entry').hidden, true); assert.equal(h.ids.get('assessmentTab_history').getAttribute('aria-selected'), 'true');
});
test('dedicated assessment CSS supplies responsive row labels, focus and theme tokens', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../../public/assets/assessment.css'), 'utf8');
  assert.match(css, /max-width: 1000px/); assert.match(css, /max-width: 640px/); assert.match(css, /content: attr\(data-label\)/);
  assert.match(css, /var\(--touch-target\)/); assert.match(css, /focus-visible/); assert.match(css, /var\(--surface\)/);
});
test('malformed or wrong-scope context never creates assessment or report controls', async () => {
  const invalidIdContext = fixtures('teacher').context; invalidIdContext.assignments[0].school_class.id = [2];
  for (const data of [null, {}, { ...fixtures('teacher').context, scope: 'school' }, { ...fixtures('teacher').context, competency_ratings: [] }, invalidIdContext]) {
    const h = harness({ get: url => url.endsWith('/context') ? { ok: true, data } : undefined }); await settle();
    assert.equal(h.ids.has('assessmentClass'), false); assert.equal(h.ids.has('reportClass'), false);
    assert.match(h.ids.get('contextArea').innerHTML, /incomplete|authorized workspace/);
  }
});
test('unreadable request envelope and thrown context request become retry feedback', async () => {
  for (const response of [null, {}]) { const h = harness({ get: url => url.endsWith('/context') ? response : undefined }); await settle(); assert.match(h.ids.get('contextArea').innerHTML, /incomplete|Try again/); }
  const h = harness({ get: url => { if (url.endsWith('/context')) throw new Error('Synthetic network failure'); } }); await settle(); assert.match(h.ids.get('contextArea').innerHTML, /request could not be completed|Try again/);
});
test('malformed or different-class rosters expose no learner entry fields', async () => {
  for (const data of [null, {}, [{ ...fixtures('teacher').learners[0], class_id: 999 }]]) {
    const h = harness({ get: url => url.includes('/learners?') ? { ok: true, data } : undefined }); await h.load();
    assert.equal(h.ids.has('score_0'), false); assert.match(h.ids.get('rosterArea').innerHTML, /incomplete|teaching context/);
  }
});
test('malformed saved history does not claim an empty result set', async () => {
  const h = harness({ get: url => url.startsWith('/api/v1/assessments?') ? { ok: true, data: null, meta: { total: 0, per_page: 25 } } : undefined }); await settle();
  assert.match(h.ids.get('historyArea').innerHTML, /history is incomplete/); assert.doesNotMatch(h.ids.get('historyArea').innerHTML, /No permitted saved results/);
});
test('unverified success response retains dirty results and blocks retries pending reload', async () => {
  const h = harness({ post: async () => ({ ok: true, data: { revision_number: 4, student_id: 999 }, meta: { operation: 'corrected' } }) }); await h.load(); h.edit('score_0', '80');
  await h.ids.get('saveRow_0').listeners.click(); await h.ids.get('saveRow_0').listeners.click(); assert.equal(h.writes.length, 1);
  assert.equal(h.ids.get('score_0').value, '80'); assert.match(h.ids.get('rowState_0').innerHTML, /could not be verified|may already have been saved/);
  assert.equal(h.ids.get('saveRow_0').disabled, true); assert.equal(h.ids.get('saveRow_0').textContent, 'Reload required'); assert.equal(h.ids.get('saveModified').disabled, true);
});
test('unverified class learner response leaves selection disabled rather than faking an empty class', async () => {
  const h = harness({ role: 'head_teacher', get: url => url.startsWith('/api/v1/students?') ? { ok: true, data: {}, meta: { total: 0 } } : undefined }); await settle(); await h.change('reportClass', '2');
  assert.equal(h.ids.get('reportLearner').disabled, true); assert.match(h.ids.get('reportArea').innerHTML, /learner choices are incomplete/);
});
test('wrong learner, wrong term and malformed report responses expose no generation or download actions', async () => {
  for (const card of [{ ...fixtures('head_teacher').card, student_id: 999 }, { ...fixtures('head_teacher').card, term_id: 999 }, { ...fixtures('head_teacher').card, student: { id: 999 } }, {}, []]) {
    const data = fixtures('head_teacher'); data.card = card; const h = harness({ role: 'head_teacher', data }); await h.report();
    assert.match(h.ids.get('reportArea').innerHTML, /incomplete|selected learner and term/); assert.equal(h.ids.has('publishReport'), false); assert.equal(h.ids.has('downloadReport'), false);
  }
});
test('unverified generation response keeps dialog reviewable and prevents a second generation', async () => {
  const h = harness({ role: 'head_teacher', post: async () => ({ ok: true, data: { id: 7, student_id: 999, term_id: 11 } }) }); await h.report();
  h.ids.get('publishReport').listeners.click(); const modal = h.modals.at(-1), form = modal.body.querySelector('form');
  await form.listeners.submit({ preventDefault() {} }); await form.listeners.submit({ preventDefault() {} });
  assert.equal(h.writes.length, 1); assert.equal(modal.closed, false); assert.match(form.querySelector('[data-form-error]').textContent, /may already have been created/);
});
test('successful report generation reloads only the selected learner and term', async () => {
  const h = harness({ role: 'head_teacher', post: async () => ({ ok: true, data: { ...fixtures('head_teacher').card, revision_number: 3 } }) }); await h.report();
  h.ids.get('publishReport').listeners.click(); const modal = h.modals.at(-1); await modal.body.querySelector('form').listeners.submit({ preventDefault() {} }); await settle();
  assert.equal(modal.closed, true); assert.equal(h.requests.filter(url => url.startsWith('/api/v1/report-cards?student_id=3&term_id=11')).length, 2);
});
