// Portal workflow checks use synthetic in-memory API responses and do not write school data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));
const learner = (id = 31, extra = {}) => ({ id, first_name: 'Synthetic ' + id, last_name: 'Learner', admission_no: 'TEST-' + id, status: 'active', class: { id: id + 100, name: 'Class ' + id, level: 'primary' }, medical_info: 'PRIVATE-HEALTH', phone: 'PRIVATE-CONTACT', ...extra });
const programmes = () => [{ id: 10, sponsorship_type: 'individual', status: 'active', program_name: null, start_date: '2026-01-05', end_date: null, learner: learner() }, { id: 20, sponsorship_type: 'group', status: 'paused', program_name: 'Group programme', start_date: '2026-02-05', end_date: '2026-12-05', learner: null }, { id: 30, sponsorship_type: 'school_wide', status: 'ended', program_name: 'School partnership', start_date: null, end_date: null, learner: null }];
const summary = () => ({ total: 3, present: 1, absent: 1, late: 1, excused: 0, attendance_percentage: 66.7 });
const progress = id => [{ subject: 'Mathematics ' + id, term: 'First term', academic_year: '2026', assessment_type: 'continuous', score: 0, competency_rating: 'EE', remarks: 'Feedback ' + id, recorded_date: '2026-10-01', published_date: '2026-10-01' }, { subject: 'Languages ' + id, term: 'Second term', academic_year: '2026', assessment_type: 'end_term', score: null, competency_rating: null, remarks: '', recorded_date: null, published_date: null }];
const cards = id => [{ id: id * 10, term: { id: 1, name: 'First term ' + id }, generated_date: '2026-10-01', overall_remark: 'Report ' + id, download_available: true, file_path: '/private/REPORT-SENTINEL.pdf' }, { id: id * 10 + 1, term: { id: 2, name: 'Second term ' + id }, generated_date: null, overall_remark: '', download_available: false }];
function harness({ portal = 'sponsor', role = portal === 'sponsor' ? 'sponsor' : 'parent_guardian', get, download, items = programmes(), children = [learner(31), learner(32)] } = {}) {
  const filename = portal === 'sponsor' ? 'sponsor-portal' : 'parent-portal';
  const h = createDOM(role, '/' + filename + '.html'), reads = [], downloads = [], toasts = [], errors = [];
  h.app.get = async url => {
    reads.push(url); if (get) { const result = await get(url); if (result !== undefined) return result; }
    if (url === '/api/v1/portal/sponsor/sponsorships') return { ok: true, data: structuredClone(items) };
    if (url === '/api/v1/portal/parent/children') return { ok: true, data: structuredClone(children) };
    if (url === '/api/v1/announcements') return { ok: true, data: [{ id: 1, title: 'Parent announcement', body: 'School update', audience: 'parents', published_at: '2026-10-01T21:30:00Z' }] };
    if (url === '/api/v1/portal/sponsor/sponsorships/10/learners') return { ok: true, data: [learner(31)] };
    if (url === '/api/v1/portal/sponsor/sponsorships/20/learners') return { ok: true, data: [learner(31), learner(32)] };
    const parentId = url.match(/parent\/children\/(\d+)/)?.[1], groupId = url.match(/sponsor\/sponsorships\/20\/learners\/(\d+)/)?.[1];
    const id = Number(parentId || groupId || (url.startsWith('/api/v1/portal/sponsor/sponsorships/10/') ? 31 : 0));
    if (!id) throw new Error('Unexpected portal request: ' + url);
    if (/parent\/children\/\d+$/.test(url)) return { ok: true, data: { ...learner(id), current_periods: [{ id: 1, name: 'First term', academic_year: { id: 1, name: '2026' } }] } };
    if (url.includes('/attendance')) return { ok: true, data: { student_id: id, summary: summary(), recent: [{ date: '2026-10-01', status: 'present' }], records: [{ date: '2026-10-01', status: 'present', class: { id: 1, name: 'Historical class ' + id } }] }, meta: { page: 1, per_page: 30, total: 3 } };
    if (url.endsWith('/progress') || url.endsWith('/comments')) return { ok: true, data: progress(id) };
    if (url.endsWith('/report-cards')) return { ok: true, data: cards(id) };
    if (url.endsWith('/timetable')) return { ok: true, data: [{ id: 1, day_of_week: 1, start_time: '09:00:00', end_time: '09:40:00', subject: { id: 1, name: 'Lesson ' + id } }] };
    throw new Error('Unexpected portal request: ' + url);
  };
  h.app.download = async (url, name, options) => { downloads.push({ url, filename: name, options }); return download ? download(url, name, options) : { ok: true }; };
  h.app.toast = (...args) => toasts.push(args);
  const showErrors = h.app.showFormErrors;
  h.app.showFormErrors = (form, result) => { errors.push(result); showErrors(form, result); };
  for (const method of ['post', 'patch', 'del']) h.app[method] = () => { throw new Error('Read-only portal attempted a write'); };
  return Object.assign(h, {
    reads, downloads, toasts, errors,
    start() { h.run(filename + '.js'); return this; },
    async change(id, value, event = 'change') { const input = h.ids.get(id); assert.ok(input, 'Missing ' + id); input.value = value; await input.listeners[event](); await settle(); },
    async switchProgramme(value) { await this.change('sponsorProgramme', value); },
    async switchLearner(value) { await this.change(portal === 'sponsor' ? 'sponsorMember' : 'familyLearner', value); },
    async clickCard() { const button = h.ids.get(portal === 'sponsor' ? 'sponsorCards' : 'familyCards').querySelector(portal === 'sponsor' ? '[data-sponsor-card]' : '[data-card]'); assert.ok(button); await button.listeners.click(); await settle(); return button; },
    changeIdentity(kind) {
      if (kind === 'token') h.context.localStorage.getItem = key => key === 'mgaems_token' ? 'changed-token' : JSON.stringify({ username: 'test-user', role });
      else if (kind === 'path') h.context.window.location.pathname = '/dashboard.html';
      else h.app.currentUser = () => ({ username: kind === 'account' ? 'changed-user' : 'test-user', role: kind === 'role' ? 'teacher' : role });
    },
  });
}

