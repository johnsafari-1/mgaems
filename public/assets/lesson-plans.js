/* Lesson planning in an authorized class, learning area and term. Delivery is recorded separately. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || !['system_admin', 'head_teacher', 'deputy_head_teacher', 'teacher'].includes(user.role)) {
    if (user) window.location.href = MGAEMS.landingPage(user);
    return;
  }
  renderAppShell('/lesson-plans.html');
  const main = document.getElementById('appMain'), esc = MGAEMS.escapeHTML;
  const leader = ['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(user.role);
  const state = { context: null, plans: [], request: 0, detailRequest: 0, term: '', status: '', search: '', from: '', to: '' };
  const byId = id => document.getElementById(id);
  const options = (items, selected = '', label = item => item.name, placeholder = 'Select...') => `<option value="">${placeholder}</option>${items.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(selected) ? 'selected' : ''}>${esc(label(item))}</option>`).join('')}`;
  const statusLabel = status => ({ draft: 'Draft', submitted: 'In review', returned: 'Changes requested', approved: 'Approved' }[status] || 'Unknown');
  const badge = status => `<span class="badge ${status === 'approved' ? 'badge-green' : status === 'submitted' ? 'badge-navy' : status === 'returned' ? 'badge-amber' : 'badge-gray'}">${esc(statusLabel(status))}</span>`;
  const assignmentLabel = assignment => [assignment.school_class?.name, assignment.subject?.name, assignment.term?.academic_year?.name, assignment.term?.name].filter(Boolean).join(' · ');
  const date = value => {
    const day = MGAEMS.schoolDate(value);
    if (!day) return 'Not set';
    return esc(new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' }).format(new Date(day + 'T12:00:00Z')));
  };
  const formGroup = (title, content) => `<fieldset class="academic-form-group"><legend>${esc(title)}</legend><div class="form-grid">${content}</div></fieldset>`;
  const input = (name, label, value = '', type = 'text', required = true, extra = '') => `<div class="field"><label for="lessonPlan_${name}">${esc(label)}${required ? ' *' : ''}</label><input id="lessonPlan_${name}" name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${extra}></div>`;
  const textarea = (name, label, value = '', required = true, extra = '') => `<div class="field full"><label for="lessonPlan_${name}">${esc(label)}${required ? ' *' : ''}</label><textarea id="lessonPlan_${name}" name="${name}" ${required ? 'required' : ''} ${extra}>${esc(value)}</textarea></div>`;
  const formValues = form => {
    const values = {};
    [...form.elements].forEach(control => {
      if (!control.name || control.disabled) return;
      const value = String(control.value ?? '').trim();
      values[control.name] = value === '' ? null : value;
    });
    return values;
  };
  const planFields = plan => [
    ['Specific learning outcomes', plan.specific_learning_outcomes], ['Key inquiry questions', plan.key_inquiry_questions],
    ['Teaching and learning resources', plan.teaching_learning_resources], ['Introduction', plan.introduction],
    ['Lesson development', plan.lesson_development], ['Conclusion', plan.conclusion],
    ['Learning activities', plan.learning_activities], ['Assessment approach', plan.assessment_approach],
  ];

  main.className = 'app-main lesson-plans-workspace';
  main.innerHTML = `<div class="lesson-plans-heading"><div><span class="eyebrow">Teaching &amp; learning</span><h1>Lesson Plans</h1><p>Plan individual lessons in an assigned class, learning area and term. Planning text is entered by staff; MGAEMS does not verify or claim official CBC alignment.</p></div><button type="button" class="btn btn-primary" id="createPlan" disabled><i data-lucide="plus" aria-hidden="true"></i>New lesson plan</button></div>
    <p class="lesson-plans-notice">Drafts stay editable until submission. A lesson plan never records delivery: teaching actually delivered is captured in Records of Work.</p>
    <div class="lesson-plans-toolbar"><div class="field"><label for="planTerm">Term</label><select id="planTerm"><option value="">All permitted terms</option></select></div><div class="field"><label for="planStatus">Workflow status</label><select id="planStatus"><option value="">All statuses</option><option value="draft">Draft</option><option value="submitted">In review</option><option value="returned">Changes requested</option><option value="approved">Approved</option></select></div><div class="field"><label for="planFrom">Lesson date from</label><input id="planFrom" type="date"></div><div class="field"><label for="planTo">Lesson date to</label><input id="planTo" type="date"></div><div class="field"><label for="planSearch">Search plans</label><input id="planSearch" type="search" placeholder="Title, class, strand"></div></div>
    <p id="planCount" class="academic-result-count" role="status"></p><div id="planList" aria-busy="true">${MGAEMS.loadingHTML('Loading teaching contexts...')}</div><section id="planDetail" class="plan-detail" hidden aria-live="polite"></section>`;

  byId('createPlan').addEventListener('click', event => openPlanForm(null, event.currentTarget));
  byId('planTerm').addEventListener('change', event => { state.term = event.target.value; loadPlans(); });
  byId('planStatus').addEventListener('change', event => { state.status = event.target.value; loadPlans(); });
  byId('planFrom').addEventListener('change', event => { state.from = event.target.value; loadPlans(); });
  byId('planTo').addEventListener('change', event => { state.to = event.target.value; loadPlans(); });
  byId('planSearch').addEventListener('input', event => { state.search = event.target.value.trim().toLowerCase(); if (state.context) renderList(); });
  main.addEventListener('click', event => {
    const control = event.target.closest?.('[data-plan-action]'); if (!control || control.disabled) return;
    const plan = state.plans.find(item => String(item.id) === control.dataset.id); if (!plan) return;
    if (control.dataset.planAction === 'view') loadDetail(plan.id);
    if (control.dataset.planAction === 'edit') openPlanForm(plan, control);
    if (control.dataset.planAction === 'duplicate') duplicatePlan(plan, control);
    if (control.dataset.planAction === 'submit') submitPlan(plan, control);
    if (control.dataset.planAction === 'approve' || control.dataset.planAction === 'return') reviewPlan(plan, control.dataset.planAction, control);
    if (control.dataset.planAction === 'pdf') exportPlan(plan, control);
  });

  function show(target, html) { target.innerHTML = html; target.setAttribute('aria-busy', 'false'); MGAEMS.initIcons(); }
  function failure(target, result, retry) { show(target, MGAEMS.errorHTML(result.error || 'The requested lesson plan data could not be loaded.') + '<button type="button" class="btn btn-secondary" data-retry>Try again</button>'); target.querySelector('[data-retry]').addEventListener('click', retry); }
  function identified(value) { return value && typeof value === 'object' && Number.isInteger(value.id) && value.id > 0; }
  function validContext(data) { return data && ['school', 'assigned'].includes(data.scope) && Array.isArray(data.assignments) && data.assignments.every(item => identified(item) && item.school_class && item.subject && item.term) && Array.isArray(data.schemes) && data.schemes.every(scheme => identified(scheme) && Array.isArray(scheme.weeks)); }
  function validPlan(plan) { return identified(plan) && Number.isInteger(plan.class_subject_teacher_id) && typeof plan.title === 'string' && ['draft', 'submitted', 'returned', 'approved'].includes(plan.status) && typeof plan.lesson_date === 'string' && Number.isInteger(plan.duration_minutes) && plan.assignment && typeof plan.has_record_of_work === 'boolean'; }
  function validPlans(data) { return Array.isArray(data) && data.every(validPlan); }
  function editable(plan) { return ['draft', 'returned'].includes(plan.status); }
  function own(plan) { return state.context?.scope === 'assigned' && state.context.assignments.some(item => item.id === plan.class_subject_teacher_id); }

  async function setup() {
    const result = await MGAEMS.get('/api/v1/lesson-plans/context');
    if (!result.ok || !validContext(result.data)) { failure(byId('planList'), result.ok ? { error: 'The authorized teaching context is incomplete.' } : result, setup); return; }
    state.context = result.data;
    const terms = [...new Map(result.data.assignments.map(item => [item.term.id, item.term])).values()];
    byId('planTerm').innerHTML = options(terms, '', term => `${term.name} · ${term.academic_year?.name || ''}`, 'All permitted terms');
    byId('createPlan').disabled = !result.data.assignments.length;
    loadPlans();
  }
  async function loadPlans() {
    const request = ++state.request; byId('planList').setAttribute('aria-busy', 'true'); byId('planList').innerHTML = MGAEMS.loadingHTML('Loading lesson plans...');
    const params = new URLSearchParams();
    if (state.term) params.set('term_id', state.term);
    if (state.status) params.set('status', state.status);
    if (state.from) params.set('from', state.from);
    if (state.to) params.set('to', state.to);
    const result = await MGAEMS.get('/api/v1/lesson-plans' + (params.toString() ? '?' + params : ''));
    if (request !== state.request) return;
    if (!result.ok || !validPlans(result.data)) { failure(byId('planList'), result.ok ? { error: 'The lesson plan list is incomplete.' } : result, loadPlans); return; }
    state.plans = result.data; renderList();
  }
  function renderList() {
    const query = state.search;
    const rows = state.plans.filter(plan => !query || [plan.title, plan.strand, plan.sub_strand, assignmentLabel(plan.assignment)].filter(Boolean).join(' ').toLowerCase().includes(query));
    byId('planCount').textContent = `${rows.length} of ${state.plans.length} permitted lesson plans`;
    if (!rows.length) { show(byId('planList'), MGAEMS.emptyStateHTML(state.plans.length ? 'No matching lesson plans' : 'No lesson plans yet', state.plans.length ? 'Try another term, status, date range, or search.' : state.context?.assignments.length ? 'Create a draft plan for a real teaching allocation.' : 'No authorized subject-teacher allocations are available.', 'notebook-pen')); return; }
    show(byId('planList'), `<div class="plan-grid">${rows.map(plan => `<article class="plan-card"><div class="plan-card-heading"><h2>${esc(plan.title)}</h2>${badge(plan.status)}</div><dl class="plan-meta"><div><dt>Class / learning area</dt><dd>${esc([plan.assignment.school_class?.name, plan.assignment.subject?.name].filter(Boolean).join(' · '))}</dd></div><div><dt>Lesson date</dt><dd>${date(plan.lesson_date)}</dd></div><div><dt>Academic period</dt><dd>${esc([plan.assignment.term?.academic_year?.name, plan.assignment.term?.name].filter(Boolean).join(' · '))}</dd></div><div><dt>Delivery</dt><dd>${plan.has_record_of_work ? 'Record of work recorded' : 'No record of work yet'}</dd></div>${plan.scheme_week ? `<div><dt>Scheme week</dt><dd>Week ${esc(plan.scheme_week.week_number)}</dd></div>` : ''}<div><dt>Duration</dt><dd>${esc(plan.duration_minutes)} minutes</dd></div></dl><div class="plan-actions"><button type="button" class="btn btn-secondary btn-sm" data-plan-action="view" data-id="${esc(plan.id)}">View plan</button>${editable(plan) ? `<button type="button" class="btn btn-secondary btn-sm" data-plan-action="edit" data-id="${esc(plan.id)}">Edit</button><button type="button" class="btn btn-secondary btn-sm" data-plan-action="duplicate" data-id="${esc(plan.id)}">Duplicate</button>` : ''}${!leader && own(plan) && editable(plan) ? `<button type="button" class="btn btn-primary btn-sm" data-plan-action="submit" data-id="${esc(plan.id)}">Submit for review</button>` : ''}${leader && plan.status === 'submitted' ? `<button type="button" class="btn btn-primary btn-sm" data-plan-action="approve" data-id="${esc(plan.id)}">Approve</button><button type="button" class="btn btn-secondary btn-sm" data-plan-action="return" data-id="${esc(plan.id)}">Return</button>` : ''}<button type="button" class="btn btn-secondary btn-sm" data-plan-action="pdf" data-id="${esc(plan.id)}">Download PDF</button></div></article>`).join('')}</div>`);
  }
  async function loadDetail(id) {
    const request = ++state.detailRequest, target = byId('planDetail'); target.hidden = false; target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading lesson plan...');
    const result = await MGAEMS.get('/api/v1/lesson-plans/' + encodeURIComponent(id));
    if (request !== state.detailRequest) return;
    if (!result.ok || !validPlan(result.data)) { failure(target, result.ok ? { error: 'The lesson plan is incomplete.' } : result, () => loadDetail(id)); return; }
    const plan = result.data, canEdit = editable(plan);
    show(target, `<div class="plan-detail-heading"><div><span class="eyebrow">${esc(assignmentLabel(plan.assignment))}</span><h2>${esc(plan.title)}</h2></div>${badge(plan.status)}</div><dl class="plan-meta"><div><dt>Lesson date</dt><dd>${date(plan.lesson_date)}</dd></div><div><dt>Duration</dt><dd>${esc(plan.duration_minutes)} minutes</dd></div><div><dt>Strand</dt><dd>${esc(plan.strand)}</dd></div><div><dt>Sub-strand</dt><dd>${esc(plan.sub_strand)}</dd></div><div><dt>Scheme week</dt><dd>${plan.scheme_week ? `Week ${esc(plan.scheme_week.week_number)} · ${esc(plan.scheme_week.strand)}` : 'Not linked'}</dd></div><div><dt>Delivery</dt><dd>${plan.has_record_of_work ? 'Record of work recorded for ' + date(plan.record_of_work?.taught_on) : 'No record of work has been recorded'}</dd></div></dl>
      ${plan.review_notes ? `<p class="plan-review"><strong>Review note</strong><br>${esc(plan.review_notes)}</p>` : ''}
      <div class="plan-actions">${canEdit ? `<button type="button" class="btn btn-secondary btn-sm" data-plan-action="edit" data-id="${esc(plan.id)}">Edit plan</button><button type="button" class="btn btn-secondary btn-sm" data-plan-action="duplicate" data-id="${esc(plan.id)}">Duplicate into a new draft</button>` : ''}${!leader && own(plan) && canEdit ? `<button type="button" class="btn btn-primary btn-sm" data-plan-action="submit" data-id="${esc(plan.id)}">Submit for review</button>` : ''}${leader && plan.status === 'submitted' ? `<button type="button" class="btn btn-primary btn-sm" data-plan-action="approve" data-id="${esc(plan.id)}">Approve</button><button type="button" class="btn btn-secondary btn-sm" data-plan-action="return" data-id="${esc(plan.id)}">Return for changes</button>` : ''}<button type="button" class="btn btn-secondary btn-sm" data-plan-action="pdf" data-id="${esc(plan.id)}">Download PDF</button><button type="button" class="btn btn-secondary btn-sm" id="closePlanDetail">Close plan</button></div>
      <div class="plan-sections">${planFields(plan).map(([label, value]) => `<section class="plan-section"><h3>${esc(label)}</h3><p>${esc(value || 'Not recorded')}</p></section>`).join('')}<section class="plan-section"><h3>Teacher reflection</h3><p>${esc(plan.teacher_reflection || 'Not recorded')}</p></section></div>`);
    byId('closePlanDetail').addEventListener('click', () => { target.hidden = true; target.innerHTML = ''; });
  }
  function openPlanForm(plan, trigger) {
    const assignments = state.context?.assignments || [];
    if (!assignments.length) { MGAEMS.toast('No authorized teaching allocations are available.', 'error'); return; }
    const modal = MGAEMS.openModal({ title: plan ? 'Edit lesson plan' : 'Create lesson plan', trigger, body: `<form id="planForm" class="plan-dialog"><div data-form-error></div><p class="academic-form-note">Choose an authorized teaching allocation. Planning text is staff-entered and is not verified curriculum content.</p>${plan ? '' : formGroup('Teaching allocation', `<div class="field full"><label for="lessonPlan_class_subject_teacher_id">Class, learning area and term *</label><select id="lessonPlan_class_subject_teacher_id" name="class_subject_teacher_id" required>${options(assignments, plan?.class_subject_teacher_id, assignmentLabel)}</select></div>`)}${formGroup('Lesson details', input('title', 'Lesson title / topic', plan?.title || '', 'text', true, 'maxlength="160"') + input('lesson_date', 'Lesson date', plan?.lesson_date || '', 'date') + input('duration_minutes', 'Duration (minutes)', plan?.duration_minutes ?? 40, 'number', true, 'min="1" max="600" step="1"'))}${formGroup('Curriculum planning fields', input('strand', 'Strand', plan?.strand || '', 'text', true, 'maxlength="255"') + input('sub_strand', 'Sub-strand', plan?.sub_strand || '', 'text', true, 'maxlength="255"') + `<div class="field full"><label for="lessonPlan_scheme_of_work_week_id">Linked scheme week</label><select id="lessonPlan_scheme_of_work_week_id" name="scheme_of_work_week_id"></select></div>`)}${formGroup('Lesson content', textarea('specific_learning_outcomes', 'Specific learning outcomes', plan?.specific_learning_outcomes || '', true, 'maxlength="8000"') + textarea('key_inquiry_questions', 'Key inquiry questions', plan?.key_inquiry_questions || '', true, 'maxlength="8000"') + textarea('teaching_learning_resources', 'Teaching and learning resources', plan?.teaching_learning_resources || '', true, 'maxlength="8000"'))}${formGroup('Lesson structure', textarea('introduction', 'Introduction', plan?.introduction || '', true, 'maxlength="8000"') + textarea('lesson_development', 'Lesson development', plan?.lesson_development || '', true, 'maxlength="8000"') + textarea('conclusion', 'Conclusion', plan?.conclusion || '', true, 'maxlength="8000"') + textarea('learning_activities', 'Learning activities', plan?.learning_activities || '', true, 'maxlength="8000"') + textarea('assessment_approach', 'Assessment approach', plan?.assessment_approach || '', true, 'maxlength="8000"'))}${formGroup('Reflection', textarea('teacher_reflection', 'Teacher reflection', plan?.teacher_reflection || '', false, 'maxlength="8000"'))}</form>`, footer: `<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="button" class="btn btn-primary" id="savePlan">${plan ? 'Save plan' : 'Create draft'}</button>` });
    const form = modal.body.querySelector('form');
    const assignmentControl = form.elements.class_subject_teacher_id, weekControl = form.elements.scheme_of_work_week_id;
    function syncWeeks() {
      const assignmentId = assignmentControl ? assignmentControl.value : plan?.class_subject_teacher_id;
      const weeks = (state.context?.schemes || []).filter(scheme => String(scheme.class_subject_teacher_id) === String(assignmentId)).flatMap(scheme => scheme.weeks.map(week => ({ id: week.id, label: `Week ${week.week_number} · ${week.strand}` })));
      weekControl.innerHTML = options(weeks, plan?.scheme_of_work_week_id, week => week.label, weeks.length ? 'Not linked' : 'No weekly plans available');
    }
    if (assignmentControl) assignmentControl.addEventListener('change', syncWeeks);
    syncWeeks();
    modal.overlay.querySelector('#savePlan').addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      const values = formValues(form);
      modal.setBusy(true);
      const path = '/api/v1/lesson-plans' + (plan ? '/' + plan.id : '');
      const result = plan ? await MGAEMS.patch(path, values) : await MGAEMS.post(path, values);
      modal.setBusy(false);
      if (!result.ok) { MGAEMS.showFormErrors(form, result); return; }
      modal.close(); MGAEMS.toast(plan ? 'Lesson plan updated.' : 'Draft lesson plan created.', 'success');
      await loadPlans(); if (result.data?.id) loadDetail(result.data.id);
    });
  }
  async function duplicatePlan(plan, control) {
    if (!await MGAEMS.confirmAction('Duplicate lesson plan', 'A new editable draft is created with the same planning content and a new teacher reflection.', 'Duplicate plan')) return;
    control.disabled = true; const result = await MGAEMS.post('/api/v1/lesson-plans/' + plan.id + '/duplicate', {}); control.disabled = false;
    if (!result.ok) { MGAEMS.toast(result.error, 'error'); return; }
    MGAEMS.toast('Draft lesson plan created.', 'success'); await loadPlans(); if (result.data?.id) loadDetail(result.data.id);
  }
  async function submitPlan(plan, control) {
    if (!await MGAEMS.confirmAction('Submit lesson plan', 'Submitted lesson plans become read-only until school leadership returns them for changes.', 'Submit for review')) return;
    control.disabled = true; const result = await MGAEMS.post('/api/v1/lesson-plans/' + plan.id + '/submit', {}); control.disabled = false;
    if (!result.ok) { MGAEMS.toast(Object.values(result.fields || {}).flat()[0] || result.error, 'error'); return; }
    MGAEMS.toast('Lesson plan submitted for review.', 'success'); loadPlans(); loadDetail(plan.id);
  }
  function reviewPlan(plan, action, trigger) {
    const returned = action === 'return';
    const modal = MGAEMS.openModal({ title: returned ? 'Return lesson plan' : 'Approve lesson plan', trigger, body: `<form id="planReviewForm" class="plan-dialog"><div data-form-error></div><p>${returned ? 'Explain the changes needed. The assigned teacher will be able to edit and resubmit the plan.' : 'Approval marks this submitted plan as reviewed and read-only.'}</p>${textarea('review_notes', 'Review note', '', returned, 'maxlength="4000"')}</form>`, footer: `<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="button" class="btn btn-primary" id="submitPlanReview">${returned ? 'Return plan' : 'Approve plan'}</button>` });
    const form = modal.body.querySelector('form');
    modal.overlay.querySelector('#submitPlanReview').addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      modal.setBusy(true);
      const result = await MGAEMS.post('/api/v1/lesson-plans/' + plan.id + '/review', { action: returned ? 'returned' : 'approved', review_notes: formValues(form).review_notes });
      modal.setBusy(false);
      if (!result.ok) { MGAEMS.showFormErrors(form, result); return; }
      modal.close(); MGAEMS.toast(returned ? 'Lesson plan returned for changes.' : 'Lesson plan approved.', 'success'); loadPlans(); loadDetail(plan.id);
    });
  }
  function exportPlan(plan, control) {
    control.disabled = true;
    MGAEMS.download('/api/v1/lesson-plans/' + plan.id + '/pdf', 'lesson-plan-' + plan.id + '.pdf').then(result => {
      control.disabled = false;
      if (!result.ok) MGAEMS.toast(result.error || 'The lesson plan PDF could not be downloaded.', 'error');
    });
  }
  setup(); MGAEMS.initIcons();
})();
