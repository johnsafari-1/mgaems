/* Family-facing reads always capture the selected learner and recheck server ownership. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user) return;
  if (user.role !== 'parent_guardian') { window.location.href = MGAEMS.landingPage(user); return; }
  renderAppShell('/parent-portal.html');
  const main = document.getElementById('appMain'), esc = MGAEMS.escapeHTML;
  const token = localStorage.getItem('mgaems_token'), identity = JSON.stringify([user.id ?? null, user.username ?? null, user.role]);
  const state = { children: [], selected: '', epoch: 0, childrenRequest: 0, announcementsRequest: 0, attendanceRequest: 0, page: 1, from: '', to: '' };
  const byId = id => document.getElementById(id);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validId = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
  const uniqueRows = rows => Array.isArray(rows) && rows.every(row => object(row) && validId(row.id)) && new Set(rows.map(row => String(row.id))).size === rows.length;
  const dateValue = value => {
    const day = value == null || value === '' ? null : MGAEMS.schoolDate(value), parsed = day ? new Date(day + 'T12:00:00Z') : null;
    return parsed && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
  };
  const date = value => {
    const day = dateValue(value);
    return day ? `<time datetime="${esc(day)}">${esc(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(day + 'T12:00:00Z')))}</time>` : 'Not recorded';
  };
  function authorized() {
    const currentUser = MGAEMS.currentUser();
    if (token && localStorage.getItem('mgaems_token') === token && currentUser && JSON.stringify([currentUser.id ?? null, currentUser.username ?? null, currentUser.role]) === identity && window.location.pathname === '/parent-portal.html') return true;
    state.children = []; state.selected = ''; ++state.epoch; ++state.childrenRequest; ++state.announcementsRequest; ++state.attendanceRequest;
    main.innerHTML = MGAEMS.errorHTML('Your session changed. Reopen your authorized Parent / Guardian Portal.');
    return false;
  }
  const show = (target, html) => { target.innerHTML = html; target.setAttribute('aria-busy', 'false'); MGAEMS.initIcons(); };
  const label = value => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const statusBadge = value => `<span class="badge ${value === 'active' || value === 'present' ? 'badge-green' : value === 'absent' ? 'badge-red' : value === 'late' || value === 'transferred' ? 'badge-amber' : 'badge-gray'}">${esc(label(value))}</span>`;
  const period = item => [item.academic_year?.name, item.name].filter(Boolean).join(' · ');
  const base = id => '/api/v1/portal/parent/children/' + encodeURIComponent(id);
  main.innerHTML = `<div class="family-portal"><div class="workspace-heading"><div><p class="eyebrow">Your family workspace</p><h1>Parent / Guardian Portal</h1><p>Follow your children's attendance, learning and school updates.</p></div><button type="button" class="btn btn-secondary btn-sm" id="refreshFamily"><i data-lucide="refresh-cw" aria-hidden="true"></i>Refresh linked children</button></div><p class="workspace-note">Only children linked to your Guardian account appear here. School staff manage these links.</p>
    <div id="familyStatus" role="status" aria-busy="true"></div><div id="childSelector"></div><div id="familyChild"></div>
    <section class="card workspace-section family-section" id="familyAnnouncementsSection" tabindex="-1" aria-labelledby="familyAnnouncementsHeading"><h2 id="familyAnnouncementsHeading">School announcements</h2><div id="familyAnnouncements" aria-busy="true"></div></section></div>`;
  byId('refreshFamily').addEventListener('click', loadChildren);
  window.addEventListener('storage', event => { if (event.key == null || ['mgaems_token', 'mgaems_user'].includes(event.key)) authorized(); });
  const failure = (target, result, retry) => {
    show(target, result.status === 403 ? MGAEMS.emptyStateHTML('Access restricted', 'This information is not available to your account.', 'lock')
      : MGAEMS.errorHTML(result.error || 'The information could not be loaded.'));
    if (result.status !== 401) {
      target.innerHTML += '<button type="button" class="btn btn-secondary btn-sm" data-retry>Try again</button>';
      target.querySelector('[data-retry]').addEventListener('click', retry);
    }
  };
  async function loadChildren() {
    if (!authorized()) return;
    const request = ++state.childrenRequest, previous = state.selected;
    state.epoch++; state.attendanceRequest++; state.selected = ''; state.children = [];
    byId('childSelector').innerHTML = ''; byId('familyChild').innerHTML = '';
    const target = byId('familyStatus'); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading linked children…');
    const result = await MGAEMS.get('/api/v1/portal/parent/children');
    if (!authorized() || request !== state.childrenRequest) return;
    if (!result.ok) { failure(target, result, loadChildren); return; }
    if (!uniqueRows(result.data) || result.data.some(child => typeof child.first_name !== 'string' || typeof child.admission_no !== 'string' || (child.last_name != null && typeof child.last_name !== 'string') || (child.class != null && (!object(child.class) || typeof child.class.name !== 'string')))) { failure(target, { error: 'The server returned an unexpected learner list.' }, loadChildren); return; }
    state.children = result.data;
    if (!state.children.length) { show(target, MGAEMS.emptyStateHTML('No linked children', 'Contact the school to review your Guardian account links.', 'users')); return; }
    show(target, '');
    byId('childSelector').innerHTML = `<div class="family-selector"><span class="badge badge-navy">${state.children.length} linked ${state.children.length === 1 ? 'child' : 'children'}</span><label for="familyLearner">Choose a child</label><select id="familyLearner" aria-describedby="familySelectorHint">${state.children.map(child => `<option value="${esc(child.id)}">${esc(child.first_name)} ${esc(child.last_name)} · ${esc(child.admission_no)}</option>`).join('')}</select><p id="familySelectorHint">Attendance, results, report cards and timetable follow the selected child.</p><p id="familySelectionStatus" role="status" aria-live="polite"></p></div>`;
    byId('familyLearner').addEventListener('change', () => selectChild(byId('familyLearner').value));
    selectChild(state.children.some(child => String(child.id) === previous) ? previous : String(state.children[0].id));
  }
  function selectChild(id) {
    if (!authorized()) return;
    const child = state.children.find(item => String(item.id) === String(id));
    if (!child) return;
    state.selected = String(child.id); state.page = 1; state.from = ''; state.to = ''; state.attendanceRequest++;
    const epoch = ++state.epoch; byId('familyLearner').value = state.selected;
    byId('familySelectionStatus').textContent = `Viewing ${child.first_name} ${child.last_name} · ${child.admission_no}`;
    byId('familyChild').innerHTML = `<nav class="family-navigation" aria-label="Selected child sections"><a href="#familyOverviewSection">Overview</a><a href="#familyAttendanceSection">Attendance</a><a href="#familyProgressSection">Progress</a><a href="#familyCardsSection">Report cards</a><a href="#familyTimetableSection">Timetable</a><a href="#familyAnnouncementsSection">Announcements</a></nav>
      <section class="card workspace-section family-section" id="familyOverviewSection" tabindex="-1" aria-labelledby="selectedChildHeading"><h2 id="selectedChildHeading">${esc(child.first_name)} ${esc(child.last_name)}</h2><div id="familyOverview" aria-busy="true"></div></section>
      <section class="card workspace-section family-section" id="familyAttendanceSection" tabindex="-1" aria-labelledby="familyAttendanceHeading"><h2 id="familyAttendanceHeading">Attendance</h2><p class="text-muted">View recorded attendance by date. Days without a record are not counted as absences.</p><form id="familyAttendanceFilter"><div data-form-error></div><div class="family-date-filter">
        <div class="field"><label for="familyFrom">From</label><input type="date" id="familyFrom" name="from"></div><div class="field"><label for="familyTo">To</label><input type="date" id="familyTo" name="to"></div><button type="submit" class="btn btn-secondary">Filter records</button><button type="button" class="btn btn-secondary" id="familyClearDates">Clear dates</button></div></form>
        <div id="familyAttendance" aria-live="polite" aria-busy="true"></div></section>
      <section class="card workspace-section family-section" id="familyProgressSection" tabindex="-1" aria-labelledby="familyProgressHeading"><h2 id="familyProgressHeading">Academic progress</h2><p class="text-muted">Results shown here come from available report cards. Continuous and end-term results remain separate.</p><div id="familyProgress" aria-busy="true"></div></section>
      <section class="card workspace-section family-section" id="familyCardsSection" tabindex="-1" aria-labelledby="familyCardsHeading"><h2 id="familyCardsHeading">Available report cards</h2><p class="text-muted">Download the school reports currently available for this child.</p><div id="familyCards" aria-busy="true"></div></section>
      <section class="card workspace-section family-section" id="familyTimetableSection" tabindex="-1" aria-labelledby="familyTimetableHeading"><h2 id="familyTimetableHeading">Current available class timetable</h2><p class="text-muted">The current class's recurring weekly lessons. This is not a historical timetable.</p><div id="familyTimetable" aria-busy="true"></div></section>`;
    byId('familyAttendanceFilter').addEventListener('submit', event => {
      event.preventDefault();
      if (!current(child, epoch)) return;
      const form = byId('familyAttendanceFilter'), from = byId('familyFrom').value, to = byId('familyTo').value;
      const invalid = {};
      if (from && dateValue(from) !== from) invalid.from = ['Enter a valid start date.'];
      if (to && dateValue(to) !== to) invalid.to = ['Enter a valid end date.'];
      if (Object.keys(invalid).length) { MGAEMS.showFormErrors(form, { error: 'Check the attendance dates.', fields: invalid }); return; }
      if (from && to && from > to) { MGAEMS.showFormErrors(form, { error: 'Check the attendance date range.', fields: { to: ['The end date must be on or after the start date.'] } }); return; }
      form.querySelector('[data-form-error]').innerHTML = ''; form.querySelectorAll('[aria-invalid]').forEach(control => control.removeAttribute('aria-invalid'));
      state.from = from; state.to = to; state.page = 1; loadAttendance(child, epoch);
    });
    byId('familyClearDates').addEventListener('click', () => { if (!current(child, epoch)) return; byId('familyFrom').value = ''; byId('familyTo').value = ''; state.from = ''; state.to = ''; state.page = 1; const form = byId('familyAttendanceFilter'); form.querySelector('[data-form-error]').innerHTML = ''; form.querySelectorAll('[aria-invalid]').forEach(control => control.removeAttribute('aria-invalid')); loadAttendance(child, epoch); byId('familyFrom').focus(); });
    byId('familyChild').querySelectorAll('a').forEach(link => link.addEventListener('click', () => { if (current(child, epoch)) byId(link.getAttribute('href').slice(1))?.focus(); }));
    loadPane(child, epoch, 'familyOverview', '', renderOverview);
    loadAttendance(child, epoch);
    loadPane(child, epoch, 'familyProgress', '/progress', (data, meta, target) => renderProgress(data, meta, target, child, epoch));
    loadPane(child, epoch, 'familyCards', '/report-cards', (data, meta, target) => renderCards(data, target, child, epoch));
    loadPane(child, epoch, 'familyTimetable', '/timetable', renderTimetable);
  }
  function current(child, epoch) { return authorized() && state.epoch === epoch && state.selected === String(child.id); }
  function revokeChild(child, epoch) {
    if (!current(child, epoch)) return;
    state.epoch++; state.attendanceRequest++; state.selected = '';
    byId('childSelector').innerHTML = ''; byId('familyChild').innerHTML = '';
    show(byId('familyStatus'), MGAEMS.emptyStateHTML('Learner access unavailable', 'Refresh linked children or contact the school to review your Guardian relationships.', 'lock'));
  }
  async function loadPane(child, epoch, id, suffix, render) {
    if (!current(child, epoch)) return;
    const target = byId(id); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading child information…');
    const result = await MGAEMS.get(base(child.id) + suffix);
    if (!current(child, epoch)) return;
    if (result.status === 403) { revokeChild(child, epoch); return; }
    if (!result.ok) { failure(target, result, () => loadPane(child, epoch, id, suffix, render)); return; }
    try { if (!suffix && (!object(result.data) || String(result.data.id) !== String(child.id))) throw new Error('Wrong child overview'); render(result.data, result.meta, target); }
    catch { failure(target, { error: 'The server returned unexpected child information.' }, () => loadPane(child, epoch, id, suffix, render)); }
  }
  function renderOverview(child, meta, target) {
    if (!Array.isArray(child.current_periods || []) || (child.current_periods || []).some(item => !object(item))) throw new Error('Invalid academic periods');
    const periods = (child.current_periods || []).map(period).join(', ');
    show(target, `<dl class="admin-detail-grid"><div><dt>Admission identifier</dt><dd>${esc(child.admission_no)}</dd></div><div><dt>Class</dt><dd>${esc(child.class?.name || 'Not assigned')}</dd></div>
      <div><dt>Enrollment</dt><dd>${statusBadge(child.status)}</dd></div><div><dt>Current academic period</dt><dd>${esc(periods || 'No current period available')}</dd></div></dl>`);
  }
  async function loadAttendance(child, epoch) {
    if (!current(child, epoch)) return;
    const request = ++state.attendanceRequest, target = byId('familyAttendance');
    target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading attendance…');
    const params = new URLSearchParams({ page: state.page, per_page: 30 });
    if (state.from) params.set('from', state.from); if (state.to) params.set('to', state.to);
    const result = await MGAEMS.get(base(child.id) + '/attendance?' + params);
    if (!current(child, epoch) || request !== state.attendanceRequest) return;
    if (result.status === 403) { revokeChild(child, epoch); return; }
    if (!result.ok) { failure(target, result, () => loadAttendance(child, epoch)); return; }
    if (!object(result.data?.summary) || (result.data.student_id != null && String(result.data.student_id) !== String(child.id)) || !Array.isArray(result.data.records) || result.data.records.some(row => !object(row) || !['present', 'absent', 'late', 'excused'].includes(row.status) || !dateValue(row.date)) || !Number.isInteger(result.data.summary.total) || result.data.summary.total < 0 || !Number.isInteger(result.meta?.total) || result.meta.total < 0 || !Number.isInteger(result.meta.per_page) || result.meta.per_page < 1) { failure(target, { error: 'The server returned unexpected attendance data.' }, () => loadAttendance(child, epoch)); return; }
    const summary = result.data.summary, pages = Math.max(1, Math.ceil(result.meta.total / result.meta.per_page));
    if (summary.total !== result.meta.total || (!summary.total && result.data.records.length)) { failure(target, { error: 'The server returned inconsistent attendance totals.' }, () => loadAttendance(child, epoch)); return; }
    if (state.page > pages) { state.page = pages; loadAttendance(child, epoch); return; }
    if (!summary.total) { show(target, MGAEMS.emptyStateHTML('No recorded attendance', 'Missing attendance records are not treated as absences.', 'calendar')); return; }
    if (['total', 'present', 'absent', 'late', 'excused'].some(key => !Number.isInteger(summary[key]) || summary[key] < 0) || summary.present + summary.absent + summary.late + summary.excused !== summary.total || (summary.attendance_percentage != null && (!Number.isFinite(summary.attendance_percentage) || summary.attendance_percentage < 0 || summary.attendance_percentage > 100))) { failure(target, { error: 'The server returned unexpected attendance totals.' }, () => loadAttendance(child, epoch)); return; }
    const first = result.data.records.length ? (state.page - 1) * result.meta.per_page + 1 : 0;
    show(target, `<p>Recorded days in this selection: ${esc(summary.total)}. Attendance among recorded days: ${summary.attendance_percentage == null ? 'Unavailable' : esc(summary.attendance_percentage) + '%'}</p>
      <dl class="family-attendance-summary">${['present', 'absent', 'late', 'excused'].map(status => `<div><dt>${label(status)}</dt><dd>${esc(summary[status])}</dd></div>`).join('')}</dl>
      <ul class="family-records" aria-label="Recorded attendance dates and classes">${result.data.records.map(row => `<li class="family-attendance-record"><div><strong>${date(row.date)}</strong><span class="text-meta">Recorded class: ${esc(row.class?.name || 'Historical class unavailable')}</span></div>${statusBadge(row.status)}</li>`).join('')}</ul>
      <div class="pagination"><span role="status">Showing ${first}–${first ? first + result.data.records.length - 1 : 0} of ${result.meta.total} records · Page ${state.page} of ${pages}</span><button type="button" class="btn btn-secondary btn-sm" id="familyPrevious" ${state.page <= 1 ? 'disabled' : ''}>Previous</button><button type="button" class="btn btn-secondary btn-sm" id="familyNext" ${state.page >= pages ? 'disabled' : ''}>Next</button></div>`);
    byId('familyPrevious').addEventListener('click', () => { if (state.page > 1) { state.page--; loadAttendance(child, epoch); } });
    byId('familyNext').addEventListener('click', () => { if (state.page < pages) { state.page++; loadAttendance(child, epoch); } });
  }
  function renderProgress(rows, meta, target, child, epoch) {
    if (!Array.isArray(rows) || rows.some(row => !object(row))) throw new Error('Invalid progress');
    if (!rows.length) { show(target, MGAEMS.emptyStateHTML('No report-card results available', 'Available legacy PDFs may still be listed below. Contact the school about results awaiting publication.', 'book-open')); return; }
    const cards = items => `<div class="family-progress-grid">${items.map(row => `<article class="family-progress-record"><h3>${esc(row.subject || 'Unavailable')}</h3><p class="text-meta">${esc([row.academic_year, row.term].filter(Boolean).join(' · ') || 'Period not recorded')}</p><dl class="family-result-values"><div><dt>Assessment type</dt><dd>${esc(row.assessment_type === 'continuous' ? 'Continuous' : row.assessment_type === 'end_term' ? 'End-term' : row.assessment_type)}</dd></div><div><dt>Score</dt><dd>${esc(row.score ?? 'Not recorded')}</dd></div><div><dt>Performance level</dt><dd>${esc(row.competency_rating ?? 'Not recorded')}</dd></div><div><dt>Report date</dt><dd>${date(row.published_date)}</dd></div></dl>${row.remarks ? `<p class="family-copy"><strong>Remarks:</strong> ${esc(row.remarks)}</p>` : ''}</article>`).join('')}</div>`;
    show(target, `<div class="family-progress-toolbar"><div class="field"><label for="familyProgressSearch">Find a learning area or term</label><input type="search" id="familyProgressSearch" placeholder="Search available results"></div><div class="field"><label for="familyProgressType">Assessment type</label><select id="familyProgressType"><option value="">All types</option><option value="continuous">Continuous</option><option value="end_term">End-term</option></select></div></div><p id="familyProgressCount" class="text-muted" role="status">${rows.length} available result entries</p><div id="familyProgressRows">${cards(rows)}</div>`);
    const filter = () => {
      if (!current(child, epoch)) return;
      const query = byId('familyProgressSearch').value.trim().toLowerCase(), type = byId('familyProgressType').value;
      const items = rows.filter(row => (!query || [row.subject, row.term, row.academic_year].join(' ').toLowerCase().includes(query)) && (!type || row.assessment_type === type));
      byId('familyProgressCount').textContent = `${items.length} of ${rows.length} available result entries`;
      show(byId('familyProgressRows'), items.length ? cards(items) : MGAEMS.emptyStateHTML('No results match these filters', 'Change the learning area, term or assessment-type filter.', 'search'));
    };
    byId('familyProgressSearch').addEventListener('input', filter); byId('familyProgressType').addEventListener('change', filter);
  }
  function renderCards(cards, target, child, epoch) {
    if (!uniqueRows(cards) || cards.some(card => typeof card.download_available !== 'boolean')) throw new Error('Invalid reports');
    if (!cards.length) { show(target, MGAEMS.emptyStateHTML('No report cards available', 'The school has not made a report card available for this child.', 'file-text')); return; }
    show(target, cards.map(card => `<article class="family-report"><div><h3>${esc(card.term?.name || 'Report card')}</h3><div class="text-meta">Report date: ${date(card.generated_date)}</div><p class="family-copy">${esc(card.overall_remark || '')}</p>${card.download_available ? '<span class="badge badge-green">PDF available</span>' : ''}</div>
      ${card.download_available ? `<button type="button" class="btn btn-primary btn-sm" data-card="${esc(card.id)}" aria-label="Download ${esc(card.term?.name || 'report card')} for ${esc(child.first_name)} ${esc(child.last_name)}"><i data-lucide="download" aria-hidden="true"></i>Download PDF</button>` : '<span class="badge badge-gray">File unavailable</span>'}</article>`).join('') + '<p id="familyDownloadStatus" role="status" aria-live="polite"></p>');
    target.querySelectorAll('[data-card]').forEach(button => button.addEventListener('click', async () => {
      if (!current(child, epoch) || button.disabled) return;
      if (!cards.some(card => String(card.id) === button.dataset.card && card.download_available)) return;
      button.disabled = true; button.textContent = 'Downloading…';
      const status = byId('familyDownloadStatus'); status.textContent = 'Preparing the selected child’s report PDF…';
      const result = await MGAEMS.download(base(child.id) + '/report-cards/' + encodeURIComponent(button.dataset.card) + '/download', 'report-card-' + child.admission_no + '.pdf', { isCurrent: () => current(child, epoch) });
      if (!current(child, epoch)) return;
      button.disabled = false; button.textContent = 'Download PDF';
      if (result.status === 403) revokeChild(child, epoch);
      else {
        status.textContent = result.ok ? 'Report PDF download started.' : result.error || 'The report could not be downloaded. Try again or contact the school.';
        if (!result.ok && !result.cancelled) MGAEMS.toast(status.textContent, 'error');
      }
    }));
  }
  function renderTimetable(rows, meta, target) {
    if (!Array.isArray(rows)) throw new Error('Invalid timetable');
    if (!rows.length) { show(target, MGAEMS.emptyStateHTML('Current timetable unavailable', 'No eligible class lessons are available for this child in the current academic period.', 'calendar')); return; }
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    if (rows.some(row => !object(row) || !Number.isInteger(Number(row.day_of_week)) || Number(row.day_of_week) < 1 || Number(row.day_of_week) > 7 || typeof row.start_time !== 'string' || typeof row.end_time !== 'string')) throw new Error('Invalid lessons');
    const lessons = [...rows].sort((a, b) => Number(a.day_of_week) - Number(b.day_of_week) || a.start_time.localeCompare(b.start_time));
    show(target, `<div class="week-schedule" aria-label="Current weekly class lessons">${days.map((day, index) => {
      const entries = lessons.filter(row => Number(row.day_of_week) === index + 1);
      return !entries.length ? '' : `<section class="schedule-day" aria-label="${day} lessons"><h3>${day}</h3><ul class="schedule-lessons">${entries.map(row => `<li class="schedule-lesson"><span class="lesson-time">${esc(row.start_time.slice(0, 5))}–${esc(row.end_time.slice(0, 5))}</span><strong>${esc(row.subject?.name)}</strong></li>`).join('')}</ul></section>`;
    }).join('')}</div>`);
  }
  async function loadAnnouncements() {
    if (!authorized()) return;
    const request = ++state.announcementsRequest;
    const target = byId('familyAnnouncements'); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading school announcements…');
    const result = await MGAEMS.get('/api/v1/announcements');
    if (!authorized() || request !== state.announcementsRequest) return;
    if (!result.ok) { failure(target, result, loadAnnouncements); return; }
    if (!Array.isArray(result.data) || result.data.some(item => !object(item) || typeof item.title !== 'string' || typeof item.body !== 'string' || (item.audience != null && !['parents', 'school_wide'].includes(item.audience)))) { failure(target, { error: 'The server returned unexpected announcements.' }, loadAnnouncements); return; }
    show(target, result.data.length ? `<div class="assignment-list">${result.data.map(item => `<article class="assignment-item"><div class="family-announcement-meta"><span class="badge badge-navy">${item.audience === 'parents' ? 'Parent / Guardian' : item.audience === 'school_wide' ? 'School-wide' : 'School update'}</span><span class="text-meta">Published ${date(item.published_at)}</span></div><h3>${esc(item.title)}</h3><p class="family-copy">${esc(item.body)}</p></article>`).join('')}</div>`
      : MGAEMS.emptyStateHTML('No school announcements', 'School-wide and Parent announcements will appear here.', 'megaphone'));
  }
  loadChildren(); loadAnnouncements();
})();
