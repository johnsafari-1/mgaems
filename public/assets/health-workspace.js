/* Only authorized school leaders receive Health detail endpoints. No browser persistence. */
(() => {
  const esc = MGAEMS.escapeHTML;
  const label = value => String(value ?? '').replace(/_/g, ' ');
  const sources = ['guardian_report', 'learner_report', 'staff_observation', 'external_document', 'other_report'];
  const field = (name, title, type = 'text', options = {}) => ({ name, title, type, ...options });
  const sourceFields = [field('source', 'Information source', 'select', { choices: sources, required: true }), field('source_reference', 'Source reference', 'text', { max: 200 })];
  function requestId() {
    if (window.crypto.randomUUID) return window.crypto.randomUUID();
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  const schemas = {
    profile: [field('allergy_information_state', 'Allergy information state', 'select', { choices: ['unknown', 'none_reported', 'recorded'], required: true, initial: 'unknown' }),
      field('allergy_information', 'Recorded allergy information', 'textarea', { max: 1000 }), field('emergency_information', 'Reported emergency information', 'textarea', { max: 1000 }),
      field('support_information', 'School support information', 'textarea', { max: 1000 }), ...sourceFields],
    alert: [field('alert_type', 'Safety alert type', 'select', { choices: ['allergy', 'emergency_support', 'activity_precaution', 'other_safety'], required: true }),
      field('description', 'Teacher-visible actionable safety information', 'textarea', { required: true, max: 500 }), field('emergency_instructions', 'Teacher-visible emergency instructions', 'textarea', { max: 500 }),
      field('is_active', 'Publish as an active alert for scoped Teachers', 'checkbox'), field('starts_on', 'Effective from (inclusive)', 'date', { required: true }), field('ends_on', 'Effective until (inclusive)', 'date'), ...sourceFields],
    incident: [field('occurred_at', 'Actual occurrence time — EAT (UTC+03:00)', 'instant', { required: true }), field('location', 'School location', 'text', { required: true, max: 120 }),
      field('category', 'Incident category', 'select', { choices: ['illness_concern', 'injury', 'exposure', 'other_safety'], required: true }),
      field('information_basis', 'Basis of the circumstances', 'select', { choices: ['observed', 'reported'], required: true }), field('observations', 'Observed facts or reported circumstances', 'textarea', { required: true, max: 2000 })],
    action: [field('action_type', 'School action type', 'select', { choices: ['first_aid', 'observation', 'follow_up', 'handover', 'status_change'], required: true }),
      field('action_at', 'Actual action time — EAT (UTC+03:00)', 'instant', { required: true }), field('action', 'Action actually performed', 'textarea', { required: true, max: 1000 }),
      field('result', 'Observed outcome', 'textarea', { max: 1000 }), field('status_after', 'Operational status after this new action', 'select', { choices: ['open', 'monitoring', 'closed'] }),
      field('disposition_after', 'Disposition after this new action', 'select', { choices: ['none', 'monitoring', 'returned_to_class', 'guardian_handover', 'external_referral'] })],
    notification: [field('guardian_id', 'Current Guardian relationship (optional)', 'select', { choices: [] }), field('channel', 'Contact channel actually used', 'select', { choices: ['phone', 'sms', 'email', 'in_person', 'other'], required: true }),
      field('attempted_at', 'Actual attempt time — EAT (UTC+03:00)', 'instant', { required: true }), field('outcome', 'Contact attempt outcome', 'select', { choices: ['contacted', 'no_answer', 'message_left', 'failed'], required: true }),
      field('contact_used', 'Actual contact used, if known', 'text', { max: 200 })],
    referral: [field('referred_at', 'Actual referral time — EAT (UTC+03:00)', 'instant', { required: true }), field('reason', 'School referral reason', 'textarea', { required: true, max: 1000 }),
      field('destination', 'Destination, if known', 'text', { max: 200 }), field('authorization_details', 'Known authorization details', 'textarea', { max: 1000 }),
      field('handover_details', 'Actual handover details', 'textarea', { max: 1000 }), field('follow_up_status', 'Follow-up status', 'select', { choices: ['pending', 'handed_over', 'completed', 'cancelled'], required: true })],
  };
  const instantFields = ['occurred_at', 'action_at', 'attempted_at', 'referred_at', 'recorded_at', 'reviewed_at', 'verified_at'];
  const metadata = {
    profile: ['recorded_by', 'recorded_at', 'reviewed_by', 'reviewed_at'], alert: ['verified_by', 'verified_at', 'verification_basis'],
    incident: ['recorded_by', 'recorded_at', 'status', 'disposition'], action: ['actor_id', 'recorded_at'], notification: ['actor_id', 'recorded_at'], referral: ['actor_id', 'recorded_at'],
  };
  const summaryFields = { alert: ['profile_id', 'alert_type', 'is_active', 'starts_on', 'ends_on'], incident: ['student_id', 'occurred_at', 'category', 'status', 'disposition'],
    action: ['incident_id', 'action_type', 'action_at'], notification: ['incident_id', 'channel', 'attempted_at', 'outcome'], referral: ['incident_id', 'referred_at', 'follow_up_status'],
    log: ['actor_id', 'operation', 'record_type', 'record_id', 'recorded_at'] };
  function project(type, row, summary = false) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return {};
    const names = summary ? summaryFields[type] : [...schemas[type].map(f => f.name), ...metadata[type], 'context_snapshot', 'contact_snapshot'];
    return Object.fromEntries(['id', 'revision_number', 'student_id', 'profile_id', 'incident_id', ...names].filter(name => Object.hasOwn(row, name)).map(name => [name, row[name]]));
  }
  function eatInput(iso) {
    if (!iso || !Number.isFinite(Date.parse(iso))) return '';
    // EAT is the explicit fixed +03:00 display contract, including old events.
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.parse(iso) + 10800000));
    const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const fraction = String(iso).match(/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/)?.[1];
    return `${p.year.padStart(4, '0')}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${fraction ? '.' + fraction : ''}`;
  }
  function eventInstant(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/.test(value)) return null;
    return value + (value.length === 16 ? ':00' : '') + '+03:00';
  }
  function displayTime(iso) { const value = eatInput(iso); return value ? value.replace('T', ' ') + ' EAT' : 'Not recorded'; }
  function allergyState(value) { const meanings = { unknown: 'Unknown — information not established', none_reported: 'None reported by the recorded source', recorded: 'Recorded allergy information' }; return Object.hasOwn(meanings, value) ? meanings[value] : 'Information state unavailable'; }
  // Pure helpers for timestamp/meaning tests; no record data is exported.
  window.MGAEMSHealthFormat = { eatInput, eventInstant, displayTime, allergyState };
  const user = MGAEMS.requireAuth();
  if (!user) return;
  if (!['head_teacher', 'deputy_head_teacher'].includes(user.role)) { window.location.href = MGAEMS.landingPage(user); return; }
  renderAppShell('/health-welfare.html');
  const main = document.getElementById('appMain');
  main.setAttribute('class', 'app-main health-workspace');
  const currentSession = MGAEMS.sessionGuard();
  const current = () => currentSession() && window.location.pathname === '/health-welfare.html';
  const state = { generation: 0, denied: false, rows: [], learner: null, tab: 'profiles', profile: null, incident: null, modal: null, pickerPage: 1, pickerRequest: 0, pickerReady: false };
  const byId = id => document.getElementById(id);
  const button = (text, attr = '', primary = false) => `<button type="button" class="btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-sm" ${attr}>${text}</button>`;
  const actions = html => `<div class="health-actions">${html}</div>`;
  const validId = id => (typeof id === 'number' || typeof id === 'string' && /^[1-9]\d*$/.test(id)) && Number.isSafeInteger(Number(id)) && Number(id) > 0;
  const validRecord = record => record && typeof record === 'object' && !Array.isArray(record) && validId(record.id) && Number.isInteger(record.revision_number) && record.revision_number > 0;
  function clearModal() { if (state.modal) { state.modal.setBusy(false); state.modal.body.innerHTML = ''; state.modal.close(); state.modal = null; } }
  // Selected Health content and the paged roster have independent request owners.
  function clear() { state.generation++; state.profile = null; state.incident = null; clearModal(); }
  function clearWorkspace() { clear(); state.pickerRequest++; state.pickerReady = false; state.rows = []; state.learner = null; }
  function deny() {
    clearWorkspace(); state.denied = true;
    main.innerHTML = MGAEMS.emptyStateHTML('Health access unavailable', 'Your session or current Staff authorization no longer permits this workspace. Sign in again with an eligible account.', 'lock');
  }
  async function read(path) {
    if (!current()) { deny(); return { ok: false, status: 401, error: 'Health session changed.' }; }
    const result = await MGAEMS.get(path);
    if (!current() || [401, 403].includes(result.status)) deny();
    return result;
  }
  const alive = generation => current() && !state.denied && generation === state.generation;
  byId('shellLogout')?.addEventListener('click', () => { clearWorkspace(); state.denied = true; main.innerHTML = ''; });
  function error(target, result, retry) {
    target.innerHTML = MGAEMS.errorHTML(result.error || 'The information could not be loaded.');
    if (retry && ![401, 403].includes(result.status)) { target.innerHTML += button('Try again', 'data-retry'); target.querySelector('[data-retry]').addEventListener('click', retry); }
  }
  const learnerTitle = () => state.learner ? `${state.learner.first_name} ${state.learner.last_name} · ${state.learner.admission_no}` : 'Select a learner';
  function details(type, record) {
    const titles = { verified_by: 'Operationally verified by', verified_at: 'Operational verification time', verification_basis: 'Operational verification basis', reviewed_by: 'Human review by', reviewed_at: 'Human review time' };
    const fields = [...schemas[type].filter(f => f.name !== 'guardian_id' && f.name !== 'contact_used').map(f => [f.name, f.title]), ...metadata[type].map(name => [name, Object.hasOwn(titles, name) ? titles[name] : label(name)])];
    let rows = fields.map(([name, title]) => {
      let value = record[name];
      if (name === 'allergy_information_state') value = allergyState(value);
      else if (name === 'is_active') value = value === true ? 'Active publication' : 'Inactive';
      else if (instantFields.includes(name)) value = displayTime(value);
      else if (['starts_on', 'ends_on'].includes(name)) value = value ? String(value).slice(0, 10) : 'Not recorded';
      else if (name.endsWith('_by') || name === 'actor_id') value = value ? 'User #' + value : 'Not recorded';
      else if (typeof value === 'string' && schemas[type].find(f => f.name === name)?.type === 'select') value = label(value);
      return `<div><dt>${esc(title)}</dt><dd>${esc(value ?? 'Not recorded')}</dd></div>`;
    }).join('');
    if (type === 'incident') rows += ['class', 'term'].map(kind => `<div><dt>${kind === 'class' ? 'Class' : 'Term'} known at recording</dt><dd>${esc(record.context_snapshot?.[kind + '_name_at_recording'] || 'Unknown')} · ${esc(label(record.context_snapshot?.[kind + '_basis'] || 'unknown'))}</dd></div>`).join('');
    if (type === 'notification') rows += [['Guardian at recording', record.contact_snapshot?.guardian_name_at_recording], ['Actual contact recorded', record.contact_snapshot?.contact_used], ['Contact snapshot time', displayTime(record.contact_snapshot?.captured_at)]].map(([title, value]) => `<div><dt>${title}</dt><dd>${esc(value ?? 'Not recorded')}</dd></div>`).join('');
    return `<p class="text-muted">Record #${esc(record.id)} · Revision ${esc(record.revision_number)}</p><dl class="health-details">${rows}</dl>`;
  }
  async function start() {
    clearWorkspace(); state.denied = false;
    const generation = state.generation;
    main.innerHTML = MGAEMS.loadingHTML('Checking restricted Health authorization…');
    const result = await read('/api/v1/health/profiles?per_page=1');
    if (!alive(generation)) return;
    if (!result.ok) { error(main, result, start); return; }
    if (!Array.isArray(result.data) || result.data.some(row => !validRecord(row))) { error(main, { error: 'Unexpected Health authorization response.' }, start); return; }
    main.innerHTML = `<div class="page-heading health-heading"><span class="eyebrow">Restricted school leadership</span><h1>Health &amp; Safety</h1><p>Review reported school support information, actionable safety alerts and actual school incidents.</p><p class="health-note">Information is confidential. Select the learner carefully; only authorized school leadership can open these records. Teacher-visible alerts contain only actionable information within current assignments.</p></div>
      <div class="health-layout"><aside class="card health-picker" aria-label="Select a learner"><h2>Learner selection</h2><div class="field"><label for="healthLearnerFilter">Name or admission number on this page</label><input type="search" id="healthLearnerFilter" maxlength="150" placeholder="Filter this loaded learner page" aria-describedby="healthLearnerCount"></div><p id="healthLearnerCount" class="health-picker-count" role="status"></p><div id="healthLearners" aria-live="polite" aria-busy="true"></div><div id="healthLearnerPages" class="health-actions"></div></aside>
      <section class="health-panel"><p id="healthSelected" class="health-selected" role="status">Select a learner</p><div class="health-tabs" role="group" aria-label="Health sections">${button('Profiles &amp; safety alerts', 'data-health-tab="profiles" aria-pressed="true"')}${button('Incidents &amp; first aid', 'data-health-tab="incidents" aria-pressed="false"')}${button('Restricted access log', 'data-health-tab="logs" aria-pressed="false"')}</div><div id="healthPanel" aria-live="polite"></div></section></div>`;
    byId('healthLearnerFilter').addEventListener('input', renderLearnerChoices);
    main.querySelectorAll('[data-health-tab]').forEach(control => control.addEventListener('click', () => { clear(); state.tab = control.dataset.healthTab; renderPanel(); }));
    renderPanel(); loadLearners();
  }
  async function loadLearners() {
    if (!current() || state.denied) return;
    const request = ++state.pickerRequest, target = byId('healthLearners');
    state.pickerReady = false; state.rows = []; target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading this learner page…'); byId('healthLearnerPages').innerHTML = ''; byId('healthLearnerCount').textContent = 'Loading learner page…';
    const result = await read(`/api/v1/students?page=${state.pickerPage}&per_page=20`);
    if (state.denied || request !== state.pickerRequest) return;
    target.setAttribute('aria-busy', 'false');
    byId('healthLearnerCount').textContent = 'Learner page unavailable';
    if (!result.ok) { error(target, result, loadLearners); return; }
    if (!Array.isArray(result.data) || !Number.isInteger(result.meta?.total) || result.meta.total < result.data.length || !Number.isInteger(result.meta?.per_page) || result.meta.per_page < 1) { error(target, { error: 'Unexpected learner response.' }, loadLearners); return; }
    if (result.data.some(row => !row || !validId(row.id) || !['first_name', 'last_name', 'admission_no'].every(key => typeof row[key] === 'string'))) { error(target, { error: 'Unexpected learner identity response.' }, loadLearners); return; }
    state.rows = result.data.map(row => ({ id: row.id, first_name: row.first_name, last_name: row.last_name, admission_no: row.admission_no }));
    state.pickerReady = true;
    renderLearnerChoices();
    const pages = Math.max(1, Math.ceil(result.meta.total / result.meta.per_page));
    byId('healthLearnerPages').innerHTML = `<span>Page ${state.pickerPage} of ${pages}</span>${button('Previous', `id="healthLearnerPrev" ${state.pickerPage <= 1 ? 'disabled' : ''}`)}${button('Next', `id="healthLearnerNext" ${state.pickerPage >= pages ? 'disabled' : ''}`)}`;
    byId('healthLearnerPrev').addEventListener('click', () => { if (state.pickerPage > 1) { state.pickerPage--; loadLearners(); } });
    byId('healthLearnerNext').addEventListener('click', () => { if (state.pickerPage < pages) { state.pickerPage++; loadLearners(); } });
  }
  function renderLearnerChoices() {
    // Filtering is local: only the latest text is applied once a page has loaded.
    // It must not replace a pending loader or erase a failed request's retry.
    if (!current() || !state.pickerReady) return;
    const query = byId('healthLearnerFilter').value.trim().toLowerCase();
    const rows = state.rows.filter(row => `${row.first_name} ${row.last_name} ${row.admission_no}`.toLowerCase().includes(query));
    byId('healthLearnerCount').textContent = `${rows.length} of ${state.rows.length} learners on this page`;
    byId('healthLearners').innerHTML = rows.length ? rows.map(row => `<button type="button" class="btn btn-secondary health-choice" data-health-learner="${esc(row.id)}" aria-pressed="${String(row.id) === String(state.learner?.id)}">${esc(row.first_name)} ${esc(row.last_name)}<br><small>Admission ${esc(row.admission_no)}</small></button>`).join('') : MGAEMS.emptyStateHTML(state.rows.length ? 'No learners on this page match' : 'No learners returned', state.rows.length ? 'Clear the filter or browse another page.' : 'The authorized roster returned no learners on this page.', 'users');
    byId('healthLearners').querySelectorAll('[data-health-learner]').forEach(control => control.addEventListener('click', () => {
      if (!current()) { deny(); return; }
      clear(); state.learner = state.rows.find(row => String(row.id) === control.dataset.healthLearner); byId('healthSelected').textContent = learnerTitle(); renderLearnerChoices(); renderPanel();
    }));
  }
  function renderPanel() {
    if (!current()) { deny(); return; }
    main.querySelectorAll('[data-health-tab]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.healthTab === state.tab)));
    const target = byId('healthPanel');
    target.innerHTML = '';
    if (state.tab === 'logs') { list(target, '/api/v1/health/access-log', 'log'); return; }
    if (!state.learner) { target.innerHTML = MGAEMS.emptyStateHTML('Choose an existing learner', 'Select a learner to open restricted profiles, safety alerts or school incidents.', 'shield-check'); return; }
    if (state.tab === 'profiles') loadProfile();
    else { target.innerHTML = `<h2>School health incidents</h2>${actions(button('Record incident', 'id="healthNewIncident"', true))}<div id="healthIncidentList"></div>`;
      byId('healthNewIncident').addEventListener('click', () => editor('incident', `/api/v1/health/incidents`, null, null, renderPanel));
      list(byId('healthIncidentList'), `/api/v1/health/incidents?student_id=${state.learner.id}`, 'incident', openIncident);
    }
  }
  async function loadProfile() {
    if (!current()) { deny(); return; }
    const generation = state.generation, learnerId = state.learner.id, target = byId('healthPanel');
    state.profile = null; target.innerHTML = MGAEMS.loadingHTML('Loading learner Health profile…');
    const result = await read(`/api/v1/health/profiles?student_id=${learnerId}`);
    if (!alive(generation)) return;
    if (!result.ok) { error(target, result, loadProfile); return; }
    if (!Array.isArray(result.data) || result.data.length > 1 || result.data.some(row => !validRecord(row) || row.student_id !== learnerId)) { error(target, { error: 'Unexpected profile identity.' }); return; }
    if (!result.data.length) {
      target.innerHTML = MGAEMS.emptyStateHTML('No Health profile recorded', 'Legacy medical records remain separate. No information has been automatically converted.', 'shield-check') + actions(button('Record Health profile', 'id="healthNewProfile"', true));
      byId('healthNewProfile').addEventListener('click', () => editor('profile', '/api/v1/health/profiles', null, null, loadProfile)); return;
    }
    const record = await read(`/api/v1/health/profiles/${result.data[0].id}`);
    if (!alive(generation)) return;
    if (!record.ok) { error(target, record, loadProfile); return; }
    if (!validRecord(record.data) || record.data.student_id !== learnerId || record.data.id !== result.data[0].id) { error(target, { error: 'Unexpected profile identity.' }); return; }
    state.profile = project('profile', record.data);
    const path = `/api/v1/health/profiles/${state.profile.id}`;
    target.innerHTML = `<h2>Learner Health profile</h2><p class="health-note">Recorded information is not a medical diagnosis or clearance. An unknown or empty allergy record does not mean no allergies.</p>${details('profile', state.profile)}${actions(button('Correct profile', 'id="healthEditProfile"') + button('Record human review', 'id="healthReviewProfile"') + button('Restricted revision history', 'id="healthProfileHistory"'))}<section class="section"><h2>Safety alerts</h2><p>Only the alert description and instructions are published to scoped Teachers. Publication does not establish medical verification.</p>${actions(button('Record safety alert', 'id="healthNewAlert"', true))}<div id="healthAlertList"></div></section>`;
    byId('healthEditProfile').addEventListener('click', () => editor('profile', path, state.profile, null, loadProfile));
    byId('healthReviewProfile').addEventListener('click', () => editor('profile', path + '/review', state.profile, null, loadProfile, 'review'));
    byId('healthProfileHistory').addEventListener('click', () => history('profile', path));
    byId('healthNewAlert').addEventListener('click', () => editor('alert', path + '/alerts', null, null, loadProfile));
    list(byId('healthAlertList'), path + '/alerts', 'alert', id => openRecord('alert', path + '/alerts/' + id, null, loadProfile));
  }
  async function openIncident(id) {
    if (!current()) { deny(); return; }
    clear(); const generation = state.generation, target = byId('healthPanel');
    target.innerHTML = MGAEMS.loadingHTML('Loading restricted incident…');
    const result = await read('/api/v1/health/incidents/' + id);
    if (!alive(generation)) return;
    if (!result.ok) { error(target, result, () => openIncident(id)); return; }
    if (!validRecord(result.data) || result.data.id !== Number(id) || result.data.student_id !== state.learner.id) { error(target, { error: 'Unexpected incident identity.' }); return; }
    state.incident = project('incident', result.data);
    const path = '/api/v1/health/incidents/' + id;
    target.innerHTML = `<h2>School health incident</h2>${details('incident', state.incident)}${actions(button('Back to incidents', 'id="healthBackIncidents"') + button('Correct incident facts', 'id="healthEditIncident"') + button('Restricted revision history', 'id="healthIncidentHistory"'))}
      <h2>School actions and follow-up</h2><p>Record actions and contact attempts that actually occurred. Operational status changes are recorded through a new action.</p><div class="health-tabs" role="group" aria-label="Incident records">${button('First aid &amp; actions', 'data-health-group="actions"')}${button('Guardian notifications', 'data-health-group="notifications"')}${button('External referrals', 'data-health-group="referrals"')}</div><div id="healthEntries"></div>`;
    byId('healthBackIncidents').addEventListener('click', () => { clear(); renderPanel(); });
    byId('healthEditIncident').addEventListener('click', () => editor('incident', path, state.incident, null, () => openIncident(id)));
    byId('healthIncidentHistory').addEventListener('click', () => history('incident', path));
    target.querySelectorAll('[data-health-group]').forEach(control => control.addEventListener('click', () => loadEntries(control.dataset.healthGroup)));
    loadEntries('actions');
  }
  function loadEntries(group) {
    if (!current()) { deny(); return; }
    state.generation++; clearModal(); const parent = state.incident;
    const type = ({ actions: 'action', notifications: 'notification', referrals: 'referral' })[group];
    const path = `/api/v1/health/incidents/${parent.id}/${group}`, target = byId('healthEntries');
    target.innerHTML = `<h3>${esc(label(group))}</h3>${actions(button('Record ' + (type === 'notification' ? 'contact attempt' : type === 'referral' ? 'external referral' : 'school action'), 'id="healthNewEntry"', true))}<div id="healthEntryList"></div>`;
    byId('healthNewEntry').addEventListener('click', () => editor(type, path, null, parent, () => openIncident(parent.id)));
    list(byId('healthEntryList'), path, type, id => openRecord(type, path + '/' + id, parent, () => openIncident(parent.id)));
  }
  function summary(type, row) {
    if (type === 'log') return `${esc(label(row.operation))} · ${esc(row.record_type)} #${esc(row.record_id ?? '—')} · User #${esc(row.actor_id)} · ${esc(displayTime(row.recorded_at))}`;
    if (type === 'alert') return `${esc(label(row.alert_type))} · ${row.is_active === true ? 'Active' : 'Inactive'} · ${esc(String(row.starts_on).slice(0, 10))} – ${esc(row.ends_on ? String(row.ends_on).slice(0, 10) : 'No end date')}`;
    if (type === 'incident') return `${esc(label(row.category))} · ${esc(label(row.status))} / ${esc(label(row.disposition))} · ${esc(displayTime(row.occurred_at))}`;
    const time = ({ action: 'action_at', notification: 'attempted_at', referral: 'referred_at' })[type];
    return `${esc(label(row.action_type || row.channel || row.follow_up_status))}${row.outcome ? ' · ' + esc(label(row.outcome)) : ''} · ${esc(displayTime(row[time]))}`;
  }
  function list(target, path, type, open) {
    const generation = state.generation, owner = type === 'alert' ? state.profile?.id : state.incident?.id, learnerId = state.learner?.id;
    let rows = [], page = 0, loading = false;
    const timeKey = ({ action: 'action_at', notification: 'attempted_at', referral: 'referred_at' })[type];
    const micros = iso => { const extra = String(iso).match(/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/)?.[1]?.padEnd(6, '0').slice(3) || '0'; return BigInt(Date.parse(iso)) * 1000n + BigInt(extra); };
    async function load() {
      if (loading || !alive(generation)) return;
      loading = true; target.innerHTML = MGAEMS.loadingHTML('Loading restricted records…');
      const result = await read(path + (path.includes('?') ? '&' : '?') + `page=${page + 1}&per_page=20`);
      loading = false; if (!alive(generation)) { rows = []; return; }
      if (!result.ok) { error(target, result, load); return; }
      if (!Array.isArray(result.data) || !Number.isInteger(result.meta?.total) || result.meta.total < 0 || result.data.some(row => !row || typeof row !== 'object' || Array.isArray(row) || !validId(row.id) || (type !== 'log' && !validRecord(row))
        || (type === 'incident' && row.student_id !== learnerId) || (type === 'alert' && row.profile_id !== owner)
        || (['action', 'notification', 'referral'].includes(type) && row.incident_id !== owner) || (timeKey && !Number.isFinite(Date.parse(row[timeKey]))))) { rows = []; error(target, { error: 'Unexpected record list identity.' }); return; }
      page++; rows = [...new Map(rows.concat(result.data.map(row => project(type, row, true))).map(row => [row.id, row])).values()];
      if (timeKey && rows.every(row => Number.isFinite(Date.parse(row[timeKey])))) rows.sort((a, b) => micros(a[timeKey]) < micros(b[timeKey]) ? -1 : micros(a[timeKey]) > micros(b[timeKey]) ? 1 : a.id - b.id);
      target.innerHTML = rows.length ? (timeKey ? '<p class="text-muted">Loaded entries are ordered by actual event time. Load earlier records to extend the history.</p>' : '') + rows.map(row => `<article class="health-record"><h3>${summary(type, row)}</h3><p class="text-muted">${type === 'log' ? 'Access event' : 'Record'} #${esc(row.id)}${type === 'log' ? '' : ' · Revision ' + esc(row.revision_number)}</p>${open ? button('View restricted details', `data-health-record="${esc(row.id)}"`) : ''}</article>`).join('') : MGAEMS.emptyStateHTML('No records recorded', 'No school Health information has been recorded in this section.', 'shield-check');
      if (page * 20 < result.meta.total) target.innerHTML += button('Load earlier records', 'data-health-more');
      target.querySelectorAll('[data-health-record]').forEach(control => control.addEventListener('click', () => open(Number(control.dataset.healthRecord))));
      target.querySelector('[data-health-more]')?.addEventListener('click', load);
    }
    load();
  }
  function privateModal(title, body) {
    clearModal();
    const modal = MGAEMS.openModal({ title, body, onClose: () => { modal.body.innerHTML = ''; if (state.modal === modal) state.modal = null; } });
    modal.overlay.setAttribute('class', 'modal-overlay health-dialog');
    state.modal = modal; return modal;
  }
  async function openRecord(type, path, parent, refresh) {
    if (!current()) { deny(); return; }
    const generation = state.generation, modal = privateModal('Restricted ' + label(type), MGAEMS.loadingHTML('Loading record…'));
    const result = await read(path);
    if (!alive(generation) || modal.closed) return;
    if (!result.ok) { error(modal.body, result); return; }
    const record = project(type, result.data || {}), owner = type === 'alert' ? state.profile?.id : parent?.id;
    if (!validRecord(record) || record.id !== Number(path.split('/').at(-1)) || (type === 'alert' ? record.profile_id !== owner : record.incident_id !== owner)) { error(modal.body, { error: 'Unexpected record identity.' }); return; }
    modal.body.innerHTML = details(type, record) + actions(button('Correct record', 'data-health-edit') + button('Restricted revision history', 'data-health-history') + (type === 'alert' ? button(record.is_active ? 'Deactivate alert' : 'Activate alert', 'data-health-activate') + button('Record operational verification', 'data-health-verify') : ''));
    modal.body.querySelector('[data-health-edit]').addEventListener('click', () => editor(type, path, record, parent, refresh));
    modal.body.querySelector('[data-health-history]').addEventListener('click', () => history(type, path));
    if (type === 'alert') {
      modal.body.querySelector('[data-health-activate]').addEventListener('click', () => editor(type, path, record, null, refresh, 'activation'));
      modal.body.querySelector('[data-health-verify]').addEventListener('click', () => editor(type, path + '/verify', record, null, refresh, 'verify'));
    }
    modal.body.querySelector('button').focus();
  }
  async function history(type, path) {
    if (!current()) { deny(); return; }
    const generation = state.generation, modal = privateModal('Restricted correction history', MGAEMS.loadingHTML('Loading immutable revisions…'));
    let page = 1;
    async function load() {
      modal.body.innerHTML = MGAEMS.loadingHTML('Loading immutable revisions…');
      const result = await read(path + `/revisions?page=${page}&per_page=20`);
      if (!alive(generation) || modal.closed) return;
      if (!result.ok) { error(modal.body, result, load); return; }
      if (!Array.isArray(result.data) || !Number.isInteger(result.meta?.total) || result.meta.total < 0 || result.data.some(row => !row || typeof row !== 'object' || !Number.isInteger(row.revision_number) || row.revision_number < 1 || !row.snapshot || typeof row.snapshot !== 'object' || Array.isArray(row.snapshot))) { error(modal.body, { error: 'Unexpected revision response.' }); return; }
      modal.body.innerHTML = result.data.length ? result.data.map((row, index) => `<article class="health-record"><h3>Revision ${esc(row.revision_number)} · ${esc(label(row.change_type))}</h3><p>User #${esc(row.actor_id)} · ${esc(displayTime(row.recorded_at))}</p>${button('Inspect this revision', `data-health-revision="${index}" aria-expanded="false" aria-controls="healthSnapshot${index}"`)}<div id="healthSnapshot${index}" data-health-snapshot="${index}"></div></article>`).join('') : MGAEMS.emptyStateHTML('No revision history', 'No revisions are available.', 'history');
      modal.body.innerHTML += actions(button('Previous', `data-history-prev ${page <= 1 ? 'disabled' : ''}`) + button('Next', `data-history-next ${page * 20 >= result.meta.total ? 'disabled' : ''}`));
      modal.body.querySelectorAll('[data-health-revision]').forEach(control => control.addEventListener('click', () => {
        if (!alive(generation)) { deny(); return; }
        const row = result.data[Number(control.dataset.healthRevision)];
        const expanded = control.getAttribute('aria-expanded') !== 'true';
        control.setAttribute('aria-expanded', String(expanded));
        control.textContent = expanded ? 'Hide this revision' : 'Inspect this revision';
        modal.body.querySelector(`[data-health-snapshot="${control.dataset.healthRevision}"]`).innerHTML = expanded ? `<p class="health-note">Correction reason: ${esc(row.correction_reason || 'Creation or operational event')}</p>${details(type, row.snapshot || {})}` : '';
      }));
      modal.body.querySelector('[data-history-prev]').addEventListener('click', () => { if (page > 1) { page--; load(); } });
      modal.body.querySelector('[data-history-next]').addEventListener('click', () => { if (page * 20 < result.meta.total) { page++; load(); } });
      modal.body.querySelector('button')?.focus();
    }
    load();
  }
  async function editor(type, path, record, parent, refresh, operation = 'edit') {
    if (!current()) { deny(); return; }
    const generation = state.generation, learnerId = state.learner.id;
    const modal = privateModal((record ? 'Correct / review ' : 'Record ') + label(type), MGAEMS.loadingHTML('Preparing the restricted form…'));
    let fields = schemas[type].map(f => ({ ...f }));
    if (record && type === 'action') fields = fields.filter(f => !['status_after', 'disposition_after'].includes(f.name));
    if (record && type === 'notification') fields = fields.filter(f => f.name !== 'guardian_id');
    if (operation === 'review' || operation === 'activation') fields = [];
    if (operation === 'verify') fields = [field('verification_basis', 'Known basis for operational verification', 'textarea', { required: true, max: 200 })];
    let guardians = [];
    if (!record && type === 'notification') {
      const result = await read('/api/v1/students/' + learnerId);
      if (!alive(generation) || modal.closed) return;
      if (!result.ok) { error(modal.body, result); return; }
      if (result.data?.id !== learnerId || !Array.isArray(result.data.guardians)) { error(modal.body, { error: 'Current Guardian relationships could not be verified.' }); return; }
      if (result.data.guardians.some(g => !g || typeof g !== 'object' || !validId(g.id))) { error(modal.body, { error: 'Current Guardian relationships could not be verified.' }); return; }
      guardians = result.data.guardians.map(g => ({ id: g.id, full_name: g.full_name, relationship: g.relationship, phone: g.phone, email: g.email }));
      fields.find(f => f.name === 'guardian_id').choices = guardians.map(g => [g.id, `${g.full_name} · ${g.relationship}`]);
    }
    if (!alive(generation) || modal.closed) return;
    const title = operation === 'activation' ? `${record.is_active ? 'Deactivate' : 'Activate'} this alert` : operation === 'review' ? 'Record an explicit human review' : operation === 'verify' ? 'Record operational verification' : record ? 'Correct the recorded facts' : 'Record facts that actually occurred';
    function control(f) {
      const raw = f.name === 'contact_used' ? record?.contact_snapshot?.contact_used : record?.[f.name];
      const value = raw ?? f.initial ?? '';
      const attrs = `id="healthField-${f.name}" name="${f.name}" ${f.required ? 'required' : ''} ${f.max ? `maxlength="${f.max}"` : ''}`;
      if (f.type === 'checkbox') return `<div class="field"><label class="health-checkbox" for="healthField-${f.name}"><input type="checkbox" ${attrs} ${value === true ? 'checked' : ''}>${esc(f.title)}</label></div>`;
      const outsidePicker = f.type === 'instant' && eatInput(value) && !/^\d{4}-/.test(eatInput(value));
      let input = f.type === 'select' ? `<select ${attrs}><option value="">Choose explicitly…</option>${f.choices.map(choice => { const [id, text] = Array.isArray(choice) ? choice : [choice, label(choice)]; return `<option value="${esc(id)}" ${String(value) === String(id) ? 'selected' : ''}>${esc(text)}</option>`; }).join('')}</select>`
        : f.type === 'textarea' ? `<textarea ${attrs} rows="3">${esc(value)}</textarea>`
          : `<input type="${outsidePicker ? 'text' : f.type === 'instant' ? 'datetime-local' : f.type}" ${attrs} ${outsidePicker ? 'data-raw-instant="true"' : f.type === 'instant' ? 'step="0.000001"' : ''} value="${esc(outsidePicker ? value : f.type === 'instant' ? eatInput(value) : f.type === 'date' ? String(value).slice(0, 10) : value)}">`;
      return `<div class="field ${f.type === 'textarea' ? 'health-wide' : ''}"><label for="healthField-${f.name}">${esc(outsidePicker ? f.title.replace('EAT (UTC+03:00)', 'explicit UTC / offset instant') : f.title)}</label>${input}${outsidePicker ? '<p class="hint">This instant falls outside the EAT date-picker range. Preserve or enter its explicit UTC/offset timestamp.</p>' : ''}</div>`;
    }
    modal.body.innerHTML = `<form id="healthRecordForm"><div data-form-error role="alert" tabindex="-1"></div><h3>${esc(title)}</h3><p>${esc(learnerTitle())}${record ? ' · Revision ' + esc(record.revision_number) : ''}${parent ? ' · Incident revision ' + esc(parent.revision_number) : ''}</p>
      <p class="health-note">${type === 'notification' ? 'Record a contact attempt already made. Nothing is sent. Enter the actual contact used; the current relationship or primary-contact flag does not establish disclosure consent.' : type === 'alert' ? 'Alert descriptions and emergency instructions are Teacher-visible publication fields. Include only actionable school safety information. Verification is an explicit operational review, not medical clearance.' : type === 'profile' ? 'Unknown and none reported are different statements. Legacy medical information is not imported.' : 'Enter actual school events and observed or reported facts. Times use East Africa Time (UTC+03:00); the server preserves the underlying UTC instant.'}</p>
      ${record && ['activation', 'review', 'verify'].includes(operation) ? details(type, record) : ''}<div class="health-form-grid">${fields.map(control).join('')}${record ? '<div class="field health-wide"><label for="healthCorrectionReason">Reason for correction / review</label><textarea id="healthCorrectionReason" name="correction_reason" maxlength="500" required rows="2"></textarea></div>' : ''}</div>
      ${type === 'notification' && !record ? '<div id="healthGuardianReference" class="health-note" hidden></div>' : ''}
      ${actions(button('Cancel', 'data-health-cancel') + button('Reload current record', 'data-health-reload hidden') + '<button type="submit" class="btn btn-primary" id="healthRecordSave">Confirm and record</button>')}</form>`;
    const form = modal.body.querySelector('#healthRecordForm'), baselineTimes = {};
    fields.filter(f => f.type === 'instant').forEach(f => { baselineTimes[f.name] = modal.body.querySelector('#healthField-' + f.name).value; });
    if (fields.some(f => f.name === 'allergy_information_state')) modal.body.querySelector('#healthField-allergy_information_state').addEventListener('change', () => {
      const selected = modal.body.querySelector('#healthField-allergy_information_state').value;
      modal.body.querySelector('#healthField-allergy_information').required = selected === 'recorded';
    });
    if (guardians.length) modal.body.querySelector('#healthField-guardian_id').addEventListener('change', event => {
      const guardian = guardians.find(g => String(g.id) === event.target.value), reference = modal.body.querySelector('#healthGuardianReference');
      reference.hidden = !guardian; reference.textContent = guardian ? `Current contact reference: ${guardian.phone || 'phone not recorded'} · ${guardian.email || 'email not recorded'}. This is not the historical contact used.` : '';
    });
    modal.body.querySelector('[data-health-cancel]').addEventListener('click', () => { clearModal(); });
    modal.body.querySelector('[data-health-reload]').addEventListener('click', () => { clearModal(); refresh(); });
    modal.body.querySelector('input, select, textarea')?.focus();
    let pending = false, conflict = false, frozenAttempt = null, uncertain = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (pending || conflict || !alive(generation) || modal.closed || !form.reportValidity()) return;
      const data = {};
      for (const f of fields) {
        const input = modal.body.querySelector('#healthField-' + f.name);
        if (f.type === 'checkbox') data[f.name] = input.checked;
        else if (f.type === 'instant') data[f.name] = record && input.value === baselineTimes[f.name] ? record[f.name] : input.dataset.rawInstant ? input.value : eventInstant(input.value);
        else if (f.name === 'guardian_id') data[f.name] = input.value ? Number(input.value) : null;
        else data[f.name] = input.value === '' ? null : input.value;
      }
      if (type === 'profile' && ((data.allergy_information_state === 'recorded') !== !!String(data.allergy_information || '').trim())) { MGAEMS.showFormErrors(form, { error: 'Recorded allergies require details; unknown or none reported must not contain recorded allergy details.' }); return; }
      if (!record && type === 'action' && ((data.status_after === null) !== (data.disposition_after === null) || (data.status_after === 'closed' && data.disposition_after === 'none'))) { MGAEMS.showFormErrors(form, { error: 'A status transition requires both status and disposition. Closing requires a recorded disposition.' }); return; }
      if (record) {
        data.expected_revision = record.revision_number; data.correction_reason = modal.body.querySelector('#healthCorrectionReason').value.trim();
        if (operation === 'activation') data.is_active = !record.is_active;
      } else {
        if (type === 'profile' || type === 'incident') data.student_id = learnerId;
        if (type !== 'profile') {
          // Reuse a UUID only for an unchanged retry of this exact form payload.
          const fingerprint = JSON.stringify(data);
          if (uncertain && frozenAttempt && frozenAttempt.fingerprint !== fingerprint) { MGAEMS.showFormErrors(form, { error: 'The previous attempt may have been recorded. Reload and review the current history before changing its facts.' }); modal.body.querySelector('[data-health-reload]').hidden = false; return; }
          if (!frozenAttempt || frozenAttempt.fingerprint !== fingerprint) frozenAttempt = { fingerprint, id: requestId() };
          data.request_id = frozenAttempt.id;
        }
      }
      if (parent) data.expected_incident_revision = parent.revision_number;
      pending = true;
      modal.setBusy(true);
      const disabledFields = [...form.querySelectorAll('input, select, textarea')].map(input => [input, input.disabled]);
      disabledFields.forEach(([input]) => { input.disabled = true; });
      const confirmed = await MGAEMS.confirmAction('Confirm this school Health record?', 'Verify the selected learner, actual facts and event time. This operation records a restricted revision; active alert publication makes its actionable instructions visible only within the backend Teacher scope.', 'Confirm and save');
      if (!confirmed || !alive(generation) || modal.closed) {
        pending = false; modal.setBusy(false);
        if (!current()) deny();
        else if (!alive(generation)) { modal.body.innerHTML = ''; modal.close(); }
        else disabledFields.forEach(([input, disabled]) => { input.disabled = disabled; });
        return;
      }
      const method = record && !['review', 'verify'].includes(operation) ? 'patch' : 'post';
      const result = await MGAEMS[method](path, data);
      if (!current() || [401, 403].includes(result.status)) deny();
      modal.setBusy(false); pending = false;
      if (!alive(generation) || modal.closed) return;
      disabledFields.forEach(([input, disabled]) => { input.disabled = disabled; });
      if (!result.ok) {
        uncertain = result.status === undefined || result.status >= 500;
        MGAEMS.showFormErrors(form, result);
        if (result.status === 409) { conflict = true; modal.body.querySelector('#healthRecordSave').disabled = true; modal.body.querySelector('[data-health-reload]').hidden = false; }
        return;
      }
      clearModal(); MGAEMS.toast('School Health record saved.', 'success'); refresh();
    });
  }
  window.addEventListener('pagehide', () => { clearWorkspace(); main.innerHTML = ''; });
  window.addEventListener('pageshow', event => { if (event.persisted) start(); });
  start();
})();
