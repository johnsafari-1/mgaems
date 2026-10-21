/* Allocation-scoped scheme planning. Curriculum text is staff-entered and never seeded by MGAEMS. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || !['system_admin', 'head_teacher', 'deputy_head_teacher', 'teacher'].includes(user.role)) {
    if (user) window.location.href = MGAEMS.landingPage(user);
    return;
  }
  renderAppShell('/schemes-of-work.html');
  const main = document.getElementById('appMain'), esc = MGAEMS.escapeHTML;
  const leader = ['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(user.role);
  const state = { context: null, schemes: [], selected: null, request: 0, detailRequest: 0, term: '', status: '', search: '' };
  const byId = id => document.getElementById(id);
  const text = value => typeof value === 'string' ? value : '';
  const options = (items, selected = '', label = item => item.name, placeholder = 'Select...') => `<option value="">${placeholder}</option>${items.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(selected) ? 'selected' : ''}>${esc(label(item))}</option>`).join('')}`;
  const statusLabel = status => ({ draft: 'Draft', submitted: 'In review', returned: 'Changes requested', approved: 'Approved' }[status] || 'Unknown');
  const badge = status => `<span class="badge ${status === 'approved' ? 'badge-green' : status === 'submitted' ? 'badge-navy' : status === 'returned' ? 'badge-amber' : 'badge-gray'}">${esc(statusLabel(status))}</span>`;
  const assignmentLabel = assignment => [assignment.school_class?.name, assignment.subject?.name, assignment.term?.academic_year?.name, assignment.term?.name].filter(Boolean).join(' · ');
  const date = value => {
    const day = MGAEMS.schoolDate(value);
    if (!day) return 'No dates set';
    return esc(new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' }).format(new Date(day + 'T12:00:00Z')));
  };
  const formGroup = (title, content) => `<fieldset class="academic-form-group"><legend>${esc(title)}</legend><div class="form-grid">${content}</div></fieldset>`;
  const input = (name, label, value = '', type = 'text', required = true, extra = '') => `<div class="field"><label for="scheme_${name}">${esc(label)}${required ? ' *' : ''}</label><input id="scheme_${name}" name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${extra}></div>`;
  const textarea = (name, label, value = '', required = true, extra = '') => `<div class="field full"><label for="scheme_${name}">${esc(label)}${required ? ' *' : ''}</label><textarea id="scheme_${name}" name="${name}" ${required ? 'required' : ''} ${extra}>${esc(value)}</textarea></div>`;

  main.className = 'app-main scheme-workspace';
  main.innerHTML = `<div class="scheme-heading"><div><span class="eyebrow">Teaching &amp; learning</span><h1>Schemes of Work</h1><p>Plan weekly teaching in an assigned class, learning area and term. Curriculum references and planning content are entered by staff; MGAEMS does not verify or claim official CBC alignment.</p></div><button type="button" class="btn btn-primary" id="createScheme" disabled><i data-lucide="plus" aria-hidden="true"></i>Create scheme</button></div>
    <p class="scheme-notice">Drafts can be edited until submission. Submitted schemes are reviewed by school leadership; returned schemes can be revised and resubmitted.</p>
    <div class="scheme-toolbar"><div class="field"><label for="schemeTerm">Term</label><select id="schemeTerm"><option value="">All permitted terms</option></select></div><div class="field"><label for="schemeStatus">Workflow status</label><select id="schemeStatus"><option value="">All statuses</option><option value="draft">Draft</option><option value="submitted">In review</option><option value="returned">Changes requested</option><option value="approved">Approved</option></select></div><div class="field"><label for="schemeSearch">Search schemes</label><input id="schemeSearch" type="search" placeholder="Title, class or learning area"></div></div>
    <p id="schemeCount" class="academic-result-count" role="status"></p><div id="schemeList" aria-busy="true">${MGAEMS.loadingHTML('Loading teaching contexts...')}</div><section id="schemeDetail" class="scheme-detail" hidden aria-live="polite"></section>`;

  byId('createScheme').addEventListener('click', event => openSchemeForm(null, event.currentTarget));
  byId('schemeTerm').addEventListener('change', event => { state.term = event.target.value; renderList(); });
  byId('schemeStatus').addEventListener('change', event => { state.status = event.target.value; renderList(); });
  byId('schemeSearch').addEventListener('input', event => { state.search = event.target.value.trim().toLowerCase(); renderList(); });
  main.addEventListener('click', event => {
    const control = event.target.closest('[data-scheme-action]'); if (!control || control.disabled) return;
    const scheme = state.schemes.find(item => String(item.id) === control.dataset.id); if (!scheme) return;
    if (control.dataset.schemeAction === 'view') loadDetail(scheme.id);
    if (control.dataset.schemeAction === 'edit') openSchemeForm(scheme, control);
    if (control.dataset.schemeAction === 'submit') submitScheme(scheme, control);
    if (control.dataset.schemeAction === 'approve' || control.dataset.schemeAction === 'return') reviewScheme(scheme, control.dataset.schemeAction, control);
  });
  main.addEventListener('click', event => {
    const control = event.target.closest('[data-week-action]'); if (!control || control.disabled || !state.selected || !editable(state.selected)) return;
    const week = state.selected.weeks?.find(item => String(item.id) === control.dataset.weekId); if (!week) return;
    if (control.dataset.weekAction === 'edit') openWeekForm(state.selected, control, week);
    if (control.dataset.weekAction === 'delete') deleteWeek(state.selected, week, control);
  });

  function show(target, html) { target.innerHTML = html; target.setAttribute('aria-busy', 'false'); MGAEMS.initIcons(); }
  function failure(target, result, retry) { show(target, MGAEMS.errorHTML(result.error || 'The requested scheme data could not be loaded.') + '<button type="button" class="btn btn-secondary" data-retry>Try again</button>'); target.querySelector('[data-retry]').addEventListener('click', retry); }
  function validContext(data) { return data && ['school', 'assigned'].includes(data.scope) && Array.isArray(data.assignments) && data.assignments.every(item => item && Number.isInteger(item.id) && item.school_class && item.subject && item.term); }
  function validSchemes(data) { return Array.isArray(data) && data.every(item => item && Number.isInteger(item.id) && Number.isInteger(item.class_subject_teacher_id) && typeof item.title === 'string' && ['draft', 'submitted', 'returned', 'approved'].includes(item.status) && item.assignment); }
  function editable(scheme) { return ['draft', 'returned'].includes(scheme.status); }
  function own(scheme) { return state.context?.scope === 'assigned' && state.context.assignments.some(item => item.id === scheme.class_subject_teacher_id); }

  async function setup() {
    const result = await MGAEMS.get('/api/v1/schemes-of-work/context');
    if (!result.ok || !validContext(result.data)) { failure(byId('schemeList'), result.ok ? { error: 'The authorized teaching context is incomplete.' } : result, setup); return; }
    state.context = result.data;
    const terms = [...new Map(result.data.assignments.map(item => [item.term.id, item.term])).values()];
    byId('schemeTerm').innerHTML = options(terms, '', term => `${term.name} · ${term.academic_year?.name || ''}`, 'All permitted terms');
    byId('createScheme').disabled = !result.data.assignments.length;
    loadSchemes();
  }
  async function loadSchemes() {
    const request = ++state.request; byId('schemeList').setAttribute('aria-busy', 'true'); byId('schemeList').innerHTML = MGAEMS.loadingHTML('Loading schemes of work...');
    const result = await MGAEMS.get('/api/v1/schemes-of-work');
    if (request !== state.request) return;
    if (!result.ok || !validSchemes(result.data)) { failure(byId('schemeList'), result.ok ? { error: 'The scheme list is incomplete.' } : result, loadSchemes); return; }
    state.schemes = result.data; renderList();
  }
  function renderList() {
    const query = state.search;
    const rows = state.schemes.filter(item => (!state.term || String(item.assignment?.term_id) === String(state.term)) && (!state.status || item.status === state.status) && (!query || [item.title, item.curriculum_reference, assignmentLabel(item.assignment)].filter(Boolean).join(' ').toLowerCase().includes(query)));
    byId('schemeCount').textContent = `${rows.length} of ${state.schemes.length} permitted schemes`;
    if (!rows.length) { show(byId('schemeList'), MGAEMS.emptyStateHTML(state.schemes.length ? 'No matching schemes' : 'No schemes of work yet', state.schemes.length ? 'Try another term, status, or search.' : state.context?.assignments.length ? 'Create a draft for a real teaching allocation.' : 'No authorized subject-teacher allocations are available.', 'notebook-tabs')); return; }
    show(byId('schemeList'), `<div class="scheme-grid">${rows.map(scheme => `<article class="scheme-card"><div class="scheme-card-heading"><h2>${esc(scheme.title)}</h2>${badge(scheme.status)}</div><dl class="scheme-meta"><div><dt>Class / learning area</dt><dd>${esc([scheme.assignment.school_class?.name, scheme.assignment.subject?.name].filter(Boolean).join(' · '))}</dd></div><div><dt>Academic period</dt><dd>${esc([scheme.assignment.term?.academic_year?.name, scheme.assignment.term?.name].filter(Boolean).join(' · '))}</dd></div>${scheme.curriculum_reference ? `<div><dt>Curriculum reference</dt><dd>${esc(scheme.curriculum_reference)}</dd></div>` : ''}<div><dt>Last updated</dt><dd>${esc(scheme.updated_at ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Africa/Nairobi' }).format(new Date(scheme.updated_at)) : 'Not available')}</dd></div></dl><div class="scheme-actions"><button type="button" class="btn btn-secondary btn-sm" data-scheme-action="view" data-id="${esc(scheme.id)}">View plan</button>${editable(scheme) ? `<button type="button" class="btn btn-secondary btn-sm" data-scheme-action="edit" data-id="${esc(scheme.id)}">Edit details</button>` : ''}${!leader && own(scheme) && editable(scheme) ? `<button type="button" class="btn btn-primary btn-sm" data-scheme-action="submit" data-id="${esc(scheme.id)}">Submit for review</button>` : ''}${leader && scheme.status === 'submitted' ? `<button type="button" class="btn btn-primary btn-sm" data-scheme-action="approve" data-id="${esc(scheme.id)}">Approve</button><button type="button" class="btn btn-secondary btn-sm" data-scheme-action="return" data-id="${esc(scheme.id)}">Return for changes</button>` : ''}</div></article>`).join('')}</div>`);
  }
  async function loadDetail(id) {
    const request = ++state.detailRequest, target = byId('schemeDetail'); target.hidden = false; target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading weekly plan...');
    const result = await MGAEMS.get('/api/v1/schemes-of-work/' + encodeURIComponent(id));
    if (request !== state.detailRequest) return;
    if (!result.ok || !validSchemes([result.data]) || !Array.isArray(result.data.weeks)) { failure(target, result.ok ? { error: 'The weekly plan is incomplete.' } : result, () => loadDetail(id)); return; }
    state.selected = result.data;
    const scheme = result.data, canEdit = editable(scheme);
    show(target, `<div class="scheme-detail-card"><div class="scheme-detail-heading"><div><span class="eyebrow">${esc(assignmentLabel(scheme.assignment))}</span><h2>${esc(scheme.title)}</h2></div>${badge(scheme.status)}</div><p class="scheme-reference">${scheme.curriculum_reference ? 'Curriculum reference entered by staff: ' + esc(scheme.curriculum_reference) : 'No curriculum reference entered. MGAEMS does not verify curriculum-source authority.'}</p>${scheme.review_notes ? `<p class="scheme-review"><strong>Review note</strong><br>${esc(scheme.review_notes)}</p>` : ''}<div class="scheme-actions">${canEdit ? `<button type="button" class="btn btn-primary btn-sm" id="addWeek">Add weekly plan</button><button type="button" class="btn btn-secondary btn-sm" id="aiSchemeWeeks">Generate weekly plans (AI)</button>` : ''}<button type="button" class="btn btn-secondary btn-sm" id="closeSchemeDetail">Close plan</button></div><div class="scheme-weeks">${scheme.weeks.length ? scheme.weeks.map(week => `<article class="scheme-week"><div class="scheme-week-heading"><h3>Week ${esc(week.week_number)}</h3><span class="badge badge-gray">${week.starts_on ? date(week.starts_on) + ' to ' + date(week.ends_on) : 'Dates not set'}</span></div><dl><div><dt>Strand</dt><dd>${esc(week.strand)}</dd></div><div><dt>Sub-strand</dt><dd>${esc(week.sub_strand)}</dd></div><div><dt>Learning outcomes</dt><dd>${esc(week.learning_outcomes)}</dd></div><div><dt>Learning activities</dt><dd>${esc(week.learning_activities)}</dd></div><div><dt>Resources</dt><dd>${esc(week.resources)}</dd></div></dl>${canEdit ? `<div class="scheme-actions"><button type="button" class="btn btn-secondary btn-sm" data-week-action="edit" data-week-id="${esc(week.id)}">Edit week</button><button type="button" class="btn btn-danger btn-sm" data-week-action="delete" data-week-id="${esc(week.id)}">Delete week</button></div>` : ''}</article>`).join('') : MGAEMS.emptyStateHTML('No weekly plans', canEdit ? 'Add a complete weekly plan before submitting this scheme.' : 'This scheme has no recorded weekly plans.', 'calendar-days')}</div></div>`);
    byId('closeSchemeDetail').addEventListener('click', () => { target.hidden = true; target.innerHTML = ''; });
    if (canEdit) byId('addWeek').addEventListener('click', event => openWeekForm(scheme, event.currentTarget));
    if (canEdit) byId('aiSchemeWeeks').addEventListener('click', event => openGroundedWeeks(scheme, event.currentTarget));
  }
  function openGroundedWeeks(scheme, trigger) {
    return MGAEMS.groundedDraft({
      operation: 'scheme_of_work', title: 'Curriculum-grounded weekly plans', trigger, importLabel: 'Import weekly plans',
      documentType: 'scheme_of_work', documentId: scheme.id, classSubjectTeacherId: scheme.class_subject_teacher_id,
      selection: { learning_area: scheme.assignment?.subject?.name || '' },
      constraints: { total_duration_minutes: 80 },
      onImport: async (draft, { importState }) => {
        const weeks = Array.isArray(draft.weeks) ? draft.weeks : [];
        if (!weeks.length) return { ok: false, error: 'The draft has no weekly plans to import.' };
        const outcomes = Object.fromEntries((draft.specific_learning_outcomes || []).map(outcome => [outcome.id, outcome.text]));
        const allOutcomes = (draft.specific_learning_outcomes || []).map(outcome => outcome.text).join('\n');
        const fresh = await MGAEMS.get('/api/v1/schemes-of-work/' + scheme.id);
        if (!fresh.ok || !Array.isArray(fresh.data?.weeks)) return { ok: false, error: 'Could not verify current weekly plans. No weeks were added. Retry when the document can be read.' };
        const current = [...fresh.data.weeks];
        if (!importState.weeks) importState.weeks = weeks.filter(week => !current.some(row => Number(row.week_number) === Number(week.week_number))).map(week => ({
          week_number: Number(week.week_number), strand: week.strand || scheme.assignment?.subject?.name || 'Strand', sub_strand: week.sub_strand || 'Sub-strand',
          learning_outcomes: (week.learning_outcome_ids || []).map(id => outcomes[id]).filter(Boolean).join('\n') || allOutcomes,
          learning_activities: (week.learning_activities || []).join('\n'), resources: (week.resources || []).join('\n'),
        }));
        if (!importState.weeks.length) return { ok: false, error: 'Every week in the draft already exists on this scheme. Nothing new was imported.' };
        let added = 0, skipped = 0;
        for (const values of importState.weeks) {
          const existing = current.find(row => Number(row.week_number) === values.week_number);
          if (existing) {
            if (!MGAEMS.draftRowMatches(existing, values)) return { ok: false, error: `Week ${values.week_number} changed during import. Review the saved scheme before continuing.` };
            skipped += 1; continue;
          }
          const result = await MGAEMS.post('/api/v1/schemes-of-work/' + scheme.id + '/weeks', values);
          if (!result.ok) return { ok: false, error: result.error, fields: result.fields, message: `Saved or verified ${added + skipped} of ${importState.weeks.length} weekly plans before stopping. Retry the same draft to continue.` };
          current.push(values); added += 1;
        }
        await loadSchemes(); loadDetail(scheme.id);
        return { ok: true, message: `${added} weekly plan${added === 1 ? '' : 's'} imported as draft weeks${skipped ? ` (${skipped} already present and skipped)` : ''}. Review and edit before submitting.` };
      },
    });
  }
  function openSchemeForm(scheme, trigger) {
    const assignments = state.context?.assignments || [];
    const modal = MGAEMS.openModal({ title: scheme ? 'Edit scheme of work' : 'Create scheme of work', trigger, body: `<form id="schemeForm" class="scheme-dialog"><div data-form-error></div><p class="academic-form-note">Choose an existing subject-teacher allocation. Planning text is staff-entered and is not verified curriculum content.</p>${scheme ? '' : formGroup('Teaching allocation', `<div class="field full"><label for="scheme_class_subject_teacher_id">Class, learning area and term *</label><select id="scheme_class_subject_teacher_id" name="class_subject_teacher_id" required>${options(assignments, '', assignmentLabel)}</select></div>`)}${formGroup('Document details', input('title', 'Scheme title', scheme?.title || '', 'text', true, 'maxlength="160"') + input('curriculum_reference', 'Curriculum reference / source', scheme?.curriculum_reference || '', 'text', false, 'maxlength="500"'))}</form>`, footer: '<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="submit" form="schemeForm" class="btn btn-primary">Save draft</button>' });
    const form = modal.body.querySelector('form');
    form.addEventListener('submit', async event => { event.preventDefault(); if (!form.reportValidity()) return; modal.setBusy(true); const values = Object.fromEntries(new FormData(form)); Object.keys(values).forEach(key => { values[key] = values[key].trim(); if (!values[key]) values[key] = null; }); const result = scheme ? await MGAEMS.patch('/api/v1/schemes-of-work/' + scheme.id, values) : await MGAEMS.post('/api/v1/schemes-of-work', values); modal.setBusy(false); if (!result.ok) { MGAEMS.showFormErrors(form, result); return; } modal.close(); MGAEMS.toast(scheme ? 'Scheme details updated.' : 'Draft scheme created.', 'success'); await loadSchemes(); if (result.data?.id) loadDetail(result.data.id); });
  }
  function openWeekForm(scheme, trigger, week = null) {
    const modal = MGAEMS.openModal({ title: week ? 'Edit weekly plan' : 'Add weekly plan', trigger, body: `<form id="weekForm" class="scheme-dialog"><div data-form-error></div><p class="academic-form-note">All planning fields are required. Dates are optional but, when used, must sit within the assigned term.</p>${formGroup('Week and dates', input('week_number', 'Week number', week?.week_number || '', 'number', true, 'min="1" max="53" step="1"') + input('starts_on', 'Start date', week?.starts_on || '', 'date', false) + input('ends_on', 'End date', week?.ends_on || '', 'date', false))}${formGroup('CBC-oriented planning fields', textarea('strand', 'Strand', week?.strand || '', true, 'maxlength="255"') + textarea('sub_strand', 'Sub-strand', week?.sub_strand || '', true, 'maxlength="255"') + textarea('learning_outcomes', 'Learning outcomes', week?.learning_outcomes || '', true, 'maxlength="8000"') + textarea('learning_activities', 'Learning activities', week?.learning_activities || '', true, 'maxlength="8000"') + textarea('resources', 'Resources', week?.resources || '', true, 'maxlength="8000"'))}</form>`, footer: '<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="submit" form="weekForm" class="btn btn-primary">' + (week ? 'Save weekly plan' : 'Add weekly plan') + '</button>' });
    const form = modal.body.querySelector('form');
    form.addEventListener('submit', async event => { event.preventDefault(); if (!form.reportValidity()) return; const values = Object.fromEntries(new FormData(form)); Object.keys(values).forEach(key => { values[key] = values[key].trim(); if (!values[key]) values[key] = null; }); if ((values.starts_on && !values.ends_on) || (!values.starts_on && values.ends_on)) { MGAEMS.showFormErrors(form, { error: 'Provide both weekly dates or leave both blank.', fields: { starts_on: ['Provide both dates.'] } }); return; } modal.setBusy(true); const path = '/api/v1/schemes-of-work/' + scheme.id + '/weeks' + (week ? '/' + week.id : ''); const result = week ? await MGAEMS.patch(path, values) : await MGAEMS.post(path, values); modal.setBusy(false); if (!result.ok) { MGAEMS.showFormErrors(form, result); return; } modal.close(); MGAEMS.toast(week ? 'Weekly plan updated.' : 'Weekly plan added.', 'success'); loadDetail(scheme.id); loadSchemes(); });
  }
  async function deleteWeek(scheme, week, control) {
    if (!await MGAEMS.confirmAction('Delete weekly plan', `Delete week ${week.week_number} from this draft?`, 'Delete week')) return;
    control.disabled = true; const result = await MGAEMS.del('/api/v1/schemes-of-work/' + scheme.id + '/weeks/' + week.id); control.disabled = false;
    if (!result.ok) { MGAEMS.toast(result.error, 'error'); return; }
    MGAEMS.toast('Weekly plan deleted.', 'success'); loadDetail(scheme.id); loadSchemes();
  }
  async function submitScheme(scheme, control) {
    if (!await MGAEMS.confirmAction('Submit scheme for review', 'Submitted schemes become read-only until leadership returns them for changes.', 'Submit for review')) return;
    control.disabled = true; const result = await MGAEMS.post('/api/v1/schemes-of-work/' + scheme.id + '/submit', {}); control.disabled = false;
    if (!result.ok) { MGAEMS.toast(Object.values(result.fields || {}).flat()[0] || result.error, 'error'); return; }
    MGAEMS.toast('Scheme submitted for review.', 'success'); loadSchemes(); loadDetail(scheme.id);
  }
  function reviewScheme(scheme, action, trigger) {
    const returned = action === 'return';
    const modal = MGAEMS.openModal({ title: returned ? 'Return scheme for changes' : 'Approve scheme of work', trigger, body: `<form id="schemeReviewForm" class="scheme-dialog"><div data-form-error></div><p>${returned ? 'Explain the changes needed. The assigned teacher will be able to edit and resubmit the scheme.' : 'Approval marks this submitted scheme as reviewed and read-only.'}</p>${textarea('review_notes', 'Review note', '', returned, 'maxlength="4000"')}</form>`, footer: '<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="submit" form="schemeReviewForm" class="btn btn-primary">' + (returned ? 'Return scheme' : 'Approve scheme') + '</button>' });
    const form = modal.body.querySelector('form');
    form.addEventListener('submit', async event => { event.preventDefault(); if (!form.reportValidity()) return; modal.setBusy(true); const result = await MGAEMS.post('/api/v1/schemes-of-work/' + scheme.id + '/review', { action: returned ? 'returned' : 'approved', review_notes: form.elements.review_notes.value.trim() || null }); modal.setBusy(false); if (!result.ok) { MGAEMS.showFormErrors(form, result); return; } modal.close(); MGAEMS.toast(returned ? 'Scheme returned for changes.' : 'Scheme approved.', 'success'); loadSchemes(); loadDetail(scheme.id); });
  }
  setup(); MGAEMS.initIcons();
})();
