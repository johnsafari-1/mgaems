/* Visitor directory and registration retain the existing read/create API contract. */
(() => {
  const user = MGAEMS.requireAuth();
  const readRoles = ['system_admin', 'head_teacher', 'deputy_head_teacher', 'sponsor_coordinator'];
  const writeRoles = ['system_admin', 'head_teacher', 'deputy_head_teacher'];
  if (!user) return;
  if (!readRoles.includes(user.role)) { window.location.href = '/dashboard.html'; return; }
  renderAppShell('/visitors.html');
  MGAEMS.initSidebar();
  const canRegister = writeRoles.includes(user.role);
  const esc = MGAEMS.escapeHTML;
  const $ = id => document.getElementById(id);
  const identity = () => JSON.stringify([localStorage.getItem('mgaems_token'), MGAEMS.currentUser()?.id, MGAEMS.currentUser()?.role]);
  const initialIdentity = identity();
  const current = () => identity() === initialIdentity && window.location.pathname === '/visitors.html';
  const types = { visitor: 'Visitor', church_team: 'Church team', mission_group: 'Mission group', volunteer: 'Volunteer', donor: 'Donor' };
  const badges = { visitor: 'badge-navy', church_team: 'badge-amber', mission_group: 'badge-navy', volunteer: 'badge-green', donor: 'badge-gray' };
  const state = { visitors: [], phase: 'loading', search: '', type: '', from: '', to: '', loadRevision: 0, modal: null };
  const day = value => {
    if (value == null || value === '') return null;
    const date = MGAEMS.schoolDate(value);
    if (!date || !Number.isFinite(new Date(date + 'T00:00:00Z').getTime())) return null;
    return date;
  };
  const validRows = value => Array.isArray(value) && value.every(row => row && typeof row === 'object' && !Array.isArray(row) && Number.isSafeInteger(Number(row.id)) && Number(row.id) > 0);
  const readableDate = value => {
    const date = day(value);
    if (!date) return 'Not recorded';
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date + 'T00:00:00Z'));
  };
  const readableTime = value => {
    if (!value || !Number.isFinite(new Date(value).getTime())) return 'Not recorded';
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  };
  const hostName = visitor => visitor.host_staff ? `${visitor.host_staff.first_name || ''} ${visitor.host_staff.last_name || ''}`.trim() || 'Host name unavailable' : 'Host name unavailable';
  const typeOptions = all => `${all ? '<option value="">All visitor types</option>' : ''}${Object.entries(types).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}`;

  $('appMain').innerHTML = `<div class="visitor-workspace">
    <div class="section-header visitor-heading"><div><h1>Visitor management</h1><p>Review school visits, their purpose and the Staff member hosting each visit.</p></div>${canRegister ? '<button class="btn btn-primary" type="button" id="registerVisitor"><i data-lucide="user-round-plus" aria-hidden="true"></i> Register visitor</button>' : '<span class="badge badge-gray">Read-only access</span>'}</div>
    <div class="visitor-summary" aria-label="Visitor register totals">
      <div class="card stat-card"><div class="num" id="todayVisitors">—</div><div class="label">Visits today · Nairobi</div></div>
      <div class="card stat-card"><div class="num" id="totalVisitors">—</div><div class="label">All visitor records</div></div>
      <div class="card stat-card"><div class="num" id="volunteerVisitors">—</div><div class="label">Volunteer visits</div></div>
    </div>
    <p class="visitor-note">${canRegister ? 'Use the register to record a visitor’s visit date, purpose and host Staff member.' : 'You can browse visitor records and visit details. Registration is available to authorized school administrators and leadership.'}</p>
    <section class="card visitor-register" aria-labelledby="visitorRegisterHeading"><h2 id="visitorRegisterHeading">Visitor register</h2>
      <div class="visitor-toolbar">
        <div class="field"><label for="visitorSearch">Search records</label><input type="search" id="visitorSearch" placeholder="Visitor, purpose, host or notes"></div>
        <div class="field"><label for="visitorTypeFilter">Visitor type</label><select id="visitorTypeFilter">${typeOptions(true)}</select></div>
        <div class="field"><label for="visitorFrom">Visits from</label><input type="date" id="visitorFrom"></div>
        <div class="field"><label for="visitorTo">Visits through</label><input type="date" id="visitorTo" aria-describedby="visitorFilterFeedback"></div>
        <button class="btn btn-secondary" id="clearVisitorFilters" type="button"><i data-lucide="filter-x" aria-hidden="true"></i> Clear filters</button>
      </div>
      <div id="visitorFilterFeedback" class="visitor-filter-feedback" role="alert"></div>
      <p id="visitorResultCount" class="visitor-result-count" role="status">Loading visitor records…</p>
      <div id="visitorTable" aria-busy="true">${MGAEMS.loadingHTML('Loading visitor register…')}</div>
    </section>
  </div>`;
  if (canRegister) $('registerVisitor').addEventListener('click', openRegisterForm);
  for (const [id, key, event] of [['visitorSearch', 'search', 'input'], ['visitorTypeFilter', 'type', 'change'], ['visitorFrom', 'from', 'change'], ['visitorTo', 'to', 'change']]) {
    $(id).addEventListener(event, () => {
      state[key] = key === 'search' ? $(id).value.trim().toLowerCase() : $(id).value;
      if (state.phase === 'ready') renderVisitors();
    });
  }
  $('clearVisitorFilters').addEventListener('click', () => {
    for (const [id, key] of [['visitorSearch', 'search'], ['visitorTypeFilter', 'type'], ['visitorFrom', 'from'], ['visitorTo', 'to']]) { $(id).value = ''; state[key] = ''; }
    if (state.phase === 'ready') renderVisitors();
    $('visitorSearch').focus();
  });
  MGAEMS.initIcons();

  async function loadVisitors() {
    const revision = ++state.loadRevision;
    state.phase = 'loading';
    $('visitorTable').setAttribute('aria-busy', 'true');
    $('visitorTable').innerHTML = MGAEMS.loadingHTML('Loading visitor register…');
    $('visitorResultCount').textContent = 'Loading visitor records…';
    $('visitorFilterFeedback').innerHTML = '';
    updateSummary();
    const result = await MGAEMS.get('/api/v1/visitors');
    if (!current() || revision !== state.loadRevision) return;
    $('visitorTable').setAttribute('aria-busy', 'false');
    if (!result.ok || !validRows(result.data)) {
      state.phase = 'error'; state.visitors = [];
      $('visitorResultCount').textContent = 'Visitor records unavailable';
      $('visitorTable').innerHTML = `${MGAEMS.errorHTML(result.error || 'The visitor register could not be loaded.')}<button class="btn btn-secondary" type="button" id="retryVisitors"><i data-lucide="refresh-cw" aria-hidden="true"></i> Retry</button>`;
      $('retryVisitors').addEventListener('click', loadVisitors);
      updateSummary(); MGAEMS.initIcons(); return;
    }
    state.visitors = result.data; state.phase = 'ready';
    updateSummary(); renderVisitors();
  }

  function updateSummary() {
    const available = state.phase === 'ready';
    $('todayVisitors').textContent = available ? String(state.visitors.filter(visitor => day(visitor.visit_date) === MGAEMS.schoolDate()).length) : '—';
    $('totalVisitors').textContent = available ? String(state.visitors.length) : '—';
    $('volunteerVisitors').textContent = available ? String(state.visitors.filter(visitor => visitor.visitor_type === 'volunteer').length) : '—';
  }

  function filteredVisitors() {
    return state.visitors.filter(visitor => {
      const visitDay = day(visitor.visit_date);
      if (state.type && visitor.visitor_type !== state.type) return false;
      if (state.from && (!visitDay || visitDay < state.from)) return false;
      if (state.to && (!visitDay || visitDay > state.to)) return false;
      return !state.search || [visitor.visitor_name, visitor.purpose, visitor.notes, hostName(visitor), types[visitor.visitor_type]]
        .some(value => String(value || '').toLowerCase().includes(state.search));
    }).sort((a, b) => (day(b.visit_date) || '').localeCompare(day(a.visit_date) || '') || Number(b.id) - Number(a.id));
  }

  function renderVisitors() {
    const invalidRange = Boolean(state.from && state.to && state.from > state.to);
    $('visitorTo').setAttribute('aria-invalid', String(invalidRange));
    $('visitorFilterFeedback').innerHTML = invalidRange ? MGAEMS.errorHTML('The through date must be on or after the from date.') : '';
    const list = invalidRange ? [] : filteredVisitors();
    const filtered = Boolean(state.search || state.type || state.from || state.to);
    $('visitorResultCount').textContent = invalidRange ? 'Check the date range' : `${list.length} of ${state.visitors.length} visitor record${state.visitors.length === 1 ? '' : 's'} shown`;
    if (!list.length) {
      $('visitorTable').innerHTML = MGAEMS.emptyStateHTML(invalidRange ? 'Choose a valid date range' : filtered ? 'No visits match these filters' : 'No visitor records yet',
        invalidRange || filtered ? 'Adjust the search, visitor type or dates, or clear the filters.' : canRegister ? 'Register a visitor to start the school visitor register.' : 'Registered school visits will appear here when available.', 'clipboard-list');
      MGAEMS.initIcons(); return;
    }
    $('visitorTable').innerHTML = `<div class="visitor-table-wrap"><table class="visitor-table"><caption class="sr-only">Visitor records with purpose, host and visit date. Use View details to read the complete record.</caption>
      <thead><tr><th scope="col">Visitor</th><th scope="col">Type</th><th scope="col">Purpose</th><th scope="col">Host Staff</th><th scope="col">Visit date</th><th scope="col">Details</th></tr></thead>
      <tbody>${list.map(visitor => `<tr>
        <td data-label="Visitor"><strong>${esc(visitor.visitor_name)}</strong><small>Recorded ${esc(readableTime(visitor.created_at))} · Nairobi</small></td>
        <td data-label="Type"><span class="badge ${badges[visitor.visitor_type] || 'badge-gray'}">${esc(types[visitor.visitor_type] || visitor.visitor_type || 'Not specified')}</span></td>
        <td data-label="Purpose" class="visitor-purpose">${esc(visitor.purpose || 'Not recorded')}</td>
        <td data-label="Host Staff">${esc(hostName(visitor))}</td>
        <td data-label="Visit date" class="visitor-date">${esc(readableDate(visitor.visit_date))}</td>
        <td><button class="btn btn-secondary btn-sm" type="button" data-visitor="${esc(visitor.id)}" aria-label="View details for ${esc(visitor.visitor_name)}"><i data-lucide="eye" aria-hidden="true"></i> View details</button></td>
      </tr>`).join('')}</tbody></table></div>`;
    $('visitorTable').querySelectorAll('[data-visitor]').forEach(button => button.addEventListener('click', () => {
      if (!current()) return;
      const visitor = state.visitors.find(record => String(record.id) === button.dataset.visitor);
      if (visitor) showDetails(visitor, button);
    }));
    MGAEMS.initIcons();
  }

  function showDetails(visitor, trigger) {
    if (state.modal && !state.modal.closed) return;
    const modal = MGAEMS.openModal({ title: 'Visit details', trigger,
      body: `<dl class="visitor-detail-grid"><div><dt>Visitor</dt><dd>${esc(visitor.visitor_name)}</dd></div><div><dt>Visitor type</dt><dd>${esc(types[visitor.visitor_type] || visitor.visitor_type)}</dd></div><div><dt>Host Staff</dt><dd>${esc(hostName(visitor))}</dd></div><div><dt>Visit date</dt><dd>${esc(readableDate(visitor.visit_date))}</dd></div><div><dt>Recorded · Nairobi</dt><dd>${esc(readableTime(visitor.created_at))}</dd></div><div><dt>Last updated · Nairobi</dt><dd>${esc(readableTime(visitor.updated_at))}</dd></div><div class="full"><dt>Purpose</dt><dd>${esc(visitor.purpose || 'Not recorded')}</dd></div><div class="full"><dt>Notes</dt><dd class="visitor-notes">${esc(visitor.notes || 'No notes recorded.')}</dd></div></dl>`,
      footer: '<button class="btn btn-secondary" type="button" data-dialog-close>Close details</button>', onClose: () => { if (state.modal === modal) state.modal = null; } });
    state.modal = modal;
    modal.overlay.setAttribute('class', 'modal-overlay visitor-dialog');
  }

  async function openRegisterForm() {
    if (!canRegister || !current() || state.modal && !state.modal.closed) return;
    const modal = MGAEMS.openModal({ title: 'Register visitor', trigger: $('registerVisitor'), body: MGAEMS.loadingHTML('Loading host Staff choices…'),
      footer: '<button class="btn btn-secondary" type="button" data-dialog-close>Cancel</button><button class="btn btn-primary" type="submit" form="visitorForm" id="saveVisitor" disabled>Register visit</button>',
      onClose: () => { if (state.modal === modal) state.modal = null; } });
    state.modal = modal; modal.overlay.setAttribute('class', 'modal-overlay visitor-dialog');
    let hostRevision = 0;
    async function loadHosts() {
      const revision = ++hostRevision;
      modal.body.innerHTML = MGAEMS.loadingHTML('Loading host Staff choices…');
      const result = await MGAEMS.get('/api/v1/staff?status=active');
      if (modal.closed || state.modal !== modal || revision !== hostRevision || !current()) return;
      if (!result.ok || !validRows(result.data)) {
        modal.body.innerHTML = `${MGAEMS.errorHTML(result.error || 'Host Staff choices could not be loaded.')}<button class="btn btn-secondary" type="button" id="retryVisitorHosts">Retry host Staff</button>`;
        $('retryVisitorHosts').addEventListener('click', loadHosts); MGAEMS.initIcons(); return;
      }
      const hosts = [...result.data].sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`));
      modal.body.innerHTML = `<form id="visitorForm"><div data-form-error id="visitorFormAlert"></div>
        <p class="visitor-form-note">Fields marked * are required. Dates follow the school’s Nairobi calendar.</p>
        <fieldset class="visitor-form-group"><legend>Visitor</legend><div class="form-grid">
          <div class="field"><label for="visitorName">Visitor name *</label><input type="text" id="visitorName" name="visitor_name" maxlength="150" autocomplete="name" required></div>
          <div class="field"><label for="visitorType">Visitor type *</label><select id="visitorType" name="visitor_type" required>${typeOptions(false)}</select></div>
        </div></fieldset>
        <fieldset class="visitor-form-group"><legend>Visit arrangements</legend><div class="form-grid">
          <div class="field"><label for="visitorHostStaff">Host Staff *</label><select id="visitorHostStaff" name="host_staff_id" aria-describedby="visitorHostHint" required ${hosts.length ? '' : 'disabled'}><option value="">Select a host Staff member</option>${hosts.map(staff => `<option value="${esc(staff.id)}">${esc(staff.last_name)}, ${esc(staff.first_name)}${staff.role_title ? ` · ${esc(staff.role_title)}` : ''}</option>`).join('')}</select><p class="visitor-form-note" id="visitorHostHint">${hosts.length ? 'Choose the active Staff member responsible for this visit.' : 'No active Staff members are available. Registration requires an available host.'}</p></div>
          <div class="field"><label for="visitorDate">Visit date *</label><input type="date" id="visitorDate" name="visit_date" value="${MGAEMS.schoolDate()}" required></div>
          <div class="field full"><label for="visitorPurpose">Purpose</label><input type="text" id="visitorPurpose" name="purpose" maxlength="255"></div>
          <div class="field full"><label for="visitorNotes">Notes</label><textarea id="visitorNotes" name="notes" rows="4"></textarea></div>
        </div></fieldset></form>`;
      const form = $('visitorForm'); const save = $('saveVisitor');
      save.disabled = !hosts.length;
      $('visitorName').focus();
      let busy = false;
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || modal.closed || !canRegister || !current()) return;
        const payload = { visitor_name: $('visitorName').value.trim(), visitor_type: $('visitorType').value, host_staff_id: Number($('visitorHostStaff').value), visit_date: $('visitorDate').value, purpose: $('visitorPurpose').value.trim() || null, notes: $('visitorNotes').value.trim() || null };
        const fields = {};
        if (!payload.visitor_name || payload.visitor_name.length > 150) fields.visitor_name = ['Enter a visitor name of up to 150 characters.'];
        if (!Object.hasOwn(types, payload.visitor_type)) fields.visitor_type = ['Select an available visitor type.'];
        if (!Number.isInteger(payload.host_staff_id) || !hosts.some(host => Number(host.id) === payload.host_staff_id)) fields.host_staff_id = ['Select an available host Staff member.'];
        const date = new Date(payload.visit_date + 'T00:00:00Z');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.visit_date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== payload.visit_date) fields.visit_date = ['Choose a valid visit date.'];
        if (payload.purpose && payload.purpose.length > 255) fields.purpose = ['Keep the purpose within 255 characters.'];
        if (Object.keys(fields).length) { MGAEMS.showFormErrors(form, { error: 'Review the highlighted visit details.', fields }); return; }
        if (!form.reportValidity()) return;
        busy = true; modal.setBusy(true);
        const controls = [...form.elements].filter(control => ['input', 'select', 'textarea'].includes(control.tagName?.toLowerCase() || control.tag));
        const disabled = controls.map(control => [control, control.disabled]);
        disabled.forEach(([control]) => { control.disabled = true; });
        save.textContent = 'Confirming…';
        const accepted = await MGAEMS.confirmAction('Register this visit?', `${payload.visitor_name} · ${types[payload.visitor_type]} · ${readableDate(payload.visit_date)}. Confirm the visitor and host details before recording the visit.`, 'Register visit');
        if (accepted && current() && !modal.closed && state.modal === modal) {
          save.textContent = 'Registering…';
          const result = await MGAEMS.post('/api/v1/visitors', payload);
          if (!current() || modal.closed || state.modal !== modal) { modal.setBusy(false); modal.close(); return; }
          if (result.ok) {
            modal.setBusy(false); modal.close();
            MGAEMS.toast('Visitor registered. The register is refreshing.', 'success');
            await loadVisitors(); return;
          }
          MGAEMS.showFormErrors(form, result);
        }
        modal.setBusy(false); disabled.forEach(([control, value]) => { control.disabled = value; });
        busy = false; save.textContent = 'Register visit';
      });
      MGAEMS.initIcons();
    }
    await loadHosts();
  }
  loadVisitors();
})();
