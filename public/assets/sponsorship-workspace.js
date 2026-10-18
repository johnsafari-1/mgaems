/* Existing Sponsorship management and the Coordinator's focused dashboard. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user) return;
  if (MGAEMS.landingPage(user) !== '/dashboard.html') return;
  const page = window.location.pathname;
  const coordinator = user.role === 'sponsor_coordinator';
  const dashboard = page === '/dashboard.html';
  if (dashboard && !coordinator) return;
  if (!dashboard && page !== '/sponsorship.html') return;
  const allowed = ['system_admin', 'head_teacher', 'deputy_head_teacher', 'sponsor_coordinator'].includes(user.role);
  renderAppShell(page);
  const main = document.getElementById('appMain'), esc = MGAEMS.escapeHTML;
  const sessionCurrent = MGAEMS.sessionGuard();
  const current = () => sessionCurrent() && window.location.pathname === page;
  const validRow = row => row && typeof row === 'object' && !Array.isArray(row) && Number.isSafeInteger(Number(row.id)) && Number(row.id) > 0;
  const validRows = rows => Array.isArray(rows) && rows.every(validRow);
  const validMeta = meta => Number.isSafeInteger(meta?.total) && meta.total >= 0 && Number.isSafeInteger(meta?.per_page) && meta.per_page >= 1;
  const label = value => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const day = value => {
    if (value == null || value === '') return null;
    const result = MGAEMS.schoolDate(value), parsed = new Date(result + 'T00:00:00Z');
    return result && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result ? result : null;
  };
  const date = value => {
    const valueDay = day(value);
    if (!valueDay || !Number.isFinite(new Date(valueDay + 'T00:00:00Z').getTime())) return 'Not recorded';
    return esc(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(valueDay + 'T00:00:00Z')));
  };
  const badge = value => `<span class="badge badge-${value === 'active' ? 'green' : value === 'paused' ? 'amber' : 'gray'}">${esc(label(value))}</span>`;
  const sponsorTypes = ['individual', 'church', 'ministry', 'ngo', 'foundation', 'general'];
  const types = ['individual', 'group', 'school_wide'], statuses = ['active', 'paused', 'ended'];
  const canWrite = ['system_admin', 'sponsor_coordinator'].includes(user.role);
  const state = { tab: 'sponsors', page: 1, pages: 1, sequence: 0, dialogSequence: 0, rows: [], changing: new Set() };
  let summarySequence = 0;
  const options = values => values.map(value => `<option value="${value}">${esc(label(value))}</option>`).join('');
  const learnerName = s => `${esc(s.first_name)} ${esc(s.last_name)} — ${esc(s.admission_no)}${s.school_class ? ' · '+esc(s.school_class.name) : ''}`;
  const target = i => i.sponsorship_type === 'individual' ? i.student ? learnerName(i.student) : 'No linked learner' : i.sponsorship_type === 'group' ? `${Array.isArray(i.students) ? i.students.length : 0} explicit group members` : esc(i.program_name || 'Programme not recorded');
  const validItem = item => validRow(item) && types.includes(item.sponsorship_type) && statuses.includes(item.status)
    && (item.sponsorship_type !== 'group' || validRows(item.students)) && (item.sponsorship_type !== 'individual' || item.student == null || validRow(item.student));
  function failure(element, response, retry) {
    element.setAttribute('aria-busy', 'false');
    element.innerHTML = response.status === 403 ? MGAEMS.emptyStateHTML('Access restricted', 'An active authorized account and Staff relationship are required.', 'lock-keyhole')
      : MGAEMS.errorHTML(response.error || 'Records are unavailable.') + (response.status === 401 ? '' : '<button type="button" class="btn btn-secondary" data-retry>Try again</button>');
    element.querySelector('[data-retry]')?.addEventListener('click', retry);
    MGAEMS.initIcons();
  }
  if (!allowed) { failure(main, { status: 403 }); return; }
  function summaryPanel() { return '<section class="section" aria-labelledby="spSummaryHeading"><div class="section-header"><h2 id="spSummaryHeading">Sponsorship operations</h2><button type="button" class="btn btn-secondary btn-sm" id="spRefresh">Refresh summary</button></div><div id="spSummary" aria-live="polite"></div></section>'; }
  async function loadSummary() {
    if (!current()) return;
    const epoch = ++summarySequence;
    const element = document.getElementById('spSummary');
    element.setAttribute('aria-busy', 'true'); element.innerHTML = MGAEMS.loadingHTML('Loading sponsorship summary…');
    const response = await MGAEMS.get('/api/v1/sponsorships/summary');
    if (!current() || epoch !== summarySequence) return;
    if (!response.ok) { failure(element, response, loadSummary); return; }
    const data = response.data;
    if (!data || !data.by_type || !data.by_status || !Number.isFinite(data.sponsors)) { failure(element, {}, loadSummary); return; }
    const metrics = [['Sponsors', data.sponsors], ['Sponsorships', data.sponsorships], ...statuses.map(v => [label(v)+' sponsorships', data.by_status[v]]),
      ...types.map(v => [label(v)+' sponsorships', data.by_type[v]]), ['Individual assignments (all statuses)', data.individual_assignments], ['Group memberships (all statuses)', data.group_memberships]];
    if (metrics.some(([,v]) => !Number.isSafeInteger(v) || v < 0)) { failure(element, { error: 'The server returned unexpected operational counts.' }, loadSummary); return; }
    const metricCards = rows => '<div class="stat-cards">'+rows.map(([name,value]) => `<div class="card stat-card"><div class="label">${esc(name)}</div><div class="num">${esc(value)}</div></div>`).join('')+'</div>';
    const summaryList = rows => '<dl class="dashboard-summary-list">'+rows.map(([name,value]) => `<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join('')+'</dl>';
    const breakdown = '<div class="dashboard-summary-grid"><section class="card"><h3>Sponsorship status</h3>'+summaryList(statuses.map(value => [label(value), data.by_status[value]]))+'</section><section class="card"><h3>Programme types</h3>'+summaryList(types.map(value => [label(value), data.by_type[value]]))+'</section><section class="card"><h3>Recorded learner relationships</h3>'+summaryList(metrics.slice(-2))+'</section></div>';
    element.innerHTML = metricCards(metrics.slice(0, 3)) + (dashboard ? breakdown : '<details class="workspace-summary-details"><summary>View status, programme and relationship counts</summary>'+breakdown+'</details>')
      + '<p class="text-muted">Counts describe stored records. Group memberships count relationships, not unique learners. School-wide sponsorships do not enumerate learners.</p>';
    element.setAttribute('aria-busy', 'false');
  }
  if (dashboard) {
    main.innerHTML = '<div class="workspace-heading"><div><h1>Sponsor Coordinator Workspace</h1><p>Review sponsorship activity and manage learner support programmes.</p></div></div>'+summaryPanel()+
      '<div class="workspace-grid"><section class="card workspace-duty"><h2>Sponsors & programmes</h2><p>Find sponsor contacts, review linked support and manage individual, group or school-wide sponsorship records.</p><div class="workspace-links"><a class="btn btn-primary" href="/sponsorship.html#sponsors">Sponsor directory</a><a class="btn btn-secondary" href="/sponsorship.html#sponsorships">Sponsorship directory</a></div></section><section class="card workspace-duty"><h2>Communication & visits</h2><p>Read and publish authorized announcements, review your message history and view recorded visits.</p><div class="workspace-links"><a class="btn btn-secondary" href="/communication.html">Communication</a><a class="btn btn-secondary" href="/visitors.html">Visitor history</a></div><p class="text-muted">Visitor access is read-only. New direct messages require an approved recipient policy.</p></section></div>';
    document.getElementById('spRefresh').addEventListener('click', loadSummary); loadSummary(); return;
  }
  main.setAttribute('class', 'app-main sponsorship-workspace');
  main.innerHTML = `<div class="workspace-heading"><div><span class="eyebrow">Learner support</span><h1>Sponsorship Management</h1><p>Find sponsor relationships and manage learner support programmes.</p></div>${canWrite ? '' : '<span class="badge badge-gray">Read only</span>'}</div>${canWrite ? '<div class="sponsorship-workflow-note"><strong>Link a learner to a sponsor</strong><p>Choose a sponsor, select Individual or Group support, then search and explicitly choose the learner(s). School-wide programmes record support without a learner roster.</p></div>' : ''}${summaryPanel()}
    <div class="tabs workspace-tabs" role="tablist" aria-label="Sponsorship sections"><button type="button" class="tab active" role="tab" aria-selected="true" aria-controls="spView" tabindex="0" id="spSponsors">Sponsors</button><button type="button" class="tab" role="tab" aria-selected="false" aria-controls="spView" tabindex="-1" id="spItems">Sponsorships</button></div><section id="spView" role="tabpanel" tabindex="0" aria-labelledby="spSponsors"></section>`;
  document.getElementById('spRefresh').addEventListener('click', loadSummary);
  document.getElementById('spSponsors').addEventListener('click', () => switchTab('sponsors'));
  document.getElementById('spItems').addEventListener('click', () => switchTab('sponsorships'));
  const tabs = ['spSponsors', 'spItems'].map(id => document.getElementById(id));
  tabs.forEach((button, index) => button.addEventListener('keydown', event => {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : ['ArrowLeft', 'ArrowRight'].includes(event.key) ? 1 - index : null;
    if (next !== null) { event.preventDefault(); switchTab(next === 0 ? 'sponsors' : 'sponsorships'); tabs[next].focus(); }
  }));
  function switchTab(tab, sponsor = '') {
    if (!current()) return;
    state.tab = tab; state.page = 1; state.dialogSequence++;
    for (const [id, name] of [['spSponsors','sponsors'], ['spItems','sponsorships']]) {
      const button = document.getElementById(id); button.classList.toggle('active', tab === name); button.setAttribute('aria-selected', String(tab === name)); button.tabIndex = tab === name ? 0 : -1;
    }
    const panel = document.getElementById('spView'); panel.setAttribute('aria-labelledby', tab === 'sponsors' ? 'spSponsors' : 'spItems');
    window.history?.replaceState(null, '', '#' + tab);
    panel.innerHTML = `<div class="section-header"><div><h2>${tab === 'sponsors' ? 'Sponsor directory' : 'Sponsorship directory'}</h2><p class="text-muted">${tab === 'sponsors' ? 'Business contacts and their recorded sponsorships.' : 'Individual assignments, explicit groups and school-wide programmes.'}</p></div>${canWrite ? '<button type="button" class="btn btn-primary" id="spNew">New '+(tab === 'sponsors' ? 'Sponsor' : 'Sponsorship')+'</button>' : ''}</div>
      ${sponsor ? '<div class="workspace-note">Showing linked sponsorships for the selected sponsor. <button type="button" class="btn btn-secondary btn-sm" id="spClearSponsor">Show all sponsors</button></div>' : ''}<div class="card sponsorship-directory"><form id="spFilters" class="workspace-filter-grid" aria-label="Filter directory">
      <div class="field"><label for="spSearch">Search ${tab === 'sponsors' ? 'sponsor name' : 'sponsor, learner or programme'}</label><input type="search" id="spSearch" maxlength="150" placeholder="${tab === 'sponsors' ? 'Sponsor name' : 'Name, admission number or programme'}"></div>
      <div class="field"><label for="spTypeFilter">Type</label><select id="spTypeFilter"><option value="">All types</option>${options(tab === 'sponsors' ? sponsorTypes : types)}</select></div>
      ${tab === 'sponsorships' ? `<div class="field"><label for="spStatusFilter">Status</label><select id="spStatusFilter"><option value="">All statuses</option>${options(statuses)}</select></div><input type="hidden" id="spSponsorFilter" value="${esc(sponsor)}">` : ''}
      <div class="form-actions"><button type="submit" class="btn btn-secondary">Search</button><button type="button" class="btn btn-secondary" id="spReset">Clear filters</button></div></form>
      <div id="spResults" aria-busy="true"></div><div class="pagination"><span id="spPageInfo" role="status" aria-live="polite"></span><button type="button" class="btn btn-secondary btn-sm" id="spPrev">Previous</button><button type="button" class="btn btn-secondary btn-sm" id="spNext">Next</button></div></div>`;
    document.getElementById('spFilters').addEventListener('submit', event => { event.preventDefault(); state.page = 1; load(); });
    ['spTypeFilter', 'spStatusFilter'].forEach(id => document.getElementById(id)?.addEventListener('change', () => { state.page = 1; load(); }));
    document.getElementById('spReset').addEventListener('click', () => { switchTab(tab); document.getElementById('spSearch').focus(); });
    document.getElementById('spPrev').addEventListener('click', () => { if (state.page > 1) { state.page--; load(); } });
    document.getElementById('spNext').addEventListener('click', () => { if (state.page < state.pages) { state.page++; load(); } });
    document.getElementById('spClearSponsor')?.addEventListener('click', () => switchTab('sponsorships'));
    document.getElementById('spNew')?.addEventListener('click', () => tab === 'sponsors' ? sponsorForm() : sponsorshipForm());
    load();
  }
  async function load() {
    if (!current()) return;
    const epoch = ++state.sequence, tab = state.tab, element = document.getElementById('spResults');
    const q = new URLSearchParams({ page: state.page, per_page: 15 });
    const search = document.getElementById('spSearch').value.trim(), type = document.getElementById('spTypeFilter').value;
    if (search) q.set('search', search); if (type) q.set(tab === 'sponsors' ? 'sponsor_type' : 'sponsorship_type', type);
    const status = document.getElementById('spStatusFilter')?.value, sponsor = document.getElementById('spSponsorFilter')?.value;
    if (status) q.set('status', status); if (sponsor) q.set('sponsor_id', sponsor);
    element.setAttribute('aria-busy', 'true'); element.innerHTML = MGAEMS.loadingHTML();
    document.getElementById('spPrev').disabled = document.getElementById('spNext').disabled = true; document.getElementById('spPageInfo').textContent = '';
    const response = await MGAEMS.get(`/api/v1/${tab}?${q}`);
    if (!current() || epoch !== state.sequence) return;
    if (!response.ok || !validRows(response.data) || !validMeta(response.meta) || tab === 'sponsorships' && !response.data.every(validItem)) { state.rows = []; failure(element, response.ok ? { error: 'The server returned an unexpected directory response.' } : response, load); return; }
    state.rows = response.data; const meta = response.meta;
    state.pages = Math.max(1, Math.ceil(meta.total / meta.per_page));
    if (state.page > state.pages) { state.page = state.pages; load(); return; }
    document.getElementById('spPrev').disabled = state.page <= 1;
    document.getElementById('spNext').disabled = state.page * meta.per_page >= meta.total;
    const first = state.rows.length ? (state.page - 1) * meta.per_page + 1 : 0;
    document.getElementById('spPageInfo').textContent = `Showing ${first}–${first ? first + state.rows.length - 1 : 0} of ${meta.total} ${tab} · Page ${state.page} of ${state.pages}`;
    element.setAttribute('aria-busy', 'false');
    if (!state.rows.length) { element.innerHTML = MGAEMS.emptyStateHTML('No '+tab+' found', 'Change the search filters or page.', 'heart-handshake'); return; }
    element.innerHTML = `<div class="workspace-table-wrap" role="region" aria-label="${tab === 'sponsors' ? 'Sponsor' : 'Sponsorship'} directory table" tabindex="0"><table class="workspace-table"><caption class="sr-only">${tab === 'sponsors' ? 'Sponsor directory' : 'Operational sponsorship report'}</caption><thead><tr>${tab === 'sponsors' ? '<th scope="col">Sponsor</th><th scope="col">Type</th><th scope="col">Sponsorships</th>' : '<th scope="col">Sponsor</th><th scope="col">Type / target</th><th scope="col">Dates</th><th scope="col">Status</th>'}<th scope="col">Actions</th></tr></thead><tbody>${state.rows.map(item => directoryRow(item, tab)).join('')}</tbody></table></div>`;
    element.querySelectorAll('[data-assign]').forEach(button => button.addEventListener('click', () => sponsorshipForm(state.rows.find(row => Number(row.id) === Number(button.dataset.assign)))));
    element.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => view(Number(button.dataset.view))));
    element.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => sponsorForm(Number(button.dataset.edit))));
    element.querySelectorAll('[data-edit-item]').forEach(button => button.addEventListener('click', () => editSponsorship(Number(button.dataset.editItem))));
    element.querySelectorAll('[data-status]').forEach(button => button.addEventListener('click', () => changeStatus(Number(button.dataset.status))));
    element.querySelectorAll('[data-end]').forEach(button => button.addEventListener('click', () => endForm(Number(button.dataset.end))));
  }
  function directoryRow(item, tab) {
    const sponsor = tab === 'sponsors';
    const id = esc(item.id), name = esc(item.name || item.sponsor?.name || 'Sponsor unavailable');
    const cells = sponsor
      ? `<td data-label="Sponsor"><span class="workspace-name">${name}</span></td><td data-label="Sponsor type">${esc(label(item.sponsor_type))}</td><td data-label="Sponsorships">${esc(item.sponsorships_count)}</td>`
      : `<td data-label="Sponsor"><span class="workspace-name">${name}</span></td><td data-label="Type / target"><span class="badge badge-navy">${esc(label(item.sponsorship_type))}</span><div class="workspace-target">${target(item)}</div></td><td data-label="Dates"><span class="text-meta">Start: ${date(item.start_date)}</span><span class="text-meta">End: ${item.end_date ? date(item.end_date) : 'Not set'}</span></td><td data-label="Status">${badge(item.status)}</td>`;
    const manage = !canWrite ? '' : sponsor
      ? `<button type="button" class="btn btn-secondary btn-sm" data-edit="${id}">Edit</button><button type="button" class="btn btn-primary btn-sm" data-assign="${id}" aria-label="Create sponsorship for ${name}">Link learners</button>`
      : item.status === 'ended' ? '' : `<button type="button" class="btn btn-secondary btn-sm" data-edit-item="${id}">Edit details</button><button type="button" class="btn btn-secondary btn-sm" data-status="${id}">${item.status === 'active' ? 'Pause' : 'Resume'}</button><button type="button" class="btn btn-danger btn-sm" data-end="${id}">End</button>`;
    return `<tr>${cells}<td data-label="Actions"><div class="actions"><button type="button" class="btn btn-secondary btn-sm" data-view="${id}" aria-label="View ${name}">View</button>${manage}</div></td></tr>`;
  }
  const details = pairs => '<dl class="detail-grid">'+pairs.map(([name,value]) => `<div><dt>${esc(name)}</dt><dd>${value}</dd></div>`).join('')+'</dl>';
  async function view(id) {
    if (!current()) return;
    state.dialogSequence++;
    const tab = state.tab, dialog = MGAEMS.openModal({ title: tab === 'sponsors' ? 'Sponsor details' : 'Sponsorship details', body: MGAEMS.loadingHTML() });
    dialog.overlay.className = 'modal-overlay workspace-dialog sponsorship-dialog';
    const response = await MGAEMS.get(`/api/v1/${tab}/${id}`); if (!current() || dialog.closed) return;
    if (!response.ok) { failure(dialog.body, response, () => { dialog.close(); view(id); }); return; }
    const item = response.data;
    if (!(tab === 'sponsors' ? validRow(item) : validItem(item)) || Number(item.id) !== id) { failure(dialog.body, { error: 'The server returned unexpected record details.' }, () => { dialog.close(); view(id); }); return; }
    if (tab === 'sponsors') {
      dialog.body.innerHTML = details([['Name', esc(item.name)], ['Type', esc(label(item.sponsor_type))], ['Contact person',esc(item.contact_person || 'Not recorded')], ['Phone',esc(item.phone || 'Not recorded')], ['Email',esc(item.email || 'Not recorded')], ['Address',esc(item.address || 'Not recorded')], ['Sponsorships',esc(item.sponsorships_count)]])+`<p class="record-body">${esc(item.notes || '')}</p><div class="sponsorship-detail-actions"><button type="button" class="btn btn-secondary" data-linked>View linked sponsorships</button>${canWrite ? '<button type="button" class="btn btn-primary" data-create-linked>Create sponsorship for this sponsor</button>' : ''}</div>`;
      dialog.body.querySelector('[data-linked]').addEventListener('click', () => { dialog.close(); switchTab('sponsorships', id); });
      dialog.body.querySelector('[data-create-linked]')?.addEventListener('click', () => { dialog.close(); sponsorshipForm(item); });
    } else {
      dialog.body.innerHTML = details([['Sponsor',esc(item.sponsor?.name)], ['Type',esc(label(item.sponsorship_type))], ['Target',target(item)], ['Status',badge(item.status)], ['Start',date(item.start_date)], ['End',date(item.end_date)]])+`<p class="record-body">${esc(item.notes || '')}</p>`+
        (item.sponsorship_type === 'group' ? '<h3>Explicit group members</h3><ul class="family-records">'+item.students.map(s => `<li class="assignment-item">${learnerName(s)} <button type="button" class="btn btn-secondary btn-sm" data-scoped-learner="${esc(s.id)}">View learner information</button></li>`).join('')+'</ul><p class="text-muted">Group members are fixed for this sponsorship and remain as recorded when it was created.</p>' : item.sponsorship_type === 'school_wide' ? '<p>Programme-level support. No learner list is granted by this sponsorship.</p>' : item.student ? `<button type="button" class="btn btn-secondary" data-scoped-learner="${esc(item.student.id)}">View linked learner information</button>` : '');
      dialog.body.querySelectorAll('[data-scoped-learner]').forEach(button => button.addEventListener('click', () => learnerDetails(item, Number(button.dataset.scopedLearner), button)));
    }
    MGAEMS.initIcons();
  }
  async function learnerDetails(item, learnerId, trigger) {
    const linked = item.sponsorship_type === 'individual' ? item.student && Number(item.student.id) === learnerId : item.sponsorship_type === 'group' && item.students.some(student => Number(student.id) === learnerId);
    if (!linked || !current()) return;
    const dialog = MGAEMS.openModal({ title: 'Linked learner information', trigger, body: MGAEMS.loadingHTML('Loading authorized learner information…'), footer: '<button type="button" class="btn btn-secondary" data-dialog-close>Back to sponsorship</button>' });
    dialog.overlay.className = 'modal-overlay workspace-dialog sponsorship-dialog';
    async function fetchLearner() {
      if (!current() || dialog.closed) return;
      const response = await MGAEMS.get(`/api/v1/sponsorships/${encodeURIComponent(item.id)}/learners/${encodeURIComponent(learnerId)}`);
      if (!current() || dialog.closed) return;
      if (!response.ok || !validRow(response.data) || Number(response.data.id) !== learnerId) { failure(dialog.body, response.ok ? { error: 'The learner identity could not be verified.' } : response, fetchLearner); return; }
      const learner = response.data;
      dialog.body.innerHTML = '<p class="workspace-note">Information is limited to the learner explicitly linked to this sponsorship.</p>'+details([['Learner', learnerName(learner)], ['Admission number', esc(learner.admission_no || 'Not recorded')], ['Class', esc(learner.school_class?.name || 'Not assigned')], ['Enrollment', badge(learner.status)]])+'<p class="text-muted">Family contacts and confidential Health information are not part of this sponsorship view.</p>';
    }
    await fetchLearner();
  }
  const field = (name, title, value = '', type = 'text', required = false) => `<div class="field"><label for="spf_${name}">${title}${required ? ' *' : ''}</label>${type === 'textarea' ? `<textarea id="spf_${name}" name="${name}" ${required ? 'required' : ''}>${esc(value || '')}</textarea>` : `<input id="spf_${name}" name="${name}" type="${type}" value="${esc(value || '')}" ${required ? 'required' : ''}>`}<div class="field-error" data-error="${name}"></div></div>`;
  function validateForm(form) {
    const fields = {}, limits = { name: 150, contact_person: 150, phone: 20, email: 150, program_name: 150 };
    for (const control of form.elements) {
      if (!control.name || control.disabled) continue;
      const value = control.value.trim();
      if (control.required && !value) fields[control.name] = ['Complete this required field.'];
      if (limits[control.name] && value.length > limits[control.name]) fields[control.name] = [`Use no more than ${limits[control.name]} characters.`];
      if (control.getAttribute('type') === 'date' && value) {
        const parsed = new Date(value + 'T00:00:00Z');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fields[control.name] = ['Enter a valid calendar date.'];
      }
    }
    const start = form.elements.start_date?.value || form.elements.end_date?.min;
    if (start && form.elements.end_date?.value && form.elements.end_date.value < start) fields.end_date = ['The end date must be on or after the start date.'];
    if (form.elements.sponsor_type && !sponsorTypes.includes(form.elements.sponsor_type.value)) fields.sponsor_type = ['Choose an available sponsor type.'];
    if (form.elements.sponsorship_type && !types.includes(form.elements.sponsorship_type.value)) fields.sponsorship_type = ['Choose an available sponsorship type.'];
    return fields;
  }
  function formDialog(title, body, save, saveLabel = 'Save changes') {
    state.dialogSequence++;
    const dialog = MGAEMS.openModal({ title, body: '<form id="spForm"><div id="spFormAlert" data-form-error role="alert"></div><p class="text-muted">Fields marked * are required.</p>'+body+'</form>', footer: `<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="submit" form="spForm" class="btn btn-primary" data-sp-save>${esc(saveLabel)}</button>` });
    dialog.overlay.className = 'modal-overlay workspace-dialog sponsorship-dialog';
    const form = dialog.body.querySelector('#spForm');
    const submit = dialog.overlay.querySelector('[data-sp-save]');
    let saving = false;
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving || dialog.closed || !current()) return;
      const fields = validateForm(form);
      if (Object.keys(fields).length) { MGAEMS.showFormErrors(form, { error: 'Review the highlighted details.', fields }); return; }
      if (!form.reportValidity()) return;
      saving = true;
      form.dataset.saving = 'true';
      const controls = [...form.elements].filter(control => ['input', 'select', 'textarea'].includes(control.tagName?.toLowerCase() || control.tag)).map(control => [control, control.disabled]);
      controls.forEach(([control]) => { control.disabled = true; });
      dialog.setBusy(true); submit.textContent = 'Saving…';
      try {
        const response = await save(form);
        if (!current() || dialog.closed) { dialog.setBusy(false); dialog.close(); return; }
        if (response.cancelled) { dialog.setBusy(false); submit.focus(); return; }
        if (!response.ok) {
          MGAEMS.showFormErrors(form, { ...response, error: response.status === 409 ? `${response.error || 'An existing assignment conflicts with this record.'} Review the existing sponsor or learner assignment before retrying.` : response.error });
          if (response.fields?.student_id || Object.keys(response.fields || {}).some(name => name.startsWith('student_ids'))) document.getElementById('learnerLookup')?.setAttribute('aria-invalid', 'true');
          if (response.fields?.sponsor_id) document.getElementById('sponsorLookup')?.setAttribute('aria-invalid', 'true');
          return;
        }
        dialog.setBusy(false); dialog.close(); MGAEMS.toast('Record saved.', 'success'); load(); loadSummary();
      } finally { saving = false; form.dataset.saving = 'false'; controls.forEach(([control, disabled]) => { control.disabled = disabled; }); dialog.setBusy(false); submit.textContent = saveLabel; }
    });
    return { dialog, form };
  }
  async function sponsorForm(id) {
    if (!canWrite || !current()) return;
    const epoch = ++state.dialogSequence;
    const response = id ? await MGAEMS.get(`/api/v1/sponsors/${id}`) : { ok: true, data: {} };
    if (!current() || epoch !== state.dialogSequence) return;
    if (!response.ok) { MGAEMS.toast(response.error, 'error'); return; }
    const s = response.data;
    if (id && (!validRow(s) || Number(s.id) !== id)) { MGAEMS.toast('The sponsor identity could not be verified.', 'error'); return; }
    const { form } = formDialog(id ? 'Edit Sponsor' : 'New Sponsor', `<fieldset><legend>Sponsor identity</legend><div class="form-grid"><div class="field"><label for="spf_sponsor_type">Sponsor type *</label><select id="spf_sponsor_type" name="sponsor_type" required>${options(sponsorTypes)}</select></div>`+
      field('name','Name',s.name,'text',true)+'</div></fieldset><fieldset><legend>Contact details</legend><div class="form-grid">'+field('contact_person','Contact person',s.contact_person)+field('phone','Phone',s.phone,'tel')+field('email','Email',s.email,'email')+field('address','Address',s.address,'textarea')+'</div></fieldset><fieldset><legend>Operational notes</legend>'+field('notes','Notes',s.notes,'textarea')+'</fieldset><p class="text-muted">This business record does not create or change a Sponsor Portal login account.</p>',
      async form => {
        const body = {}; for (const name of ['sponsor_type','name','contact_person','phone','email','address','notes']) body[name] = form.elements[name].value.trim() || null;
        return id ? MGAEMS.patch(`/api/v1/sponsors/${id}`, body) : MGAEMS.post('/api/v1/sponsors', body);
      }, id ? 'Save sponsor' : 'Create sponsor');
    if (s.sponsor_type) form.elements.sponsor_type.value = s.sponsor_type;
    form.elements.name.maxLength = 150; form.elements.contact_person.maxLength = 150; form.elements.phone.maxLength = 20; form.elements.email.maxLength = 150;
  }
  function picker(kind) {
    return `<fieldset class="section sponsorship-picker" id="${kind}Picker"><legend>${kind === 'sponsor' ? '1. Sponsor' : '2. Eligible active learners'}</legend>
      <div class="sponsorship-lookup"><div class="field"><label for="${kind}Lookup">Search ${kind === 'sponsor' ? 'sponsor name' : 'name or admission number'}</label><input id="${kind}Lookup" type="search" maxlength="150" aria-describedby="${kind}LookupHint"><p class="text-muted" id="${kind}LookupHint">Enter at least two characters. Search results are limited to the permitted lookup.</p></div><button type="button" class="btn btn-secondary" id="${kind}Find">Find</button></div>
      <div id="${kind}Matches" class="sponsorship-matches" aria-live="polite"></div><button type="button" class="btn btn-secondary btn-sm" id="${kind}More" hidden>More results</button>
      ${kind === 'learner' ? '<p id="learnerSelectionCount" class="sponsorship-selection-count" role="status"></p>' : ''}<div id="${kind}Selected" class="sponsorship-matches" role="status"></div></fieldset>`;
  }
  function sponsorshipForm(preselectedSponsor = null) {
    if (!canWrite || !current()) return;
    let selectedSponsor = validRow(preselectedSponsor) ? preselectedSponsor : null, allocationEpoch = 0; const selectedLearners = new Map();
    const { dialog, form } = formDialog('New Sponsorship', '<p class="sponsorship-dialog-intro">1. Choose the sponsor. 2. Choose the support type and learner(s). 3. Review dates and confirm the assignment.</p>'+picker('sponsor')+`<fieldset><legend>2. Support type</legend><div class="field"><label for="spf_sponsorship_type">Sponsorship type *</label><select id="spf_sponsorship_type" name="sponsorship_type" required aria-describedby="spTypeHint">${options(types)}</select></div><p class="workspace-note" id="spTypeHint" role="status"></p>`+
      field('program_name','Programme name *','')+'</fieldset>'+picker('learner')+'<fieldset><legend>3. Dates & notes</legend><div class="form-grid">'+field('start_date','Start date','','date',true)+field('end_date','Planned end date','','date')+'</div>'+field('notes','Notes','','textarea')+'</fieldset>', async form => {
        const type = form.elements.sponsorship_type.value;
        if (!selectedSponsor || (type !== 'school_wide' && !selectedLearners.size)) return { ok: false, error: 'Select a sponsor and the required learner(s).', fields: { ...(!selectedSponsor ? { sponsor_id: ['Choose the sponsor receiving this relationship.'] } : {}), ...(type !== 'school_wide' && !selectedLearners.size ? { student_id: ['Search and select the learner(s) explicitly.'] } : {}) } };
        if (type === 'individual' && (selectedLearners.size !== 1 || [...selectedLearners.values()].some(learner => learner.has_active_individual_sponsorship))) return { ok: false, error: 'Choose one learner without an active individual sponsorship.', fields: { student_id: ['Review the existing learner assignment.'] } };
        const body = { sponsor_id: selectedSponsor.id, sponsorship_type: type, start_date: form.elements.start_date.value, end_date: form.elements.end_date.value || null, notes: form.elements.notes.value.trim() || null };
        if (type === 'individual') body.student_id = [...selectedLearners.keys()][0];
        if (type === 'group') body.student_ids = [...selectedLearners.keys()];
        if (type === 'school_wide') body.program_name = form.elements.program_name.value.trim();
        const description = type === 'school_wide' ? body.program_name : type === 'group' ? `${selectedLearners.size} explicitly selected learners` : [...selectedLearners.values()].map(s => `${s.first_name} ${s.last_name} · ${s.admission_no}`).join('');
        if (!await MGAEMS.confirmAction('Create sponsorship', `Create an active ${label(type).toLowerCase()} sponsorship from ${selectedSponsor.name} for ${description}, starting ${body.start_date}?`, 'Create sponsorship')) return { cancelled: true };
        if (!current() || dialog.closed) return { cancelled: true };
        return MGAEMS.post('/api/v1/sponsorships', body);
      }, 'Create sponsorship');
    form.elements.program_name.maxLength = 150;
    form.elements.start_date.addEventListener('change', () => { form.elements.end_date.min = form.elements.start_date.value; });
    const selected = () => {
      document.getElementById('sponsorSelected').innerHTML = selectedSponsor ? `<strong>Selected sponsor: ${esc(selectedSponsor.name)}</strong><button type="button" class="btn btn-secondary btn-sm" data-clear-sponsor>Change sponsor</button>` : 'No sponsor selected';
      document.getElementById('sponsorSelected').querySelector('[data-clear-sponsor]')?.addEventListener('click', () => { if (form.dataset.saving === 'true' || !current()) return; selectedSponsor = null; selected(); document.getElementById('sponsorLookup').focus(); });
      document.getElementById('learnerSelected').className = 'workspace-selection';
      document.getElementById('learnerSelected').innerHTML = [...selectedLearners.values()].map(s => `<span>${learnerName(s)} <button type="button" class="btn btn-secondary btn-sm" data-remove="${esc(s.id)}" aria-label="Remove ${esc(s.first_name)} ${esc(s.last_name)} from selection">Remove</button></span>`).join(' ');
      document.getElementById('learnerSelectionCount').textContent = selectedLearners.size ? `${selectedLearners.size} learner${selectedLearners.size === 1 ? '' : 's'} selected` : 'No learners selected';
      for (const kind of ['sponsor', 'learner']) {
        document.getElementById(kind+'Matches').querySelectorAll('[data-pick]').forEach(choice => choice.setAttribute('aria-pressed', String(kind === 'sponsor' ? Number(selectedSponsor?.id) === Number(choice.dataset.pick) : selectedLearners.has(Number(choice.dataset.pick)))));
        if (kind === 'sponsor' ? selectedSponsor : selectedLearners.size) document.getElementById(kind+'Lookup').removeAttribute('aria-invalid');
      }
      document.getElementById('learnerSelected').querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => { if (form.dataset.saving === 'true' || !current()) return; selectedLearners.delete(Number(b.dataset.remove)); selected(); }));
    };
    for (const kind of ['sponsor','learner']) {
      let lookupPage = 1, lookupSequence = 0, search = '';
      async function find(more = false) {
        if (dialog.closed || !current() || form.dataset.saving === 'true' || kind === 'learner' && form.elements.sponsorship_type.value === 'school_wide') return;
        const typeEpoch = allocationEpoch;
        const text = document.getElementById(kind+'Lookup').value.trim();
        const box = document.getElementById(kind+'Matches'), moreButton = document.getElementById(kind+'More');
        const epoch = ++lookupSequence; moreButton.hidden = true;
        if (text.length < 2) { box.innerHTML = '<p>Enter at least two characters to search.</p>'; return; }
        if (text.length > 150) { box.innerHTML = MGAEMS.errorHTML('Keep the search within 150 characters.'); return; }
        lookupPage = more && text === search ? lookupPage + 1 : 1; search = text;
        box.innerHTML = MGAEMS.loadingHTML('Searching…');
        const params = new URLSearchParams({ search, page: lookupPage, per_page: 10 });
        const response = await MGAEMS.get('/api/v1/'+(kind === 'sponsor' ? 'sponsors' : 'sponsorships/learners')+'?'+params);
        if (!current() || dialog.closed || epoch !== lookupSequence || form.dataset.saving === 'true' || (kind === 'learner' && typeEpoch !== allocationEpoch)) return;
        if (!response.ok) { failure(box, response, () => find()); return; }
        if (!validRows(response.data) || !validMeta(response.meta)) { failure(box, { error: 'The search returned an unexpected response.' }, () => find()); return; }
        const type = form.elements.sponsorship_type.value;
        box.innerHTML = response.data.length ? response.data.map(s => {
          const activeIndividual = kind === 'learner' && s.has_active_individual_sponsorship;
          const selectedReference = kind === 'sponsor' ? Number(selectedSponsor?.id) === Number(s.id) : selectedLearners.has(Number(s.id));
          return `<button type="button" class="btn btn-secondary sponsorship-choice" data-pick="${esc(s.id)}" aria-pressed="${selectedReference}" ${activeIndividual && type === 'individual' ? 'disabled' : ''}><span>${kind === 'sponsor' ? esc(s.name) : learnerName(s)}</span>${activeIndividual ? '<small>Already has active individual support'+(type === 'individual' ? ' · unavailable for another individual assignment' : ' · group membership is permitted')+'</small>' : ''}</button>`;
        }).join(' ') : '<p>No matches. Try another name or admission number.</p>';
        box.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
          if (!current() || dialog.closed || form.dataset.saving === 'true') return;
          const s = response.data.find(s => Number(s.id) === Number(b.dataset.pick));
          if (!s || kind === 'learner' && form.elements.sponsorship_type.value === 'individual' && s.has_active_individual_sponsorship) return;
          if (kind === 'sponsor') selectedSponsor = s;
          else { if (form.elements.sponsorship_type.value === 'individual') selectedLearners.clear(); selectedLearners.set(Number(s.id),s); }
          selected();
        }));
        moreButton.hidden = lookupPage * response.meta.per_page >= response.meta.total;
      }
      document.getElementById(kind+'Find').addEventListener('click', () => find());
      document.getElementById(kind+'Lookup').addEventListener('input', () => { lookupSequence++; document.getElementById(kind+'Matches').innerHTML = ''; document.getElementById(kind+'More').hidden = true; });
      document.getElementById(kind+'Lookup').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); find(); } });
      document.getElementById(kind+'More').addEventListener('click', () => find(true));
    }
    function typeChanged() {
      if (!current() || form.dataset.saving === 'true') return;
      allocationEpoch++;
      selectedLearners.clear(); selected();
      const school = form.elements.sponsorship_type.value === 'school_wide';
      document.getElementById('learnerPicker').hidden = school;
      form.elements.program_name.required = school; form.elements.program_name.disabled = !school;
      form.elements.program_name.parentElement.hidden = !school;
      document.getElementById('spTypeHint').textContent = school ? 'School-wide support records a named programme without creating learner links.' : form.elements.sponsorship_type.value === 'group' ? 'Select each group member explicitly. Selections are retained across searches and pages.' : 'Select one active learner. Learners with an active individual sponsorship cannot be selected.';
      document.getElementById('learnerMatches').innerHTML = '';
      document.getElementById('learnerMore').hidden = true;
    }
    form.elements.sponsorship_type.addEventListener('change', typeChanged); typeChanged();
  }
  async function changeStatus(id) {
    const item = state.rows.find(i => Number(i.id) === id); if (!item || !canWrite || !current() || !['active', 'paused'].includes(item.status) || state.changing.has(id)) return;
    state.changing.add(id);
    const controls = [...document.getElementById('spResults').querySelectorAll(`[data-status="${id}"], [data-edit-item="${id}"], [data-end="${id}"]`)].map(button => [button, button.disabled]);
    controls.forEach(([button]) => { button.disabled = true; });
    const status = item.status === 'active' ? 'paused' : 'active';
    try {
      if (!await MGAEMS.confirmAction(status === 'paused' ? 'Pause Sponsorship' : 'Resume Sponsorship', `${status === 'paused' ? 'Pause' : 'Resume'} ${label(item.sponsorship_type).toLowerCase()} sponsorship from ${item.sponsor?.name || 'this sponsor'}? ${status === 'active' && item.sponsorship_type === 'individual' ? 'Active individual eligibility will be checked before resuming.' : 'The recorded assignment or programme remains linked.'}`, status === 'paused' ? 'Pause' : 'Resume')) return;
      if (!current()) return;
      const response = await MGAEMS.patch(`/api/v1/sponsorships/${id}`, { status, end_date: item.end_date, notes: item.notes });
      if (!current()) return;
      if (!response.ok) { MGAEMS.toast(response.error, 'error'); load(); return; }
      MGAEMS.toast('Status updated.', 'success'); load(); loadSummary();
    } finally { state.changing.delete(id); controls.forEach(([button, disabled]) => { button.disabled = disabled; }); }
  }
  async function editSponsorship(id) {
    if (!canWrite || !current() || state.changing.has(id)) return;
    const epoch = ++state.dialogSequence;
    const response = await MGAEMS.get(`/api/v1/sponsorships/${id}`);
    if (!current() || epoch !== state.dialogSequence) return;
    if (!response.ok) { MGAEMS.toast(response.error, 'error'); return; }
    const item = response.data;
    if (!validItem(item) || Number(item.id) !== id) { MGAEMS.toast('The sponsorship identity could not be verified.', 'error'); return; }
    if (item.status === 'ended') { MGAEMS.toast('This sponsorship has ended. Refresh the directory to review its status.', 'error'); load(); return; }
    const { form } = formDialog('Edit sponsorship details', details([['Sponsor', esc(item.sponsor?.name)], ['Type', esc(label(item.sponsorship_type))], ['Target', target(item)], ['Status', badge(item.status)], ['Start date', date(item.start_date)]])+'<p class="workspace-note">Update the planned end date and operational notes. Assignment, sponsor and support type remain as recorded.</p><fieldset><legend>Dates & notes</legend>'+field('end_date', 'Planned end date', item.end_date, 'date')+field('notes', 'Notes', item.notes, 'textarea')+'</fieldset>', form => MGAEMS.patch(`/api/v1/sponsorships/${id}`, { status: item.status, end_date: form.elements.end_date.value || null, notes: form.elements.notes.value.trim() || null }));
    form.elements.end_date.min = item.start_date;
  }
  function endForm(id) {
    if (!canWrite || !current() || state.changing.has(id)) return;
    const item = state.rows.find(row => Number(row.id) === id); if (!item || item.status === 'ended') return;
    const { form } = formDialog('End Sponsorship', `<p class="alert alert-error">Ending is permanent and cannot be reversed.</p><p>${esc(item.sponsor?.name || 'Sponsor')} · ${esc(label(item.sponsorship_type))}</p><fieldset><legend>Ending details</legend>`+field('end_date','End date','','date',true)+field('notes','Reason','','textarea',true)+'</fieldset>', async form => {
      if (!await MGAEMS.confirmAction('End sponsorship permanently', `End ${label(item.sponsorship_type).toLowerCase()} sponsorship from ${item.sponsor?.name || 'this sponsor'} on ${form.elements.end_date.value}? The recorded relationships remain and this sponsorship cannot be reopened.`, 'End sponsorship')) return { cancelled: true };
      if (!current()) return { cancelled: true };
      return MGAEMS.patch(`/api/v1/sponsorships/${id}`, { status: 'ended', end_date: form.elements.end_date.value, notes: form.elements.notes.value.trim() });
    }, 'End sponsorship');
    form.elements.end_date.min = item.start_date;
  }
  switchTab(window.location.hash === '#sponsorships' ? 'sponsorships' : 'sponsors'); loadSummary();
})();
