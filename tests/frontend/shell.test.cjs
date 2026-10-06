// Safe frontend regression checks: no browser session, server, or database access.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const script = name => fs.readFileSync(path.join(root, 'public/assets', name), 'utf8');

function harness({ theme, systemDark = false, storageBlocked = false, role = 'head_teacher', pathname = '/dashboard.html', mobile = false } = {}) {
  const elements = new Map();
  const events = {};
  const stored = new Map([['mgaems_token', 'test-session'], ['mgaems_user', JSON.stringify({ username: 'test-user', role })]]);
  if (theme) stored.set('mgaems_theme', theme);
  const requests = [];
  const media = new Map();
  const classes = new Set();
  let shellHTML = '';
  const document = {
    activeElement: null,
    getElementById: id => elements.get(id) || null,
    querySelectorAll: selector => selector === '[data-theme-toggle]' ? [toggle] : [],
    querySelector: selector => selector === '.app-header' ? elements.get('header') : null,
    addEventListener: (name, handler) => { events[name] = handler; },
  };
  function element(id) {
    const attrs = new Map();
    const listeners = {};
    let html = '';
    const result = {
      dataset: {}, listeners, attrs, hidden: false, inert: false,
      classList: { toggle: (name, value) => value ? classes.add(name) : classes.delete(name) },
      setAttribute: (name, value) => attrs.set(name, value),
      getAttribute: name => attrs.get(name),
      removeAttribute: name => attrs.delete(name),
      addEventListener: (name, handler) => { listeners[name] = handler; },
      focus: () => { document.activeElement = result; },
      contains: other => id === 'appSidebar' && [elements.get('closeNavigation'), elements.get('navLink')].includes(other),
      querySelectorAll: () => [elements.get('closeNavigation'), elements.get('navLink')],
      querySelector: selector => selector === 'button' && html.includes('<button') ? button : null,
      get innerHTML() { return html; },
      set innerHTML(value) {
        html = value;
        for (const match of value.matchAll(/id="([^"]+)"/g)) if (!elements.has(match[1])) element(match[1]);
      },
    };
    const button = { addEventListener: (name, handler) => { result.retry = handler; } };
    elements.set(id, result);
    return result;
  }
  const toggle = element('themeControl');
  document.documentElement = element('root');
  document.body = element('body');
  document.body.insertAdjacentHTML = (position, html) => {
    shellHTML += html;
    document.body.innerHTML = html;
    element('header'); element('navLink');
  };
  const localStorage = {
    getItem: key => { if (storageBlocked) throw new Error('Storage blocked'); return stored.get(key) || null; },
    setItem: (key, value) => { if (storageBlocked) throw new Error('Storage blocked'); stored.set(key, value); },
    removeItem: key => stored.delete(key),
  };
  const window = {
    location: { pathname, href: pathname },
    addEventListener: (name, handler) => { events[name] = handler; },
    matchMedia: query => {
      if (!media.has(query)) media.set(query, { matches: query.includes('color-scheme') ? systemDark : mobile, addEventListener(name, handler) { this.change = handler; } });
      return media.get(query);
    },
  };
  const context = vm.createContext({ document, window, localStorage, setTimeout, fetch: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  } });
  vm.runInContext(script('app.js'), context);
  vm.runInContext(script('nav.js'), context);
  const app = vm.runInContext('MGAEMS', context);
  return { app, context, document, elements, events, stored, media, requests, toggle, classes, shellHTML: () => shellHTML };
}

test('saved theme precedes shell rendering and toggle persists with accessible state', () => {
  const h = harness({ theme: 'dark', systemDark: false });
  assert.equal(h.document.documentElement.getAttribute('data-theme'), 'dark');
  h.app.initThemeControls();
  h.app.initThemeControls();
  assert.equal(h.toggle.attrs.get('aria-pressed'), 'true');
  h.toggle.listeners.click();
  assert.equal(h.stored.get('mgaems_theme'), 'light');
  assert.equal(h.toggle.attrs.get('aria-pressed'), 'false');
  assert.equal(h.toggle.attrs.get('aria-label'), 'Switch to dark mode');
  assert.equal(harness({ theme: h.stored.get('mgaems_theme'), systemDark: true }).document.documentElement.getAttribute('data-theme'), 'light');
});

test('theme tolerates blocked storage and follows system only without a preference', () => {
  const blocked = harness({ storageBlocked: true, systemDark: true });
  blocked.app.setTheme('light');
  assert.equal(blocked.document.documentElement.getAttribute('data-theme'), 'light');
  const h = harness({ theme: 'invalid' });
  h.media.get('(prefers-color-scheme: dark)').change({ matches: true });
  assert.equal(h.document.documentElement.getAttribute('data-theme'), 'dark');
  h.app.setTheme('light');
  h.media.get('(prefers-color-scheme: dark)').change({ matches: true });
  assert.equal(h.document.documentElement.getAttribute('data-theme'), 'light');
  h.events.storage({ key: 'mgaems_theme', newValue: 'dark' });
  assert.equal(h.document.documentElement.getAttribute('data-theme'), 'dark');
});