test('Sponsor Portal is extracted into scoped assets, preserves shared branding and has no inline control handlers', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../public/sponsor-portal.html'), 'utf8');
  assert.match(html, /assets\/sponsor-portal\.js/); assert.match(html, /assets\/sponsor-portal\.css/); assert.match(html, /assets\/role-workspaces\.css/); assert.match(html, /assets\/nav\.js/);
  assert.doesNotMatch(html, /<style>|<script>[^<]|onclick=|Logo_Manna|uploads\/school/);
  const source = fs.readFileSync(path.resolve(__dirname, '../../public/assets/sponsor-portal.js'), 'utf8');
  assert.match(source, /renderAppShell\('\/sponsor-portal\.html'\)/); assert.doesNotMatch(source, /onclick=|\/api\/v1\/health|localStorage\.setItem|\/api\/v1\/students/);
});

test('only Sponsor accounts issue Sponsor Portal reads and other roles return to their own landing pages', async () => {
  for (const role of ['system_admin', 'head_teacher', 'deputy_head_teacher', 'teacher', 'sponsor_coordinator', 'parent_guardian', 'student', 'unknown']) {
    const h = harness({ role }).start(); await settle(); assert.deepEqual(h.reads, []); assert.equal(h.context.window.location.href, role === 'parent_guardian' ? '/parent-portal.html' : '/dashboard.html');
  }
});

test('programme selector clearly displays actual assignments, types, states and saved dates', async () => {
  const h = harness().start(); await settle(); const html = h.ids.get('sponsorSelector').innerHTML;
  for (const text of ['3 linked programmes', 'Individual', 'Group', 'School-wide', 'Active', 'Paused', 'Ended']) assert.match(html, new RegExp(text));
  assert.match(h.ids.get('sponsorView').innerHTML, /5 Jan 2026|End date|Not recorded/);
  assert.equal(h.ids.get('sponsorProgramme').getAttribute('aria-describedby'), 'sponsorProgrammeHint');
  assert.match(h.ids.get('sponsorLearnerView').innerHTML, /Synthetic 31 Learner|TEST-31|Class 31/); assert.equal(h.ids.has('sponsorMember'), false);
});

