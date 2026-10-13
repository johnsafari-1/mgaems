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
  const label = value => typeof value === 'string' && value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Unavailable';
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const identifier = value => (typeof value === 'number' || (typeof value === 'string' && /^[1-9]\d*$/.test(value)))
    && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const schoolDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(new Date(value + 'T00:00:00Z').getTime()) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  const knownStatus = value => typeof value === 'string' && Object.prototype.hasOwnProperty.call(badges, value);
  const validCounts = value => object(value) && Object.keys(badges).every(status => count(value[status]));
  const validClass = value => object(value) && identifier(value.id) && typeof value.name === 'string';
  function validSetup(result) {
    return Array.isArray(result.data) && result.data.every(validClass)
      && new Set(result.data.map(item => String(item.id))).size === result.data.length
      && object(result.meta) && schoolDate(result.meta.today) && typeof result.meta.timezone === 'string' && !!result.meta.timezone
      && Array.isArray(result.meta.statuses) && result.meta.statuses.length === Object.keys(badges).length
      && result.meta.statuses.every(knownStatus) && new Set(result.meta.statuses).size === result.meta.statuses.length;
  }
  function validRoster(data, params) {
    if (!object(data) || !validClass(data.class) || String(data.class.id) !== params.get('class_id')
      || !state.classes.some(item => String(item.id) === String(data.class.id)) || !schoolDate(data.attendance_date)
      || data.attendance_date !== params.get('attendance_date') || !Array.isArray(data.learners) || !validCounts(data.counts)
      || !['recorded_count', 'unrecorded_count', 'blocked_count'].every(key => count(data[key]))
      || !['not_recorded', 'partially_recorded', 'recorded'].includes(data.recording_state)) return false;
    const learners = data.learners;
    if (!learners.every(item => object(item) && identifier(item.id) && ['admission_no', 'first_name', 'last_name'].every(key => typeof item[key] === 'string')
      && (item.status === null || knownStatus(item.status)) && typeof item.editable === 'boolean'
      && (item.historical === undefined || typeof item.historical === 'boolean')
      && (item.unavailable_reason == null || typeof item.unavailable_reason === 'string'))
      || new Set(learners.map(item => String(item.id))).size !== learners.length) return false;
    return Object.keys(badges).every(status => data.counts[status] === learners.filter(item => item.status === status).length)
      && data.recorded_count === learners.filter(item => item.status !== null).length
      && data.unrecorded_count === learners.filter(item => item.status === null && item.editable).length
      && data.blocked_count === learners.filter(item => item.status === null && !item.editable).length;
  }
  function validHistory(result) {
    return Array.isArray(result.data) && result.data.every(row => object(row) && schoolDate(row.attendance_date) && knownStatus(row.status)
      && (row.student == null || (object(row.student) && typeof row.student.first_name === 'string' && typeof row.student.last_name === 'string'))
      && (row.school_class == null || (object(row.school_class) && typeof row.school_class.name === 'string')))
      && object(result.meta) && count(result.meta.total) && count(result.meta.page) && result.meta.page > 0
      && count(result.meta.per_page) && result.meta.per_page > 0;
  }
  function validSummary(data, context) {
    return object(data) && validCounts(data.counts) && count(data.total_records)
      && Object.keys(badges).reduce((total, status) => total + data.counts[status], 0) === data.total_records
      && (data.total_records === 0 ? data.attendance_rate === null : Number.isFinite(data.attendance_rate) && data.attendance_rate >= 0 && data.attendance_rate <= 100)
      && (data.from === undefined || data.from === context.from) && (data.to === undefined || data.to === context.to);
  }
  const table = (headings, rows) => `<div class="table-scroll attendance-table-scroll"><table class="attendance-table"><thead><tr>${headings.map(title => `<th scope="col">${title}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const options = (placeholder, chosen = '') => `<option value="">${placeholder}</option>` + state.classes.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(chosen) ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
  const byId = id => document.getElementById(id);
  const readableDate = value => schoolDate(value)
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z')) : value;
  const tabs = [['record', 'Record / Review'], ['history', 'History'], ['summary', 'Summary']];
  main.classList.toggle('attendance-workspace', true);
  main.innerHTML = `<div class="page-heading attendance-heading"><span class="eyebrow">Daily school records</span><h1>Attendance management</h1><p>${user.role === 'teacher' ? 'Manage daily attendance for your Class Teacher classes.' : 'Review and manage attendance across configured classes.'}</p><p class="attendance-policy-note">Choose each learner’s status explicitly. An unrecorded day remains unrecorded.</p></div>
    <div id="attendanceSetup" role="status">${MGAEMS.loadingHTML('Loading permitted classes…')}</div>
    <div id="attendanceWorkspace" hidden>
      <div class="tabs attendance-tabs" role="tablist" aria-label="Attendance sections">${tabs.map(([key, title], index) => `<button type="button" class="tab ${index ? '' : 'active'}" id="attendanceTab_${key}" role="tab" aria-selected="${!index}" aria-controls="attendancePanel_${key}" tabindex="${index ? -1 : 0}" data-tab="${key}">${title}</button>`).join('')}</div>
      <section id="attendancePanel_record" class="tab-panel active" role="tabpanel" aria-labelledby="attendanceTab_record">
        <div class="card attendance-filter-card"><div class="attendance-panel-heading"><h2>Class and school date</h2><p>Load the permitted roster before recording attendance.</p></div><form id="attendanceFilter"><div data-form-error></div><div class="form-grid">
          <div class="field"><label for="attendanceClass">Class *</label><select id="attendanceClass" name="class_id" required></select></div>
          <div class="field"><label for="attendanceDate">School date *</label><input type="date" id="attendanceDate" name="attendance_date" aria-describedby="attendanceDateNote" required></div></div>
          <button type="submit" class="btn btn-secondary" id="loadAttendance">Load roster</button></form>
          <p class="text-muted" id="attendanceDateNote"></p></div>
        <div id="attendanceRoster" aria-live="polite"></div>
      </section>
      <section id="attendancePanel_history" class="tab-panel" role="tabpanel" aria-labelledby="attendanceTab_history" hidden>
        <div class="card attendance-filter-card"><div class="attendance-panel-heading"><h2>Recorded attendance history</h2><p>Review saved statuses and the class recorded on each school date.</p></div><form id="attendanceHistoryFilter"><div data-form-error></div><div class="form-grid attendance-range-grid">
          <div class="field"><label for="historyClass">Class</label><select id="historyClass" name="class_id"></select></div>
          <div class="field"><label for="historyFrom">From</label><input id="historyFrom" name="from" type="date"></div>
          <div class="field"><label for="historyTo">To</label><input id="historyTo" name="to" type="date"></div></div>
          <button type="submit" class="btn btn-secondary">Filter history</button></form></div>
        <div id="attendanceHistory" aria-live="polite"></div>
      </section>
      <section id="attendancePanel_summary" class="tab-panel" role="tabpanel" aria-labelledby="attendanceTab_summary" hidden>
        <div class="card attendance-filter-card"><div class="attendance-panel-heading"><h2>Attendance summary</h2><p>Compare recorded statuses over an explicit date range.</p></div><form id="attendanceSummaryFilter"><div data-form-error></div><div class="form-grid attendance-range-grid">
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
  function clearFormErrors(form) {
    form.querySelector('[data-form-error]').innerHTML = '';
    form.querySelectorAll('[aria-invalid]').forEach(control => control.removeAttribute('aria-invalid'));
  }
  function failure(target, result, retry) {
    show(target, MGAEMS.errorHTML(result?.error || 'Attendance could not be loaded.') + '<button type="button" class="btn btn-secondary" data-retry>Try again</button>');
    target.querySelector('[data-retry]').addEventListener('click', retry);
  }
  async function setup() {
    byId('attendanceSetup').innerHTML = MGAEMS.loadingHTML('Loading permitted classes…');
    const result = await MGAEMS.get('/api/v1/attendance/my-classes');
    if (!result?.ok) { failure(byId('attendanceSetup'), result, setup); return; }
    if (!validSetup(result)) { failure(byId('attendanceSetup'), { error: 'Permitted classes or school-date settings could not be verified. Try loading again.' }, setup); return; }
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
    let changed = 0;
    const counts = Object.fromEntries(state.statuses.map(status => [status, 0]));
    let unselected = 0;
    rosterControls().forEach(control => {
      const learner = state.roster.learners.find(item => String(item.id) === control.dataset.learner);
      const dirty = learner.editable && control.value !== (learner.status || '');
      if (dirty) changed++;
      if (learner.editable) { if (control.value) counts[control.value]++; else unselected++; }
      byId('attendanceRow_' + learner.id).classList.toggle('attendance-row-dirty', dirty);
      byId('attendanceRowState_' + learner.id).textContent = dirty ? 'Unsaved change' : learner.status ? 'Saved status' : learner.editable ? 'Not yet recorded' : 'Unavailable';
      state.statuses.forEach(status => byId(`attendanceChoice_${learner.id}_${status}`).setAttribute('aria-pressed', String(control.value === status)));
    });
    state.dirty = changed > 0;
    byId('saveAttendance').disabled = state.busy || !state.dirty;
    byId('attendanceUnsaved').textContent = state.dirty ? `${changed} unsaved status change${changed === 1 ? '' : 's'}. Save to record them.` : 'No unsaved changes.';
    byId('attendanceUnsaved').classList.toggle('attendance-unsaved', state.dirty);
    byId('attendanceSelectedCounts').textContent = `Selected editable rows: ${state.statuses.map(status => `${label(status)} ${counts[status]}`).join(' · ')} · Not selected ${unselected}. Selections are saved only after confirmation.`;
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
    if (!result?.ok) { MGAEMS.showFormErrors(byId('attendanceFilter'), result || {}); failure(target, result, () => loadRoster()); return; }
    if (!validRoster(result.data, params)) { failure(target, { error: 'The attendance roster could not be verified for the selected class and date. Reload before recording attendance.' }, () => loadRoster()); return; }
    clearFormErrors(byId('attendanceFilter'));
    state.roster = result.data; renderRoster();
  }
  function renderRoster() {
    const data = state.roster;
    if (!data.learners.length) { show(byId('attendanceRoster'), MGAEMS.emptyStateHTML('No eligible learners or retained records', 'This class/date has no eligible current learners or recorded historical attendance. No absences have been inferred.', 'users')); return; }
    const rows = data.learners.map((learner, index) => `<tr id="attendanceRow_${esc(learner.id)}"><td data-label="Learner"><strong class="attendance-learner-name">${esc(learner.first_name)} ${esc(learner.last_name)}</strong><span class="text-meta">Admission no. ${esc(learner.admission_no)}</span>${learner.historical ? '<span class="text-meta">Historical class record</span>' : ''}</td>
      <td data-label="Recorded status">${learner.status ? `<span class="badge ${badges[learner.status] || 'badge-gray'}">${esc(label(learner.status))}</span>` : `<span class="badge badge-gray">${learner.editable ? 'Not yet recorded' : 'Unavailable'}</span>`}<span class="attendance-row-state" id="attendanceRowState_${esc(learner.id)}"></span></td>
      <td data-label="Choose status"><div class="attendance-status-buttons" role="group" aria-label="Attendance for ${esc(learner.first_name)} ${esc(learner.last_name)}">${state.statuses.map(status => `<button type="button" class="attendance-status-choice attendance-choice-${esc(status)}" id="attendanceChoice_${esc(learner.id)}_${esc(status)}" data-status-learner="${esc(learner.id)}" data-attendance-status="${esc(status)}" data-readonly="${!learner.editable}" aria-pressed="${learner.status === status}" ${learner.editable ? '' : 'disabled'}>${esc(label(status))}</button>`).join('')}</div><label class="attendance-select-label" for="attendanceStatus_${esc(learner.id)}">Status selection</label><select class="compact-input attendance-status-select" id="attendanceStatus_${esc(learner.id)}" name="records.${index}.status" data-learner="${esc(learner.id)}" data-readonly="${!learner.editable}" aria-describedby="attendanceRowError_${esc(learner.id)}" ${learner.editable ? '' : 'disabled'}>
      <option value="" ${learner.status ? 'disabled' : 'selected'}>${learner.editable ? 'Choose status…' : 'Unavailable'}</option>${state.statuses.map(status => `<option value="${esc(status)}" ${learner.status === status ? 'selected' : ''}>${esc(label(status))}</option>`).join('')}</select><p class="attendance-row-error" id="attendanceRowError_${esc(learner.id)}" role="status"></p>${learner.unavailable_reason ? `<p class="text-muted">${esc(learner.unavailable_reason)}</p>` : ''}</td></tr>`);
    show(byId('attendanceRoster'), `<div class="card attendance-roster-card"><div class="attendance-roster-heading"><div><span class="eyebrow">Loaded roster</span><h2>${esc(data.class.name)}</h2><p><time datetime="${esc(data.attendance_date)}">${esc(readableDate(data.attendance_date))}</time></p></div><span class="badge ${data.recorded_count ? 'badge-navy' : 'badge-gray'}">${data.recorded_count ? esc(data.recording_state === 'partially_recorded' ? 'Partially recorded' : 'Recorded attendance') : 'Not yet recorded'}</span></div>
      <div class="attendance-recording-summary"><p>${esc(data.recorded_count)} recorded; ${esc(data.unrecorded_count)} not yet recorded; ${esc(data.blocked_count)} unavailable.</p><dl class="attendance-recorded-counts">${state.statuses.map(status => `<div class="attendance-count-${esc(status)}"><dt>Recorded ${esc(label(status))}</dt><dd>${esc(data.counts[status])}</dd></div>`).join('')}</dl><p id="attendanceSelectedCounts" class="attendance-selected-counts" role="status" aria-live="polite"></p></div>
      <form id="attendanceRosterForm"><div data-form-error></div>${table(['Learner', 'Recorded status', 'Status selection'], rows)}
      <div class="form-actions"><button type="button" class="btn btn-secondary" id="markUnrecorded" ${data.unrecorded_count ? '' : 'disabled data-readonly="true"'}>Mark unrecorded present</button><button type="submit" class="btn btn-primary" id="saveAttendance" disabled>Save marked attendance</button></div>
      <p id="attendanceUnsaved" class="text-muted" role="status">No unsaved changes.</p></form></div>`);
    rosterControls().forEach(control => control.addEventListener('change', () => { clearRowError(control); updateDirty(); }));
    byId('attendanceRoster').querySelectorAll('[data-attendance-status]').forEach(button => button.addEventListener('click', () => {
      if (state.busy || button.disabled) return;
      const control = byId('attendanceStatus_' + button.dataset.statusLearner);
      if (control.disabled) return;
      control.value = button.dataset.attendanceStatus; clearRowError(control); updateDirty();
    }));
    updateDirty();
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
  function clearRowError(control) {
    control.removeAttribute('aria-invalid');
    byId('attendanceRowError_' + control.dataset.learner).textContent = '';
    byId('attendanceRow_' + control.dataset.learner).classList.toggle('attendance-row-error-state', false);
  }
  async function saveRoster(event) {
    event.preventDefault(); if (state.busy || !state.dirty) return;
    const selected = rosterControls().filter(control => !control.disabled && control.value);
    const records = selected.map((control, index) => { control.name = `records.${index}.status`; return { student_id: Number(control.dataset.learner), status: control.value }; });
    if (!records.length) { MGAEMS.toast('Choose at least one attendance status.', 'error'); return; }
    const corrections = records.filter(input => { const before = state.roster.learners.find(item => item.id === input.student_id).status; return before && before !== input.status; }).length;
    setRosterBusy(true);
    const confirmation = corrections
      ? ['Correct recorded attendance?', `Save ${corrections} status correction(s) for ${state.roster.class.name} on ${readableDate(state.roster.attendance_date)}? Changes will be audited.`, 'Save corrections']
      : ['Save marked attendance?', `Record the selected statuses for ${state.roster.class.name} on ${readableDate(state.roster.attendance_date)}? Unselected learners remain unrecorded.`, 'Save attendance'];
    if (!await MGAEMS.confirmAction(...confirmation)) { setRosterBusy(false); return; }
    rosterControls().forEach(clearRowError);
    byId('attendanceRosterForm').querySelector('[data-form-error]').innerHTML = '';
    byId('attendanceRosterForm').setAttribute('aria-busy', 'true');
    byId('saveAttendance').textContent = 'Saving…';
    const result = await MGAEMS.post('/api/v1/attendance/students', { class_id: state.roster.class.id, attendance_date: state.roster.attendance_date, records });
    setRosterBusy(false); byId('saveAttendance').textContent = 'Save marked attendance';
    byId('attendanceRosterForm').setAttribute('aria-busy', 'false');
    if (!result?.ok) {
      MGAEMS.showFormErrors(byId('attendanceRosterForm'), result || {});
      selected.forEach((control, index) => {
        const messages = Object.entries(result?.fields || {}).filter(([field]) => field.startsWith(`records.${index}.`)).flatMap(([, value]) => Array.isArray(value) ? value : [value]).filter(value => typeof value === 'string');
        if (messages.length) {
          control.setAttribute('aria-invalid', 'true');
          byId('attendanceRowError_' + control.dataset.learner).textContent = messages.join(' ');
          byId('attendanceRow_' + control.dataset.learner).classList.toggle('attendance-row-error-state', true);
        }
      }); return;
    }
    if (!object(result.meta) || !['created', 'updated', 'unchanged'].every(key => count(result.meta[key]))) {
      MGAEMS.showFormErrors(byId('attendanceRosterForm'), { error: 'The save response was incomplete. Reload the roster to verify recorded statuses before retrying.' }); return;
    }
    state.dirty = false;
    MGAEMS.toast(`Attendance saved: ${result.meta.created} new, ${result.meta.updated} corrected, ${result.meta.unchanged} unchanged.`, 'success');
    await loadRoster(true); loadHistory();
  }
  function rangeParams(prefix) {
    const params = new URLSearchParams();
    ['Class', 'From', 'To'].forEach(suffix => { const value = byId(prefix + suffix).value; if (value) params.set(suffix === 'Class' ? 'class_id' : suffix.toLowerCase(), value); }); return params;
  }
  function validRange(prefix, form) {
    const from = byId(prefix + 'From').value, to = byId(prefix + 'To').value;
    if (from && to && from > to) {
      MGAEMS.showFormErrors(form, { error: 'Choose a valid school-date range.', fields: { to: ['The end date must be on or after the start date.'] } }); return false;
    }
    return true;
  }
  byId('attendanceHistoryFilter').addEventListener('submit', event => { event.preventDefault(); state.page = 1; loadHistory(); });
  async function loadHistory() {
    if (!byId('attendanceHistoryFilter').reportValidity() || !validRange('history', byId('attendanceHistoryFilter'))) return;
    const params = rangeParams('history'); params.set('page', state.page); params.set('per_page', 25);
    const sequence = ++state.historyRequest; const target = byId('attendanceHistory'); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading attendance history…');
    const result = await MGAEMS.get('/api/v1/attendance/students?' + params);
    if (sequence !== state.historyRequest) return;
    if (!result?.ok) { MGAEMS.showFormErrors(byId('attendanceHistoryFilter'), result || {}); failure(target, result, loadHistory); return; }
    if (!validHistory(result)) { failure(target, { error: 'Recorded attendance history could not be verified. Try loading again.' }, loadHistory); return; }
    clearFormErrors(byId('attendanceHistoryFilter'));
    show(target, result.data.length ? `<div class="card attendance-history-card"><div class="attendance-panel-heading"><h2>Saved attendance records</h2><p>Historical records retain their recorded class.</p></div>${table(['School date', 'Learner', 'Recorded class', 'Status'], result.data.map(record => `<tr><td data-label="School date"><time datetime="${esc(record.attendance_date)}">${esc(readableDate(record.attendance_date))}</time></td><td data-label="Learner"><strong class="attendance-learner-name">${esc(record.student?.first_name)} ${esc(record.student?.last_name)}</strong>${record.student?.admission_no ? `<span class="text-meta">Admission no. ${esc(record.student.admission_no)}</span>` : ''}</td><td data-label="Recorded class">${esc(record.school_class?.name)}</td><td data-label="Status"><span class="badge ${badges[record.status] || 'badge-gray'}">${esc(label(record.status))}</span></td></tr>`))}<div class="pagination"><span>${esc(result.meta.total)} recorded attendance rows · Page ${esc(result.meta.page)}</span><div class="form-actions"><button type="button" class="btn btn-secondary btn-sm" data-page="-1" ${state.page <= 1 ? 'disabled' : ''}>Previous</button><button type="button" class="btn btn-secondary btn-sm" data-page="1" ${state.page * result.meta.per_page >= result.meta.total ? 'disabled' : ''}>Next</button></div></div></div>` : MGAEMS.emptyStateHTML('No recorded attendance matches', 'Missing attendance records are not counted as absences.', 'calendar-check'));
    target.querySelectorAll('[data-page]').forEach(control => control.addEventListener('click', () => { state.page += Number(control.dataset.page); loadHistory(); }));
  }
  byId('attendanceSummaryFilter').addEventListener('submit', event => { event.preventDefault(); loadSummary(); });
  async function loadSummary() {
    if (!byId('attendanceSummaryFilter').reportValidity() || !validRange('summary', byId('attendanceSummaryFilter'))) return;
    const context = { className: state.classes.find(item => String(item.id) === byId('summaryClass').value)?.name || 'Permitted class', from: byId('summaryFrom').value, to: byId('summaryTo').value };
    const params = rangeParams('summary');
    const sequence = ++state.summaryRequest; const target = byId('attendanceSummary'); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading recorded attendance summary…');
    const result = await MGAEMS.get('/api/v1/attendance/students/summary?' + params);
    if (sequence !== state.summaryRequest) return;
    if (!result?.ok) { MGAEMS.showFormErrors(byId('attendanceSummaryFilter'), result || {}); failure(target, result, loadSummary); return; }
    if (!validSummary(result.data, context)) { failure(target, { error: 'Recorded attendance totals could not be verified for this date range. Try loading again.' }, loadSummary); return; }
    clearFormErrors(byId('attendanceSummaryFilter'));
    const data = result.data;
    show(target, `<div class="attendance-summary-context"><h2>${esc(context.className)} summary</h2><p>${esc(readableDate(context.from))} – ${esc(readableDate(context.to))}</p></div><div class="attendance-summary-cards">${state.statuses.map(status => `<div class="card stat-card attendance-count-${esc(status)}"><div class="label">Recorded ${esc(label(status))}</div><div class="num">${esc(data.counts[status])}</div></div>`).join('')}</div><div class="card attendance-rate-card"><h3>Recorded attendance coverage</h3><p>${esc(data.total_records)} recorded attendance rows.</p><p>${data.attendance_rate === null ? 'No attendance recorded; no rate is available.' : `Present-record rate: ${esc(data.attendance_rate)}%.`}</p><p class="text-muted">This existing rate counts present records divided by all recorded statuses. Missing records are excluded.</p></div>`);
  }
  window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
  setup(); MGAEMS.initIcons();
})();
