const { test } = require('node:test');
const assert = require('node:assert/strict');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ role = 'teacher', get, post, download } = {}) {
  const h = createDOM(role, '/records-of-work.html');
  const requests = [], writes = [], toasts = [], confirmations = [], exports = [];
  const leader = ['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(role);
  const assignment = { id: 11, class_id: 2, subject_id: 3, term_id: 4,
    school_class: { id: 2, name: '<Class>' }, subject: { id: 3, name: '<Area>', status: 'active' },
    staff: { id: 5, first_name: 'Assigned', last_name: 'Teacher' },
    term: { id: 4, name: '<Term>', academic_year: { id: 1, name: '<Year>' } } };
  const record = {
    id: 15, class_subject_teacher_id: 11, lesson_plan_id: null, taught_on: '2026-02-03',
    content_covered: '<Content covered>', learning_activities_conducted: '<Activities conducted>',
    work_completed: '<Work completed>', work_not_completed: null, reasons_for_deviations: null,
    teacher_observations: '<Observations>', follow_up_actions: null, status: 'draft', review_notes: null,
    assignment, lesson_plan: null,
  };
  const context = { scope: leader ? 'school' : 'assigned', assignments: [assignment],
    lesson_plans: [{ id: 7, title: '<Plan>', lesson_date: '2026-02-03', class_subject_teacher_id: 11 }] };
  h.app.get = async url => {
    requests.push(url);
    if (get) { const response = await get(url); if (response !== undefined) return response; }
    if (url.endsWith('/context')) return { ok: true, data: context };
    if (url.startsWith('/api/v1/records-of-work/15')) return { ok: true, data: record };
    return { ok: true, data: [record] };
  };
  h.app.post = async (url, body) => { writes.push({ url, body: structuredClone(body) }); return post ? post(url, body) : { ok: true, data: { ...record, ...body, id: 15 } }; };
  h.app.patch = async (url, body) => { writes.push({ url, body: structuredClone(body) }); return { ok: true, data: { ...record, ...body } }; };
  h.app.download = async url => { exports.push(url); return download ? download(url) : { ok: true }; };
  h.app.toast = (...args) => toasts.push(args);
  h.app.confirmAction = async (...args) => { confirmations.push(args); return true; };
  h.run('records-of-work.js');
  const press = (action, id = '15') => h.ids.get('appMain').listeners.click({ target: { closest: () => ({ disabled: false, dataset: { id, recordAction: action } }) } });
  return { ...h, requests, writes, toasts, confirmations, exports, press, record, context, leader };
}

test('teacher record workspace records explicit delivery only and escapes recorded content', async () => {
  const h = harness(); await flush();
  assert.deepEqual(h.requests, ['/api/v1/records-of-work/context', '/api/v1/records-of-work']);
  const html = h.ids.get('recordList').innerHTML;
  assert.match(html, /&lt;Content covered&gt;|&lt;Class&gt;/);
  assert.doesNotMatch(html, /<Content covered>|<Class>/);
  assert.match(html, /Unplanned lesson/);
  assert.match(h.ids.get('appMain').innerHTML, /never records delivery/);
  assert.doesNotMatch(html, /data-record-action="approve"|data-record-action="return"/);
});

test('record filters teach-on dates as server parameters', async () => {
  const h = harness(); await flush();
  h.ids.get('recordTerm').value = '4'; h.ids.get('recordTerm').listeners.change({ target: h.ids.get('recordTerm') }); await flush();
  h.ids.get('recordTo').value = '2026-02-28'; h.ids.get('recordTo').listeners.change({ target: h.ids.get('recordTo') }); await flush();
  assert.match(h.requests.at(-1), /\/api\/v1\/records-of-work\?term_id=4&to=2026-02-28/);
});

test('leadership review controls appear only for submitted records of work', async () => {
  const submitted = { id: 15, class_subject_teacher_id: 11, taught_on: '2026-02-04', status: 'submitted',
    content_covered: 'Covered', learning_activities_conducted: 'Conducted', work_completed: 'Completed',
    teacher_observations: 'Observed', assignment: { id: 11, school_class: { name: 'Class' }, subject: { name: 'Area' }, term: { name: 'Term', academic_year: { name: '2026' } } },
    lesson_plan: { id: 7, title: 'Linked plan', lesson_date: '2026-02-03' } };
  const h = harness({ role: 'deputy_head_teacher', get: async url => url.endsWith('/records-of-work') ? { ok: true, data: [submitted] } : undefined });
  await flush();
  assert.match(h.ids.get('recordList').innerHTML, /data-record-action="approve"/);
  assert.match(h.ids.get('recordList').innerHTML, /Linked plan/);
  assert.doesNotMatch(h.ids.get('recordList').innerHTML, /data-record-action="submit"/);
});

test('record detail reports deviations and follow-up honestly and exports a scoped PDF', async () => {
  const h = harness(); await flush();
  h.press('view'); await flush();
  const detail = h.ids.get('recordDetail').innerHTML;
  for (const heading of ['Content covered', 'Learning activities conducted', 'Work completed', 'Work not completed', 'Reasons for deviations', 'Teacher observations', 'Follow-up actions']) assert.match(detail, new RegExp(heading));
  assert.match(detail, /None recorded/);
  assert.match(detail, /Actual teaching date/);
  h.press('pdf'); await flush();
  assert.deepEqual(h.exports, ['/api/v1/records-of-work/15/pdf']);
});

test('creating a record posts delivered teaching facts and links a permitted lesson plan', async () => {
  const h = harness(); await flush();
  h.ids.get('createRecord').listeners.click({ currentTarget: h.ids.get('createRecord') });
  h.ids.get('record_class_subject_teacher_id').value = '11';
  h.ids.get('record_lesson_plan_id').value = '7';
  const values = { record_taught_on: '2026-02-04', record_content_covered: 'Covered', record_learning_activities_conducted: 'Conducted',
    record_work_completed: 'Completed', record_work_not_completed: 'Exercise 3', record_reasons_for_deviations: 'Time',
    record_teacher_observations: 'Observed', record_follow_up_actions: 'Review next lesson' };
  for (const [id, value] of Object.entries(values)) h.ids.get(id).value = value;
  h.modals[0].overlay.querySelector('#saveRecord').listeners.click();
  await flush();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].url, '/api/v1/records-of-work');
  assert.equal(h.writes[0].body.class_subject_teacher_id, '11');
  assert.equal(h.writes[0].body.lesson_plan_id, '7');
  assert.equal(h.writes[0].body.taught_on, '2026-02-04');
  assert.equal(h.modals[0].closed, true);
});