test('school-wide programmes never fetch or display a learner roster, attendance, progress or report cards', async () => {
  const h = harness().start(); await settle(); const before = h.reads.length; await h.switchProgramme('30');
  assert.equal(h.reads.length, before); assert.match(h.ids.get('sponsorView').innerHTML, /School partnership|programme level|personal records are unavailable/); assert.equal(h.ids.get('sponsorLearnerView').innerHTML, '');
  assert.equal(h.ids.has('sponsorMember'), false); assert.equal(h.ids.has('sponsorCards'), false);
});

test('Group membership selection follows explicit server learners and scoped endpoints', async () => {
  const h = harness().start(); await settle(); await h.switchProgramme('20');
  assert.deepEqual(h.ids.get('sponsorMember').children.map(item => item.getAttribute('value')), ['31', '32']);
  assert.match(h.ids.get('sponsorMembers').innerHTML, /2 linked learners/); await h.switchLearner('32');
  for (const suffix of ['/attendance', '/comments', '/report-cards']) assert.ok(h.reads.includes('/api/v1/portal/sponsor/sponsorships/20/learners/32' + suffix));
  assert.match(h.ids.get('sponsorProgress').innerHTML, /Mathematics 32/); assert.match(h.ids.get('sponsorCards').innerHTML, /First term 32/);
});

test('forged programme and member values do not issue a request or disclose another learner', async () => {
  const h = harness().start(); await settle(); let before = h.reads.length; await h.switchProgramme('999'); assert.equal(h.reads.length, before);
  await h.switchProgramme('20'); before = h.reads.length; await h.switchLearner('999'); assert.equal(h.reads.length, before); assert.match(h.ids.get('sponsorLearnerView').innerHTML, /Synthetic 31/);
});

test('Individual membership mismatches and duplicate/malformed learner rows fail safely', async () => {
  for (const rows of [[learner(99)], [learner(31), learner(32)], [null], [learner(31), learner(31)]]) {
    const h = harness({ get: url => url === '/api/v1/portal/sponsor/sponsorships/10/learners' ? { ok: true, data: rows } : undefined }).start(); await settle();
    assert.match(h.ids.get('sponsorMembers').innerHTML, /unexpected learner membership/); assert.equal(h.reads.some(url => url.endsWith('/attendance')), false);
  }
});

test('malformed or duplicate programme lists do not populate selection or learner requests', async () => {
  for (const items of [[null], [programmes()[0], programmes()[0]], [{ ...programmes()[0], status: 'unknown' }], [{ ...programmes()[0], sponsorship_type: 'unknown' }]]) {
    const h = harness({ items }).start(); await settle(); assert.match(h.ids.get('sponsorStatus').innerHTML, /unexpected programme/); assert.equal(h.reads.length, 1); assert.equal(h.ids.has('sponsorProgramme'), false);
  }
});

test('programme and learner loading, empty and failure states are useful and retryable', async () => {
  let release; const h = harness({ get: url => url === '/api/v1/portal/sponsor/sponsorships' ? new Promise(resolve => { release = resolve; }) : undefined }).start(); assert.match(h.ids.get('sponsorStatus').innerHTML, /Loading your programmes/);
  release({ ok: true, data: [] }); await settle(); assert.match(h.ids.get('sponsorStatus').innerHTML, /No sponsorships linked/);
  const empty = harness({ get: url => url.endsWith('/10/learners') ? { ok: true, data: [] } : undefined }).start(); await settle(); assert.match(empty.ids.get('sponsorMembers').innerHTML, /No learners explicitly linked/);
  let attempts = 0; const failed = harness({ get: url => url === '/api/v1/portal/sponsor/sponsorships' && ++attempts === 1 ? { ok: false, status: 503, error: '<Programme unavailable>' } : undefined }).start(); await settle();
  assert.match(failed.ids.get('sponsorStatus').innerHTML, /&lt;Programme unavailable&gt;/); failed.ids.get('sponsorStatus').querySelector('[data-portal-retry]').listeners.click(); await settle(); assert.ok(failed.ids.get('sponsorProgramme'));
});

