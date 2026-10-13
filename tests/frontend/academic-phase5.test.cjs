// Phase 5A workflow checks use synthetic API responses and a DOM interface, not a browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const createDOM = require('./helpers/dom.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixtures() {
  const year = { id: 1, name: '2026 Academic Year', start_date: '2026-01-01', end_date: '2026-12-31', is_current: true };
  const term = { id: 11, academic_year_id: 1, name: 'First Term', start_date: '2026-01-05', end_date: '2026-04-10', is_current: true, academic_year: year };
  const teacher = { id: 31, first_name: 'Amina', last_name: 'Teacher' };
  const classroom = { id: 2, name: 'Grade Six', level: 'primary', sequence: 6, capacity: 35, students_count: 12, subjects_count: 3, class_teacher_id: 31, class_teacher: teacher };
  const subject = { id: 20, name: 'Mathematics', code: 'MATH', learning_area: 'Core', status: 'active' };
  return {
    '/api/v1/academic-years': [year, { id: 9, name: 'Previous Year', start_date: '2025-01-01', end_date: '2025-12-31', is_current: false }],
    '/api/v1/terms': [term, { id: 12, academic_year_id: 1, name: 'Second Term', start_date: '2026-05-04', end_date: '2026-08-07', is_current: false, academic_year: year }],
    '/api/v1/classes': [classroom, { id: 3, name: 'Junior One', level: 'junior', sequence: 7, capacity: null, students_count: 0, subjects_count: 0, class_teacher: null }],
    '/api/v1/subjects': [subject, { id: 21, name: 'Art', code: 'ART', learning_area: 'Creative', status: 'inactive' }],
    '/api/v1/teacher-assignments': [{ id: 50, class_id: 2, subject_id: 20, staff_id: 31, term_id: 11, school_class: classroom, subject, staff: teacher, term }],
    '/api/v1/academic/staff-options': [{ id: 31, display_name: 'Amina Teacher' }],
    '/api/v1/class-subjects': [subject],
    '/api/v1/timetable/by-class': [
      { id: 101, class_id: 2, day_of_week: 5, start_time: '10:00:00', end_time: '10:40:00', school_class: classroom, subject: { ...subject, name: 'Friday Mathematics' }, staff: teacher },
      { id: 102, class_id: 2, day_of_week: 1, start_time: '09:00:00', end_time: '09:40:00', school_class: classroom, subject: { ...subject, name: 'Later Mathematics' }, staff: teacher },
      { id: 103, class_id: 2, day_of_week: 1, start_time: '08:00:00', end_time: '08:40:00', school_class: classroom, subject: { ...subject, name: 'Early Mathematics' }, staff: teacher },
    ],
  };
}

