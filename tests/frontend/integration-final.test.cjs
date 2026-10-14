const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const root = path.resolve(__dirname, '../..');

test('all page shells use their existing local modules, valid assets and nonblocking optional icons', () => {
  const pages = fs.readdirSync(path.join(root, 'public')).filter(name => name.endsWith('.html'));
  assert.equal(pages.length, 20);
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, 'public', page), 'utf8');
    assert.match(html, /name="viewport"/); assert.match(html, /assets\/app\.js/); assert.doesNotMatch(html, /<style>|<script>|onclick=|onerror=|\/storage\/school\//);
    assert.match(html, /<script[^>]*\bdefer\b[^>]*src="https:\/\/unpkg\.com\/lucide@latest"|<script[^>]*src="https:\/\/unpkg\.com\/lucide@latest"[^>]*\bdefer\b/);
    for (const [, asset] of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) assert.ok(fs.existsSync(path.join(root, 'public', asset)), page + ': ' + asset);
  }
});
test('static internal page links and navigation destinations resolve to existing pages', () => {
  const files = fs.readdirSync(path.join(root, 'public')).filter(name => name.endsWith('.html')).map(name => path.join(root, 'public', name));
  files.push(...fs.readdirSync(path.join(root, 'public/assets')).filter(name => name.endsWith('.js')).map(name => path.join(root, 'public/assets', name)));
  for (const file of files) {
    for (const [, target] of fs.readFileSync(file, 'utf8').matchAll(/(?:href:\s*'|href=")(\/[a-z-]+\.html)(?:[?"'#])/g)) assert.ok(fs.existsSync(path.join(root, 'public', target)), path.basename(file) + ': ' + target);
  }
});
test('Staff document register provides honest contact guidance with no unsupported file action', () => {
  const source = fs.readFileSync(path.join(root, 'public/assets/staff.js'), 'utf8');
  const documents = source.slice(source.indexOf('  function documentsPanel('));
  assert.match(documents, /Contact authorized school administration for document access or updates/);
  assert.match(documents, /On record/);
  assert.doesNotMatch(documents, /file_path|href=|upload and download|document endpoints/);
});
test('dedicated stylesheets use defined shared/custom tokens, with bounded CSS blocks', () => {
  const files = fs.readdirSync(path.join(root, 'public/assets')).filter(name => name.endsWith('.css'));
  const definitions = new Set(files.flatMap(name => [...fs.readFileSync(path.join(root, 'public/assets', name), 'utf8').matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1])));
  for (const file of files) {
    const css = fs.readFileSync(path.join(root, 'public/assets', file), 'utf8');
    for (const [, variable] of css.matchAll(/var\((--[\w-]+)\)/g)) assert.ok(definitions.has(variable), file + ': ' + variable);
    const source = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
    let blocks = 0; for (const char of source) { if (char === '{') blocks++; if (char === '}') blocks--; assert.ok(blocks >= 0, file); } assert.equal(blocks, 0, file);
  }
});
test('optional icon failure preserves visible fallback and provider recovery remains available', () => {
  const h = createDOM(); const icon = new h.Element('i', { 'data-lucide': 'menu' }); const classes = new Set(); icon.classList.add = name => classes.add(name); h.document.querySelectorAll = selector => selector === 'i[data-lucide]' ? [icon] : [];
  h.app.initIcons(); assert.equal(icon.textContent, '☰'); assert.equal(icon.getAttribute('aria-hidden'), 'true'); assert.ok(classes.has('icon-fallback'));
  h.context.window.lucide = { createIcons() { throw new Error('Fixture provider unavailable'); } }; assert.doesNotThrow(() => h.app.initIcons());
  let calls = 0; h.context.window.lucide = { createIcons() { calls++; } }; h.app.initIcons(); assert.equal(calls, 1);
});
test('shared session guard detects token and account changes without persisting any response data', () => {
  const h = createDOM(); const guard = h.app.sessionGuard(); assert.equal(guard(), true);
  const original = h.context.localStorage.getItem; h.context.localStorage.getItem = key => key === 'mgaems_token' ? 'changed' : original(key); assert.equal(guard(), false);
  h.context.localStorage.getItem = original; const role = h.app.sessionGuard(); h.context.localStorage.getItem = key => key === 'mgaems_user' ? JSON.stringify({ username: 'test-user', role: 'head_teacher' }) : original(key); assert.equal(role(), false);
});
test('offline logout still clears local authentication and redirects without an unhandled rejection', async () => {
  const h = createDOM(); const removed = [];
  h.context.fetch = async () => { throw new Error('Fixture network unavailable'); };
  h.context.localStorage.removeItem = key => removed.push(key);
  h.app.logout(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(removed.sort(), ['mgaems_token', 'mgaems_user']); assert.equal(h.context.window.location.href, '/login.html');
});
test('old-page actions and downloads never dispatch with a replacement account', async () => {
  const h = createDOM(); let calls = 0;
  h.context.fetch = async () => { calls++; throw new Error('Must not dispatch'); };
  const read = h.context.localStorage.getItem;
  h.context.localStorage.getItem = key => key === 'mgaems_token' ? 'replacement-session' : read(key);
  assert.equal((await h.app.post('/api/v1/attendance/bulk', { synthetic: true })).stale, true);
  assert.equal((await h.app.download('/fixture/download', 'fixture.pdf')).stale, true);
  h.app.logout();
  assert.equal(calls, 0);
});
test('cross-tab account changes clear protected page content and keep the replacement session', () => {
  const h = createDOM(); h.context.renderAppShell();
  const main = h.document.getElementById('appMain'); main.innerHTML = '<p>PRIVATE previous records</p>';
  const info = new h.Element('span', { id: 'userInfo' }); info.textContent = 'Previous account';
  const removed = []; h.context.localStorage.removeItem = key => removed.push(key);
  const read = h.context.localStorage.getItem;
  h.context.localStorage.getItem = key => key === 'mgaems_token' ? 'replacement-session' : key === 'mgaems_user' ? JSON.stringify({ id: 2, role: 'parent_guardian' }) : read(key);
  for (const listener of h.events.storage) listener({ key: 'mgaems_token', newValue: 'replacement-session' });
  assert.doesNotMatch(main.innerHTML, /PRIVATE/); assert.equal(info.textContent, '');
  assert.equal(h.context.window.location.href, '/parent-portal.html'); assert.deepEqual(removed, []);
});
test('unrelated storage and theme changes preserve the current protected page', () => {
  const h = createDOM(); h.context.renderAppShell();
  const main = h.document.getElementById('appMain'); main.innerHTML = '<p>Current records</p>';
  for (const listener of h.events.storage) { listener({ key: 'unrelated', newValue: 'changed' }); listener({ key: 'mgaems_theme', newValue: 'dark' }); }
  assert.match(main.innerHTML, /Current records/); assert.equal(h.context.window.location.href, '/assessment.html');
  assert.equal(h.document.documentElement.getAttribute('data-theme'), 'dark');
});
test('pending logout cannot clear or redirect a replacement session', async () => {
  const h = createDOM(); const removed = []; let finish;
  h.context.fetch = () => new Promise(resolve => { finish = resolve; });
  h.context.localStorage.removeItem = key => removed.push(key);
  h.app.logout();
  const read = h.context.localStorage.getItem;
  h.context.localStorage.getItem = key => key === 'mgaems_token' ? 'replacement-session' : read(key);
  finish({ ok: true }); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(removed, []); assert.equal(h.context.window.location.href, '/assessment.html');
});
test('obsolete protected API 401 cannot log out a replacement session', async () => {
  const h = createDOM(); let finish; let logouts = 0;
  h.context.fetch = url => { if (url.endsWith('/logout')) { logouts++; return Promise.resolve({ ok: true }); } return new Promise(resolve => { finish = resolve; }); };
  const pending = h.app.get('/api/v1/announcements');
  const read = h.context.localStorage.getItem; h.context.localStorage.getItem = key => key === 'mgaems_token' ? 'replacement-session' : read(key);
  finish({ ok: false, status: 401 }); assert.equal((await pending).stale, true); assert.equal(logouts, 0); assert.equal(h.context.window.location.href, '/assessment.html');
});
test('API data received after account change during JSON parsing is discarded', async () => {
  const h = createDOM(); let finish;
  h.context.fetch = async () => ({ ok: true, status: 200, json: () => new Promise(resolve => { finish = resolve; }) });
  const pending = h.app.get('/api/v1/announcements'); await new Promise(resolve => setImmediate(resolve));
  const read = h.context.localStorage.getItem; h.context.localStorage.getItem = key => key === 'mgaems_user' ? JSON.stringify({ username: 'Other account', role: 'sponsor' }) : read(key);
  finish({ data: [{ body: 'PRIVATE old response' }] }); const result = await pending; assert.equal(result.stale, true); assert.equal(result.data, undefined);
});
function download(fetch) {
  const h = createDOM('parent_guardian', '/parent-portal.html'); h.requests = []; h.saved = []; h.urls = [];
  h.context.fetch = async (...args) => { h.requests.push(args); return fetch(...args); };
  h.context.URL = { createObjectURL(blob) { h.urls.push(blob); return 'blob:fixture'; }, revokeObjectURL() {} };
  h.context.setTimeout = callback => { callback(); return 1; };
  h.document.createElement = () => ({ click() { h.saved.push({ filename: this.download, href: this.href }); } });
  return h;
}
test('invalidated download selection prevents request or blob saving', async () => {
  const h = download(() => { throw new Error('Must not fetch'); }); const result = await h.app.download('/api/v1/portal/parent/children/1/report-cards/2/download', 'fixture.pdf', { isCurrent: () => false }); assert.equal(result.stale, true); assert.equal(h.requests.length, 0); assert.equal(h.saved.length, 0);
});
test('late PDF blob after learner or account change is discarded before browser delivery', async () => {
  for (const changeAccount of [false, true]) {
    let finish; let selected = true; const h = download(() => ({ ok: true, status: 200, blob: () => new Promise(resolve => { finish = resolve; }) }));
    const pending = h.app.download('/api/v1/portal/parent/children/1/report-cards/2/download', 'fixture.pdf', { isCurrent: () => selected }); await new Promise(resolve => setImmediate(resolve));
    if (changeAccount) { const read = h.context.localStorage.getItem; h.context.localStorage.getItem = key => key === 'mgaems_token' ? 'changed' : read(key); } else selected = false;
    finish('synthetic PDF blob'); assert.equal((await pending).stale, true); assert.equal(h.saved.length, 0); assert.equal(h.urls.length, 0);
  }
});
test('current file downloads retain filenames and reject HTML/JSON error pages', async () => {
  const h = download(() => ({ ok: true, status: 200, blob: async () => 'synthetic PDF' })); assert.equal((await h.app.download('/fixture/download', 'fixture.pdf')).ok, true); assert.deepEqual(h.saved, [{ filename: 'fixture.pdf', href: 'blob:fixture' }]);
  for (const type of ['text/html; charset=UTF-8', 'application/json', 'application/problem+json']) { const invalid = download(() => ({ ok: true, status: 200, headers: { get: () => type }, blob: async () => { throw new Error('Must not read error blob'); } })); assert.equal((await invalid.app.download('/fixture/download', 'fixture.pdf')).ok, false); assert.equal(invalid.saved.length, 0); }
});
