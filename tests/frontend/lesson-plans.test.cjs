const { test } = require('node:test');
const assert = require('node:assert/strict');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ role = 'teacher', get, post, download } = {}) {
  const h = createDOM(role, '/lesson-plans.html');
  const requests = [], writes = [], toasts = [], confirmations = [], exports = [];
  const leader = ['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(role);
  const assignment = { id: 11, class_id: 2, subject_id: 3, term_id: 4,
    school_class: { id: 2, name: '<Class>' }, subject: { id: 3, name: '<Area>', status: 'active' },
    staff: { id: 5, first_name: 'Assigned', last_name: 'Teacher' },
    term: { id: 4, name: '<Term>', academic_year: { id: 1, name: '<Year>' } } };
  const plan = {
    id: 7, class_subject_teacher_id: 11, scheme_of_work_week_id: null, duplicated_from_lesson_plan_id: null,
    title: '<Lesson>', lesson_date: '2026-02-03', duration_minutes: 40, strand: '<Strand>', sub_strand: '<Sub-strand>',
    status: 'draft', specific_learning_outcomes: '<Outcomes>', key_inquiry_questions: '<Questions>',
    teaching_learning_resources: '<Resources>', introduction: '<Intro>', lesson_development: '<Development>',
    conclusion: '<Conclusion>', learning_activities: '<Activities>', assessment_approach: '<Assessment>',
    teacher_reflection: null, review_notes: null, assignment, scheme_week: null,
    has_record_of_work: false, record_of_work: null,
  };
  const context = { scope: leader ? 'school' : 'assigned', assignments: [assignment],
    schemes: [{ id: 3, title: 'Scheme', status: 'approved', class_subject_teacher_id: 11,
      weeks: [{ id: 21, week_number: 1, strand: 'Week strand', sub_strand: 'Week sub-strand', starts_on: '2026-02-02', ends_on: '2026-02-06' }] }] };
  h.app.get = async url => {
    requests.push(url);
    if (get) { const response = await get(url); if (response !== undefined) return response; }
    if (url.endsWith('/context')) return { ok: true, data: context };
    if (url.startsWith('/api/v1/lesson-plans/7')) return { ok: true, data: plan };
    return { ok: true, data: [plan] };
  };
  h.app.post = async (url, body) => { writes.push({ url, body: structuredClone(body) }); return post ? post(url, body) : { ok: true, data: { ...plan, ...body, id: 7 } }; };
  h.app.patch = async (url, body) => { writes.push({ url, body: structuredClone(body) }); return { ok: true, data: { ...plan, ...body } }; };
  h.app.download = async url => { exports.push(url); return download ? download(url) : { ok: true }; };
  h.app.toast = (...args) => toasts.push(args);
  h.app.confirmAction = async (...args) => { confirmations.push(args); return true; };
  h.run('lesson-plans.js');
  const press = (action, id = '7') => h.ids.get('appMain').listeners.click({ target: { closest: () => ({ disabled: false, dataset: { id, planAction: action } }) } });
  return { ...h, requests, writes, toasts, confirmations, exports, press, plan, context, leader };
}

test('teacher lesson workspace loads only the authorized allocation and escapes planning text', async () => {
  const h = harness(); await flush();
  assert.deepEqual(h.requests, ['/api/v1/lesson-plans/context', '/api/v1/lesson-plans']);
  const html = h.ids.get('planList').innerHTML;
  assert.match(html, /&lt;Lesson&gt;|&lt;Class&gt;|&lt;Strand&gt;/);
  assert.doesNotMatch(html, /<Lesson>|<Class>|<Strand>/);
  assert.match(html, /No record of work yet/);
  assert.doesNotMatch(html, /data-plan-action="approve"|data-plan-action="return"/);
  assert.match(h.ids.get('appMain').innerHTML, /never records delivery/);
});

test('term status and date filters are sent as server parameters', async () => {
  const h = harness(); await flush();
  h.ids.get('planTerm').value = '4'; h.ids.get('planTerm').listeners.change({ target: h.ids.get('planTerm') }); await flush();
  h.ids.get('planStatus').value = 'approved'; h.ids.get('planStatus').listeners.change({ target: h.ids.get('planStatus') }); await flush();
  assert.match(h.requests.at(-1), /\/api\/v1\/lesson-plans\?term_id=4&status=approved/);
  h.ids.get('planFrom').value = '2026-02-01'; h.ids.get('planFrom').listeners.change({ target: h.ids.get('planFrom') }); await flush();
  assert.match(h.requests.at(-1), /from=2026-02-01/);
});

test('leadership review controls appear only for submitted lesson plans', async () => {
  const submitted = { id: 7, class_subject_teacher_id: 11, title: 'Submitted plan', lesson_date: '2026-02-03',
    duration_minutes: 40, strand: 'Strand', sub_strand: 'Sub', status: 'submitted', has_record_of_work: true,
    record_of_work: { id: 30, taught_on: '2026-02-03', status: 'approved' },
    assignment: { id: 11, school_class: { name: 'Class' }, subject: { name: 'Area' }, term: { name: 'Term', academic_year: { name: '2026' } } } };
  const h = harness({ role: 'head_teacher', get: async url => url.endsWith('/lesson-plans') ? { ok: true, data: [submitted] } : undefined });
  await flush();
  assert.match(h.ids.get('planList').innerHTML, /data-plan-action="approve"/);
  assert.match(h.ids.get('planList').innerHTML, /Record of work recorded/);
  assert.doesNotMatch(h.ids.get('planList').innerHTML, /data-plan-action="submit"/);
});

test('lesson detail shows every planned section and exports its own scoped PDF', async () => {
  const h = harness(); await flush();
  h.press('view'); await flush();
  const detail = h.ids.get('planDetail').innerHTML;
  for (const heading of ['Specific learning outcomes', 'Key inquiry questions', 'Teaching and learning resources', 'Introduction', 'Lesson development', 'Conclusion', 'Learning activities', 'Assessment approach', 'Teacher reflection']) assert.match(detail, new RegExp(heading));
  assert.match(detail, /&lt;Outcomes&gt;/);
  assert.match(detail, /No record of work has been recorded/);
  h.press('pdf'); await flush();
  assert.deepEqual(h.exports, ['/api/v1/lesson-plans/7/pdf']);
});

test('a draft lesson plan can be duplicated into a new editable draft', async () => {
  const h = harness({ post: async () => ({ ok: true, data: { ...h.plan, id: 12, status: 'draft' } }) }); await flush();
  h.press('duplicate'); await flush();
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].url, '/api/v1/lesson-plans/7/duplicate');
  assert.match(h.toasts.flat().join(' '), /draft/i);
  assert.match(h.requests.at(-1), /\/api\/v1\/lesson-plans\/12/);
});

