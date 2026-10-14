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

test('Health API reads and writes explicitly bypass the browser cache', async () => {
  const h = harness();
  await h.app.get('/api/v1/health/profiles');
  await h.app.post('/api/v1/health/incidents', { student_id: 8 });
  await h.app.patch('/api/v1/health/profiles/3', { expected_revision: 1 });
  assert.ok(h.requests.slice(-3).every(request => request.options.cache === 'no-store'));
  await h.app.get('/api/v1/academic-years'); assert.equal(h.requests.at(-1).options.cache, undefined);
});

const roleDestinations = {
  system_admin: ['dashboard', 'students', 'guardians', 'academic', 'schemes-of-work', 'attendance', 'assessment', 'sponsorship', 'staff', 'communication', 'visitors', 'reports', 'administration'],
  head_teacher: ['dashboard', 'students', 'guardians', 'academic', 'schemes-of-work', 'attendance', 'assessment', 'sponsorship', 'staff', 'communication', 'visitors', 'reports', 'health-welfare', 'administration'],
  deputy_head_teacher: ['dashboard', 'students', 'guardians', 'academic', 'schemes-of-work', 'attendance', 'assessment', 'sponsorship', 'staff', 'communication', 'visitors', 'reports', 'health-welfare'],
  teacher: ['dashboard', 'students', 'teacher-timetable', 'schemes-of-work', 'attendance', 'assessment', 'communication'],
  sponsor_coordinator: ['sponsorship', 'dashboard', 'communication', 'visitors'],
  parent_guardian: ['parent-portal'],
  sponsor: ['sponsor-portal'],
  student: ['dashboard', 'communication'],
};
for (const [role, destinations] of Object.entries(roleDestinations)) {
  test(`${role} renders exactly its approved existing destinations and highlights the active page`, () => {
    const h = harness({ role });
    const active = `/${destinations[0]}.html`;
    vm.runInContext(`renderAppShell('${active}')`, h.context);
    const nav = h.shellHTML().match(/<nav aria-label="Main navigation">([\s\S]*?)<\/nav>/)[1];
    assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map(match => match[1]).sort(), destinations.map(name => `/${name}.html`).sort());
    assert.match(nav, new RegExp(`href="${active}"[^>]*aria-current="page"`));
    assert.doesNotMatch(nav, /finance|streams/i);
    if (!['head_teacher', 'deputy_head_teacher'].includes(role)) assert.doesNotMatch(nav, /health|safety/i);
    for (const name of destinations) {
      const filename = path.join(root, 'public', `${name}.html`);
      assert.equal(fs.existsSync(filename), true, `${name} destination exists`);
      const html = fs.readFileSync(filename, 'utf8');
      for (const [, src] of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)(?:[?#][^"]*)?"/g)) {
        assert.equal(fs.existsSync(path.join(root, 'public', src)), true, `${name} asset ${src} exists`);
      }
    }
  });
}

test('unknown roles receive no operational links, including inherited object property names', () => {
  for (const role of ['unrecognized', 'constructor', '__proto__']) {
    const h = harness({ role }); vm.runInContext("renderAppShell('/dashboard.html')", h.context);
    assert.match(h.shellHTML(), /<nav aria-label="Main navigation"><\/nav>/);
  }
});

test('Student dashboard makes no unauthorized operational requests', async () => {
  for (const role of ['student']) {
    const h = harness({ role }); vm.runInContext(script('dashboard.js'), h.context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.requests.some(item => /school-statistics|\/students|assessments|attendance/.test(item.url)), false);
    assert.equal(h.requests.some(item => item.url.endsWith('/announcements')), true);
  }
});