test('late membership data cannot repaint a new programme or school-wide selection', async () => {
  let release; const h = harness({ get: url => url.endsWith('/10/learners') ? new Promise(resolve => { release = resolve; }) : undefined }).start(); await settle();
  await h.switchProgramme('30'); release({ ok: true, data: [learner(31)] }); await settle(); assert.equal(h.ids.get('sponsorLearnerView').innerHTML, ''); assert.match(h.ids.get('sponsorView').innerHTML, /School partnership/); assert.equal(h.reads.some(url => url.endsWith('/attendance')), false);
});

test('late attendance feedback and cards cannot cross Group member selections', async () => {
  const releases = []; const h = harness({ get: url => url.includes('/20/learners/31/') ? new Promise(resolve => releases.push(resolve)) : undefined }).start(); await settle(); await h.switchProgramme('20'); await h.switchLearner('32');
  for (const release of releases) release({ ok: true, data: { private: 'OLD-MEMBER-SENTINEL' } }); await settle();
  assert.match(h.ids.get('sponsorLearnerView').innerHTML, /Synthetic 32/); assert.match(h.ids.get('sponsorProgress').innerHTML, /Mathematics 32/); assert.match(h.ids.get('sponsorCards').innerHTML, /First term 32/);
  for (const id of ['sponsorAttendance', 'sponsorProgress', 'sponsorCards']) assert.doesNotMatch(h.ids.get(id).innerHTML, /OLD-MEMBER-SENTINEL|unexpected/);
});

test('one failed learner section preserves the other permitted sections and retries independently', async () => {
  let attempts = 0; const h = harness({ get: url => url.endsWith('/10/comments') && ++attempts === 1 ? { ok: false, status: 503, error: 'Feedback unavailable' } : undefined }).start(); await settle();
  assert.match(h.ids.get('sponsorProgress').innerHTML, /Feedback unavailable/); assert.match(h.ids.get('sponsorAttendance').innerHTML, /66\.7%/); assert.match(h.ids.get('sponsorCards').innerHTML, /PDF available/);
  h.ids.get('sponsorProgress').querySelector('[data-portal-retry]').listeners.click(); await settle(); assert.match(h.ids.get('sponsorProgress').innerHTML, /Mathematics 31/);
});

test('ownership denial clears selected programme data and suppresses pending learner responses', async () => {
  let release; const h = harness({ get: url => url.endsWith('/10/comments') ? new Promise(resolve => { release = resolve; }) : undefined }).start(); await settle();
  release({ ok: false, status: 403 }); await settle(); assert.equal(h.ids.get('sponsorSelector').innerHTML, ''); assert.equal(h.ids.get('sponsorView').innerHTML, ''); assert.match(h.ids.get('sponsorStatus').innerHTML, /Sponsorship access unavailable/);
});

test('Sponsor attendance displays backend totals and recent records while absence remains distinct from unrecorded', async () => {
  const h = harness().start(); await settle(); const html = h.ids.get('sponsorAttendance').innerHTML;
  assert.match(html, /3 recorded days|66\.7%|Up to 30 most recent records|1 Oct 2026/); assert.match(html, /<dt>Excused<\/dt><dd>0<\/dd>/);
  const empty = harness({ get: url => url.endsWith('/10/attendance') ? { ok: true, data: { student_id: 31, summary: { total: 0, present: 0, absent: 0, late: 0, excused: 0, attendance_percentage: null }, recent: [] } } : undefined }).start(); await settle(); assert.match(empty.ids.get('sponsorAttendance').innerHTML, /No recorded attendance/); assert.doesNotMatch(empty.ids.get('sponsorAttendance').innerHTML, /0%/);
});

