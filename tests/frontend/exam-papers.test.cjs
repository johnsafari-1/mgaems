// Static workflow contracts for the responsive Exam Paper Studio.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'public/assets/exam-papers.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/assets/exam-papers.css'), 'utf8');

test('Exam Studio has a responsive outline, authoring, and A4 preview workspace', () => {
  assert.match(source, /exam-studio/);
  assert.match(source, /exam-outline/);
  assert.match(source, /exam-preview-paper/);
  assert.match(source, /Learner view/);
  assert.match(source, /Staff marking view/);
  assert.match(css, /grid-template-columns: minmax\(190px/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media print/);
  assert.match(source, /Version/);
  assert.match(source, /revision_number/);
});

test('Exam Studio preserves staff-only answers and existing paper APIs', () => {
  assert.match(source, /answer_key/);
  assert.match(source, /marking_guidance/);
  assert.match(source, /exam_paper_attachment_id/);
  assert.match(source, /\/attachments\//);
  assert.match(source, /\/sections\//);
  assert.match(source, /duplicate/);
  assert.match(source, /delete-question/);
  assert.match(source, /'essay'/);
  assert.doesNotMatch(source, /\/storage\/exam-papers/);
});

test('Curriculum-grounded AI drafts require a checked provider and never auto-save a paper', () => {
  assert.match(source, /\/api\/v1\/ai-teaching\/status/);
  assert.match(source, /operation: 'exam_paper'/);
  assert.match(source, /Curriculum-grounded AI is disabled or unavailable/);
  assert.match(source, /never overwrites this paper/);
  assert.match(source, /selection, constraints/);
});

test('paper-outline rendering completes with representative data and no exceptions', async () => {
  const h = createDOM('teacher', '/exam-papers.html');
  const assignment = { school_class: { name: 'Grade 7A' }, subject: { name: 'Mathematics' }, term: { academic_year: { name: '2026' }, name: 'Term 2' } };
  const paper = {
    id: 1, class_subject_teacher_id: 1, examination_type: 'end_term', title: 'Mathematics Mid-Term',
    status: 'draft', exam_date: '2026-05-01', duration_minutes: 90, revision_number: 3, question_count: 2, total_marks: 15,
    instructions: 'Answer all questions.', review_notes: null, submitted_at: null, reviewed_at: null, published_at: null,
    assignment,
    sections: [{ id: 10, position: 1, title: 'Section A', instructions: 'Multiple choice' }],
    questions: [
      { id: 100, exam_paper_section_id: 10, exam_paper_attachment_id: null, position: 1, question_type: 'multiple_choice', prompt: 'What is 2 + 2?', marks: 5, diagram_reference: null, options: ['3', '4', '5', '6'], answer_key: '4', marking_guidance: 'Award 5 for the correct option.', ai_generated: false, ai_source: null, attachment: null },
      { id: 101, exam_paper_section_id: null, exam_paper_attachment_id: null, position: 2, question_type: 'essay', prompt: 'Explain linear equations.', marks: 10, diagram_reference: null, options: [], answer_key: 'y = mx + c', marking_guidance: 'Award marks for method.', ai_generated: false, ai_source: null, attachment: null },
    ],
    attachments: [],
  };
  h.app.get = async (url) => {
    if (url.endsWith('/context')) return { ok: true, data: { scope: 'assigned', assignments: [{ id: 1, ...assignment }], examination_types: ['end_term'] } };
    if (url === '/api/v1/exam-papers') return { ok: true, data: [{ id: 1, title: paper.title, status: 'draft', examination_type: 'end_term', question_count: 2, total_marks: 15, revision_number: 3, assignment }] };
    if (url.endsWith('/exam-papers/1')) return { ok: true, data: paper };
    return { ok: false, error: 'unexpected url: ' + url };
  };
  h.run('exam-papers.js');
  await new Promise(resolve => setTimeout(resolve, 0));
  const main = h.document.getElementById('appMain');
  assert.ok(main, 'appMain is rendered by the studio shell');
  const openButton = { dataset: { exam: 'open', id: '1' } };
  const event = { target: { closest: selector => (selector === '[data-exam]' ? openButton : null) } };
  await main.listeners.click(event);
  const html = h.document.getElementById('examDetail').innerHTML;
  assert.match(html, /Paper structure/);
  assert.match(html, /Section A/);
  assert.match(html, /Unsectioned/);
  assert.match(html, /What is 2 \+ 2\?/);
  assert.match(html, /Explain linear equations\./);
  assert.match(html, /Version 3/);
  assert.doesNotMatch(html, /undefined|\[object Object\]/);
});
