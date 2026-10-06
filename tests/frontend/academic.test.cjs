// Academic page rendering/role tests in a DOM interface harness, not a browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = name => fs.readFileSync(path.resolve(__dirname, '../../public/assets', name), 'utf8');

function harness(role, fail = null) {
  const elements = new Map();
  const requests = [];
  const attributes = new Map();
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    let html = '';
    const result = { value: '', disabled: false, listeners: {}, setAttribute() {}, querySelectorAll: () => [],
      addEventListener(name, handler) { this.listeners[name] = handler; },
      querySelector: () => ({ addEventListener() {} }),
      get innerHTML() { return html; },
      set innerHTML(value) { html = value; for (const match of value.matchAll(/id="([^"]+)"/g)) element(match[1]); },
    };
    elements.set(id, result); return result;
  }
  const document = { getElementById: id => elements.get(id) || null, querySelectorAll: () => [],
    documentElement: { setAttribute: (name, value) => attributes.set(name, value), getAttribute: name => attributes.get(name) } };
  const context = vm.createContext({ document, window: { location: { pathname: '/academic.html', href: '/academic.html' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    localStorage: { getItem: key => key === 'mgaems_token' ? 'test-session' : key === 'mgaems_user' ? JSON.stringify({ username: 'test-user', role }) : null }, URLSearchParams, setTimeout,
    renderAppShell() { element('appMain'); } });
  vm.runInContext(source('app.js'), context);
  const app = vm.runInContext('MGAEMS', context);
  const responses = {
    '/api/v1/academic-years': [{ id: 1, name: '<Year>', start_date: '2026-01-01', end_date: '2026-12-31', is_current: false }],
    '/api/v1/terms': [],
    '/api/v1/classes': [{ id: 1, name: '<Class>', level: 'primary', sequence: 1, capacity: 30, students_count: 0, subjects_count: 0, class_teacher: { first_name: '<Teacher>', last_name: 'Name' } }],
    '/api/v1/subjects': [{ id: 1, name: '<Area>', code: '<Code>', learning_area: '<Category>', status: 'active' }],
    '/api/v1/teacher-assignments': [],
  };
  app.get = async url => { requests.push(url); return url.split('?')[0] === fail ? { ok: false, status: 503, error: '<Unavailable>' } : { ok: true, data: responses[url.split('?')[0]] || [] }; };
  vm.runInContext(source('academic.js'), context);
  return { context, elements, requests };
}

test('teacher academic view remains read-only and does not request HR/administration data', async () => {
  const h = harness('teacher'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests.length, 4);
  assert.equal(h.requests.some(url => /staff|teacher-assignments|timetable/.test(url)), false);
  assert.doesNotMatch(h.elements.get('appMain').innerHTML, /data-add=|data-tab="assignments"/);
  assert.match(h.elements.get('academicData_classes').innerHTML, /View offerings/);
  assert.doesNotMatch(h.elements.get('academicData_classes').innerHTML, /delete_classes|edit_classes/);
});

test('leadership view separates offerings from term allocations and escapes API text', async () => {
  const h = harness('head_teacher'); await new Promise(resolve => setImmediate(resolve));
  assert.match(h.elements.get('appMain').innerHTML, /data-tab="assignments"/);
  assert.match(h.elements.get('academicData_classes').innerHTML, /Manage offerings/);
  assert.match(h.elements.get('academicData_classes').innerHTML, /&lt;Class&gt;/);
  assert.match(h.elements.get('academicData_classes').innerHTML, /&lt;Teacher&gt;/);
  assert.match(h.elements.get('academicData_subjects').innerHTML, /&lt;Area&gt;|&lt;Category&gt;/);
  assert.doesNotMatch(h.elements.get('academicData_subjects').innerHTML, /<Area>|<Category>/);
  assert.equal(h.requests.some(url => url === '/api/v1/staff'), false);
  assert.equal(h.requests.some(url => url.startsWith('/api/v1/teacher-assignments')), true);
});

test('one unavailable API leaves other academic sections usable', async () => {
  const h = harness('head_teacher', '/api/v1/terms'); await new Promise(resolve => setImmediate(resolve));
  assert.match(h.elements.get('academicData_terms').innerHTML, /&lt;Unavailable&gt;/);
  assert.match(h.elements.get('academicData_terms').innerHTML, /Try again/);
  assert.match(h.elements.get('academicData_years').innerHTML, /&lt;Year&gt;/);
  assert.equal(h.elements.get('add_assignments').disabled, true);
});

test('parent and sponsor users return to their portal without academic API requests', () => {
  for (const role of ['parent_guardian', 'sponsor']) {
    const h = harness(role);
    assert.equal(h.requests.length, 0);
    assert.equal(h.elements.has('appMain'), false);
    assert.match(vm.runInContext('window.location.href', h.context), /portal\.html$/);
  }
});
