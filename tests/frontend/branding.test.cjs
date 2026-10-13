// Synthetic branding fixtures only: no server, upload, database or private files.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const administration = fs.readFileSync(path.resolve(__dirname, '../../public/administration.html'), 'utf8');
const settings = { school_name: '<Fixture School>', motto: 'Learning together', logo_path: 'school/fixture logo.png', email: 'private@example.invalid' };
function harness() {
  const h = createDOM('system_admin', '/administration.html');
  h.context.window.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  h.published = [];
  h.context.window.dispatchEvent = event => {
    h.published.push(event);
    for (const callback of h.events[event.type] || []) callback(event);
  };
  h.app.toast = () => {};
  return h;
}

test('saved relative logo paths are encoded once as storage URLs and unsafe paths have no image', () => {
  const h = harness();
  assert.equal(h.app.schoolLogoURL('school/fixture logo.png'), '/storage/school/fixture%20logo.png');
  assert.equal(h.app.schoolLogoURL('school/fixture.png', { revision: 4 }), '/storage/school/fixture.png?v=4');
  for (const value of [null, '', '/school/logo.png', 'https://example.invalid/logo.png', '//example.invalid/logo.png', '../logo.png', 'school/../logo.png', 'school/%2e%2e/logo.png', 'school/%2fsecret.png', 'school\\logo.png', 'school/logo.png?token=private', 'school/logo.png#fragment', 'school/%zz.png', ' school/logo.png']) {
    assert.equal(h.app.schoolLogoURL(value), '', String(value));
  }
});

test('logo rendering escapes school identity and provides an accessible empty placeholder', () => {
  const h = harness();
  const html = h.app.schoolLogoHTML(settings, { className: 'admin-logo-preview' });
  assert.match(html, /src="\/storage\/school\/fixture%20logo.png"/);
  assert.match(html, /alt="&lt;Fixture School&gt; logo"/);
  assert.doesNotMatch(html, /<Fixture School>|private@example/);
  const empty = h.app.schoolLogoHTML({ logo_path: null });
  assert.match(empty, /data-school-logo-image hidden alt="School logo"/);
  assert.match(empty, /role="img" aria-label="School logo not configured"/);
  assert.doesNotMatch(empty, /src=/);
});

test('broken logos show a labeled fallback and a later loaded logo restores the image', () => {
  const h = harness(), root = new h.Element();
  root.innerHTML = h.app.schoolLogoHTML(settings);
  h.app.initSchoolLogos(root);
  h.app.initSchoolLogos(root);
  const image = root.querySelector('[data-school-logo-image]'), fallback = root.querySelector('[data-school-logo-fallback]');
  image.listeners.error();
  assert.equal(image.hidden, true); assert.equal(fallback.hidden, false);
  assert.equal(fallback.getAttribute('aria-label'), 'School logo unavailable');
  image.listeners.load();
  assert.equal(image.hidden, false); assert.equal(fallback.hidden, true);
});

test('shell and settings share a concurrent read without retaining full settings or caching later reads', async () => {
  const h = harness(); let resolve, reads = 0;
  h.app.get = () => { reads += 1; return new Promise(done => { resolve = done; }); };
  const first = h.app.schoolSettings(), second = h.app.schoolSettings();
  assert.equal(first, second); assert.equal(reads, 1);
  resolve({ ok: true, data: settings }); await first;
  assert.equal(h.app.schoolBranding().school_name, settings.school_name);
  assert.equal(h.app.schoolBranding().email, undefined);
  assert.equal(h.published.length, 1);
  const exposed = h.app.schoolBranding(); exposed.school_name = 'Changed outside';
  assert.equal(h.app.schoolBranding().school_name, settings.school_name);
  h.app.get = async () => { reads += 1; return { ok: false, status: 403, error: 'Not allowed' }; };
  const third = await h.app.schoolSettings();
  assert.equal(reads, 2); assert.equal(third.status, 403);
});

test('a late settings read cannot overwrite the newly saved logo or publish old branding', async () => {
  const h = harness(); let resolve;
  h.app.get = () => new Promise(done => { resolve = done; });
  const pending = h.app.schoolSettings();
  h.app.updateSchoolSettings({ ...settings, logo_path: 'school/new.png' }, { refreshLogo: true });
  resolve({ ok: true, data: { ...settings, logo_path: 'school/old.png' } });
  const result = await pending;
  assert.equal(result.ok, false); assert.equal(result.stale, true);
  assert.equal(h.app.schoolBranding().logo_path, 'school/new.png');
  assert.equal(h.published.length, 1);
  assert.equal(h.app.schoolLogoURL(h.app.schoolBranding().logo_path, { revision: h.app.schoolBranding().logo_revision }), '/storage/school/new.png?v=1');
});

