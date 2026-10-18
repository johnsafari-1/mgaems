// Static safety contracts for the administrator-only curriculum interface.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