function harness({ role = 'head_teacher', get, write, data = fixtures() } = {}) {
  const h = createDOM(role, '/academic.html');
  const requests = [], writes = [], errors = [], toasts = [];
  h.document.createElement = tag => new h.Element(tag);
  h.context.FormData = class {
    constructor(form) {
      this.entries = [...form.elements].filter(control => control.name && !control.disabled && control.tag !== 'button').map(control => [control.name, control.value]);
    }
    [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
  };
  h.app.get = async url => {
    requests.push(url);
    if (get) { const result = await get(url); if (result !== undefined) return result; }
    return { ok: true, data: structuredClone(data[url.split('?')[0]] || []) };
  };
  for (const method of ['post', 'patch', 'del']) h.app[method] = async (url, body) => {
    writes.push({ method, url, body: structuredClone(body) });
    return write ? write(url, body, method) : { ok: true, data: { id: 100 } };
  };
  const renderErrors = h.app.showFormErrors;
  h.app.showFormErrors = (form, result) => { errors.push(result); renderErrors(form, result); };
  h.app.toast = (...args) => toasts.push(args);
  h.app.confirmAction = async () => true;
  return {
    ...h, requests, writes, errors, toasts,
    start() { h.run('academic.js'); return this; },
    async change(id, value, event = 'change') {
      const control = h.ids.get(id); assert.ok(control, `Missing control ${id}`); control.value = value;
      await control.listeners[event]?.({ target: control }); await settle();
    },
    async add(key) { h.ids.get('add_' + key).listeners.click(); await settle(); return h.modals.at(-1); },
    async action(action, id) {
      const control = h.ids.get('appMain').querySelectorAll('[data-action]').find(item => item.dataset.action === action && item.dataset.id === String(id));
      assert.ok(control, `Missing action ${action} ${id}`);
      h.ids.get('appMain').listeners.click({ target: { closest: () => control } }); await settle();
      return h.modals.at(-1);
    },
    async submit(modal, values) {
      const form = modal.body.querySelector('form');
      for (const [name, value] of Object.entries(values)) { const control = form.elements.namedItem(name); assert.ok(control, `Missing form control ${name}`); control.value = value; }
      await form.listeners.submit({ preventDefault() {} }); await settle(); return form;
    },
  };
}

test('academic periods distinguish active and inactive status and present readable dates', async () => {
  const h = harness().start(); await settle();
  const years = h.ids.get('academicData_years').innerHTML, terms = h.ids.get('academicData_terms').innerHTML;
  assert.match(years, /Active/); assert.match(years, /Inactive/);
  assert.match(years, /1 Jan 2026/); assert.match(years, /31 Dec 2026/);
  assert.match(terms, /5 Jan 2026/); assert.match(terms, /10 Apr 2026/);
  assert.match(terms, /2026 Academic Year/);
});

test('academic period search and status filters operate on loaded data without new API calls', async () => {
  const h = harness().start(); await settle(); const count = h.requests.length;
  await h.change('academicStatus_years', 'inactive');
  assert.match(h.ids.get('academicData_years').innerHTML, /Previous Year/);
  assert.doesNotMatch(h.ids.get('academicData_years').innerHTML, /2026 Academic Year/);
  await h.change('academicStatus_years', ''); await h.change('academicSearch_years', '2026', 'input');
  assert.match(h.ids.get('academicData_years').innerHTML, /2026 Academic Year/);
  assert.doesNotMatch(h.ids.get('academicData_years').innerHTML, /Previous Year/);
  await h.change('academicStatus_terms', 'active');
  assert.match(h.ids.get('academicData_terms').innerHTML, /First Term/);
  assert.doesNotMatch(h.ids.get('academicData_terms').innerHTML, /Second Term/);
  await h.change('academicSearch_terms', 'No matching term', 'input');
  assert.match(h.ids.get('academicData_terms').innerHTML, /No .*match/i);
  assert.equal(h.requests.length, count);
});

test('class cards show capacity, actual learner count, level and separate Class Teacher responsibility', async () => {
  const h = harness().start(); await settle(); const html = h.ids.get('academicData_classes').innerHTML;
  for (const text of ['Grade Six', 'Primary', '35', '12', 'Class Teacher', 'Amina Teacher', 'Junior One', 'Unassigned']) assert.match(html, new RegExp(text));
  assert.match(html, /Manage offerings/);
  assert.doesNotMatch(html, /Stream/);
  assert.match(html, /Learner count|Learners/);
});

test('class search includes assigned teacher and learning-area search includes code and grouping', async () => {
  const h = harness().start(); await settle(); const count = h.requests.length;
  await h.change('academicSearch_classes', 'amina', 'input');
  assert.match(h.ids.get('academicData_classes').innerHTML, /Grade Six/);
  assert.doesNotMatch(h.ids.get('academicData_classes').innerHTML, /Junior One/);
  await h.change('academicSearch_subjects', 'creative', 'input');
  assert.match(h.ids.get('academicData_subjects').innerHTML, /Art/);
  assert.doesNotMatch(h.ids.get('academicData_subjects').innerHTML, /Mathematics/);
  await h.change('academicSearch_subjects', 'math', 'input'); await h.change('academicStatus_subjects', 'active');
  assert.match(h.ids.get('academicData_subjects').innerHTML, /Mathematics/);
  assert.doesNotMatch(h.ids.get('academicData_subjects').innerHTML, />Art</);
  await h.change('academicSearch_subjects', '', 'input'); await h.change('academicStatus_subjects', 'inactive');
  assert.match(h.ids.get('academicData_subjects').innerHTML, /Art/);
  assert.doesNotMatch(h.ids.get('academicData_subjects').innerHTML, /Mathematics/);
  assert.equal(h.requests.length, count);
});

test('subject assignments identify class, learning area, teacher, term and academic year', async () => {
  const h = harness().start(); await settle();
  const html = h.ids.get('academicData_assignments').innerHTML;
  for (const text of ['Grade Six', 'Mathematics', 'Amina Teacher', 'First Term', '2026 Academic Year']) assert.match(html, new RegExp(text));
  assert.match(h.ids.get('appMain').innerHTML, /Subject Teacher/i);
  await h.change('assignmentTerm', '11'); await h.change('assignmentClass', '2');
  assert.ok(h.requests.some(url => url.includes('teacher-assignments?term_id=11&class_id=2')));
});

test('weekly timetable groups actual lessons by weekday and sorts start times with class and teacher metadata', async () => {
  const h = harness().start(); await settle(); await h.change('timetableClass', '2');
  const html = h.ids.get('academicData_timetable').innerHTML;
  assert.match(html, /academic-week-grid/);
  for (const text of ['Monday', 'Friday', '08:00', '08:40', '09:00', '09:40', '10:00', '10:40', 'Grade Six', 'Amina Teacher']) assert.match(html, new RegExp(text));
  assert.ok(html.indexOf('Early Mathematics') < html.indexOf('Later Mathematics'));
  assert.ok(html.indexOf('Later Mathematics') < html.indexOf('Friday Mathematics'));
  assert.match(h.ids.get('appMain').innerHTML, /recurring weekly/i);
  assert.match(h.ids.get('appMain').innerHTML, /independent of academic terms|not scoped to an academic term/i);
  assert.doesNotMatch(html, /First Term|2026 Academic Year/);
});

test('unselected and empty timetable states identify configuration without fabricating lessons', async () => {
  const h = harness({ get: async url => url.includes('timetable/by-class') ? { ok: true, data: [] } : undefined }).start(); await settle();
  assert.match(h.ids.get('academicData_timetable').innerHTML, /Select a class/);
  assert.equal(h.ids.get('add_timetable').disabled, true);
  await h.change('timetableClass', '2');
  assert.match(h.ids.get('academicData_timetable').innerHTML, /No timetable entries|No recurring lessons/i);
  assert.doesNotMatch(h.ids.get('academicData_timetable').innerHTML, /Early Mathematics/);
});

test('a stale timetable response cannot replace the newly selected class or an unselected state', async () => {
  let resolve;
  const h = harness({ get: url => url.includes('timetable/by-class?class_id=2') ? new Promise(done => { resolve = done; }) : url.includes('timetable/by-class?class_id=3') ? Promise.resolve({ ok: true, data: [] }) : undefined }).start(); await settle();
  const control = h.ids.get('timetableClass'); control.value = '2'; const first = control.listeners.change(); await settle();
  await h.change('timetableClass', '3');
  resolve({ ok: true, data: fixtures()['/api/v1/timetable/by-class'] }); await first; await settle();
  assert.doesNotMatch(h.ids.get('academicData_timetable').innerHTML, /Early Mathematics|Grade Six/);
  control.value = '2'; const second = control.listeners.change(); await settle();
  await h.change('timetableClass', '');
  resolve({ ok: true, data: fixtures()['/api/v1/timetable/by-class'] }); await second; await settle();
  assert.match(h.ids.get('academicData_timetable').innerHTML, /Select a class/);
  assert.doesNotMatch(h.ids.get('academicData_timetable').innerHTML, /Early Mathematics/);
});

test('academic loading and API failures are independent, escaped and retryable', async () => {
  let resolve, fail = true;
  const h = harness({ get: url => url === '/api/v1/academic-years' ? new Promise(done => { resolve = done; }) : url === '/api/v1/terms' && fail ? Promise.resolve({ ok: false, error: '<Unavailable term service>' }) : undefined }).start();
  assert.equal(h.ids.get('academicData_years').attrs['aria-busy'], 'true');
  assert.match(h.ids.get('academicData_years').innerHTML, /Loading/);
  await settle();
  assert.match(h.ids.get('academicData_terms').innerHTML, /&lt;Unavailable term service&gt;/);
  assert.doesNotMatch(h.ids.get('academicData_terms').innerHTML, /<Unavailable term service>/);
  assert.match(h.ids.get('academicData_classes').innerHTML, /Grade Six/);
  fail = false; await h.ids.get('academicData_terms').querySelector('[data-retry]').listeners.click(); await settle();
  assert.match(h.ids.get('academicData_terms').innerHTML, /First Term/);
  resolve({ ok: true, data: fixtures()['/api/v1/academic-years'] }); await settle();
  assert.equal(h.ids.get('academicData_years').attrs['aria-busy'], 'false');
});

test('malformed collection responses finish loading with an error instead of fabricated empty data', async () => {
  const h = harness({ get: async url => /academic-years|teacher-assignments|timetable\/by-class/.test(url) ? { ok: true, data: null } : undefined }).start(); await settle();
  assert.match(h.ids.get('academicData_years').innerHTML, /could not be loaded|unexpected response/i);
  assert.equal(h.ids.get('academicData_years').attrs['aria-busy'], 'false');
  assert.match(h.ids.get('academicData_assignments').innerHTML, /could not be loaded|unexpected response/i);
  await h.change('timetableClass', '2');
  assert.match(h.ids.get('academicData_timetable').innerHTML, /could not be loaded|unexpected response/i);
  assert.equal(h.ids.get('academicData_timetable').attrs['aria-busy'], 'false');
});

test('academic reference views retain teacher restrictions and do not fetch staff or assignment APIs', async () => {
  const h = harness({ role: 'teacher' }).start(); await settle();
  assert.equal(h.requests.length, 4);
  assert.equal(h.requests.some(url => /staff|teacher-assignments|timetable/.test(url)), false);
  assert.equal(h.ids.has('assignmentTerm'), false);
  assert.equal(h.ids.has('add_classes'), false);
  assert.match(h.ids.get('academicData_classes').innerHTML, /View offerings/);
  assert.doesNotMatch(h.ids.get('academicData_classes').innerHTML, /edit_classes|delete_classes/);
});

test('Deputy Head Teacher retains structure controls but cannot edit academic calendar periods', async () => {
  const h = harness({ role: 'deputy_head_teacher' }).start(); await settle();
  assert.equal(h.ids.has('add_years'), false); assert.equal(h.ids.has('add_terms'), false);
  assert.ok(h.ids.has('add_classes')); assert.ok(h.ids.has('add_assignments'));
  assert.doesNotMatch(h.ids.get('academicData_years').innerHTML, /edit_years|activate_years|delete_years/);
});

test('parent and sponsor portals cannot create an academic workspace or make academic requests', () => {
  for (const role of ['parent_guardian', 'sponsor']) {
    const h = harness({ role }).start(); assert.equal(h.requests.length, 0); assert.equal(h.ids.has('appMain'), false);
    assert.match(h.context.window.location.href, /portal\.html$/);
  }
});

test('academic section tabs support keyboard movement, focus and selected-panel semantics', async () => {
  const h = harness().start(); await settle();
  const first = h.ids.get('academicTab_years'); let prevented = false;
  first.listeners.keydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.document.activeElement, h.ids.get('academicTab_terms'));
  assert.equal(h.ids.get('academicTab_terms').attrs['aria-selected'], 'true');
  assert.equal(h.ids.get('academicPanel_years').hidden, true);
  assert.equal(h.ids.get('academicPanel_terms').hidden, false);
  h.ids.get('academicTab_terms').listeners.keydown({ key: 'End', preventDefault() {} });
  assert.equal(h.document.activeElement, h.ids.get('academicTab_timetable'));
});

