const { test } = require('node:test');
const assert = require('node:assert/strict');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ role = 'teacher', page = '/dashboard.html', context, get } = {}) {
  const h = createDOM(role, page), requests = [];
  const current = { id: 3, name: '<Term>', academic_year_id: 7, academic_year: { id: 7, name: '<Year>' } };
  const defaultContext = { school_date: '2026-10-11', current_periods: [current],
    class_teacher_classes: [{ id: 10, name: '<Class Teacher class>', level: 'primary' }],
    subject_assignments: [{ class_id: 20, subject_id: 30, term_id: 3, school_class: { id: 20, name: '<Subject class>' }, subject: { id: 30, name: '<Subject>' }, term: current }],
    learner_classes: [{ id: 10, name: '<Class Teacher class>' }, { id: 20, name: '<Subject class>' }] };
  h.app.get = async url => {
    requests.push(url);
    if (get) { const result = await get(url); if (result) return result; }
    if (url === '/api/v1/teacher/context') return { ok: true, data: context || defaultContext };
    if (url === '/api/v1/teacher/timetable') return { ok: true, data: [{ id: 4, day_of_week: 2, start_time: '09:00:00', end_time: '09:40:00',
      school_class: { name: '<Subject class>' }, subject: { name: '<Subject>' }, current_periods: [current] }] };
    if (url.startsWith('/api/v1/students?')) return { ok: true, data: [{ id: 8, admission_no: '<A8>', first_name: '<Learner>', last_name: 'Name', school_class: { name: '<Class>' } }], meta: { total: 16, per_page: 15, page: 1 } };
    if (url === '/api/v1/students/8') return { ok: true, data: { id: 8, admission_no: '<A8>', first_name: '<Learner>', last_name: 'Name', status: 'active', school_class: { name: '<Class>' },
      guardians: [{ phone: 'private-sentinel' }], medical_info: { conditions: 'private-sentinel' } } };
    throw new Error('Unexpected API '+url);
  };
  h.app.post = () => { throw new Error('Read-only Workspace attempted a write'); };
  h.run('teacher-workspace.js');
  return { ...h, requests, current };
}

