const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ role = 'parent_guardian', children, get, download } = {}) {
  const h = createDOM(role, '/parent-portal.html'), requests = [], downloads = [], toasts = [];
  const linked = children || [{ id: 1, first_name: '<Child A>', last_name: 'Family', admission_no: 'A1', status: 'active', class: { name: 'Class A' } },
    { id: 2, first_name: 'Child B', last_name: 'Family', admission_no: 'B2', status: 'active', class: { name: 'Class B' } }];
  h.app.get = async url => {
    requests.push(url); if (get) { const result = await get(url); if (result) return result; }
    if (url.endsWith('/children')) return { ok: true, data: linked };
    if (url === '/api/v1/announcements') return { ok: true, data: [{ title: '<Announcement>', body: '<Parent update>', audience: 'parents' }] };
    const id = url.match(/children\/(\d+)/)?.[1]; const child = linked.find(item => String(item.id) === id);
    if (!child) throw new Error('Unknown child request '+url);
    if (/children\/\d+$/.test(url)) return { ok: true, data: { ...child, current_periods: [{ name: '<Term>', academic_year: { name: '<Year>' } }], private: 'private-sentinel' } };
    if (url.includes('/attendance?')) return { ok: true, data: { summary: { total: 31, present: 29, absent: 1, late: 1, excused: 0, attendance_percentage: 96.8 },
      records: [{ date: '2026-10-01', status: 'present', class: { name: 'Historical class '+id } }] }, meta: { total: 31, page: 1, per_page: 30 } };
    if (url.endsWith('/progress')) return { ok: true, data: [{ subject: '<Subject '+id+'>', term: '<Term>', assessment_type: 'continuous', score: 0, competency_rating: '<Stored level>', remarks: '<Published remark>', published_date: '2026-10-01' },
      { subject: 'Subject '+id, assessment_type: 'end_term', score: 42 }] };
    if (url.endsWith('/report-cards')) return { ok: true, data: [{ id: Number(id) * 10, term: { name: 'Report '+id }, generated_date: '2026-10-01', overall_remark: '<Published>', download_available: true }] };
    if (url.endsWith('/timetable')) return { ok: true, data: [{ day_of_week: 1, start_time: '09:00:00', end_time: '09:40:00', subject: { name: 'Lesson '+id } }] };
    throw new Error('Unexpected API '+url);
  };
  h.app.download = async (url, filename) => { downloads.push({ url, filename }); return download ? download(url, filename) : { ok: true }; };
  h.app.toast = (...args) => toasts.push(args); h.app.post = () => { throw new Error('Family reader attempted a write'); };
  h.run('parent-portal.js'); return { ...h, requests, downloads, toasts, linked };
}
function switchChild(h, id) { h.ids.get('familyLearner').value = id; h.ids.get('familyLearner').listeners.change(); }