test('invalid calendar date ranges retain input and show field feedback without API mutation', async () => {
  const h = harness().start(); await settle(); const modal = await h.add('years');
  const form = await h.submit(modal, { name: 'New Year', start_date: '2027-12-31', end_date: '2027-01-01' });
  assert.equal(h.writes.length, 0); assert.equal(modal.closed, false);
  assert.equal(form.elements.namedItem('name').value, 'New Year');
  assert.equal(form.elements.namedItem('end_date').attrs['aria-invalid'], 'true');
  assert.match(form.querySelector('[data-form-error]').innerHTML, /end|after|date/i);
  assert.equal(h.errors.length, 1);
});

test('term forms identify the academic year and reject dates outside it before mutation', async () => {
  const h = harness().start(); await settle(); const modal = await h.add('terms');
  const form = await h.submit(modal, { academic_year_id: '1', name: 'Out of Year', start_date: '2027-01-05', end_date: '2027-03-01' });
  assert.equal(h.writes.length, 0); assert.equal(modal.closed, false);
  assert.match(modal.body.innerHTML, /Academic year/);
  assert.match(form.querySelector('[data-form-error]').innerHTML, /year|within/i);
});

test('calendar conflict feedback retains the draft, restores Save and marks the server field', async () => {
  const h = harness({ write: async () => ({ ok: false, status: 409, error: '<Existing period conflict>', fields: { start_date: ['<Overlaps an existing term>'] } }) }).start(); await settle();
  const modal = await h.add('years'); const form = await h.submit(modal, { name: 'New Year', start_date: '2027-01-01', end_date: '2027-12-31' });
  assert.equal(h.writes.length, 1); assert.equal(modal.closed, false);
  assert.equal(form.elements.namedItem('name').value, 'New Year');
  assert.equal(form.elements.namedItem('start_date').attrs['aria-invalid'], 'true');
  assert.match(form.querySelector('[data-form-error]').innerHTML, /&lt;Existing period conflict&gt;|&lt;Overlaps an existing term&gt;/);
  assert.doesNotMatch(form.querySelector('[data-form-error]').innerHTML, /<Existing period conflict>/);
  assert.equal(modal.overlay.querySelector('[data-submit]').disabled, false);
});

