/* Current term-result workflow; teaching context and revisions remain server-owned. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || MGAEMS.landingPage(user) !== '/dashboard.html') return;
  renderAppShell('/assessment.html');
  const main = document.getElementById('appMain'), esc = MGAEMS.escapeHTML;
  const leader = ['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(user.role);
  const state = { context: null, selection: {}, learners: [], dirty: new Set(), conflicts: new Set(), busy: false, reportBusy: false, rosterRequest: 0, historyRequest: 0, reportRequest: 0, learnerRequest: 0, historyPage: 1, reportPage: 1, card: null };
  const byId = id => document.getElementById(id);
  const dateTime = value => value && Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' (Nairobi)' : value || 'Unknown generation time';
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validId = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const identified = value => record(value) && validId(value.id);
  const rowList = value => Array.isArray(value) && value.every(identified);
  const validTerm = term => identified(term) && validId(term.academic_year_id) && identified(term.academic_year) && typeof term.name === 'string' && typeof term.academic_year.name === 'string';
  const validMeta = meta => record(meta) && Number.isInteger(meta.total) && meta.total >= 0 && Number.isInteger(meta.per_page) && meta.per_page > 0;
  const validCard = (card, studentId, termId) => identified(card) && Number.isInteger(card.revision_number) && card.revision_number >= 0 && typeof card.download_available === 'boolean' && ['versioned', 'legacy_artifact'].includes(card.history_state) && (card.generated_at == null || typeof card.generated_at === 'string') && (card.student_id == null || String(card.student_id) === studentId) && (card.term_id == null || String(card.term_id) === termId) && (card.student?.id == null || String(card.student.id) === studentId) && (card.term?.id == null || String(card.term.id) === termId);
  const unavailable = message => ({ error: message || 'The response was incomplete. Reload to retrieve verified data.' });
  async function request(method, ...args) { try { const response = await MGAEMS[method](...args); return record(response) && typeof response.ok === 'boolean' ? response : { ok: false, ...unavailable() }; } catch (_) { return { ok: false, error: 'The request could not be completed. Review your connection and try again.' }; } }
  const get = (...args) => request('get', ...args), post = (...args) => request('post', ...args);
  const typeName = type => ({ continuous: 'Continuous', end_term: 'End-term' }[type] || type);
  const unique = values => [...new Map(values.filter(Boolean).map(value => [value.id, value])).values()];
  const options = (items, chosen = '', label = item => item.name, placeholder = 'Select…') => `<option value="">${placeholder}</option>` + items.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(chosen) ? 'selected' : ''}>${esc(label(item))}</option>`).join('');
  const table = (headings, rows, className = '') => `<div class="table-scroll" role="region" aria-label="${className ? 'Assessment entry' : 'Saved results'} table" tabindex="0"><table class="${className}"><thead><tr>${headings.map(title => `<th scope="col">${title}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const tabs = [['entry', 'Assessment entry'], ['history', 'Saved results'], ...(leader ? [['reports', 'Report cards']] : [])];
  main.innerHTML = `<div class="assessment-workspace"><div class="page-heading assessment-heading"><h1>CBC Assessment &amp; Report Cards</h1><p>Record continuous and end-term results in your authorized teaching context. Scores, performance levels and remarks remain separate; corrections retain their history.</p></div>
    <div class="tabs assessment-tabs" role="tablist" aria-label="Assessment sections">${tabs.map(([key, title], index) => `<button type="button" class="tab ${index ? '' : 'active'}" id="assessmentTab_${key}" role="tab" aria-selected="${!index}" aria-controls="assessmentPanel_${key}" tabindex="${index ? -1 : 0}" data-tab="${key}">${title}</button>`).join('')}</div>
    <section class="tab-panel active" id="assessmentPanel_entry" role="tabpanel" aria-labelledby="assessmentTab_entry"><div class="card" id="contextArea">${MGAEMS.loadingHTML('Loading teaching contexts…')}</div><div id="rosterArea" aria-live="polite"></div></section>
    <section class="tab-panel" id="assessmentPanel_history" role="tabpanel" aria-labelledby="assessmentTab_history" hidden><div class="card"><h2>Saved assessment results</h2><p class="assessment-note">Results retain their captured class, learning area and term. History does not grant correction rights after a learner leaves a class. Unresolved legacy results and revision details remain leadership-only.</p><form id="historyForm" class="assessment-filter-form"><div class="field"><label for="historyTerm">Reporting term</label><select id="historyTerm"></select></div><button type="submit" class="btn btn-secondary">Load saved results</button></form></div><div id="historyArea" aria-live="polite"></div></section>
    ${leader ? '<section class="tab-panel" id="assessmentPanel_reports" role="tabpanel" aria-labelledby="assessmentTab_reports" hidden><div class="card" id="reportFilters"></div><div id="reportArea" aria-live="polite"></div></section>' : ''}</div>`;
  const tabControls = [...main.querySelectorAll('[data-tab]')];
  function selectTab(selected) { tabControls.forEach(tab => { const active = tab === selected; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; const panel = byId(tab.getAttribute('aria-controls')); panel.hidden = !active; panel.classList.toggle('active', active); }); }
  tabControls.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => { const next = event.key === 'ArrowRight' ? tabControls[(index + 1) % tabControls.length] : event.key === 'ArrowLeft' ? tabControls[(index + tabControls.length - 1) % tabControls.length] : event.key === 'Home' ? tabControls[0] : event.key === 'End' ? tabControls.at(-1) : null; if (next) { event.preventDefault(); selectTab(next); next.focus(); } });
  });
  function show(target, html) { target.innerHTML = html; target.setAttribute('aria-busy', 'false'); MGAEMS.initIcons(); }
  function failure(target, result, retry) { show(target, MGAEMS.errorHTML(result.error) + '<button type="button" class="btn btn-secondary" data-retry>Try again</button>'); target.querySelector('[data-retry]').addEventListener('click', retry); }
  function terms() { return state.context.scope === 'school' ? state.context.terms : unique(state.context.assignments.map(item => item.term)); }
  async function setup() {
    const result = await get('/api/v1/assessments/context');
    if (!result.ok) { failure(byId('contextArea'), result, setup); return; }
    const context = result.data;
    const validVocabulary = list => Array.isArray(list) && list.length > 0 && list.every(value => typeof value === 'string' && value.trim()) && new Set(list).size === list.length;
    const validContext = record(context) && context.scope === (leader ? 'school' : 'assigned') && Array.isArray(context.assignments) && validVocabulary(context.assessment_types) && validVocabulary(context.competency_ratings)
      && (leader ? rowList(context.classes) && rowList(context.subjects) && Array.isArray(context.offerings) && context.offerings.every(item => record(item) && validId(item.class_id) && validId(item.subject_id)) && Array.isArray(context.terms) && context.terms.every(validTerm)
        : context.assignments.every(item => record(item) && ['term_id', 'class_id', 'subject_id'].every(key => validId(item[key])) && validTerm(item.term) && String(item.term_id) === String(item.term.id) && identified(item.school_class) && String(item.class_id) === String(item.school_class.id) && identified(item.subject) && String(item.subject_id) === String(item.subject.id)));
    if (!validContext) { failure(byId('contextArea'), unavailable('Teaching context is incomplete or does not match your authorized workspace. No roster was loaded.'), setup); return; }
    state.context = result.data;
    const current = terms().find(term => term.is_current) || terms()[0];
    state.selection = { year: current?.academic_year_id || '', term: current?.id || '', class: '', subject: '', type: result.data.assessment_types[0] || '' };
    renderContext();
    byId('historyTerm').innerHTML = options(terms(), '', item => `${item.name} · ${item.academic_year?.name || ''}`, 'All permitted terms');
    if (leader) setupReports(); loadHistory();
  }
  function permitted() {
    const context = state.context;
    if (context.scope === 'school') return { classes: context.classes, subjects: context.subjects.filter(subject => context.offerings.some(offering => String(offering.class_id) === String(state.selection.class) && String(offering.subject_id) === String(subject.id))) };
    let assignments = context.assignments.filter(item => String(item.term_id) === String(state.selection.term));
    return { classes: unique(assignments.map(item => item.school_class)), subjects: unique(assignments.filter(item => String(item.class_id) === String(state.selection.class) && item.subject?.status === 'active').map(item => item.subject)) };
  }
  function renderContext() {
    const available = permitted(); const allTerms = terms(), years = unique(allTerms.map(term => term.academic_year));
    const filteredTerms = allTerms.filter(term => !state.selection.year || String(term.academic_year_id) === String(state.selection.year));
    if (!available.classes.some(item => String(item.id) === String(state.selection.class))) state.selection.class = '';
    if (!available.subjects.some(item => String(item.id) === String(state.selection.subject))) state.selection.subject = '';
    show(byId('contextArea'), `<div class="assessment-section-heading"><h2>Teaching context</h2><span class="badge badge-navy">${state.context.scope === 'assigned' ? 'Subject Teacher assignments' : 'School leadership'}</span></div><p class="assessment-note">${state.context.scope === 'assigned' ? 'Only assigned class, learning-area and term combinations are available. Class Teacher ownership alone does not grant assessment rights.' : 'Select an offered learning area before loading current active learners.'} Required selections are marked with an asterisk.</p>${state.context.scope === 'assigned' && !state.context.assignments.length ? MGAEMS.emptyStateHTML('No subject-teacher assignments', 'Class Teacher ownership alone does not grant assessment rights.', 'book-x') : ''}<form id="contextForm"><div class="form-grid assessment-context-grid">
      <div class="field"><label for="assessmentYear">Academic year</label><select id="assessmentYear">${options(years, state.selection.year, item => item.name, 'All years')}</select></div>
      <div class="field"><label for="assessmentTerm">Term *</label><select id="assessmentTerm" required>${options(filteredTerms, state.selection.term)}</select></div>
      <div class="field"><label for="assessmentClass">Class *</label><select id="assessmentClass" required>${options(available.classes, state.selection.class)}</select></div>
      <div class="field"><label for="assessmentSubject">Offered learning area *</label><select id="assessmentSubject" required>${options(available.subjects, state.selection.subject)}</select></div>
      <div class="field"><label for="assessmentType">Assessment type *</label><select id="assessmentType" required>${state.context.assessment_types.map(type => `<option value="${esc(type)}" ${type === state.selection.type ? 'selected' : ''}>${esc(typeName(type))}</option>`).join('')}</select></div></div><div class="form-actions"><button type="submit" class="btn btn-primary">Load authorized roster</button></div></form>`);
    ['Year', 'Term', 'Class', 'Subject', 'Type'].forEach(key => byId('assessment' + key).addEventListener('change', event => changeContext(key.toLowerCase(), event.target.value)));
    byId('contextForm').addEventListener('submit', event => { event.preventDefault(); loadRoster(); });
    show(byId('rosterArea'), MGAEMS.emptyStateHTML('Select a teaching context', 'Complete the selections and load the roster.', 'clipboard-check'));
  }
  async function changeContext(key, value) {
    if (state.busy) return;
    if (state.dirty.size) {
      busy(true);
      const discard = await MGAEMS.confirmAction('Discard unsaved results?', 'Switch context and discard unsaved result edits?', 'Discard changes');
      busy(false); if (!discard) { byId('assessment' + key[0].toUpperCase() + key.slice(1)).value = state.selection[key]; return; }
    }
    state.selection[key] = value;
    if (key === 'year') { state.selection.term = ''; state.selection.class = ''; state.selection.subject = ''; }
    if (key === 'term') { state.selection.class = ''; state.selection.subject = ''; }
    if (key === 'class') state.selection.subject = '';
    state.rosterRequest++; state.dirty.clear(); state.conflicts.clear(); state.learners = []; renderContext();
  }
  const contextPayload = () => ({ class_id: Number(state.selection.class), subject_id: Number(state.selection.subject), term_id: Number(state.selection.term), assessment_type: state.selection.type });
  function busy(value) { state.busy = value; main.querySelectorAll('#contextForm select, #contextForm button, #rosterArea input, #rosterArea textarea, #rosterArea select, #rosterArea button').forEach(control => { control.disabled = value || control.dataset.readonly === 'true'; }); if (byId('saveModified')) updateSaveButtons(); }
  async function loadRoster() {
    if (state.busy || !byId('contextForm').reportValidity()) return;
    if (state.dirty.size) {
      busy(true);
      const discard = await MGAEMS.confirmAction('Reload results?', 'Reloading discards unsaved edits. Review or copy your draft values before continuing.', 'Discard and reload');
      busy(false); if (!discard) return;
    }
    state.dirty.clear(); state.conflicts.clear(); state.learners = [];
    const request = ++state.rosterRequest, signature = JSON.stringify(contextPayload());
    const target = byId('rosterArea'); target.innerHTML = MGAEMS.loadingHTML('Loading authorized learners…'); target.setAttribute('aria-busy', 'true');
    const result = await get('/api/v1/assessments/learners?' + new URLSearchParams(contextPayload()));
    if (request !== state.rosterRequest || signature !== JSON.stringify(contextPayload())) return;
    if (!result.ok) { failure(target, result, loadRoster); return; }
    if (!Array.isArray(result.data) || !result.data.every(learner => identified(learner) && typeof learner.first_name === 'string' && typeof learner.last_name === 'string' && typeof learner.admission_no === 'string' && typeof learner.editable === 'boolean' && (learner.class_id == null || String(learner.class_id) === String(state.selection.class)) && ['current', 'historical_context_conflict', 'legacy_unresolved'].includes(learner.context_state) && (!learner.assessment || record(learner.assessment) && Number.isInteger(learner.assessment.revision_number) && learner.assessment.revision_number >= 0 && ['student_id', 'subject_id', 'term_id', 'assessment_type'].every(key => learner.assessment[key] == null || String(learner.assessment[key]) === String(key === 'student_id' ? learner.id : contextPayload()[key]))))) { failure(target, unavailable('Learner results are incomplete or do not match the teaching context. No editable roster was displayed.'), loadRoster); return; }
    state.learners = result.data; renderRoster();
  }
  function savedLabel(learner) { return learner.assessment ? 'Saved revision ' + learner.assessment.revision_number : learner.editable ? 'Not recorded' : 'Leadership review required'; }
  function contextLabel() {
    const available = permitted(), term = terms().find(item => String(item.id) === String(state.selection.term));
    return [term?.academic_year?.name, term?.name, available.classes.find(item => String(item.id) === String(state.selection.class))?.name, available.subjects.find(item => String(item.id) === String(state.selection.subject))?.name, typeName(state.selection.type)].filter(Boolean).map(esc).join(' · ');
  }
  function rowValues(index) { return { score: byId('score_' + index).value.trim(), level: byId('level_' + index).value, remarks: byId('remarks_' + index).value.trim() }; }
  function validRow(index, announce = true) {
    const { score, level, remarks } = rowValues(index), errors = {};
    if (score !== '' && (!Number.isFinite(Number(score)) || Number(score) < 0 || Number(score) > 100)) errors.score = 'Use a score from 0 to 100.';
    if (level && !state.context.competency_ratings.includes(level)) errors.level = 'Choose an available performance level.';
    if (remarks.length > 1000) errors.remarks = 'Remarks must be 1,000 characters or fewer.';
    if (!score && !level && !remarks) errors.score = 'Provide a valid score, performance level, or meaningful remark.';
    ['score', 'level', 'remarks'].forEach(field => { byId(field + '_' + index).setAttribute('aria-invalid', String(Boolean(errors[field]))); byId(field + 'Error_' + index).textContent = errors[field] || ''; });
    if (Object.keys(errors).length && announce) byId('rowState_' + index).textContent = Object.values(errors)[0];
    return !Object.keys(errors).length;
  }
  function updateDraft(index) {
    const learner = state.learners[index], values = rowValues(index), saved = learner.assessment;
    const scoreChanged = values.score === '' ? saved?.score !== null && saved?.score !== undefined && saved?.score !== '' : saved?.score === null || saved?.score === undefined || saved?.score === '' || Number(values.score) !== Number(saved.score);
    const changed = scoreChanged || values.level !== (saved?.competency_rating || '') || values.remarks !== (saved?.remarks || '').trim();
    if (changed) state.dirty.add(index); else state.dirty.delete(index);
    validRow(index, false);
    if (!state.conflicts.has(index)) byId('rowState_' + index).textContent = changed ? 'Unsaved changes' : savedLabel(learner);
    updateSaveButtons();
  }
  function renderRoster() {
    if (!state.learners.length) { show(byId('rosterArea'), MGAEMS.emptyStateHTML('No active learners', 'No current active learners belong to this class.', 'users')); return; }
    show(byId('rosterArea'), `<div class="card assessment-entry-card"><div class="assessment-section-heading"><div><h2>Assessment entry</h2><p class="assessment-context-label">${contextLabel()}</p></div><span class="badge badge-gray">${state.learners.length} learners</span></div><p class="assessment-note">Enter any meaningful score, performance level or remark. Performance levels are separate from core competencies. Corrections append revisions; captured class and offering context stays fixed.</p><div class="assessment-savebar"><p id="assessmentSaveSummary" role="status">No unsaved changes</p><div class="form-actions"><button type="button" class="btn btn-secondary" id="reloadResults">Reload saved results</button><button type="button" class="btn btn-primary" id="saveModified" disabled>Save modified results</button></div></div>${table(['Learner', 'Score (0–100)', 'Performance Level', 'Remarks', 'Saved state', 'Action'], state.learners.map((learner, index) => `<tr><th scope="row" data-label="Learner"><strong>${esc(learner.first_name)} ${esc(learner.last_name)}</strong><div class="assessment-admission">Admission: ${esc(learner.admission_no)}</div>${learner.context_state !== 'current' ? `<div class="assessment-row-note">${learner.context_state === 'historical_context_conflict' ? 'Historical class context conflict — read-only' : 'Unresolved legacy context'}</div>` : ''}</th>
      <td data-label="Score"><label class="sr-only" for="score_${index}">Score for ${esc(learner.first_name)} ${esc(learner.last_name)} (${esc(learner.admission_no)})</label><input class="compact-input" id="score_${index}" type="number" min="0" max="100" step="0.01" inputmode="decimal" aria-describedby="scoreError_${index}" value="${esc(learner.assessment?.score ?? '')}" data-readonly="${!learner.editable}" ${learner.editable ? '' : 'disabled'}><span class="assessment-field-error" id="scoreError_${index}"></span></td>
      <td data-label="Performance level"><label class="sr-only" for="level_${index}">Performance Level for ${esc(learner.first_name)} ${esc(learner.last_name)} (${esc(learner.admission_no)})</label><select class="compact-input" id="level_${index}" aria-describedby="levelError_${index}" data-readonly="${!learner.editable}" ${learner.editable ? '' : 'disabled'}><option value="">Not rated</option>${state.context.competency_ratings.map(level => `<option value="${esc(level)}" ${learner.assessment?.competency_rating === level ? 'selected' : ''}>${esc(level)}</option>`).join('')}</select><span class="assessment-field-error" id="levelError_${index}"></span></td>
      <td data-label="Remarks"><label class="sr-only" for="remarks_${index}">Remarks for ${esc(learner.first_name)} ${esc(learner.last_name)} (${esc(learner.admission_no)})</label><textarea class="compact-input" id="remarks_${index}" rows="2" maxlength="1000" aria-describedby="remarksError_${index}" data-readonly="${!learner.editable}" ${learner.editable ? '' : 'disabled'}>${esc(learner.assessment?.remarks || '')}</textarea><span class="assessment-field-error" id="remarksError_${index}"></span></td>
      <td data-label="Saved state"><div id="rowState_${index}" class="assessment-row-state" role="status">${esc(savedLabel(learner))}</div></td><td data-label="Action"><button type="button" class="btn btn-secondary btn-sm" id="saveRow_${index}" data-readonly="${!learner.editable}" disabled>Save result</button></td></tr>`), 'assessment-entry-table')}</div>`);
    state.learners.forEach((learner, index) => {
      ['score_', 'level_', 'remarks_'].forEach(prefix => { const control = byId(prefix + index); const edit = () => { if (!learner.editable || state.busy) return; updateDraft(index); }; control.addEventListener('input', edit); if (prefix === 'level_') control.addEventListener('change', edit); });
      byId('saveRow_' + index).addEventListener('click', async () => { if (state.busy) return; busy(true); await saveRow(index); busy(false); updateSaveButtons(); });
    });
    byId('reloadResults').addEventListener('click', loadRoster);
    byId('saveModified').addEventListener('click', async () => { if (state.busy) return; busy(true); for (const index of [...state.dirty]) await saveRow(index); busy(false); updateSaveButtons(); });
  }
  function updateSaveButtons() {
    state.learners.forEach((learner, index) => { const button = byId('saveRow_' + index); button.disabled = state.busy || !learner.editable || !state.dirty.has(index) || state.conflicts.has(index); button.textContent = state.conflicts.has(index) ? 'Reload required' : 'Save result'; });
    byId('saveModified').disabled = state.busy || ![...state.dirty].some(index => state.learners[index]?.editable && !state.conflicts.has(index));
    byId('assessmentSaveSummary').textContent = state.busy ? 'Saving changes…' : state.dirty.size ? `${state.dirty.size} unsaved result${state.dirty.size === 1 ? '' : 's'}${state.conflicts.size ? ' · Reload required for conflicts' : ''}` : `No unsaved changes · ${state.learners.filter(learner => learner.assessment).length} recorded results${state.conflicts.size ? ' · Reload required for conflicts' : ''}`;
  }
  async function saveRow(index) {
    const learner = state.learners[index]; if (!learner?.editable || !state.dirty.has(index)) return;
    if (state.conflicts.has(index)) { byId('reloadResults').focus(); return; }
    const { score, level, remarks } = rowValues(index);
    if (!validRow(index)) return;
    if (learner.context_state === 'legacy_unresolved' && !await MGAEMS.confirmAction('Correct unresolved legacy values?', 'Original class, offering and assessor remain unknown. This correction preserves that uncertainty and retains the previous saved values.', 'Save correction')) return;
    const signature = JSON.stringify(contextPayload()); byId('rowState_' + index).textContent = 'Saving…';
    const result = await post('/api/v1/assessments', { ...contextPayload(), student_id: learner.id, score: score === '' ? null : Number(score), competency_rating: level || null, remarks: remarks || null, expected_revision: learner.assessment?.revision_number || 0 });
    if (signature !== JSON.stringify(contextPayload()) || state.learners[index] !== learner) return;
    if (!result.ok) {
      if (result.status === 409) state.conflicts.add(index);
      ['score', 'competency_rating', 'remarks'].forEach(field => { if (!result.fields?.[field]) return; const prefix = field === 'competency_rating' ? 'level' : field; byId(prefix + '_' + index).setAttribute('aria-invalid', 'true'); byId(prefix + 'Error_' + index).textContent = [].concat(result.fields[field]).join(' '); });
      show(byId('rowState_' + index), MGAEMS.errorHTML(Object.values(result.fields || {}).flat()[0] || result.error) + (result.status === 409 ? '<p class="assessment-conflict-note">Your draft is retained. Review or copy it, then use Reload saved results before correcting. This result will not be retried automatically.</p>' : '<p class="assessment-row-note">Your changes remain unsaved. Review the message and try again.</p>')); return;
    }
    if (!record(result.data) || !Number.isInteger(result.data.revision_number) || result.data.revision_number < 1 || !['created', 'corrected', 'unchanged'].includes(result.meta?.operation) || ['student_id', 'subject_id', 'term_id', 'assessment_type'].some(key => result.data[key] != null && String(result.data[key]) !== String(key === 'student_id' ? learner.id : contextPayload()[key]))) { state.conflicts.add(index); show(byId('rowState_' + index), MGAEMS.errorHTML('The save response could not be verified. Your draft is retained; reload saved results before retrying because the result may already have been saved.')); return; }
    learner.assessment = result.data; state.dirty.delete(index);
    byId('score_' + index).value = result.data.score ?? score;
    byId('level_' + index).value = result.data.competency_rating ?? level;
    byId('remarks_' + index).value = result.data.remarks ?? remarks;
    byId('rowState_' + index).textContent = `${result.meta.operation === 'corrected' ? 'Corrected' : result.meta.operation === 'unchanged' ? 'Already saved' : 'Saved'} · revision ${result.data.revision_number}`;
  }
  byId('historyForm').addEventListener('submit', event => { event.preventDefault(); state.historyPage = 1; loadHistory(); });
  async function loadHistory() {
    const request = ++state.historyRequest, params = new URLSearchParams({ page: state.historyPage, per_page: 25 });
    if (byId('historyTerm').value) params.set('term_id', byId('historyTerm').value);
    byId('historyArea').innerHTML = MGAEMS.loadingHTML('Loading permitted saved results…'); byId('historyArea').setAttribute('aria-busy', 'true');
    const result = await get('/api/v1/assessments?' + params);
    if (request !== state.historyRequest) return;
    if (!result.ok) { failure(byId('historyArea'), result, loadHistory); return; }
    if (!rowList(result.data) || !validMeta(result.meta)) { failure(byId('historyArea'), unavailable('Saved result history is incomplete. Reload to retrieve verified data.'), loadHistory); return; }
    show(byId('historyArea'), result.data.length ? `<div class="card">${table(['Learner', 'Captured class', 'Learning area / Term', 'Type', 'Score / Performance Level', 'History'], result.data.map(row => `<tr><td>${esc(row.student?.first_name)} ${esc(row.student?.last_name)}<div class="assessment-admission">Admission: ${esc(row.student?.admission_no || 'Not available')}</div></td><td>${esc(row.class?.name || 'Unknown (legacy)')}</td><td>${esc(row.subject?.name)} · ${esc(row.term?.name)}</td><td>${esc(typeName(row.assessment_type))}</td><td>${esc(row.score ?? '—')} · ${esc(row.competency_rating || 'Not rated')}</td><td>${esc(row.context_state)} · revision ${esc(row.revision_number)}${leader ? `<button type="button" class="btn btn-secondary btn-sm" data-history="${esc(row.id)}">Revision history</button>` : ''}</td></tr>`))}<div class="pagination"><span>${esc(result.meta.total)} saved results · Page ${esc(state.historyPage)}</span><div class="form-actions"><button type="button" class="btn btn-secondary" data-page="-1" ${state.historyPage <= 1 ? 'disabled' : ''}>Previous</button><button type="button" class="btn btn-secondary" data-page="1" ${state.historyPage * result.meta.per_page >= result.meta.total ? 'disabled' : ''}>Next</button></div></div></div>` : MGAEMS.emptyStateHTML('No permitted saved results', 'Teacher history requires active teaching staff and an assignment matching captured class/subject/term. Unresolved legacy data is leadership-only.', 'clipboard-check'));
    byId('historyArea').querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { state.historyPage += Number(button.dataset.page); loadHistory(); }));
    byId('historyArea').querySelectorAll('[data-history]').forEach(button => button.addEventListener('click', () => revisionHistory(button.dataset.history, button)));
  }
  function revisionHistory(id, trigger) {
    const modal = MGAEMS.openModal({ title: 'Saved assessment revisions', trigger, body: MGAEMS.loadingHTML('Loading revision history…') }); let page = 1, sequence = 0;
    async function load() {
      const request = ++sequence; show(modal.body, MGAEMS.loadingHTML('Loading revision history…'));
      const result = await get(`/api/v1/assessments/${encodeURIComponent(id)}/revisions?page=${page}`); if (modal.closed || request !== sequence) return;
      if (!result.ok) { failure(modal.body, result, load); return; }
      if (!Array.isArray(result.data) || !result.data.every(row => record(row) && Number.isInteger(row.revision_number) && row.revision_number >= 1) || !validMeta(result.meta)) { failure(modal.body, unavailable('Revision history is incomplete. Reload to retrieve verified data.'), load); return; }
      show(modal.body, `<p>Legacy baselines preserve the known saved row; they do not identify a guaranteed original assessor or event.</p>${table(['Revision', 'Change / Authority', 'Actor / Saved time', 'Score / Performance Level', 'Remarks'], result.data.map(row => `<tr><td>${esc(row.revision_number)}</td><td>${esc(row.change_type)} · ${esc(row.authority)}</td><td>${esc(row.actor || 'Unknown')} · ${esc(row.saved_at || 'Unknown')}</td><td>${esc(row.score ?? '—')} · ${esc(row.competency_rating || 'Not rated')}</td><td>${esc(row.remarks || '')}</td></tr>`))}<div class="pagination"><button type="button" class="btn btn-secondary" data-prev ${page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${esc(page)}</span><button type="button" class="btn btn-secondary" data-next ${page * 25 >= result.meta.total ? 'disabled' : ''}>Next</button></div>`);
      modal.body.querySelector('[data-prev]').addEventListener('click', () => { page--; load(); }); modal.body.querySelector('[data-next]').addEventListener('click', () => { page++; load(); });
    } load();
  }
  function setupReports() {
    show(byId('reportFilters'), `<div class="assessment-section-heading"><h2>Leadership report publication</h2><span class="badge badge-navy">Authorized school leadership</span></div><p class="assessment-note">Generation publishes a retained revision using meaningful saved results. Earlier PDFs remain available. Current placement is used to find learners; results preserve their captured class context.</p><div class="form-grid assessment-report-grid"><div class="field"><label for="reportTerm">Reporting term</label><select id="reportTerm">${options(terms(), terms().find(term => term.is_current)?.id || '', item => `${item.name} · ${item.academic_year?.name || ''}`)}</select></div><div class="field"><label for="reportClass">Current learner class</label><select id="reportClass">${options(state.context.classes)}</select></div><div class="field"><label for="reportLearner">Learner and admission number</label><select id="reportLearner" disabled><option value="">Select a class first</option></select></div></div><div id="reportPages" aria-live="polite"></div>`);
    byId('reportTerm').addEventListener('change', () => { if (!state.reportBusy) loadCard(); }); byId('reportClass').addEventListener('change', () => { if (!state.reportBusy) { state.reportPage = 1; loadReportLearners(); } }); byId('reportLearner').addEventListener('change', () => { if (!state.reportBusy) loadCard(); });
    show(byId('reportArea'), MGAEMS.emptyStateHTML('Select a learner and term', 'Learner selection uses current placement; report results retain their captured class context.', 'file-text'));
  }
  async function loadReportLearners() {
    const sequence = ++state.learnerRequest, classId = byId('reportClass').value; state.card = null; state.reportRequest++;
    byId('reportLearner').disabled = true; byId('reportLearner').innerHTML = '<option value="">Select learner…</option>';
    show(byId('reportPages'), '');
    show(byId('reportArea'), MGAEMS.emptyStateHTML('Select a learner and term', 'Existing cards and retained revisions appear here.', 'file-text'));
    if (!classId) { byId('reportLearner').innerHTML = '<option value="">Select a class first</option>'; return; }
    show(byId('reportPages'), MGAEMS.loadingHTML('Loading current class learners…')); byId('reportPages').setAttribute('aria-busy', 'true');
    const result = await get(`/api/v1/students?class_id=${encodeURIComponent(classId)}&per_page=50&page=${state.reportPage}`);
    if (sequence !== state.learnerRequest || classId !== byId('reportClass').value) return;
    if (!result.ok) { show(byId('reportPages'), ''); failure(byId('reportArea'), result, loadReportLearners); return; }
    if (!rowList(result.data) || !result.data.every(item => typeof item.first_name === 'string' && typeof item.last_name === 'string' && typeof item.admission_no === 'string' && (item.class_id == null || String(item.class_id) === classId)) || !record(result.meta) || !Number.isInteger(result.meta.total) || result.meta.total < 0) { show(byId('reportPages'), ''); failure(byId('reportArea'), unavailable('Class learner choices are incomplete or do not match the selected class.'), loadReportLearners); return; }
    byId('reportLearner').innerHTML = options(result.data, '', item => `${item.first_name} ${item.last_name} · ${item.admission_no}`); byId('reportLearner').disabled = !result.data.length;
    show(byId('reportPages'), `<div class="pagination"><button type="button" class="btn btn-secondary" data-prev ${state.reportPage <= 1 ? 'disabled' : ''}>Previous learners</button><span>Page ${esc(state.reportPage)}</span><button type="button" class="btn btn-secondary" data-next ${state.reportPage * 50 >= result.meta.total ? 'disabled' : ''}>Next learners</button></div>`);
    if (!result.data.length) show(byId('reportArea'), MGAEMS.emptyStateHTML('No learners on this page', 'Choose another class or learner page. Existing reports are not changed.', 'users'));
    byId('reportPages').querySelector('[data-prev]').addEventListener('click', () => { state.reportPage--; loadReportLearners(); }); byId('reportPages').querySelector('[data-next]').addEventListener('click', () => { state.reportPage++; loadReportLearners(); });
  }
  async function loadCard() {
    const studentId = byId('reportLearner').value, termId = byId('reportTerm').value, request = ++state.reportRequest; state.card = null;
    if (!studentId || !termId) { show(byId('reportArea'), MGAEMS.emptyStateHTML('Select a learner and term', '', 'file-text')); return; }
    show(byId('reportArea'), MGAEMS.loadingHTML('Loading the selected learner’s report…')); byId('reportArea').setAttribute('aria-busy', 'true');
    const result = await get(`/api/v1/report-cards?student_id=${encodeURIComponent(studentId)}&term_id=${encodeURIComponent(termId)}`);
    if (request !== state.reportRequest || studentId !== byId('reportLearner').value || termId !== byId('reportTerm').value) return;
    if (!result.ok) { failure(byId('reportArea'), result, loadCard); return; }
    if (result.data !== null && !validCard(result.data, studentId, termId)) { failure(byId('reportArea'), unavailable('The report response is incomplete or does not match the selected learner and term. No report actions are available.'), loadCard); return; }
    state.card = result.data;
    const card = result.data;
    show(byId('reportArea'), `<div class="card report-current-card"><div class="report-current-heading"><h2>${card ? 'Latest generated report' : 'No report generated'}</h2><span class="badge ${card?.download_available ? 'badge-green' : 'badge-gray'}">${card?.download_available ? 'PDF available' : card ? 'PDF unavailable' : 'Not generated'}</span></div>${card ? `<dl class="report-publication-summary"><div><dt>Learner</dt><dd>${esc(card.student?.first_name || '')} ${esc(card.student?.last_name || '')}${card.student?.admission_no ? ' · ' + esc(card.student.admission_no) : 'Selected learner'}</dd></div><div><dt>Reporting term</dt><dd>${esc(card.term?.name || terms().find(term => String(term.id) === termId)?.name || 'Selected term')}</dd></div><div><dt>Revision</dt><dd>${esc(card.revision_number)}</dd></div><div><dt>Generated</dt><dd>${esc(card.generated_at ? dateTime(card.generated_at) : 'Unknown generation time')}</dd></div><div><dt>Revision history</dt><dd>${card.history_state === 'versioned' ? 'Retained revisions' : card.history_state === 'legacy_artifact' ? 'Legacy artifact — original source snapshot unknown' : esc(card.history_state || 'Not available')}</dd></div></dl>${card.download_available ? '' : '<p class="report-state-note">The saved report record has no available PDF. You can inspect retained revisions or generate a new revision from saved results.</p>'}` : '<p class="report-state-note">Generate a report from meaningful saved results. Generation publishes the report through the existing school workflow.</p>'}<div class="form-actions report-card-actions"><button type="button" class="btn btn-primary" id="publishReport">${card ? 'Generate new revision' : 'Generate report'}</button>${card ? '<button type="button" class="btn btn-secondary" id="reportHistory">Retained revisions</button>' : ''}${card?.download_available ? '<button type="button" class="btn btn-secondary" id="downloadReport">Download latest PDF</button>' : ''}</div><div id="reportDownloadFeedback" class="report-download-feedback" role="status"></div></div>`);
    byId('publishReport').addEventListener('click', () => publishReport(studentId, termId, byId('publishReport')));
    if (result.data) byId('reportHistory').addEventListener('click', () => MGAEMS.openReportHistory(result.data.id, byId('reportHistory')));
    if (result.data?.download_available) byId('downloadReport').addEventListener('click', async () => { const button = byId('downloadReport'), feedback = byId('reportDownloadFeedback'); if (button.disabled) return; button.disabled = true; feedback.textContent = 'Preparing the latest PDF…'; const response = await MGAEMS.download(`/api/v1/report-cards/${result.data.id}/download`, 'report-card.pdf'); if (request !== state.reportRequest) return; button.disabled = false; feedback.textContent = response.ok ? 'PDF download started.' : response.error || 'PDF download failed. Try again.'; });
  }
  function publishReport(studentId, termId, trigger) {
    const card = state.card, request = state.reportRequest;
    const modal = MGAEMS.openModal({ title: 'Publish a retained report revision', trigger,
      body: `<p>Earlier PDFs remain retained. Continuous and end-term performance levels/remarks are displayed separately, without weighting or precedence.</p><p class="assessment-note">Generation publishes a report for this learner and term. It does not overwrite earlier artifacts.</p><form id="reportPublishForm"><div data-form-error role="alert" tabindex="-1"></div><div class="field"><label for="overallRemark">Overall remark</label><textarea id="overallRemark" name="overall_remark" maxlength="4000">${esc(card?.overall_remark || '')}</textarea></div></form>`,
      footer: '<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="submit" form="reportPublishForm" class="btn btn-primary">Generate revision</button>' });
    const form = modal.body.querySelector('form'); let saving = false;
    form.addEventListener('submit', async event => { event.preventDefault(); if (saving || !form.reportValidity()) return;
      if (request !== state.reportRequest || studentId !== byId('reportLearner').value || termId !== byId('reportTerm').value) { MGAEMS.showFormErrors(form, { error: 'The learner or reporting term changed. Close this dialog and review the current selection before generating.' }); return; }
      saving = true; state.reportBusy = true; modal.setBusy(true); byId('reportFilters').querySelectorAll('select, button').forEach(control => { control.disabled = true; });
      const result = await post(`/api/v1/students/${encodeURIComponent(studentId)}/report-cards/generate`, { term_id: Number(termId), overall_remark: form.elements.overall_remark.value.trim() || null });
      modal.setBusy(false); saving = false; state.reportBusy = false; byId('reportFilters').querySelectorAll('select, button').forEach(control => { control.disabled = false; });
      if (!result.ok) { MGAEMS.showFormErrors(form, result); return; }
      if (!validCard(result.data, studentId, termId)) { form.querySelector('[data-form-error]').textContent = 'The generation response could not be verified. Close this dialog and reload the selected report before generating again; a revision may already have been created.'; saving = true; modal.overlay.querySelectorAll('button[type="submit"]').forEach(button => { button.disabled = true; }); return; }
      modal.close(); MGAEMS.toast('Report revision published; earlier PDFs retained.', 'success'); if (request === state.reportRequest && studentId === byId('reportLearner').value && termId === byId('reportTerm').value) loadCard();
    });
  }
  window.addEventListener('beforeunload', event => { if (state.dirty.size) { event.preventDefault(); event.returnValue = ''; } });
  setup(); MGAEMS.initIcons();
})();
