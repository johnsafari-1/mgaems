// Curriculum-grounded AI drafting: shared helper behaviour and module wiring.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const root = path.resolve(__dirname, '../..');
const flush = () => new Promise(resolve => setImmediate(resolve));
const read = name => fs.readFileSync(path.join(root, 'public/assets', name), 'utf8');

test('the shared helper gates generation on verified curriculum and reports an unavailable state', async () => {
  const h = createDOM('teacher', '/homework.html');
  let posts = 0;
  h.app.get = async url => url === '/api/v1/ai-teaching/status'
    ? { ok: true, data: { available: true, provider: 'ollama', capabilities: { grounded: false, curriculum_library: false } } }
    : { ok: false, error: 'unexpected' };
  h.app.post = async () => { posts += 1; return { ok: false }; };
  const modal = h.app.groundedDraft({ operation: 'homework', documentType: 'homework', documentId: 4, classSubjectTeacherId: 9 });
  const form = modal.body.querySelector('[data-grounded-form]');
  form.elements.grade.value = '7';
  form.elements.learning_area.value = 'Mathematics';
  await modal.overlay.querySelector('[data-grounded-request]').listeners.click();
  assert.equal(posts, 0, 'no draft is requested when the curriculum library is not installed');
  assert.match(modal.body.querySelector('[data-draft-result]').innerHTML, /not installed/);
  assert.equal(modal.overlay.querySelector('[data-grounded-import]').hidden, true);
});

test('the shared helper keeps output editable, blocks invalid JSON and imports only on explicit confirmation', async () => {
  const h = createDOM('teacher', '/schemes-of-work.html');
  const posts = [];
  h.app.get = async url => url === '/api/v1/ai-teaching/status'
    ? { ok: true, data: { available: true, provider: 'ollama', capabilities: { grounded: true } } }
    : { ok: false, error: 'unexpected' };
  h.app.post = async (url, body) => { posts.push({ url, body }); return { ok: true, data: { run_id: 7, label: 'AI-generated draft (test)', disclosure: 'Review required.', draft: { status: 'draft', week: 1 } } }; };
  h.app.toast = () => {};
  let imported = null;
  const modal = h.app.groundedDraft({ operation: 'scheme_of_work', title: 'Grounded', documentType: 'scheme_of_work', documentId: 3, classSubjectTeacherId: 9, selection: { learning_area: 'Mathematics' }, constraints: { total_duration_minutes: 80 }, onImport: draft => { imported = draft; return { ok: true, message: 'imported' }; } });
  const form = modal.body.querySelector('[data-grounded-form]');
  form.elements.grade.value = '7';
  form.elements.learning_area.value = 'Mathematics';
  await modal.overlay.querySelector('[data-grounded-request]').listeners.click();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/api/v1/ai-teaching/drafts');
  assert.equal(posts[0].body.input.selection.grade, 7);
  assert.equal(posts[0].body.input.selection.learning_area, 'Mathematics');
  assert.equal(posts[0].body.input.selection.class_subject_teacher_id, 9);
  assert.equal(posts[0].body.input.constraints.total_duration_minutes, 80);
  assert.equal(posts[0].body.document_type, 'scheme_of_work');
  assert.equal(posts[0].body.document_id, 3);
  const textarea = modal.body.querySelector('[data-draft-json]');
  assert.match(textarea.value, /"week": 1/);
  textarea.value = '{ not json';
  await modal.overlay.querySelector('[data-grounded-import]').listeners.click();
  assert.equal(imported, null, 'invalid JSON is rejected');
  assert.match(form.querySelector('[data-form-error]').innerHTML, /not valid JSON/);
  textarea.value = JSON.stringify({ ok: true });
  await modal.overlay.querySelector('[data-grounded-import]').listeners.click();
  assert.equal(imported.ok, true);
  assert.ok(posts.some(post => post.url === '/api/v1/ai-teaching/runs/7/accept'), 'a confirmed import records acceptance against the AiGenerationRun');
  assert.equal(modal.closed, true, 'the modal closes only after a confirmed import');
});