test('timetable forms reject equal or reversed lesson times without weakening server double-booking rules', async () => {
  const h = harness().start(); await settle(); await h.change('timetableClass', '2');
  const modal = await h.add('timetable'); await settle();
  for (const end of ['08:00', '07:59']) {
    const form = await h.submit(modal, { class_id: '2', subject_id: '20', staff_id: '31', day_of_week: '1', start_time: '08:00', end_time: end });
    assert.equal(h.writes.length, 0); assert.equal(modal.closed, false);
    assert.equal(form.elements.namedItem('end_time').attrs['aria-invalid'], 'true');
    assert.match(form.querySelector('[data-form-error]').innerHTML, /end|after|time/i);
  }
});

test('teacher double-booking conflicts retain timetable draft and display the server explanation', async () => {
  const h = harness({ write: async () => ({ ok: false, status: 409, error: '<Teacher already scheduled>', fields: { staff_id: ['Choose an available subject teacher.'] } }) }).start(); await settle(); await h.change('timetableClass', '2');
  const modal = await h.add('timetable'); await settle();
  const form = await h.submit(modal, { class_id: '2', subject_id: '20', staff_id: '31', day_of_week: '1', start_time: '08:00', end_time: '08:40' });
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].url, '/api/v1/timetable');
  assert.equal(modal.closed, false); assert.equal(form.elements.namedItem('start_time').value, '08:00');
  assert.equal(form.elements.namedItem('staff_id').attrs['aria-invalid'], 'true');
  assert.match(form.querySelector('[data-form-error]').innerHTML, /&lt;Teacher already scheduled&gt;/);
  assert.equal(modal.overlay.querySelector('[data-submit]').disabled, false);
});

