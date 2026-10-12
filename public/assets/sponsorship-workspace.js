/* Existing Sponsorship management and the Coordinator's focused dashboard. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user) return;
  const page = window.location.pathname;
  const coordinator = user.role === 'sponsor_coordinator';
  const dashboard = page === '/dashboard.html';
  if (dashboard && !coordinator) return;
  if (!dashboard && page !== '/sponsorship.html') return;
  const allowed = ['system_admin', 'head_teacher', 'deputy_head_teacher', 'sponsor_coordinator'].includes(user.role);
  renderAppShell(page);
  const main = document.getElementById('appMain'), esc = MGAEMS.escapeHTML;
  const label = value => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const date = value => esc(value || 'Not recorded');
  const badge = value => `<span class="badge badge-${value === 'active' ? 'green' : value === 'paused' ? 'amber' : 'gray'}">${esc(label(value))}</span>`;
  const sponsorTypes = ['individual', 'church', 'ministry', 'ngo', 'foundation', 'general'];
  const types = ['individual', 'group', 'school_wide'], statuses = ['active', 'paused', 'ended'];
  const canWrite = ['system_admin', 'sponsor_coordinator'].includes(user.role);
  const state = { tab: 'sponsors', page: 1, sequence: 0, dialogSequence: 0, rows: [] };
  let summarySequence = 0;
  const options = values => values.map(value => `<option value="${value}">${esc(label(value))}</option>`).join('');
  const learnerName = s => `${esc(s.first_name)} ${esc(s.last_name)} — ${esc(s.admission_no)}${s.school_class ? ' · '+esc(s.school_class.name) : ''}`;
  const target = i => i.sponsorship_type === 'individual' ? i.student ? learnerName(i.student) : 'No linked learner' : i.sponsorship_type === 'group' ? `${i.students.length} explicit group members` : esc(i.program_name || 'Programme not recorded');
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
    const epoch = ++summarySequence;
    const element = document.getElementById('spSummary');
    element.setAttribute('aria-busy', 'true'); element.innerHTML = MGAEMS.loadingHTML('Loading sponsorship summary…');
    const response = await MGAEMS.get('/api/v1/sponsorships/summary');
    if (epoch !== summarySequence) return;
    if (!response.ok) { failure(element, response, loadSummary); return; }
    const data = response.data;
    if (!data || !data.by_type || !data.by_status || !Number.isFinite(data.sponsors)) { failure(element, {}, loadSummary); return; }
    const metrics = [['Sponsors', data.sponsors], ['Sponsorships', data.sponsorships], ...statuses.map(v => [label(v)+' sponsorships', data.by_status[v]]),
      ...types.map(v => [label(v)+' sponsorships', data.by_type[v]]), ['Individual assignments (all statuses)', data.individual_assignments], ['Group memberships (all statuses)', data.group_memberships]];
    if (metrics.some(([,v]) => !Number.isFinite(v))) { failure(element, {}, loadSummary); return; }
    const metricCards = rows => '<div class="stat-cards">'+rows.map(([name,value]) => `<div class="card stat-card"><div class="label">${esc(name)}</div><div class="num">${esc(value)}</div></div>`).join('')+'</div>';
    const summaryList = rows => '<dl class="dashboard-summary-list">'+rows.map(([name,value]) => `<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join('')+'</dl>';
    element.innerHTML = (dashboard ? metricCards(metrics.slice(0, 3)) + '<div class="dashboard-summary-grid"><section class="card"><h3>Sponsorship status</h3>'+summaryList(statuses.map(value => [label(value), data.by_status[value]]))+'</section><section class="card"><h3>Programme types</h3>'+summaryList(types.map(value => [label(value), data.by_type[value]]))+'</section><section class="card"><h3>Recorded learner relationships</h3>'+summaryList(metrics.slice(-2))+'</section></div>' : metricCards(metrics))
      + '<p class="text-muted">Counts describe stored records. Group memberships count relationships, not unique learners. School-wide sponsorships do not enumerate learners. No financial totals are recorded here.</p>';
    element.setAttribute('aria-busy', 'false');
  }
  if (dashboard) {
    main.innerHTML = '<div class="page-heading"><h1>Sponsor Coordinator Workspace</h1><p>Sponsor relationships, learner support assignments and programme records.</p></div>'+summaryPanel()+
      '<div class="card section"><h2>Operational workflows</h2><div class="form-actions"><a class="btn btn-primary" href="/sponsorship.html">Manage sponsors and sponsorships</a><a class="btn btn-secondary" href="/communication.html">Communication</a><a class="btn btn-secondary" href="/visitors.html">Visitor history</a></div><p class="text-muted">Visitor access is read-only. New direct messages require an approved recipient policy; owned message history and authorized announcements remain available.</p></div>';
    document.getElementById('spRefresh').addEventListener('click', loadSummary); loadSummary(); return;
  }
  main.innerHTML = `<div class="section-header"><div><h1>Sponsorship Management</h1><p class="text-muted">Existing sponsors and learner support programmes.</p></div>${canWrite ? '' : '<span class="badge badge-gray">Read only</span>'}</div>${summaryPanel()}
    <div class="tabs" aria-label="Sponsorship sections"><button type="button" class="tab active" id="spSponsors">Sponsors</button><button type="button" class="tab" id="spItems">Sponsorships</button></div><section id="spView"></section>`;
  document.getElementById('spRefresh').addEventListener('click', loadSummary);
  document.getElementById('spSponsors').addEventListener('click', () => switchTab('sponsors'));
  document.getElementById('spItems').addEventListener('click', () => switchTab('sponsorships'));
  function switchTab(tab, sponsor = '') {
    state.tab = tab; state.page = 1; state.dialogSequence++;
    for (const [id, name] of [['spSponsors','sponsors'], ['spItems','sponsorships']]) {
      const button = document.getElementById(id); button.classList.toggle('active', tab === name); button.setAttribute('aria-pressed', String(tab === name));
    }
    document.getElementById('spView').innerHTML = `<form id="spFilters" class="card section filter-grid sponsorship-filters">
      <div class="field"><label for="spSearch">Search ${tab === 'sponsors' ? 'sponsor name' : 'sponsor, learner or programme'}</label><input id="spSearch" maxlength="150"></div>
      <div class="field"><label for="spTypeFilter">Type</label><select id="spTypeFilter"><option value="">All types</option>${options(tab === 'sponsors' ? sponsorTypes : types)}</select></div>
      ${tab === 'sponsorships' ? `<div class="field"><label for="spStatusFilter">Status</label><select id="spStatusFilter"><option value="">All statuses</option>${options(statuses)}</select></div><input type="hidden" id="spSponsorFilter" value="${esc(sponsor)}">` : ''}
      <div class="form-actions"><button type="submit" class="btn btn-secondary">Search</button>${canWrite ? '<button type="button" class="btn btn-primary" id="spNew">New '+(tab === 'sponsors' ? 'Sponsor' : 'Sponsorship')+'</button>' : ''}</div>
      ${sponsor ? '<p>Showing linked sponsorships. <button type="button" class="btn btn-secondary btn-sm" id="spClearSponsor">Show all sponsors</button></p>' : ''}</form>
      <div id="spResults" class="card card-table" aria-live="polite"></div><div class="pagination"><span id="spPageInfo" role="status"></span><button type="button" class="btn btn-secondary btn-sm" id="spPrev">Previous</button><button type="button" class="btn btn-secondary btn-sm" id="spNext">Next</button></div>`;
    document.getElementById('spFilters').addEventListener('submit', event => { event.preventDefault(); state.page = 1; load(); });
    document.getElementById('spPrev').addEventListener('click', () => { state.page--; load(); });
    document.getElementById('spNext').addEventListener('click', () => { state.page++; load(); });
    document.getElementById('spClearSponsor')?.addEventListener('click', () => switchTab('sponsorships'));
    document.getElementById('spNew')?.addEventListener('click', () => tab === 'sponsors' ? sponsorForm() : sponsorshipForm());
    load();
  }
  async function load() {
    const epoch = ++state.sequence, tab = state.tab, element = document.getElementById('spResults');
    const q = new URLSearchParams({ page: state.page, per_page: 15 });
    const search = document.getElementById('spSearch').value.trim(), type = document.getElementById('spTypeFilter').value;
    if (search) q.set('search', search); if (type) q.set(tab === 'sponsors' ? 'sponsor_type' : 'sponsorship_type', type);
    const status = document.getElementById('spStatusFilter')?.value, sponsor = document.getElementById('spSponsorFilter')?.value;
    if (status) q.set('status', status); if (sponsor) q.set('sponsor_id', sponsor);
    element.setAttribute('aria-busy', 'true'); element.innerHTML = MGAEMS.loadingHTML();
    document.getElementById('spPrev').disabled = document.getElementById('spNext').disabled = true; document.getElementById('spPageInfo').textContent = '';
    const response = await MGAEMS.get(`/api/v1/${tab}?${q}`);
    if (epoch !== state.sequence) return;
    if (!response.ok || !Array.isArray(response.data) || !response.meta) { failure(element, response, load); return; }
    state.rows = response.data; const meta = response.meta;
    document.getElementById('spPrev').disabled = state.page <= 1;
    document.getElementById('spNext').disabled = state.page * meta.per_page >= meta.total;
    document.getElementById('spPageInfo').textContent = `${meta.total} records · Page ${state.page}`;
    element.setAttribute('aria-busy', 'false');
    if (!state.rows.length) { element.innerHTML = MGAEMS.emptyStateHTML('No '+tab+' found', 'Change the search filters or page.', 'heart-handshake'); return; }
    element.innerHTML = `<div class="table-scroll"><table><caption class="sr-only">${tab === 'sponsors' ? 'Sponsor directory' : 'Operational sponsorship report'}</caption><thead><tr>${tab === 'sponsors' ? '<th scope="col">Sponsor</th><th scope="col">Type</th><th scope="col">Sponsorships</th>' : '<th scope="col">Sponsor</th><th scope="col">Type / target</th><th scope="col">Dates</th><th scope="col">Status</th>'}<th scope="col">Actions</th></tr></thead><tbody>${state.rows.map(i => `<tr>${tab === 'sponsors' ? `<td>${esc(i.name)}</td><td>${esc(label(i.sponsor_type))}</td><td>${esc(i.sponsorships_count)}</td>` : `<td>${esc(i.sponsor?.name)}</td><td>${esc(label(i.sponsorship_type))}<br>${target(i)}</td><td>${date(i.start_date)} – ${date(i.end_date)}</td><td>${badge(i.status)}</td>`}<td class="actions"><button type="button" class="btn btn-secondary btn-sm" data-view="${i.id}">View</button>${canWrite ? tab === 'sponsors' ? `<button type="button" class="btn btn-secondary btn-sm" data-edit="${i.id}">Edit</button>` : i.status !== 'ended' ? `<button type="button" class="btn btn-secondary btn-sm" data-status="${i.id}">${i.status === 'active' ? 'Pause' : 'Resume'}</button><button type="button" class="btn btn-danger btn-sm" data-end="${i.id}">End</button>` : '' : ''}</td></tr>`).join('')}</tbody></table></div>`;
    element.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => view(Number(button.dataset.view))));
    element.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => sponsorForm(Number(button.dataset.edit))));
    element.querySelectorAll('[data-status]').forEach(button => button.addEventListener('click', () => changeStatus(Number(button.dataset.status))));
    element.querySelectorAll('[data-end]').forEach(button => button.addEventListener('click', () => endForm(Number(button.dataset.end))));
  }
  const details = pairs => '<dl class="detail-grid">'+pairs.map(([name,value]) => `<div><dt>${esc(name)}</dt><dd>${value}</dd></div>`).join('')+'</dl>';
  async function view(id) {
    const tab = state.tab, dialog = MGAEMS.openModal({ title: tab === 'sponsors' ? 'Sponsor details' : 'Sponsorship details', body: MGAEMS.loadingHTML() });
    const response = await MGAEMS.get(`/api/v1/${tab}/${id}`); if (dialog.closed) return;
    if (!response.ok) { failure(dialog.body, response, () => { dialog.close(); view(id); }); return; }
    const item = response.data;
    if (tab === 'sponsors') {
      dialog.body.innerHTML = details([['Name', esc(item.name)], ['Type', esc(label(item.sponsor_type))], ['Contact person',esc(item.contact_person || 'Not recorded')], ['Phone',esc(item.phone || 'Not recorded')], ['Email',esc(item.email || 'Not recorded')], ['Address',esc(item.address || 'Not recorded')], ['Sponsorships',esc(item.sponsorships_count)]])+`<p class="record-body">${esc(item.notes || '')}</p><button type="button" class="btn btn-secondary" data-linked>View linked sponsorships</button>`;
      dialog.body.querySelector('[data-linked]').addEventListener('click', () => { dialog.close(); switchTab('sponsorships', id); });
    } else {
      dialog.body.innerHTML = details([['Sponsor',esc(item.sponsor?.name)], ['Type',esc(label(item.sponsorship_type))], ['Target',target(item)], ['Status',badge(item.status)], ['Start',date(item.start_date)], ['End',date(item.end_date)]])+`<p class="record-body">${esc(item.notes || '')}</p>`+
        (item.sponsorship_type === 'group' ? '<h3>Explicit group members</h3><ul>'+item.students.map(s => `<li>${learnerName(s)}</li>`).join('')+'</ul><p class="text-muted">Membership was captured at creation. No membership-edit policy has been approved.</p>' : item.sponsorship_type === 'school_wide' ? '<p>Programme-level support. No learner list is granted by this sponsorship.</p>' : '');
    }
  }
  const field = (name, title, value = '', type = 'text', required = false) => `<div class="field"><label for="spf_${name}">${title}${required ? ' *' : ''}</label>${type === 'textarea' ? `<textarea id="spf_${name}" name="${name}" ${required ? 'required' : ''}>${esc(value || '')}</textarea>` : `<input id="spf_${name}" name="${name}" type="${type}" value="${esc(value || '')}" ${required ? 'required' : ''}>`}<div class="field-error" data-error="${name}"></div></div>`;
  function formDialog(title, body, save) {
    const dialog = MGAEMS.openModal({ title, body: '<form id="spForm"><div id="spFormAlert" data-form-error role="alert"></div>'+body+'<div class="form-actions"><button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="submit" class="btn btn-primary">Save</button></div></form>' });
    const form = dialog.body.querySelector('#spForm');
    let saving = false;
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving || !form.reportValidity()) return;
      saving = true;
      dialog.setBusy(true);
      try {
        const response = await save(form);
        if (!response.ok) { document.getElementById('spFormAlert').innerHTML = MGAEMS.errorHTML(response.error || 'Unable to save.'); MGAEMS.showFormErrors(form, response); return; }
        dialog.setBusy(false); dialog.close(); MGAEMS.toast('Record saved.', 'success'); load(); loadSummary();
      } finally { saving = false; dialog.setBusy(false); }
    });
    return { dialog, form };
  }
  async function sponsorForm(id) {
    if (!canWrite) return;
    const epoch = ++state.dialogSequence;
    const response = id ? await MGAEMS.get(`/api/v1/sponsors/${id}`) : { ok: true, data: {} };
    if (epoch !== state.dialogSequence) return;
    if (!response.ok) { MGAEMS.toast(response.error, 'error'); return; }
    const s = response.data;
    const { form } = formDialog(id ? 'Edit Sponsor' : 'New Sponsor', `<div class="form-grid"><div class="field"><label for="spf_sponsor_type">Sponsor type *</label><select id="spf_sponsor_type" name="sponsor_type">${options(sponsorTypes)}</select></div>`+
      field('name','Name',s.name,'text',true)+field('contact_person','Contact person',s.contact_person)+field('phone','Phone',s.phone)+field('email','Email',s.email,'email')+field('address','Address',s.address,'textarea')+field('notes','Notes',s.notes,'textarea')+'</div><p class="text-muted">This business record does not create or change a Sponsor Portal login account.</p>',
      async form => {
        const body = {}; for (const name of ['sponsor_type','name','contact_person','phone','email','address','notes']) body[name] = form.elements[name].value.trim() || null;
        return id ? MGAEMS.patch(`/api/v1/sponsors/${id}`, body) : MGAEMS.post('/api/v1/sponsors', body);
      });
    if (s.sponsor_type) form.elements.sponsor_type.value = s.sponsor_type;
  }
  function picker(kind) { return `<fieldset class="section sponsorship-picker"><legend>${kind === 'sponsor' ? 'Sponsor' : 'Eligible active learners'}</legend><div class="field"><label for="${kind}Lookup">Search ${kind === 'sponsor' ? 'sponsor name' : 'name or admission number'} (at least 2 characters)</label><input id="${kind}Lookup" maxlength="150"></div><button type="button" class="btn btn-secondary btn-sm" id="${kind}Find">Find</button><div id="${kind}Matches" class="sponsorship-matches" aria-live="polite"></div><button type="button" class="btn btn-secondary btn-sm" id="${kind}More" hidden>More results</button><p id="${kind}Selected" class="sponsorship-matches" role="status"></p></fieldset>`; }
  function sponsorshipForm() {
    if (!canWrite) return;
    let selectedSponsor = null; const selectedLearners = new Map();
    const { dialog, form } = formDialog('New Sponsorship', picker('sponsor')+`<div class="field"><label for="spf_sponsorship_type">Sponsorship type *</label><select id="spf_sponsorship_type" name="sponsorship_type">${options(types)}</select></div>`+
      field('program_name','Programme name','')+picker('learner')+field('start_date','Start date','','date',true)+field('end_date','Planned end date','','date')+field('notes','Notes','','textarea')+'<p class="text-muted">Group memberships are explicit. School-wide support creates no learner relationship.</p>', async form => {
        const type = form.elements.sponsorship_type.value;
        if (!selectedSponsor || (type !== 'school_wide' && !selectedLearners.size)) return { ok: false, error: 'Select a sponsor and the required learner(s).' };
        const body = { sponsor_id: selectedSponsor.id, sponsorship_type: type, start_date: form.elements.start_date.value, end_date: form.elements.end_date.value || null, notes: form.elements.notes.value.trim() || null };
        if (type === 'individual') body.student_id = [...selectedLearners.keys()][0];
        if (type === 'group') body.student_ids = [...selectedLearners.keys()];
        if (type === 'school_wide') body.program_name = form.elements.program_name.value.trim();
        return MGAEMS.post('/api/v1/sponsorships', body);
      });
    const selected = () => {
      document.getElementById('sponsorSelected').textContent = selectedSponsor ? 'Selected: '+selectedSponsor.name : 'No sponsor selected';
      document.getElementById('learnerSelected').innerHTML = [...selectedLearners.values()].map(s => `<span>${learnerName(s)} <button type="button" class="btn btn-secondary btn-sm" data-remove="${s.id}">Remove</button></span>`).join(' ');
      document.getElementById('learnerSelected').querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => { selectedLearners.delete(Number(b.dataset.remove)); selected(); }));
    };
    for (const kind of ['sponsor','learner']) {
      let lookupPage = 1, lookupSequence = 0, search = '';
      async function find(more = false) {
        const text = document.getElementById(kind+'Lookup').value.trim();
        const box = document.getElementById(kind+'Matches'), moreButton = document.getElementById(kind+'More');
        const epoch = ++lookupSequence; moreButton.hidden = true;
        if (text.length < 2) { box.innerHTML = '<p>Enter at least two characters to search.</p>'; return; }
        lookupPage = more && text === search ? lookupPage + 1 : 1; search = text;
        box.innerHTML = MGAEMS.loadingHTML('Searching…');
        const params = new URLSearchParams({ search, page: lookupPage, per_page: 10 });
        const response = await MGAEMS.get('/api/v1/'+(kind === 'sponsor' ? 'sponsors' : 'sponsorships/learners')+'?'+params);
        if (dialog.closed || epoch !== lookupSequence) return;
        if (!response.ok) { failure(box, response, () => find()); return; }
        const type = form.elements.sponsorship_type.value;
        box.innerHTML = response.data.length ? response.data.map(s => `<button type="button" class="btn btn-secondary btn-sm" data-pick="${s.id}" ${kind === 'learner' && type === 'individual' && s.has_active_individual_sponsorship ? 'disabled' : ''}>${kind === 'sponsor' ? esc(s.name) : learnerName(s)}${kind === 'learner' && type === 'individual' && s.has_active_individual_sponsorship ? ' (already active)' : ''}</button>`).join(' ') : '<p>No matches.</p>';
        box.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
          const s = response.data.find(s => s.id === Number(b.dataset.pick));
          if (kind === 'sponsor') selectedSponsor = s;
          else { if (form.elements.sponsorship_type.value === 'individual') selectedLearners.clear(); selectedLearners.set(s.id,s); }
          selected();
        }));
        moreButton.hidden = lookupPage * response.meta.per_page >= response.meta.total;
      }
      document.getElementById(kind+'Find').addEventListener('click', () => find());
      document.getElementById(kind+'Lookup').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); find(); } });
      document.getElementById(kind+'More').addEventListener('click', () => find(true));
    }
    function typeChanged() {
      selectedLearners.clear(); selected();
      const school = form.elements.sponsorship_type.value === 'school_wide';
      document.getElementById('learnerLookup').parentElement.parentElement.hidden = school;
      form.elements.program_name.required = school; form.elements.program_name.disabled = !school;
      document.getElementById('learnerMatches').innerHTML = '';
    }
    form.elements.sponsorship_type.addEventListener('change', typeChanged); typeChanged();
  }
  async function changeStatus(id) {
    const item = state.rows.find(i => i.id === id); if (!item || !canWrite) return;
    const status = item.status === 'active' ? 'paused' : 'active';
    if (!await MGAEMS.confirmAction(status === 'paused' ? 'Pause Sponsorship' : 'Resume Sponsorship', 'Confirm the status change for this sponsorship.', status === 'paused' ? 'Pause' : 'Resume')) return;
    const response = await MGAEMS.patch(`/api/v1/sponsorships/${id}`, { status, end_date: item.end_date, notes: item.notes });
    if (!response.ok) { MGAEMS.toast(response.error, 'error'); load(); return; }
    MGAEMS.toast('Status updated.', 'success'); load(); loadSummary();
  }
  function endForm(id) {
    if (!canWrite) return;
    formDialog('End Sponsorship', '<p class="alert alert-error">Ending is permanent and cannot be reversed. Save confirms this consequential change.</p>'+field('end_date','End date','','date',true)+field('notes','Reason','','textarea',true), form => MGAEMS.patch(`/api/v1/sponsorships/${id}`, { status: 'ended', end_date: form.elements.end_date.value, notes: form.elements.notes.value.trim() }));
  }
  switchTab('sponsors'); loadSummary();
})();