test('scheme grounded import reconciles a lost save response without duplicating the week', async () => {
  const h = createDOM('teacher', '/schemes-of-work.html');
  const assignment = { id: 11, class_id: 2, subject_id: 3, term_id: 4, school_class: { id: 2, name: 'Grade 7A' }, subject: { id: 3, name: 'Mathematics' }, term: { id: 4, name: 'Term 2', academic_year: { id: 1, name: '2026' } } };
  const summary = { id: 9, class_subject_teacher_id: 11, title: 'Fractions scheme', curriculum_reference: '', status: 'draft', updated_at: '2026-02-01T12:00:00Z', assignment };
  const detail = { ...summary, weeks: [] };
  const draft = {
    status: 'draft', grade: 7, learning_area: 'Mathematics', title: 'Fractions', curriculum_claims: [],
    curriculum_references: [{ record_id: 5, source_version_id: 2, document_sha256: 'a'.repeat(64), page_reference: 'p1', outcome_ids: [50] }],
    specific_learning_outcomes: [{ id: 50, text: 'Add fractions' }], total_duration_minutes: 80,
    weeks: [{ curriculum_record_ids: [5], learning_outcome_ids: [50], week_number: 1, strand: 'Numbers', sub_strand: 'Fractions', lessons_per_week: 2, lesson_duration_minutes: 40, total_duration_minutes: 80, learning_activities: ['Add like fractions'], resources: ['Fraction charts'], assessment_approach: 'Observation' }],
  };
  const posts = [];
  h.app.get = async url => {
    if (url === '/api/v1/schemes-of-work/context') return { ok: true, data: { scope: 'assigned', assignments: [assignment] } };
    if (url === '/api/v1/schemes-of-work') return { ok: true, data: [summary] };
    if (url === '/api/v1/schemes-of-work/9') return { ok: true, data: detail };
    if (url === '/api/v1/ai-teaching/status') return { ok: true, data: { available: true, capabilities: { grounded: true } } };
    throw new Error('Unexpected request ' + url);
  };
  h.app.post = async (url, body) => {
    posts.push({ url, body });
    if (url === '/api/v1/ai-teaching/drafts') return { ok: true, data: { run_id: 1, label: 'AI-generated draft (test)', disclosure: 'Review required.', draft } };
    if (url === '/api/v1/schemes-of-work/9/weeks') {
      detail.weeks.push({ id: 1, ...body });
      return { ok: false, error: 'Response lost after save' };
    }
    if (url === '/api/v1/ai-teaching/runs/1/accept') return { ok: true, data: { id: 1, state: 'accepted' } };
    throw new Error('Unexpected post ' + url);
  };
  h.app.toast = () => {};
  h.run('schemes-of-work.js');
  await flush();
  const viewButton = { dataset: { schemeAction: 'view', id: '9' }, disabled: false };
  await h.ids.get('appMain').listeners.click({ target: { closest: selector => (selector === '[data-scheme-action]' ? viewButton : null) } });
  await flush();
  assert.match(h.ids.get('schemeDetail').innerHTML, /Generate weekly plans \(AI\)/);
  const aiButton = h.ids.get('aiSchemeWeeks');
  aiButton.listeners.click({ currentTarget: aiButton });
  const modal = h.modals.at(-1);
  const form = modal.body.querySelector('[data-grounded-form]');
  assert.equal(form.elements.learning_area.value, 'Mathematics');
  form.elements.grade.value = '7';
  await modal.overlay.querySelector('[data-grounded-request]').listeners.click();
  assert.equal(posts.filter(post => post.url === '/api/v1/schemes-of-work/9/weeks').length, 0, 'no week is written before the teacher confirms the import');
  await modal.overlay.querySelector('[data-grounded-import]').listeners.click();
  await flush();
  assert.equal(modal.closed, false, 'an uncertain save leaves the modal open for reconciliation');
  assert.equal(posts.filter(post => post.url.endsWith('/accept')).length, 0);
  await modal.overlay.querySelector('[data-grounded-import]').listeners.click();
  await flush();
  const weekPosts = posts.filter(post => post.url === '/api/v1/schemes-of-work/9/weeks');
  assert.equal(weekPosts.length, 1);
  assert.equal(weekPosts[0].body.week_number, 1);
  assert.equal(weekPosts[0].body.strand, 'Numbers');
  assert.equal(weekPosts[0].body.learning_outcomes, 'Add fractions');
  assert.equal(weekPosts[0].body.resources, 'Fraction charts');
  assert.equal(detail.weeks.length, 1);
  assert.equal(modal.closed, true);
  assert.ok(posts.some(post => post.url === '/api/v1/ai-teaching/runs/1/accept'), 'the confirmed import records AiGenerationRun acceptance');
});