test('academic forms prevent duplicate mutations while a save is pending and preserve API payload keys', async () => {
  let resolve;
  const h = harness({ write: () => new Promise(done => { resolve = done; }) }).start(); await settle();
  const modal = await h.add('years'), form = modal.body.querySelector('form');
  form.elements.namedItem('name').value = 'New Year'; form.elements.namedItem('start_date').value = '2027-01-01'; form.elements.namedItem('end_date').value = '2027-12-31';
  const first = form.listeners.submit({ preventDefault() {} }); await settle();
  await form.listeners.submit({ preventDefault() {} });
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].url, '/api/v1/academic-years');
  assert.deepEqual(h.writes[0].body, { name: 'New Year', start_date: '2027-01-01', end_date: '2027-12-31' });
  assert.equal(modal.overlay.querySelector('[data-submit]').disabled, true);
  resolve({ ok: true, data: { id: 100 } }); await first; await settle();
  assert.equal(modal.closed, true);
});

test('API-provided academic names and assignment text are escaped in the improved views', async () => {
  const data = fixtures(); data['/api/v1/classes'][0].name = '<Class>'; data['/api/v1/subjects'][0].name = '<Subject>';
  data['/api/v1/teacher-assignments'][0].staff.first_name = '<Teacher>';
  const h = harness({ data }).start(); await settle();
  assert.match(h.ids.get('academicData_classes').innerHTML, /&lt;Class&gt;/);
  assert.match(h.ids.get('academicData_subjects').innerHTML, /&lt;Subject&gt;/);
  assert.match(h.ids.get('academicData_assignments').innerHTML, /&lt;Teacher&gt;/);
  assert.doesNotMatch(h.ids.get('academicData_assignments').innerHTML, /<Teacher>/);
});

