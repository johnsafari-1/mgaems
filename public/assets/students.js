/* Learner discovery and lifecycle. Related domains retain their own workflows. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || MGAEMS.landingPage(user) !== '/dashboard.html') return;
  if (user.role === 'teacher') return; // Shared Teacher Workspace renders the scoped reader.
  renderAppShell('/students.html');
  const esc = MGAEMS.escapeHTML;
  const managers = ['system_admin', 'head_teacher', 'deputy_head_teacher'];
  const canWrite = managers.includes(user.role);
  const main = document.getElementById('appMain');
  if (!canWrite && user.role !== 'teacher') {
    main.innerHTML = MGAEMS.errorHTML('You do not have permission to view the learner directory.');
    MGAEMS.initIcons();
    return;
  }
  const state = { page: 1, pages: 1, request: 0, editRequest: 0, classes: [], timer: null };
  const badge = status => ({ active: 'badge-green', promoted: 'badge-navy', transferred: 'badge-amber', left: 'badge-gray' }[status] || 'badge-gray');
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const statusLabel = status => ({ active: 'Active', promoted: 'Promoted (legacy)', transferred: 'Transferred', left: 'Left school' }[status] || status);
  const validPage = result => Array.isArray(result.data) && Number.isInteger(result.meta?.total) && result.meta.total >= 0 && Number.isInteger(result.meta?.per_page) && result.meta.per_page > 0;
  const options = (items, selected = '') => '<option value="">Select…</option>' + items.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(selected) ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
  const field = (name, label, type = 'text', value = '', attributes = '') => `<div class="field"><label for="learner_${name}">${label} *</label><input id="learner_${name}" name="${name}" type="${type}" value="${esc(value)}" required ${attributes}></div>`;
  const select = (name, label, contents) => `<div class="field"><label for="learner_${name}">${label} *</label><select id="learner_${name}" name="${name}" required>${contents}</select></div>`;

  main.innerHTML = `<div class="section-header"><div><h1>Learner directory</h1><p class="text-muted">Find learners, manage admissions and keep school records up to date.</p></div>${canWrite ? '<button type="button" class="btn btn-primary" id="addStudentBtn" disabled><i data-lucide="user-plus" aria-hidden="true"></i> Add learner</button>' : ''}</div>
    <div id="classError"></div><div class="card directory-card"><div class="directory-filters" role="search" aria-label="Filter learners">
      <div class="field"><label for="searchInput">Search learners</label><input type="search" id="searchInput" maxlength="150" placeholder="Name or admission number" aria-controls="studentsTableWrap"></div>
      <div class="field"><label for="classFilter">Class</label><select id="classFilter" disabled><option value="">All classes</option></select></div>
      <div class="field"><label for="statusFilter">Enrollment status</label><select id="statusFilter"><option value="">All statuses</option>${['active', 'promoted', 'transferred', 'left'].map(status => `<option value="${status}">${statusLabel(status)}</option>`).join('')}</select></div>
      <button type="button" class="btn btn-secondary" id="clearFilters">Clear filters</button>
    </div><div class="directory-summary"><span id="learnerResultsSummary" role="status" aria-live="polite">Loading learners…</span><span class="text-meta">Open a profile to view details and related records.</span></div><div id="studentsTableWrap" aria-busy="true">${MGAEMS.loadingHTML('Loading learners…')}</div><div class="pagination" id="paginationBar" hidden></div></div>`;
  document.getElementById('addStudentBtn')?.addEventListener('click', event => openLearnerForm('register', null, event.currentTarget));
  document.getElementById('searchInput').addEventListener('input', () => {
    state.page = 1; state.request++; clearTimeout(state.timer);
    state.timer = setTimeout(loadLearners, 300);
  });
  ['classFilter', 'statusFilter'].forEach(id => document.getElementById(id).addEventListener('change', () => { state.page = 1; loadLearners(); }));
  document.getElementById('clearFilters').addEventListener('click', () => {
    clearTimeout(state.timer);
    ['searchInput', 'classFilter', 'statusFilter'].forEach(id => { document.getElementById(id).value = ''; });
    state.page = 1; loadLearners(); document.getElementById('searchInput').focus();
  });

  async function loadClasses() {
    const result = await MGAEMS.get('/api/v1/classes');
    const error = document.getElementById('classError');
    if (!result.ok || !Array.isArray(result.data)) {
      error.innerHTML = MGAEMS.errorHTML(result.error || 'Class choices could not be loaded.') + '<button type="button" class="btn btn-secondary btn-sm">Retry class choices</button>';
      error.querySelector('button').addEventListener('click', loadClasses);
    } else {
      state.classes = result.data;
      error.innerHTML = !state.classes.length ? MGAEMS.emptyStateHTML('No classes available', 'Configure real classes in Academics before registering learners.', 'book-open') : '';
      document.getElementById('classFilter').innerHTML = '<option value="">All classes</option>' + result.data.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
      document.getElementById('classFilter').disabled = false;
      if (canWrite) document.getElementById('addStudentBtn').disabled = !state.classes.length;
    }
    MGAEMS.initIcons();
  }

  async function loadLearners() {
    const sequence = ++state.request;
    const wrap = document.getElementById('studentsTableWrap');
    const pagination = document.getElementById('paginationBar');
    const summary = document.getElementById('learnerResultsSummary');
    summary.textContent = 'Loading learners…';
    wrap.setAttribute('aria-busy', 'true'); pagination.hidden = true;
    wrap.innerHTML = MGAEMS.loadingHTML('Loading learners…');
    const params = new URLSearchParams({ page: state.page, per_page: 15 });
    const search = document.getElementById('searchInput').value.trim();
    const classId = document.getElementById('classFilter').value;
    const status = document.getElementById('statusFilter').value;
    if (search) params.set('search', search);
    if (classId) params.set('class_id', classId);
    if (status) params.set('status', status);
    const result = await MGAEMS.get('/api/v1/students?' + params);
    if (sequence !== state.request) return;
    wrap.setAttribute('aria-busy', 'false');
    if (!result.ok || !validPage(result)) {
      summary.textContent = 'Learners could not be loaded.';
      if (result.ok) result.error = 'The server returned an unexpected learner response.';
      wrap.innerHTML = MGAEMS.errorHTML(result.status === 403 ? 'You do not have permission to view learners.' : result.error) + '<button type="button" class="btn btn-secondary btn-sm">Try again</button>';
      wrap.querySelector('button').addEventListener('click', loadLearners);
    } else {
      state.pages = Math.max(1, Math.ceil(result.meta.total / result.meta.per_page));
      if (state.page > state.pages) { state.page = state.pages; loadLearners(); return; }
      const first = result.data.length ? (state.page - 1) * result.meta.per_page + 1 : 0;
      summary.textContent = `Showing ${first}–${first ? first + result.data.length - 1 : 0} of ${result.meta.total} learners${search || classId || status ? ' matching filters' : ''}`;
      wrap.innerHTML = !result.data.length ? MGAEMS.emptyStateHTML(search || classId || status ? 'No learners match these filters' : 'No learners registered', search || classId || status ? 'Try a different search or clear the filters.' : 'Use Add learner to register your first admission.', 'users') : `<div class="table-scroll" role="region" aria-label="Learner directory table" tabindex="0"><table class="directory-table"><caption class="sr-only">Learner directory</caption><thead><tr><th scope="col">Admission no.</th><th scope="col">Learner</th><th scope="col">Recorded class</th><th scope="col">Enrollment</th><th scope="col">Actions</th></tr></thead><tbody>${result.data.map(item => `<tr><td>${esc(item.admission_no)}</td><td><span class="directory-name">${esc(item.first_name)} ${esc(item.last_name)}</span></td><td>${esc(item.school_class?.name || 'Unassigned')}</td><td><span class="badge ${badge(item.status)}">${esc(statusLabel(item.status))}</span></td><td><div class="actions"><button type="button" class="btn btn-secondary btn-sm" data-profile="${esc(item.id)}" aria-label="Open profile for ${esc(item.first_name)} ${esc(item.last_name)}">View profile</button>${canWrite ? `<button type="button" class="btn btn-secondary btn-sm" data-edit="${esc(item.id)}" aria-label="Edit profile for ${esc(item.first_name)} ${esc(item.last_name)}">Edit</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`;
      wrap.querySelectorAll('[data-profile]').forEach(button => button.addEventListener('click', () => openProfile(button.dataset.profile, button)));
      wrap.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => editFromDirectory(button.dataset.edit, button)));
      pagination.hidden = result.meta.total === 0;
      pagination.innerHTML = `<span>Page ${esc(state.page)} of ${esc(state.pages)} · ${esc(result.meta.total)} learners</span><div class="flex gap-2"><button type="button" class="btn btn-secondary btn-sm" data-page="-1" ${state.page <= 1 ? 'disabled' : ''}>Previous</button><button type="button" class="btn btn-secondary btn-sm" data-page="1" ${state.page >= state.pages ? 'disabled' : ''}>Next</button></div>`;
      pagination.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { state.page += Number(button.dataset.page); loadLearners(); }));
    }
    MGAEMS.initIcons();
  }

  async function editFromDirectory(id, button) {
    if (button.disabled) return;
    const directoryRequest = state.request, editRequest = ++state.editRequest;
    button.disabled = true;
    const result = await MGAEMS.get(`/api/v1/students/${encodeURIComponent(id)}`);
    button.disabled = false;
    if (directoryRequest !== state.request || editRequest !== state.editRequest) return;
    if (!result.ok) { MGAEMS.toast(result.error, 'error'); return; }
    openLearnerForm('edit', result.data, button);
  }

  function openProfile(id, trigger) {
    const modal = MGAEMS.openModal({ title: 'Learner profile', body: MGAEMS.loadingHTML('Loading learner profile…'), trigger });
    modal.overlay.className = 'modal-overlay learner-profile';
    modal.profileRequest = 0; modal.profileTab = 'overview';
    loadProfile(modal, id);
  }

  async function loadProfile(modal, id) {
    const sequence = ++modal.profileRequest;
    modal.body.innerHTML = MGAEMS.loadingHTML('Loading learner profile…');
    const [profile, history, sponsorship] = await Promise.all([
      MGAEMS.get(`/api/v1/students/${encodeURIComponent(id)}`),
      MGAEMS.get(`/api/v1/students/${encodeURIComponent(id)}/academic-history`),
      canWrite ? MGAEMS.get(`/api/v1/sponsorships?student_id=${encodeURIComponent(id)}`) : Promise.resolve(null),
    ]);
    if (modal.closed || sequence !== modal.profileRequest) return;
    if (!profile.ok) {
      modal.body.innerHTML = MGAEMS.errorHTML(profile.error) + '<button type="button" class="btn btn-secondary" data-retry>Try again</button>';
      modal.body.querySelector('[data-retry]').addEventListener('click', () => loadProfile(modal, id));
      MGAEMS.initIcons(); return;
    }
    const learner = profile.data;
    const tabs = [['overview', 'Overview'], ...(canWrite ? [['guardians', 'Guardians']] : []), ['history', 'Academic history'], ...(canWrite ? [['sponsorship', 'Sponsorship']] : [])];
    const historyRows = history.ok ? history.data.promotions_transfers : [];
    const latest = historyRows.reduce((date, record) => record.effective_date > date ? record.effective_date : date, learner.admission_date);
    const overview = [['Admission number', learner.admission_no], ['Name', `${learner.first_name} ${learner.last_name}`], ['Gender', learner.gender], ['Date of birth', learner.date_of_birth], ['Admission date', learner.admission_date], [learner.status === 'active' ? 'Current class' : 'Recorded class', learner.school_class?.name || 'Unassigned'], ['Lifecycle status', learner.status]];
    modal.body.innerHTML = `<div class="profile-identity"><span class="profile-avatar" aria-hidden="true">${esc((learner.first_name?.[0] || '') + (learner.last_name?.[0] || ''))}</span><div><h3>${esc(learner.first_name)} ${esc(learner.last_name)}</h3><p>${esc(learner.admission_no)} · ${esc(learner.school_class?.name || 'Unassigned')}</p></div><span class="badge ${badge(learner.status)}">${esc(statusLabel(learner.status))}</span></div>
      <div class="tabs" role="tablist" aria-label="Learner profile sections">${tabs.map(([key, title], index) => `<button type="button" class="tab ${index === 0 ? 'active' : ''}" id="learnerTab_${key}" role="tab" aria-selected="${index === 0}" aria-controls="learnerPanel_${key}" tabindex="${index === 0 ? 0 : -1}" data-tab="${key}">${title}</button>`).join('')}</div>
      <section class="tab-panel active" id="learnerPanel_overview" role="tabpanel" tabindex="0" aria-labelledby="learnerTab_overview"><h3 class="sr-only">Learner overview</h3><dl class="detail-grid">${overview.map(([label, value]) => `<div><dt>${label}</dt><dd>${label === 'Lifecycle status' ? `<span class="badge ${badge(value)}">${esc(statusLabel(value))}</span>` : esc(value || 'Not recorded')}</dd></div>`).join('')}</dl>
      ${canWrite ? `<section class="profile-section"><h3>Enrollment & class changes</h3><p class="text-muted">${learner.status === 'active' ? 'Promotion keeps enrollment active. Transfer out or leaving school ends active enrollment and retains existing records.' : ['transferred', 'left'].includes(learner.status) ? 'Use Transfer in to record a return to active enrollment.' : 'This legacy status is retained. Promotion and transfer out require active enrollment.'}</p><div class="form-actions"><button type="button" class="btn btn-secondary btn-sm" data-action="edit">Edit profile</button>${learner.status === 'active' ? '<button type="button" class="btn btn-secondary btn-sm" data-action="promote">Promote learner</button><button type="button" class="btn btn-secondary btn-sm" data-action="transfer_out">Transfer out</button><button type="button" class="btn btn-danger btn-sm" data-action="left">Mark as left</button>' : ['transferred', 'left'].includes(learner.status) ? '<button type="button" class="btn btn-secondary btn-sm" data-action="transfer_in">Transfer in</button>' : ''}</div></section>` : ''}
      <h3 class="profile-subsection">Related workflows</h3><p class="text-muted">Open the authoritative module to view or manage its records.</p><div class="form-actions"><a class="btn btn-secondary btn-sm" href="/attendance.html">Attendance</a><a class="btn btn-secondary btn-sm" href="/assessment.html">Assessment / report cards</a>${canWrite ? `<a class="btn btn-secondary btn-sm" href="/guardians.html?student_id=${encodeURIComponent(id)}">Parents / guardians</a><a class="btn btn-secondary btn-sm" href="/sponsorship.html">Sponsorship</a><a class="btn btn-secondary btn-sm" href="/reports.html">Reports</a>` : ''}</div></section>
      ${canWrite ? `<section class="tab-panel" id="learnerPanel_guardians" role="tabpanel" tabindex="0" aria-labelledby="learnerTab_guardians" hidden><div class="panel-heading"><div><h3>Linked guardians</h3><p class="text-muted">Contact details and relationships recorded by the school.</p></div><a class="btn btn-primary btn-sm" href="/guardians.html?student_id=${encodeURIComponent(id)}">Manage guardians</a></div>${learner.guardians?.length ? `<div class="record-list profile-contacts">${learner.guardians.map(guardian => `<div class="record-item"><div><strong>${esc(guardian.full_name)}</strong><span class="text-meta">${esc(guardian.relationship)}</span><span class="text-meta">${esc(guardian.phone || 'No phone')}${guardian.email ? ' · ' + esc(guardian.email) : ''}</span></div>${guardian.is_primary_contact ? '<span class="badge badge-navy">Primary contact</span>' : ''}</div>`).join('')}</div>` : MGAEMS.emptyStateHTML('No linked guardians', 'Use Manage guardians to add or link a contact and review optional portal access.', 'contact-round')}<p class="form-hint text-muted">One Parent/Guardian account can access multiple children linked by the school.</p></section>` : ''}
      <section class="tab-panel" id="learnerPanel_history" role="tabpanel" tabindex="0" aria-labelledby="learnerTab_history" hidden><h3>Academic history</h3><p class="text-muted">${esc(learner.status === 'active' ? 'Current class' : 'Recorded class')}: ${esc(learner.school_class?.name || 'Unassigned')}. The records below retain earlier class placements.</p>${!history.ok ? MGAEMS.errorHTML(history.error) : !historyRows.length ? MGAEMS.emptyStateHTML('No promotion or transfer history', 'No class-change history has been recorded. The overview shows the recorded class.', 'history') : `<div class="table-scroll" role="region" aria-label="Academic history table" tabindex="0"><table class="directory-table"><caption class="sr-only">Recorded promotion and transfer history</caption><thead><tr><th scope="col">Date</th><th scope="col">Operation</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Term</th><th scope="col">Reason</th></tr></thead><tbody>${historyRows.map(record => `<tr><td>${esc(record.effective_date)}</td><td>${esc(record.type.replace(/_/g, ' '))}</td><td>${esc(record.from_class?.name || '—')}</td><td>${esc(record.to_class?.name || '—')}</td><td>${esc(record.term?.name || '—')}</td><td>${esc(record.reason || '—')}</td></tr>`).join('')}</tbody></table></div>`}</section>
      ${canWrite ? `<section class="tab-panel" id="learnerPanel_sponsorship" role="tabpanel" tabindex="0" aria-labelledby="learnerTab_sponsorship" hidden><h3>Learner sponsorship</h3><p class="text-muted">Individual and group sponsorships linked to this learner.</p>${!sponsorship.ok ? MGAEMS.errorHTML(sponsorship.error) : !sponsorship.data.length ? MGAEMS.emptyStateHTML('No learner-specific sponsorships', 'Individual and group sponsorships linked to this learner appear here.', 'heart-handshake') : `<div class="record-list">${sponsorship.data.map(item => `<div class="record-item"><div><strong>${esc(item.sponsor?.name || 'Sponsor')}</strong><span class="text-meta">${esc(item.sponsorship_type)} · ${esc(item.start_date)}${item.end_date ? ' – ' + esc(item.end_date) : ''}</span></div><span class="badge ${item.status === 'active' ? 'badge-green' : 'badge-gray'}">${esc(item.status)}</span></div>`).join('')}</div>`}</section>` : ''}`;
    initProfileTabs(modal);
    modal.body.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
      if (button.dataset.action === 'left') {
        if (modal.changingEnrollment) return;
        modal.changingEnrollment = true;
        if (!await MGAEMS.confirmAction('Mark learner as left', `Mark ${learner.first_name} ${learner.last_name} as left? This removes active enrollment; existing records remain.`, 'Mark as left')) { modal.changingEnrollment = false; return; }
        modal.setBusy(true);
        const result = await MGAEMS.patch(`/api/v1/students/${learner.id}`, { status: 'left' });
        modal.setBusy(false); modal.changingEnrollment = false;
        if (!result.ok) { MGAEMS.toast(Object.values(result.fields || {}).flat()[0] || result.error, 'error'); return; }
        MGAEMS.toast('Learner marked as left.', 'success'); loadProfile(modal, id); loadLearners();
      } else openLearnerForm(button.dataset.action, learner, button, modal, latest);
    }));
    if (!history.ok || (canWrite && !sponsorship.ok)) {
      const retry = document.createElement('button'); retry.className = 'btn btn-secondary btn-sm'; retry.type = 'button'; retry.textContent = 'Retry profile records';
      retry.addEventListener('click', () => loadProfile(modal, id)); modal.body.appendChild(retry);
    }
    MGAEMS.initIcons();
    if (!modal.overlay.inert) modal.body.querySelector('[aria-selected="true"]')?.focus();
  }

  function initProfileTabs(modal) {
    const tabs = [...modal.body.querySelectorAll('[role="tab"]')];
    function activate(tab) {
      modal.profileTab = tab.dataset.tab;
      tabs.forEach(item => { const active = item === tab; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1; const panel = modal.body.querySelector('#' + item.getAttribute('aria-controls')); panel.hidden = !active; panel.classList.toggle('active', active); });
    }
    activate(tabs.find(tab => tab.dataset.tab === modal.profileTab) || tabs[0]);
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activate(tab));
      tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
        if (event.key === 'ArrowLeft') next = tabs[(index + tabs.length - 1) % tabs.length];
        if (event.key === 'Home') next = tabs[0];
        if (event.key === 'End') next = tabs[tabs.length - 1];
        if (next) { event.preventDefault(); activate(next); next.focus(); }
      });
    });
  }

  async function openLearnerForm(mode, learner, trigger, parent = null, minimumDate = '') {
    if (!canWrite) return;
    const labels = { register: 'Register learner', edit: 'Edit learner profile', promote: 'Promote learner', transfer_in: 'Transfer in', transfer_out: 'Transfer out' };
    const saveLabel = mode === 'edit' ? 'Save changes' : labels[mode];
    const modal = MGAEMS.openModal({ title: labels[mode], body: MGAEMS.loadingHTML('Loading form…'), trigger, footer: '<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="submit" form="learnerForm" class="btn btn-primary" data-submit disabled>Save</button>' });
    let terms = [];
    const placement = ['promote', 'transfer_in', 'transfer_out'].includes(mode);
    if (placement) {
      const result = await MGAEMS.get('/api/v1/terms');
      if (modal.closed) return;
      if (!result.ok || !result.data.length) {
        modal.body.innerHTML = (result.ok ? MGAEMS.emptyStateHTML('No terms available', 'Configure an academic term before recording a class/transfer change.', 'calendar') : MGAEMS.errorHTML(result.error)) + '<button type="button" class="btn btn-secondary" data-retry-form>Retry term choices</button>';
        modal.body.querySelector('[data-retry-form]').addEventListener('click', () => { modal.close(); openLearnerForm(mode, learner, trigger, parent, minimumDate); });
        MGAEMS.initIcons(); return;
      }
      terms = result.data.map(term => ({ id: term.id, name: `${term.name}${term.academic_year?.name ? ' · ' + term.academic_year.name : ''}` }));
    }
    if ((mode === 'register' || mode === 'promote' || mode === 'transfer_in') && !state.classes.length) {
      modal.body.innerHTML = MGAEMS.errorHTML('Real class choices are unavailable. Retry class choices on the learner page.'); return;
    }
    let contents;
    if (!placement) {
      contents = `<fieldset><legend>Learner information</legend><div class="form-grid">${field('first_name', 'First name', 'text', learner?.first_name, 'maxlength="80" autocomplete="given-name"')}${field('last_name', 'Last name', 'text', learner?.last_name, 'maxlength="80" autocomplete="family-name"')}${field('date_of_birth', 'Date of birth', 'date', learner?.date_of_birth, `max="${esc(learner?.admission_date || today())}"`)}${select('gender', 'Gender', options([{ id: 'male', name: 'Male' }, { id: 'female', name: 'Female' }], learner?.gender))}</div></fieldset>`;
      if (mode === 'register') contents += `<fieldset><legend>Admission & placement</legend><div class="form-grid">${select('class_id', 'Admission class', options(state.classes))}${field('admission_date', 'Admission date', 'date', today(), `max="${today()}"`)}</div><p class="form-hint">Admission must be on or after the date of birth and no later than today.</p></fieldset>`;
    } else {
      contents = `<fieldset><legend>Recorded class change</legend><p class="text-muted">${esc(learner.first_name)} ${esc(learner.last_name)} · ${esc(learner.admission_no)} · ${esc(learner.school_class?.name || 'Unassigned')}</p><div class="form-grid">` + (mode !== 'transfer_out' ? select('to_class_id', mode === 'promote' ? 'Destination class' : 'Current class on return', options(state.classes.filter(item => mode !== 'promote' || Number(item.id) !== Number(learner.class_id)))) : '') + select('term_id', 'Academic term', options(terms)) + field('effective_date', 'Effective date', 'date', today(), `min="${esc(minimumDate)}" max="${today()}"`) + '<div class="field full"><label for="learner_reason">Reason (optional)</label><input id="learner_reason" name="reason" maxlength="255"></div></div><p class="form-hint">Choose a date no later than today and on or after admission and the latest recorded change.</p></fieldset>';
    }
    modal.body.innerHTML = `<form id="learnerForm" class="workflow-form"><div data-form-error></div><p class="text-muted">${mode === 'register' ? 'The school system generates the admission number. After saving, open Guardians in the profile to link family contacts.' : mode === 'edit' ? 'Use Promotion or Transfer to record class changes. Admission details are preserved.' : 'This operation adds a dated entry to academic history.'}</p><p class="form-hint">Fields marked * are required.</p>${contents}</form>`;
    const form = modal.body.querySelector('form');
    const submit = modal.overlay.querySelector('[data-submit]'); submit.disabled = false; submit.textContent = saveLabel;
    form.querySelector('input,select')?.focus();
    if (mode === 'register') form.elements.date_of_birth.addEventListener('change', () => { form.elements.admission_date.min = form.elements.date_of_birth.value; });
    let submitting = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submitting || !form.reportValidity()) return;
      submitting = true;
      const payload = Object.fromEntries(new FormData(form));
      Object.keys(payload).forEach(key => { if (typeof payload[key] === 'string') payload[key] = payload[key].trim(); });
      if (payload.reason === '') payload.reason = null;
      if (mode.startsWith('transfer_')) payload.type = mode;
      if (placement) {
        const destination = state.classes.find(item => String(item.id) === payload.to_class_id)?.name;
        const message = mode === 'transfer_out' ? `Transfer ${learner.first_name} ${learner.last_name} out of the school on ${payload.effective_date}? Active enrollment will end; existing records remain.` : `${labels[mode]}: ${learner.first_name} ${learner.last_name} to ${destination} on ${payload.effective_date}? ${mode === 'promote' ? 'Enrollment remains active.' : 'Enrollment will become active.'} A history entry will be recorded.`;
        if (!await MGAEMS.confirmAction('Confirm ' + labels[mode].toLowerCase(), message, labels[mode])) { submitting = false; return; }
      }
      modal.setBusy(true); submit.textContent = 'Saving…';
      const result = mode === 'register' ? await MGAEMS.post('/api/v1/students', payload) : mode === 'edit' ? await MGAEMS.patch(`/api/v1/students/${learner.id}`, payload) : await MGAEMS.post(`/api/v1/students/${learner.id}/${mode === 'promote' ? 'promote' : 'transfer'}`, payload);
      modal.setBusy(false); submitting = false; submit.textContent = saveLabel;
      if (!result.ok) { MGAEMS.showFormErrors(form, result); return; }
      modal.close(); MGAEMS.toast(mode === 'register' ? `Learner registered: ${result.data.admission_no}` : 'Learner record updated.', 'success');
      loadLearners();
      if (parent && !parent.closed) loadProfile(parent, learner.id);
      if (mode === 'register') openProfile(result.data.id);
    });
    MGAEMS.initIcons();
  }

  loadClasses(); loadLearners(); MGAEMS.initIcons();
  const linkedId = new URLSearchParams(window.location.search).get('student_id');
  if (linkedId && /^\d+$/.test(linkedId) && Number(linkedId) > 0) openProfile(linkedId);
})();