test('a settings response from an earlier authentication context does not expose branding', async () => {
  const h = harness(); let resolve;
  h.app.get = () => new Promise(done => { resolve = done; });
  const pending = h.app.schoolSettings();
  h.context.localStorage.getItem = () => 'different-session';
  resolve({ ok: true, data: settings });
  assert.equal((await pending).stale, true);
  assert.equal(h.app.schoolBranding(), null); assert.equal(h.published.length, 0);
});

function uploadHarness(response = { ok: true, status: 200, data: { logo_path: 'school/new logo.png', url: 'https://untrusted.invalid/ignored.png' } }) {
  const h = harness(); new h.Element('div', { id: 'settingsState' });
  const render = administration.match(/  function renderSettings\(\) \{[\s\S]*?(?=\n  async function saveSettings)/)[0];
  const save = administration.match(/  async function saveSettings\(event\) \{[\s\S]*?(?=\n  async function uploadLogo)/)[0];
  const upload = administration.match(/  async function uploadLogo\(event\) \{[\s\S]*?(?=\n  async function loadBackups)/)[0];
  h.context.fixtureSettings = { ...settings };
  h.context.FormData = class { constructor() { this.values = []; } append(...entry) { this.values.push(entry); } };
  h.requests = [];
  h.context.fetch = async (url, options) => {
    h.requests.push({ url, options });
    return { ok: response.ok, status: response.status, json: async () => ({ data: response.data, message: response.message }) };
  };
  vm.runInContext(`const state = {settings: fixtureSettings}; const esc = MGAEMS.escapeHTML; ${render}\n${save}\n${upload}\nrenderSettings();`, h.context);
  return h;
}

test('a successful existing upload refreshes saved-path preview and publishes branding for the shell', async () => {
  const h = uploadHarness();
  h.ids.get('schoolLogo').files = [{ type: 'image/png', size: 100 }];
  await h.ids.get('schoolLogoForm').listeners.submit({ preventDefault() {} });
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, '/api/v1/settings/school/logo');
  assert.equal(h.requests[0].options.method, 'POST');
  assert.equal(h.requests[0].options.headers.Authorization, 'Bearer memory-session');
  assert.equal(h.requests[0].options.headers['Content-Type'], undefined);
  assert.match(h.ids.get('settingsState').innerHTML, /src="\/storage\/school\/new%20logo.png\?v=1"/);
  assert.doesNotMatch(h.ids.get('settingsState').innerHTML, /untrusted.invalid|onerror=/);
  assert.equal(h.app.schoolBranding().logo_path, 'school/new logo.png');
  assert.equal(h.published.at(-1).type, 'mgaems:school-settings');
  assert.equal(h.ids.get('schoolLogo').files, undefined); // Fresh form; no selected file is retained.
});

test('invalid or rejected uploads preserve the saved logo and surface an error', async () => {
  const invalid = uploadHarness(); invalid.ids.get('schoolLogo').files = [{ type: 'application/pdf', size: 100 }];
  await invalid.ids.get('schoolLogoForm').listeners.submit({ preventDefault() {} });
  assert.equal(invalid.requests.length, 0); assert.match(invalid.ids.get('logoUploadState').innerHTML, /JPG or PNG/);
  const denied = uploadHarness({ ok: false, status: 403, message: 'Denied' });
  denied.ids.get('schoolLogo').files = [{ type: 'image/png', size: 100 }];
  await denied.ids.get('schoolLogoForm').listeners.submit({ preventDefault() {} });
  assert.match(denied.ids.get('settingsState').innerHTML, /fixture%20logo.png/);
  assert.match(denied.ids.get('logoUploadState').innerHTML, /permission/);
  assert.equal(denied.published.length, 0); assert.equal(denied.ids.get('uploadLogo').disabled, false);
});

test('administration has no hardcoded logo or inline broken-image behavior', () => {
  assert.match(administration, /renderAppShell\('\/administration.html'\);/);
  assert.doesNotMatch(administration, /DsN4QKTH|\/storage\/school\/[^$]|onerror=/);
  assert.match(administration, /MGAEMS.schoolSettings\(\)/);
});
