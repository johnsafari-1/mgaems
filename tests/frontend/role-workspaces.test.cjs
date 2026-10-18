// Static responsive/theme contracts complement DOM tests; no browser rendering claim.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../public');
const css = fs.readFileSync(path.join(root, 'assets/role-workspaces.css'), 'utf8');

test('role workspace pages load existing shell assets and the scoped responsive stylesheet', () => {
  for (const name of ['dashboard', 'students', 'teacher-timetable', 'parent-portal', 'sponsorship']) {
    const html = fs.readFileSync(path.join(root, name + '.html'), 'utf8');
    assert.match(html, /role-workspaces.css/); assert.match(html, /assets\/nav.js/);
    for (const [, asset] of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) assert.ok(fs.existsSync(path.join(root, asset)), asset);
  }
  for (const name of ['teacher-workspace', 'sponsorship-workspace']) {
    const source = fs.readFileSync(path.join(root, 'assets', name + '.js'), 'utf8');
    for (const [, url] of source.matchAll(/href="(\/[^"?]+\.html)(?:#[^"?]+)?"/g)) assert.ok(fs.existsSync(path.join(root, url)), url);
  }
});

test('role styling reflows lessons, responsibilities, family records and forms using shared theme tokens', () => {
  assert.doesNotMatch(css, /#[a-f0-9]{3,8}\b|@import|animation:/i);
  assert.match(css, /\.workspace-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 900px\)/); assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.week-schedule, \.family-portal \.week-schedule, \.family-progress-grid[^}]*grid-template-columns: 1fr/);
  assert.match(css, /\.family-attendance-summary \{ grid-template-columns: repeat\(2/);
  assert.match(css, /:focus-visible/); assert.match(css, /var\(--focus-ring\)/); assert.match(css, /min-height: var\(--touch-target\)/);
  assert.match(css, /\.workspace-table-wrap \{ overflow-x: auto; max-width: 100%; min-width: 0/);
});