test('portal users land in their own portals and never receive staff navigation or dashboard requests', () => {
  for (const role of ['parent_guardian', 'sponsor']) {
    const h = harness({ role });
    vm.runInContext(script('dashboard.js'), h.context);
    assert.equal(h.requests.length, 0);
    const landing = role === 'sponsor' ? '/sponsor-portal.html' : '/parent-portal.html';
    assert.equal(vm.runInContext('window.location.href', h.context), landing);
    vm.runInContext(`renderAppShell('${landing}')`, h.context);
    assert.doesNotMatch(h.shellHTML(), /href="\/students.html"|href="\/administration.html"/);
    assert.match(h.shellHTML(), new RegExp(`href="${landing}"`));
    assert.equal(h.requests.some(item => item.url.includes('academic-years')), false);
  }
});

test('mobile drawer contains keyboard focus, closes with Escape, and desktop collapse retains controls', () => {
  const h = harness({ mobile: true });
  vm.runInContext("renderAppShell('/dashboard.html')", h.context);
  const nav = h.elements.get('appSidebar'), control = h.elements.get('navigationToggle');
  assert.equal(nav.inert, true);
  control.listeners.click();
  assert.equal(nav.inert, false);
  assert.equal(h.elements.get('appMain').inert, true);
  assert.equal(control.attrs.get('aria-expanded'), 'true');
  const last = h.elements.get('navLink');
  last.focus();
  let prevented = false;
  h.events.keydown({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.document.activeElement, h.elements.get('closeNavigation'));
  h.events.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(nav.inert, true);
  assert.equal(h.document.activeElement, control);
  const desktop = h.media.get('(max-width: 900px)');
  desktop.matches = false; desktop.change(); control.listeners.click();
  assert.equal(h.classes.has('sidebar-collapsed'), true);
  assert.equal(nav.inert, false);
  assert.equal(control.attrs.get('aria-label'), 'Expand navigation');
});

test('API 401 preserves logout, credential cleanup, and login redirect', async () => {
  const h = harness();
  h.context.fetch = async url => ({ ok: url.endsWith('/logout'), status: url.endsWith('/logout') ? 200 : 401 });
  const result = await h.app.get('/api/v1/announcements');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.status, 401);
  assert.equal(h.stored.has('mgaems_token'), false);
  assert.equal(h.stored.has('mgaems_user'), false);
  assert.equal(vm.runInContext('window.location.href', h.context), '/login.html');
});

test('dashboard escapes payloads and keeps loaded, empty, denied, error, and retry states distinct', async () => {
  const h = harness();
  let attempts = 0;
  h.app.get = async url => {
    if (url.includes('school-statistics')) return { ok: false, status: 503, error: '<Unavailable>' };
    if (url.includes('students?')) return { ok: true, data: [] };
    if (url.includes('announcements')) {
      attempts++;
      return attempts === 1 ? { ok: false, error: 'Offline' } : { ok: true, data: [{ title: '<script>', body: '<img>', audience: 'staff' }] };
    }
    return { ok: true, data: [] };
  };
  vm.runInContext(script('dashboard.js'), h.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.elements.get('statsCards').innerHTML, /&lt;Unavailable&gt;/);
  assert.match(h.elements.get('studentsCard').innerHTML, /No learners registered yet/);
  assert.match(h.elements.get('announcementsCard').innerHTML, /Offline/);
  h.elements.get('announcementsCard').retry();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.elements.get('announcementsCard').innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(h.elements.get('announcementsCard').innerHTML, /<script>/);
  assert.equal(h.elements.get('announcementsCard').attrs.get('aria-busy'), 'false');
  const teacher = harness({ role: 'teacher' });
  vm.runInContext(script('dashboard.js'), teacher.context);
  assert.match(teacher.elements.get('statsCards').innerHTML, /Access restricted/);
  assert.equal(teacher.requests.some(item => item.url.includes('school-statistics')), false);
});

test('dashboard displays API zero totals and unrecorded attendance without fabricating values', async () => {
  const h = harness();
  h.app.get = async url => url.includes('school-statistics') ? {
    ok: true, data: { students: { total: 0 }, staff: { total: 0 }, active_sponsorships: 0, attendance_today: { rate: null, date: '2026-10-06' } },
  } : { ok: true, data: [] };
  vm.runInContext(script('dashboard.js'), h.context);
  assert.match(h.elements.get('statsCards').innerHTML, /Loading school statistics/);
  assert.equal(h.elements.get('statsCards').attrs.get('aria-busy'), 'true');
  await new Promise(resolve => setImmediate(resolve));
  const stats = h.elements.get('statsCards');
  assert.equal((stats.innerHTML.match(/class="num">0</g) || []).length, 3);
  assert.match(stats.innerHTML, /Not recorded/);
  assert.doesNotMatch(stats.innerHTML, /0%/);
  assert.equal(stats.attrs.get('aria-busy'), 'false');
});