test('unexpected attendance identity, negative totals or malformed rows receive safe error states', async () => {
  for (const data of [{ student_id: 99, summary: summary(), recent: [] }, { student_id: 31, summary: { ...summary(), total: -1 }, recent: [] }, { student_id: 31, summary: summary(), recent: [null] }]) {
    const h = harness({ get: url => url.endsWith('/10/attendance') ? { ok: true, data } : undefined }).start(); await settle(); assert.match(h.ids.get('sponsorAttendance').innerHTML, /unexpected learner information/); assert.match(h.ids.get('sponsorProgress').innerHTML, /Mathematics 31/);
  }
});

test('Sponsor feedback separates assessment type score performance and remarks without claiming publication', async () => {
  const h = harness().start(); await settle(); const html = h.ids.get('sponsorProgress').innerHTML;
  assert.match(html, /Continuous/); assert.match(html, /End-term/); assert.match(html, /<dt>Score<\/dt><dd>0<\/dd>/); assert.match(html, /<dt>Score<\/dt><dd>Not recorded<\/dd>/); assert.match(html, /Performance level|Remarks|EE/);
  assert.doesNotMatch(html, /Published|PRIVATE-HEALTH|PRIVATE-CONTACT|weighted|average/); assert.match(h.ids.get('sponsorLearnerView').innerHTML, /Recorded assessment feedback/);
});

test('Sponsor report availability exposes permitted PDF actions without private paths or revision controls', async () => {
  const h = harness().start(); await settle(); const html = h.ids.get('sponsorCards').innerHTML;
  assert.match(html, /First term 31|PDF available|File unavailable/); assert.equal(h.ids.get('sponsorCards').querySelectorAll('[data-sponsor-card]').length, 1); assert.doesNotMatch(html, /REPORT-SENTINEL|file_path|Publish|Generate|Revision history/);
  const empty = harness({ get: url => url.endsWith('/10/report-cards') ? { ok: true, data: [] } : undefined }).start(); await settle(); assert.match(empty.ids.get('sponsorCards').innerHTML, /No report cards available/);
});

test('report download feedback captures programme learner and report identities and prevents duplicate requests', async () => {
  let release; const h = harness({ download: () => new Promise(resolve => { release = resolve; }) }).start(); await settle(); await h.switchProgramme('20'); await h.switchLearner('32');
  const button = h.ids.get('sponsorCards').querySelector('[data-sponsor-card]'), pending = button.listeners.click(); await button.listeners.click();
  assert.equal(h.downloads.length, 1); assert.equal(h.downloads[0].url, '/api/v1/portal/sponsor/sponsorships/20/learners/32/report-cards/320/download'); assert.equal(h.downloads[0].filename, 'report-card-TEST-32.pdf'); assert.equal(h.downloads[0].options.isCurrent(), true); assert.equal(button.disabled, true); assert.match(h.ids.get('sponsorDownloadStatus').textContent, /Preparing/);
  release({ ok: true }); await pending; assert.equal(button.disabled, false); assert.match(h.ids.get('sponsorDownloadStatus').textContent, /download started/);
});

test('late download callbacks invalidate delivery and feedback after programme or member changes', async () => {
  for (const change of ['programme', 'member']) {
    let release; const h = harness({ download: () => new Promise(resolve => { release = resolve; }) }).start(); await settle(); await h.switchProgramme('20');
    const pending = h.ids.get('sponsorCards').querySelector('[data-sponsor-card]').listeners.click();
    if (change === 'programme') await h.switchProgramme('30'); else await h.switchLearner('32');
    assert.equal(h.downloads[0].options.isCurrent(), false); release({ ok: false, error: 'STALE-DOWNLOAD-SENTINEL' }); await pending;
    assert.deepEqual(h.toasts, []); assert.doesNotMatch(h.ids.get('sponsorView').innerHTML, /STALE-DOWNLOAD-SENTINEL/);
    if (change === 'member') assert.equal(h.ids.get('sponsorDownloadStatus').textContent, undefined);
  }
});

