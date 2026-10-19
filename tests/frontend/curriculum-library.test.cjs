// Static safety contracts for the administrator-only curriculum interface.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const root = path.resolve(__dirname, '../..');
const page = fs.readFileSync(path.join(root, 'public/curriculum-library.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'public/assets/curriculum-library.js'), 'utf8');

test('curriculum library page uses shared shell and local module', () => {
  assert.match(page, /assets\/app\.js/);
  assert.match(page, /assets\/nav\.js/);
  assert.match(page, /assets\/curriculum-library\.js/);
  assert.match(source, /user\.role !== 'system_admin'/);
  assert.match(source, /renderAppShell\('\/curriculum-library\.html'\)/);
});

test('curriculum registration preserves authorization and verification gates', () => {
  assert.match(source, /Integrated-Science-Grade-7-Design-Formatted-April-2024\.pdf/);
  assert.match(source, /does not download, index, reproduce, verify, or approve/);
  assert.match(source, /rights_confirmed/);
  assert.match(source, /application\/pdf/);
  assert.match(source, /document_sha256/);
  assert.match(source, /review_content_sha256/);
  assert.match(source, /actual_document_checked: true/);
  assert.match(source, /authorized_use_confirmed: true/);
  assert.match(source, /withdraw/);
});

test('curriculum UI uses only protected API endpoints and escaped provenance', () => {
  assert.match(source, /\/api\/v1\/curriculum-library\/sources/);
  assert.match(source, /versions\/.*\/records/);
  assert.match(source, /MGAEMS\.upload/);
  assert.match(source, /MGAEMS\.download/);
  assert.match(source, /esc\(source\.official_url\)/);
  assert.doesNotMatch(source, /\/storage\/curriculum/);
});

const flush = () => new Promise(resolve => setImmediate(resolve));
const fixture = () => ({ id: 1, identifier: 'synthetic-library', title: 'Synthetic curriculum fixture', official_url: 'https://example.invalid/source', publisher: 'Synthetic publisher', grade: 7, learning_area: 'Integrated Science', subject_id: 4, versions: [] });
const subjects = [{ id: 4, name: 'Integrated <Science>', code: 'SCIE' }];
async function libraryHarness(subjectReply = { ok: true, data: subjects }, version = null) {
  const h = createDOM('system_admin', '/curriculum-library.html');
  h.writes = []; h.downloads = [];
  h.app.toast = () => {};
  h.app.get = async url => {
    if (url === '/api/v1/curriculum-library/sources') return { ok: true, data: { data: [fixture()] } };
    if (url === '/api/v1/subjects') return subjectReply;
    if (url === '/api/v1/curriculum-library/versions/2') return { ok: true, data: { version, review_content_sha256: 'b'.repeat(64) } };
    throw new Error('Unexpected GET ' + url);
  };
  h.app.put = h.app.post = async (url, body) => { h.writes.push({ url, body }); return { ok: true, data: { id: 1 } }; };
  h.app.download = async (...args) => { h.downloads.push(args); };
  h.run('curriculum-library.js'); await flush();
  h.action = async (action, extra = {}) => {
    h.ids.get('appMain').listeners.click({ target: { closest: () => ({ dataset: { curriculumAction: action, source: '1', ...extra } }) } });
    await flush(); return h.modals.at(-1);
  };
  return h;
}

test('editing source metadata keeps its linked subject and escapes subject labels', async () => {
  const h = await libraryHarness();
  const modal = await h.action('edit-source');
  const form = modal.body.querySelector('form');
  assert.equal(form.elements.subject_id.value, '4');
  assert.match(form.elements.subject_id.innerHTML, /Integrated &lt;Science&gt;/);
  form.elements.title.value = 'Corrected synthetic title';
  await modal.overlay.querySelector('#saveCurriculumSource').listeners.click();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].url, '/api/v1/curriculum-library/sources/1');
  assert.equal(h.writes[0].body.subject_id, 4);
  assert.equal(h.writes[0].body.title, 'Corrected synthetic title');
  assert.equal(modal.closed, true);
});

