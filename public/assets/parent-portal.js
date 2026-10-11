/* Family-facing reads always capture the selected learner and recheck server ownership. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user) return;
  if (user.role !== 'parent_guardian') { window.location.href = MGAEMS.landingPage(user); return; }
  renderAppShell('/parent-portal.html');
  const main = document.getElementById('appMain'), esc = MGAEMS.escapeHTML;
  const state = { children: [], selected: '', epoch: 0, childrenRequest: 0, attendanceRequest: 0, page: 1, from: '', to: '' };
  const byId = id => document.getElementById(id);
  const show = (target, html) => { target.innerHTML = html; target.setAttribute('aria-busy', 'false'); MGAEMS.initIcons(); };
  const table = (headings, rows) => `<div class="table-scroll"><table><thead><tr>${headings.map(title => `<th scope="col">${title}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const period = item => [item.academic_year?.name, item.name].filter(Boolean).join(' · ');
  const base = id => '/api/v1/portal/parent/children/' + encodeURIComponent(id);
  main.innerHTML = `<div class="page-heading"><h1>Parent / Guardian Portal</h1><p>Educational information for children linked to your account.</p></div>
    <button type="button" class="btn btn-secondary btn-sm" id="refreshFamily">Refresh linked children</button>
    <div id="familyStatus" role="status" aria-busy="true"></div><div id="childSelector"></div><div id="familyChild"></div>
    <section class="section" aria-labelledby="familyAnnouncementsHeading"><h2 id="familyAnnouncementsHeading">School announcements</h2><div id="familyAnnouncements" aria-busy="true"></div></section>`;
  byId('refreshFamily').addEventListener('click', loadChildren);
  const failure = (target, result, retry) => {
    show(target, result.status === 403 ? MGAEMS.emptyStateHTML('Access restricted', 'This information is not available to your account.', 'lock')
      : MGAEMS.errorHTML(result.error || 'The information could not be loaded.'));
    if (result.status !== 401) {
      target.innerHTML += '<button type="button" class="btn btn-secondary btn-sm" data-retry>Try again</button>';
      target.querySelector('[data-retry]').addEventListener('click', retry);
    }
  };
  async function loadChildren() {
    const request = ++state.childrenRequest, previous = state.selected;
    state.epoch++; state.attendanceRequest++; state.selected = ''; state.children = [];
    byId('childSelector').innerHTML = ''; byId('familyChild').innerHTML = '';
    const target = byId('familyStatus'); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading linked children…');
    const result = await MGAEMS.get('/api/v1/portal/parent/children');
    if (request !== state.childrenRequest) return;
    if (!result.ok) { failure(target, result, loadChildren); return; }
    if (!Array.isArray(result.data)) { failure(target, { error: 'The server returned an unexpected learner list.' }, loadChildren); return; }
    state.children = result.data;
    if (!state.children.length) { show(target, MGAEMS.emptyStateHTML('No linked children', 'Contact the school to review your Guardian account links.', 'users')); return; }
    show(target, '');
    byId('childSelector').innerHTML = `<div class="card"><label for="familyLearner">Selected child</label><select id="familyLearner">${state.children.map(child => `<option value="${esc(child.id)}">${esc(child.first_name)} ${esc(child.last_name)} · ${esc(child.admission_no)}</option>`).join('')}</select></div>`;
    byId('familyLearner').addEventListener('change', () => selectChild(byId('familyLearner').value));
    selectChild(state.children.some(child => String(child.id) === previous) ? previous : String(state.children[0].id));
  }
  function selectChild(id) {
    const child = state.children.find(item => String(item.id) === String(id));
    if (!child) return;
    state.selected = String(child.id); state.page = 1; state.from = ''; state.to = ''; state.attendanceRequest++;
    const epoch = ++state.epoch; byId('familyLearner').value = state.selected;
    byId('familyChild').innerHTML = `<section class="section" aria-labelledby="selectedChildHeading"><h2 id="selectedChildHeading">${esc(child.first_name)} ${esc(child.last_name)}</h2><div class="card" id="familyOverview" aria-busy="true"></div></section>
      <section class="section" aria-labelledby="familyAttendanceHeading"><h2 id="familyAttendanceHeading">Attendance</h2><form id="familyAttendanceFilter" class="toolbar">
        <div class="field"><label for="familyFrom">From</label><input type="date" id="familyFrom"></div><div class="field"><label for="familyTo">To</label><input type="date" id="familyTo"></div><button type="submit" class="btn btn-secondary">Filter records</button></form>
        <div id="familyAttendance" aria-live="polite" aria-busy="true"></div></section>
      <section class="section" aria-labelledby="familyProgressHeading"><h2 id="familyProgressHeading">Academic progress</h2><p>Results shown here come from available report cards. Continuous and end-term results remain separate.</p><div id="familyProgress" aria-busy="true"></div></section>
      <section class="section" aria-labelledby="familyCardsHeading"><h2 id="familyCardsHeading">Available report cards</h2><div id="familyCards" aria-busy="true"></div></section>
      <section class="section" aria-labelledby="familyTimetableHeading"><h2 id="familyTimetableHeading">Current available class timetable</h2><p>This weekly schedule describes the current class. It is not a historical timetable.</p><div id="familyTimetable" aria-busy="true"></div></section>`;
    byId('familyAttendanceFilter').addEventListener('submit', event => {
      event.preventDefault(); state.from = byId('familyFrom').value; state.to = byId('familyTo').value; state.page = 1; loadAttendance(child, epoch);
    });
    loadPane(child, epoch, 'familyOverview', '', renderOverview);
    loadAttendance(child, epoch);
    loadPane(child, epoch, 'familyProgress', '/progress', renderProgress);
    loadPane(child, epoch, 'familyCards', '/report-cards', (data, meta, target) => renderCards(data, target, child, epoch));
    loadPane(child, epoch, 'familyTimetable', '/timetable', renderTimetable);
  }
  function current(child, epoch) { return state.epoch === epoch && state.selected === String(child.id); }
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
    try { render(result.data, result.meta, target); }
    catch { failure(target, { error: 'The server returned unexpected child information.' }, () => loadPane(child, epoch, id, suffix, render)); }
  }
  function renderOverview(child, meta, target) {
    const periods = (child.current_periods || []).map(period).join(', ');
    show(target, `<dl class="admin-detail-grid"><div><dt>Admission identifier</dt><dd>${esc(child.admission_no)}</dd></div><div><dt>Class</dt><dd>${esc(child.class?.name || 'Not assigned')}</dd></div>
      <div><dt>Enrollment</dt><dd>${esc(child.status)}</dd></div><div><dt>Current academic period</dt><dd>${esc(periods || 'No current period available')}</dd></div></dl>`);
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
    if (!result.data?.summary || !Array.isArray(result.data.records) || !Number.isInteger(result.meta?.total)) { failure(target, { error: 'The server returned unexpected attendance data.' }, () => loadAttendance(child, epoch)); return; }
    const summary = result.data.summary, pages = Math.max(1, Math.ceil(result.meta.total / result.meta.per_page));
    if (state.page > pages) { state.page = pages; loadAttendance(child, epoch); return; }
    if (!summary.total) { show(target, MGAEMS.emptyStateHTML('No recorded attendance', 'Missing attendance records are not treated as absences.', 'calendar')); return; }
    show(target, `<p>Recorded days in this selection: ${esc(summary.total)}. Attendance among recorded days: ${summary.attendance_percentage === null ? 'Unavailable' : esc(summary.attendance_percentage) + '%'}</p>
      <div class="stat-cards">${['present', 'absent', 'late', 'excused'].map(status => `<div class="card stat-card"><div class="num">${esc(summary[status])}</div><div class="label">${status[0].toUpperCase() + status.slice(1)}</div></div>`).join('')}</div>
      ${table(['Date', 'Recorded status', 'Recorded class'], result.data.records.map(row => `<tr><td>${esc(row.date)}</td><td>${esc(row.status)}</td><td>${esc(row.class?.name || 'Historical class unavailable')}</td></tr>`))}
      <div class="pagination"><span role="status">Page ${state.page} of ${pages}</span><button type="button" class="btn btn-secondary btn-sm" id="familyPrevious" ${state.page <= 1 ? 'disabled' : ''}>Previous</button><button type="button" class="btn btn-secondary btn-sm" id="familyNext" ${state.page >= pages ? 'disabled' : ''}>Next</button></div>`);
    byId('familyPrevious').addEventListener('click', () => { if (state.page > 1) { state.page--; loadAttendance(child, epoch); } });
    byId('familyNext').addEventListener('click', () => { if (state.page < pages) { state.page++; loadAttendance(child, epoch); } });
  }
  function renderProgress(rows, meta, target) {
    if (!Array.isArray(rows)) throw new Error('Invalid progress');
    if (!rows.length) { show(target, MGAEMS.emptyStateHTML('No report-card results available', 'Available legacy PDFs may still be listed below. Contact the school about results awaiting publication.', 'book-open')); return; }
    show(target, table(['Subject', 'Year / term', 'Assessment type', 'Score', 'Performance level', 'Remarks', 'Report date'], rows.map(row => `<tr><td>${esc(row.subject || 'Unavailable')}</td>
      <td>${esc([row.academic_year, row.term].filter(Boolean).join(' · '))}</td><td>${esc(row.assessment_type === 'continuous' ? 'Continuous' : row.assessment_type === 'end_term' ? 'End-term' : row.assessment_type)}</td>
      <td>${esc(row.score ?? 'Not recorded')}</td><td>${esc(row.competency_rating ?? 'Not recorded')}</td><td>${esc(row.remarks || '')}</td><td>${esc(row.published_date || '')}</td></tr>`)));
  }
  function renderCards(cards, target, child, epoch) {
    if (!Array.isArray(cards)) throw new Error('Invalid reports');
    if (!cards.length) { show(target, MGAEMS.emptyStateHTML('No report cards available', 'The school has not made a report card available for this child.', 'file-text')); return; }
    show(target, `<div class="record-list">${cards.map(card => `<article class="record-item"><div><strong>${esc(card.term?.name || 'Report card')}</strong><div class="text-meta">${esc(card.generated_date || '')}</div><p>${esc(card.overall_remark || '')}</p></div>
      ${card.download_available ? `<button type="button" class="btn btn-primary btn-sm" data-card="${esc(card.id)}">Download</button>` : '<span>File unavailable</span>'}</article>`).join('')}</div>`);
    target.querySelectorAll('[data-card]').forEach(button => button.addEventListener('click', async () => {
      if (!current(child, epoch) || button.disabled) return;
      button.disabled = true; button.textContent = 'Downloading…';
      const result = await MGAEMS.download(base(child.id) + '/report-cards/' + encodeURIComponent(button.dataset.card) + '/download', 'report-card-' + child.admission_no + '.pdf');
      button.disabled = false; button.textContent = 'Download';
      if (!current(child, epoch)) return;
      if (result.status === 403) revokeChild(child, epoch);
      else if (!result.ok) MGAEMS.toast(result.error || 'The report could not be downloaded.', 'error');
    }));
  }
  function renderTimetable(rows, meta, target) {
    if (!Array.isArray(rows)) throw new Error('Invalid timetable');
    if (!rows.length) { show(target, MGAEMS.emptyStateHTML('Current timetable unavailable', 'No eligible class lessons are available for this child in the current academic period.', 'calendar')); return; }
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    show(target, table(['Day', 'Time', 'Subject'], rows.map(row => `<tr><td>${esc(days[Number(row.day_of_week) - 1] || 'Unavailable')}</td><td>${esc(String(row.start_time).slice(0, 5))}–${esc(String(row.end_time).slice(0, 5))}</td><td>${esc(row.subject?.name)}</td></tr>`)));
  }
  async function loadAnnouncements() {
    const target = byId('familyAnnouncements'); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading school announcements…');
    const result = await MGAEMS.get('/api/v1/announcements');
    if (!result.ok) { failure(target, result, loadAnnouncements); return; }
    if (!Array.isArray(result.data)) { failure(target, { error: 'The server returned unexpected announcements.' }, loadAnnouncements); return; }
    show(target, result.data.length ? `<div class="record-list">${result.data.map(item => `<article class="record-item"><div><strong>${esc(item.title)}</strong><p>${esc(item.body)}</p></div></article>`).join('')}</div>`
      : MGAEMS.emptyStateHTML('No school announcements', 'School-wide and Parent announcements will appear here.', 'megaphone'));
  }
  loadChildren(); loadAnnouncements();
})();
