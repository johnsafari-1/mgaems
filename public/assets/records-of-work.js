/* Records of work: teaching actually delivered, recorded explicitly and never inferred from a plan. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || !['system_admin', 'head_teacher', 'deputy_head_teacher', 'teacher'].includes(user.role)) {
    if (user) window.location.href = MGAEMS.landingPage(user);
    return;
  }
  renderAppShell('/records-of-work.html');
  const main = document.getElementById('appMain'), esc = MGAEMS.escapeHTML;
  const leader = ['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(user.role);
  const state = { context: null, records: [], request: 0, detailRequest: 0, term: '', status: '', search: '', from: '', to: '' };
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
  const input = (name, label, value = '', type = 'text', required = true, extra = '') => `<div class="field"><label for="record_${name}">${esc(label)}${required ? ' *' : ''}</label><input id="record_${name}" name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${extra}></div>`;
  const textarea = (name, label, value = '', required = true, extra = '') => `<div class="field full"><label for="record_${name}">${esc(label)}${required ? ' *' : ''}</label><textarea id="record_${name}" name="${name}" ${required ? 'required' : ''} ${extra}>${esc(value)}</textarea></div>`;
  const formValues = form => {
    const values = {};
    [...form.elements].forEach(control => {
      if (!control.name || control.disabled) return;
      const value = String(control.value ?? '').trim();
      values[control.name] = value === '' ? null : value;
    });
    return values;
  };
  const recordFields = record => [
    ['Content covered', record.content_covered], ['Learning activities conducted', record.learning_activities_conducted],
    ['Work completed', record.work_completed], ['Work not completed', record.work_not_completed || 'None recorded'],
    ['Reasons for deviations', record.reasons_for_deviations || 'None recorded'],
    ['Teacher observations', record.teacher_observations], ['Follow-up actions', record.follow_up_actions || 'None recorded'],
  ];

  main.className = 'app-main records-workspace';
  main.innerHTML = `<div class="records-heading"><div><span class="eyebrow">Teaching &amp; learning</span><h1>Records of Work</h1><p>Record the teaching actually delivered in an authorized class, learning area and term. A lesson plan or its scheduled time never records delivery on its own.</p></div><button type="button" class="btn btn-primary" id="createRecord" disabled><i data-lucide="plus" aria-hidden="true"></i>New record of work</button></div>
    <p class="records-notice">Delivery is recorded only by an explicit record of work. Plans, timetable entries and dates are never treated as delivered lessons.</p>
    <div class="records-toolbar"><div class="field"><label for="recordTerm">Term</label><select id="recordTerm"><option value="">All permitted terms</option></select></div><div class="field"><label for="recordStatus">Workflow status</label><select id="recordStatus"><option value="">All statuses</option><option value="draft">Draft</option><option value="submitted">In review</option><option value="returned">Changes requested</option><option value="approved">Approved</option></select></div><div class="field"><label for="recordFrom">Teaching date from</label><input id="recordFrom" type="date"></div><div class="field"><label for="recordTo">Teaching date to</label><input id="recordTo" type="date"></div><div class="field"><label for="recordSearch">Search records</label><input id="recordSearch" type="search" placeholder="Class, learning area, content"></div></div>
    <p id="recordCount" class="academic-result-count" role="status"></p><div id="recordList" aria-busy="true">${MGAEMS.loadingHTML('Loading teaching contexts...')}</div><section id="recordDetail" class="record-detail" hidden aria-live="polite"></section>`;

  byId('createRecord').addEventListener('click', event => openRecordForm(null, event.currentTarget));
  byId('recordTerm').addEventListener('change', event => { state.term = event.target.value; loadRecords(); });
  byId('recordStatus').addEventListener('change', event => { state.status = event.target.value; loadRecords(); });
  byId('recordFrom').addEventListener('change', event => { state.from = event.target.value; loadRecords(); });
  byId('recordTo').addEventListener('change', event => { state.to = event.target.value; loadRecords(); });
  byId('recordSearch').addEventListener('input', event => { state.search = event.target.value.trim().toLowerCase(); if (state.context) renderList(); });
  main.addEventListener('click', event => {
    const control = event.target.closest?.('[data-record-action]'); if (!control || control.disabled) return;
    const record = state.records.find(item => String(item.id) === control.dataset.id); if (!record) return;
    if (control.dataset.recordAction === 'view') loadDetail(record.id);
    if (control.dataset.recordAction === 'edit') openRecordForm(record, control);
    if (control.dataset.recordAction === 'submit') submitRecord(record, control);
    if (control.dataset.recordAction === 'approve' || control.dataset.recordAction === 'return') reviewRecord(record, control.dataset.recordAction, control);
    if (control.dataset.recordAction === 'pdf') exportRecord(record, control);
  });

  function show(target, html) { target.innerHTML = html; target.setAttribute('aria-busy', 'false'); MGAEMS.initIcons(); }
  function failure(target, result, retry) { show(target, MGAEMS.errorHTML(result.error || 'The requested record of work could not be loaded.') + '<button type="button" class="btn btn-secondary" data-retry>Try again</button>'); target.querySelector('[data-retry]').addEventListener('click', retry); }
  function identified(value) { return value && typeof value === 'object' && Number.isInteger(value.id) && value.id > 0; }
  function validContext(data) { return data && ['school', 'assigned'].includes(data.scope) && Array.isArray(data.assignments) && data.assignments.every(item => identified(item) && item.school_class && item.subject && item.term) && Array.isArray(data.lesson_plans) && data.lesson_plans.every(item => identified(item) && typeof item.title === 'string'); }
  function validRecord(record) { return identified(record) && Number.isInteger(record.class_subject_teacher_id) && typeof record.taught_on === 'string' && typeof record.content_covered === 'string' && ['draft', 'submitted', 'returned', 'approved'].includes(record.status) && record.assignment && typeof record.teacher_observations === 'string'; }
  function validRecords(data) { return Array.isArray(data) && data.every(validRecord); }
  function editable(record) { return ['draft', 'returned'].includes(record.status); }
  function own(record) { return state.context?.scope === 'assigned' && state.context.assignments.some(item => item.id === record.class_subject_teacher_id); }

  async function setup() {
    const result = await MGAEMS.get('/api/v1/records-of-work/context');
    if (!result.ok || !validContext(result.data)) { failure(byId('recordList'), result.ok ? { error: 'The authorized teaching context is incomplete.' } : result, setup); return; }
    state.context = result.data;
    const terms = [...new Map(result.data.assignments.map(item => [item.term.id, item.term])).values()];
    byId('recordTerm').innerHTML = options(terms, '', term => `${term.name} · ${term.academic_year?.name || ''}`, 'All permitted terms');
    byId('createRecord').disabled = !result.data.assignments.length;
    loadRecords();
  }
  async function loadRecords() {
    const request = ++state.request; byId('recordList').setAttribute('aria-busy', 'true'); byId('recordList').innerHTML = MGAEMS.loadingHTML('Loading records of work...');
    const params = new URLSearchParams();
    if (state.term) params.set('term_id', state.term);
    if (state.status) params.set('status', state.status);
    if (state.from) params.set('from', state.from);
    if (state.to) params.set('to', state.to);
    const result = await MGAEMS.get('/api/v1/records-of-work' + (params.toString() ? '?' + params : ''));
    if (request !== state.request) return;
    if (!result.ok || !validRecords(result.data)) { failure(byId('recordList'), result.ok ? { error: 'The record of work list is incomplete.' } : result, loadRecords); return; }
    state.records = result.data; renderList();
  }
  function renderList() {
    const query = state.search;
    const rows = state.records.filter(record => !query || [record.content_covered, record.lesson_plan?.title, assignmentLabel(record.assignment)].filter(Boolean).join(' ').toLowerCase().includes(query));
    byId('recordCount').textContent = `${rows.length} of ${state.records.length} permitted records of work`;
    if (!rows.length) { show(byId('recordList'), MGAEMS.emptyStateHTML(state.records.length ? 'No matching records' : 'No records of work yet', state.records.length ? 'Try another term, status, date range, or search.' : state.context?.assignments.length ? 'Record a lesson that was actually delivered.' : 'No authorized subject-teacher allocations are available.', 'clipboard-check')); return; }
    show(byId('recordList'), `<div class="record-grid">${rows.map(record => `<article class="record-card"><div class="record-card-heading"><h2>${esc(record.lesson_plan?.title || 'Unplanned lesson')}</h2>${badge(record.status)}</div><dl class="record-meta"><div><dt>Class / learning area</dt><dd>${esc([record.assignment.school_class?.name, record.assignment.subject?.name].filter(Boolean).join(' · '))}</dd></div><div><dt>Teaching date</dt><dd>${date(record.taught_on)}</dd></div><div><dt>Academic period</dt><dd>${esc([record.assignment.term?.academic_year?.name, record.assignment.term?.name].filter(Boolean).join(' · '))}</dd></div><div><dt>Content covered</dt><dd>${esc(record.content_covered)}</dd></div>${record.work_not_completed ? `<div><dt>Work not completed</dt><dd>${esc(record.work_not_completed)}</dd></div>` : ''}</dl><div class="record-actions"><button type="button" class="btn btn-secondary btn-sm" data-record-action="view" data-id="${esc(record.id)}">View record</button>${editable(record) ? `<button type="button" class="btn btn-secondary btn-sm" data-record-action="edit" data-id="${esc(record.id)}">Edit</button>` : ''}${!leader && own(record) && editable(record) ? `<button type="button" class="btn btn-primary btn-sm" data-record-action="submit" data-id="${esc(record.id)}">Submit for review</button>` : ''}${leader && record.status === 'submitted' ? `<button type="button" class="btn btn-primary btn-sm" data-record-action="approve" data-id="${esc(record.id)}">Approve</button><button type="button" class="btn btn-secondary btn-sm" data-record-action="return" data-id="${esc(record.id)}">Return</button>` : ''}<button type="button" class="btn btn-secondary btn-sm" data-record-action="pdf" data-id="${esc(record.id)}">Download PDF</button></div></article>`).join('')}</div>`);
  }
  async function loadDetail(id) {
    const request = ++state.detailRequest, target = byId('recordDetail'); target.hidden = false; target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading record of work...');
    const result = await MGAEMS.get('/api/v1/records-of-work/' + encodeURIComponent(id));
    if (request !== state.detailRequest) return;
    if (!result.ok || !validRecord(result.data)) { failure(target, result.ok ? { error: 'The record of work is incomplete.' } : result, () => loadDetail(id)); return; }
    const record = result.data, canEdit = editable(record);
    show(target, `<div class="record-detail-heading"><div><span class="eyebrow">${esc(assignmentLabel(record.assignment))}</span><h2>${esc(record.lesson_plan?.title || 'Unplanned lesson')}</h2></div>${badge(record.status)}</div><dl class="record-meta"><div><dt>Actual teaching date</dt><dd>${date(record.taught_on)}</dd></div><div><dt>Linked lesson plan</dt><dd>${record.lesson_plan ? `${esc(record.lesson_plan.title)} · ${date(record.lesson_plan.lesson_date)}` : 'Not linked'}</dd></div><div><dt>Academic period</dt><dd>${esc([record.assignment.term?.academic_year?.name, record.assignment.term?.name].filter(Boolean).join(' · '))}</dd></div></dl>
      ${record.review_notes ? `<p class="record-review"><strong>Review note</strong><br>${esc(record.review_notes)}</p>` : ''}
      <div class="record-actions">${canEdit ? `<button type="button" class="btn btn-secondary btn-sm" data-record-action="edit" data-id="${esc(record.id)}">Edit record</button>` : ''}${!leader && own(record) && canEdit ? `<button type="button" class="btn btn-primary btn-sm" data-record-action="submit" data-id="${esc(record.id)}">Submit for review</button>` : ''}${leader && record.status === 'submitted' ? `<button type="button" class="btn btn-primary btn-sm" data-record-action="approve" data-id="${esc(record.id)}">Approve</button><button type="button" class="btn btn-secondary btn-sm" data-record-action="return" data-id="${esc(record.id)}">Return for changes</button>` : ''}<button type="button" class="btn btn-secondary btn-sm" data-record-action="pdf" data-id="${esc(record.id)}">Download PDF</button><button type="button" class="btn btn-secondary btn-sm" id="closeRecordDetail">Close record</button></div>
      <div class="record-sections">${recordFields(record).map(([label, value]) => `<section class="record-section"><h3>${esc(label)}</h3><p>${esc(value || 'Not recorded')}</p></section>`).join('')}</div>`);
    byId('closeRecordDetail').addEventListener('click', () => { target.hidden = true; target.innerHTML = ''; });
  }
  function openRecordForm(record, trigger) {
    const assignments = state.context?.assignments || [];
    if (!assignments.length) { MGAEMS.toast('No authorized teaching allocations are available.', 'error'); return; }
    const modal = MGAEMS.openModal({ title: record ? 'Edit record of work' : 'Create record of work', trigger, body: `<form id="recordForm" class="record-dialog"><div data-form-error></div><p class="academic-form-note">Record only teaching that actually happened. Plans, timetable entries and passing dates never create a record.</p>${record ? '' : formGroup('Teaching allocation', `<div class="field full"><label for="record_class_subject_teacher_id">Class, learning area and term *</label><select id="record_class_subject_teacher_id" name="class_subject_teacher_id" required>${options(assignments, record?.class_subject_teacher_id, assignmentLabel)}</select></div>`)}${formGroup('Lesson and date', input('taught_on', 'Actual teaching date', record?.taught_on || '', 'date') + `<div class="field"><label for="record_lesson_plan_id">Linked lesson plan</label><select id="record_lesson_plan_id" name="lesson_plan_id"></select></div>`)}${formGroup('Delivered teaching', textarea('content_covered', 'Content covered', record?.content_covered || '', true, 'maxlength="8000"') + textarea('learning_activities_conducted', 'Learning activities conducted', record?.learning_activities_conducted || '', true, 'maxlength="8000"') + textarea('work_completed', 'Work completed', record?.work_completed || '', true, 'maxlength="8000"'))}${formGroup('Deviations', textarea('work_not_completed', 'Work not completed', record?.work_not_completed || '', false, 'maxlength="8000"') + textarea('reasons_for_deviations', 'Reasons for deviations', record?.reasons_for_deviations || '', false, 'maxlength="8000"'))}${formGroup('Observations', textarea('teacher_observations', 'Teacher observations', record?.teacher_observations || '', true, 'maxlength="8000"') + textarea('follow_up_actions', 'Follow-up actions', record?.follow_up_actions || '', false, 'maxlength="8000"'))}</form>`, footer: `<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="button" class="btn btn-primary" id="saveRecord">${record ? 'Save record' : 'Create draft record'}</button>` });
    const form = modal.body.querySelector('form');
    const assignmentControl = form.elements.class_subject_teacher_id, planControl = form.elements.lesson_plan_id;
    function syncPlans() {
      const assignmentId = assignmentControl ? assignmentControl.value : record?.class_subject_teacher_id;
      const plans = (state.context?.lesson_plans || []).filter(plan => String(plan.class_subject_teacher_id) === String(assignmentId)).map(plan => ({ id: plan.id, label: `${plan.title} · ${MGAEMS.schoolDate(plan.lesson_date) || ''}` }));
      planControl.innerHTML = options(plans, record?.lesson_plan_id, plan => plan.label, plans.length ? 'Not linked' : 'No lesson plans available');
    }
    if (assignmentControl) assignmentControl.addEventListener('change', syncPlans);
    syncPlans();
    modal.overlay.querySelector('#saveRecord').addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      modal.setBusy(true);
      const values = formValues(form);
      const path = '/api/v1/records-of-work' + (record ? '/' + record.id : '');
      const result = record ? await MGAEMS.patch(path, values) : await MGAEMS.post(path, values);
      modal.setBusy(false);
      if (!result.ok) { MGAEMS.showFormErrors(form, result); return; }
      modal.close(); MGAEMS.toast(record ? 'Record of work updated.' : 'Draft record of work created.', 'success');
      await loadRecords(); if (result.data?.id) loadDetail(result.data.id);
    });
  }
  async function submitRecord(record, control) {
    if (!await MGAEMS.confirmAction('Submit record of work', 'Submitted records become read-only until school leadership returns them for changes.', 'Submit for review')) return;
    control.disabled = true; const result = await MGAEMS.post('/api/v1/records-of-work/' + record.id + '/submit', {}); control.disabled = false;
    if (!result.ok) { MGAEMS.toast(Object.values(result.fields || {}).flat()[0] || result.error, 'error'); return; }
    MGAEMS.toast('Record of work submitted for review.', 'success'); loadRecords(); loadDetail(record.id);
  }
  function reviewRecord(record, action, trigger) {
    const returned = action === 'return';
    const modal = MGAEMS.openModal({ title: returned ? 'Return record of work' : 'Approve record of work', trigger, body: `<form id="recordReviewForm" class="record-dialog"><div data-form-error></div><p>${returned ? 'Explain the changes needed. The assigned teacher will be able to edit and resubmit the record.' : 'Approval marks this submitted record as reviewed and read-only.'}</p>${textarea('review_notes', 'Review note', '', returned, 'maxlength="4000"')}</form>`, footer: `<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="button" class="btn btn-primary" id="submitRecordReview">${returned ? 'Return record' : 'Approve record'}</button>` });
    const form = modal.body.querySelector('form');
    modal.overlay.querySelector('#submitRecordReview').addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      modal.setBusy(true);
      const result = await MGAEMS.post('/api/v1/records-of-work/' + record.id + '/review', { action: returned ? 'returned' : 'approved', review_notes: formValues(form).review_notes });
      modal.setBusy(false);
      if (!result.ok) { MGAEMS.showFormErrors(form, result); return; }
      modal.close(); MGAEMS.toast(returned ? 'Record of work returned for changes.' : 'Record of work approved.', 'success'); loadRecords(); loadDetail(record.id);
    });
  }
  function exportRecord(record, control) {
    control.disabled = true;
    MGAEMS.download('/api/v1/records-of-work/' + record.id + '/pdf', 'record-of-work-' + record.id + '.pdf').then(result => {
      control.disabled = false;
      if (!result.ok) MGAEMS.toast(result.error || 'The record of work PDF could not be downloaded.', 'error');
    });
  }
  setup(); MGAEMS.initIcons();
})();