test('existing Communication page keeps Teacher read and messaging but removes unsafe publication', async () => {
  const html = fs.readFileSync(path.join(root, 'public/communication.html'), 'utf8');
  assert.match(html, /src="\/assets\/communication\.js"/);
  for (const role of ['system_admin', 'head_teacher', 'deputy_head_teacher', 'sponsor_coordinator', 'teacher', 'student']) {
    const h = harness({ role, pathname: '/communication.html' });
    vm.runInContext(script('communication.js'), h.context);
    await new Promise(resolve => setImmediate(resolve));
    const canPublish = !['teacher', 'student'].includes(role);
    assert.equal(h.elements.has('newAnnouncement'), canPublish, `${role} publish control`);
    assert.equal(h.elements.has('newMessage'), !['student', 'sponsor_coordinator'].includes(role), `${role} messaging control`);
    assert.equal(h.requests.some(item => item.url.endsWith('/announcements')), true);
    assert.equal(h.requests.some(item => item.url.endsWith('/messages')), role !== 'student');
    assert.equal(h.requests.some(item => (item.options.method || 'GET') !== 'GET'), false);
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

test('API preserves Laravel field validation errors for domain forms', async () => {
  const h = harness();
  h.context.fetch = async () => ({ ok: false, status: 422, json: async () => ({ message: 'Validation failed.', errors: { admission_date: ['Admission cannot precede birth.'] } }) });
  const result = await h.app.post('/api/v1/students', {});
  assert.equal(result.status, 422);
  assert.equal(result.fields.admission_date[0], 'Admission cannot precede birth.');
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
  assert.equal(teacher.elements.has('statsCards'), false);
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

test('sidebar groups contain only permitted destinations, omit empty sections, and preserve active links', () => {
  const groups = { system_admin: ['Overview', 'Learners', 'Academics', 'School Operations', 'Communication', 'Reporting', 'Administration'], head_teacher: ['Overview', 'Learners', 'Academics', 'School Operations', 'Communication', 'Reporting', 'Administration'], deputy_head_teacher: ['Overview', 'Learners', 'Academics', 'School Operations', 'Communication', 'Reporting'], teacher: ['Overview', 'Learners', 'Academics', 'Communication'], sponsor_coordinator: ['Overview', 'School Operations', 'Communication'], parent_guardian: ['Overview'], sponsor: ['Overview'], student: ['Overview', 'Communication'] };
  for (const [role, labels] of Object.entries(groups)) {
    const h = harness({ role }); vm.runInContext(`renderAppShell('${role === 'parent_guardian' ? '/parent-portal.html' : role === 'sponsor' ? '/sponsor-portal.html' : '/dashboard.html'}')`, h.context);
    const nav = h.shellHTML().match(/<nav aria-label="Main navigation">([\s\S]*?)<\/nav>/)[1];
    assert.deepEqual([...nav.matchAll(/class="nav-section-title" id="[^"]+">([^<]+)/g)].map(match => match[1]), labels);
    for (const section of nav.matchAll(/<section[^>]*>([\s\S]*?)<\/section>/g)) assert.match(section[1], /<a href=/);
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
  }
});

test('header uses only account name and role; configured identity is text and missing logo has a real fallback', async () => {
  const h = harness(); h.stored.set('mgaems_user', JSON.stringify({ username: '<Account>', role: 'head_teacher', email: 'DO-NOT-DISPLAY' }));
  h.app.get = async url => ({ ok: true, data: url.endsWith('/school') ? { school_name: '<School>', motto: '<Motto>', logo_path: 'school/fixture-logo.png' } : [] });
  vm.runInContext("renderAppShell('/dashboard.html')", h.context); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.elements.get('userInfo').textContent, '<Account>'); assert.equal(h.elements.get('userRole').textContent, 'head teacher');
  assert.equal(h.elements.get('appSchoolName').textContent, '<School>'); assert.equal(h.elements.get('appSchoolLogo').src, '/storage/school/fixture-logo.png');
  assert.doesNotMatch(h.shellHTML(), /DO-NOT-DISPLAY|DsN4QKTH|notification|type="search"/);
  assert.match(h.shellHTML(), /brand-mark.*<span>MG<\/span>/);
  const logo = h.elements.get('appSchoolLogo'); logo.listeners.error({ target: logo }); assert.equal(logo.hidden, true);
});

test('academic period display respects Nairobi dates, valid ranges, matching year and ambiguous current records', () => {
  const h = harness(); const year = { id: 1, name: 'Fixture year', is_current: true, start_date: '2025-12-31T21:00:00Z', end_date: '2026-12-30T21:00:00Z' };
  const term = { id: 2, academic_year_id: 1, is_current: true, start_date: '2026-09-30T21:00:00Z', end_date: '2026-12-14T21:00:00Z' };
  assert.equal(h.app.schoolDate(year.start_date), '2026-01-01'); assert.equal(h.app.schoolDate('2026-10-12'), '2026-10-12');
  assert.equal(h.app.academicPeriod([year], [term], '2026-10-12').term.id, 2);
  assert.equal(h.app.academicPeriod([year], [{ ...term, academic_year_id: 9 }], '2026-10-12').term, null);
  assert.equal(h.app.academicPeriod([year], [term], '2027-01-01').year, null);
  assert.equal(h.app.academicPeriod([year, { ...year, id: 3 }], [term], '2026-10-12').year, null);
});

test('leadership dashboard shows setup required, independent calendar retry and no Health API or invented counts', async () => {
  const h = harness(); let failure = true;
  h.app.get = async url => {
    h.requests.push({ url });
    if (url.endsWith('/academic-years')) return failure ? { ok: false, status: 503, error: '<Calendar unavailable>' } : { ok: true, data: [] };
    if (url.includes('school-statistics')) return { ok: true, data: { students: { total: 7, by_status: { active: 5 } }, staff: { total: 3 }, active_sponsorships: 2, attendance_today: { date: '2026-10-12', rate: null } } };
    return { ok: true, data: [] };
  };
  vm.runInContext(script('dashboard.js'), h.context); await new Promise(resolve => setImmediate(resolve));
  assert.match(h.elements.get('dashboardPeriod').innerHTML, /&lt;Calendar unavailable&gt;/); assert.match(h.elements.get('statsCards').innerHTML, /Active learners/);
  assert.match(h.elements.get('statsCards').innerHTML, /class="num">5</); assert.doesNotMatch(h.elements.get('statsCards').innerHTML, /0%/);
  failure = false; h.elements.get('dashboardPeriod').retry(); await new Promise(resolve => setImmediate(resolve));
  assert.match(h.elements.get('dashboardPeriod').innerHTML, /Academic setup required/); assert.equal(h.elements.get('dashboardPeriod').attrs.get('aria-busy'), 'false');
  assert.equal(h.requests.some(request => request.url.includes('/health/')), false);
});

test('shell and dashboard share concurrent calendar requests and unauthorized roles receive no academic panel', async () => {
  const h = harness(); let releaseYears, releaseTerms;
  h.context.fetch = async url => { h.requests.push({ url }); const data = url.endsWith('/academic-years') ? await new Promise(resolve => { releaseYears = resolve; }) : url.endsWith('/terms') ? await new Promise(resolve => { releaseTerms = resolve; }) : []; return { ok: true, status: 200, json: async () => ({ data }) }; };
  vm.runInContext(script('dashboard.js'), h.context);
  assert.equal(h.requests.filter(request => request.url.endsWith('/academic-years')).length, 1); assert.equal(h.requests.filter(request => request.url.endsWith('/terms')).length, 1);
  releaseYears([]); releaseTerms([]); await new Promise(resolve => setImmediate(resolve));
  assert.match(h.elements.get('dashboardPeriod').innerHTML, /Academic setup required/);
  for (const role of ['parent_guardian', 'sponsor', 'sponsor_coordinator', 'student', 'unrecognized']) {
    const other = harness({ role }); vm.runInContext(script('dashboard.js'), other.context); await new Promise(resolve => setImmediate(resolve));
    assert.equal(other.elements.has('dashboardPeriod'), false); assert.equal(other.requests.some(request => request.url.endsWith('/academic-years') || request.url.endsWith('/terms')), false);
    if (role === 'unrecognized') assert.doesNotMatch(other.elements.get('appMain').innerHTML, /href="\/communication.html"/);
  }
});

test('dashboard quick actions follow role navigation and never expose Administrator Health access', () => {
  for (const role of ['system_admin', 'head_teacher', 'deputy_head_teacher']) {
    const h = harness({ role }); vm.runInContext(script('dashboard.js'), h.context);
    const html = h.elements.get('appMain').innerHTML; assert.match(html, /Common school operations/);
    assert.equal(html.includes('href="/health-welfare.html"'), role !== 'system_admin');
    assert.equal(html.includes('href="/administration.html"'), role !== 'deputy_head_teacher');
    assert.equal(h.requests.some(request => request.url.includes('/health/')), false);
  }
});

test('dashboard renders only current returned calendar names and rejects invalid statistical values', async () => {
  const h = harness(); h.app.get = async url => ({ ok: true, data: url.endsWith('/academic-years') ? [{ id: 1, name: '<Year>', is_current: true, start_date: '1000-01-01', end_date: '9999-12-31' }]
    : url.endsWith('/terms') ? [{ academic_year_id: 1, name: '<Term>', is_current: true, start_date: '1000-01-01', end_date: '9999-12-31' }]
      : url.includes('school-statistics') ? { students: { total: -1 }, staff: { total: 2 }, active_sponsorships: 0, attendance_today: { rate: 101, date: '2026-10-12' } } : [] });
  vm.runInContext(script('dashboard.js'), h.context); await new Promise(resolve => setImmediate(resolve));
  assert.match(h.elements.get('dashboardPeriod').innerHTML, /&lt;Year&gt;|&lt;Term&gt;/); assert.doesNotMatch(h.elements.get('dashboardPeriod').innerHTML, /<Year>|<Term>/);
  assert.match(h.elements.get('statsCards').innerHTML, /unexpected response/); assert.doesNotMatch(h.elements.get('statsCards').innerHTML, /class="num">-1|101%/);
});

test('shared skeleton loading retains an escaped status label and hides placeholders from assistive technology', () => {
  const h = harness(), markup = h.app.loadingHTML('<Loading records>', true);
  assert.match(markup, /role="status"/); assert.match(markup, /loading-skeleton" aria-hidden="true"/); assert.match(markup, /&lt;Loading records&gt;/);
  assert.doesNotMatch(markup, /<Loading records>/); assert.match(h.app.loadingHTML(), /spinner/);
});
