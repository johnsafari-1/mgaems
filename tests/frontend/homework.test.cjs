const { test } = require('node:test');
const assert = require('node:assert/strict');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ role = 'teacher', get, post, download } = {}) {
  const h = createDOM(role, '/homework.html');
  const requests = [], writes = [], exports = [], toasts = [], confirmations = [];
  const leader = ['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(role);
  const assignment = { id: 11, class_id: 2, subject_id: 3, term_id: 4,
    school_class: { id: 2, name: '<Class>' }, subject: { id: 3, name: '<Area>', status: 'active' },
    staff: { id: 5, first_name: 'Assigned', last_name: 'Teacher' }, term: { id: 4, name: '<Term>', academic_year: { id: 1, name: '<Year>' } } };
  const summary = { id: 7, class_subject_teacher_id: 11, lesson_plan_id: null, scheme_of_work_week_id: null,
    title: '<Homework>', status: 'draft', assigned_on: '2026-02-03', due_on: '2026-02-06', submission_method: 'exercise_book', total_marks: 10,
    assignment, question_count: 1, recorded_marks: 10, eligible_learner_count: 2, completion_counts: { submitted: 0, completed: 0, missing: 0, recorded: 0 } };
  const detail = { ...summary, instructions: '<Instructions>', learning_outcomes: '<Outcomes>', teacher_notes: '<Private note>', questions: [{ id: 8, position: 1, question_type: 'multiple_choice', prompt: '<Question>', marks: 10, diagram_reference: null, options: ['A', 'B'], answer_key: 'A', marking_guidance: '<Guidance>' }] };
  const context = { scope: leader ? 'school' : 'assigned', assignments: [assignment], lesson_plans: [{ id: 12, title: 'Linked plan', lesson_date: '2026-02-03', class_subject_teacher_id: 11 }], schemes: [{ id: 13, title: 'Scheme', class_subject_teacher_id: 11, weeks: [{ id: 14, week_number: 1, strand: 'Strand' }] }], submission_methods: ['exercise_book', 'class_collection', 'oral', 'project'] };
  h.app.get = async url => {
    requests.push(url);
    if (get) { const response = await get(url); if (response !== undefined) return response; }
    if (url.endsWith('/context')) return { ok: true, data: context };
    if (url.includes('/completions')) return { ok: true, data: { homework_id: 7, status: 'published', eligible_learner_count: 2, learners: [] } };
    if (url.startsWith('/api/v1/homework/7')) return { ok: true, data: detail };
    return { ok: true, data: [summary] };
  };
  const write = async (url, body) => { writes.push({ url, body: structuredClone(body) }); return post ? post(url, body) : { ok: true, data: detail }; };
  h.app.post = write; h.app.patch = write; h.app.del = async url => { writes.push({ url }); return { ok: true, data: detail }; };
  h.app.download = async url => { exports.push(url); return download ? download(url) : { ok: true }; };
  h.app.toast = (...args) => toasts.push(args); h.app.confirmAction = async (...args) => { confirmations.push(args); return true; };
  h.run('homework.js');
  const press = (action, id = '7', extra = {}) => h.ids.get('appMain').listeners.click({ target: { closest: () => ({ disabled: false, dataset: { id, homeworkAction: action, ...extra } }) } });
  return { ...h, requests, writes, exports, toasts, confirmations, press, context, summary, detail };
}

test('teacher homework directory loads authorized data and sends server-side filters', async () => {
  const h = harness(); await flush();
  assert.deepEqual(h.requests, ['/api/v1/homework/context', '/api/v1/homework']);
  assert.match(h.ids.get('homeworkList').innerHTML, /&lt;Homework&gt;|&lt;Class&gt;/);
  assert.doesNotMatch(h.ids.get('homeworkList').innerHTML, /<Homework>|<Class>/);
  h.ids.get('homeworkTerm').value = '4'; h.ids.get('homeworkTerm').listeners.change({ target: h.ids.get('homeworkTerm') }); await flush();
  h.ids.get('homeworkStatus').value = 'draft'; h.ids.get('homeworkStatus').listeners.change({ target: h.ids.get('homeworkStatus') }); await flush();
  assert.match(h.requests.at(-1), /term_id=4&status=draft/);
});

test('homework detail preserves staff-only keys and exports separate worksheet and answer-key PDFs', async () => {
  const h = harness(); await flush(); h.press('view'); await flush();
  const html = h.ids.get('homeworkDetail').innerHTML;
  assert.match(html, /&lt;Question&gt;|Answer key \(staff only\)|&lt;Guidance&gt;/);
  h.press('pdf'); h.press('answerKey'); await flush();
  assert.deepEqual(h.exports, ['/api/v1/homework/7/pdf', '/api/v1/homework/7/answer-key/pdf']);
});

test('creating homework chooses a real allocation and posts a draft with structured learner instructions', async () => {
  const h = harness(); await flush(); h.ids.get('createHomework').listeners.click({ currentTarget: h.ids.get('createHomework') });
  const values = { homework_title: 'New homework', homework_assigned_on: '2026-02-03', homework_due_on: '2026-02-06', homework_submission_method: 'exercise_book', homework_instructions: 'Complete questions', homework_learning_outcomes: 'Demonstrate understanding' };
  for (const [id, value] of Object.entries(values)) h.ids.get(id).value = value;
  h.modals[0].overlay.querySelector('#saveHomework').listeners.click(); await flush();
  assert.equal(h.writes[0].url, '/api/v1/homework');
  assert.equal(h.writes[0].body.class_subject_teacher_id, '11');
  assert.equal(h.writes[0].body.teacher_notes, null);
});

test('portal and student roles do not load homework workspace data', () => {
  for (const role of ['parent_guardian', 'sponsor', 'student', 'sponsor_coordinator']) {
    const h = harness({ role });
    assert.deepEqual(h.requests, []);
    assert.equal(h.ids.has('appMain'), false);
  }
});
