const user = MGAEMS.requireAuth();
const ADMIN_ROLES = ['system_admin', 'head_teacher'];
if (user && !ADMIN_ROLES.includes(user.role)) window.location.href = MGAEMS.landingPage(user);

if (user && ADMIN_ROLES.includes(user.role)) {
  renderAppShell('/administration.html');
  MGAEMS.initSidebar();

  const isSystemAdmin = user.role === 'system_admin';
  const sessionCurrent = MGAEMS.sessionGuard();
  const current = () => {
    if (sessionCurrent() && window.location.pathname === '/administration.html') return true;
    if (!state.cleared) {
      state.cleared = true; state.users = null; state.roles = []; state.settings = null; state.backups = [];
      document.getElementById('appMain').innerHTML = MGAEMS.errorHTML('Your session changed. Reopen Administration from your authorized workspace.');
      if (state.modal && !state.modal.closed) { state.modal.body.innerHTML = ''; state.modal.setBusy(false); state.modal.close(); }
    }
    return false;
  };
  const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const rows = value => Array.isArray(value) && value.every(item => record(item) && validId(item.id));
  const pagination = (meta, page) => record(meta) && Number(meta.page) === page && validId(meta.per_page)
    && Number.isSafeInteger(Number(meta.total)) && Number(meta.total) >= 0;
  const state = {
    users: null, roles: [], userPage: 1, userTotal: 0, userStatus: '', userRole: '', userSearch: '',
    auditPage: 1, auditTotal: 0, auditUser: '', auditAction: '', auditFrom: '', auditTo: '',
    settings: null, backups: [], modal: null, userRequest: 0, auditRequest: 0, settingsRequest: 0, backupRequest: 0, accountRequest: 0, working: new Set(),
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const dateTime = value => {
    if (!value) return '—';
    const source = String(value);
    const date = new Date(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(source) ? source.replace(' ', 'T') + '+03:00' : value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(date);
  };
  const prettyRole = role => String(role || '').replace(/_/g, ' ');
  const statusBadge = status => status === 'active' ? 'badge-green' : status === 'locked' ? 'badge-red' : 'badge-gray';

  document.getElementById('appMain').innerHTML = `
    <div class="section-header"><div><p class="eyebrow">School administration</p><h1>Administration</h1><p class="text-muted">${isSystemAdmin ? 'Manage accounts and verified Staff links, review activity and maintain school settings.' : 'Review audit activity and backup availability, and maintain school settings.'}</p></div></div>
    <div class="stat-cards admin-summary">
      ${isSystemAdmin ? '<div class="card stat-card"><div class="num" id="usersSummary">—</div><div class="label">User accounts</div></div>' : ''}
      <div class="card stat-card"><div class="num" id="auditSummary">—</div><div class="label">Audit log entries</div></div>
      <div class="card stat-card"><div class="num" id="backupSummary">—</div><div class="label">Available backups</div></div>
      <div class="card stat-card"><div class="num" id="settingsSummary">—</div><div class="label">School settings</div></div>
    </div>
    <div class="tabs admin-tabs" role="tablist" aria-label="Administration sections">
      ${isSystemAdmin ? '<button class="tab active" type="button" role="tab" id="usersTab" aria-selected="true">Users</button>' : ''}
      <button class="tab ${isSystemAdmin ? '' : 'active'}" type="button" role="tab" id="auditTab" aria-selected="${isSystemAdmin ? 'false' : 'true'}">Audit Logs</button>
      <button class="tab" type="button" role="tab" id="settingsTab" aria-selected="false">School Settings</button>
      <button class="tab" type="button" role="tab" id="backupsTab" aria-selected="false">Backups</button>
    </div>

    ${isSystemAdmin ? `<section class="admin-panel active" id="usersPanel" role="tabpanel" aria-labelledby="usersTab">
      <div class="section-header"><h2>User Management</h2><button class="btn btn-primary" id="addUserBtn"><i data-lucide="user-plus"></i> Create User</button></div>
      <div class="card admin-content-card">
        <div class="admin-toolbar">
          <div class="search-input"><i data-lucide="search"></i><input type="search" id="userSearch" placeholder="Search this page by username or email" aria-label="Search users"></div>
          <select id="userRoleFilter" aria-label="Filter users by role"><option value="">All roles</option></select>
          <select id="userStatusFilter" aria-label="Filter users by status"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="locked">Locked</option></select>
        </div>
        <div id="usersTable">${MGAEMS.loadingHTML('Loading user accounts…')}</div>
        <div class="admin-pagination" id="usersPagination" hidden></div>
      </div>
    </section>` : ''}

    <section class="admin-panel ${isSystemAdmin ? '' : 'active'}" id="auditPanel" role="tabpanel" aria-labelledby="auditTab">
      <div class="section-header"><h2>Audit Logs</h2></div>
      <div class="card admin-content-card">
        <div class="admin-filter-grid">
          <div class="field"><label for="auditUser">Actor user ID</label><input type="number" id="auditUser" min="1" step="1" placeholder="Any actor"></div>
          <div class="field"><label for="auditAction">Action</label><input type="text" id="auditAction" maxlength="100" placeholder="e.g. CREATE_USER"></div>
          <div class="field"><label for="auditFrom">From</label><input type="date" id="auditFrom"></div>
          <div class="field"><label for="auditTo">To</label><input type="date" id="auditTo"></div>
        </div>
        <div class="admin-filter-actions"><button class="btn btn-secondary" type="button" id="applyAuditFilters"><i data-lucide="filter"></i> Apply Filters</button><button class="btn btn-secondary" type="button" id="clearAuditFilters"><i data-lucide="x"></i> Clear</button></div>
        <div id="auditTable">${MGAEMS.loadingHTML('Loading audit logs…')}</div>
        <div class="admin-pagination" id="auditPagination" hidden></div>
      </div>
    </section>

    <section class="admin-panel" id="settingsPanel" role="tabpanel" aria-labelledby="settingsTab">
      <div class="section-header"><h2>School Settings</h2></div>
      <div id="settingsState">${MGAEMS.loadingHTML('Loading school settings…')}</div>
    </section>

    <section class="admin-panel" id="backupsPanel" role="tabpanel" aria-labelledby="backupsTab">
      <div class="section-header"><h2>Database Backups</h2>${isSystemAdmin ? '<button class="btn btn-primary" id="createBackupBtn"><i data-lucide="database-backup"></i> Create Backup</button>' : ''}</div>
      <div class="card admin-content-card"><div id="backupTable">${MGAEMS.loadingHTML('Loading backups…')}</div></div>
    </section>
  `;
  MGAEMS.initIcons();
  window.addEventListener('storage', event => { if (event.key === null || ['mgaems_token', 'mgaems_user'].includes(event.key)) current(); });

  const panels = [
    ...(isSystemAdmin ? [['usersTab', 'usersPanel']] : []),
    ['auditTab', 'auditPanel'], ['settingsTab', 'settingsPanel'], ['backupsTab', 'backupsPanel'],
  ];
  panels.forEach(([tabId, panelId], index) => {
    const tab = document.getElementById(tabId);
    tab.setAttribute('aria-controls', panelId);
    tab.tabIndex = index === 0 ? 0 : -1;
    document.getElementById(panelId).hidden = index !== 0;
    tab.addEventListener('click', () => selectPanel(tabId, panelId));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? panels[(index + 1) % panels.length] : event.key === 'ArrowLeft' ? panels[(index + panels.length - 1) % panels.length] : event.key === 'Home' ? panels[0] : event.key === 'End' ? panels.at(-1) : null;
      if (next) { event.preventDefault(); selectPanel(...next); document.getElementById(next[0]).focus(); }
    });
  });
  if (isSystemAdmin) {
    document.getElementById('addUserBtn').addEventListener('click', openCreateUser);
    document.getElementById('userSearch').addEventListener('input', event => { state.userSearch = event.target.value.trim().toLowerCase(); renderUsers(); });
    document.getElementById('userRoleFilter').addEventListener('change', event => { state.userRole = event.target.value; state.userPage = 1; loadUsers(); });
    document.getElementById('userStatusFilter').addEventListener('change', event => { state.userStatus = event.target.value; state.userPage = 1; loadUsers(); });
  }
  document.getElementById('applyAuditFilters').addEventListener('click', applyAuditFilters);
  document.getElementById('clearAuditFilters').addEventListener('click', clearAuditFilters);
  document.getElementById('createBackupBtn')?.addEventListener('click', createBackup);

  function selectPanel(tabId, panelId) {
    if (!current()) return;
    panels.forEach(([id, panel]) => {
      const active = id === tabId;
      document.getElementById(id).classList.toggle('active', active);
      document.getElementById(id).setAttribute('aria-selected', String(active));
      document.getElementById(id).tabIndex = active ? 0 : -1;
      document.getElementById(panel).hidden = !active;
      document.getElementById(panel).classList.toggle('active', panel === panelId);
    });
  }

  async function loadUsers() {
    if (!isSystemAdmin || !current()) return;
    const request = ++state.userRequest, page = state.userPage;
    state.users = null;
    document.getElementById('usersSummary').textContent = '—';
    document.getElementById('usersPagination').hidden = true;
    const target = document.getElementById('usersTable');
    target.innerHTML = MGAEMS.loadingHTML('Loading user accounts…');
    const params = new URLSearchParams({ page: String(state.userPage), per_page: '15' });
    if (state.userStatus) params.set('status', state.userStatus);
    if (state.userRole) params.set('role', state.userRole);
    const result = await MGAEMS.get('/api/v1/users?' + params.toString());
    if (!current() || request !== state.userRequest) return;
    if (!result.ok || !rows(result.data) || !pagination(result.meta, page)) {
      document.getElementById('usersSummary').textContent = 'Unavailable';
      target.innerHTML = `${MGAEMS.errorHTML(result.status === 403 ? 'You do not have permission to manage users.' : result.error || 'User accounts returned an unexpected response.')}<button class="btn btn-secondary btn-sm" id="retryUsers"><i data-lucide="refresh-cw"></i> Retry</button>`;
      target.querySelector('#retryUsers').addEventListener('click', loadUsers);
      MGAEMS.initIcons();
      return;
    }
    state.users = result.data;
    state.userTotal = result.meta?.total ?? state.users.length;
    document.getElementById('usersSummary').textContent = String(state.userTotal);
    renderUsers();
    renderPagination('usersPagination', result.meta, state.userPage, page => { state.userPage = page; loadUsers(); });
  }

  function renderUsers() {
    if (!current() || state.users === null) return;
    const target = document.getElementById('usersTable');
    const users = state.users.filter(item => !state.userSearch || `${item.username} ${item.email}`.toLowerCase().includes(state.userSearch));
    if (!users.length) {
      target.innerHTML = MGAEMS.emptyStateHTML(state.userSearch ? 'No accounts match this page search' : 'No user accounts found', state.userSearch ? 'Try another username or email.' : 'Create the first user account.', 'users');
      MGAEMS.initIcons();
      return;
    }
    target.innerHTML = `<div class="admin-table-wrap" role="region" aria-label="Administration table" tabindex="0"><table class="admin-table">
      <thead><tr><th scope="col">User</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Staff eligibility</th><th scope="col">Last Login</th><th scope="col">Created</th><th scope="col">Actions</th></tr></thead>
      <tbody>${users.map(account => `<tr>
        <td class="admin-user-name"><strong>${esc(account.username)}</strong><small>${esc(account.email)}</small></td>
        <td>${esc(prettyRole(account.role))}</td>
        <td><span class="badge ${statusBadge(account.status)}">${esc(account.status)}</span></td>
        <td class="admin-staff-link">${window.MGAEMSAccountLinks.status(account)}</td>
        <td>${esc(dateTime(account.last_login_at))}</td><td>${esc(dateTime(account.created_at))}</td>
        <td><div class="admin-actions"><button class="admin-icon-button" type="button" title="Manage Staff account link" aria-label="Manage Staff link for ${esc(account.username)}" data-link-user="${account.id}"><i data-lucide="link"></i></button><button class="admin-icon-button" type="button" title="View account" aria-label="View ${esc(account.username)}" data-view-user="${account.id}"><i data-lucide="eye"></i></button><button class="admin-icon-button" type="button" title="Edit account" aria-label="Edit ${esc(account.username)}" data-edit-user="${account.id}"><i data-lucide="pencil"></i></button>${account.status === 'active' ? `<button class="admin-icon-button" type="button" title="Deactivate account" aria-label="Deactivate ${esc(account.username)}" data-deactivate-user="${account.id}"><i data-lucide="user-round-x"></i></button>` : ''}</div></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
    target.querySelectorAll('[data-view-user]').forEach(button => button.addEventListener('click', () => viewUser(button.dataset.viewUser)));
    target.querySelectorAll('[data-edit-user]').forEach(button => button.addEventListener('click', () => editUser(button.dataset.editUser)));
    target.querySelectorAll('[data-deactivate-user]').forEach(button => button.addEventListener('click', () => deactivateUser(button.dataset.deactivateUser)));
    target.querySelectorAll('[data-link-user]').forEach(button => button.addEventListener('click', () => window.MGAEMSAccountLinks.open(Number(button.dataset.linkUser), loadUsers)));
    MGAEMS.initIcons();
  }

  function renderPagination(id, meta, currentPage, changePage) {
    const target = document.getElementById(id);
    if (!meta || !meta.total) { target.hidden = true; return; }
    const totalPages = Math.max(1, Math.ceil(meta.total / meta.per_page));
    target.hidden = totalPages <= 1;
    if (target.hidden) return;
    target.innerHTML = `<span>Page ${meta.page} of ${totalPages} · ${meta.total} records</span><div class="controls"><button type="button" class="btn btn-secondary btn-sm" data-delta="-1" ${currentPage <= 1 ? 'disabled' : ''}><i data-lucide="chevron-left"></i> Prev</button><button type="button" class="btn btn-secondary btn-sm" data-delta="1" ${currentPage >= totalPages ? 'disabled' : ''}>Next <i data-lucide="chevron-right"></i></button></div>`;
    target.querySelectorAll('[data-delta]').forEach(button => button.addEventListener('click', () => {
      const next = currentPage + Number(button.dataset.delta);
      if (current() && !button.disabled && next >= 1 && next <= totalPages) changePage(next);
    }));
    MGAEMS.initIcons();
  }

  async function loadAuditLogs() {
    if (!current()) return;
    const request = ++state.auditRequest, page = state.auditPage;
    document.getElementById('auditSummary').textContent = '—';
    document.getElementById('auditPagination').hidden = true;
    const target = document.getElementById('auditTable');
    target.innerHTML = MGAEMS.loadingHTML('Loading audit logs…');
    const params = new URLSearchParams({ page: String(state.auditPage), per_page: '25' });
    if (state.auditUser) params.set('user_id', state.auditUser);
    if (state.auditAction) params.set('action', state.auditAction);
    if (state.auditFrom) params.set('from', `${state.auditFrom} 00:00:00`);
    if (state.auditTo) params.set('to', `${state.auditTo} 23:59:59`);
    const result = await MGAEMS.get('/api/v1/audit-logs?' + params.toString());
    if (!current() || request !== state.auditRequest) return;
    if (!result.ok || !rows(result.data) || !pagination(result.meta, page)) {
      document.getElementById('auditSummary').textContent = 'Unavailable';
      target.innerHTML = `${MGAEMS.errorHTML(result.status === 403 ? 'You do not have permission to view audit logs.' : result.error || 'Audit logs returned an unexpected response.')}<button class="btn btn-secondary btn-sm" id="retryAudit"><i data-lucide="refresh-cw"></i> Retry</button>`;
      target.querySelector('#retryAudit').addEventListener('click', loadAuditLogs);
      MGAEMS.initIcons();
      return;
    }
    state.auditTotal = result.meta?.total ?? result.data.length;
    document.getElementById('auditSummary').textContent = String(state.auditTotal);
    if (!result.data.length) {
      target.innerHTML = MGAEMS.emptyStateHTML('No audit entries found', 'Adjust filters or check again after administrative activity.', 'scroll-text');
      document.getElementById('auditPagination').hidden = true;
      MGAEMS.initIcons();
      return;
    }
    target.innerHTML = `<div class="admin-table-wrap" role="region" aria-label="Administration table" tabindex="0"><table class="admin-table">
      <thead><tr><th scope="col">Date / Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">Entity ID</th><th scope="col">IP Address</th></tr></thead>
      <tbody>${result.data.map(log => `<tr>
        <td>${esc(dateTime(log.created_at))}</td>
        <td>${esc(log.user?.username || (log.user_id ? `User #${log.user_id}` : 'System'))}</td>
        <td class="admin-audit-action">${esc(log.action)}</td>
        <td>${esc(log.entity_type || '—')}</td>
        <td>${esc(log.entity_id ?? '—')}</td>
        <td>${esc(log.ip_address || '—')}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
    renderPagination('auditPagination', result.meta, state.auditPage, page => { state.auditPage = page; loadAuditLogs(); });
    MGAEMS.initIcons();
  }

  function applyAuditFilters() {
    if (!current()) return;
    state.auditUser = document.getElementById('auditUser').value.trim();
    state.auditAction = document.getElementById('auditAction').value.trim();
    state.auditFrom = document.getElementById('auditFrom').value;
    state.auditTo = document.getElementById('auditTo').value;
    if (state.auditUser && !validId(state.auditUser)) { MGAEMS.toast('Enter a positive actor account number.', 'error'); document.getElementById('auditUser').focus(); return; }
    if (state.auditFrom && state.auditTo && state.auditFrom > state.auditTo) {
      MGAEMS.toast('The start date must not be after the end date.', 'error');
      return;
    }
    state.auditPage = 1;
    loadAuditLogs();
  }

  function clearAuditFilters() {
    ['auditUser', 'auditAction', 'auditFrom', 'auditTo'].forEach(id => { document.getElementById(id).value = ''; });
    state.auditUser = ''; state.auditAction = ''; state.auditFrom = ''; state.auditTo = ''; state.auditPage = 1;
    loadAuditLogs();
  }

  async function loadSettings() {
    if (!current() || state.working.has('settings') || state.working.has('logo')) return;
    const request = ++state.settingsRequest;
    document.getElementById('settingsSummary').textContent = '—';
    const target = document.getElementById('settingsState');
    target.innerHTML = MGAEMS.loadingHTML('Loading school settings…');
    const result = await MGAEMS.schoolSettings();
    if (!current() || result.stale || request !== state.settingsRequest) return;
    if (!result.ok || !record(result.data) || typeof result.data.school_name !== 'string') {
      target.innerHTML = `${MGAEMS.errorHTML(result.status === 403 ? 'You do not have permission to view school settings.' : result.error || 'School settings returned an unexpected response.')}<button class="btn btn-secondary btn-sm" id="retrySettings"><i data-lucide="refresh-cw"></i> Retry</button>`;
      target.querySelector('#retrySettings').addEventListener('click', loadSettings);
      document.getElementById('settingsSummary').textContent = 'Unavailable';
      MGAEMS.initIcons();
      return;
    }
    state.settings = result.data;
    document.getElementById('settingsSummary').textContent = 'Loaded';
    renderSettings();
  }

  function renderSettings() {
    if (!current()) return;
    const settings = state.settings;
    const canUpdateSettings = true;
    document.getElementById('settingsState').innerHTML = `
      <div class="admin-settings-grid">
        <form class="card" id="schoolSettingsForm">
          <div class="section-header"><h2>School Information</h2></div>
          <div id="settingsAlert" data-form-error role="alert"></div>
          <div class="form-grid">
            <div class="field full"><label for="settingsSchoolName">School name *</label><input id="settingsSchoolName" maxlength="150" required value="${esc(settings.school_name || '')}" ${canUpdateSettings ? '' : 'disabled'}></div>
            <div class="field full"><label for="schoolMotto">Motto</label><input id="schoolMotto" maxlength="150" value="${esc(settings.motto || '')}" ${canUpdateSettings ? '' : 'disabled'}></div>
            <div class="field full"><label for="schoolVision">Vision</label><textarea id="schoolVision" rows="3" ${canUpdateSettings ? '' : 'disabled'}>${esc(settings.vision || '')}</textarea></div>
            <div class="field full"><label for="schoolMission">Mission</label><textarea id="schoolMission" rows="3" ${canUpdateSettings ? '' : 'disabled'}>${esc(settings.mission || '')}</textarea></div>
            <div class="field full"><label for="schoolAddress">Address</label><input id="schoolAddress" maxlength="255" value="${esc(settings.address || '')}" ${canUpdateSettings ? '' : 'disabled'}></div>
            <div class="field"><label for="schoolPhone">Phone</label><input id="schoolPhone" maxlength="20" value="${esc(settings.phone || '')}" ${canUpdateSettings ? '' : 'disabled'}></div>
            <div class="field"><label for="schoolEmail">Email</label><input id="schoolEmail" type="email" maxlength="150" value="${esc(settings.email || '')}" ${canUpdateSettings ? '' : 'disabled'}></div>
          </div>
          ${canUpdateSettings ? '<button class="btn btn-primary" type="submit" id="saveSettings"><i data-lucide="save"></i> Save Settings</button>' : ''}
          <div class="admin-settings-message" id="settingsSaveState"></div>
        </form>
        <div class="card admin-logo-area">
          <h2>School Logo</h2>
          ${MGAEMS.schoolLogoHTML({ ...settings, logo_revision: MGAEMS.schoolBranding()?.logo_revision }, { className: 'admin-logo-preview' })}
          <p class="text-muted">${settings.logo_path ? 'Saved school logo. Its original proportions are preserved.' : 'No logo configured. Upload a school logo to show it throughout MGAEMS.'}</p>
          ${canUpdateSettings ? '<form id="schoolLogoForm"><div class="field"><label for="schoolLogo">Upload logo (JPG or PNG, max 2 MB)</label><input id="schoolLogo" type="file" accept="image/jpeg,image/png" required></div><button class="btn btn-secondary" type="submit" id="uploadLogo"><i data-lucide="upload"></i> Upload Logo</button><div id="logoUploadState"></div></form>' : ''}
        </div>
      </div>`;
    document.getElementById('schoolSettingsForm').addEventListener('submit', saveSettings);
    document.getElementById('schoolLogoForm')?.addEventListener('submit', uploadLogo);
    MGAEMS.initSchoolLogos(document.getElementById('settingsState'));
    MGAEMS.initIcons();
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!current() || state.working.has('settings') || state.working.has('logo')) return;
    const button = document.getElementById('saveSettings');
    button.disabled = true;
    button.innerHTML = '<span class="spinner admin-spinner" aria-hidden="true"></span> Saving…';
    const payload = {
      school_name: document.getElementById('settingsSchoolName').value.trim(),
      motto: document.getElementById('schoolMotto').value.trim() || null,
      vision: document.getElementById('schoolVision').value.trim() || null,
      mission: document.getElementById('schoolMission').value.trim() || null,
      address: document.getElementById('schoolAddress').value.trim() || null,
      phone: document.getElementById('schoolPhone').value.trim() || null,
      email: document.getElementById('schoolEmail').value.trim() || null,
    };
    if (!payload.school_name) {
      showSettingsError('School name is required.');
      button.disabled = false;
      button.innerHTML = '<i data-lucide="save"></i> Save Settings';
      MGAEMS.initIcons();
      return;
    }
    state.working.add('settings');
    const form = document.getElementById('schoolSettingsForm');
    const disabled = [...document.getElementById('settingsState').querySelectorAll('input, textarea, button')].map(control => [control, control.disabled]);
    disabled.forEach(([control]) => { control.disabled = true; });
    const result = await MGAEMS.patch('/api/v1/settings/school', payload);
    state.working.delete('settings');
    disabled.forEach(([control, value]) => { control.disabled = value; });
    if (!current()) return;
    button.disabled = false;
    button.innerHTML = '<i data-lucide="save"></i> Save Settings';
    if (!result.ok || !record(result.data) || typeof result.data.school_name !== 'string') { showSettingsError(result.status === 403 ? 'You do not have permission to update school settings.' : result.error || 'Saved school settings could not be confirmed.'); MGAEMS.initIcons(); return; }
    state.settings = result.data;
    MGAEMS.updateSchoolSettings(state.settings);
    document.getElementById('settingsSaveState').innerHTML = '<div class="alert alert-success"><i data-lucide="circle-check"></i><span>School settings saved.</span></div>';
    MGAEMS.toast('School settings saved.', 'success');
    MGAEMS.initIcons();
  }

  function showSettingsError(message) {
    const target = document.getElementById('settingsAlert');
    target.innerHTML = MGAEMS.errorHTML(message); target.tabIndex = -1; target.focus();
  }

  async function uploadLogo(event) {
    event.preventDefault();
    if (!current() || state.working.has('logo') || state.working.has('settings')) return;
    const input = document.getElementById('schoolLogo');
    const file = input.files[0];
    const stateEl = document.getElementById('logoUploadState');
    if (!file) { stateEl.innerHTML = MGAEMS.errorHTML('Choose a JPG or PNG image first.'); MGAEMS.initIcons(); return; }
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      stateEl.innerHTML = MGAEMS.errorHTML('Choose a JPG or PNG image no larger than 2 MB.'); MGAEMS.initIcons(); return;
    }
    const button = document.getElementById('uploadLogo');
    const draft = [...document.getElementById('schoolSettingsForm').querySelectorAll('input, textarea')].map(control => [control.getAttribute('id'), control.value]);
    const controls = [...document.getElementById('settingsState').querySelectorAll('input, textarea, button')].map(control => [control, control.disabled]);
    const unlock = () => { state.working.delete('logo'); controls.forEach(([control, disabled]) => { control.disabled = disabled; }); };
    state.working.add('logo'); controls.forEach(([control]) => { control.disabled = true; });
    button.disabled = true;
    button.innerHTML = '<span class="spinner admin-spinner" aria-hidden="true"></span> Uploading…';
    stateEl.innerHTML = '';
    const form = new FormData();
    form.append('logo', file);
    let result;
    try {
      const response = await fetch('/api/v1/settings/school/logo', {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + localStorage.getItem('mgaems_token') },
        body: form,
      });
      if (!current()) { unlock(); return; }
      const payload = await response.json().catch(() => ({}));
      if (!current()) { unlock(); return; }
      if (response.status === 401) { unlock(); MGAEMS.logout(); return; }
      result = response.ok ? { ok: true, data: payload.data } : { ok: false, status: response.status, error: payload.error?.message || payload.message || 'Logo upload failed.' };
    } catch (error) {
      result = { ok: false, error: 'Could not reach the server. Check your connection.' };
    }
    unlock();
    if (!current()) return;
    button.disabled = false;
    button.innerHTML = '<i data-lucide="upload"></i> Upload Logo';
    if (!result.ok || !MGAEMS.schoolLogoURL(result.data?.logo_path)) {
      stateEl.innerHTML = MGAEMS.errorHTML(result.status === 403 ? 'You do not have permission to upload a school logo.' : result.error || 'The uploaded logo path could not be confirmed.');
      MGAEMS.initIcons();
      return;
    }
    state.settings.logo_path = result.data.logo_path;
    MGAEMS.updateSchoolSettings(state.settings, { refreshLogo: true });
    MGAEMS.toast('School logo uploaded.', 'success');
    renderSettings();
    draft.forEach(([id, value]) => { const control = document.getElementById(id); if (control) control.value = value; });
  }

  async function loadBackups() {
    if (!current()) return;
    const request = ++state.backupRequest;
    document.getElementById('backupSummary').textContent = '—';
    const target = document.getElementById('backupTable');
    target.innerHTML = MGAEMS.loadingHTML('Loading backups…');
    const result = await MGAEMS.get('/api/v1/backups');
    if (!current() || request !== state.backupRequest) return;
    if (!result.ok || !Array.isArray(result.data) || !result.data.every(backup => record(backup) && typeof backup.filename === 'string')) {
      document.getElementById('backupSummary').textContent = 'Unavailable';
      target.innerHTML = `${MGAEMS.errorHTML(result.status === 403 ? 'You do not have permission to view backups.' : result.error || 'Backups returned an unexpected response.')}<button class="btn btn-secondary btn-sm" id="retryBackups"><i data-lucide="refresh-cw"></i> Retry</button>`;
      target.querySelector('#retryBackups').addEventListener('click', loadBackups);
      MGAEMS.initIcons();
      return;
    }
    state.backups = result.data;
    document.getElementById('backupSummary').textContent = String(state.backups.length);
    if (!state.backups.length) {
      target.innerHTML = MGAEMS.emptyStateHTML('No database backups found', isSystemAdmin ? 'Create a backup to add the first file to the register.' : 'A System Administrator can create a backup.', 'database-backup');
      MGAEMS.initIcons();
      return;
    }
    target.innerHTML = `<div class="admin-table-wrap" role="region" aria-label="Administration table" tabindex="0"><table class="admin-table"><thead><tr><th scope="col">Backup file</th><th scope="col">Created</th><th scope="col">Size</th><th scope="col">Action</th></tr></thead><tbody>
      ${state.backups.map((backup, index) => `<tr><td class="admin-backup-name"><strong>${esc(backup.filename)}</strong><small>Database backup</small></td><td>${esc(dateTime(backup.created_at))}</td><td>${esc(formatBytes(backup.size_bytes))}</td><td>${isSystemAdmin ? `<button class="btn btn-secondary btn-sm" type="button" data-download-backup="${index}"><i data-lucide="download"></i> Download</button>` : '<span class="text-muted">System Administrator only</span>'}</td></tr>`).join('')}
    </tbody></table></div>`;
    target.querySelectorAll('[data-download-backup]').forEach(button => button.addEventListener('click', () => downloadBackup(state.backups[Number(button.dataset.downloadBackup)], button)));
    MGAEMS.initIcons();
  }

  async function createBackup() {
    if (!isSystemAdmin || !current() || state.working.has('backup')) return;
    state.working.add('backup');
    if (!await MGAEMS.confirmAction('Create database backup?', 'Create a new backup using the existing school backup service? This may take several minutes.', 'Create backup') || !current()) { state.working.delete('backup'); return; }
    const button = document.getElementById('createBackupBtn');
    button.disabled = true;
    button.innerHTML = '<span class="spinner admin-spinner" aria-hidden="true"></span> Creating backup…';
    const result = await MGAEMS.post('/api/v1/backups', {});
    state.working.delete('backup');
    if (!current()) return;
    button.disabled = false;
    button.innerHTML = '<i data-lucide="database-backup"></i> Create Backup';
    if (!result.ok || !record(result.data) || typeof result.data.filename !== 'string') {
      MGAEMS.toast(result.status === 403 ? 'Only a System Administrator can create backups.' : result.error || 'Backup creation could not be confirmed.', 'error');
      MGAEMS.initIcons();
      return;
    }
    MGAEMS.toast(`Backup created: ${result.data.filename}`, 'success');
    MGAEMS.initIcons();
    loadBackups();
  }

  async function downloadBackup(backup, button) {
    if (!isSystemAdmin || !current() || button.disabled) return;
    const filename = String(backup?.filename || '');
    if (!filename || filename !== filename.split(/[\\/]/).pop() || !filename.endsWith('.sql')) {
      MGAEMS.toast('This backup filename is invalid.', 'error');
      return;
    }
    button.disabled = true;
    button.innerHTML = '<span class="spinner admin-spinner" aria-hidden="true"></span> Downloading…';
    const result = await MGAEMS.download(`/api/v1/backups/${encodeURIComponent(filename)}/download`, filename, { isCurrent: current });
    if (!current() || result.stale) return;
    button.disabled = false;
    button.innerHTML = '<i data-lucide="download"></i> Download';
    if (!result.ok) {
      MGAEMS.toast(result.status === 403 ? 'Only a System Administrator can download backups.' : result.error, 'error');
      MGAEMS.initIcons();
      return;
    }
    MGAEMS.toast('Backup downloaded.', 'success');
    MGAEMS.initIcons();
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function loadUserRoleOptions() {
    if (!isSystemAdmin || !current()) return { ok: false, error: 'User management is unavailable.' };
    const result = await MGAEMS.get('/api/v1/roles');
    if (!current()) return { ok: false, stale: true };
    if (!result.ok) return { ok: false, error: result.error };
    if (!Array.isArray(result.data) || !result.data.every(role => record(role) && typeof role.name === 'string')) return { ok: false, error: 'Role choices returned an unexpected response.' };
    state.roles = result.data;
    return result;
  }

  async function openCreateUser() {
    if (!isSystemAdmin || !current() || state.modal && !state.modal.closed) return;
    if (!state.roles.length) {
      const result = await loadUserRoleOptions();
      if (!result.ok) { MGAEMS.toast(result.error, 'error'); return; }
      document.getElementById('userRoleFilter').insertAdjacentHTML('beforeend', state.roles.map(role => `<option value="${esc(role.name)}">${esc(prettyRole(role.name))}</option>`).join(''));
    }
    createModal('Create User', `
      <div id="userFormAlert"></div>
      <div class="admin-user-note">A new user starts with Active account status. Staff-dependent roles require a separately verified active Staff link before access is available. Passwords are write-only.</div>
      <div class="form-grid">
        <div class="field"><label for="newUsername">Username *</label><input id="newUsername" maxlength="100" autocomplete="off" required></div>
        <div class="field"><label for="newEmail">Email *</label><input id="newEmail" type="email" maxlength="150" autocomplete="off" required></div>
        <div class="field"><label for="newRole">Role *</label><select id="newRole" required><option value="">Select role…</option>${state.roles.filter(role => role.name !== 'student').map(role => `<option value="${esc(role.name)}">${esc(prettyRole(role.name))}</option>`).join('')}</select></div>
        <div class="field"><label for="newPassword">Initial password *</label><input id="newPassword" type="password" minlength="10" autocomplete="new-password" required></div>
      </div>
    `, 'Create User', async button => {
      const payload = {
        username: document.getElementById('newUsername').value.trim(),
        email: document.getElementById('newEmail').value.trim(),
        role: document.getElementById('newRole').value,
        password: document.getElementById('newPassword').value,
      };
      if (!payload.username || !payload.email || !payload.role || payload.password.length < 10) { showUserError('Complete all fields and use a password of at least 10 characters.'); return; }
      await submitUser(button, 'Creating…', () => MGAEMS.post('/api/v1/users', payload), 'User created.');
    });
  }

  async function viewUser(id) {
    if (!isSystemAdmin || !current() || !validId(id) || state.modal && !state.modal.closed) return;
    const overlay = createModal('User Account', MGAEMS.loadingHTML('Loading user account…'), 'Close');
    if (!overlay) return;
    const handle = state.modal;
    const result = await MGAEMS.get(`/api/v1/users/${id}`);
    if (!current() || handle.closed || state.modal !== handle) return;
    const body = handle.body;
    if (!result.ok || !record(result.data) || String(result.data.id) !== String(id)) { body.innerHTML = MGAEMS.errorHTML(result.status === 403 ? 'You do not have permission to view this account.' : result.error || 'The requested account identity could not be confirmed.'); MGAEMS.initIcons(); return; }
    const account = result.data;
    body.innerHTML = `<dl class="admin-detail-grid"><div><dt>Username</dt><dd>${esc(account.username)}</dd></div><div><dt>Email</dt><dd>${esc(account.email)}</dd></div><div><dt>Role</dt><dd>${esc(prettyRole(account.role))}</dd></div><div><dt>Status</dt><dd>${esc(account.status)}</dd></div><div><dt>Last login</dt><dd>${esc(dateTime(account.last_login_at))}</dd></div><div><dt>Created</dt><dd>${esc(dateTime(account.created_at))}</dd></div></dl><p class="admin-user-note">Passwords, password hashes, and authentication tokens are not available in account details.</p>`;
  }

  async function editUser(id) {
    if (!isSystemAdmin || !current() || !validId(id) || state.modal && !state.modal.closed) return;
    const request = ++state.accountRequest;
    const [userResult, rolesResult] = await Promise.all([MGAEMS.get(`/api/v1/users/${id}`), loadUserRoleOptions()]);
    if (!current() || request !== state.accountRequest || state.modal && !state.modal.closed) return;
    if (!userResult.ok) { MGAEMS.toast(userResult.status === 403 ? 'You do not have permission to edit users.' : userResult.error, 'error'); return; }
    if (!rolesResult.ok) { MGAEMS.toast(rolesResult.error, 'error'); return; }
    const account = userResult.data;
    if (!record(account) || String(account.id) !== String(id)) { MGAEMS.toast('The requested account identity could not be confirmed.', 'error'); return; }
    createModal(`Edit ${account.username}`, `
      <div id="userFormAlert"></div>
      <div class="admin-user-note">Username cannot be changed here. Password is not displayed or changed by this form.</div>
      <div class="form-grid">
        <div class="field"><label for="editUserName">Username</label><input id="editUserName" class="admin-readonly" value="${esc(account.username)}" readonly></div>
        <div class="field"><label for="editUserEmail">Email *</label><input id="editUserEmail" type="email" maxlength="150" value="${esc(account.email)}" required></div>
        <div class="field"><label for="editUserRole">Role</label><select id="editUserRole">${state.roles.filter(role => role.name !== 'student' || account.role === 'student').map(role => `<option value="${esc(role.name)}" ${role.name === account.role ? 'selected' : ''}>${esc(prettyRole(role.name))}</option>`).join('')}</select></div>
        <div class="field"><label for="editUserStatus">Status</label><select id="editUserStatus"><option value="active" ${account.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${account.status === 'inactive' ? 'selected' : ''}>Inactive</option><option value="locked" ${account.status === 'locked' ? 'selected' : ''}>Locked</option></select></div>
      </div>
    `, 'Save Changes', async button => {
      const payload = {
        email: document.getElementById('editUserEmail').value.trim(),
        role: document.getElementById('editUserRole').value,
        status: document.getElementById('editUserStatus').value,
      };
      if (!payload.email) { showUserError('Email is required.'); return; }
      await submitUser(button, 'Saving…', () => MGAEMS.patch(`/api/v1/users/${account.id}`, payload), 'User account updated.',
        payload.role !== account.role || payload.status !== account.status ? `Change ${account.username} to ${prettyRole(payload.role)} / ${payload.status}? Role and status changes can revoke sessions. Staff eligibility and protection of the last active Administrator remain enforced by the server.` : null);
    });
  }

  async function deactivateUser(id) {
    if (!isSystemAdmin || !current() || !validId(id) || state.working.has('account-' + id)) return;
    const account = state.users?.find(item => Number(item.id) === Number(id));
    if (!account || account.status !== 'active') return;
    state.working.add('account-' + id);
    if (!await MGAEMS.confirmAction('Deactivate account?', `Deactivate ${account.username}? The account record is preserved, and existing sessions are revoked by the server.`, 'Deactivate account') || !current()) { state.working.delete('account-' + id); return; }
    const result = await MGAEMS.del(`/api/v1/users/${id}`);
    state.working.delete('account-' + id);
    if (!current()) return;
    if (!result.ok) { MGAEMS.toast(result.status === 403 ? 'You do not have permission to deactivate users.' : result.error, 'error'); return; }
    MGAEMS.toast('User account deactivated.', 'success');
    loadUsers();
  }

  function createModal(title, content, submitLabel, onSubmit) {
    if (!current() || state.modal && !state.modal.closed) return null;
    const handle = MGAEMS.openModal({ title,
      body: onSubmit ? `<form id="adminUserForm">${content}</form>` : content,
      footer: onSubmit ? `<button class="btn btn-secondary" type="button" data-dialog-close>Cancel</button><button class="btn btn-primary" type="submit" form="adminUserForm" data-submit>${esc(submitLabel)}</button>` : '<button class="btn btn-secondary" type="button" data-dialog-close>Close</button>',
      onClose: () => { if (state.modal === handle) state.modal = null; } });
    const overlay = handle.overlay;
    overlay.className = 'modal-overlay administration-dialog';
    state.modal = handle;
    if (onSubmit) {
      const form = handle.body.querySelector('form');
      const names = { newUsername: 'username', newEmail: 'email', newRole: 'role', newPassword: 'password', editUserEmail: 'email', editUserRole: 'role', editUserStatus: 'status' };
      for (const input of form.elements) if (names[input.id || input.getAttribute('id')]) input.setAttribute('name', names[input.id || input.getAttribute('id')]);
      handle.body.querySelector('#userFormAlert').setAttribute('data-form-error', '');
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (current() && !handle.closed && !handle.adminBusy && form.reportValidity()) onSubmit(overlay.querySelector('[data-submit]'));
      });
    }
    MGAEMS.initIcons();
    return overlay;
  }

  function closeModal() { state.modal?.close(); }

  function showUserError(message) {
    const target = document.getElementById('userFormAlert');
    if (target) { target.innerHTML = MGAEMS.errorHTML(message); target.tabIndex = -1; target.focus(); MGAEMS.initIcons(); }
  }

  async function submitUser(button, busyLabel, request, successMessage, confirmation = null) {
    const handle = state.modal;
    if (!isSystemAdmin || !current() || !handle || handle.closed || handle.adminBusy) return;
    handle.adminBusy = true;
    const controls = [...handle.body.querySelectorAll('input, select')].map(control => [control, control.disabled]);
    controls.forEach(([control]) => { control.disabled = true; });
    handle.setBusy(true);
    button.innerHTML = `<span class="spinner admin-spinner" aria-hidden="true"></span> ${esc(busyLabel)}`;
    if (confirmation && !await MGAEMS.confirmAction('Review account change', confirmation, 'Save changes')) {
      controls.forEach(([control, disabled]) => { control.disabled = disabled; }); handle.setBusy(false); handle.adminBusy = false; button.textContent = 'Save Changes'; return;
    }
    if (!current() || handle.closed) { handle.setBusy(false); handle.close(); return; }
    const result = await request();
    controls.forEach(([control, disabled]) => { control.disabled = disabled; });
    handle.setBusy(false); handle.adminBusy = false;
    if (!current() || handle.closed || state.modal !== handle) { handle.close(); return; }
    if (!result.ok) {
      MGAEMS.showFormErrors(handle.body.querySelector('form'), { ...result, error: result.status === 403 ? 'You do not have permission to manage users.' : result.error });
      button.textContent = busyLabel === 'Creating…' ? 'Create User' : 'Save Changes';
      return;
    }
    closeModal();
    MGAEMS.toast(successMessage, 'success');
    loadUsers();
  }

  async function loadInitialData() {
    const tasks = [loadAuditLogs(), loadSettings(), loadBackups()];
    if (isSystemAdmin) {
      tasks.push(loadUserRoleOptions().then(result => {
        if (!result.ok) {
          if (!current()) return;
          document.getElementById('usersSummary').textContent = 'Unavailable';
          document.getElementById('usersTable').innerHTML = MGAEMS.errorHTML(result.error || 'Role options unavailable.') + '<button type="button" class="btn btn-secondary" id="retryRoles">Retry accounts</button>';
          document.getElementById('retryRoles').addEventListener('click', loadInitialData);
          MGAEMS.initIcons();
          return;
        }
        document.getElementById('userRoleFilter').insertAdjacentHTML('beforeend', state.roles.map(role => `<option value="${esc(role.name)}">${esc(prettyRole(role.name))}</option>`).join(''));
        loadUsers();
      }));
    }
    await Promise.all(tasks);
  }

  loadInitialData();
}
