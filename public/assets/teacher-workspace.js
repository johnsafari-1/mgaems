/* Teacher reads share one UI; Attendance and Assessment keep their existing editors. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user) return;
  const page = window.location.pathname;
  if (user.role !== 'teacher') {
    if (page === '/teacher-timetable.html') window.location.href = MGAEMS.landingPage(user);
    return;
  }
  if (!['/dashboard.html', '/students.html', '/teacher-timetable.html'].includes(page)) return;
  renderAppShell(page);
  const main = document.getElementById('appMain'), esc = MGAEMS.escapeHTML;
  const learnersPage = page === '/students.html', timetablePage = page === '/teacher-timetable.html';
  const state = { context: null, page: 1, pages: 1, request: 0, setupRequest: 0, timetableRequest: 0, search: '', classId: '', learnerModal: null, safetyRequest: 0 };
  function clearLearner() {
    state.safetyRequest++;
    if (state.learnerModal) { state.learnerModal.body.innerHTML = ''; state.learnerModal.close(); state.learnerModal = null; }
  }
  const byId = id => document.getElementById(id);
  const period = item => [item.academic_year?.name, item.name].filter(Boolean).join(' · ');
  const show = (target, html) => { target.innerHTML = html; target.setAttribute('aria-busy', 'false'); MGAEMS.initIcons(); };
  const link = (href, label) => `<a class="btn btn-secondary btn-sm" href="${href}">${label}</a>`;
  const failure = (target, result, retry) => {
    const denied = result.status === 403;
    show(target, denied ? MGAEMS.emptyStateHTML('Teacher access restricted', 'An active account linked to active teaching Staff is required.', 'lock')
      : MGAEMS.errorHTML(result.error || 'The requested information could not be loaded.'));
    if (result.status !== 401) {
      target.innerHTML += '<button type="button" class="btn btn-secondary btn-sm" data-retry>Try again</button>';
      target.querySelector('[data-retry]').addEventListener('click', retry);
    }
  };
  main.innerHTML = `<div class="workspace-heading"><div><h1>${learnersPage ? 'My Learners' : timetablePage ? 'My Timetable' : 'Teacher Workspace'}</h1>
    <p>${learnersPage ? 'Active learners in your current Class Teacher or eligible subject assignments.' : timetablePage ? 'Your assigned lessons, organized by weekday.' : 'Your classes, teaching assignments and weekly lessons in one place.'}</p></div>${timetablePage ? link('/dashboard.html', 'Teacher Workspace') : ''}</div>
    <div id="teacherSetup" role="status" aria-busy="true">${MGAEMS.loadingHTML('Loading teaching responsibilities…')}</div>
    <div id="teacherContent" hidden></div>`;

  async function setup() {
    clearLearner();
    const sequence = ++state.setupRequest;
    state.request++; state.timetableRequest++;
    state.context = null; byId('teacherContent').hidden = true; byId('teacherContent').innerHTML = '';
    const target = byId('teacherSetup'); target.hidden = false; target.setAttribute('aria-busy', 'true');
    target.innerHTML = MGAEMS.loadingHTML('Loading teaching responsibilities…');
    const result = await MGAEMS.get('/api/v1/teacher/context');
    if (sequence !== state.setupRequest) return;
    if (!result.ok) { failure(target, result, setup); return; }
    const context = result.data;
    if (!context || !['current_periods', 'class_teacher_classes', 'subject_assignments', 'learner_classes'].every(key => Array.isArray(context[key]))) {
      failure(target, { error: 'The server returned an unexpected teaching context.' }, setup); return;
    }
    state.context = context;
    target.hidden = true; target.setAttribute('aria-busy', 'false'); byId('teacherContent').hidden = false;
    const periods = context.current_periods.map(period).join(', ');
    byId('teacherContent').innerHTML = `<div class="context-banner"><p>${periods ? 'Current academic context: ' + esc(periods) : 'No eligible current academic term. Current class supervision remains available; subject assignments and timetable entries are unavailable.'}</p>
      <button type="button" class="btn btn-secondary btn-sm" id="refreshTeacher">Refresh responsibilities</button></div><div id="teacherView"></div>`;
    byId('refreshTeacher').addEventListener('click', setup);
    if (learnersPage) renderLearners();
    else if (timetablePage) renderTimetable();
    else renderOverview();
  }

  function renderOverview() {
    const classes = state.context.class_teacher_classes, subjects = state.context.subject_assignments;
    byId('teacherView').innerHTML = `<div class="stat-cards" aria-label="Your current responsibilities">${[['Class Teacher classes', classes.length], ['Subject allocations', subjects.length], ['Scoped learner classes', state.context.learner_classes.length]].map(([title, value]) => `<div class="card stat-card"><div class="label">${title}</div><div class="num">${value}</div><div class="detail">From your authorized responsibilities</div></div>`).join('')}</div><div class="workspace-grid">
      <section class="card workspace-duty" aria-labelledby="classTeacherHeading"><span class="badge badge-navy">Class supervision</span><h2 id="classTeacherHeading">Class Teacher responsibilities</h2><p>Record daily attendance and review the learners in your supervised classes.</p>
        <div class="assignment-list">${classes.length ? classes.map(item => `<article class="assignment-item"><strong>${esc(item.name)}</strong><div class="text-meta">${esc(item.level)} · Class Teacher</div></article>`).join('') : MGAEMS.emptyStateHTML('No Class Teacher classes', 'Subject assignments alone do not grant daily attendance management.', 'users')}</div>
        ${classes.length ? `<div class="form-actions">${link('/attendance.html', 'Manage class attendance')}${link('/students.html', 'My Learners')}</div>` : ''}</section>
      <section class="card workspace-duty" aria-labelledby="subjectTeacherHeading"><span class="badge badge-navy">Subject teaching</span><h2 id="subjectTeacherHeading">Subject Teacher responsibilities</h2><p>Assessment entry follows your class, subject and term assignments.</p>
        <div class="assignment-list">${subjects.length ? subjects.map(item => `<article class="assignment-item"><strong>${esc(item.subject.name)}</strong><div class="text-meta">${esc(item.school_class.name)}</div><div class="text-meta">${esc(period(item.term))}</div></article>`).join('') : MGAEMS.emptyStateHTML('No eligible subject assignments', 'Class Teacher ownership alone does not grant subject assessment entry.', 'book-open')}</div>
        ${subjects.length ? `<div class="form-actions">${link('/assessment.html', 'Enter assigned assessments')}${link('/students.html', 'My Learners')}${link('/teacher-timetable.html', 'My Timetable')}</div>` : ''}</section></div>
      <section class="card workspace-section" aria-labelledby="teacherTimetableHeading"><div class="section-header"><h2 id="teacherTimetableHeading">My Timetable</h2>${link('/teacher-timetable.html', 'Open weekly timetable')}</div><div id="teacherTimetable" aria-busy="true"></div></section>
      <div class="workspace-grid"><section class="card workspace-duty" aria-labelledby="teacherSafetyHeading"><h2 id="teacherSafetyHeading">Learner safety information</h2><p>Open an authorized learner in My Learners to see published actionable safety instructions. Current assignment scope remains required.</p><div class="form-actions">${link('/students.html', 'Open My Learners')}</div></section>
      <section class="card workspace-duty"><h2>School communication</h2><p>Read school announcements and your existing messages.</p><div class="form-actions">${link('/communication.html', 'School announcements and messages')}</div></section></div>`;
    loadTimetable(); MGAEMS.initIcons();
  }

  function renderTimetable() {
    byId('teacherView').innerHTML = '<section class="card workspace-section" aria-label="Assigned weekly lessons"><div id="teacherTimetable" aria-busy="true"></div></section>';
    loadTimetable();
  }
  async function loadTimetable() {
    const request = ++state.timetableRequest, target = byId('teacherTimetable');
    target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading your timetable…');
    const result = await MGAEMS.get('/api/v1/teacher/timetable');
    if (request !== state.timetableRequest) return;
    if (!result.ok) { failure(target, result, loadTimetable); return; }
    if (!Array.isArray(result.data) || result.data.some(item => !Number.isInteger(Number(item.day_of_week)) || Number(item.day_of_week) < 1 || Number(item.day_of_week) > 7 || typeof item.start_time !== 'string' || typeof item.end_time !== 'string')) { failure(target, { error: 'The server returned an unexpected timetable.' }, loadTimetable); return; }
    if (!result.data.length) { show(target, MGAEMS.emptyStateHTML('No eligible timetable entries', 'No existing lessons match your eligible current subject assignments.', 'calendar')); return; }
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const rows = [...result.data].sort((a, b) => Number(a.day_of_week) - Number(b.day_of_week) || a.start_time.localeCompare(b.start_time));
    show(target, `<p class="text-muted">Weekly teaching schedule · ${esc(rows.length)} assigned lesson${rows.length === 1 ? '' : 's'}.</p><p class="workspace-note">Recurring lessons matched to your current assignments. Academic period labels describe current eligibility.</p><div class="week-schedule" aria-label="Weekly assigned lessons">${days.map((day, index) => {
      const lessons = rows.filter(item => Number(item.day_of_week) === index + 1);
      return !lessons.length ? '' : `<section class="schedule-day" aria-label="${day} lessons"><h3>${day}</h3><ul class="schedule-lessons">${lessons.map(item => `<li class="schedule-lesson"><span class="lesson-time">${esc(item.start_time.slice(0, 5))}–${esc(item.end_time.slice(0, 5))}</span><strong>${esc(item.subject?.name)}</strong><span class="text-meta">${esc(item.school_class?.name)}</span><span class="text-meta">${esc((item.current_periods || []).map(period).join(', '))}</span></li>`).join('')}</ul></section>`;
    }).join('')}</div>`);
  }

  function renderLearners() {
    const classes = state.context.learner_classes;
    if (!classes.some(item => String(item.id) === state.classId)) state.classId = '';
    byId('teacherView').innerHTML = `<div class="card directory-card"><form id="myLearnerFilter"><div class="directory-filters">
      <div class="field"><label for="myLearnerSearch">Search assigned learners</label><input type="search" id="myLearnerSearch" maxlength="150" value="${esc(state.search)}" placeholder="Name or admission number"></div>
      <div class="field"><label for="myLearnerClass">Assigned class</label><select id="myLearnerClass"><option value="">All my assigned classes</option>${classes.map(item => `<option value="${esc(item.id)}" ${String(item.id) === state.classId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div>
      <div class="field"><span class="text-meta">Enrollment scope</span><p>Active learners only</p></div><button type="submit" class="btn btn-secondary">Search</button></div></form>
      <div id="myLearnerResults" aria-live="polite" aria-busy="true"></div><div class="pagination" id="myLearnerPagination"></div></div>`;
    byId('myLearnerFilter').addEventListener('submit', event => {
      event.preventDefault(); state.search = byId('myLearnerSearch').value.trim(); state.classId = byId('myLearnerClass').value; state.page = 1; loadLearners();
    });
    byId('myLearnerClass').addEventListener('change', () => {
      state.classId = byId('myLearnerClass').value; state.search = byId('myLearnerSearch').value.trim(); state.page = 1; loadLearners();
    });
    loadLearners();
  }
  async function loadLearners() {
    clearLearner();
    const request = ++state.request, target = byId('myLearnerResults');
    byId('myLearnerPagination').innerHTML = ''; target.setAttribute('aria-busy', 'true');
    target.innerHTML = MGAEMS.loadingHTML('Loading your assigned learners…');
    const params = new URLSearchParams({ page: state.page, per_page: 15 });
    if (state.search) params.set('search', state.search);
    if (state.classId) params.set('class_id', state.classId);
    const result = await MGAEMS.get('/api/v1/students?' + params);
    if (request !== state.request) return;
    if (!result.ok) { failure(target, result, loadLearners); return; }
    if (!Array.isArray(result.data) || !Number.isInteger(result.meta?.total) || !Number.isInteger(result.meta?.per_page) || result.meta.per_page < 1) {
      failure(target, { error: 'The server returned an unexpected learner response.' }, loadLearners); return;
    }
    state.pages = Math.max(1, Math.ceil(result.meta.total / result.meta.per_page));
    if (state.page > state.pages) { state.page = state.pages; loadLearners(); return; }
    if (!result.data.length) show(target, MGAEMS.emptyStateHTML('No assigned learners match', 'Only active learners within your current authorized assignments are available.', 'users'));
    else show(target, `<div class="table-scroll" role="region" aria-label="Assigned learner directory" tabindex="0"><table class="directory-table"><caption class="sr-only">Active learners in your authorized assignments</caption><thead><tr>${['Admission no.', 'Learner', 'Class', 'Enrollment', 'Action'].map(title => `<th scope="col">${title}</th>`).join('')}</tr></thead><tbody>${result.data.map(item => `<tr><td>${esc(item.admission_no)}</td>
      <td><span class="directory-name">${esc(item.first_name)} ${esc(item.last_name)}</span></td><td>${esc(item.school_class?.name)}</td><td><span class="badge badge-green">Active</span></td><td><button type="button" class="btn btn-secondary btn-sm" data-learner="${esc(item.id)}" aria-label="View ${esc(item.first_name)} ${esc(item.last_name)}">View learner</button></td></tr>`).join('')}</tbody></table></div>`);
    target.querySelectorAll('[data-learner]').forEach(button => button.addEventListener('click', () => openLearner(button.dataset.learner, button)));
    const pagination = byId('myLearnerPagination');
    pagination.innerHTML = `<span role="status">Page ${state.page} of ${state.pages} · ${result.meta.total} assigned learners</span>
      <button type="button" class="btn btn-secondary btn-sm" id="myLearnerPrevious" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
      <button type="button" class="btn btn-secondary btn-sm" id="myLearnerNext" ${state.page >= state.pages ? 'disabled' : ''}>Next</button>`;
    byId('myLearnerPrevious').addEventListener('click', () => { if (state.page > 1) { state.page--; loadLearners(); } });
    byId('myLearnerNext').addEventListener('click', () => { if (state.page < state.pages) { state.page++; loadLearners(); } });
  }
  async function openLearner(id, trigger) {
    clearLearner();
    const modal = MGAEMS.openModal({ title: 'Assigned learner', body: MGAEMS.loadingHTML('Loading learner…'), trigger, onClose: () => { modal.body.innerHTML = ''; if (state.learnerModal === modal) { state.learnerModal = null; state.safetyRequest++; } } });
    state.learnerModal = modal;
    const result = await MGAEMS.get('/api/v1/students/' + encodeURIComponent(id));
    if (modal.closed) return;
    if (!result.ok) { show(modal.body, result.status === 404 ? MGAEMS.emptyStateHTML('Learner unavailable', 'This learner is no longer available within your current assignment scope.', 'users') : MGAEMS.errorHTML(result.error || 'Learner details could not be loaded.')); return; }
    const learner = result.data;
    if (!learner || !Number.isInteger(learner.id) || learner.id !== Number(id)) { show(modal.body, MGAEMS.errorHTML('The server returned an unexpected learner response.')); return; }
    show(modal.body, `<dl class="admin-detail-grid"><div><dt>Admission no.</dt><dd>${esc(learner.admission_no)}</dd></div>
      <div><dt>Name</dt><dd>${esc(learner.first_name)} ${esc(learner.last_name)}</dd></div><div><dt>Class</dt><dd>${esc(learner.school_class?.name)}</dd></div><div><dt>Enrollment</dt><dd>${esc(learner.status)}</dd></div></dl><section class="health-safety" aria-label="Actionable learner safety information"><h2>Actionable safety information</h2><div id="teacherSafetyResult" role="status"></div></section>`);
    loadSafety(modal, learner.id);
  }
  async function loadSafety(modal, id) {
    const request = ++state.safetyRequest, target = modal.body.querySelector('#teacherSafetyResult');
    if (!target || modal.closed) return;
    target.innerHTML = MGAEMS.loadingHTML('Checking current safety scope…');
    // This endpoint is the complete allowed projection. Never fetch a full profile.
    const result = await MGAEMS.get('/api/v1/health/safety/learners/' + id);
    if ([401, 403].includes(result.status)) {
      state.safetyRequest++;
      if (state.learnerModal) show(state.learnerModal.body, MGAEMS.emptyStateHTML('Safety view unavailable', 'Refresh responsibilities or sign in again. This learner is no longer available under the current authorization.', 'lock'));
      return;
    }
    if (modal.closed || request !== state.safetyRequest || state.learnerModal !== modal) return;
    if (!result.ok) {
      show(target, MGAEMS.errorHTML(result.error || 'Safety information could not be loaded.') + '<button type="button" class="btn btn-secondary btn-sm" data-safety-retry>Try again</button>');
      target.querySelector('[data-safety-retry]').addEventListener('click', () => loadSafety(modal, id)); return;
    }
    if (result.data?.student_id !== id || !Array.isArray(result.data.alerts) || result.data.alerts.some(alert => !Number.isSafeInteger(alert.id) || typeof alert.alert_type !== 'string' || typeof alert.description !== 'string' || (alert.emergency_instructions != null && typeof alert.emergency_instructions !== 'string'))) { show(target, MGAEMS.errorHTML('The server returned an unexpected safety identity.')); return; }
    show(target, result.data.alerts.length ? result.data.alerts.map(alert => `<article class="health-record"><h3>${esc(String(alert.alert_type || '').replace(/_/g, ' '))}</h3><p class="health-copy">${esc(alert.description)}</p>${alert.emergency_instructions ? `<p class="health-copy"><strong>Action instructions:</strong> ${esc(alert.emergency_instructions)}</p>` : ''}</article>`).join('')
      : MGAEMS.emptyStateHTML('No current published safety alerts', 'This does not confirm an absence of allergies or other health concerns.', 'shield-check'));
  }
  window.addEventListener('pagehide', () => { clearLearner(); state.context = null; state.request++; state.setupRequest++; state.timetableRequest++; });
  window.addEventListener('pageshow', event => { if (event.persisted) setup(); });
  setup();
})();
