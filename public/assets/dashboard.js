/* Read-only dashboard using existing, role-gated MGAEMS APIs. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || MGAEMS.landingPage(user) !== '/dashboard.html') return;
  if (['teacher', 'sponsor_coordinator'].includes(user.role)) return; // Role workspaces own this page.
  renderAppShell('/dashboard.html');
  const esc = MGAEMS.escapeHTML;
  const leadership = ['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(user.role);
  const canReadLearners = leadership;
  const canReadCommunication = Object.hasOwn(MGAEMS_ROLE_NAV, user.role) && MGAEMS_ROLE_NAV[user.role].includes('communication');
  const quickKeys = ['students', 'attendance', 'assessment', 'academic', 'health', 'administration'].filter(key => leadership && MGAEMS_ROLE_NAV[user.role].includes(key));
  const quickLinks = quickKeys.map(key => { const item = MGAEMS_NAV_ITEMS[key]; return `<a class="quick-link" href="${item.href}"><i data-lucide="${item.icon}" aria-hidden="true"></i><span>${esc(item.label)}</span><i data-lucide="arrow-up-right" aria-hidden="true"></i></a>`; }).join('');

  document.getElementById('appMain').innerHTML = `
    <div class="page-heading"><span class="eyebrow">${leadership ? 'School leadership' : 'School communication'}</span><h1>${leadership ? 'School dashboard' : 'School updates'}</h1><p>${leadership ? 'An operational view of school records, academic readiness and today’s attendance.' : 'Published announcements available to your account.'}</p></div>
    ${leadership ? `
    <section class="section" aria-labelledby="overviewHeading">
      <div class="section-header"><h2 id="overviewHeading">School overview</h2></div>
      <div class="stat-cards" id="statsCards" aria-busy="true">${MGAEMS.loadingHTML('Loading school statistics…')}</div>
    </section>
    <div class="dashboard-grid">
      <div class="dashboard-stack">
        <section class="card section" aria-labelledby="periodHeading"><div class="section-header"><h2 id="periodHeading">Academic readiness</h2><a class="btn btn-secondary btn-sm" href="/academic.html">Open academics</a></div><div id="dashboardPeriod" aria-busy="true">${MGAEMS.loadingHTML('Loading academic context…')}</div></section>
        <section class="section" aria-labelledby="actionsHeading"><div class="section-header"><h2 id="actionsHeading">Common school operations</h2></div><div class="quick-links">${quickLinks}</div></section>
        <section class="section" aria-labelledby="learnersHeading">
          <div class="section-header"><h2 id="learnersHeading">Learner directory</h2><a href="/students.html" class="btn btn-secondary btn-sm">View all learners</a></div>
          <p class="text-muted">First five learners, ordered by surname.</p><div class="card card-table" id="studentsCard" aria-busy="true">${MGAEMS.loadingHTML('Loading learners…')}</div>
        </section>
      </div>` : '<div>'}
      <section class="section" aria-labelledby="announcementsHeading">
        <div class="section-header"><h2 id="announcementsHeading">Latest announcements</h2></div>
        ${canReadCommunication ? '<a class="section-link" href="/communication.html">Open communication</a>' : ''}<div class="card" id="announcementsCard" aria-busy="true">${MGAEMS.loadingHTML('Loading announcements…')}</div>
      </section>
    </div>`;

  function denied(element, description) {
    element.setAttribute('aria-busy', 'false');
    element.innerHTML = MGAEMS.emptyStateHTML('Access restricted', description, 'lock-keyhole');
    MGAEMS.initIcons();
  }

  function showFailure(element, result, retry) {
    element.setAttribute('aria-busy', 'false');
    if (result.status === 403) {
      denied(element, 'Your account does not have permission to view these records.');
      return;
    }
    element.innerHTML = `<div class="state-panel">${MGAEMS.errorHTML(result.status === 401 ? 'Session expired. Redirecting to sign in…' : result.error || 'The server returned an unexpected response.')}${result.status !== 401 ? '<button type="button" class="btn btn-secondary btn-sm">Try again</button>' : ''}</div>`;
    element.querySelector('button')?.addEventListener('click', retry);
    MGAEMS.initIcons();
  }

  // Keep failures independent: one unavailable API does not erase other cards.
  async function loadPanel(id, path, label, render, retry) {
    const element = document.getElementById(id);
    element.setAttribute('aria-busy', 'true');
    element.innerHTML = MGAEMS.loadingHTML(label, true);
    const result = await MGAEMS.get(path);
    if (!result.ok) { showFailure(element, result, retry); return; }
    try {
      element.innerHTML = render(result.data);
      element.setAttribute('aria-busy', 'false');
      MGAEMS.initIcons();
    } catch {
      showFailure(element, { error: 'The server returned an unexpected response.' }, retry);
    }
  }

  async function loadPeriod() {
    const element = document.getElementById('dashboardPeriod');
    element.setAttribute('aria-busy', 'true'); element.innerHTML = MGAEMS.loadingHTML('Loading academic context…');
    const [years, terms] = await MGAEMS.academicContext();
    const failure = !years.ok ? years : !terms.ok ? terms : null;
    if (failure || !Array.isArray(years.data) || !Array.isArray(terms.data)) { showFailure(element, failure || {}, loadPeriod); return; }
    const { year, term } = MGAEMS.academicPeriod(years.data, terms.data);
    element.innerHTML = year && term ? `<dl class="period-detail"><div><dt>Current academic year</dt><dd>${esc(year.name)}</dd></div><div><dt>Current term</dt><dd>${esc(term.name)}</dd></div></dl><p class="text-muted">${esc(MGAEMS.schoolDate(term.start_date))} to ${esc(MGAEMS.schoolDate(term.end_date))}</p>`
      : '<div class="setup-state"><strong>Academic setup required</strong><p>No complete, currently valid academic year and term are available. Review the existing calendar with authorized school leadership.</p></div>';
    element.setAttribute('aria-busy', 'false');
  }

  function loadStats() {
    return loadPanel('statsCards', '/api/v1/reports/school-statistics', 'Loading school statistics…', stats => {
      if (!stats?.students || !stats?.staff || !stats?.attendance_today) throw new Error('Invalid statistics');
      const attendance = stats.attendance_today;
      const activeLearners = stats.students.by_status?.active;
      const metrics = [
        [activeLearners == null ? 'Learners' : 'Active learners', activeLearners ?? stats.students.total, activeLearners == null ? 'All learner statuses' : 'Currently active enrollment'],
        ['Staff', stats.staff.total, 'Registered staff records'],
        ['Active sponsorships', stats.active_sponsorships, 'Current active records'],
        ['Attendance today', attendance.rate === null ? 'Not recorded' : `${attendance.rate}%`, attendance.date],
      ];
      if (metrics.slice(0, 3).some(([, value]) => !Number.isInteger(value) || value < 0) || (attendance.rate !== null && (!Number.isFinite(attendance.rate) || attendance.rate < 0 || attendance.rate > 100))) throw new Error('Invalid metrics');
      return metrics.map(([label, value, detail]) => `<div class="card stat-card"><div class="label">${esc(label)}</div><div class="num">${esc(value)}</div><div class="detail">${esc(detail)}</div></div>`).join('');
    }, loadStats);
  }

  function loadAnnouncements() {
    return loadPanel('announcementsCard', '/api/v1/announcements', 'Loading announcements…', announcements => {
      if (!Array.isArray(announcements)) throw new Error('Invalid announcements');
      if (!announcements.length) return MGAEMS.emptyStateHTML('No announcements yet', 'Published announcements will appear here.', 'megaphone');
      return announcements.slice(0, 5).map(item => `<article class="record-item"><div><div class="flex gap-2"><strong>${esc(item.title)}</strong><span class="badge badge-navy">${esc(String(item.audience || '').replace(/_/g, ' '))}</span></div><div class="record-body text-muted">${esc(item.body)}</div></div></article>`).join('');
    }, loadAnnouncements);
  }

  function loadLearners() {
    return loadPanel('studentsCard', '/api/v1/students?per_page=5', 'Loading learners…', learners => {
      if (!Array.isArray(learners)) throw new Error('Invalid learners');
      if (!learners.length) return MGAEMS.emptyStateHTML('No learners registered yet', 'Registered learners will appear here.', 'users');
      return `<table><caption class="sr-only">First five learners in the directory</caption><thead><tr><th scope="col">Admission no.</th><th scope="col">Name</th><th scope="col">Class</th><th scope="col">Status</th></tr></thead><tbody>${learners.map(item => `<tr><td>${esc(item.admission_no)}</td><td>${esc(item.first_name)} ${esc(item.last_name)}</td><td>${esc(item.school_class?.name || 'Unassigned')}</td><td><span class="badge ${item.status === 'active' ? 'badge-green' : 'badge-gray'}">${esc(item.status)}</span></td></tr>`).join('')}</tbody></table>`;
    }, loadLearners);
  }

  if (leadership) { loadStats(); loadPeriod(); }
  if (canReadLearners) loadLearners();
  loadAnnouncements();
  MGAEMS.initIcons();
})();