test('server validation errors remain on the open record dialog', async () => {
  const h = harness({ post: async () => ({ ok: false, status: 422, error: '<Invalid>', fields: { taught_on: ['Outside the assigned term.'] } }) }); await flush();
  h.ids.get('createRecord').listeners.click({ currentTarget: h.ids.get('createRecord') });
  h.ids.get('record_class_subject_teacher_id').value = '11';
  ['record_taught_on', 'record_content_covered', 'record_learning_activities_conducted', 'record_work_completed', 'record_teacher_observations']
    .forEach(id => { h.ids.get(id).value = 'Value'; });
  h.modals[0].overlay.querySelector('#saveRecord').listeners.click();
  await flush();
  assert.equal(h.modals[0].closed, false);
  assert.match(h.modals[0].body.innerHTML, /data-form-error|taught_on/);
});

test('unavailable context and incomplete lists show retryable errors without invented records', async () => {
  const failed = harness({ get: async url => url.endsWith('/context') ? { ok: false, status: 503, error: '<Unavailable>' } : undefined }); await flush();
  assert.match(failed.ids.get('recordList').innerHTML, /&lt;Unavailable&gt;/);
  failed.ids.get('recordList').querySelector('[data-retry]').listeners.click(); await flush();
  assert.equal(failed.requests.length, 2);

  const malformed = harness({ get: async url => url.endsWith('/records-of-work') ? { ok: true, data: [{ id: 15, taught_on: '2026-02-03' }] } : undefined }); await flush();
  assert.match(malformed.ids.get('recordList').innerHTML, /incomplete|Try again/i);
  assert.equal(malformed.ids.get('recordCount').innerHTML, '');
  assert.equal(malformed.ids.get('createRecord').disabled, false);
});

test('portal sponsor coordinator and student roles never load records of work', () => {
  for (const role of ['parent_guardian', 'sponsor', 'student', 'sponsor_coordinator']) {
    const h = harness({ role });
    assert.deepEqual(h.requests, []);
    assert.equal(h.ids.has('appMain'), false);
    assert.equal(h.writes.length, 0);
  }
});
