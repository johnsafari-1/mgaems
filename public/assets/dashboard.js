/* Read-only dashboard using existing, role-gated MGAEMS APIs. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || MGAEMS.landingPage(user) !== '/dashboard.html') return;
  renderAppShell('/dashboard.html');
  const esc = MGAEMS.escapeHTML;
  const leadership = ['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(user.role);
  const canReadLearners = leadership || user.role === 'teacher';

  document.getElementById('appMain').innerHTML = `
    <div class="page-heading"><h1>School dashboard</h1><p>Current school information and published updates.</p></div>
    <section class="section" aria-labelledby="overviewHeading">
      <div class="section-header"><h2 id="overviewHeading">School overview</h2></div>
      <div class="stat-cards" id="statsCards" aria-busy="true">${MGAEMS.loadingHTML('Loading school statistics…')}</div>
    </section>
    <div class="overview-grid">
      <section class="section" aria-labelledby="announcementsHeading">
        <div class="section-header"><h2 id="announcementsHeading">Latest announcements</h2></div>
        <div class="card" id="announcementsCard" aria-busy="true">${MGAEMS.loadingHTML('Loading announcements…')}</div>
      </section>
      <section class="section" aria-labelledby="learnersHeading">
        <div class="section-header"><h2 id="learnersHeading">Learner directory</h2>${canReadLearners ? '<a href="/students.html" class="btn btn-secondary btn-sm"><i data-lucide="arrow-right" aria-hidden="true"></i>View all</a>' : ''}</div>
        <p class="text-muted">First five learners, ordered by surname.</p>
        <div class="card card-table" id="studentsCard" aria-busy="true">${MGAEMS.loadingHTML('Loading learners…')}</div>
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
    element.innerHTML = MGAEMS.loadingHTML(label);
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

  function loadStats() {
    return loadPanel('statsCards', '/api/v1/reports/school-statistics', 'Loading school statistics…', stats => {
      if (!stats?.students || !stats?.staff || !stats?.attendance_today) throw new Error('Invalid statistics');
      const attendance = stats.attendance_today;
      const metrics = [
        ['Learners', stats.students.total, 'All learner statuses'],
        ['Staff', stats.staff.total, 'Registered staff records'],
        ['Active sponsorships', stats.active_sponsorships, 'Current active records'],
        ['Attendance today', attendance.rate === null ? 'Not recorded' : `${attendance.rate}%`, attendance.date],
      ];
      if (metrics.slice(0, 3).some(([, value]) => !Number.isFinite(value)) || (attendance.rate !== null && !Number.isFinite(attendance.rate))) throw new Error('Invalid metrics');
      return metrics.map(([label, value, detail]) => `<div class="card stat-card"><div class="num">${esc(value)}</div><div class="label">${esc(label)}</div><div class="detail">${esc(detail)}</div></div>`).join('');
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

  if (leadership) loadStats();
  else denied(document.getElementById('statsCards'), 'School statistics are available to school leadership.');
  if (canReadLearners) loadLearners();
  else denied(document.getElementById('studentsCard'), 'The learner directory is available to authorized teaching staff and leadership.');
  loadAnnouncements();
  MGAEMS.initIcons();
})();