test('Teacher dashboard separates responsibilities and shows only actual own timetable context', async () => {
  const h = harness(); await flush();
  const html = h.ids.get('teacherView').innerHTML;
  assert.match(html, /Class Teacher responsibilities/); assert.match(html, /Subject Teacher responsibilities/);
  assert.match(html, /&lt;Class Teacher class&gt;/); assert.match(html, /&lt;Subject&gt;/);
  assert.match(html, /href="\/attendance.html"/); assert.match(html, /href="\/assessment.html"/);
  const timetable = h.ids.get('teacherTimetable').innerHTML;
  assert.match(timetable, /Tuesday/); assert.match(timetable, /09:00–09:40/); assert.match(timetable, /&lt;Year&gt; · &lt;Term&gt;/);
  assert.doesNotMatch(timetable, /<Subject>/);
  assert.deepEqual(h.requests, ['/api/v1/teacher/context', '/api/v1/teacher/timetable']);
  assert.equal(h.ids.has('statsCards'), false);
});
test('Class Teacher-only dashboard grants attendance entry without subject assessment entry', async () => {
  const context = { current_periods: [], class_teacher_classes: [{ id: 10, name: 'Assigned class', level: 'primary' }], subject_assignments: [], learner_classes: [{ id: 10, name: 'Assigned class' }] };
  const h = harness({ context, get: async url => url.endsWith('/timetable') ? { ok: true, data: [] } : undefined }); await flush();
  const html = h.ids.get('teacherView').innerHTML;
  assert.match(html, /Manage class attendance/); assert.doesNotMatch(html, /href="\/assessment.html"/);
  assert.match(h.ids.get('teacherContent').innerHTML, /No eligible current academic term/);
  assert.match(h.ids.get('teacherTimetable').innerHTML, /No eligible timetable entries/);
});
test('Subject Teacher-only dashboard offers assessment without daily attendance entry', async () => {
  const h = harness({ get: async url => url.endsWith('/context') ? { ok: true, data: { current_periods: [], class_teacher_classes: [],
    subject_assignments: [{ school_class: { name: 'Assigned class' }, subject: { name: 'Assigned subject' }, term: { name: 'Term' } }], learner_classes: [{ id: 20, name: 'Assigned class' }] } } : undefined }); await flush();
  assert.match(h.ids.get('teacherView').innerHTML, /Enter assigned assessments/);
  assert.doesNotMatch(h.ids.get('teacherView').innerHTML, /href="\/attendance.html"/);
});
test('My Learners filters use only authorized class choices and preserve scoped pagination', async () => {
  const h = harness({ page: '/students.html' }); await flush();
  assert.match(h.ids.get('teacherView').innerHTML, /&lt;Subject class&gt;/);
  assert.deepEqual(h.ids.get('myLearnerClass').children.map(item => item.attrs.value), ['', '10', '20']);
  assert.match(h.ids.get('myLearnerResults').innerHTML, /&lt;Learner&gt;/);
  h.ids.get('myLearnerNext').listeners.click(); await flush();
  assert.match(h.requests.at(-1), /page=2/);
  h.ids.get('myLearnerSearch').value = 'admission & name'; h.ids.get('myLearnerClass').value = '20';
  h.ids.get('myLearnerFilter').listeners.submit({ preventDefault() {} }); await flush();
  const params = new URLSearchParams(h.requests.at(-1).split('?')[1]);
  assert.equal(params.get('page'), '1'); assert.equal(params.get('class_id'), '20'); assert.equal(params.get('search'), 'admission & name');
  assert.equal(params.has('staff_id'), false);
});
test('My Learner details display only educational fields and no private payload extras', async () => {
  const h = harness({ page: '/students.html' }); await flush();
  h.ids.get('myLearnerResults').querySelector('[data-learner]').listeners.click(); await flush();
  assert.equal(h.requests.at(-1), '/api/v1/students/8');
  assert.match(h.modals[0].body.innerHTML, /&lt;Learner&gt;/);
  assert.doesNotMatch(h.modals[0].body.innerHTML, /private-sentinel|medical|guardian|sponsorship/i);
});
test('changed assignment detail failure shows unavailable learner without retaining details', async () => {
  const h = harness({ page: '/students.html', get: async url => url === '/api/v1/students/8' ? { ok: false, status: 404 } : undefined }); await flush();
  h.ids.get('myLearnerResults').querySelector('[data-learner]').listeners.click(); await flush();
  assert.match(h.modals[0].body.innerHTML, /Learner unavailable/);
  assert.doesNotMatch(h.modals[0].body.innerHTML, /<Learner>|&lt;Learner&gt;/);
});
test('out-of-order learner response cannot replace the newly selected class results', async () => {
  let release;
  const h = harness({ page: '/students.html', get: url => url.startsWith('/api/v1/students?')
    ? url.includes('class_id=20') ? { ok: true, data: [], meta: { total: 0, per_page: 15 } }
      : new Promise(resolve => { release = resolve; }) : undefined }); await flush();
  h.ids.get('myLearnerClass').value = '20'; h.ids.get('myLearnerClass').listeners.change(); await flush();
  release({ ok: true, data: [{ id: 88, first_name: 'stale-sentinel' }], meta: { total: 1, per_page: 15 } }); await flush();
  assert.match(h.ids.get('myLearnerResults').innerHTML, /No assigned learners match/);
  assert.doesNotMatch(h.ids.get('myLearnerResults').innerHTML, /stale-sentinel/);
});
test('setup forbidden empty and recoverable errors remain distinct and never fabricate assignments', async () => {
  const forbidden = harness({ get: async () => ({ ok: false, status: 403 }) }); await flush();
  assert.match(forbidden.ids.get('teacherSetup').innerHTML, /Teacher access restricted/);
  assert.equal(forbidden.ids.get('teacherContent').hidden, true);
  let attempts = 0;
  const recovered = harness({ get: async url => url.endsWith('/context') && ++attempts === 1 ? { ok: false, status: 503, error: '<Offline>' } : undefined }); await flush();
  assert.match(recovered.ids.get('teacherSetup').innerHTML, /&lt;Offline&gt;/);
  recovered.ids.get('teacherSetup').querySelector('[data-retry]').listeners.click(); await flush();
  assert.equal(recovered.ids.get('teacherContent').hidden, false);
  const empty = harness({ context: { current_periods: [], class_teacher_classes: [], subject_assignments: [], learner_classes: [] },
    get: async url => url.endsWith('/timetable') ? { ok: true, data: [] } : undefined }); await flush();
  assert.match(empty.ids.get('teacherView').innerHTML, /No Class Teacher classes/); assert.match(empty.ids.get('teacherView').innerHTML, /No eligible subject assignments/);
});
test('My Timetable API failure does not erase loaded responsibilities and can be retried', async () => {
  let attempts = 0;
  const h = harness({ page: '/teacher-timetable.html', get: async url => url.endsWith('/timetable') && ++attempts === 1 ? { ok: false, status: 503, error: 'Unavailable' } : undefined }); await flush();
  assert.match(h.ids.get('teacherTimetable').innerHTML, /Unavailable/);
  assert.equal(h.ids.get('teacherContent').hidden, false);
  h.ids.get('teacherTimetable').querySelector('[data-retry]').listeners.click(); await flush();
  assert.match(h.ids.get('teacherTimetable').innerHTML, /Tuesday/);
});
test('new Workspace issues no Teacher requests for other roles and preserves Parent Sponsor redirects', () => {
  for (const role of ['system_admin', 'head_teacher', 'deputy_head_teacher', 'sponsor_coordinator', 'student', 'parent_guardian', 'sponsor']) {
    const h = harness({ role }); assert.deepEqual(h.requests, []);
    if (role === 'parent_guardian') assert.equal(h.context.window.location.href, '/parent-portal.html');
    if (role === 'sponsor') assert.equal(h.context.window.location.href, '/sponsor-portal.html');
    if (role === 'student') assert.equal(h.context.window.location.href, '/dashboard.html');
    const direct = harness({ role, page: '/teacher-timetable.html' });
    assert.deepEqual(direct.requests, []);
    assert.equal(direct.context.window.location.href, role === 'parent_guardian' ? '/parent-portal.html'
      : role === 'sponsor' ? '/sponsor-portal.html' : '/dashboard.html');
  }
});
test('old generic Teacher dashboard and learner renderer cannot overwrite the scoped Workspace', async () => {
  for (const page of ['/dashboard.html', '/students.html']) {
    const h = harness({ page }); await flush(); const previous = h.ids.get('appMain').innerHTML;
    h.run(page === '/dashboard.html' ? 'dashboard.js' : 'students.js');
    assert.equal(h.ids.get('appMain').innerHTML, previous);
    assert.equal(h.requests.some(url => /reports|\/classes|guardians|sponsorships|staff/.test(url)), false);
  }
});