test('restricted class payloads show unavailable metadata rather than invented capacity or learner counts', async () => {
  const data = fixtures(); data['/api/v1/classes'] = [{ id: 2, name: 'Assigned Class', level: 'primary' }];
  const h = harness({ role: 'teacher', data }).start(); await settle();
  const html = h.ids.get('academicData_classes').innerHTML;
  assert.match(html, /Assigned Class/); assert.match(html, /Not available/);
  assert.doesNotMatch(html, />0</);
  assert.doesNotMatch(html, /Unassigned/);
  assert.equal(h.requests.some(url => /staff|students/.test(url)), false);
});

test('empty academic configuration gives useful section states and blocks dependent create forms', async () => {
  const h = harness({ data: {} }).start(); await settle();
  for (const key of ['years', 'terms', 'classes', 'subjects']) {
    assert.match(h.ids.get('academicData_' + key).innerHTML, /No .*configured/i);
    assert.equal(h.ids.get('academicData_' + key).attrs['aria-busy'], 'false');
  }
  assert.equal(h.ids.get('add_years').disabled, false);
  assert.equal(h.ids.get('add_terms').disabled, true);
  assert.equal(h.ids.get('add_assignments').disabled, true);
  assert.equal(h.ids.get('add_timetable').disabled, true);
});

test('existing term edits retain the owning year and send only changed contract fields', async () => {
  const h = harness().start(); await settle(); const modal = await h.action('edit_terms', 11);
  const form = modal.body.querySelector('form');
  assert.equal(form.elements.namedItem('academic_year_id').disabled, true);
  await h.submit(modal, { name: 'Renamed First Term' });
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].method, 'patch');
  assert.equal(h.writes[0].url, '/api/v1/terms/11');
  assert.deepEqual(h.writes[0].body, { name: 'Renamed First Term' });
});

test('assignment form distinguishes subject responsibility and permits only active class offerings', async () => {
  const offered = fixtures()['/api/v1/class-subjects'];
  const h = harness({ get: async url => url.startsWith('/api/v1/class-subjects?') ? { ok: true, data: [...offered, { id: 99, name: 'Retired Offering', status: 'inactive' }] } : undefined }).start(); await settle();
  const modal = await h.add('assignments'); const form = modal.body.querySelector('form');
  const control = form.elements.namedItem('class_id'); control.value = '2'; await control.listeners.change(); await settle();
  assert.match(modal.body.innerHTML, /Subject Teacher|Subject teacher/);
  assert.match(form.elements.namedItem('subject_id').innerHTML, /Mathematics/);
  assert.doesNotMatch(form.elements.namedItem('subject_id').innerHTML, /Retired Offering/);
  await h.submit(modal, { class_id: '2', subject_id: '20', staff_id: '31', term_id: '11' });
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].url, '/api/v1/teacher-assignments');
  assert.deepEqual(h.writes[0].body, { class_id: '2', subject_id: '20', staff_id: '31', term_id: '11' });
});

test('class offerings failures keep assignment Save disabled and recover with retry', async () => {
  let failing = true;
  const h = harness({ get: async url => url.startsWith('/api/v1/class-subjects?') && failing ? { ok: false, error: '<Offerings unavailable>' } : undefined }).start(); await settle();
  const modal = await h.add('assignments'), form = modal.body.querySelector('form'), control = form.elements.namedItem('class_id');
  control.value = '2'; await control.listeners.change(); await settle();
  assert.equal(modal.overlay.querySelector('[data-submit]').disabled, true);
  assert.match(form.querySelector('[data-form-error]').innerHTML, /&lt;Offerings unavailable&gt;/);
  const retry = modal.body.descendants().find(node => node.textContent === 'Retry offerings'); assert.ok(retry); assert.equal(retry.hidden, false);
  failing = false; await retry.listeners.click(); await settle();
  assert.equal(retry.hidden, true); assert.equal(modal.overlay.querySelector('[data-submit]').disabled, false);
  assert.equal(control.value, '2'); assert.match(form.elements.namedItem('subject_id').innerHTML, /Mathematics/);
});