test('download errors remain actionable and report ownership denial clears all selected learner data', async () => {
  const failed = harness({ download: () => ({ ok: false, status: 404, error: 'PDF unavailable' }) }).start(); await settle(); await failed.clickCard(); assert.equal(failed.toasts[0][1], 'error'); assert.match(failed.ids.get('sponsorDownloadStatus').textContent, /PDF unavailable/);
  const denied = harness({ download: () => ({ ok: false, status: 403 }) }).start(); await settle(); await denied.clickCard(); assert.equal(denied.ids.get('sponsorView').innerHTML, ''); assert.match(denied.ids.get('sponsorStatus').innerHTML, /access unavailable/);
});

test('Sponsor refresh retains a still-owned programme and late refresh responses never restore removed membership', async () => {
  let delayed = false, release; const h = harness({ get: url => delayed && url === '/api/v1/portal/sponsor/sponsorships' ? new Promise(resolve => { release = resolve; }) : undefined }).start(); await settle(); await h.switchProgramme('20');
  h.ids.get('sponsorRefresh').listeners.click(); await settle(); assert.equal(h.ids.get('sponsorProgramme').value, '20');
  delayed = true; h.ids.get('sponsorRefresh').listeners.click(); await settle(); assert.equal(h.ids.get('sponsorView').innerHTML, ''); release({ ok: true, data: [programmes()[2]] }); await settle(); assert.equal(h.ids.get('sponsorProgramme').value, '30'); assert.equal(h.ids.get('sponsorLearnerView').innerHTML, '');
});

test('Sponsor session token account role and route changes suppress pending sensitive responses', async () => {
  for (const change of ['token', 'account', 'role', 'path']) {
    let release; const h = harness({ get: url => url.endsWith('/10/comments') ? new Promise(resolve => { release = resolve; }) : undefined }).start(); await settle(); h.changeIdentity(change); release({ ok: true, data: progress(31) }); await settle();
    assert.match(h.ids.get('appMain').innerHTML, /session changed/); assert.doesNotMatch(h.ids.get('appMain').innerHTML, /Synthetic 31|Feedback 31/);
  }
});

test('Sponsor portal never accesses operational learner directories, Health, messaging or finance APIs', async () => {
  const h = harness().start(); await settle(); await h.switchProgramme('20'); await h.switchLearner('32'); await h.switchProgramme('30');
  assert.ok(h.reads.every(url => url.startsWith('/api/v1/portal/sponsor/sponsorships'))); assert.equal(h.reads.some(url => /health|messages|users|staff|payments|fees|invoices|students/.test(url)), false);
  assert.doesNotMatch(h.ids.get('appMain').innerHTML, /PRIVATE-HEALTH|PRIVATE-CONTACT/);
});

test('Portal date display respects school UTC handling and never fills missing programme dates with today', async () => {
  const h = harness({ items: [{ ...programmes()[2], start_date: '2026-10-01T21:30:00Z', end_date: '2026-02-30' }] }).start(); await settle();
  assert.match(h.ids.get('sponsorView').innerHTML, /2 Oct 2026/); assert.match(h.ids.get('sponsorView').innerHTML, /End date<\/dt><dd>Not recorded/);
});

test('Sponsor section links provide focusable labeled targets and native programme/member keyboard controls', async () => {
  const h = harness().start(); await settle(); await h.switchProgramme('20');
  const links = h.ids.get('sponsorLearnerView').querySelectorAll('a'); assert.equal(links.length, 3);
  for (const link of links) { const target = h.ids.get(link.getAttribute('href').slice(1)); assert.equal(target.getAttribute('tabindex'), '-1'); assert.ok(target.getAttribute('aria-labelledby')); link.listeners.click(); assert.equal(h.document.activeElement, target); }
  assert.equal(h.ids.get('sponsorMember').getAttribute('aria-describedby'), 'sponsorMemberHint');
});

test('Parent progress filters remain client-side and preserve continuous/end-term score and missing values', async () => {
  const h = harness({ portal: 'parent' }).start(); await settle(); const before = h.reads.length;
  await h.change('familyProgressType', 'continuous'); assert.match(h.ids.get('familyProgressRows').innerHTML, /Mathematics 31/); assert.doesNotMatch(h.ids.get('familyProgressRows').innerHTML, /Languages 31/); assert.match(h.ids.get('familyProgressRows').innerHTML, /<dt>Score<\/dt><dd>0<\/dd>/);
  await h.change('familyProgressType', 'end_term'); assert.match(h.ids.get('familyProgressRows').innerHTML, /Not recorded/); await h.change('familyProgressSearch', 'unknown area', 'input'); assert.match(h.ids.get('familyProgressRows').innerHTML, /No results match/); assert.equal(h.reads.length, before);
});