test('homework grounded import retries safely without duplicating already-written questions', async () => {
  const h = createDOM('teacher', '/homework.html');
  const assignment = { id: 11, class_id: 2, subject_id: 3, term_id: 4, school_class: { id: 2, name: 'Grade 7A' }, subject: { id: 3, name: 'Mathematics' }, term: { id: 4, name: 'Term 2', academic_year: { id: 1, name: '2026' } } };
  const summary = { id: 7, class_subject_teacher_id: 11, title: 'Fractions homework', status: 'draft', due_on: '2026-03-01', question_count: 0, total_marks: 10, assignment, completion_counts: { recorded: 0 }, eligible_learner_count: 0, submission_method: 'exercise_book' };
  const context = { scope: 'assigned', assignments: [assignment], lesson_plans: [], schemes: [], submission_methods: [] };
  const questions = [];
  const draft = {
    status: 'draft', instructions: 'Answer all questions.', total_marks: 10, specific_learning_outcomes: [{ text: 'Add fractions' }],
    questions: [
      { position: 1, question_type: 'short_answer', prompt: 'Q1 add 1/2 and 1/2', marks: 2, options: [], answer_key: '', marking_guidance: '' },
      { position: 2, question_type: 'short_answer', prompt: 'Q2 add 1/4 and 1/4', marks: 2, options: [], answer_key: '', marking_guidance: '' },
    ],
  };
  const posts = [];
  let failOnce = true;
  h.app.get = async url => {
    if (url === '/api/v1/homework/context') return { ok: true, data: context };
    if (url === '/api/v1/homework') return { ok: true, data: [summary] };
    if (url === '/api/v1/homework/7') return { ok: true, data: { ...summary, questions } };
    if (url === '/api/v1/ai-teaching/status') return { ok: true, data: { available: true, capabilities: { grounded: true } } };
    throw new Error('Unexpected get ' + url);
  };
  h.app.patch = async url => { if (url === '/api/v1/homework/7') return { ok: true, data: summary }; throw new Error('Unexpected patch ' + url); };
  h.app.post = async (url, body) => {
    posts.push({ url, body });
    if (url === '/api/v1/ai-teaching/drafts') return { ok: true, data: { run_id: 5, label: 'AI-generated draft (test)', disclosure: 'Review required.', draft } };
    if (url === '/api/v1/homework/7/questions') {
      if (failOnce && body.prompt === 'Q2 add 1/4 and 1/4') { failOnce = false; return { ok: false, error: 'The question could not be saved.' }; }
      const question = { id: 100 + questions.length, ...body };
      questions.push(question); return { ok: true, data: question };
    }
    if (url === '/api/v1/ai-teaching/runs/5/accept') return { ok: true, data: { id: 5, state: 'accepted' } };
    throw new Error('Unexpected post ' + url);
  };
  h.app.toast = () => {};
  h.run('homework.js');
  await flush();
  const aiControl = { dataset: { homeworkAction: 'ai', id: '7' }, disabled: false };
  h.ids.get('appMain').listeners.click({ target: { closest: selector => (selector === '[data-homework-action]' ? aiControl : null) } });
  const modal = h.modals.at(-1);
  modal.body.querySelector('[data-grounded-form]').elements.grade.value = '7';
  await modal.overlay.querySelector('[data-grounded-request]').listeners.click();
  await modal.overlay.querySelector('[data-grounded-import]').listeners.click();
  await flush();
  assert.equal(questions.length, 1, 'the first attempt stops after the failing question');
  assert.equal(modal.closed, false, 'the modal stays open so the teacher can retry');
  questions[0].prompt = 'Concurrent teacher edit';
  await modal.overlay.querySelector('[data-grounded-import]').listeners.click();
  assert.equal(questions.length, 1, 'a concurrent change is not overwritten or duplicated');
  assert.match(modal.body.querySelector('[data-form-error]').innerHTML, /changed during import/);
  questions[0].prompt = 'Q1 add 1/2 and 1/2';
  await modal.overlay.querySelector('[data-grounded-import]').listeners.click();
  await flush();
  assert.deepEqual(questions.map(question => question.prompt), ['Q1 add 1/2 and 1/2', 'Q2 add 1/4 and 1/4'], 'the retry skips the question already written');
  assert.deepEqual(questions.map(question => question.position), [1, 2]);
  assert.equal(posts.filter(post => post.url === '/api/v1/ai-teaching/runs/5/accept').length, 1, 'acceptance is recorded once the import finally succeeds');
});

