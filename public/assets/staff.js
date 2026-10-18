/* Staff records and account links have separate permissions and workflows. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user) return;
  renderAppShell('/staff.html');
  const canCreate = ['system_admin', 'head_teacher'].includes(user.role);
  const canManage = ['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(user.role);
  const initialToken = localStorage.getItem('mgaems_token');
  const initialIdentity = JSON.stringify([user.id ?? null, user.username ?? null, user.role]);
  const main = document.getElementById('appMain');
  main.setAttribute('class', 'app-main staff-workspace');
  if (!canManage) {
    main.innerHTML = MGAEMS.errorHTML('Staff information is available only to authorized school administration.');
    MGAEMS.initIcons();
    return;
  }
  const esc = MGAEMS.escapeHTML;
  const state = { staff: null, departments: null, request: 0, profileRequest: 0, profile: null, profileData: null, activeTab: 'details', creating: false, denied: false };
  function authorized() {
    const current = MGAEMS.currentUser();
    if (!state.denied && initialToken && localStorage.getItem('mgaems_token') === initialToken && current && JSON.stringify([current.id ?? null, current.username ?? null, current.role]) === initialIdentity && window.location.pathname === '/staff.html') return true;
    state.staff = null; state.departments = null; state.profileData = null;
    main.innerHTML = MGAEMS.errorHTML('Your session changed. Reopen Staff from your authorized workspace.');
    if (state.profile && !state.profile.closed) state.profile.body.innerHTML = MGAEMS.errorHTML('This staff profile is no longer available to this session.');
    return false;
  }
  const validId = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validDepartment = value => object(value) && validId(value.id) && typeof value.name === 'string';
  const validStaff = value => object(value) && validId(value.id) && typeof value.first_name === 'string' && typeof value.last_name === 'string' && ['teaching', 'non_teaching'].includes(value.staff_type) && ['active', 'on_leave', 'terminated'].includes(value.status) && (value.department == null || validDepartment(value.department));
  function profileData(value) {
    if (!validStaff(value)) return null;
    const records = { qualifications: item => typeof item.qualification === 'string', emergency_contacts: item => typeof item.full_name === 'string' && typeof item.phone === 'string', documents: item => typeof item.doc_type === 'string' };
    const result = { ...value };
    for (const [key, validate] of Object.entries(records)) {
      const rows = value[key] === undefined ? [] : value[key];
      if (!Array.isArray(rows) || !rows.every(item => object(item) && validId(item.id) && validate(item))) return null;
      result[key] = rows;
    }
    return result;
  }
  const label = value => value ? String(value).replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase()) : 'Not recorded';
  const employmentBadge = status => `<span class="badge ${{ active: 'badge-green', on_leave: 'badge-amber', terminated: 'badge-red' }[status] || 'badge-gray'}">${esc(label(status))}</span>`;
  const staffName = person => [person.first_name, person.last_name].filter(Boolean).join(' ');
  const dayValue = value => value == null || value === '' ? '' : MGAEMS.schoolDate(value) || '';
  const date = value => {
    const day = dayValue(value);
    if (!day || !Number.isFinite(new Date(day + 'T12:00:00Z').getTime())) return 'Not recorded';
    return `<time datetime="${esc(day)}">${esc(new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' }).format(new Date(day + 'T12:00:00Z')))}</time>`;
  };
  const field = (key, text, value = '', required = false, extra = '', scope = 'staff') => `<div class="field"><label for="${scope}_${key}">${esc(text)}${required ? ' *' : ''}</label><input id="${scope}_${key}" name="${key}" value="${esc(value)}" ${required ? 'required' : ''} ${extra}></div>`;
  const select = (key, text, options, required = false) => `<div class="field"><label for="staff_${key}">${esc(text)}${required ? ' *' : ''}</label><select id="staff_${key}" name="${key}" ${required ? 'required' : ''}>${options}</select></div>`;
  const group = (title, body) => `<fieldset class="staff-form-group"><legend>${esc(title)}</legend><div class="form-grid">${body}</div></fieldset>`;
  const options = (values, selected = '', placeholder = null) => `${placeholder == null ? '' : `<option value="">${esc(placeholder)}</option>`}${values.map(([value, text]) => `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(text)}</option>`).join('')}`;
  const departmentOptions = selected => options((state.departments || []).map(department => [department.id, department.name]), selected, 'No department');
  const action = (name, text, icon, extra = '') => `<button type="button" class="btn btn-secondary btn-sm" data-staff-action="${name}" ${extra}>${icon ? `<i data-lucide="${icon}" aria-hidden="true"></i>` : ''}${esc(text)}</button>`;
  const values = form => Object.fromEntries([...form.elements].filter(control => control.name && !control.disabled).map(control => [control.name, control.value.trim()]));
  const alive = (handle, id) => authorized() && !handle.closed && state.profile === handle && String(state.profileData?.id) === String(id);
  const formError = (form, message, fields = {}) => MGAEMS.showFormErrors(form, { error: message, fields });
  const accessDenied = result => result.status === 401 || result.status === 403;
  function submissionError(handle, form, result) {
    if (accessDenied(result)) {
      state.denied = true; authorized();
      handle.body.innerHTML = MGAEMS.errorHTML('You are no longer authorized to manage this staff information.');
      handle.overlay.querySelectorAll('[type="submit"]').forEach(button => { button.disabled = true; });
    } else MGAEMS.showFormErrors(form, result);
  }
  const setBusy = (handle, value) => {
    if (handle.staffBusy === value) return;
    handle.staffBusy = value;
    if (value) {
      handle.staffControls = [...handle.overlay.querySelectorAll('input, select, textarea')].map(control => [control, control.disabled]);
      handle.staffControls.forEach(([control]) => { control.disabled = true; });
    } else (handle.staffControls || []).forEach(([control, disabled]) => { control.disabled = disabled; });
    handle.setBusy(value);
  };
  const missing = (payload, keys) => keys.filter(key => !payload[key]);
  const validateEmployment = (form, payload, edit = false) => {
    const absent = missing(payload, ['first_name', 'last_name', 'staff_type', 'role_title', 'employment_date']);
    const fields = Object.fromEntries(absent.map(key => [key, ['This field is required.']]));
    if (!['teaching', 'non_teaching'].includes(payload.staff_type)) fields.staff_type = ['Select Teaching or Non-Teaching.'];
    if (edit && !['active', 'on_leave', 'terminated'].includes(payload.status)) fields.status = ['Select a valid employment status.'];
    const parsedDay = new Date(payload.employment_date + 'T12:00:00Z');
    if (payload.employment_date && (!/^\d{4}-\d{2}-\d{2}$/.test(payload.employment_date) || !Number.isFinite(parsedDay.getTime()) || parsedDay.toISOString().slice(0, 10) !== payload.employment_date)) fields.employment_date = ['Enter a valid employment date.'];
    if (Object.keys(fields).length) { formError(form, 'Check the required staff details.', fields); return false; }
    return true;
  };
  const employmentPayload = form => {
    const data = values(form);
    return { first_name: data.first_name, last_name: data.last_name, staff_type: data.staff_type, role_title: data.role_title, department_id: data.department_id || null, phone: data.phone || null, employment_date: data.employment_date, contract_type: data.contract_type || null, ...(data.status ? { status: data.status } : {}) };
  };

  main.innerHTML = `<div class="section-header staff-heading"><div><p class="eyebrow">School administration</p><h1>Staff &amp; HR</h1><p class="text-muted">Teaching and non-teaching staff, employment details and emergency contacts.</p></div>${canCreate ? '<button type="button" class="btn btn-primary" id="addStaff" disabled><i data-lucide="user-plus" aria-hidden="true"></i>Add Staff</button>' : '<span class="badge badge-gray">Existing staff management</span>'}</div>
  <p class="staff-policy-note">Staff records do not create system accounts. Account links remain a separate System Administrator workflow.</p>
  <div class="staff-stats" id="staffStats" aria-label="Staff directory totals">${['Total staff', 'Teaching', 'Non-teaching', 'Active employment'].map(text => `<div class="card stat-card"><div class="num" data-staff-count>—</div><div class="label">${text}</div></div>`).join('')}</div>
  <section class="card staff-list-card" aria-labelledby="staffDirectoryHeading"><div class="staff-panel-heading"><div><h2 id="staffDirectoryHeading">Staff directory</h2><p class="text-muted">Open a profile to review or manage the information on record.</p></div><span id="staffResultCount" class="text-muted" aria-live="polite"></span></div>
  <div class="staff-toolbar"><div class="field"><label for="staffSearch">Search staff</label><input id="staffSearch" type="search" placeholder="Name, job title, department or phone"></div><div class="field"><label for="staffTypeFilter">Staff type</label><select id="staffTypeFilter"><option value="">All types</option><option value="teaching">Teaching</option><option value="non_teaching">Non-Teaching</option></select></div><div class="field"><label for="staffStatusFilter">Employment status</label><select id="staffStatusFilter"><option value="">All statuses</option><option value="active">Active</option><option value="on_leave">On Leave</option><option value="terminated">Terminated</option></select></div>${action('clear', 'Clear filters', 'filter-x')}</div>
  <div id="staffDirectoryNotice" role="status"></div><div id="staffTable" aria-live="polite">${MGAEMS.loadingHTML('Loading staff directory…')}</div></section>`;
  const table = document.getElementById('staffTable');
  document.getElementById('addStaff')?.addEventListener('click', openCreate);
  for (const id of ['staffSearch', 'staffTypeFilter', 'staffStatusFilter']) document.getElementById(id).addEventListener(id === 'staffSearch' ? 'input' : 'change', renderList);
  main.addEventListener('click', event => {
    const button = event.target.closest('[data-staff-action]');
    if (!button || button.disabled || !authorized()) return;
    if (button.dataset.staffAction === 'profile') openProfile(button.dataset.id, button);
    if (button.dataset.staffAction === 'retry') loadPage();
    if (button.dataset.staffAction === 'clear') {
      for (const id of ['staffSearch', 'staffTypeFilter', 'staffStatusFilter']) document.getElementById(id).value = '';
      renderList(); document.getElementById('staffSearch').focus();
    }
  });
  MGAEMS.initIcons();
  window.addEventListener('storage', event => { if (event.key === null || ['mgaems_token', 'mgaems_user'].includes(event.key)) authorized(); });

  async function loadPage() {
    if (!authorized()) return;
    const request = ++state.request;
    state.staff = null;
    document.getElementById('staffResultCount').textContent = '';
    document.querySelectorAll('#staffStats [data-staff-count]').forEach(item => { item.textContent = '—'; });
    document.getElementById('addStaff')?.setAttribute('disabled', '');
    table.innerHTML = MGAEMS.loadingHTML('Loading staff directory…');
    const [people, departments] = await Promise.all([MGAEMS.get('/api/v1/staff'), MGAEMS.get('/api/v1/departments')]);
    if (!authorized() || request !== state.request) return;
    if (accessDenied(people) || accessDenied(departments)) { state.denied = true; authorized(); return; }
    state.departments = departments.ok && Array.isArray(departments.data) && departments.data.every(validDepartment) ? departments.data : null;
    const notice = document.getElementById('staffDirectoryNotice');
    notice.innerHTML = state.departments === null ? `${MGAEMS.errorHTML(departments.error || 'Department options are unavailable. Staff details cannot be edited until these options load.')}${action('retry', 'Retry directory', 'refresh-cw')}` : '';
    if (!people.ok || !Array.isArray(people.data) || !people.data.every(validStaff)) {
      state.staff = null;
      document.getElementById('staffResultCount').textContent = '';
      document.querySelectorAll('#staffStats [data-staff-count]').forEach(item => { item.textContent = 'Not available'; });
      table.innerHTML = `${MGAEMS.errorHTML(people.error || 'The staff directory could not be loaded.')}${action('retry', 'Try again', 'refresh-cw')}`;
    } else {
      state.staff = people.data;
      const counts = [state.staff.length, state.staff.filter(person => person.staff_type === 'teaching').length, state.staff.filter(person => person.staff_type === 'non_teaching').length, state.staff.filter(person => person.status === 'active').length];
      document.querySelectorAll('#staffStats [data-staff-count]').forEach((item, index) => { item.textContent = counts[index]; });
      const add = document.getElementById('addStaff'); if (add) add.disabled = state.departments === null;
      renderList();
    }
    MGAEMS.initIcons();
  }
  function renderList() {
    if (!authorized() || state.staff === null) return;
    const query = document.getElementById('staffSearch').value.trim().toLowerCase(), type = document.getElementById('staffTypeFilter').value, status = document.getElementById('staffStatusFilter').value;
    const rows = state.staff.filter(person => (!query || [staffName(person), person.role_title, person.phone, person.department?.name].join(' ').toLowerCase().includes(query)) && (!type || person.staff_type === type) && (!status || person.status === status));
    document.getElementById('staffResultCount').textContent = `${rows.length} of ${state.staff.length} staff shown`;
    if (!rows.length) {
      table.innerHTML = MGAEMS.emptyStateHTML(query || type || status ? 'No staff match these filters' : 'No staff records available', query || type || status ? 'Change the search or clear filters to see more staff.' : canCreate ? 'Add Staff when you are ready to register an existing staff member.' : 'Registered staff will appear here.', 'briefcase');
    } else table.innerHTML = `<div class="table-scroll staff-table-scroll"><table class="staff-table"><caption class="sr-only">Staff directory with employment status and profile actions</caption><thead><tr><th scope="col">Staff member</th><th scope="col">Type</th><th scope="col">Role &amp; department</th><th scope="col">Contact</th><th scope="col">Employment</th><th scope="col">Status</th><th scope="col">Profile</th></tr></thead><tbody>${rows.map(person => `<tr><td data-label="Staff member"><strong>${esc(staffName(person))}</strong><span class="staff-meta">${person.user_id ? 'Account linked' : 'No account linked'}</span></td><td data-label="Type"><span class="badge ${person.staff_type === 'teaching' ? 'staff-type-teaching' : 'badge-gray'}">${esc(label(person.staff_type))}</span></td><td data-label="Role & department"><strong>${esc(person.role_title || 'Not recorded')}</strong><span class="staff-meta">${esc(person.department?.name || 'No department')}</span></td><td data-label="Contact">${esc(person.phone || 'Not recorded')}</td><td data-label="Employment">${esc(person.contract_type || 'Contract not recorded')}<span class="staff-meta">Since ${date(person.employment_date)}</span></td><td data-label="Status">${employmentBadge(person.status)}</td><td data-label="Profile">${action('profile', 'View profile', 'user-round', `data-id="${esc(person.id)}" aria-label="View profile for ${esc(staffName(person))}"`)}</td></tr>`).join('')}</tbody></table></div>`;
    MGAEMS.initIcons();
  }
  function employmentFields(person = null) {
    return group('Staff identity', field('first_name', 'First name', person?.first_name, true, 'maxlength="80" autocomplete="given-name"') + field('last_name', 'Last name', person?.last_name, true, 'maxlength="80" autocomplete="family-name"') + select('staff_type', 'Staff type', options([['teaching', 'Teaching'], ['non_teaching', 'Non-Teaching']], person?.staff_type, person ? null : 'Select a type'), true) + field('role_title', 'Role / job title', person?.role_title, true, 'maxlength="60"')) +
      group('Employment & contact', select('department_id', 'Department', departmentOptions(person?.department_id)) + field('phone', 'Phone', person?.phone, false, 'type="tel" maxlength="20" autocomplete="tel"') + field('employment_date', 'Employment date', dayValue(person?.employment_date), true, 'type="date"') + field('contract_type', 'Contract type', person?.contract_type, false, 'maxlength="40" placeholder="For example, Permanent"') + (person ? select('status', 'Employment status', options([['active', 'Active'], ['on_leave', 'On Leave'], ['terminated', 'Terminated']], person.status), true) : ''));
  }
  function openCreate() {
    if (!authorized() || !canCreate || state.departments === null || state.creating || state.profile?.staffBusy) return;
    state.creating = true;
    let sequence = 0, saving = false;
    const handle = MGAEMS.openModal({ title: 'Add Staff', body: `<form id="staffCreateForm"><div data-form-error role="alert"></div><p class="staff-form-note">Required fields are marked *. This creates a Staff record only, with Active employment status.</p>${employmentFields()}<fieldset class="staff-form-group"><legend>Qualifications (optional)</legend><p class="text-muted">Add a qualification only when its details are available.</p><div id="staffNewQualifications"></div>${action('add-qualification', 'Add qualification', 'plus')}</fieldset><fieldset class="staff-form-group"><legend>Emergency contacts (optional)</legend><div id="staffNewContacts"></div>${action('add-contact', 'Add emergency contact', 'plus')}</fieldset></form>`, footer: '<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="submit" form="staffCreateForm" class="btn btn-primary" id="staffCreateSave">Save Staff</button>', onClose: () => { state.creating = false; } });
    const form = handle.body.querySelector('form');
    handle.body.addEventListener('click', event => {
      const button = event.target.closest('[data-staff-action]');
      if (!button || saving) return;
      const kind = button.dataset.staffAction;
      if (kind === 'remove-row') { button.closest('[data-extra-kind]').remove(); return; }
      if (!['add-qualification', 'add-contact'].includes(kind)) return;
      const qualification = kind === 'add-qualification', index = ++sequence, prefix = `${qualification ? 'qualification' : 'contact'}_${index}`;
      const row = document.createElement('fieldset');
      row.setAttribute('data-extra-kind', qualification ? 'qualification' : 'contact'); row.setAttribute('class', 'staff-extra-row');
      row.innerHTML = `<legend>${qualification ? 'Qualification' : 'Emergency contact'} ${index}</legend><div class="form-grid">${qualification ? field(prefix + '_name', 'Qualification', '', true, 'maxlength="150"') + field(prefix + '_institution', 'Institution', '', false, 'maxlength="150"') + field(prefix + '_year', 'Year obtained', '', false, 'inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="Four digits"') : field(prefix + '_name', 'Full name', '', true, 'maxlength="150"') + field(prefix + '_relationship', 'Relationship', '', false, 'maxlength="30"') + field(prefix + '_phone', 'Phone', '', true, 'type="tel" maxlength="20"')}</div>${action('remove-row', qualification ? 'Remove qualification' : 'Remove contact', 'x')}`;
      form.querySelector(qualification ? '#staffNewQualifications' : '#staffNewContacts').appendChild(row);
      row.querySelector('input').focus(); MGAEMS.initIcons();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving || handle.closed || !canCreate || !authorized()) return;
      const payload = employmentPayload(form);
      if (!validateEmployment(form, payload)) return;
      const fields = {}, qualifications = [], contacts = [];
      form.querySelectorAll('[data-extra-kind]').forEach(row => {
        const controls = [...row.querySelectorAll('input')], entries = controls.map(control => control.value.trim());
        if (row.dataset.extraKind === 'qualification') {
          if (!entries[0]) fields[controls[0].name] = ['Qualification is required; remove an unused row.'];
          if (entries[2] && !/^\d{4}$/.test(entries[2])) fields[controls[2].name] = ['Year obtained must contain four digits.'];
          qualifications.push({ qualification: entries[0], institution: entries[1] || null, year_obtained: entries[2] || null });
        } else {
          if (!entries[0]) fields[controls[0].name] = ['Full name is required.'];
          if (!entries[2]) fields[controls[2].name] = ['Phone is required.'];
          contacts.push({ full_name: entries[0], relationship: entries[1] || null, phone: entries[2] });
        }
      });
      if (Object.keys(fields).length) return formError(form, 'Check qualifications and emergency contacts.', fields);
      payload.qualifications = qualifications; payload.emergency_contacts = contacts;
      saving = true; setBusy(handle, true);
      const button = handle.overlay.querySelector('#staffCreateSave'); button.textContent = 'Saving…';
      const result = await MGAEMS.post('/api/v1/staff', payload);
      saving = false; setBusy(handle, false); button.textContent = 'Save Staff';
      if (!authorized() || handle.closed) return;
      if (!result.ok) {
        if (accessDenied(result)) return submissionError(handle, form, result);
        const mapped = { ...result, fields: { ...result.fields } };
        const rows = [...form.querySelectorAll('[data-extra-kind]')];
        for (const [key, messages] of Object.entries(result.fields || {})) {
          const match = key.match(/^(qualifications|emergency_contacts)\.(\d+)\.(qualification|institution|year_obtained|full_name|relationship|phone)$/);
          if (!match) continue;
          const kind = match[1] === 'qualifications' ? 'qualification' : 'contact';
          const row = rows.filter(item => item.dataset.extraKind === kind)[Number(match[2])];
          const index = (kind === 'qualification' ? ['qualification', 'institution', 'year_obtained'] : ['full_name', 'relationship', 'phone']).indexOf(match[3]);
          const control = row?.querySelectorAll('input')[index];
          if (control) { delete mapped.fields[key]; mapped.fields[control.name] = messages; }
        }
        return MGAEMS.showFormErrors(form, mapped);
      }
      handle.close(); MGAEMS.toast(`${payload.first_name} ${payload.last_name} added.`, 'success'); loadPage();
    });
  }

  async function openProfile(id, trigger) {
    if (!authorized() || !canManage || !validId(id) || state.profile?.staffBusy || state.creating) return;
    if (state.profile && !state.profile.closed) state.profile.close();
    const request = ++state.profileRequest;
    const handle = MGAEMS.openModal({ title: 'Staff profile', body: MGAEMS.loadingHTML('Loading staff profile…'), trigger, onClose: () => { if (state.profile === handle) { state.profile = null; state.profileData = null; ++state.profileRequest; } } });
    state.profile = handle;
    await refreshProfile(handle, id, 'details', request);
  }
  async function refreshProfile(handle, id, tab, request = ++state.profileRequest) {
    if (!authorized() || handle.closed || state.profile !== handle) return;
    handle.body.innerHTML = MGAEMS.loadingHTML('Loading staff profile…');
    const result = await MGAEMS.get(`/api/v1/staff/${id}`);
    if (!authorized() || handle.closed || state.profile !== handle || request !== state.profileRequest) return;
    const data = result.ok ? profileData(result.data) : null;
    if (accessDenied(result)) { state.denied = true; authorized(); return; }
    if (!data || String(data.id) !== String(id)) {
      state.profileData = null;
      handle.body.innerHTML = `${MGAEMS.errorHTML(result.error || 'The requested staff profile could not be loaded.')}<button type="button" class="btn btn-secondary" id="staffProfileRetry">Try again</button>`;
      handle.body.querySelector('#staffProfileRetry').addEventListener('click', () => refreshProfile(handle, id, tab));
      return MGAEMS.initIcons();
    }
    state.profileData = data; state.activeTab = tab; renderProfile(handle);
  }
  function renderProfile(handle) {
    const person = state.profileData;
    if (!person || !alive(handle, person.id)) return;
    const tabs = [['details', 'Personal & employment'], ['qualifications', 'Qualifications'], ['contacts', 'Emergency contacts'], ['documents', 'Documents']];
    handle.body.innerHTML = `<div class="staff-profile"><div class="staff-profile-heading"><div class="staff-avatar" aria-hidden="true">${esc(person.first_name?.[0] || '')}${esc(person.last_name?.[0] || '')}</div><div><h3>${esc(staffName(person))}</h3><p class="text-muted">${esc(person.role_title)} · ${esc(label(person.staff_type))}</p></div>${employmentBadge(person.status)}</div><div class="tabs staff-profile-tabs" role="tablist" aria-label="Staff profile sections">${tabs.map(([key, text]) => `<button type="button" class="tab ${state.activeTab === key ? 'active' : ''}" role="tab" id="staffTab_${key}" data-staff-tab="${key}" aria-controls="staffPanel_${key}" aria-selected="${state.activeTab === key}" tabindex="${state.activeTab === key ? '0' : '-1'}">${text}</button>`).join('')}</div>${tabs.map(([key]) => `<section class="staff-profile-panel" role="tabpanel" tabindex="0" id="staffPanel_${key}" aria-labelledby="staffTab_${key}" ${state.activeTab === key ? '' : 'hidden'}>${key === 'details' ? detailsPanel(person) : key === 'documents' ? documentsPanel(person) : recordsPanel(person, key)}</section>`).join('')}</div>`;
    for (const button of handle.body.querySelectorAll('[data-staff-tab]')) {
      button.addEventListener('click', () => switchTab(handle, button.dataset.staffTab));
      button.addEventListener('keydown', event => {
        const index = tabs.findIndex(([key]) => key === button.dataset.staffTab);
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
        if (next !== null) { event.preventDefault(); switchTab(handle, tabs[next][0]); handle.body.querySelector('#staffTab_' + tabs[next][0]).focus(); }
      });
    }
    if (!handle.staffActionsBound) handle.body.addEventListener('click', event => {
      const person = state.profileData;
      const button = event.target.closest('[data-staff-action]');
      if (!button || button.disabled || !person || !alive(handle, person.id) || handle.staffBusy) return;
      const kind = button.dataset.staffAction;
      if (kind === 'edit') showEdit(handle, person);
      if (kind === 'qualification-add' || kind === 'qualification-edit') recordForm(handle, 'qualifications', person.qualifications?.find(record => String(record.id) === button.dataset.id));
      if (kind === 'contact-add' || kind === 'contact-edit') recordForm(handle, 'contacts', person.emergency_contacts?.find(record => String(record.id) === button.dataset.id));
      if (kind === 'qualification-remove') removeRecord(handle, 'qualifications', button.dataset.id);
      if (kind === 'contact-remove') removeRecord(handle, 'contacts', button.dataset.id);
    });
    handle.staffActionsBound = true;
    MGAEMS.initIcons();
  }
  function switchTab(handle, tab) {
    if (!authorized() || handle.staffBusy) return;
    state.activeTab = tab;
    for (const button of handle.body.querySelectorAll('[data-staff-tab]')) {
      const selected = button.dataset.staffTab === tab;
      button.setAttribute('aria-selected', String(selected)); button.setAttribute('tabindex', selected ? '0' : '-1'); button.classList.toggle('active', selected);
    }
    for (const panel of handle.body.querySelectorAll('[role="tabpanel"]')) panel.hidden = panel.getAttribute('id') !== 'staffPanel_' + tab;
  }
  function detailsPanel(person) {
    const detail = (key, value) => `<div><dt>${esc(key)}</dt><dd>${value}</dd></div>`;
    return `<dl class="detail-grid staff-detail-grid">${detail('Full name', esc(staffName(person)))}${detail('Phone', esc(person.phone || 'Not recorded'))}${detail('Staff type', esc(label(person.staff_type)))}${detail('Role / job title', esc(person.role_title))}${detail('Department', esc(person.department?.name || 'No department'))}${detail('Employment date', date(person.employment_date))}${detail('Contract type', esc(person.contract_type || 'Not recorded'))}${detail('System account', person.user_id ? 'Linked' : 'Not linked')}</dl><div class="staff-info alert"><i data-lucide="info" aria-hidden="true"></i><span>Account links are managed separately by the System Administrator in Administration User Management.</span></div>${state.departments === null ? '<p class="text-muted">Employment editing is unavailable until department options load. Retry the directory.</p>' : action('edit', 'Edit employment details', 'pencil')}`;
  }
  function showEdit(handle, person) {
    if (!alive(handle, person.id) || state.departments === null || handle.body.querySelector('#staffEditForm')) return;
    const panel = handle.body.querySelector('#staffPanel_details');
    panel.innerHTML = `<form id="staffEditForm"><div data-form-error role="alert"></div><p class="staff-form-note">Required fields are marked *. Employment status changes can affect a linked account's eligibility.</p>${employmentFields(person)}<div class="staff-form-actions"><button type="button" class="btn btn-secondary" id="staffEditCancel">Cancel</button><button type="submit" class="btn btn-primary" id="staffEditSave">Save changes</button></div></form>`;
    const form = panel.querySelector('form'); let saving = false;
    panel.querySelector('#staffEditCancel').addEventListener('click', () => { if (!saving) renderProfile(handle); });
    form.querySelector('input').focus();
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving || !alive(handle, person.id)) return;
      const payload = employmentPayload(form);
      if (!validateEmployment(form, payload, true)) return;
      saving = true; setBusy(handle, true);
      if (payload.status !== person.status || payload.staff_type !== person.staff_type) {
        const accepted = await MGAEMS.confirmAction('Review employment change', `Update ${staffName(person)} from ${label(person.staff_type)} / ${label(person.status)} to ${label(payload.staff_type)} / ${label(payload.status)}? Linked-account eligibility and session invalidation remain controlled by the server.`, 'Save changes');
        if (!accepted || !alive(handle, person.id)) { saving = false; setBusy(handle, false); return; }
      }
      setBusy(handle, true); const button = form.querySelector('#staffEditSave'); button.textContent = 'Saving…';
      const result = await MGAEMS.patch(`/api/v1/staff/${person.id}`, payload);
      saving = false; setBusy(handle, false); button.textContent = 'Save changes';
      if (!alive(handle, person.id)) return;
      if (!result.ok) return submissionError(handle, form, result);
      MGAEMS.toast('Staff details updated.', 'success'); loadPage(); refreshProfile(handle, person.id, 'details');
    });
    MGAEMS.initIcons();
  }
  function recordsPanel(person, kind) {
    const qualification = kind === 'qualifications', records = qualification ? person.qualifications : person.emergency_contacts;
    const title = qualification ? 'Qualifications' : 'Emergency contacts', actionPrefix = qualification ? 'qualification' : 'contact';
    return `<div class="staff-panel-heading"><div><h3>${title}</h3><p class="text-muted">${qualification ? 'Professional and academic qualifications on record.' : 'People listed for contact in an emergency.'}</p></div>${action(actionPrefix + '-add', qualification ? 'Add qualification' : 'Add contact', 'plus')}</div><div id="staffRecordError_${kind}" role="alert"></div><div id="staffRecordEditor_${kind}"></div>${records?.length ? `<div class="record-list">${records.map(record => `<div class="record-item"><div><strong>${esc(qualification ? record.qualification : record.full_name)}</strong><p class="staff-meta">${esc(qualification ? record.institution || 'Institution not recorded' : record.relationship || 'Relationship not recorded')}${qualification ? record.year_obtained ? ` · ${esc(record.year_obtained)}` : '' : ` · ${esc(record.phone)}`}</p></div><div class="actions">${action(actionPrefix + '-edit', 'Edit', 'pencil', `data-id="${esc(record.id)}" aria-label="Edit ${esc(qualification ? record.qualification : record.full_name)}"`)}${action(actionPrefix + '-remove', 'Remove', 'trash-2', `data-id="${esc(record.id)}" aria-label="Remove ${esc(qualification ? record.qualification : record.full_name)}"`)}</div></div>`).join('')}</div>` : MGAEMS.emptyStateHTML(qualification ? 'No qualifications recorded' : 'No emergency contacts recorded', qualification ? 'Add a qualification when its details are available.' : 'Add an emergency contact when their details are available.', qualification ? 'graduation-cap' : 'contact')}`;
  }
  function recordForm(handle, kind, record = null) {
    const person = state.profileData, qualification = kind === 'qualifications';
    if (!alive(handle, person?.id)) return;
    const editor = handle.body.querySelector('#staffRecordEditor_' + kind);
    if (editor.querySelector('form')) { editor.querySelector('input').focus(); return; }
    const recordField = (key, text, value, required, extra) => field(key, text, value, required, extra, 'staff_' + kind);
    editor.innerHTML = `<form class="inline-editor" id="staffRecordForm_${kind}"><h4>${record ? 'Edit' : 'Add'} ${qualification ? 'qualification' : 'emergency contact'}</h4><div data-form-error role="alert"></div><p class="staff-form-note">Required fields are marked *.</p><div class="form-grid">${qualification ? recordField('qualification', 'Qualification', record?.qualification, true, 'maxlength="150"') + recordField('institution', 'Institution', record?.institution, false, 'maxlength="150"') + recordField('year_obtained', 'Year obtained', record?.year_obtained, false, 'inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="Four digits"') : recordField('full_name', 'Full name', record?.full_name, true, 'maxlength="150"') + recordField('relationship', 'Relationship', record?.relationship, false, 'maxlength="30"') + recordField('phone', 'Phone', record?.phone, true, 'type="tel" maxlength="20"')}</div><div class="staff-form-actions"><button type="button" class="btn btn-secondary" data-record-cancel>Cancel</button><button type="submit" class="btn btn-primary">Save ${qualification ? 'qualification' : 'contact'}</button></div></form>`;
    const form = editor.querySelector('form'); let saving = false;
    form.querySelector('[data-record-cancel]').addEventListener('click', () => { if (!saving) editor.innerHTML = ''; }); form.querySelector('input').focus();
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving || !alive(handle, person.id)) return;
      const data = values(form), fields = {};
      const payload = qualification ? { qualification: data.qualification, institution: data.institution || null, year_obtained: data.year_obtained || null } : { full_name: data.full_name, relationship: data.relationship || null, phone: data.phone };
      for (const key of qualification ? ['qualification'] : ['full_name', 'phone']) if (!payload[key]) fields[key] = ['This field is required.'];
      if (qualification && payload.year_obtained && !/^\d{4}$/.test(payload.year_obtained)) fields.year_obtained = ['Year obtained must contain four digits.'];
      if (Object.keys(fields).length) return formError(form, 'Check the required details.', fields);
      saving = true; setBusy(handle, true); const button = form.querySelector('[type="submit"]'), original = button.textContent; button.textContent = 'Saving…';
      const endpoint = `/api/v1/staff/${person.id}/${qualification ? 'qualifications' : 'emergency-contacts'}${record ? '/' + record.id : ''}`;
      const result = await MGAEMS[record ? 'patch' : 'post'](endpoint, payload);
      saving = false; setBusy(handle, false); button.textContent = original;
      if (!alive(handle, person.id)) return;
      if (!result.ok) return submissionError(handle, form, result);
      MGAEMS.toast(`${qualification ? 'Qualification' : 'Emergency contact'} ${record ? 'updated' : 'added'}.`, 'success'); refreshProfile(handle, person.id, kind);
    });
  }
  async function removeRecord(handle, kind, id) {
    const person = state.profileData, qualification = kind === 'qualifications', records = qualification ? person?.qualifications : person?.emergency_contacts;
    const record = records?.find(item => String(item.id) === String(id));
    if (!record || !alive(handle, person.id) || handle.removing) return;
    handle.removing = true; setBusy(handle, true);
    const accepted = await MGAEMS.confirmAction(`Remove ${qualification ? 'qualification' : 'emergency contact'}?`, `Remove ${qualification ? record.qualification : record.full_name} from ${staffName(person)}'s profile?`, 'Remove');
    if (!accepted || !alive(handle, person.id)) { handle.removing = false; setBusy(handle, false); return; }
    setBusy(handle, true);
    const result = await MGAEMS.del(`/api/v1/staff/${person.id}/${qualification ? 'qualifications' : 'emergency-contacts'}/${record.id}`);
    setBusy(handle, false); handle.removing = false;
    if (!alive(handle, person.id)) return;
    if (!result.ok) {
      if (accessDenied(result)) { state.denied = true; authorized(); handle.body.innerHTML = MGAEMS.errorHTML('You are no longer authorized to manage this staff profile.'); }
      else handle.body.querySelector('#staffRecordError_' + kind).innerHTML = MGAEMS.errorHTML(result.error || 'The record could not be removed.');
      return MGAEMS.initIcons();
    }
    MGAEMS.toast(`${qualification ? 'Qualification' : 'Emergency contact'} removed.`, 'success'); refreshProfile(handle, person.id, kind);
  }
  function documentsPanel(person) {
    return `<div class="staff-panel-heading"><div><h3>Documents on record</h3><p class="text-muted">Documents listed on this Staff record.</p></div></div>${person.documents?.length ? `<div class="record-list">${person.documents.map(record => `<div class="record-item"><div><strong>${esc(record.doc_type)}</strong><p class="staff-meta">Uploaded ${date(record.uploaded_at)}</p></div><span class="badge badge-gray">On record</span></div>`).join('')}</div>` : MGAEMS.emptyStateHTML('No documents recorded', 'No staff documents are associated with this record.', 'file-text')}<p class="staff-info alert">Contact authorized school administration for document access or updates.</p>`;
  }
  loadPage();
})();
