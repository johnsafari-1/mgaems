/* Daily class attendance uses the server's class-teacher scope and school date. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || MGAEMS.landingPage(user) !== '/dashboard.html') return;
  renderAppShell('/attendance.html');
  const main = document.getElementById('appMain');
  const esc = MGAEMS.escapeHTML;
  if (!['system_admin', 'head_teacher', 'deputy_head_teacher', 'teacher'].includes(user.role)) {
    main.innerHTML = MGAEMS.emptyStateHTML('Attendance access is restricted', 'Class teachers and school leadership manage daily attendance.', 'lock'); return;
  }
  const state = { classes: [], statuses: [], today: '', roster: null, rosterRequest: 0, historyRequest: 0, summaryRequest: 0, page: 1, dirty: false, busy: false, loading: false };
  const badges = { present: 'badge-green', absent: 'badge-red', late: 'badge-amber', excused: 'badge-navy' };
  const label = value => value.charAt(0).toUpperCase() + value.slice(1);
  const table = (headings, rows) => `<div class="table-scroll"><table><thead><tr>${headings.map(title => `<th scope="col">${title}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const options = (placeholder, chosen = '') => `<option value="">${placeholder}</option>` + state.classes.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(chosen) ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
  const byId = id => document.getElementById(id);
  const tabs = [['record', 'Record / Review'], ['history', 'History'], ['summary', 'Summary']];
  main.innerHTML = `<div class="page-heading"><h1>Attendance</h1><p>${user.role === 'teacher' ? 'Manage daily attendance for your Class Teacher classes.' : 'Review and manage attendance across configured classes.'}</p></div>
    <div id="attendanceSetup" role="status">${MGAEMS.loadingHTML('Loading permitted classes…')}</div>
    <div id="attendanceWorkspace" hidden>
      <div class="tabs" role="tablist" aria-label="Attendance sections">${tabs.map(([key, title], index) => `<button type="button" class="tab ${index ? '' : 'active'}" id="attendanceTab_${key}" role="tab" aria-selected="${!index}" aria-controls="attendancePanel_${key}" tabindex="${index ? -1 : 0}" data-tab="${key}">${title}</button>`).join('')}</div>
      <section id="attendancePanel_record" class="tab-panel active" role="tabpanel" aria-labelledby="attendanceTab_record">
        <div class="card"><form id="attendanceFilter"><div data-form-error></div><div class="form-grid">
          <div class="field"><label for="attendanceClass">Class *</label><select id="attendanceClass" name="class_id" required></select></div>
          <div class="field"><label for="attendanceDate">School date *</label><input type="date" id="attendanceDate" name="attendance_date" required></div></div>
          <button type="submit" class="btn btn-secondary" id="loadAttendance">Load roster</button></form>
          <p class="text-muted" id="attendanceDateNote"></p></div>
        <div id="attendanceRoster" aria-live="polite"></div>
      </section>
      <section id="attendancePanel_history" class="tab-panel" role="tabpanel" aria-labelledby="attendanceTab_history" hidden>
        <div class="card"><form id="attendanceHistoryFilter"><div data-form-error></div><div class="form-grid">
          <div class="field"><label for="historyClass">Class</label><select id="historyClass" name="class_id"></select></div>
          <div class="field"><label for="historyFrom">From</label><input id="historyFrom" name="from" type="date"></div>
          <div class="field"><label for="historyTo">To</label><input id="historyTo" name="to" type="date"></div></div>
          <button type="submit" class="btn btn-secondary">Filter history</button></form></div>
        <div id="attendanceHistory" aria-live="polite"></div>
      </section>
      <section id="attendancePanel_summary" class="tab-panel" role="tabpanel" aria-labelledby="attendanceTab_summary" hidden>
        <div class="card"><form id="attendanceSummaryFilter"><div data-form-error></div><div class="form-grid">
          <div class="field"><label for="summaryClass">Class *</label><select id="summaryClass" name="class_id" required></select></div>
          <div class="field"><label for="summaryFrom">From *</label><input id="summaryFrom" name="from" type="date" required></div>
          <div class="field"><label for="summaryTo">To *</label><input id="summaryTo" name="to" type="date" required></div></div>
          <button type="submit" class="btn btn-secondary">Load summary</button></form></div>
        <div id="attendanceSummary" aria-live="polite"></div>
      </section>
    </div>`;

  const tabControls = [...main.querySelectorAll('[data-tab]')];
  function selectTab(selected) {
    tabControls.forEach(tab => { const active = tab === selected; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; const panel = byId(tab.getAttribute('aria-controls')); panel.hidden = !active; panel.classList.toggle('active', active); });
  }
  tabControls.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => { const next = event.key === 'ArrowRight' ? tabControls[(index + 1) % 3] : event.key === 'ArrowLeft' ? tabControls[(index + 2) % 3] : event.key === 'Home' ? tabControls[0] : event.key === 'End' ? tabControls[2] : null; if (next) { event.preventDefault(); selectTab(next); next.focus(); } });
  });
  function show(target, html) { target.innerHTML = html; target.setAttribute('aria-busy', 'false'); MGAEMS.initIcons(); }
  function failure(target, result, retry) {
    show(target, MGAEMS.errorHTML(result.error || 'Attendance could not be loaded.') + '<button type="button" class="btn btn-secondary" data-retry>Try again</button>');
    target.querySelector('[data-retry]').addEventListener('click', retry);
  }
  async function setup() {
    byId('attendanceSetup').innerHTML = MGAEMS.loadingHTML('Loading permitted classes…');
    const result = await MGAEMS.get('/api/v1/attendance/my-classes');
    if (!result.ok) { failure(byId('attendanceSetup'), result, setup); return; }
    state.classes = result.data; state.statuses = result.meta.statuses; state.today = result.meta.today;
    if (!state.classes.length) { show(byId('attendanceSetup'), MGAEMS.emptyStateHTML('No permitted classes', 'An active teaching staff link and Class Teacher assignment are required. Subject allocations do not grant daily attendance access.', 'users')); return; }
    byId('attendanceSetup').hidden = true; byId('attendanceWorkspace').hidden = false;
    byId('attendanceClass').innerHTML = options('Select a class…'); byId('historyClass').innerHTML = options('All permitted classes'); byId('summaryClass').innerHTML = options('Select a class…');
    byId('attendanceDate').value = state.today;
    ['attendanceDate', 'historyFrom', 'historyTo', 'summaryFrom', 'summaryTo'].forEach(id => { byId(id).max = state.today; });
    ['historyFrom', 'summaryFrom'].forEach(id => { byId(id).value = state.today.slice(0, 7) + '-01'; });
    ['historyTo', 'summaryTo'].forEach(id => { byId(id).value = state.today; });
    byId('attendanceDateNote').textContent = `School dates use ${result.meta.timezone}. A missing record is not an absence. New rows use the current eligible roster; retained historical rows keep their original class.`;
    show(byId('attendanceRoster'), MGAEMS.emptyStateHTML('Select a class and date', 'Load the roster to record or review attendance.', 'calendar-check'));
    show(byId('attendanceSummary'), MGAEMS.emptyStateHTML('Select a class and date range', 'Counts include recorded attendance only.', 'bar-chart-3'));
    loadHistory();
  }
  function setRosterBusy(value) {
    state.busy = value;
    [...byId('attendanceFilter').elements].forEach(control => { control.disabled = value; });
    byId('attendanceRoster').querySelectorAll('select, button').forEach(control => { control.disabled = value || control.dataset.readonly === 'true'; });
    const save = byId('saveAttendance'); if (save) save.disabled = value || !state.dirty;
  }
  function rosterControls() { return [...byId('attendanceRoster').querySelectorAll('[data-learner]')]; }
  function updateDirty() {
    state.dirty = rosterControls().some(control => !control.disabled && control.value !== (state.roster.learners.find(item => String(item.id) === control.dataset.learner)?.status || ''));
    byId('saveAttendance').disabled = state.busy || !state.dirty;
    byId('attendanceUnsaved').textContent = state.dirty ? 'Unsaved status changes.' : 'No unsaved changes.';
  }
  async function selectionChanged() {
    if (state.busy || state.loading) return;
    if (state.dirty) {
      setRosterBusy(true);
      const discard = await MGAEMS.confirmAction('Discard unsaved attendance?', 'Load a different class/date and discard these unsaved selections?', 'Discard changes');
      setRosterBusy(false);
      if (!discard) { byId('attendanceClass').value = state.roster.class.id; byId('attendanceDate').value = state.roster.attendance_date; return; }
    }
    state.rosterRequest++; state.roster = null; state.dirty = false;
    show(byId('attendanceRoster'), MGAEMS.emptyStateHTML('Roster selection changed', 'Load the selected class/date before recording attendance.', 'calendar-check'));
  }
  byId('attendanceClass').addEventListener('change', selectionChanged); byId('attendanceDate').addEventListener('change', selectionChanged);
  byId('attendanceFilter').addEventListener('submit', event => { event.preventDefault(); loadRoster(); });
  async function loadRoster(force = false) {
    if (state.busy || state.loading || !byId('attendanceFilter').reportValidity()) return;
    if (!force && state.dirty) {
      setRosterBusy(true);
      const reload = await MGAEMS.confirmAction('Reload attendance?', 'Reloading discards unsaved status selections.', 'Reload roster');
      setRosterBusy(false);
      if (!reload) return;
    }
    const params = new URLSearchParams({ class_id: byId('attendanceClass').value, attendance_date: byId('attendanceDate').value });
    const sequence = ++state.rosterRequest; state.loading = true; state.roster = null; state.dirty = false;
    [...byId('attendanceFilter').elements].forEach(control => { control.disabled = true; });
    const target = byId('attendanceRoster'); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading attendance roster…');
    const result = await MGAEMS.get('/api/v1/attendance/roster?' + params);
    state.loading = false; [...byId('attendanceFilter').elements].forEach(control => { control.disabled = false; });
    if (sequence !== state.rosterRequest) return;
    if (!result.ok) { MGAEMS.showFormErrors(byId('attendanceFilter'), result); failure(target, result, () => loadRoster()); return; }
    byId('attendanceFilter').querySelector('[data-form-error]').innerHTML = '';
    state.roster = result.data; renderRoster();
  }
  function renderRoster() {
    const data = state.roster;
    if (!data.learners.length) { show(byId('attendanceRoster'), MGAEMS.emptyStateHTML('No eligible learners or retained records', 'This class/date has no eligible current learners or recorded historical attendance. No absences have been inferred.', 'users')); return; }
    const rows = data.learners.map((learner, index) => `<tr><td>${esc(learner.admission_no)}</td><td>${esc(learner.first_name)} ${esc(learner.last_name)}${learner.historical ? '<div class="text-muted">Historical class record</div>' : ''}</td>
      <td>${learner.status ? `<span class="badge ${badges[learner.status] || 'badge-gray'}">${esc(label(learner.status))}</span>` : `<span class="badge badge-gray">${learner.editable ? 'Not yet recorded' : 'Unavailable'}</span>`}</td>
      <td><label class="sr-only" for="attendanceStatus_${esc(learner.id)}">Status for ${esc(learner.first_name)} ${esc(learner.last_name)}</label><select class="compact-input" id="attendanceStatus_${esc(learner.id)}" name="records.${index}.status" data-learner="${esc(learner.id)}" data-readonly="${!learner.editable}" ${learner.editable ? '' : 'disabled'}>
      <option value="" ${learner.status ? 'disabled' : 'selected'}>${learner.editable ? 'Choose status…' : 'Unavailable'}</option>${state.statuses.map(status => `<option value="${esc(status)}" ${learner.status === status ? 'selected' : ''}>${esc(label(status))}</option>`).join('')}</select>${learner.unavailable_reason ? `<p class="text-muted">${esc(learner.unavailable_reason)}</p>` : ''}</td></tr>`);
    show(byId('attendanceRoster'), `<div class="card"><h2>${esc(data.class.name)} · ${esc(data.attendance_date)}</h2>
      <p>${data.recorded_count ? esc(data.recording_state === 'partially_recorded' ? 'Partially recorded' : 'Recorded attendance') : 'No attendance recorded for this roster'}: ${esc(data.recorded_count)} recorded; ${esc(data.unrecorded_count)} not yet recorded; ${esc(data.blocked_count)} unavailable.</p>
      <p class="text-muted">${state.statuses.map(status => `${esc(label(status))}: ${esc(data.counts[status])}`).join(' · ')}</p>
      <form id="attendanceRosterForm"><div data-form-error></div>${table(['Admission no.', 'Learner', 'Recorded status', 'Status selection'], rows)}
      <div class="form-actions"><button type="button" class="btn btn-secondary" id="markUnrecorded" ${data.unrecorded_count ? '' : 'disabled data-readonly="true"'}>Mark unrecorded present</button><button type="submit" class="btn btn-primary" id="saveAttendance" disabled>Save marked attendance</button></div>
      <p id="attendanceUnsaved" class="text-muted" role="status">No unsaved changes.</p></form></div>`);
    rosterControls().forEach(control => control.addEventListener('change', updateDirty));
    byId('markUnrecorded').addEventListener('click', async () => {
      if (state.busy) return;
      setRosterBusy(true);
      const mark = await MGAEMS.confirmAction('Mark unrecorded learners present?', 'Set the unrecorded learners in this roster to present? Recorded statuses remain as shown until you save.', 'Mark present');
      setRosterBusy(false);
      if (!mark) return;
      rosterControls().filter(control => !control.disabled && !control.value).forEach(control => { control.value = 'present'; }); updateDirty();
    });
    byId('attendanceRosterForm').addEventListener('submit', saveRoster);
  }
  async function saveRoster(event) {
    event.preventDefault(); if (state.busy || !state.dirty) return;
    const selected = rosterControls().filter(control => !control.disabled && control.value);
    const records = selected.map((control, index) => { control.name = `records.${index}.status`; return { student_id: Number(control.dataset.learner), status: control.value }; });
    if (!records.length) { MGAEMS.toast('Choose at least one attendance status.', 'error'); return; }
    const corrections = records.filter(input => { const before = state.roster.learners.find(item => item.id === input.student_id).status; return before && before !== input.status; }).length;
    setRosterBusy(true);
    if (corrections && !await MGAEMS.confirmAction('Correct recorded attendance?', `Save ${corrections} status correction(s) for this class/date? Changes will be audited.`, 'Save corrections')) { setRosterBusy(false); return; }
    byId('saveAttendance').textContent = 'Saving…';
    const result = await MGAEMS.post('/api/v1/attendance/students', { class_id: state.roster.class.id, attendance_date: state.roster.attendance_date, records });
    setRosterBusy(false); byId('saveAttendance').textContent = 'Save marked attendance';
    if (!result.ok) { MGAEMS.showFormErrors(byId('attendanceRosterForm'), result); selected.forEach((control, index) => { if (Object.keys(result.fields || {}).some(field => field.startsWith(`records.${index}.`))) control.setAttribute('aria-invalid', 'true'); }); return; }
    state.dirty = false;
    MGAEMS.toast(`Attendance saved: ${result.meta.created} new, ${result.meta.updated} corrected, ${result.meta.unchanged} unchanged.`, 'success');
    await loadRoster(true); loadHistory();
  }
  function rangeParams(prefix) {
    const params = new URLSearchParams();
    ['Class', 'From', 'To'].forEach(suffix => { const value = byId(prefix + suffix).value; if (value) params.set(suffix === 'Class' ? 'class_id' : suffix.toLowerCase(), value); }); return params;
  }
  byId('attendanceHistoryFilter').addEventListener('submit', event => { event.preventDefault(); state.page = 1; loadHistory(); });
  async function loadHistory() {
    if (!byId('attendanceHistoryFilter').reportValidity()) return;
    const params = rangeParams('history'); params.set('page', state.page); params.set('per_page', 25);
    const sequence = ++state.historyRequest; const target = byId('attendanceHistory'); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading attendance history…');
    const result = await MGAEMS.get('/api/v1/attendance/students?' + params);
    if (sequence !== state.historyRequest) return;
    if (!result.ok) { MGAEMS.showFormErrors(byId('attendanceHistoryFilter'), result); failure(target, result, loadHistory); return; }
    byId('attendanceHistoryFilter').querySelector('[data-form-error]').innerHTML = '';
    show(target, result.data.length ? `<div class="card card-table">${table(['Date', 'Learner', 'Recorded class', 'Status'], result.data.map(record => `<tr><td>${esc(record.attendance_date)}</td><td>${esc(record.student?.first_name)} ${esc(record.student?.last_name)}</td><td>${esc(record.school_class?.name)}</td><td><span class="badge ${badges[record.status] || 'badge-gray'}">${esc(label(record.status))}</span></td></tr>`))}<div class="pagination"><span>${esc(result.meta.total)} recorded attendance rows · Page ${esc(result.meta.page)}</span><div class="form-actions"><button type="button" class="btn btn-secondary btn-sm" data-page="-1" ${state.page <= 1 ? 'disabled' : ''}>Previous</button><button type="button" class="btn btn-secondary btn-sm" data-page="1" ${state.page * result.meta.per_page >= result.meta.total ? 'disabled' : ''}>Next</button></div></div></div>` : MGAEMS.emptyStateHTML('No recorded attendance matches', 'Missing attendance records are not counted as absences.', 'calendar-check'));
    target.querySelectorAll('[data-page]').forEach(control => control.addEventListener('click', () => { state.page += Number(control.dataset.page); loadHistory(); }));
  }
  byId('attendanceSummaryFilter').addEventListener('submit', event => { event.preventDefault(); loadSummary(); });
  async function loadSummary() {
    if (!byId('attendanceSummaryFilter').reportValidity()) return;
    const sequence = ++state.summaryRequest; const target = byId('attendanceSummary'); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading recorded attendance summary…');
    const result = await MGAEMS.get('/api/v1/attendance/students/summary?' + rangeParams('summary'));
    if (sequence !== state.summaryRequest) return;
    if (!result.ok) { MGAEMS.showFormErrors(byId('attendanceSummaryFilter'), result); failure(target, result, loadSummary); return; }
    byId('attendanceSummaryFilter').querySelector('[data-form-error]').innerHTML = '';
    const data = result.data;
    show(target, `<div class="stat-cards">${state.statuses.map(status => `<div class="card stat-card"><div class="num">${esc(data.counts[status])}</div><div class="label">${esc(label(status))}</div></div>`).join('')}</div><div class="card"><p>${esc(data.total_records)} recorded attendance rows.</p><p>${data.attendance_rate === null ? 'No attendance recorded; no rate is available.' : `Present-record rate: ${esc(data.attendance_rate)}%.`}</p><p class="text-muted">This existing rate counts present records divided by all recorded statuses. Missing records are excluded.</p></div>`);
  }
  window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
  setup(); MGAEMS.initIcons();
})();