test('explicitly selecting Not linked sends null instead of silently retaining the link', async () => {
  const h = await libraryHarness();
  const modal = await h.action('edit-source');
  modal.body.querySelector('form').elements.subject_id.value = '';
  await modal.overlay.querySelector('#saveCurriculumSource').listeners.click();
  assert.equal(h.writes[0].body.subject_id, null);
});

test('new source registration can link an existing subject without creating a subject', async () => {
  const h = await libraryHarness();
  h.ids.get('registerSource').listeners.click({ currentTarget: h.ids.get('registerSource') });
  await flush();
  const modal = h.modals.at(-1);
  modal.body.querySelector('form').elements.subject_id.value = '4';
  await modal.overlay.querySelector('#saveCurriculumSource').listeners.click();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].url, '/api/v1/curriculum-library/sources');
  assert.equal(h.writes[0].body.subject_id, 4);
});

test('failed or malformed subject lookups preserve the existing link on metadata saves', async () => {
  for (const reply of [{ ok: false, error: 'Unavailable' }, { ok: true, data: [{ id: 'bad', name: 'Invalid' }] }]) {
    const h = await libraryHarness(reply);
    const modal = await h.action('edit-source');
    assert.equal(modal.body.querySelector('form').elements.subject_id.disabled, true);
    assert.match(modal.body.querySelector('#curriculumSubjectNotice').textContent, /will be preserved/);
    await modal.overlay.querySelector('#saveCurriculumSource').listeners.click();
    assert.equal(h.writes[0].body.subject_id, 4);
  }
});

test('a pending lookup cannot clear the link or repaint a closed source dialog', async () => {
  let finish;
  const h = await libraryHarness(new Promise(resolve => { finish = resolve; }));
  const modal = await h.action('edit-source');
  const control = modal.body.querySelector('form').elements.subject_id;
  const initial = control.innerHTML;
  await modal.overlay.querySelector('#saveCurriculumSource').listeners.click();
  assert.equal(h.writes[0].body.subject_id, 4);
  assert.equal(modal.closed, true);
  finish({ ok: true, data: subjects }); await flush();
  assert.equal(control.innerHTML, initial);
});

for (const approval_status of ['draft', 'approved']) {
  test(`${approval_status} edition review displays every extraction field and keeps PDF access protected`, async () => {
    const version = { id: 2, source: fixture(), edition: 'Synthetic edition', approval_status, verification_status: approval_status === 'draft' ? 'pending' : 'verified',
      authorization_basis: 'Original synthetic fixture <only>', verification_notes: 'Synthetic notes', document_sha256: 'a'.repeat(64),
      records: [{ record_key: 'synthetic.1', strand: 'Synthetic strand', sub_strand: 'Synthetic sub-strand', page_reference: 'Synthetic page 1',
        outcomes: [{ description: 'Synthetic outcome <checked>' }], suggested_learning_experiences: ['Synthetic experience <checked>'],
        key_inquiry_questions: ['Synthetic inquiry <checked>'], assessment_approaches: ['Synthetic assessment <checked>'] }] };
    const h = await libraryHarness(undefined, version);
    const modal = await h.action('version-detail', { version: '2' });
    for (const text of ['Synthetic outcome', 'Synthetic experience', 'Synthetic inquiry', 'Synthetic assessment']) assert.ok(modal.body.innerHTML.includes(text + ' &lt;checked&gt;'));
    assert.match(modal.body.innerHTML, /Original synthetic fixture &lt;only&gt;/);
    assert.match(modal.body.innerHTML, /Subject #4/);
    assert.equal(Boolean(modal.body.querySelector('#showApproval')), approval_status === 'draft');
    assert.equal(h.writes.length, 0, 'review never approves or imports automatically');
    await modal.body.querySelector('#downloadCurriculumPdf').listeners.click();
    assert.equal(h.downloads[0][0], '/api/v1/curriculum-library/versions/2/document');
  });
}