test('every teaching module exposes a grounded entry point wired to the shared helper', () => {
  assert.match(read('schemes-of-work.js'), /MGAEMS\.groundedDraft\(/);
  assert.match(read('schemes-of-work.js'), /operation: 'scheme_of_work'/);
  assert.match(read('schemes-of-work.js'), /aiSchemeWeeks/);
  assert.match(read('lesson-plans.js'), /MGAEMS\.groundedDraft\(/);
  assert.match(read('lesson-plans.js'), /operation: 'lesson_plan'/);
  assert.match(read('lesson-plans.js'), /data-plan-action="ai"/);
  assert.match(read('homework.js'), /MGAEMS\.groundedDraft\(/);
  assert.match(read('homework.js'), /operation: 'homework'/);
  assert.match(read('homework.js'), /data-homework-action="ai"/);
  assert.match(read('exam-papers.js'), /MGAEMS\.groundedDraft\(/);
  assert.match(read('exam-papers.js'), /operation: 'exam_paper'/);
  assert.match(read('app.js'), /groundedDraft/);
  assert.match(read('app.js'), /\/api\/v1\/ai-teaching\/status/);
  assert.match(read('app.js'), /\/api\/v1\/ai-teaching\/runs\//, 'the helper records acceptance on a confirmed import');
});

test('grounded imports re-read live state so a retry never duplicates written rows', () => {
  assert.match(read('schemes-of-work.js'), /fresh\.ok/, 'scheme import re-reads the live week numbers');
  assert.match(read('schemes-of-work.js'), /skipped/, 'scheme import reports skipped weeks');
  assert.match(read('homework.js'), /draftRowMatches\(existing, values\)/, 'homework import checks the complete saved question');
  assert.match(read('exam-papers.js'), /existingSections/, 'exam import reuses sections already written');
  assert.match(read('exam-papers.js'), /draftRowMatches\(existing, values\)/, 'exam import checks the complete saved question');
});

test('acceptance retries do not repeat imports, and double-clicks are ignored while saving', async () => {
  const h = createDOM('teacher', '/lesson-plans.html');
  h.app.toast = () => {};
  h.app.get = async () => ({ ok: true, data: { available: true, capabilities: { grounded: true } } });
  let imported = 0, accepted = 0, finishImport;
  h.app.post = async url => {
    if (url.endsWith('/drafts')) return { ok: true, data: { run_id: 19, draft: { title: 'Synthetic plan' } } };
    accepted += 1;
    return accepted === 1 ? { ok: false, error: 'Network interrupted' } : { ok: true, data: { state: 'accepted' } };
  };
  const modal = h.app.groundedDraft({ operation: 'lesson_plan', selection: { grade: 7, learning_area: 'Synthetic science' }, onImport: async () => {
    imported += 1; await new Promise(resolve => { finishImport = resolve; }); return { ok: true };
  } });
  await modal.overlay.querySelector('[data-grounded-request]').listeners.click();
  const confirm = modal.overlay.querySelector('[data-grounded-import]');
  const pending = confirm.listeners.click();
  await confirm.listeners.click();
  assert.equal(imported, 1);
  finishImport(); await pending;
  assert.equal(modal.closed, false);
  assert.match(modal.body.querySelector('[data-form-error]').innerHTML, /acceptance was not confirmed/);
  assert.equal(confirm.textContent, 'Retry acceptance');
  await confirm.listeners.click();
  assert.equal(imported, 1, 'acceptance retry never invokes document import again');
  assert.equal(accepted, 2);
  assert.equal(modal.closed, true);
});

for (const operation of ['scheme_of_work', 'lesson_plan', 'homework', 'exam_paper']) {
  test(`${operation} is blocked when AI is disabled and recovers after an availability retry`, async () => {
    const h = createDOM('teacher');
    let checks = 0, writes = 0;
    h.app.get = async () => ({ ok: true, data: { available: ++checks > 1, capabilities: { grounded: checks > 1 } } });
    h.app.post = async () => { writes += 1; return { ok: true, data: { run_id: 1, draft: { title: 'Synthetic' } } }; };
    const modal = h.app.groundedDraft({ operation, selection: { grade: 7, learning_area: 'Synthetic science' } });
    await modal.overlay.querySelector('[data-grounded-request]').listeners.click();
    assert.equal(writes, 0);
    assert.match(modal.body.querySelector('[data-draft-result]').innerHTML, /disabled or not configured/);
    assert.equal(modal.overlay.querySelector('[data-grounded-import]').hidden, true);
    await modal.overlay.querySelector('[data-grounded-request]').listeners.click();
    assert.equal(writes, 1, 'availability is rechecked instead of caching an outage forever');
  });
}

test('exam retries reconcile a saved section and a lost question response without moving or duplicating them', async () => {
  const h = createDOM('teacher', '/exam-papers.html');
  const assignment = { school_class: { name: 'Synthetic Grade 7' }, subject: { name: 'Synthetic science' }, term: { name: 'Synthetic term' } };
  const paper = { id: 1, class_subject_teacher_id: 1, title: 'Synthetic pilot', status: 'draft', examination_type: 'end_term', assignment,
    sections: [], questions: [], attachments: [], total_marks: 4, question_count: 0 };
  let allowRead = true, loseSectionResponse = true, loseQuestionResponse = true, accepts = 0;
  const posts = [];
  const question = prompt => ({ question_type: 'short_answer', prompt, marks: 2, options: [], answer_key: 'Synthetic answer', marking_guidance: 'Synthetic guidance' });
  const draft = { sections: [{ position: 1, title: 'Synthetic section', questions: [question('Synthetic one'), question('Synthetic two')] }] };
  h.app.toast = () => {};
  h.app.get = async url => {
    if (url.endsWith('/context')) return { ok: true, data: { scope: 'assigned', assignments: [{ id: 1, ...assignment }] } };
    if (url.endsWith('/revisions')) return { ok: true, data: [] };
    if (url === '/api/v1/exam-papers') return { ok: true, data: [paper] };
    if (url === '/api/v1/exam-papers/1') return allowRead ? { ok: true, data: paper } : { ok: false, error: 'Offline' };
    if (url.endsWith('/ai-teaching/status')) return { ok: true, data: { available: true, capabilities: { grounded: true } } };
    throw new Error('Unexpected GET ' + url);
  };
  h.app.post = async (url, body) => {
    posts.push(url);
    if (url.endsWith('/drafts')) return { ok: true, data: { run_id: 21, draft } };
    if (url.endsWith('/sections')) {
      paper.sections.push({ id: 10, ...body });
      if (loseSectionResponse) { loseSectionResponse = false; return { ok: false, error: 'Response lost after save' }; }
      return { ok: true, data: paper };
    }
    if (url.endsWith('/questions')) {
      paper.questions.push({ id: 100 + paper.questions.length, ...body });
      if (loseQuestionResponse) { loseQuestionResponse = false; return { ok: false, error: 'Response lost after save' }; }
      return { ok: true, data: paper };
    }
    if (url.endsWith('/accept')) { accepts += 1; return { ok: true, data: { state: 'accepted' } }; }
    throw new Error('Unexpected POST ' + url);
  };
  h.run('exam-papers.js'); await flush();
  const click = dataset => h.ids.get('appMain').listeners.click({ target: { closest: selector => selector === '[data-exam]' ? { dataset } : null } });
  await click({ exam: 'open', id: '1' });
  await click({ exam: 'grounded-draft' });
  const modal = h.modals.at(-1);
  modal.body.querySelector('[data-grounded-form]').elements.grade.value = '7';
  await modal.overlay.querySelector('[data-grounded-request]').listeners.click();
  const confirm = modal.overlay.querySelector('[data-grounded-import]');
  allowRead = false;
  await confirm.listeners.click();
  assert.equal(paper.sections.length, 0, 'a failed fresh read must not fall back to stale state');
  allowRead = true;
  await confirm.listeners.click();
  assert.equal(paper.sections.length, 1);
  assert.equal(paper.questions.length, 0);
  await confirm.listeners.click();
  assert.equal(paper.questions.length, 1, 'the first question committed despite its lost response');
  await confirm.listeners.click(); await flush();
  assert.equal(paper.sections.length, 1, 'retry reuses the original fixed section position');
  assert.equal(paper.questions.length, 2, 'retry verifies the saved question and adds only the missing one');
  assert.deepEqual(paper.questions.map(row => row.position), [1, 2]);
  assert.ok(paper.questions.every(row => row.exam_paper_section_id === 10));
  assert.equal(accepts, 1);
  assert.equal(posts.filter(url => url.endsWith('/sections')).length, 1);
  assert.equal(modal.closed, true);
});
