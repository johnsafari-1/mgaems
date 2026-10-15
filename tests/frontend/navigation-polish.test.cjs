// Synthetic DOM checks only: no application server, credentials or database access.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../public/assets/nav.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ role = 'head_teacher', mobile = false, settings = null, schoolResult } = {}) {
  const ids = new Map(), classes = new Set(), events = new Map();
  const media = { matches: mobile, addEventListener(name, handler) { this.change = handler; } };
  let markup = '', branding = settings;
  const document = {
    activeElement: null,
    getElementById: id => ids.get(id) || null,
    querySelector: selector => selector === '.app-header' ? ids.get('header') : null,
    addEventListener: (name, handler) => events.set(name, handler),
  };
  function element(id) {
    const attrs = new Map(), listeners = new Map();
    const item = {
      id, attrs, listeners, hidden: false, disabled: false, inert: false, visible: true, tabIndex: 0,
      classList: { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); } },
      addEventListener: (name, handler) => listeners.set(name, handler),
      setAttribute: (name, value) => attrs.set(name, value),
      getAttribute: name => attrs.get(name),
      removeAttribute: name => attrs.delete(name),
      getClientRects: () => item.visible ? [{}] : [],
      contains: node => id === 'appSidebar' && [ids.get('schoolHome'), ids.get('closeNavigation'), ids.get('firstLink'), ids.get('lastLink'), ids.get('excludedLink')].includes(node),
      querySelectorAll: () => [ids.get('schoolHome'), ids.get('closeNavigation'), ids.get('firstLink'), ids.get('excludedLink'), ids.get('lastLink')],
      focus() { document.activeElement = item; events.get('focusin')?.({ target: item }); },
    };
    ids.set(id, item);
    return item;
  }
  document.body = element('body');
  document.body.insertAdjacentHTML = (position, html) => {
    markup += html;
    for (const [, id] of html.matchAll(/id="([^"]+)"/g)) element(id);
    ids.get('appSchoolLogo').hidden = true;
    element('header'); element('firstLink'); element('lastLink'); element('excludedLink').hidden = true;
  };
  const window = {
    location: { pathname: '/dashboard.html' },
    matchMedia: () => media,
    addEventListener: (name, handler) => events.set(name, handler),
  };
  const MGAEMS = {
    currentUser: () => ({ username: 'Synthetic account', role }),
    landingPage: () => '/dashboard.html',
    escapeHTML: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
    logout() {}, initSidebar() {}, initThemeControls() {},
    academicContext: async () => [{ ok: true, data: [] }, { ok: true, data: [] }],
    academicPeriod: () => ({ year: null, term: null }),
    schoolBranding: () => branding,
    schoolLogoURL: (value, { revision = 0 } = {}) => value ? `/storage/${value}${revision ? `?v=${revision}` : ''}` : '',
    schoolSettings: () => schoolResult || Promise.resolve({ ok: true, data: branding }),
  };
  const context = vm.createContext({ document, window, MGAEMS });
  vm.runInContext(source, context);
  return {
    context, document, ids, classes, events, media, markup: () => markup,
    render: active => vm.runInContext(`renderAppShell(${JSON.stringify(active || '/dashboard.html')}, '/storage/obsolete-logo.png')`, context),
    click: (id, event = {}) => ids.get(id).listeners.get('click')(event),
    key(key, shiftKey = false) {
      const event = { key, shiftKey, prevented: false, preventDefault() { this.prevented = true; } };
      events.get('keydown')(event); return event;
    },
    publish(data) { branding = data; events.get('mgaems:school-settings')({ detail: data }); },
  };
}

const approved = {
  system_admin: ['dashboard', 'students', 'guardians', 'academic', 'schemes-of-work', 'lesson-plans', 'records-of-work', 'homework', 'attendance', 'assessment', 'sponsorship', 'staff', 'communication', 'visitors', 'reports', 'administration'],
  head_teacher: ['dashboard', 'students', 'guardians', 'academic', 'schemes-of-work', 'lesson-plans', 'records-of-work', 'homework', 'attendance', 'assessment', 'sponsorship', 'staff', 'communication', 'visitors', 'reports', 'health-welfare', 'administration'],
  deputy_head_teacher: ['dashboard', 'students', 'guardians', 'academic', 'schemes-of-work', 'lesson-plans', 'records-of-work', 'homework', 'attendance', 'assessment', 'sponsorship', 'staff', 'communication', 'visitors', 'reports', 'health-welfare'],
  teacher: ['dashboard', 'students', 'teacher-timetable', 'schemes-of-work', 'lesson-plans', 'records-of-work', 'homework', 'attendance', 'assessment', 'communication'],
  sponsor_coordinator: ['dashboard', 'sponsorship', 'communication', 'visitors'],
  parent_guardian: ['parent-portal'], sponsor: ['sponsor-portal'], student: ['dashboard', 'communication'],
};
for (const [role, destinations] of Object.entries(approved)) {
  test(`polished navigation preserves all and only ${role} destinations`, () => {
    const h = harness({ role }); h.render(`/${destinations[0]}.html?view=active#section`);
    const nav = h.markup().match(/<nav aria-label="Main navigation">([\s\S]*?)<\/nav>/)[1];
    assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map(match => match[1]).sort(), destinations.map(name => `/${name}.html`).sort());
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
    assert.match(nav, /data-lucide="[a-z0-9-]+" aria-hidden="true"/);
    assert.doesNotMatch(nav, /student-portal|finance|streams/);
    if (role === 'system_admin') assert.doesNotMatch(nav, /health-welfare/);
  });
}

