/* Learner discovery and lifecycle. Related domains retain their own workflows. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || MGAEMS.landingPage(user) !== '/dashboard.html') return;
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
  const state = { page: 1, pages: 1, request: 0, classes: [], timer: null };
  const badge = status => ({ active: 'badge-green', promoted: 'badge-navy', transferred: 'badge-amber', left: 'badge-gray' }[status] || 'badge-gray');
  const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
  const options = (items, selected = '') => '<option value="">Select…</option>' + items.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(selected) ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
  const field = (name, label, type = 'text', value = '', attributes = '') => `<div class="field"><label for="learner_${name}">${label} *</label><input id="learner_${name}" name="${name}" type="${type}" value="${esc(value)}" required ${attributes}></div>`;
  const select = (name, label, contents) => `<div class="field"><label for="learner_${name}">${label} *</label><select id="learner_${name}" name="${name}" required>${contents}</select></div>`;

  main.innerHTML = `<div class="section-header"><div><h1>Learners</h1><p class="text-muted">Admissions, profiles, and recorded class changes.</p></div>${canWrite ? '<button type="button" class="btn btn-primary" id="addStudentBtn" disabled><i data-lucide="user-plus" aria-hidden="true"></i> Register learner</button>' : ''}</div>
    <div id="classError"></div><div class="card"><div class="toolbar">
      <div class="search-input"><label class="sr-only" for="searchInput">Search learners</label><i data-lucide="search" aria-hidden="true"></i><input type="search" id="searchInput" maxlength="150" placeholder="Name or admission number"></div>
      <label class="sr-only" for="classFilter">Class</label><select id="classFilter" disabled><option value="">All classes</option></select>
      <label class="sr-only" for="statusFilter">Lifecycle status</label><select id="statusFilter"><option value="">All statuses</option>${['active', 'promoted', 'transferred', 'left'].map(status => `<option value="${status}">${status[0].toUpperCase() + status.slice(1)}</option>`).join('')}</select>
    </div><div id="studentsTableWrap" aria-busy="true">${MGAEMS.loadingHTML('Loading learners…')}</div><div class="pagination" id="paginationBar" hidden></div></div>`;
  document.getElementById('addStudentBtn')?.addEventListener('click', event => openLearnerForm('register', null, event.currentTarget));
  document.getElementById('searchInput').addEventListener('input', () => {
    state.page = 1; state.request++; clearTimeout(state.timer);
    state.timer = setTimeout(loadLearners, 300);
  });
  ['classFilter', 'statusFilter'].forEach(id => document.getElementById(id).addEventListener('change', () => { state.page = 1; loadLearners(); }));

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
    if (!result.ok) {
      wrap.innerHTML = MGAEMS.errorHTML(result.status === 403 ? 'You do not have permission to view learners.' : result.error) + '<button type="button" class="btn btn-secondary btn-sm">Try again</button>';
      wrap.querySelector('button').addEventListener('click', loadLearners);
    } else {
      state.pages = Math.max(1, Math.ceil(result.meta.total / result.meta.per_page));
      if (state.page > state.pages) { state.page = state.pages; loadLearners(); return; }
      wrap.innerHTML = !result.data.length ? MGAEMS.emptyStateHTML(search || classId || status ? 'No learners match these filters' : 'No learners registered', 'Use the filters to find a learner, or register a learner if authorized.', 'users') : `<div class="table-scroll"><table><caption class="sr-only">Learner directory</caption><thead><tr><th scope="col">Admission no.</th><th scope="col">Name</th><th scope="col">Class</th><th scope="col">Status</th><th scope="col">Profile</th></tr></thead><tbody>${result.data.map(item => `<tr><td>${esc(item.admission_no)}</td><td>${esc(item.first_name)} ${esc(item.last_name)}</td><td>${esc(item.school_class?.name || 'Unassigned')}</td><td><span class="badge ${badge(item.status)}">${esc(item.status)}</span></td><td><button type="button" class="btn btn-secondary btn-sm" data-profile="${esc(item.id)}" aria-label="Open profile for ${esc(item.first_name)} ${esc(item.last_name)}">View</button></td></tr>`).join('')}</tbody></table></div>`;
      wrap.querySelectorAll('[data-profile]').forEach(button => button.addEventListener('click', () => openProfile(button.dataset.profile, button)));
      pagination.hidden = result.meta.total === 0;
      pagination.innerHTML = `<span>Page ${esc(state.page)} of ${esc(state.pages)} · ${esc(result.meta.total)} learners</span><div class="flex gap-2"><button type="button" class="btn btn-secondary btn-sm" data-page="-1" ${state.page <= 1 ? 'disabled' : ''}>Previous</button><button type="button" class="btn btn-secondary btn-sm" data-page="1" ${state.page >= state.pages ? 'disabled' : ''}>Next</button></div>`;
      pagination.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { state.page += Number(button.dataset.page); loadLearners(); }));
    }
    MGAEMS.initIcons();
  }

  function openProfile(id, trigger) {
    const modal = MGAEMS.openModal({ title: 'Learner profile', body: MGAEMS.loadingHTML('Loading learner profile…'), trigger });
    loadProfile(modal, id);
  }

  async function loadProfile(modal, id) {
    modal.body.innerHTML = MGAEMS.loadingHTML('Loading learner profile…');
    const [profile, history, sponsorship] = await Promise.all([
      MGAEMS.get(`/api/v1/students/${encodeURIComponent(id)}`),
      MGAEMS.get(`/api/v1/students/${encodeURIComponent(id)}/academic-history`),
      canWrite ? MGAEMS.get(`/api/v1/sponsorships?student_id=${encodeURIComponent(id)}`) : Promise.resolve(null),
    ]);
    if (modal.closed) return;
    if (!profile.ok) {
      modal.body.innerHTML = MGAEMS.errorHTML(profile.error) + '<button type="button" class="btn btn-secondary" data-retry>Try again</button>';
      modal.body.querySelector('[data-retry]').addEventListener('click', () => loadProfile(modal, id));
      MGAEMS.initIcons(); return;
    }
    const learner = profile.data;
    const tabs = [['overview', 'Overview'], ...(canWrite ? [['guardians', 'Guardians']] : []), ['history', 'Academic history'], ...(canWrite ? [['sponsorship', 'Sponsorship']] : [])];
    const historyRows = history.ok ? history.data.promotions_transfers : [];
    const latest = historyRows[0]?.effective_date || learner.admission_date;
    const overview = [['Admission number', learner.admission_no], ['Name', `${learner.first_name} ${learner.last_name}`], ['Gender', learner.gender], ['Date of birth', learner.date_of_birth], ['Admission date', learner.admission_date], [learner.status === 'active' ? 'Current class' : 'Recorded class', learner.school_class?.name || 'Unassigned'], ['Lifecycle status', learner.status]];
    modal.body.innerHTML = `<div class="tabs" role="tablist" aria-label="Learner profile sections">${tabs.map(([key, title], index) => `<button type="button" class="tab ${index === 0 ? 'active' : ''}" id="learnerTab_${key}" role="tab" aria-selected="${index === 0}" aria-controls="learnerPanel_${key}" tabindex="${index === 0 ? 0 : -1}" data-tab="${key}">${title}</button>`).join('')}</div>
      <section class="tab-panel active" id="learnerPanel_overview" role="tabpanel" aria-labelledby="learnerTab_overview"><dl class="detail-grid">${overview.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
      ${canWrite ? `<div class="form-actions"><button type="button" class="btn btn-secondary btn-sm" data-action="edit">Edit profile</button>${learner.status === 'active' ? '<button type="button" class="btn btn-secondary btn-sm" data-action="promote">Promote</button><button type="button" class="btn btn-secondary btn-sm" data-action="transfer_out">Transfer out</button><button type="button" class="btn btn-danger btn-sm" data-action="left">Mark as left</button>' : ['transferred', 'left'].includes(learner.status) ? '<button type="button" class="btn btn-secondary btn-sm" data-action="transfer_in">Transfer in</button>' : '<p class="text-muted">Promotion and transfer-out require an active enrollment.</p>'}</div>` : '<p class="text-muted">Guardian contact information and lifecycle changes are restricted to authorized school leadership.</p>'}
      <h3 class="profile-subsection">Related workflows</h3><p class="text-muted">Open the authoritative module to view or manage its records.</p><div class="form-actions"><a class="btn btn-secondary btn-sm" href="/attendance.html">Attendance</a><a class="btn btn-secondary btn-sm" href="/assessment.html">Assessment / report cards</a>${canWrite ? `<a class="btn btn-secondary btn-sm" href="/guardians.html?student_id=${encodeURIComponent(id)}">Parents / guardians</a><a class="btn btn-secondary btn-sm" href="/sponsorship.html">Sponsorship</a><a class="btn btn-secondary btn-sm" href="/reports.html">Reports</a>` : ''}</div></section>
      ${canWrite ? `<section class="tab-panel" id="learnerPanel_guardians" role="tabpanel" aria-labelledby="learnerTab_guardians" hidden>${learner.guardians?.length ? `<div class="record-list">${learner.guardians.map(guardian => `<div class="record-item"><div><strong>${esc(guardian.full_name)}</strong><span class="text-meta">${esc(guardian.relationship)}${guardian.is_primary_contact ? ' · Primary contact' : ''}</span><span class="text-meta">${esc(guardian.phone || 'No phone')}${guardian.email ? ' · ' + esc(guardian.email) : ''}</span></div></div>`).join('')}</div>` : MGAEMS.emptyStateHTML('No linked guardians', 'Use Parents / Guardians to manage contact records and optional portal accounts.', 'contact-round')}</section>` : ''}
      <section class="tab-panel" id="learnerPanel_history" role="tabpanel" aria-labelledby="learnerTab_history" hidden><p class="text-muted">${esc(learner.status === 'active' ? 'Current class' : 'Recorded class')}: ${esc(learner.school_class?.name || 'Unassigned')}. The records below retain earlier class placements.</p>${!history.ok ? MGAEMS.errorHTML(history.error) : !historyRows.length ? MGAEMS.emptyStateHTML('No promotion or transfer history', 'The admission class is shown in the overview.', 'history') : `<div class="table-scroll"><table><thead><tr><th scope="col">Date</th><th scope="col">Operation</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Term</th><th scope="col">Reason</th></tr></thead><tbody>${historyRows.map(record => `<tr><td>${esc(record.effective_date)}</td><td>${esc(record.type.replace(/_/g, ' '))}</td><td>${esc(record.from_class?.name || '—')}</td><td>${esc(record.to_class?.name || '—')}</td><td>${esc(record.term?.name || '—')}</td><td>${esc(record.reason || '—')}</td></tr>`).join('')}</tbody></table></div>`}</section>
      ${canWrite ? `<section class="tab-panel" id="learnerPanel_sponsorship" role="tabpanel" aria-labelledby="learnerTab_sponsorship" hidden>${!sponsorship.ok ? MGAEMS.errorHTML(sponsorship.error) : !sponsorship.data.length ? MGAEMS.emptyStateHTML('No learner-specific sponsorships', 'Individual and group sponsorships linked to this learner appear here.', 'heart-handshake') : `<div class="record-list">${sponsorship.data.map(item => `<div class="record-item"><div><strong>${esc(item.sponsor?.name || 'Sponsor')}</strong><span class="text-meta">${esc(item.sponsorship_type)} · ${esc(item.start_date)}${item.end_date ? ' – ' + esc(item.end_date) : ''}</span></div><span class="badge ${item.status === 'active' ? 'badge-green' : 'badge-gray'}">${esc(item.status)}</span></div>`).join('')}</div>`}</section>` : ''}`;
    initProfileTabs(modal);
    modal.body.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
      if (button.dataset.action === 'left') {
        if (!await MGAEMS.confirmAction('Mark learner as left', `Mark ${learner.first_name} ${learner.last_name} as left? This removes active enrollment; existing records remain.`, 'Mark as left')) return;
        modal.setBusy(true);
        const result = await MGAEMS.patch(`/api/v1/students/${learner.id}`, { status: 'left' });
        modal.setBusy(false);
        if (!result.ok) { MGAEMS.toast(Object.values(result.fields || {}).flat()[0] || result.error, 'error'); return; }
        MGAEMS.toast('Learner marked as left.', 'success'); loadProfile(modal, id); loadLearners();
      } else openLearnerForm(button.dataset.action, learner, button, modal, latest);
    }));
    if (!history.ok || (canWrite && !sponsorship.ok)) {
      const retry = document.createElement('button'); retry.className = 'btn btn-secondary btn-sm'; retry.type = 'button'; retry.textContent = 'Retry profile records';
      retry.addEventListener('click', () => loadProfile(modal, id)); modal.body.appendChild(retry);
    }
    MGAEMS.initIcons();
    if (document.activeElement === document.body) modal.body.querySelector('[role="tab"]')?.focus();
  }

  function initProfileTabs(modal) {
    const tabs = [...modal.body.querySelectorAll('[role="tab"]')];
    function activate(tab) {
      tabs.forEach(item => { const active = item === tab; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1; const panel = modal.body.querySelector('#' + item.getAttribute('aria-controls')); panel.hidden = !active; panel.classList.toggle('active', active); });
    }
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
    const modal = MGAEMS.openModal({ title: labels[mode], body: MGAEMS.loadingHTML('Loading form…'), trigger, footer: '<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="submit" form="learnerForm" class="btn btn-primary" data-submit disabled>Save</button>' });
    let terms = [];
    const placement = ['promote', 'transfer_in', 'transfer_out'].includes(mode);
    if (placement) {
      const result = await MGAEMS.get('/api/v1/terms');
      if (modal.closed) return;
      if (!result.ok || !result.data.length) { modal.body.innerHTML = result.ok ? MGAEMS.emptyStateHTML('No terms available', 'Configure an academic term before recording a class/transfer change.', 'calendar') : MGAEMS.errorHTML(result.error); MGAEMS.initIcons(); return; }
      terms = result.data.map(term => ({ id: term.id, name: `${term.name}${term.academic_year?.name ? ' · ' + term.academic_year.name : ''}` }));
    }
    if ((mode === 'register' || mode === 'promote' || mode === 'transfer_in') && !state.classes.length) {
      modal.body.innerHTML = MGAEMS.errorHTML('Real class choices are unavailable. Retry class choices on the learner page.'); return;
    }
    let contents;
    if (!placement) {
      contents = field('first_name', 'First name', 'text', learner?.first_name, 'maxlength="80"') + field('last_name', 'Last name', 'text', learner?.last_name, 'maxlength="80"') + field('date_of_birth', 'Date of birth', 'date', learner?.date_of_birth, `max="${esc(learner?.admission_date || today())}"`) + select('gender', 'Gender', options([{ id: 'male', name: 'Male' }, { id: 'female', name: 'Female' }], learner?.gender));
      if (mode === 'register') contents += select('class_id', 'Admission class', options(state.classes)) + field('admission_date', 'Admission date', 'date', today(), `max="${today()}"`);
    } else {
      contents = (mode !== 'transfer_out' ? select('to_class_id', mode === 'promote' ? 'Destination class' : 'Current class on return', options(state.classes.filter(item => mode !== 'promote' || Number(item.id) !== Number(learner.class_id)))) : '') + select('term_id', 'Academic term', options(terms)) + field('effective_date', 'Effective date', 'date', today(), `min="${esc(minimumDate)}" max="${today()}"`) + '<div class="field full"><label for="learner_reason">Reason (optional)</label><input id="learner_reason" name="reason" maxlength="255"></div>';
    }
    modal.body.innerHTML = `<form id="learnerForm"><div data-form-error></div><p class="text-muted">${mode === 'register' ? 'The admission number is generated by the school system. Link guardian records separately in Parents / Guardians.' : mode === 'edit' ? 'Class changes use Promotion or Transfer. Admission details remain unchanged.' : 'This operation records an immutable class/transfer history entry.'}</p><div class="form-grid">${contents}</div></form>`;
    const form = modal.body.querySelector('form');
    const submit = modal.overlay.querySelector('[data-submit]'); submit.disabled = false; submit.textContent = labels[mode];
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
      if (mode === 'transfer_out' && !await MGAEMS.confirmAction('Confirm transfer out', `Transfer ${learner.first_name} ${learner.last_name} out of the school? Active enrollment will end; existing records remain.`, 'Transfer out')) { submitting = false; return; }
      modal.setBusy(true); submit.textContent = 'Saving…';
      const result = mode === 'register' ? await MGAEMS.post('/api/v1/students', payload) : mode === 'edit' ? await MGAEMS.patch(`/api/v1/students/${learner.id}`, payload) : await MGAEMS.post(`/api/v1/students/${learner.id}/${mode === 'promote' ? 'promote' : 'transfer'}`, payload);
      modal.setBusy(false); submitting = false; submit.textContent = labels[mode];
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
