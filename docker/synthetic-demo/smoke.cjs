// Real HTTP checks restricted to the loopback synthetic demo. No school credentials.
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:8010';
(async () => {
  const guide = await fetch(base + '/demo');
  assert.equal(guide.status, 200);
  assert.equal(guide.headers.get('x-mgaems-synthetic-demo'), 'original-science-v1');
  assert.match(await guide.text(), /synthetic teaching demo/);
  const loginPage = await fetch(base + '/login.html');
  assert.match(await loginPage.text(), /\/__demo\/ui\.js/);
  let token;
  const api = async (path, body) => {
    const response = await fetch(base + '/api/v1/' + path, { method: body ? 'POST' : 'GET',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    assert.ok(response.ok, path + ': ' + JSON.stringify(data));
    return data.data;
  };
  token = (await api('auth/login', { username: 'demo.teacher', password: 'DemoOnly!2026' })).token;
  try {
    assert.equal((await api('me')).username, 'demo.teacher');
    const status = await api('ai-teaching/status');
    assert.equal(status.provider, 'synthetic_demo');
    assert.equal(status.capabilities.grounded, true);
    const assignment = (await api('schemes-of-work/context')).assignments.find(row => row.subject?.name === 'Integrated Science');
    assert.ok(assignment);
    const curriculum = await api('curriculum-library/retrieve?grade=7&learning_area=Integrated%20Science&subject_id=' + assignment.subject_id);
    assert.equal(curriculum.available, true);
    assert.equal(curriculum.records[0].record_key, 'original.temperature.1');
    for (const page of ['schemes-of-work', 'lesson-plans', 'homework', 'exam-papers']) {
      const response = await fetch(base + '/' + page + '.html');
      assert.equal(response.status, 200);
      assert.match(await response.text(), /\/__demo\/ui\.js/);
      const context = await api(page + '/context');
      assert.equal(context.scope, 'assigned');
      assert.ok(context.assignments.some(row => row.subject_id === assignment.subject_id));
      const documents = await api(page);
      assert.ok(documents.some(row => row.title.startsWith('DEMO - Temperature') && row.status === 'draft'));
      console.log('PASS real HTTP ' + page + ' page, assigned context and prepared draft');
    }
    console.log('PASS browser demo HTTP login, provider status and original curriculum retrieval');
  } finally { await api('auth/logout', {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
