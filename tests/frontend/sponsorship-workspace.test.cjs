const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createDOM = require('./helpers/dom.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const summary = { sponsors: 2, sponsorships: 3, by_status: { active: 1, paused: 1, ended: 1 }, by_type: { individual: 1, group: 1, school_wide: 1 }, individual_assignments: 1, group_memberships: 2 };
const sponsor = { id: 5, name: '<Sponsor>', sponsor_type: 'church', sponsorships_count: 1, notes: '<Notes>', address: '<Address>', phone: '<Phone>' };
const learner = { id: 7, first_name: '<Learner>', last_name: 'Name', admission_no: '<Admission>', school_class: { name: '<Class>' } };
const item = { id: 9, sponsor: { name: '<Sponsor>' }, sponsorship_type: 'individual', student: learner, students: [], status: 'active', start_date: '2026-01-01', end_date: null, notes: '<Operational notes>' };
function harness({ role = 'sponsor_coordinator', page = '/sponsorship.html', get, hash = '' } = {}) {
  const h = createDOM(role, page), requests = [], writes = [];
  h.context.window.location.hash = hash;
  h.app.get = async url => {
    requests.push(url);
    const custom = await get?.(url); if (custom !== undefined) return custom;
    if (url.endsWith('/summary')) return { ok: true, data: summary };
    if (url === '/api/v1/sponsors/5') return { ok: true, data: sponsor };
    if (url === '/api/v1/sponsorships/9') return { ok: true, data: item };
    if (url.startsWith('/api/v1/sponsors?')) return { ok: true, data: [sponsor], meta: { page: 1, per_page: 15, total: 18 } };
    if (url.startsWith('/api/v1/sponsorships/learners?')) return { ok: true, data: [learner], meta: { page: 1, per_page: 10, total: 1 } };
    if (url.startsWith('/api/v1/sponsorships?')) return { ok: true, data: [item], meta: { page: 1, per_page: 15, total: 1 } };
    throw Error('Unexpected endpoint '+url);
  };
  h.app.patch = async (url,body) => { writes.push({ url,body }); return { ok: true }; };
  h.app.post = async (url,body) => { writes.push({ url,body }); return { ok: true }; };
  h.app.confirmAction = async () => true;
  h.app.toast = () => {};
  h.run('sponsorship-workspace.js');
  return { ...h, requests, writes };
}
test('Coordinator dashboard requests real operational summary and no academic HR Health or school roster data', async () => {
  const h = harness({ page: '/dashboard.html' }); await flush();
  assert.deepEqual(h.requests, ['/api/v1/sponsorships/summary']);
  assert.match(h.ids.get('appMain').innerHTML,/Sponsor Coordinator Workspace/);
  assert.match(h.ids.get('spSummary').innerHTML,/Group memberships \(all statuses\)/);
  assert.match(h.ids.get('spSummary').innerHTML,/relationships, not unique learners/);
  assert.equal(h.ids.has('studentsCard'),false);
  assert.match(h.ids.get('spSummary').innerHTML,/Sponsorship status|Programme types|Recorded learner relationships/);
  for (const role of ['system_admin','head_teacher','deputy_head_teacher','teacher','student','parent_guardian','sponsor']) {
    const other=harness({role,page:'/dashboard.html'});await flush();assert.equal(other.requests.length,0);
  }
});
test('summary errors retry independently and zero counts remain zero', async () => {
  let fail=true; const h=harness({page:'/dashboard.html',get: url=>url.endsWith('/summary') ? fail ? {ok:false,status:503,error:'<Offline>'} : {ok:true,data:{...summary,sponsors:0}} : undefined});await flush();
  assert.match(h.ids.get('spSummary').innerHTML,/&lt;Offline&gt;/);fail=false;
  h.ids.get('spSummary').querySelector('[data-retry]').listeners.click();await flush();
  assert.match(h.ids.get('spSummary').innerHTML,/class="num">0/);
});
test('sponsor directory escapes values and uses explicit server pagination and filters', async () => {
  const h=harness();await flush();assert.match(h.ids.get('spResults').innerHTML,/&lt;Sponsor&gt;/);
  assert.doesNotMatch(h.ids.get('spResults').innerHTML,/<Sponsor>/);
  h.ids.get('spNext').listeners.click();await flush();assert.match(h.requests.at(-1),/page=2/);
  h.ids.get('spSearch').value='name & value';h.ids.get('spTypeFilter').value='church';
  h.ids.get('spFilters').listeners.submit({preventDefault(){}});await flush();
  const params=new URLSearchParams(h.requests.at(-1).split('?')[1]);assert.equal(params.get('page'),'1');assert.equal(params.get('search'),'name & value');assert.equal(params.get('sponsor_type'),'church');
});
test('out-of-order sponsor pages cannot replace the latest filter response', async () => {
  let release;const h=harness({get:url=>url.startsWith('/api/v1/sponsors?') ? url.includes('search=latest') ? {ok:true,data:[],meta:{total:0,per_page:15,page:1}} : new Promise(r=>{release=r;}) : undefined});await flush();
  h.ids.get('spSearch').value='latest';h.ids.get('spFilters').listeners.submit({preventDefault(){}});await flush();
  release({ok:true,data:[sponsor],meta:{total:1,per_page:15,page:1}});await flush();
  assert.match(h.ids.get('spResults').innerHTML,/No sponsors found/);assert.doesNotMatch(h.ids.get('spResults').innerHTML,/Sponsor&gt;/);
});
test('denied directory clears records pagination and offers no unauthorized retry', async () => {
  const h=harness({get:url=>url.startsWith('/api/v1/sponsors?') ? {ok:false,status:403} : undefined});await flush();
  assert.match(h.ids.get('spResults').innerHTML,/Access restricted/);assert.equal(h.ids.get('spNext').disabled,true);
  assert.equal(h.ids.get('spResults').querySelector('[data-retry]'),null);
});
test('sponsor details expose only operational fields and link to paginated sponsorship filter', async () => {
  const h=harness({get:url=>url==='/api/v1/sponsors/5' ? {ok:true,data:{...sponsor,user_id:42,password_hash:'private-sentinel'}} : undefined});await flush();
  h.ids.get('spResults').querySelector('[data-view]').listeners.click();await flush();
  assert.match(h.modals[0].body.innerHTML,/&lt;Address&gt;/);assert.doesNotMatch(h.modals[0].body.innerHTML,/private-sentinel|user_id/);
  h.modals[0].body.querySelector('[data-linked]').listeners.click();await flush();assert.match(h.requests.at(-1),/sponsor_id=5/);
});
test('leadership receives read-only sponsor and sponsorship management views', async () => {
  for(const role of ['head_teacher','deputy_head_teacher']) {
    const h=harness({role});await flush();assert.equal(h.ids.has('spNew'),false);assert.equal(h.ids.get('spResults').querySelector('[data-edit]'),null);
    h.ids.get('spItems').listeners.click();await flush();assert.equal(h.ids.get('spResults').querySelector('[data-status]'),null);assert.equal(h.ids.get('spResults').querySelector('[data-end]'),null);
  }
});
test('pause and resume require confirmation before mutation and conflicts retain server authority', async () => {
  const h=harness();await flush();h.ids.get('spItems').listeners.click();await flush();
  h.app.confirmAction=async()=>false;await h.ids.get('spResults').querySelector('[data-status]').listeners.click();assert.equal(h.writes.length,0);
  h.app.confirmAction=async()=>true;await h.ids.get('spResults').querySelector('[data-status]').listeners.click();await flush();
  assert.equal(h.writes[0].url,'/api/v1/sponsorships/9');assert.equal(h.writes[0].body.status,'paused');
});
test('new sponsorship uses searched references and never preloads the school roster', async () => {
  const h=harness();await flush();h.ids.get('spItems').listeners.click();await flush();h.ids.get('spNew').listeners.click();await flush();
  assert.equal(h.requests.some(url=>url.includes('/sponsorships/learners')),false);
  h.ids.get('learnerLookup').value='M';h.ids.get('learnerFind').listeners.click();await flush();assert.equal(h.requests.some(url=>url.includes('/sponsorships/learners')),false);
  h.ids.get('learnerLookup').value='Memory';h.ids.get('learnerFind').listeners.click();await flush();assert.match(h.requests.at(-1),/sponsorships\/learners\?search=Memory/);
  assert.match(h.ids.get('learnerMatches').innerHTML,/&lt;Learner&gt;/);
});
test('group selections survive lookup paging while type changes clear membership and school-wide creates no learner target', async () => {
  const h=harness();await flush();h.ids.get('spItems').listeners.click();await flush();h.ids.get('spNew').listeners.click();await flush();
  const form=h.ids.get('spForm');form.elements.sponsorship_type.value='group';form.elements.sponsorship_type.listeners.change();
  h.ids.get('sponsorLookup').value='Memory';h.ids.get('sponsorFind').listeners.click();await flush();h.ids.get('sponsorMatches').querySelector('[data-pick]').listeners.click();
  h.ids.get('learnerLookup').value='Memory';h.ids.get('learnerFind').listeners.click();await flush();h.ids.get('learnerMatches').querySelector('[data-pick]').listeners.click();
  assert.match(h.ids.get('learnerSelected').innerHTML,/Learner/);
  form.elements.sponsorship_type.value='school_wide';form.elements.sponsorship_type.listeners.change();assert.equal(h.ids.get('learnerSelected').innerHTML,'');
  form.elements.program_name.value='Actual programme';form.elements.start_date.value='2026-10-11';await form.listeners.submit({preventDefault(){}});await flush();
  assert.equal(h.writes[0].body.sponsorship_type,'school_wide');assert.equal(h.writes[0].body.program_name,'Actual programme');assert.equal('student_ids' in h.writes[0].body,false);assert.equal('student_id' in h.writes[0].body,false);
});
test('ending requires date reason and a visible irreversible confirmation in an accessible shared dialog', async () => {
  const h=harness();await flush();h.ids.get('spItems').listeners.click();await flush();h.ids.get('spResults').querySelector('[data-end]').listeners.click();await flush();
  const form=h.ids.get('spForm');assert.match(h.modals.at(-1).body.innerHTML,/permanent and cannot be reversed/);assert.equal(form.elements.end_date.required,true);assert.equal(form.elements.notes.required,true);
  form.elements.end_date.value='2026-10-11';form.elements.notes.value='Confirmed reason';await form.listeners.submit({preventDefault(){}});assert.equal(h.writes[0].body.status,'ended');
});
test('unauthorized roles cannot initiate operational fetches and Sponsor navigation stays independent', async () => {
  for(const role of ['teacher','student','parent_guardian','sponsor','unknown']) {const h=harness({role});await flush();assert.equal(h.requests.length,0);}
  const nav=fs.readFileSync(path.resolve(__dirname,'../../public/assets/nav.js'),'utf8');assert.match(nav,/sponsor_coordinator: \['sponsorship', 'coordinator', 'communication', 'visitors'\]/);assert.match(nav,/sponsor: \['sponsor'\]/);
});

test('group membership selections survive searched pages and submit only explicitly selected IDs', async () => {
  const second={...learner,id:8,first_name:'Second'};
  const h=harness({get:url=>url.startsWith('/api/v1/sponsorships/learners?') ? {ok:true,data:[url.includes('page=2')?second:learner],meta:{total:11,per_page:10,page:url.includes('page=2')?2:1}} : undefined});await flush();
  h.ids.get('spItems').listeners.click();await flush();h.ids.get('spNew').listeners.click();
  const form=h.ids.get('spForm');form.elements.sponsorship_type.value='group';form.elements.sponsorship_type.listeners.change();
  h.ids.get('sponsorLookup').value='Sponsor';h.ids.get('sponsorFind').listeners.click();await flush();h.ids.get('sponsorMatches').querySelector('[data-pick]').listeners.click();
  h.ids.get('learnerLookup').value='Memory';h.ids.get('learnerFind').listeners.click();await flush();h.ids.get('learnerMatches').querySelector('[data-pick]').listeners.click();
  h.ids.get('learnerMore').listeners.click();await flush();h.ids.get('learnerMatches').querySelector('[data-pick]').listeners.click();
  assert.match(h.ids.get('learnerSelected').innerHTML,/Learner/);assert.match(h.ids.get('learnerSelected').innerHTML,/Second/);
  form.elements.start_date.value='2026-10-11';await form.listeners.submit({preventDefault(){}});await flush();
  assert.deepEqual(Array.from(h.writes[0].body.student_ids),[7,8]);assert.equal('program_name' in h.writes[0].body,false);
});
test('delayed allocation search cannot replace latest matches or a dismissed dialog', async () => {
  let release;const h=harness({get:url=>url.startsWith('/api/v1/sponsorships/learners?') ? url.includes('search=New') ? {ok:true,data:[],meta:{total:0,per_page:10,page:1}} : new Promise(r=>{release=r;}) : undefined});await flush();
  h.ids.get('spItems').listeners.click();await flush();h.ids.get('spNew').listeners.click();
  h.ids.get('learnerLookup').value='Old';h.ids.get('learnerFind').listeners.click();await flush();
  h.ids.get('learnerLookup').value='New';h.ids.get('learnerFind').listeners.click();await flush();
  release({ok:true,data:[learner],meta:{total:1,per_page:10,page:1}});await flush();assert.match(h.ids.get('learnerMatches').innerHTML,/No matches/);
});
test('editing a sponsor fetches details and retains entered values when field validation fails', async () => {
  const h=harness();await flush();h.ids.get('spResults').querySelector('[data-edit]').listeners.click();await flush();
  assert.equal(h.requests.at(-1),'/api/v1/sponsors/5');
  const form=h.ids.get('spForm');assert.match(h.modals.at(-1).body.innerHTML,/&lt;Address&gt;/);form.elements.name.value='Retained draft';
  h.app.patch=async()=>({ok:false,status:422,error:'<Rejected>',fields:{name:['<Name error>']}});
  await form.listeners.submit({preventDefault(){}});
  assert.equal(form.elements.name.value,'Retained draft');assert.equal(form.elements.name.attrs['aria-invalid'],'true');
  assert.match(h.ids.get('spFormAlert').innerHTML,/&lt;Name error&gt;/);assert.equal(h.modals.at(-1).closed,false);assert.equal(h.modals.at(-1).busy,false);
});
test('school-wide detail UI omits unexpected learner account and medical payloads', async () => {
  const h=harness({get:url=>url==='/api/v1/sponsorships/9' ? {ok:true,data:{...item,sponsorship_type:'school_wide',program_name:'<Programme>',student:{...learner,first_name:'private-learner'},students:[learner],medical_info:'private-medical',created_by:{username:'private-account'}}} : undefined});await flush();
  h.ids.get('spItems').listeners.click();await flush();h.ids.get('spResults').querySelector('[data-view]').listeners.click();await flush();
  assert.match(h.modals[0].body.innerHTML,/&lt;Programme&gt;/);assert.doesNotMatch(h.modals[0].body.innerHTML,/private-|Group Members|Learner&gt;/);
});
test('generic dashboard yields to Coordinator workspace without overwriting it or fetching school data', async () => {
  const h=harness({page:'/dashboard.html'});await flush();h.run('dashboard.js');await flush();assert.deepEqual(h.requests,['/api/v1/sponsorships/summary']);assert.equal(h.ids.has('statsCards'),false);
});

test('a pending save cannot submit a duplicate sponsorship mutation', async () => {
  const h=harness();await flush();h.ids.get('spItems').listeners.click();await flush();h.ids.get('spResults').querySelector('[data-end]').listeners.click();
  const form=h.ids.get('spForm');form.elements.end_date.value='2026-10-11';form.elements.notes.value='Confirmed reason';
  let resolve;let calls=0;h.app.patch=()=>{calls++;return new Promise(r=>{resolve=r;});};
  const first=form.listeners.submit({preventDefault(){}});await flush();
  await form.listeners.submit({preventDefault(){}});assert.equal(calls,1);assert.equal(h.modals.at(-1).busy,true);
  resolve({ok:true});await first;await flush();assert.equal(h.modals.at(-1).closed,true);
});

test('directory tabs support roving keyboard focus and dashboard links select the intended directory', async () => {
  const h = harness({ hash: '#sponsorships' }); await flush();
  assert.equal(h.ids.get('spItems').attrs['aria-selected'], 'true'); assert.match(h.requests[0], /\/sponsorships\?/);
  h.ids.get('spItems').listeners.keydown({ key: 'Home', preventDefault() {} }); await flush();
  assert.equal(h.ids.get('spSponsors').attrs['aria-selected'], 'true'); assert.equal(h.ids.get('spItems').tabIndex, -1);
  assert.equal(h.document.activeElement, h.ids.get('spSponsors')); assert.equal(h.ids.get('spView').attrs['aria-labelledby'], 'spSponsors');
  h.ids.get('spSponsors').listeners.keydown({ key: 'ArrowRight', preventDefault() {} }); await flush(); assert.equal(h.ids.get('spItems').attrs['aria-selected'], 'true');
  const dashboard = harness({ page: '/dashboard.html' }); await flush();
  assert.match(dashboard.ids.get('appMain').innerHTML, /href="\/sponsorship.html#sponsors"/); assert.match(dashboard.ids.get('appMain').innerHTML, /href="\/sponsorship.html#sponsorships"/);
});

test('status/type filters apply through the server and Clear filters resets the directory', async () => {
  const h = harness({ hash: '#sponsorships' }); await flush();
  h.ids.get('spStatusFilter').value = 'paused'; h.ids.get('spStatusFilter').listeners.change(); await flush();
  h.ids.get('spTypeFilter').value = 'group'; h.ids.get('spTypeFilter').listeners.change(); await flush();
  const params = new URLSearchParams(h.requests.at(-1).split('?')[1]); assert.equal(params.get('status'), 'paused'); assert.equal(params.get('sponsorship_type'), 'group'); assert.equal(params.get('page'), '1');
  assert.equal(h.ids.get('spPageInfo').textContent, 'Showing 1–1 of 1 sponsorships · Page 1 of 1');
  h.ids.get('spReset').listeners.click(); await flush(); assert.equal(h.ids.get('spTypeFilter').value, ''); assert.equal(h.ids.get('spStatusFilter').value, '');
  assert.equal(h.document.activeElement, h.ids.get('spSearch'));
  assert.match(h.ids.get('spResults').innerHTML, /role="region"[^>]*tabindex="0"/);
});

test('negative operational totals and malformed pagination show an error without fictional metrics', async () => {
  const bad = harness({ page: '/dashboard.html', get: url => url.endsWith('/summary') ? { ok: true, data: { ...summary, group_memberships: -1 } } : undefined }); await flush();
  assert.match(bad.ids.get('spSummary').innerHTML, /unexpected operational counts/); assert.doesNotMatch(bad.ids.get('spSummary').innerHTML, /class="num">-1/);
  const page = harness({ get: url => url.startsWith('/api/v1/sponsors?') ? { ok: true, data: [], meta: { per_page: 0, total: 10 } } : undefined }); await flush();
  assert.match(page.ids.get('spResults').innerHTML, /unexpected directory response/); assert.equal(page.ids.get('spNext').disabled, true);
});

test('planned-date and notes edit submits only the existing mutable sponsorship fields', async () => {
  const h = harness({ hash: '#sponsorships' }); await flush(); h.ids.get('spResults').querySelector('[data-edit-item]').listeners.click(); await flush();
  assert.equal(h.requests.at(-1), '/api/v1/sponsorships/9'); const form = h.ids.get('spForm');
  assert.equal(form.elements.end_date.min, '2026-01-01'); assert.equal(form.elements.sponsorship_type, undefined); assert.equal(form.elements.student_ids, undefined);
  form.elements.end_date.value = '2026-12-31'; form.elements.notes.value = ' Reviewed notes '; await form.listeners.submit({ preventDefault() {} }); await flush();
  assert.deepEqual({ ...h.writes[0].body }, { status: 'active', end_date: '2026-12-31', notes: 'Reviewed notes' });
  assert.equal(h.modals[0].footer.includes('form="spForm"'), true);
});

test('sponsorship edit refuses a freshly ended record rather than exposing a reopen action', async () => {
  const h = harness({ hash: '#sponsorships', get: url => url === '/api/v1/sponsorships/9' ? { ok: true, data: { ...item, status: 'ended' } } : undefined }); await flush();
  h.ids.get('spResults').querySelector('[data-edit-item]').listeners.click(); await flush(); assert.equal(h.modals.length, 0); assert.equal(h.writes.length, 0);
});

test('creation confirmation reviews chosen sponsor/programme and cancellation preserves the draft', async () => {
  const h = harness({ hash: '#sponsorships' }); await flush(); h.ids.get('spNew').listeners.click();
  const form = h.ids.get('spForm'); form.elements.sponsorship_type.value = 'school_wide'; form.elements.sponsorship_type.listeners.change();
  h.ids.get('sponsorLookup').value = 'Sponsor'; h.ids.get('sponsorFind').listeners.click(); await flush(); h.ids.get('sponsorMatches').querySelector('[data-pick]').listeners.click();
  form.elements.program_name.value = 'School programme'; form.elements.start_date.value = '2026-10-13';
  let confirmation; h.app.confirmAction = async (...args) => { confirmation = args; return false; };
  await form.listeners.submit({ preventDefault() {} });
  assert.match(confirmation[1], /<Sponsor>|School programme|2026-10-13/); assert.equal(h.writes.length, 0); assert.equal(h.modals[0].closed, false); assert.equal(h.modals[0].busy, false);
  assert.equal(form.elements.program_name.value, 'School programme'); assert.equal(h.document.activeElement, h.modals[0].overlay.querySelector('[data-sp-save]'));
});

test('a learner lookup in flight cannot repopulate the selection after sponsorship type changes', async () => {
  let release;
  const h = harness({ hash: '#sponsorships', get: url => url.startsWith('/api/v1/sponsorships/learners?') ? new Promise(resolve => { release = resolve; }) : undefined }); await flush(); h.ids.get('spNew').listeners.click();
  h.ids.get('learnerLookup').value = 'Learner'; h.ids.get('learnerFind').listeners.click(); await flush();
  const form = h.ids.get('spForm'); form.elements.sponsorship_type.value = 'school_wide'; form.elements.sponsorship_type.listeners.change();
  release({ ok: true, data: [learner], meta: { per_page: 10, total: 1 } }); await flush();
  assert.equal(h.ids.get('learnerMatches').innerHTML, ''); assert.equal(h.ids.get('learnerSelected').innerHTML, ''); assert.equal(h.ids.get('learnerMore').hidden, true);
});

test('a status change cannot issue duplicate patches while confirmation or mutation is pending', async () => {
  const h = harness({ hash: '#sponsorships' }); await flush(); const button = h.ids.get('spResults').querySelector('[data-status]');
  let release; h.app.patch = () => new Promise(resolve => { h.writes.push('patch'); release = resolve; });
  const first = button.listeners.click(); await flush(); await button.listeners.click(); assert.equal(h.writes.length, 1);
  release({ ok: true }); await first;
});

test('ending cancellation preserves the required reason/date and sends no status update', async () => {
  const h = harness({ hash: '#sponsorships' }); await flush(); h.ids.get('spResults').querySelector('[data-end]').listeners.click();
  const form = h.ids.get('spForm'); form.elements.end_date.value = '2026-10-13'; form.elements.notes.value = 'Draft reason';
  h.app.confirmAction = async () => false; await form.listeners.submit({ preventDefault() {} });
  assert.equal(h.writes.length, 0); assert.equal(form.elements.notes.value, 'Draft reason'); assert.equal(h.modals[0].closed, false);
});