test('unknown and object-prototype roles cannot gain grouped navigation destinations', () => {
  for (const role of ['unrecognized', '__proto__', 'constructor']) {
    const h = harness({ role }); h.render();
    assert.match(h.markup(), /<nav aria-label="Main navigation"><\/nav>/);
  }
});

test('mobile drawer isolates background, traps both tab directions and dismisses with Escape', () => {
  const h = harness({ mobile: true }); h.render();
  assert.equal(h.ids.get('appSidebar').inert, true);
  h.click('navigationToggle');
  assert.equal(h.ids.get('header').inert, true); assert.equal(h.ids.get('appMain').inert, true);
  assert.equal(h.ids.get('appSidebar').attrs.get('aria-modal'), 'true');
  h.ids.get('lastLink').focus(); assert.equal(h.key('Tab').prevented, true);
  assert.equal(h.document.activeElement, h.ids.get('schoolHome'));
  assert.equal(h.key('Tab', true).prevented, true); assert.equal(h.document.activeElement, h.ids.get('lastLink'));
  h.key('Escape');
  assert.equal(h.document.activeElement, h.ids.get('navigationToggle'));
  assert.equal(h.ids.get('appSidebar').inert, true); assert.equal(h.ids.get('appMain').inert, false);
  assert.equal(h.ids.get('appSidebar').attrs.has('aria-modal'), false);
});

test('drawer focus trap excludes disabled, hidden, visually hidden and negative-tabindex controls', () => {
  for (const change of [el => { el.hidden = true; }, el => { el.disabled = true; }, el => { el.visible = false; }, el => { el.tabIndex = -1; }, el => el.setAttribute('aria-hidden', 'true')]) {
    const h = harness({ mobile: true }); h.render(); h.click('navigationToggle'); change(h.ids.get('lastLink'));
    h.ids.get('firstLink').focus(); assert.equal(h.key('Tab').prevented, true);
    assert.equal(h.document.activeElement, h.ids.get('schoolHome'));
  }
});

test('external focus is recovered inside an open drawer, including the skip link', () => {
  const h = harness({ mobile: true }); h.render(); h.click('navigationToggle');
  h.ids.get('appMain').focus(); assert.equal(h.document.activeElement, h.ids.get('schoolHome'));
});

test('responsive resizing never leaves focus on the hidden mobile close control', () => {
  const h = harness({ mobile: true }); h.render(); h.click('navigationToggle');
  h.media.matches = false; h.media.change();
  assert.equal(h.document.activeElement, h.ids.get('navigationToggle')); assert.equal(h.ids.get('header').inert, false);
  h.click('navigationToggle'); assert.equal(h.classes.has('sidebar-collapsed'), true);
  h.ids.get('firstLink').focus(); h.media.matches = true; h.media.change();
  assert.equal(h.document.activeElement, h.ids.get('navigationToggle')); assert.equal(h.ids.get('appSidebar').inert, true);
  h.media.matches = false; h.media.change(); assert.equal(h.classes.has('sidebar-collapsed'), true);
});

test('ordinary mobile destination activation closes the drawer while modified links retain it', () => {
  const h = harness({ mobile: true }); h.render(); h.click('navigationToggle');
  const target = { closest: () => h.ids.get('firstLink') };
  h.click('appSidebar', { target, ctrlKey: true }); assert.equal(h.classes.has('navigation-open'), true);
  h.click('appSidebar', { target }); assert.equal(h.classes.has('navigation-open'), false);
  assert.equal(h.ids.get('navigationToggle').attrs.get('aria-expanded'), 'false');
});

test('saved school identity overrides every obsolete logo argument and refreshes from the shared event', async () => {
  const h = harness({ settings: { school_name: '<School>', logo_path: 'school/fixture.png' } }); h.render(); await flush();
  assert.doesNotMatch(h.markup(), /obsolete-logo/);
  assert.equal(h.ids.get('appSchoolName').textContent, '<School>'); assert.equal(h.ids.get('appSchoolLogo').src, '/storage/school/fixture.png');
  h.publish({ school_name: 'Updated school', logo_path: 'school/fixture.png', logo_revision: 7 });
  assert.equal(h.ids.get('appSchoolLogo').src, '/storage/school/fixture.png?v=7');
  const image = h.ids.get('appSchoolLogo'); image.listeners.get('error')({ target: image }); assert.equal(image.hidden, true);
  h.publish({ school_name: 'Updated school', logo_path: 'school/replacement.png', logo_revision: 8 });
  assert.equal(image.hidden, false); assert.equal(image.src, '/storage/school/replacement.png?v=8');
});

test('missing logo keeps the actual fallback and stale settings responses do not overwrite uploads', async () => {
  let release;
  const h = harness({ schoolResult: new Promise(resolve => { release = resolve; }) }); h.render();
  assert.match(h.markup(), /brand-mark.*<span>MG<\/span>/); assert.match(h.markup(), /id="appSchoolLogo" hidden/); assert.equal(h.ids.get('appSchoolLogo').hidden, true);
  h.publish({ school_name: 'Saved school', logo_path: 'school/new.png', logo_revision: 2 });
  release({ ok: true, stale: true, data: { school_name: 'Older school', logo_path: 'school/old.png' } }); await flush();
  assert.equal(h.ids.get('appSchoolName').textContent, 'Saved school'); assert.equal(h.ids.get('appSchoolLogo').src, '/storage/school/new.png?v=2');
  h.publish({ school_name: 'Saved school', logo_path: null }); assert.equal(h.ids.get('appSchoolLogo').hidden, true);
});