test('creating a draft posts the full structured plan and opens the saved document', async () => {
  const h = harness(); await flush();
  h.ids.get('createPlan').listeners.click({ currentTarget: h.ids.get('createPlan') });
  h.ids.get('lessonPlan_class_subject_teacher_id').value = '11';
  const values = { lessonPlan_title: '<New lesson>', lessonPlan_lesson_date: '2026-02-05', lessonPlan_duration_minutes: '45',
    lessonPlan_strand: 'Strand', lessonPlan_sub_strand: 'Sub-strand', lessonPlan_scheme_of_work_week_id: '21',
    lessonPlan_specific_learning_outcomes: 'Outcomes', lessonPlan_key_inquiry_questions: 'Questions',
    lessonPlan_teaching_learning_resources: 'Resources', lessonPlan_introduction: 'Introduction',
    lessonPlan_lesson_development: 'Development', lessonPlan_conclusion: 'Conclusion',
    lessonPlan_learning_activities: 'Activities', lessonPlan_assessment_approach: 'Assessment', lessonPlan_teacher_reflection: '' };
  for (const [id, value] of Object.entries(values)) h.ids.get(id).value = value;
  h.modals[0].overlay.querySelector('#savePlan').listeners.click();
  await flush();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].url, '/api/v1/lesson-plans');
  assert.equal(h.writes[0].body.class_subject_teacher_id, '11');
  assert.equal(h.writes[0].body.scheme_of_work_week_id, '21');
  assert.equal(h.writes[0].body.teacher_reflection, null);
  assert.equal(h.modals[0].closed, true);
});

test('server validation errors stay on the open dialog without closing it', async () => {
  const h = harness({ post: async () => ({ ok: false, status: 422, error: '<Invalid>', fields: { lesson_date: ['Outside the assigned term.'] } }) }); await flush();
  h.ids.get('createPlan').listeners.click({ currentTarget: h.ids.get('createPlan') });
  h.ids.get('lessonPlan_class_subject_teacher_id').value = '11';
  ['lessonPlan_title', 'lessonPlan_lesson_date', 'lessonPlan_strand', 'lessonPlan_sub_strand', 'lessonPlan_specific_learning_outcomes',
    'lessonPlan_key_inquiry_questions', 'lessonPlan_teaching_learning_resources', 'lessonPlan_introduction', 'lessonPlan_lesson_development',
    'lessonPlan_conclusion', 'lessonPlan_learning_activities', 'lessonPlan_assessment_approach'].forEach(id => { h.ids.get(id).value = 'Value'; });
  h.modals[0].overlay.querySelector('#savePlan').listeners.click();
  await flush();
  assert.equal(h.modals[0].closed, false);
  assert.match(h.modals[0].body.innerHTML, /data-form-error|lesson_date/);
});

test('unavailable context and incomplete lists show retryable errors without fabricated plans', async () => {
  const failed = harness({ get: async url => url.endsWith('/context') ? { ok: false, status: 503, error: '<Unavailable>' } : undefined }); await flush();
  assert.match(failed.ids.get('planList').innerHTML, /&lt;Unavailable&gt;/);
  assert.doesNotMatch(failed.ids.get('planList').innerHTML, /<Unavailable>/);
  failed.ids.get('planList').querySelector('[data-retry]').listeners.click(); await flush();
  assert.equal(failed.requests.length, 2);

  const malformed = harness({ get: async url => url.endsWith('/lesson-plans') ? { ok: true, data: [{ id: 7, title: 'Missing context' }] } : undefined }); await flush();
  assert.match(malformed.ids.get('planList').innerHTML, /incomplete|Try again/i);
  assert.equal(malformed.ids.get('planCount').innerHTML, '');
  assert.equal(malformed.ids.get('createPlan').disabled, false);
});

test('portal sponsor coordinator and student roles never load lesson planning data', () => {
  for (const role of ['parent_guardian', 'sponsor', 'student', 'sponsor_coordinator']) {
    const h = harness({ role });
    assert.deepEqual(h.requests, []);
    assert.equal(h.ids.has('appMain'), false);
    assert.equal(h.writes.length, 0);
  }
});