test('older class-offering requests cannot repopulate an assignment after the selected class changes', async () => {
  let resolve;
  const h = harness({ get: url => url.startsWith('/api/v1/class-subjects?class_id=2') ? new Promise(done => { resolve = done; }) : url.startsWith('/api/v1/class-subjects?class_id=3') ? Promise.resolve({ ok: true, data: [{ id: 77, name: 'Junior Offering', status: 'active' }] }) : undefined }).start(); await settle();
  const modal = await h.add('assignments'), form = modal.body.querySelector('form'), control = form.elements.namedItem('class_id');
  control.value = '2'; const first = control.listeners.change(); await settle();
  control.value = '3'; await control.listeners.change(); await settle();
  resolve({ ok: true, data: [{ id: 20, name: 'Stale Offering', status: 'active' }] }); await first; await settle();
  assert.equal(control.value, '3'); assert.match(form.elements.namedItem('subject_id').innerHTML, /Junior Offering/);
  assert.doesNotMatch(form.elements.namedItem('subject_id').innerHTML, /Stale Offering/);
});

test('invalid timetable records produce an honest error instead of invented days, times or cross-class lessons', async () => {
  const lesson = fixtures()['/api/v1/timetable/by-class'][2];
  for (const invalid of [
    { ...lesson, day_of_week: 0 },
    { ...lesson, start_time: 'unknown' },
    { ...lesson, end_time: '07:59:00' },
    { ...lesson, start_time: '08:00', end_time: '08:00:00' },
    { ...lesson, class_id: 3 },
  ]) {
    const h = harness({ get: async url => url.startsWith('/api/v1/timetable/by-class?') ? { ok: true, data: [invalid] } : undefined }).start(); await settle();
    await h.change('timetableClass', '2'); const html = h.ids.get('academicData_timetable').innerHTML;
    assert.match(html, /could not be loaded|unexpected response/i);
    assert.doesNotMatch(html, /academic-week-grid|Early Mathematics|Unknown day/);
    assert.equal(h.ids.get('academicData_timetable').attrs['aria-busy'], 'false');
  }
});

test('null collection records are rejected safely without replacing other academic sections', async () => {
  const h = harness({ get: async url => url === '/api/v1/subjects' || url.startsWith('/api/v1/teacher-assignments?') ? { ok: true, data: [null] } : undefined }).start(); await settle();
  assert.match(h.ids.get('academicData_subjects').innerHTML, /could not be loaded|unexpected response/i);
  assert.match(h.ids.get('academicData_assignments').innerHTML, /could not be loaded|unexpected response/i);
  assert.match(h.ids.get('academicData_classes').innerHTML, /Grade Six/);
  assert.equal(h.ids.get('academicData_subjects').attrs['aria-busy'], 'false');
});

test('serialized Nairobi-midnight dates render and edit as school calendar dates without shifted PATCH fields', async () => {
  for (const key of ['years', 'terms']) {
    const data = fixtures();
    data['/api/v1/academic-years'] = data['/api/v1/academic-years'].slice(0, 1);
    data['/api/v1/terms'] = data['/api/v1/terms'].slice(0, 1);
    data['/api/v1/academic-years'][0].start_date = '2025-12-31T21:00:00Z';
    data['/api/v1/academic-years'][0].end_date = '2026-12-30T21:00:00Z';
    data['/api/v1/terms'][0].start_date = '2025-12-31T21:00:00Z';
    data['/api/v1/terms'][0].end_date = '2026-04-09T21:00:00Z';
    const h = harness({ data }).start(); await settle();
    const html = h.ids.get('academicData_' + key).innerHTML;
    assert.match(html, /datetime="2026-01-01">1 Jan 2026/);
    assert.doesNotMatch(html, /datetime="2025-12-31"/);
    const modal = await h.action('edit_' + key, key === 'years' ? 1 : 11);
    const form = modal.body.querySelector('form');
    assert.equal(form.elements.namedItem('start_date').value, '2026-01-01');
    assert.equal(form.elements.namedItem('end_date').value, key === 'years' ? '2026-12-31' : '2026-04-10');
    await h.submit(modal, { name: 'Renamed calendar period' });
    assert.equal(h.writes.length, 1); assert.equal(h.writes[0].method, 'patch');
    assert.equal(h.writes[0].url, key === 'years' ? '/api/v1/academic-years/1' : '/api/v1/terms/11');
    assert.deepEqual(h.writes[0].body, { name: 'Renamed calendar period' });
    assert.equal(h.errors.length, 0);
  }
});
