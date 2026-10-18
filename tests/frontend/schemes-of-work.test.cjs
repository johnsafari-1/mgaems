const { test } = require('node:test');
const assert = require('node:assert/strict');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(role = 'teacher') {
  const h = createDOM(role, '/schemes-of-work.html'), requests = [];
  const assignment = { id: 11, class_id: 2, subject_id: 3, term_id: 4,
    school_class: { id: 2, name: '<Class>' }, subject: { id: 3, name: '<Learning Area>' }, staff: { id: 5, first_name: 'Assigned', last_name: 'Teacher' },
    term: { id: 4, name: '<Term>', academic_year: { id: 1, name: '<Year>' } } };
  h.app.get = async url => {
    requests.push(url);
    if (url === '/api/v1/schemes-of-work/context') return { ok: true, data: { scope: role === 'teacher' ? 'assigned' : 'school', assignments: [assignment] } };
    if (url === '/api/v1/schemes-of-work') return { ok: true, data: [{ id: 9, class_subject_teacher_id: 11, title: '<Scheme>', curriculum_reference: '<Source>', status: 'draft', updated_at: '2026-02-01T12:00:00Z', assignment }] };
    throw new Error('Unexpected request ' + url);
  };
  h.run('schemes-of-work.js');
  return { ...h, requests };
}

test('teacher scheme workspace loads only assigned context and escapes planning metadata', async () => {
  const h = harness(); await flush();
  assert.deepEqual(h.requests, ['/api/v1/schemes-of-work/context', '/api/v1/schemes-of-work']);
  assert.match(h.ids.get('schemeList').innerHTML, /&lt;Scheme&gt;|&lt;Class&gt;/);
  assert.doesNotMatch(h.ids.get('schemeList').innerHTML, /<Scheme>|<Class>/);
  assert.match(h.ids.get('appMain').innerHTML, /does not verify or claim official CBC alignment/);
  assert.equal(h.ids.get('createScheme').disabled, false);
});

test('non-teaching roles cannot initialize the scheme workspace or issue API requests', () => {
  for (const role of ['parent_guardian', 'sponsor', 'student', 'sponsor_coordinator']) {
    const h = harness(role);
    assert.deepEqual(h.requests, []);
    assert.equal(h.ids.has('appMain'), false);
  }
});