test('multiple-child selector keeps all sections on the selected child with educational-only overview', async () => {
  const h = harness(); await flush();
  assert.deepEqual(h.ids.get('familyLearner').children.map(item => item.attrs.value), ['1', '2']);
  assert.match(h.ids.get('familyChild').innerHTML, /&lt;Child A&gt;/);
  assert.doesNotMatch(h.ids.get('familyOverview').innerHTML, /private-sentinel/);
  switchChild(h, '2'); await flush();
  assert.match(h.ids.get('familyChild').innerHTML, /Child B/);
  assert.match(h.ids.get('familyAttendance').innerHTML, /Historical class 2/);
  assert.match(h.ids.get('familyProgress').innerHTML, /&lt;Subject 2&gt;/);
  assert.match(h.ids.get('familyCards').innerHTML, /Report 2/);
  assert.match(h.ids.get('familyTimetable').innerHTML, /Lesson 2/);
});
test('delayed overview attendance progress report and timetable responses cannot cross child selection', async () => {
  const releases = [];
  const h = harness({ get: url => url.includes('/children/1') ? new Promise(resolve => releases.push(resolve)) : undefined }); await flush();
  switchChild(h, '2'); await flush();
  for (const release of releases) release({ ok: true, data: { private: 'stale-child-A-sentinel' }, meta: {} }); await flush();
  assert.match(h.ids.get('familyOverview').innerHTML, /Class B/);
  for (const id of ['familyOverview', 'familyAttendance', 'familyProgress', 'familyCards', 'familyTimetable']) assert.doesNotMatch(h.ids.get(id).innerHTML, /stale-child-A-sentinel|unexpected/);
});
test('single and no-child accounts never fall back to another learner or fabricate empty attendance', async () => {
  const one = harness({ children: [{ id: 2, first_name: 'Only child', admission_no: 'B2' }] }); await flush();
  assert.deepEqual(one.ids.get('familyLearner').children.map(item => item.attrs.value), ['2']);
  const empty = harness({ children: [] }); await flush();
  assert.match(empty.ids.get('familyStatus').innerHTML, /No linked children/);
  assert.equal(empty.requests.some(url => /children\/\d/.test(url)), false);
  assert.match(empty.ids.get('familyAnnouncements').innerHTML, /&lt;Announcement&gt;/);
});
test('removal denial clears all selected-child data and invalidates pending responses', async () => {
  let forbidden;
  const h = harness({ get: url => url.endsWith('/progress') && url.includes('/1/') ? new Promise(resolve => { forbidden = resolve; }) : undefined }); await flush();
  assert.match(h.ids.get('familyOverview').innerHTML, /Class A/);
  forbidden({ ok: false, status: 403 }); await flush();
  assert.equal(h.ids.get('familyChild').innerHTML, ''); assert.equal(h.ids.get('childSelector').innerHTML, '');
  assert.match(h.ids.get('familyStatus').innerHTML, /Learner access unavailable/);
});
test('attendance filters and pagination stay child-specific and no-record remains distinct from absent', async () => {
  const h = harness(); await flush(); h.ids.get('familyNext').listeners.click(); await flush();
  assert.match(h.requests.at(-1), /children\/1\/attendance\?page=2/);
  h.ids.get('familyFrom').value = '2026-09-01'; h.ids.get('familyTo').value = '2026-10-01';
  h.ids.get('familyAttendanceFilter').listeners.submit({ preventDefault() {} }); await flush();
  const params = new URLSearchParams(h.requests.at(-1).split('?')[1]); assert.equal(params.get('page'), '1'); assert.equal(params.get('from'), '2026-09-01');
  const empty = harness({ get: async url => url.includes('/attendance?') ? { ok: true, data: { summary: { total: 0, attendance_percentage: null }, records: [] }, meta: { total: 0, per_page: 30 } } : undefined }); await flush();
  assert.match(empty.ids.get('familyAttendance').innerHTML, /No recorded attendance/); assert.doesNotMatch(empty.ids.get('familyAttendance').innerHTML, /0%/);
});
test('report-derived progress keeps continuous end-term score zero and stored performance terminology', async () => {
  const h = harness(); await flush(); const html = h.ids.get('familyProgress').innerHTML;
  assert.match(html, /Continuous/); assert.match(html, /End-term/); assert.match(html, /Performance level/); assert.match(html, /<td>0<\/td>/);
  assert.match(html, /&lt;Stored level&gt;/); assert.doesNotMatch(html, /average|weighted|grade|<Published remark>/i);
});
test('report download captures child identity and filename before switching learners', async () => {
  let finish;
  const h = harness({ download: () => new Promise(resolve => { finish = resolve; }) }); await flush();
  h.ids.get('familyCards').querySelector('[data-card]').listeners.click(); switchChild(h, '2'); await flush();
  assert.deepEqual(h.downloads, [{ url: '/api/v1/portal/parent/children/1/report-cards/10/download', filename: 'report-card-A1.pdf' }]);
  finish({ ok: true }); await flush(); assert.match(h.ids.get('familyCards').innerHTML, /Report 2/);
});
test('one unavailable section preserves other child sections and provides an escaped retry', async () => {
  let attempts = 0;
  const h = harness({ get: async url => url.endsWith('/timetable') && ++attempts === 1 ? { ok: false, status: 503, error: '<Unavailable>' } : undefined }); await flush();
  assert.match(h.ids.get('familyTimetable').innerHTML, /&lt;Unavailable&gt;/); assert.match(h.ids.get('familyAttendance').innerHTML, /Historical class 1/);
  h.ids.get('familyTimetable').querySelector('[data-retry]').listeners.click(); await flush(); assert.match(h.ids.get('familyTimetable').innerHTML, /Lesson 1/);
});
test('refresh preserves a still-authorized selected child and ignores a forged selector value', async () => {
  const h = harness(); await flush(); switchChild(h, '2'); await flush();
  const count = h.requests.length; switchChild(h, '999'); assert.equal(h.requests.length, count);
  h.ids.get('refreshFamily').listeners.click(); await flush(); assert.equal(h.ids.get('familyLearner').value, '2');
});
test('Student Sponsor Teacher and leadership visits cannot impersonate a Parent or issue family requests', () => {
  for (const role of ['student', 'sponsor', 'teacher', 'system_admin', 'head_teacher', 'deputy_head_teacher', 'sponsor_coordinator']) {
    const h = harness({ role }); assert.deepEqual(h.requests, []);
    assert.equal(h.context.window.location.href, role === 'sponsor' ? '/sponsor-portal.html' : '/dashboard.html');
  }
});
test('Parent portal uses announcement reads without compose directory messaging or operational API requests', async () => {
  const h = harness(); await flush();
  assert.equal(h.requests.some(url => /\/users|\/staff|\/messages|\/health|\/assessments|\/sponsorships/.test(url)), false);
  assert.match(h.ids.get('familyAnnouncements').innerHTML, /&lt;Parent update&gt;/);
  assert.doesNotMatch(h.ids.get('appMain').innerHTML, /recipient|Compose|Publish announcement/i);
});
test('Administrator provisioning UI excludes new Student roles while retaining existing Student review', async () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../public/administration.html'), 'utf8');
  const create = html.slice(html.indexOf('  async function openCreateUser()'), html.indexOf('  async function viewUser('));
  const edit = html.slice(html.indexOf('  async function editUser('), html.indexOf('  async function deactivateUser('));
  for (const existingRole of ['teacher', 'student']) {
    const captured = [];
    const context = vm.createContext({ state: { roles: [{ name: 'student' }, { name: 'teacher' }, { name: 'parent_guardian' }] },
      MGAEMS: { get: async () => ({ ok: true, data: { id: 1, username: 'Fixture', email: 'fixture@example.test', role: existingRole } }) },
      loadUserRoleOptions: async () => ({ ok: true }), createModal: (title, body) => captured.push(body), esc: String, prettyRole: String });
    vm.runInContext(create + edit, context); await vm.runInContext('openCreateUser()', context);
    assert.doesNotMatch(captured[0], /value="student"/);
    await vm.runInContext('editUser(1)', context);
    assert.equal(/value="student"/.test(captured[1]), existingRole === 'student');
  }
});