test('Parent child change resets progress filters and cannot use stale filter callbacks for another child', async () => {
  const h = harness({ portal: 'parent' }).start(); await settle(); const old = h.ids.get('familyProgressSearch'); await h.change('familyProgressSearch', 'mathematics', 'input'); await h.switchLearner('32'); const before = h.ids.get('familyProgress').innerHTML; old.value = 'STALE-SENTINEL'; old.listeners.input();
  assert.equal(h.ids.get('familyProgressSearch').value, ''); assert.match(before, /Mathematics 32|Languages 32/); assert.equal(h.ids.get('familyProgress').innerHTML, before); assert.doesNotMatch(h.ids.get('familyProgressRows').innerHTML, /No results match/);
});

test('Parent announcements show authorized audience and school publication date without message compose', async () => {
  const h = harness({ portal: 'parent' }).start(); await settle(); assert.match(h.ids.get('familyAnnouncements').innerHTML, /Parent \/ Guardian|2 Oct 2026/); assert.doesNotMatch(h.ids.get('appMain').innerHTML, /Compose|PRIVATE-HEALTH|PRIVATE-CONTACT/);
  const wrong = harness({ portal: 'parent', get: url => url === '/api/v1/announcements' ? { ok: true, data: [{ title: 'STAFF-SENTINEL', body: 'Confidential staff update', audience: 'staff' }] } : undefined }).start(); await settle(); assert.match(wrong.ids.get('familyAnnouncements').innerHTML, /unexpected announcements/); assert.doesNotMatch(wrong.ids.get('familyAnnouncements').innerHTML, /STAFF-SENTINEL/);
});

test('malformed linked-child lists and wrong overview identities cannot disclose unrelated learners', async () => {
  for (const children of [[null], [learner(31), learner(31)], [learner(0)]]) { const h = harness({ portal: 'parent', children }).start(); await settle(); assert.match(h.ids.get('familyStatus').innerHTML, /unexpected learner list/); assert.equal(h.reads.some(url => /children\/\d/.test(url)), false); }
  const wrong = harness({ portal: 'parent', get: url => /children\/31$/.test(url) ? { ok: true, data: { ...learner(99), current_periods: [] } } : undefined }).start(); await settle(); assert.match(wrong.ids.get('familyOverview').innerHTML, /unexpected child information/); assert.doesNotMatch(wrong.ids.get('familyOverview').innerHTML, /TEST-99|Class 99/);
});

test('Parent attendance rejects impossible dates and wrong learner identities without replacing other sections', async () => {
  const h = harness({ portal: 'parent' }).start(); await settle(); const before = h.reads.length; h.ids.get('familyFrom').value = '2026-02-30'; h.ids.get('familyAttendanceFilter').listeners.submit({ preventDefault() {} }); await settle(); assert.equal(h.reads.length, before); assert.equal(h.ids.get('familyFrom').getAttribute('aria-invalid'), 'true');
  const wrong = harness({ portal: 'parent', get: url => url.includes('/children/31/attendance') ? { ok: true, data: { student_id: 99, summary: summary(), records: [] }, meta: { total: 3, per_page: 30 } } : undefined }).start(); await settle(); assert.match(wrong.ids.get('familyAttendance').innerHTML, /unexpected attendance data/); assert.match(wrong.ids.get('familyProgress').innerHTML, /Mathematics 31/);
});

