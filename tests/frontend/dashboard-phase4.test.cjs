// Focused dashboard checks use synthetic responses and never access a school database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const createDOM = require('./helpers/dom.cjs');
const nav = fs.readFileSync(path.resolve(__dirname, '../../public/assets/nav.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const stats = { students: { total: 0, by_status: { active: 0 } }, staff: { total: 0 }, active_sponsorships: 0, attendance_today: { rate: null, date: '2026-10-13' } };

function harness(role = 'head_teacher', response = async () => ({ ok: true, data: [] })) {
  const h = createDOM(role, '/dashboard.html');
  // Reuse the actual role navigation definitions with the isolated shell stub.
  vm.runInContext(nav.slice(0, nav.indexOf('function renderAppShell')), h.context);
  const requests = [];
  h.app.get = async url => { requests.push(url); return response(url); };
  h.app.academicContext = async () => [{ ok: true, data: [] }, { ok: true, data: [] }];
  return { ...h, requests, start: () => h.run('dashboard.js') };
}

test('dashboard uses cached saved school identity and settings events without additional school requests', () => {
  const h = harness();
  h.app.schoolBranding = () => ({ school_name: '<Saved school>' });
  h.start();
  const heading = h.ids.get('dashboardSchoolName');
  assert.equal(heading.textContent, '<Saved school>');
  h.events['mgaems:school-settings'][0]({ detail: { school_name: 'Updated school' } });
  assert.equal(heading.textContent, 'Updated school');
  h.events['mgaems:school-settings'][0]({ detail: null });
  assert.equal(heading.textContent, 'School workspace');
  assert.equal(h.requests.some(url => url.includes('settings/school')), false);
});

test('loading is visible immediately and independent empty sections finish without invented statistics', async () => {
  let resolveStatistics;
  const h = harness('head_teacher', url => url.includes('school-statistics') ? new Promise(resolve => { resolveStatistics = resolve; }) : Promise.resolve({ ok: true, data: [] }));
  h.start();
  assert.match(h.ids.get('statsCards').innerHTML, /Loading school statistics/);
  assert.equal(h.ids.get('statsCards').attrs['aria-busy'], 'true');
  await settle();
  assert.match(h.ids.get('studentsCard').innerHTML, /No learners registered yet/);
  assert.match(h.ids.get('announcementsCard').innerHTML, /No announcements yet/);
  assert.match(h.ids.get('dashboardPeriod').innerHTML, /Academic setup required/);
  assert.match(h.ids.get('statsCards').innerHTML, /Loading school statistics/);
  resolveStatistics({ ok: true, data: stats });
  await settle();
  const markup = h.ids.get('statsCards').innerHTML;
  assert.equal((markup.match(/class="num">0</g) || []).length, 3);
  assert.match(markup, /Not recorded/);
  assert.doesNotMatch(markup, /0%/);
  assert.equal((markup.match(/dashboard-stat-icon/g) || []).length, 4);
  assert.equal(h.ids.get('statsCards').attrs['aria-busy'], 'false');
});

test('panel errors are escaped, isolated, labelled and independently retryable', async () => {
  let failed = true;
  const h = harness('head_teacher', async url => url.includes('school-statistics') ? failed ? { ok: false, status: 503, error: '<Service unavailable>' } : { ok: true, data: stats } : { ok: true, data: [] });
  h.start(); await settle();
  const panel = h.ids.get('statsCards');
  assert.match(panel.innerHTML, /&lt;Service unavailable&gt;/);
  assert.doesNotMatch(panel.innerHTML, /<Service unavailable>/);
  assert.match(panel.innerHTML, /aria-label="Retry/);
  assert.match(h.ids.get('announcementsCard').innerHTML, /No announcements yet/);
  failed = false;
  panel.querySelector('button').listeners.click(); await settle();
  assert.match(panel.innerHTML, /Active learners/);
  assert.equal(h.requests.filter(url => url.includes('announcements')).length, 1);
});

test('rejected requests and malformed statistics clear loading without leaking partial or fictional counts', async () => {
  for (const payload of [null, { ...stats, staff: { total: -1 } }, { ...stats, attendance_today: { rate: 101 } }]) {
    const h = harness('head_teacher', async url => {
      if (url.includes('school-statistics')) {
        if (payload === null) throw new Error('Synthetic network failure');
        return { ok: true, data: payload };
      }
      return { ok: true, data: [] };
    });
    h.start(); await settle();
    assert.match(h.ids.get('statsCards').innerHTML, /unexpected response/);
    assert.doesNotMatch(h.ids.get('statsCards').innerHTML, /class="num"/);
    assert.equal(h.ids.get('statsCards').attrs['aria-busy'], 'false');
  }
});

test('role-specific delegation and dashboard access preserve communication-only and Health restrictions', async () => {
  for (const role of ['teacher', 'sponsor_coordinator', 'parent_guardian', 'sponsor']) {
    const h = harness(role); h.start(); await settle();
    assert.equal(h.requests.length, 0, role);
    assert.equal(h.ids.has('statsCards'), false, role);
  }
  const student = harness('student'); student.start(); await settle();
  assert.deepEqual(student.requests, ['/api/v1/announcements']);
  assert.equal(student.ids.has('dashboardPeriod'), false);
  assert.doesNotMatch(student.ids.get('appMain').innerHTML, /href="\/(students|health-welfare|administration)\.html"/);
  for (const role of ['system_admin', 'head_teacher', 'deputy_head_teacher']) {
    const h = harness(role); h.start(); await settle();
    const html = h.ids.get('appMain').innerHTML;
    assert.equal(html.includes('href="/health-welfare.html"'), role !== 'system_admin');
    assert.equal(html.includes('href="/administration.html"'), role !== 'deputy_head_teacher');
    assert.equal(h.requests.some(url => /health|finance/.test(url)), false);
  }
  const unknown = harness('unrecognized'); unknown.start(); await settle();
  assert.equal(unknown.requests.length, 0);
  assert.match(unknown.ids.get('announcementsCard').innerHTML, /Access restricted/);
});

test('academic indicators show only valid returned context and escape its names', async () => {
  const h = harness();
  h.app.academicContext = async () => [
    { ok: true, data: [{ id: 1, name: '<Academic year>', is_current: true, start_date: '1000-01-01', end_date: '9999-12-31' }] },
    { ok: true, data: [{ academic_year_id: 1, name: '<Current term>', is_current: true, start_date: '1000-01-01', end_date: '9999-12-31' }] },
  ];
  h.start(); await settle();
  const html = h.ids.get('dashboardPeriod').innerHTML;
  assert.match(html, /&lt;Academic year&gt;|&lt;Current term&gt;/);
  assert.doesNotMatch(html, /<Academic year>|<Current term>/);
  assert.match(html, /Current academic year|Current term/);
  assert.equal(h.ids.get('dashboardPeriod').attrs['aria-busy'], 'false');
});
