/* Current term-result workflow; teaching context and revisions remain server-owned. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || MGAEMS.landingPage(user) !== '/dashboard.html') return;
  renderAppShell('/assessment.html');
  const main = document.getElementById('appMain'), esc = MGAEMS.escapeHTML;
  const leader = ['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(user.role);
  const state = { context: null, selection: {}, learners: [], dirty: new Set(), busy: false, rosterRequest: 0, historyRequest: 0, reportRequest: 0, learnerRequest: 0, historyPage: 1, reportPage: 1, card: null };
  const byId = id => document.getElementById(id);
  const typeName = type => ({ continuous: 'Continuous', end_term: 'End-term' }[type] || type);
  const unique = values => [...new Map(values.filter(Boolean).map(value => [value.id, value])).values()];
  const options = (items, chosen = '', label = item => item.name, placeholder = 'Select…') => `<option value="">${placeholder}</option>` + items.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(chosen) ? 'selected' : ''}>${esc(label(item))}</option>`).join('');
  const table = (headings, rows) => `<div class="table-scroll"><table><thead><tr>${headings.map(title => `<th scope="col">${title}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const tabs = [['entry', 'Assessment entry'], ['history', 'Saved results'], ...(leader ? [['reports', 'Report cards']] : [])];
  main.innerHTML = `<div class="page-heading"><h1>Assessment &amp; Report Cards</h1><p>Save continuous/end-term results and retain correction history. Performance levels are separate from core competencies.</p></div>
    <div class="tabs" role="tablist" aria-label="Assessment sections">${tabs.map(([key, title], index) => `<button type="button" class="tab ${index ? '' : 'active'}" id="assessmentTab_${key}" role="tab" aria-selected="${!index}" aria-controls="assessmentPanel_${key}" tabindex="${index ? -1 : 0}" data-tab="${key}">${title}</button>`).join('')}</div>
    <section class="tab-panel active" id="assessmentPanel_entry" role="tabpanel" aria-labelledby="assessmentTab_entry"><div class="card" id="contextArea">${MGAEMS.loadingHTML('Loading teaching contexts…')}</div><div id="rosterArea" aria-live="polite"></div></section>
    <section class="tab-panel" id="assessmentPanel_history" role="tabpanel" aria-labelledby="assessmentTab_history" hidden><div class="card"><p>Saved results use captured teaching context. Unresolved legacy results are leadership-only. This view does not grant correction rights after a learner leaves a class.</p><form id="historyForm"><div class="form-grid"><div class="field"><label for="historyTerm">Term</label><select id="historyTerm"></select></div></div><button type="submit" class="btn btn-secondary">Load saved results</button></form></div><div id="historyArea" aria-live="polite"></div></section>
    ${leader ? '<section class="tab-panel" id="assessmentPanel_reports" role="tabpanel" aria-labelledby="assessmentTab_reports" hidden><div class="card" id="reportFilters"></div><div id="reportArea" aria-live="polite"></div></section>' : ''}`;
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
    const result = await MGAEMS.get('/api/v1/assessments/context');
    if (!result.ok) { failure(byId('contextArea'), result, setup); return; }
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
    show(byId('contextArea'), `${state.context.scope === 'assigned' && !state.context.assignments.length ? MGAEMS.emptyStateHTML('No subject-teacher assignments', 'Class Teacher ownership alone does not grant assessment rights.', 'book-x') : ''}<form id="contextForm"><div class="form-grid">
      <div class="field"><label for="assessmentYear">Academic year</label><select id="assessmentYear">${options(years, state.selection.year, item => item.name, 'All years')}</select></div>
      <div class="field"><label for="assessmentTerm">Term *</label><select id="assessmentTerm" required>${options(filteredTerms, state.selection.term)}</select></div>
      <div class="field"><label for="assessmentClass">Class *</label><select id="assessmentClass" required>${options(available.classes, state.selection.class)}</select></div>
      <div class="field"><label for="assessmentSubject">Offered learning area *</label><select id="assessmentSubject" required>${options(available.subjects, state.selection.subject)}</select></div>
      <div class="field"><label for="assessmentType">Assessment type *</label><select id="assessmentType" required>${state.context.assessment_types.map(type => `<option value="${esc(type)}" ${type === state.selection.type ? 'selected' : ''}>${esc(typeName(type))}</option>`).join('')}</select></div></div><button type="submit" class="btn btn-secondary">Load authorized roster</button></form>`);
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
    state.rosterRequest++; state.dirty.clear(); state.learners = []; renderContext();
  }
  const contextPayload = () => ({ class_id: Number(state.selection.class), subject_id: Number(state.selection.subject), term_id: Number(state.selection.term), assessment_type: state.selection.type });
  function busy(value) { state.busy = value; main.querySelectorAll('#contextForm select, #contextForm button, #rosterArea input, #rosterArea select, #rosterArea button').forEach(control => { control.disabled = value || control.dataset.readonly === 'true'; }); if (!value && byId('saveModified')) updateSaveButtons(); }
  async function loadRoster() {
    if (state.busy || !byId('contextForm').reportValidity()) return;
    if (state.dirty.size && !await MGAEMS.confirmAction('Reload results?', 'Reloading discards unsaved edits.', 'Reload')) return;
    const request = ++state.rosterRequest, signature = JSON.stringify(contextPayload());
    const target = byId('rosterArea'); target.innerHTML = MGAEMS.loadingHTML('Loading authorized learners…'); target.setAttribute('aria-busy', 'true');
    const result = await MGAEMS.get('/api/v1/assessments/learners?' + new URLSearchParams(contextPayload()));
    if (request !== state.rosterRequest || signature !== JSON.stringify(contextPayload())) return;
    if (!result.ok) { failure(target, result, loadRoster); return; }
    state.learners = result.data; state.dirty.clear(); renderRoster();
  }
  function renderRoster() {
    if (!state.learners.length) { show(byId('rosterArea'), MGAEMS.emptyStateHTML('No active learners', 'No current active learners belong to this class.', 'users')); return; }
    show(byId('rosterArea'), `<div class="card"><p>Corrections append revisions. Original captured class/offering context stays fixed.</p><button type="button" class="btn btn-primary" id="saveModified" disabled>Save modified results</button>${table(['Learner', 'Score', 'Performance Level', 'Remarks', 'Saved state', 'Action'], state.learners.map((learner, index) => `<tr><td>${esc(learner.first_name)} ${esc(learner.last_name)}<div class="text-muted">${esc(learner.admission_no)}</div>${learner.context_state !== 'current' ? `<div class="text-muted">${esc(learner.context_state)}</div>` : ''}</td>
      <td><label class="sr-only" for="score_${index}">Score for ${esc(learner.first_name)}</label><input class="compact-input" id="score_${index}" type="number" min="0" max="100" step="0.01" value="${esc(learner.assessment?.score ?? '')}" data-readonly="${!learner.editable}" ${learner.editable ? '' : 'disabled'}></td>
      <td><label class="sr-only" for="level_${index}">Performance Level for ${esc(learner.first_name)}</label><select class="compact-input" id="level_${index}" data-readonly="${!learner.editable}" ${learner.editable ? '' : 'disabled'}><option value="">Not rated</option>${state.context.competency_ratings.map(level => `<option value="${esc(level)}" ${learner.assessment?.competency_rating === level ? 'selected' : ''}>${esc(level)}</option>`).join('')}</select></td>
      <td><label class="sr-only" for="remarks_${index}">Remarks for ${esc(learner.first_name)}</label><input class="compact-input" id="remarks_${index}" maxlength="1000" value="${esc(learner.assessment?.remarks || '')}" data-readonly="${!learner.editable}" ${learner.editable ? '' : 'disabled'}></td>
      <td id="rowState_${index}" role="status">${learner.assessment ? 'Saved revision ' + esc(learner.assessment.revision_number) : learner.editable ? 'Not recorded' : 'Leadership review required'}</td><td><button type="button" class="btn btn-secondary btn-sm" id="saveRow_${index}" data-readonly="${!learner.editable}" disabled>Save</button></td></tr>`))}</div>`);
    state.learners.forEach((learner, index) => {
      ['score_', 'level_', 'remarks_'].forEach(prefix => byId(prefix + index).addEventListener('input', () => { if (!learner.editable || state.busy) return; state.dirty.add(index); byId('rowState_' + index).textContent = 'Unsaved changes'; byId('saveRow_' + index).disabled = false; byId('saveModified').disabled = false; }));
      byId('saveRow_' + index).addEventListener('click', async () => { if (state.busy) return; busy(true); await saveRow(index); busy(false); updateSaveButtons(); });
    });
    byId('saveModified').addEventListener('click', async () => { if (state.busy) return; busy(true); for (const index of [...state.dirty]) await saveRow(index); busy(false); updateSaveButtons(); });
  }
  function updateSaveButtons() { state.learners.forEach((learner, index) => { byId('saveRow_' + index).disabled = !learner.editable || !state.dirty.has(index); }); byId('saveModified').disabled = !state.dirty.size; }
  async function saveRow(index) {
    const learner = state.learners[index]; if (!learner?.editable || !state.dirty.has(index)) return;
    const score = byId('score_' + index).value, level = byId('level_' + index).value, remarks = byId('remarks_' + index).value.trim();
    if ((!score && !level && !remarks) || (score !== '' && (!Number.isFinite(Number(score)) || Number(score) < 0 || Number(score) > 100))) { byId('rowState_' + index).textContent = 'Provide a valid score, performance level, or meaningful remark.'; return; }
    if (learner.context_state === 'legacy_unresolved' && !await MGAEMS.confirmAction('Correct unresolved legacy values?', 'Original class, offering and assessor remain unknown. This correction preserves that uncertainty and retains the previous saved values.', 'Save correction')) return;
    const signature = JSON.stringify(contextPayload()); byId('rowState_' + index).textContent = 'Saving…';
    const result = await MGAEMS.post('/api/v1/assessments', { ...contextPayload(), student_id: learner.id, score: score === '' ? null : Number(score), competency_rating: level || null, remarks: remarks || null, expected_revision: learner.assessment?.revision_number || 0 });
    if (signature !== JSON.stringify(contextPayload()) || state.learners[index] !== learner) return;
    if (!result.ok) { show(byId('rowState_' + index), MGAEMS.errorHTML(Object.values(result.fields || {}).flat()[0] || result.error)); return; }
    learner.assessment = result.data; state.dirty.delete(index);
    byId('rowState_' + index).textContent = `${result.meta.operation === 'corrected' ? 'Corrected' : 'Saved'} · revision ${result.data.revision_number}`;
  }
  byId('historyForm').addEventListener('submit', event => { event.preventDefault(); state.historyPage = 1; loadHistory(); });
  async function loadHistory() {
    const request = ++state.historyRequest, params = new URLSearchParams({ page: state.historyPage, per_page: 25 });
    if (byId('historyTerm').value) params.set('term_id', byId('historyTerm').value);
    const result = await MGAEMS.get('/api/v1/assessments?' + params);
    if (request !== state.historyRequest) return;
    if (!result.ok) { failure(byId('historyArea'), result, loadHistory); return; }
    show(byId('historyArea'), result.data.length ? `<div class="card">${table(['Learner', 'Captured class', 'Subject / Term', 'Type', 'Score / Performance Level', 'History'], result.data.map(row => `<tr><td>${esc(row.student?.first_name)} ${esc(row.student?.last_name)}</td><td>${esc(row.class?.name || 'Unknown (legacy)')}</td><td>${esc(row.subject?.name)} · ${esc(row.term?.name)}</td><td>${esc(typeName(row.assessment_type))}</td><td>${esc(row.score ?? '—')} · ${esc(row.competency_rating || 'Not rated')}</td><td>${esc(row.context_state)} · revision ${esc(row.revision_number)}${leader ? `<button type="button" class="btn btn-secondary btn-sm" data-history="${esc(row.id)}">Revision history</button>` : ''}</td></tr>`))}<div class="pagination"><span>${esc(result.meta.total)} saved results · Page ${esc(state.historyPage)}</span><div class="form-actions"><button type="button" class="btn btn-secondary" data-page="-1" ${state.historyPage <= 1 ? 'disabled' : ''}>Previous</button><button type="button" class="btn btn-secondary" data-page="1" ${state.historyPage * result.meta.per_page >= result.meta.total ? 'disabled' : ''}>Next</button></div></div></div>` : MGAEMS.emptyStateHTML('No permitted saved results', 'Teacher history requires active teaching staff and an assignment matching captured class/subject/term. Unresolved legacy data is leadership-only.', 'clipboard-check'));
    byId('historyArea').querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { state.historyPage += Number(button.dataset.page); loadHistory(); }));
    byId('historyArea').querySelectorAll('[data-history]').forEach(button => button.addEventListener('click', () => revisionHistory(button.dataset.history, button)));
  }
  function revisionHistory(id, trigger) {
    const modal = MGAEMS.openModal({ title: 'Saved assessment revisions', trigger, body: MGAEMS.loadingHTML('Loading revision history…') }); let page = 1;
    async function load() {
      const result = await MGAEMS.get(`/api/v1/assessments/${encodeURIComponent(id)}/revisions?page=${page}`); if (modal.closed) return;
      if (!result.ok) { failure(modal.body, result, load); return; }
      show(modal.body, `<p>Legacy baselines preserve the known saved row; they do not identify a guaranteed original assessor or event.</p>${table(['Revision', 'Change / Authority', 'Actor / Saved time', 'Score / Performance Level', 'Remarks'], result.data.map(row => `<tr><td>${esc(row.revision_number)}</td><td>${esc(row.change_type)} · ${esc(row.authority)}</td><td>${esc(row.actor || 'Unknown')} · ${esc(row.saved_at || 'Unknown')}</td><td>${esc(row.score ?? '—')} · ${esc(row.competency_rating || 'Not rated')}</td><td>${esc(row.remarks || '')}</td></tr>`))}<div class="pagination"><button type="button" class="btn btn-secondary" data-prev ${page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${esc(page)}</span><button type="button" class="btn btn-secondary" data-next ${page * 25 >= result.meta.total ? 'disabled' : ''}>Next</button></div>`);
      modal.body.querySelector('[data-prev]').addEventListener('click', () => { page--; load(); }); modal.body.querySelector('[data-next]').addEventListener('click', () => { page++; load(); });
    } load();
  }
  function setupReports() {
    show(byId('reportFilters'), `<h2>Leadership report publication</h2><p>Generation creates a retained revision. Each assessment type keeps its own performance level and remarks.</p><div class="form-grid"><div class="field"><label for="reportTerm">Reporting term</label><select id="reportTerm">${options(terms(), '', item => `${item.name} · ${item.academic_year?.name || ''}`)}</select></div><div class="field"><label for="reportClass">Current learner class</label><select id="reportClass">${options(state.context.classes)}</select></div><div class="field"><label for="reportLearner">Learner</label><select id="reportLearner" disabled></select></div></div><div id="reportPages"></div>`);
    byId('reportTerm').addEventListener('change', loadCard); byId('reportClass').addEventListener('change', () => { state.reportPage = 1; loadReportLearners(); }); byId('reportLearner').addEventListener('change', loadCard);
    show(byId('reportArea'), MGAEMS.emptyStateHTML('Select a learner and term', 'Learner selection uses current placement; report results retain their captured class context.', 'file-text'));
  }
  async function loadReportLearners() {
    const sequence = ++state.learnerRequest, classId = byId('reportClass').value; state.card = null; state.reportRequest++;
    byId('reportLearner').disabled = true; byId('reportLearner').innerHTML = '<option value="">Select learner…</option>';
    show(byId('reportArea'), MGAEMS.emptyStateHTML('Select a learner and term', 'Existing cards and retained revisions appear here.', 'file-text'));
    if (!classId) return;
    const result = await MGAEMS.get(`/api/v1/students?class_id=${encodeURIComponent(classId)}&per_page=50&page=${state.reportPage}`);
    if (sequence !== state.learnerRequest) return;
    if (!result.ok) { failure(byId('reportArea'), result, loadReportLearners); return; }
    byId('reportLearner').innerHTML = options(result.data, '', item => `${item.first_name} ${item.last_name} · ${item.admission_no}`); byId('reportLearner').disabled = !result.data.length;
    show(byId('reportPages'), `<div class="pagination"><button type="button" class="btn btn-secondary" data-prev ${state.reportPage <= 1 ? 'disabled' : ''}>Previous learners</button><span>Page ${esc(state.reportPage)}</span><button type="button" class="btn btn-secondary" data-next ${state.reportPage * 50 >= result.meta.total ? 'disabled' : ''}>Next learners</button></div>`);
    byId('reportPages').querySelector('[data-prev]').addEventListener('click', () => { state.reportPage--; loadReportLearners(); }); byId('reportPages').querySelector('[data-next]').addEventListener('click', () => { state.reportPage++; loadReportLearners(); });
  }
  async function loadCard() {
    const studentId = byId('reportLearner').value, termId = byId('reportTerm').value, request = ++state.reportRequest; state.card = null;
    if (!studentId || !termId) { show(byId('reportArea'), MGAEMS.emptyStateHTML('Select a learner and term', '', 'file-text')); return; }
    const result = await MGAEMS.get(`/api/v1/report-cards?student_id=${encodeURIComponent(studentId)}&term_id=${encodeURIComponent(termId)}`);
    if (request !== state.reportRequest) return;
    if (!result.ok) { failure(byId('reportArea'), result, loadCard); return; }
    state.card = result.data;
    show(byId('reportArea'), `<div class="card"><h2>${result.data ? 'Latest report' : 'No report generated'}</h2><p>${result.data ? `Revision ${esc(result.data.revision_number)} · ${esc(result.data.generated_at || 'Unknown generation time')} · ${esc(result.data.history_state)}` : 'Generate a report from meaningful saved results.'}</p><div class="form-actions"><button type="button" class="btn btn-primary" id="publishReport">${result.data ? 'Generate new revision' : 'Generate report'}</button>${result.data ? '<button type="button" class="btn btn-secondary" id="reportHistory">Retained revisions</button>' : ''}${result.data?.download_available ? '<button type="button" class="btn btn-secondary" id="downloadReport">Download latest PDF</button>' : ''}</div></div>`);
    byId('publishReport').addEventListener('click', () => publishReport(studentId, termId, byId('publishReport')));
    if (result.data) byId('reportHistory').addEventListener('click', () => MGAEMS.openReportHistory(result.data.id, byId('reportHistory')));
    if (result.data?.download_available) byId('downloadReport').addEventListener('click', async () => { const response = await MGAEMS.download(`/api/v1/report-cards/${result.data.id}/download`, 'report-card.pdf'); if (!response.ok) MGAEMS.toast(response.error, 'error'); });
  }
  function publishReport(studentId, termId, trigger) {
    const modal = MGAEMS.openModal({ title: 'Publish a retained report revision', trigger,
      body: `<p>Earlier PDFs remain retained. Continuous and end-term performance levels/remarks are displayed separately, without weighting or precedence.</p><form id="reportPublishForm"><div data-form-error></div><div class="field"><label for="overallRemark">Overall remark</label><textarea id="overallRemark" name="overall_remark" maxlength="4000">${esc(state.card?.overall_remark || '')}</textarea></div></form>`,
      footer: '<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="submit" form="reportPublishForm" class="btn btn-primary">Generate revision</button>' });
    const form = modal.body.querySelector('form'); let saving = false;
    form.addEventListener('submit', async event => { event.preventDefault(); if (saving || !form.reportValidity()) return; saving = true; modal.setBusy(true);
      const result = await MGAEMS.post(`/api/v1/students/${encodeURIComponent(studentId)}/report-cards/generate`, { term_id: Number(termId), overall_remark: form.elements.overall_remark.value.trim() || null });
      modal.setBusy(false); saving = false; if (!result.ok) { MGAEMS.showFormErrors(form, result); return; }
      modal.close(); MGAEMS.toast('Report revision published; earlier PDFs retained.', 'success'); loadCard();
    });
  }
  window.addEventListener('beforeunload', event => { if (state.dirty.size) { event.preventDefault(); event.returnValue = ''; } });
  setup(); MGAEMS.initIcons();
})();