test('Parent report downloads provide visible success and failure feedback and a live selector guard', async () => {
  const h = harness({ portal: 'parent' }).start(); await settle(); await h.clickCard(); assert.match(h.ids.get('familyDownloadStatus').textContent, /download started/); assert.equal(h.downloads[0].options.isCurrent(), true); await h.switchLearner('32'); assert.equal(h.downloads[0].options.isCurrent(), false);
  const failed = harness({ portal: 'parent', download: () => ({ ok: false, status: 409, error: 'PDF integrity unavailable' }) }).start(); await settle(); await failed.clickCard(); assert.match(failed.ids.get('familyDownloadStatus').textContent, /PDF integrity unavailable/); assert.equal(failed.toasts[0][1], 'error');
});

test('Parent pending pane and announcement reads clear on token account role or route changes', async () => {
  for (const change of ['token', 'account', 'role', 'path']) {
    const releases = []; const h = harness({ portal: 'parent', get: url => url.endsWith('/progress') || url === '/api/v1/announcements' ? new Promise(resolve => releases.push(resolve)) : undefined }).start(); await settle(); h.changeIdentity(change);
    for (const release of releases) release({ ok: true, data: [{ subject: 'STALE-PARENT-SENTINEL', title: 'STALE-ANNOUNCEMENT-SENTINEL', body: 'private' }] }); await settle();
    assert.match(h.ids.get('appMain').innerHTML, /session changed/); assert.doesNotMatch(h.ids.get('appMain').innerHTML, /STALE-PARENT-SENTINEL|STALE-ANNOUNCEMENT-SENTINEL|Synthetic 31/);
  }
});

test('null progress report timetable or announcement rows produce safe unavailable states', async () => {
  const parent = harness({ portal: 'parent', get: url => url.endsWith('/progress') || url.endsWith('/report-cards') || url.endsWith('/timetable') || url === '/api/v1/announcements' ? { ok: true, data: [null] } : undefined }).start(); await settle();
  for (const id of ['familyProgress', 'familyCards', 'familyTimetable', 'familyAnnouncements']) assert.match(parent.ids.get(id).innerHTML, /unexpected/);
  const sponsor = harness({ get: url => url.endsWith('/comments') || url.endsWith('/report-cards') ? { ok: true, data: [null] } : undefined }).start(); await settle();
  assert.match(sponsor.ids.get('sponsorProgress').innerHTML, /unexpected/); assert.match(sponsor.ids.get('sponsorCards').innerHTML, /unexpected/);
});

test('Portal scoped styles preserve theme tokens, readable mobile cards and focus targets without decoration', () => {
  for (const name of ['sponsor-portal', 'parent-portal']) {
    const css = fs.readFileSync(path.resolve(__dirname, '../../public/assets/' + name + '.css'), 'utf8'), html = fs.readFileSync(path.resolve(__dirname, '../../public/' + name + '.html'), 'utf8');
    assert.match(css, /@media \(max-width: 640px\)/); assert.match(css, /var\(--touch-target\)/); assert.doesNotMatch(css, /#[a-f\d]{3,8}\b|linear-gradient|animation:/i); assert.match(html, new RegExp('assets/' + name + '\\.css')); assert.match(html, /lucide@latest" defer/);
  }
  const css = fs.readFileSync(path.resolve(__dirname, '../../public/assets/sponsor-portal.css'), 'utf8'); assert.match(css, /:focus-visible/); assert.match(css, /var\(--focus-ring\)/);
});

test('inconsistent attendance counts never masquerade as zero records or valid totals', async () => {
  const parent = harness({ portal: 'parent', get: url => url.includes('/children/31/attendance') ? { ok: true, data: { student_id: 31, summary: { total: 0 }, records: [{ date: '2026-10-01', status: 'present' }] }, meta: { total: 0, per_page: 30 } } : undefined }).start(); await settle(); assert.match(parent.ids.get('familyAttendance').innerHTML, /inconsistent attendance totals/); assert.doesNotMatch(parent.ids.get('familyAttendance').innerHTML, /No recorded attendance/);
  const sponsor = harness({ get: url => url.endsWith('/10/attendance') ? { ok: true, data: { student_id: 31, summary: { ...summary(), present: 9 }, recent: [] } } : undefined }).start(); await settle(); assert.match(sponsor.ids.get('sponsorAttendance').innerHTML, /unexpected learner information/);
});
