// Static workflow contracts for the responsive Exam Paper Studio.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
