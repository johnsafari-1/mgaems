/* Sponsor reads stay within the server-owned programme and explicit membership. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user) return;
  if (user.role !== 'sponsor') { window.location.href = MGAEMS.landingPage(user); return; }
  renderAppShell('/sponsor-portal.html');
  const main = document.getElementById('appMain'), esc = MGAEMS.escapeHTML;
  const token = localStorage.getItem('mgaems_token'), identity = JSON.stringify([user.id ?? null, user.username ?? null, user.role]);
  const state = { items: [], selected: '', learners: [], learner: '', epoch: 0, learnerEpoch: 0, request: 0, denied: false };
  const byId = id => document.getElementById(id);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validId = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
  const uniqueRows = rows => Array.isArray(rows) && rows.every(row => object(row) && validId(row.id)) && new Set(rows.map(row => String(row.id))).size === rows.length;
  const types = { individual: 'Individual', group: 'Group', school_wide: 'School-wide' };
  const name = learner => [learner?.first_name, learner?.last_name].filter(Boolean).join(' ') || 'Learner';
  const label = value => String(value ?? '').replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
  const title = item => item.program_name || (item.sponsorship_type === 'individual' && item.learner ? name(item.learner) : `${types[item.sponsorship_type]} sponsorship`);
  const date = value => {
    const day = value == null || value === '' ? null : MGAEMS.schoolDate(value);
    const parsed = day ? new Date(day + 'T12:00:00Z') : null;
    return parsed && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? `<time datetime="${esc(day)}">${esc(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric' }).format(parsed))}</time>` : 'Not recorded';
  };
  const badge = (status, employment = false) => `<span class="badge ${status === 'active' || status === 'present' ? 'badge-green' : status === 'paused' || status === 'late' ? 'badge-amber' : status === 'absent' ? 'badge-red' : 'badge-gray'}">${esc(label(status) || (employment ? 'Not recorded' : 'Unavailable'))}</span>`;
  const show = (target, html) => { if (!target) return; target.innerHTML = html; target.setAttribute('aria-busy', 'false'); MGAEMS.initIcons(); };
  function authorized() {
    const currentUser = MGAEMS.currentUser();
    if (!state.denied && token && localStorage.getItem('mgaems_token') === token && currentUser && JSON.stringify([currentUser.id ?? null, currentUser.username ?? null, currentUser.role]) === identity && window.location.pathname === '/sponsor-portal.html') return true;
    state.items = []; state.learners = []; state.selected = ''; state.learner = ''; ++state.epoch; ++state.learnerEpoch; ++state.request;
    main.innerHTML = MGAEMS.errorHTML('Your session changed. Reopen your authorized Sponsor Portal.');
    return false;
  }
  function current(item, epoch, learner = null, learnerEpoch = null) {
    return authorized() && state.epoch === epoch && state.selected === String(item.id) && (!learner || (state.learner === String(learner.id) && state.learnerEpoch === learnerEpoch));
  }
  function revoke(item, epoch) {
    if (!current(item, epoch)) return;
    state.selected = ''; state.learner = ''; state.items = []; state.learners = []; ++state.epoch; ++state.learnerEpoch;
    byId('sponsorSelector').innerHTML = ''; byId('sponsorView').innerHTML = '';
    show(byId('sponsorStatus'), MGAEMS.emptyStateHTML('Sponsorship access unavailable', 'Refresh your programmes or contact the school to review your sponsorship links.', 'lock'));
  }
  function failure(target, result, retry) {
    show(target, MGAEMS.errorHTML(result.error || 'The information could not be loaded.'));
    if (result.status !== 401 && result.status !== 403) {
      target.innerHTML += '<button type="button" class="btn btn-secondary" data-portal-retry>Try again</button>';
      target.querySelector('[data-portal-retry]').addEventListener('click', retry);
    }
  }
  function validLearners(rows) {
    return uniqueRows(rows) && rows.every(row => typeof row.first_name === 'string' && typeof row.admission_no === 'string' && (row.last_name == null || typeof row.last_name === 'string') && (row.class == null || (object(row.class) && typeof row.class.name === 'string')));
  }
  const programmeRoot = item => '/api/v1/portal/sponsor/sponsorships/' + encodeURIComponent(item.id);
  const learnerRoot = (item, learner) => programmeRoot(item) + (item.sponsorship_type === 'group' ? '/learners/' + encodeURIComponent(learner.id) : '');
  main.setAttribute('class', 'app-main sponsor-portal');
  main.innerHTML = `<div class="workspace-heading"><div><p class="eyebrow">Your school partnership</p><h1>Sponsor Portal</h1><p>Read-only programme and explicitly sponsored learner updates.</p></div><button type="button" class="btn btn-secondary" id="sponsorRefresh"><i data-lucide="refresh-cw" aria-hidden="true"></i>Refresh programmes</button></div><p class="workspace-note">Individual and Group programmes provide updates for their explicit learner links. School-wide programmes provide programme information only.</p><div id="sponsorStatus" role="status" aria-live="polite"></div><div id="sponsorSelector"></div><div id="sponsorView"></div>`;
  byId('sponsorRefresh').addEventListener('click', loadProgrammes);
  window.addEventListener('storage', event => { if (event.key == null || ['mgaems_token', 'mgaems_user'].includes(event.key)) authorized(); });
  MGAEMS.initIcons();
  async function loadProgrammes() {
    if (!authorized()) return;
    const previous = state.selected, request = ++state.request;
    state.selected = ''; state.learner = ''; state.items = []; state.learners = []; ++state.epoch; ++state.learnerEpoch;
    byId('sponsorSelector').innerHTML = ''; byId('sponsorView').innerHTML = '';
    const target = byId('sponsorStatus'); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading your programmes…');
    const result = await MGAEMS.get('/api/v1/portal/sponsor/sponsorships');
    if (!authorized() || request !== state.request) return;
    if (!result.ok) { failure(target, result, loadProgrammes); return; }
    if (!uniqueRows(result.data) || !result.data.every(item => Object.hasOwn(types, item.sponsorship_type) && ['active', 'paused', 'ended'].includes(item.status) && (item.learner == null || validLearners([item.learner])))) { failure(target, { error: 'The server returned unexpected programme information.' }, loadProgrammes); return; }
    state.items = result.data;
    if (!state.items.length) { show(target, MGAEMS.emptyStateHTML('No sponsorships linked', 'Contact the school if a sponsorship should be linked to your account.', 'heart-handshake')); return; }
    show(target, '');
    byId('sponsorSelector').innerHTML = `<section class="sponsor-programme-selector" aria-labelledby="sponsorSelectorHeading"><div><span class="badge badge-navy">${state.items.length} linked ${state.items.length === 1 ? 'programme' : 'programmes'}</span><h2 id="sponsorSelectorHeading">Choose a programme</h2></div><label for="sponsorProgramme">Assigned programme</label><select id="sponsorProgramme" aria-describedby="sponsorProgrammeHint">${state.items.map(item => `<option value="${esc(item.id)}">${esc(title(item))} · ${types[item.sponsorship_type]} · ${label(item.status)}</option>`).join('')}</select><p id="sponsorProgrammeHint">Learner updates follow this programme's explicit membership.</p><p id="sponsorSelectionStatus" role="status" aria-live="polite"></p></section>`;
    byId('sponsorProgramme').addEventListener('change', () => selectProgramme(byId('sponsorProgramme').value));
    selectProgramme(state.items.some(item => String(item.id) === previous) ? previous : String(state.items[0].id));
  }
  async function selectProgramme(id) {
    if (!authorized()) return;
    const item = state.items.find(row => String(row.id) === String(id));
    if (!item) return;
    state.selected = String(item.id); state.learners = []; state.learner = ''; ++state.learnerEpoch;
    const epoch = ++state.epoch; byId('sponsorProgramme').value = state.selected;
    byId('sponsorSelectionStatus').textContent = `Viewing ${title(item)} · ${types[item.sponsorship_type]} · ${label(item.status)}`;
    const target = byId('sponsorView');
    show(target, `<section class="card workspace-section sponsor-programme-overview" aria-labelledby="sponsorProgrammeHeading"><div class="sponsor-section-heading"><div><h2 id="sponsorProgrammeHeading">${esc(title(item))}</h2><p class="text-muted">${types[item.sponsorship_type]} sponsorship</p></div>${badge(item.status)}</div><dl class="sponsor-programme-dates"><div><dt>Start date</dt><dd>${date(item.start_date)}</dd></div><div><dt>End date</dt><dd>${date(item.end_date)}</dd></div></dl><p class="sponsor-copy">${item.sponsorship_type === 'school_wide' ? 'This partnership supports the school at programme level. Learner rosters, learner reports and personal records are unavailable.' : item.sponsorship_type === 'group' ? 'Only learners explicitly linked to this Group programme are available below.' : 'Updates apply to the learner explicitly assigned to this Individual programme.'}</p></section><div id="sponsorMembers" aria-busy="true"></div><div id="sponsorLearnerView"></div>`);
    if (item.sponsorship_type === 'school_wide') { show(byId('sponsorMembers'), ''); return; }
    const members = byId('sponsorMembers'); members.innerHTML = MGAEMS.loadingHTML('Loading explicitly sponsored learners…');
    const result = await MGAEMS.get(programmeRoot(item) + '/learners');
    if (!current(item, epoch)) return;
    if (result.status === 403) { revoke(item, epoch); return; }
    if (!result.ok) { failure(members, result, () => selectProgramme(item.id)); return; }
    if (!validLearners(result.data) || (item.sponsorship_type === 'individual' && (result.data.length > 1 || (result.data.length && item.learner && String(result.data[0].id) !== String(item.learner.id))))) { failure(members, { error: 'The server returned unexpected learner membership.' }, () => selectProgramme(item.id)); return; }
    state.learners = result.data;
    if (!state.learners.length) { show(members, MGAEMS.emptyStateHTML('No learners explicitly linked', 'Contact the school to review this programme’s learner membership.', 'users')); return; }
    show(members, item.sponsorship_type === 'group' ? `<div class="card sponsor-member-selector"><label for="sponsorMember">Choose an explicitly sponsored learner</label><select id="sponsorMember" aria-describedby="sponsorMemberHint">${state.learners.map(learner => `<option value="${esc(learner.id)}">${esc(name(learner))} · ${esc(learner.admission_no)}</option>`).join('')}</select><p class="text-muted" id="sponsorMemberHint">${state.learners.length} linked ${state.learners.length === 1 ? 'learner' : 'learners'} in this programme. Attendance, feedback and reports follow your selection.</p></div>` : '');
    byId('sponsorMember')?.addEventListener('change', () => selectLearner(item, epoch, byId('sponsorMember').value));
    selectLearner(item, epoch, state.learners[0].id);
  }
  function selectLearner(item, epoch, id) {
    if (!current(item, epoch)) return;
    const learner = state.learners.find(row => String(row.id) === String(id));
    if (!learner) return;
    state.learner = String(learner.id); const learnerEpoch = ++state.learnerEpoch;
    if (byId('sponsorMember')) byId('sponsorMember').value = state.learner;
    byId('sponsorLearnerView').innerHTML = `<section class="card workspace-section" aria-labelledby="sponsorLearnerHeading"><div class="sponsor-section-heading"><div><h2 id="sponsorLearnerHeading">${esc(name(learner))}</h2><p class="text-muted">${esc(learner.admission_no)} · ${esc(learner.class?.name || 'Class not assigned')}</p></div>${badge(learner.status, true)}</div><p class="sponsor-copy">Educational updates only for this programme's selected learner.</p></section><nav class="family-navigation" aria-label="Selected sponsored learner sections"><a href="#sponsorAttendanceSection">Attendance</a><a href="#sponsorProgressSection">Assessment feedback</a><a href="#sponsorCardsSection">Report cards</a></nav><section class="card workspace-section family-section" id="sponsorAttendanceSection" tabindex="-1" aria-labelledby="sponsorAttendanceHeading"><h2 id="sponsorAttendanceHeading">Recorded attendance</h2><p class="text-muted">Missing records are not treated as absences. Totals reflect the attendance records available from the school.</p><div id="sponsorAttendance" aria-busy="true" aria-live="polite"></div></section><section class="card workspace-section family-section" id="sponsorProgressSection" tabindex="-1" aria-labelledby="sponsorProgressHeading"><h2 id="sponsorProgressHeading">Recorded assessment feedback</h2><p class="text-muted">Existing assessment remarks shared through your sponsorship. Continuous and end-term entries remain separate.</p><div id="sponsorProgress" aria-busy="true"></div></section><section class="card workspace-section family-section" id="sponsorCardsSection" tabindex="-1" aria-labelledby="sponsorCardsHeading"><h2 id="sponsorCardsHeading">Available report cards</h2><p class="text-muted">PDF availability reflects the school’s stored report files. No revision-management or publication action is available here.</p><div id="sponsorCards" aria-busy="true"></div></section>`;
    for (const link of byId('sponsorLearnerView').querySelectorAll('a')) link.addEventListener('click', () => { if (current(item, epoch, learner, learnerEpoch)) byId(link.getAttribute('href').slice(1))?.focus(); });
    loadPane(item, epoch, learner, learnerEpoch, 'sponsorAttendance', '/attendance', renderAttendance);
    loadPane(item, epoch, learner, learnerEpoch, 'sponsorProgress', '/comments', renderProgress);
    loadPane(item, epoch, learner, learnerEpoch, 'sponsorCards', '/report-cards', (rows, target) => renderCards(rows, target, item, epoch, learner, learnerEpoch));
  }
  async function loadPane(item, epoch, learner, learnerEpoch, targetId, suffix, render) {
    if (!current(item, epoch, learner, learnerEpoch)) return;
    const target = byId(targetId); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading learner information…');
    const result = await MGAEMS.get(learnerRoot(item, learner) + suffix);
    if (!current(item, epoch, learner, learnerEpoch)) return;
    if (result.status === 403) { revoke(item, epoch); return; }
    if (!result.ok) { failure(target, result, () => loadPane(item, epoch, learner, learnerEpoch, targetId, suffix, render)); return; }
    try { if (suffix === '/attendance' && String(result.data?.student_id) !== String(learner.id)) throw new Error('Wrong learner'); render(result.data, target); }
    catch { failure(target, { error: 'The server returned unexpected learner information.' }, () => loadPane(item, epoch, learner, learnerEpoch, targetId, suffix, render)); }
  }
  function renderAttendance(data, target) {
    const summary = data?.summary;
    if (!object(summary) || ['total', 'present', 'absent', 'late', 'excused'].some(key => !Number.isInteger(summary[key]) || summary[key] < 0) || summary.present + summary.absent + summary.late + summary.excused !== summary.total || (summary.attendance_percentage != null && (!Number.isFinite(summary.attendance_percentage) || summary.attendance_percentage < 0 || summary.attendance_percentage > 100)) || !Array.isArray(data.recent) || data.recent.length > summary.total || data.recent.some(row => !object(row) || !['present', 'absent', 'late', 'excused'].includes(row.status) || typeof row.date !== 'string')) throw new Error('Invalid attendance');
    if (!summary.total) { show(target, MGAEMS.emptyStateHTML('No recorded attendance', 'Missing records are not treated as absences.', 'calendar')); return; }
    show(target, `<p>${esc(summary.total)} recorded days. Attendance among recorded days: <strong>${summary.attendance_percentage == null ? 'Unavailable' : esc(summary.attendance_percentage) + '%'}</strong></p><dl class="family-attendance-summary">${['present', 'absent', 'late', 'excused'].map(status => `<div><dt>${label(status)}</dt><dd>${summary[status]}</dd></div>`).join('')}</dl><h3 class="sponsor-subheading">Recent recorded dates</h3><p class="text-muted">Up to 30 most recent records.</p>${data.recent.length ? `<ul class="family-records">${data.recent.map(row => `<li class="family-attendance-record"><strong>${date(row.date)}</strong>${badge(row.status)}</li>`).join('')}</ul>` : '<p class="text-muted">Recent records are unavailable.</p>'}`);
  }
  function renderProgress(rows, target) {
    if (!Array.isArray(rows) || rows.some(row => !object(row))) throw new Error('Invalid assessment feedback');
    if (!rows.length) { show(target, MGAEMS.emptyStateHTML('No assessment feedback available', 'Remarks shared through this programme will appear here.', 'book-open')); return; }
    show(target, `<div class="family-progress-grid">${rows.map(row => `<article class="family-progress-record"><h3>${esc(row.subject || 'Learning area unavailable')}</h3><p class="text-meta">${esc(row.term || 'Term not recorded')}</p><dl class="family-result-values"><div><dt>Assessment type</dt><dd>${esc(row.assessment_type === 'continuous' ? 'Continuous' : row.assessment_type === 'end_term' ? 'End-term' : label(row.assessment_type) || 'Not recorded')}</dd></div><div><dt>Score</dt><dd>${esc(row.score ?? 'Not recorded')}</dd></div><div><dt>Performance level</dt><dd>${esc(row.competency_rating ?? 'Not recorded')}</dd></div><div><dt>Recorded date</dt><dd>${date(row.recorded_date)}</dd></div></dl><p class="sponsor-copy"><strong>Remarks:</strong> ${esc(row.remarks || 'Not recorded')}</p></article>`).join('')}</div>`);
  }
  function renderCards(rows, target, item, epoch, learner, learnerEpoch) {
    if (!uniqueRows(rows) || rows.some(card => typeof card.download_available !== 'boolean')) throw new Error('Invalid report list');
    if (!rows.length) { show(target, MGAEMS.emptyStateHTML('No report cards available', 'Contact the school about reports for this learner.', 'file-text')); return; }
    show(target, `<div class="sponsor-reports">${rows.map(card => `<article class="family-report"><div><h3>${esc(card.term?.name || 'Report card')}</h3><p class="text-meta">Report date: ${date(card.generated_date)}</p><p class="sponsor-copy">${esc(card.overall_remark || '')}</p><span class="badge ${card.download_available ? 'badge-green' : 'badge-gray'}">${card.download_available ? 'PDF available' : 'File unavailable'}</span></div>${card.download_available ? `<button type="button" class="btn btn-primary" data-sponsor-card="${esc(card.id)}" aria-label="Download ${esc(card.term?.name || 'report card')} for ${esc(name(learner))}"><i data-lucide="download" aria-hidden="true"></i>Download PDF</button>` : ''}</article>`).join('')}</div><p id="sponsorDownloadStatus" role="status" aria-live="polite"></p>`);
    target.querySelectorAll('[data-sponsor-card]').forEach(button => button.addEventListener('click', async () => {
      if (!current(item, epoch, learner, learnerEpoch) || button.disabled || !rows.some(card => String(card.id) === button.dataset.sponsorCard && card.download_available)) return;
      const status = byId('sponsorDownloadStatus'), reportId = button.dataset.sponsorCard;
      button.disabled = true; button.textContent = 'Downloading…'; status.textContent = 'Preparing the selected learner’s report PDF…';
      const result = await MGAEMS.download(learnerRoot(item, learner) + '/report-cards/' + encodeURIComponent(reportId) + '/download', `report-card-${learner.admission_no}.pdf`, { isCurrent: () => current(item, epoch, learner, learnerEpoch) });
      if (!current(item, epoch, learner, learnerEpoch)) return;
      button.disabled = false; button.textContent = 'Download PDF';
      if (result.status === 403) { revoke(item, epoch); return; }
      status.textContent = result.ok ? 'Report PDF download started.' : result.error || 'The report PDF could not be downloaded. Try again or contact the school.';
      if (!result.ok && !result.cancelled) MGAEMS.toast(status.textContent, 'error');
    }));
  }
  loadProgrammes();
})();
