/* Homework and assignments for authorized teaching allocations. Answer keys stay staff-only. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || !['system_admin', 'head_teacher', 'deputy_head_teacher', 'teacher'].includes(user.role)) {
    if (user) window.location.href = MGAEMS.landingPage(user);
    return;
  }
  renderAppShell('/homework.html');
  const main = document.getElementById('appMain'), esc = MGAEMS.escapeHTML;
  const leader = ['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(user.role);
  const state = { context: null, homework: [], detail: null, request: 0, detailRequest: 0, completionRequest: 0, term: '', class: '', status: '', dueFrom: '', dueTo: '', search: '' };
  const byId = id => document.getElementById(id);
  const options = (items, selected = '', label = item => item.name, placeholder = 'Select...') => `<option value="">${placeholder}</option>${items.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(selected) ? 'selected' : ''}>${esc(label(item))}</option>`).join('')}`;
  const statusLabel = status => ({ draft: 'Draft', published: 'Published', closed: 'Closed', archived: 'Archived' }[status] || 'Unknown');
  const badge = status => `<span class="badge ${status === 'published' ? 'badge-green' : status === 'closed' ? 'badge-navy' : status === 'archived' ? 'badge-gray' : 'badge-amber'}">${esc(statusLabel(status))}</span>`;
  const methodLabel = method => ({ exercise_book: 'Exercise book', class_collection: 'Collected in class', oral: 'Oral response', project: 'Project work' }[method] || 'Not set');
  const questionType = type => ({ short_answer: 'Short answer', structured: 'Structured', multiple_choice: 'Multiple choice' }[type] || 'Question');
  const assignmentLabel = assignment => [assignment.school_class?.name, assignment.subject?.name, assignment.term?.academic_year?.name, assignment.term?.name].filter(Boolean).join(' · ');
  const date = value => {
    const day = MGAEMS.schoolDate(value);
    if (!day) return 'Not set';
    return esc(new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' }).format(new Date(day + 'T12:00:00Z')));
  };
  const formGroup = (title, content) => `<fieldset class="academic-form-group"><legend>${esc(title)}</legend><div class="form-grid">${content}</div></fieldset>`;
  const input = (name, label, value = '', type = 'text', required = true, extra = '') => `<div class="field"><label for="homework_${name}">${esc(label)}${required ? ' *' : ''}</label><input id="homework_${name}" name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${extra}></div>`;
  const textarea = (name, label, value = '', required = true, extra = '') => `<div class="field full"><label for="homework_${name}">${esc(label)}${required ? ' *' : ''}</label><textarea id="homework_${name}" name="${name}" ${required ? 'required' : ''} ${extra}>${esc(value)}</textarea></div>`;
  const formValues = form => {
    const values = {};
    [...form.elements].forEach(control => {
      if (!control.name || control.disabled) return;
      const value = String(control.value ?? '').trim();
      values[control.name] = value === '' ? null : value;
    });
    return values;
  };
  const identified = value => value && typeof value === 'object' && Number.isInteger(value.id) && value.id > 0;

  main.className = 'app-main homework-workspace';
  main.innerHTML = `<div class="homework-heading"><div><span class="eyebrow">Teaching &amp; learning</span><h1>Homework &amp; Assignments</h1><p>Create homework for an authorized class and learning area, author questions with answer keys, track completion, and print learner worksheets or a restricted answer key.</p></div><button type="button" class="btn btn-primary" id="createHomework" disabled><i data-lucide="plus" aria-hidden="true"></i>New homework</button></div>
    <p class="homework-notice">Drafts are editable until publication. Only the assigned teacher publishes, closes or archives homework. Answer keys and marking guidance are never shown to families, and submission is recorded only by an explicit teacher entry — an unrecorded learner is never marked as missing.</p>
    <div class="homework-toolbar"><div class="field"><label for="homeworkTerm">Term</label><select id="homeworkTerm"><option value="">All permitted terms</option></select></div><div class="field"><label for="homeworkClassFilter">Class</label><select id="homeworkClassFilter"><option value="">All classes</option></select></div><div class="field"><label for="homeworkStatus">Status</label><select id="homeworkStatus"><option value="">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="closed">Closed</option><option value="archived">Archived</option></select></div><div class="field"><label for="homeworkDueFrom">Due from</label><input id="homeworkDueFrom" type="date"></div><div class="field"><label for="homeworkDueTo">Due to</label><input id="homeworkDueTo" type="date"></div><div class="field"><label for="homeworkSearch">Search homework</label><input id="homeworkSearch" type="search" placeholder="Title, class, learning area"></div></div>
    <p id="homeworkCount" class="academic-result-count" role="status"></p><div id="homeworkList" aria-busy="true">${MGAEMS.loadingHTML('Loading teaching contexts...')}</div><section id="homeworkDetail" class="homework-detail" hidden aria-live="polite"></section><section id="homeworkCompletions" class="homework-detail" hidden aria-live="polite"></section>`;

  byId('createHomework').addEventListener('click', event => openHomeworkForm(null, event.currentTarget));
  byId('homeworkTerm').addEventListener('change', event => { state.term = event.target.value; loadHomework(); });
  byId('homeworkClassFilter').addEventListener('change', event => { state.class = event.target.value; loadHomework(); });
  byId('homeworkStatus').addEventListener('change', event => { state.status = event.target.value; loadHomework(); });
  byId('homeworkDueFrom').addEventListener('change', event => { state.dueFrom = event.target.value; loadHomework(); });
  byId('homeworkDueTo').addEventListener('change', event => { state.dueTo = event.target.value; loadHomework(); });
  byId('homeworkSearch').addEventListener('input', event => { state.search = event.target.value.trim().toLowerCase(); if (state.context) renderList(); });
  main.addEventListener('click', event => {
    const control = event.target.closest?.('[data-homework-action]'); if (!control || control.disabled) return;
    const item = state.homework.find(entry => String(entry.id) === control.dataset.id) || state.detail; if (!item) return;
    const action = control.dataset.homeworkAction;
    if (action === 'view') loadDetail(item.id);
    if (action === 'edit') {
      if (state.detail?.id === item.id) openHomeworkForm(item, control);
      else loadDetail(item.id).then(() => { if (state.detail?.id === item.id) openHomeworkForm(state.detail, control); });
    }
    if (action === 'question') openQuestionForm(item, null, control);
    if (action === 'ai') openGroundedHomework(item, control);
    if (action === 'editQuestion') openQuestionForm(item, item.questions?.find(question => String(question.id) === control.dataset.questionId), control);
    if (action === 'deleteQuestion') deleteQuestion(item, control.dataset.questionId, control);
    if (action === 'publish') transition(item, 'publish', control);
    if (action === 'close') transition(item, 'close', control);
    if (action === 'archive') transition(item, 'archive', control);
    if (action === 'delete') deleteHomework(item, control);
    if (action === 'pdf') exportDocument(item, 'pdf', control);
    if (action === 'answerKey') exportDocument(item, 'answer-key/pdf', control);
    if (action === 'completions') loadCompletions(item);
    if (action === 'record') recordCompletion(item, control);
    if (action === 'removeRecord') removeCompletion(item, control);
  });

  function show(target, html) { target.innerHTML = html; target.setAttribute('aria-busy', 'false'); MGAEMS.initIcons(); }
  function failure(target, result, retry) { show(target, MGAEMS.errorHTML(result.error || 'The requested homework data could not be loaded.') + '<button type="button" class="btn btn-secondary" data-retry>Try again</button>'); target.querySelector('[data-retry]').addEventListener('click', retry); }
  function validContext(data) { return data && ['school', 'assigned'].includes(data.scope) && Array.isArray(data.assignments) && data.assignments.every(item => identified(item) && item.school_class && item.subject && item.term) && Array.isArray(data.lesson_plans) && Array.isArray(data.schemes) && Array.isArray(data.submission_methods); }
  function validSummary(item) { return identified(item) && Number.isInteger(item.class_subject_teacher_id) && typeof item.title === 'string' && ['draft', 'published', 'closed', 'archived'].includes(item.status) && typeof item.due_on === 'string' && item.assignment && Number.isInteger(item.question_count) && item.assignment.school_class; }
  function validDetail(item) { return validSummary(item) && Array.isArray(item.questions) && item.questions.every(question => identified(question) && Array.isArray(question.options) && typeof question.prompt === 'string'); }
  function own(item) { return state.context?.scope === 'assigned' && state.context.assignments.some(assignment => assignment.id === item.class_subject_teacher_id); }
  const assignmentOf = id => (state.context?.assignments || []).find(assignment => String(assignment.id) === String(id));

  async function setup() {
    const result = await MGAEMS.get('/api/v1/homework/context');
    if (!result.ok || !validContext(result.data)) { failure(byId('homeworkList'), result.ok ? { error: 'The authorized teaching context is incomplete.' } : result, setup); return; }
    state.context = result.data;
    const terms = [...new Map(result.data.assignments.map(item => [item.term.id, item.term])).values()];
    const classes = [...new Map(result.data.assignments.map(item => [item.school_class.id, item.school_class])).values()];
    byId('homeworkTerm').innerHTML = options(terms, '', term => `${term.name} · ${term.academic_year?.name || ''}`, 'All permitted terms');
    byId('homeworkClassFilter').innerHTML = options(classes, '', classroom => classroom.name, 'All classes');
    byId('createHomework').disabled = !result.data.assignments.length;
    loadHomework();
  }
  async function loadHomework() {
    const request = ++state.request; byId('homeworkList').setAttribute('aria-busy', 'true'); byId('homeworkList').innerHTML = MGAEMS.loadingHTML('Loading homework...');
    const params = new URLSearchParams();
    if (state.term) params.set('term_id', state.term);
    if (state.class) params.set('class_id', state.class);
    if (state.status) params.set('status', state.status);
    if (state.dueFrom) params.set('due_from', state.dueFrom);
    if (state.dueTo) params.set('due_to', state.dueTo);
    const result = await MGAEMS.get('/api/v1/homework' + (params.toString() ? '?' + params : ''));
    if (request !== state.request) return;
    if (!result.ok || !result.data.every(validSummary)) { failure(byId('homeworkList'), result.ok ? { error: 'The homework list is incomplete.' } : result, loadHomework); return; }
    state.homework = result.data; state.detail = null; renderList();
    byId('homeworkDetail').hidden = true; byId('homeworkDetail').innerHTML = '';
  }
  function renderList() {
    const query = state.search;
    const rows = state.homework.filter(item => !query || [item.title, assignmentLabel(item.assignment)].filter(Boolean).join(' ').toLowerCase().includes(query));
    byId('homeworkCount').textContent = `${rows.length} of ${state.homework.length} permitted homework assignments`;
    if (!rows.length) { show(byId('homeworkList'), MGAEMS.emptyStateHTML(state.homework.length ? 'No matching homework' : 'No homework yet', state.homework.length ? 'Try another term, class, status, due-date range, or search.' : state.context?.assignments.length ? 'Create a draft for a real teaching allocation.' : 'No authorized subject-teacher allocations are available.', 'notebook-pen')); return; }
    show(byId('homeworkList'), `<div class="homework-grid">${rows.map(item => `<article class="homework-card"><div class="homework-card-heading"><h2>${esc(item.title)}</h2>${badge(item.status)}</div><dl class="homework-meta"><div><dt>Class / learning area</dt><dd>${esc([item.assignment.school_class?.name, item.assignment.subject?.name].filter(Boolean).join(' · '))}</dd></div><div><dt>Academic period</dt><dd>${esc([item.assignment.term?.academic_year?.name, item.assignment.term?.name].filter(Boolean).join(' · '))}</dd></div><div><dt>Due date</dt><dd>${date(item.due_on)}</dd></div><div><dt>Questions</dt><dd>${esc(item.question_count)}${item.total_marks ? ' · ' + esc(item.total_marks) + ' marks' : ''}</dd></div><div><dt>Completion recorded</dt><dd>${esc(item.completion_counts?.recorded ?? 0)} of ${esc(item.eligible_learner_count ?? 0)} learners</dd></div><div><dt>Submission</dt><dd>${esc(methodLabel(item.submission_method))}</dd></div></dl><div class="homework-actions"><button type="button" class="btn btn-secondary btn-sm" data-homework-action="view" data-id="${esc(item.id)}">Open</button>${item.status === 'draft' ? `<button type="button" class="btn btn-secondary btn-sm" data-homework-action="edit" data-id="${esc(item.id)}">Edit</button>` : ''}${item.status === 'draft' || item.status === 'published' ? `<button type="button" class="btn btn-secondary btn-sm" data-homework-action="completions" data-id="${esc(item.id)}">Completion</button>` : ''}${item.status === 'draft' ? `<button type="button" class="btn btn-danger btn-sm" data-homework-action="delete" data-id="${esc(item.id)}">Delete</button>` : ''}</div></article>`).join('')}</div>`);
  }
  async function loadDetail(id) {
    const request = ++state.detailRequest, target = byId('homeworkDetail'); target.hidden = false; target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading homework...');
    const result = await MGAEMS.get('/api/v1/homework/' + encodeURIComponent(id));
    if (request !== state.detailRequest) return;
    if (!result.ok || !validDetail(result.data)) { failure(target, result.ok ? { error: 'The homework document is incomplete.' } : result, () => loadDetail(id)); return; }
    state.detail = result.data;
    const item = result.data, canEdit = item.status === 'draft', canRecord = item.status === 'published' || item.status === 'closed';
    show(target, `<div class="homework-detail-heading"><div><span class="eyebrow">${esc(assignmentLabel(item.assignment))}</span><h2>${esc(item.title)}</h2></div>${badge(item.status)}</div>
      <dl class="homework-meta"><div><dt>Assigned</dt><dd>${date(item.assigned_on)}</dd></div><div><dt>Due date</dt><dd>${date(item.due_on)}</dd></div><div><dt>Submission method</dt><dd>${esc(methodLabel(item.submission_method))}</dd></div><div><dt>Total marks</dt><dd>${item.total_marks ? esc(item.total_marks) + ' marks' : 'Not specified'}</dd></div><div><dt>Question marks</dt><dd>${esc(item.questions.reduce((sum, question) => sum + (question.marks || 0), 0))}</dd></div>${item.lesson_plan ? `<div><dt>Linked lesson plan</dt><dd>${esc(item.lesson_plan.title)}</dd></div>` : ''}${item.scheme_week ? `<div><dt>Scheme week</dt><dd>Week ${esc(item.scheme_week.week_number)}</dd></div>` : ''}</dl>
      <div class="homework-actions">${canEdit ? `<button type="button" class="btn btn-secondary btn-sm" data-homework-action="edit" data-id="${esc(item.id)}">Edit homework</button><button type="button" class="btn btn-primary btn-sm" data-homework-action="question" data-id="${esc(item.id)}">Add question</button><button type="button" class="btn btn-secondary btn-sm" data-homework-action="ai" data-id="${esc(item.id)}">Curriculum AI draft</button>` : ''}${canRecord ? `<button type="button" class="btn btn-secondary btn-sm" data-homework-action="completions" data-id="${esc(item.id)}">Track completion</button>` : ''}${!leader && own(item) && item.status === 'draft' ? `<button type="button" class="btn btn-primary btn-sm" data-homework-action="publish" data-id="${esc(item.id)}">Publish</button>` : ''}${!leader && own(item) && item.status === 'published' ? `<button type="button" class="btn btn-secondary btn-sm" data-homework-action="close" data-id="${esc(item.id)}">Close</button><button type="button" class="btn btn-secondary btn-sm" data-homework-action="archive" data-id="${esc(item.id)}">Archive</button>` : ''}${!leader && own(item) && item.status === 'closed' ? `<button type="button" class="btn btn-secondary btn-sm" data-homework-action="archive" data-id="${esc(item.id)}">Archive</button>` : ''}<button type="button" class="btn btn-secondary btn-sm" data-homework-action="pdf" data-id="${esc(item.id)}">Download worksheet PDF</button><button type="button" class="btn btn-secondary btn-sm" data-homework-action="answerKey" data-id="${esc(item.id)}">Restricted answer key PDF</button><button type="button" class="btn btn-secondary btn-sm" id="closeHomeworkDetail">Close</button></div>
      <div class="homework-sections"><section class="homework-section"><h3>Instructions</h3><p>${esc(item.instructions || 'Not recorded')}</p></section><section class="homework-section"><h3>Learning outcomes</h3><p>${esc(item.learning_outcomes || 'Not recorded')}</p></section>${item.teacher_notes ? `<section class="homework-section"><h3>Teacher notes (staff only)</h3><p>${esc(item.teacher_notes)}</p></section>` : ''}</div>
      <div class="homework-questions">${item.questions.length ? item.questions.map(question => `<article class="homework-question${question.answer_key ? ' homework-answer-key' : ''}"><header><h3>${esc(question.position)}. ${esc(questionType(question.question_type))}${question.marks ? ' · ' + esc(question.marks) + ' marks' : ''}</h3><span class="badge badge-gray">Question ${esc(question.position)}</span></header><dl><div><dt>Question</dt><dd>${esc(question.prompt)}</dd></div>${question.diagram_reference ? `<div><dt>Diagram</dt><dd>${esc(question.diagram_reference)}</dd></div>` : ''}${question.options.length ? `<div><dt>Options</dt><dd>${question.options.map((option, index) => esc(String.fromCharCode(65 + index)) + '. ' + esc(option)).join('<br>')}</dd></div>` : ''}<div><dt class="restricted">Answer key (staff only)</dt><dd>${esc(question.answer_key || 'Not recorded')}</dd></div><div><dt>Marking guidance</dt><dd>${esc(question.marking_guidance || 'Not recorded')}</dd></div></dl>${canEdit ? `<div class="homework-actions"><button type="button" class="btn btn-secondary btn-sm" data-homework-action="editQuestion" data-id="${esc(item.id)}" data-question-id="${esc(question.id)}">Edit question</button><button type="button" class="btn btn-danger btn-sm" data-homework-action="deleteQuestion" data-id="${esc(item.id)}" data-question-id="${esc(question.id)}">Delete question</button></div>` : ''}</article>`).join('') : MGAEMS.emptyStateHTML('No questions yet', canEdit ? 'Add at least one question before publishing this homework.' : 'This homework has no recorded questions.', 'help-circle')}</div>
      <section class="homework-preview" aria-label="Printable worksheet preview"><h3>Worksheet preview (learner view)</h3><p class="text-muted">Learner name: ____________________ &nbsp; Admission number: ____________________</p><ol>${item.questions.map(question => `<li><div>${esc(question.prompt)}${question.marks ? ' (' + esc(question.marks) + ' marks)' : ''}</div>${question.options.length ? `<ul>${question.options.map(option => `<li>${esc(option)}</li>`).join('')}</ul>` : ''}<div class="answer-space"></div></li>`).join('')}</ol></section>`);
    byId('closeHomeworkDetail').addEventListener('click', () => { target.hidden = true; target.innerHTML = ''; state.detail = null; });
  }
  function openHomeworkForm(item, trigger) {
    const assignments = state.context?.assignments || [];
    if (!assignments.length) { MGAEMS.toast('No authorized teaching allocations are available.', 'error'); return; }
    const selectedAssignmentId = item?.class_subject_teacher_id || assignments[0].id;
    const plans = (state.context?.lesson_plans || []).filter(plan => String(plan.class_subject_teacher_id) === String(selectedAssignmentId));
    const weeks = (state.context?.schemes || []).filter(scheme => String(scheme.class_subject_teacher_id) === String(selectedAssignmentId)).flatMap(scheme => scheme.weeks.map(week => ({ id: week.id, label: `Week ${week.week_number} · ${week.strand}` })));
    const modal = MGAEMS.openModal({ title: item ? 'Edit homework' : 'Create homework', trigger, body: `<form id="homeworkForm" class="homework-dialog"><div data-form-error></div><p class="academic-form-note">Choose an authorized teaching allocation. Planning and question content is staff-entered and is not verified curriculum content.</p>${item ? '' : formGroup('Teaching allocation', `<div class="field full"><label for="homework_class_subject_teacher_id">Class, learning area and term *</label><select id="homework_class_subject_teacher_id" name="class_subject_teacher_id" required>${options(assignments, item?.class_subject_teacher_id, assignmentLabel)}</select></div>`)}${formGroup('Homework details', input('title', 'Homework title', item?.title || '', 'text', true, 'maxlength="160"') + input('assigned_on', 'Assigned date', item?.assigned_on || '', 'date') + input('due_on', 'Due date', item?.due_on || '', 'date') + input('total_marks', 'Total marks', item?.total_marks ?? '', 'number', false, 'min="1" max="1000" step="1"') + `<div class="field"><label for="homework_submission_method">Expected submission method *</label><select id="homework_submission_method" name="submission_method" required>${options((state.context?.submission_methods || []).map(method => ({ id: method, name: methodLabel(method) })), item?.submission_method)}</select></div>` + `<div class="field"><label for="homework_lesson_plan_id">Linked lesson plan</label><select id="homework_lesson_plan_id" name="lesson_plan_id">${options(plans, item?.lesson_plan_id, plan => `${plan.title} · ${MGAEMS.schoolDate(plan.lesson_date) || ''}`, plans.length ? 'Not linked' : 'No lesson plans available')}</select></div>` + `<div class="field"><label for="homework_scheme_of_work_week_id">Linked scheme of work</label><select id="homework_scheme_of_work_week_id" name="scheme_of_work_week_id">${options(weeks, item?.scheme_of_work_week_id, week => week.label, weeks.length ? 'Not linked' : 'No weekly plans available')}</select></div>`)}${formGroup('Learner instructions', textarea('instructions', 'Instructions', item?.instructions || '', true, 'maxlength="8000"') + textarea('learning_outcomes', 'Learning outcomes', item?.learning_outcomes || '', true, 'maxlength="8000"'))}${formGroup('Staff notes', textarea('teacher_notes', 'Teacher notes (never shown to families)', item?.teacher_notes || '', false, 'maxlength="4000"'))}</form>`, footer: `<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="button" class="btn btn-primary" id="saveHomework">${item ? 'Save homework' : 'Create draft'}</button>` });
    const form = modal.body.querySelector('form');
    if (form.elements.class_subject_teacher_id) form.elements.class_subject_teacher_id.value = String(selectedAssignmentId);
    form.elements.class_subject_teacher_id?.addEventListener('change', () => {
      const allocation = form.elements.class_subject_teacher_id.value;
      const linkedPlans = (state.context?.lesson_plans || []).filter(plan => String(plan.class_subject_teacher_id) === String(allocation));
      const linkedWeeks = (state.context?.schemes || []).filter(scheme => String(scheme.class_subject_teacher_id) === String(allocation)).flatMap(scheme => scheme.weeks.map(week => ({ id: week.id, label: `Week ${week.week_number} · ${week.strand}` })));
      form.elements.lesson_plan_id.innerHTML = options(linkedPlans, '', plan => `${plan.title} · ${MGAEMS.schoolDate(plan.lesson_date) || ''}`, linkedPlans.length ? 'Not linked' : 'No lesson plans available');
      form.elements.scheme_of_work_week_id.innerHTML = options(linkedWeeks, '', week => week.label, linkedWeeks.length ? 'Not linked' : 'No weekly plans available');
    });
    modal.overlay.querySelector('#saveHomework').addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      const values = formValues(form);
      if (values.assigned_on && values.due_on && values.due_on < values.assigned_on) { MGAEMS.showFormErrors(form, { error: 'Check the homework dates.', fields: { due_on: ['The due date must be on or after the assigned date.'] } }); return; }
      modal.setBusy(true);
      const result = item ? await MGAEMS.patch('/api/v1/homework/' + item.id, values) : await MGAEMS.post('/api/v1/homework', values);
      modal.setBusy(false);
      if (!result.ok) { MGAEMS.showFormErrors(form, result); return; }
      modal.close(); MGAEMS.toast(item ? 'Homework updated.' : 'Draft homework created.', 'success');
      await loadHomework(); if (result.data?.id) loadDetail(result.data.id);
    });
  }
  function openGroundedHomework(item, trigger) {
    return MGAEMS.groundedDraft({
      operation: 'homework', title: 'Curriculum-grounded homework questions', trigger, importLabel: 'Import questions',
      documentType: 'homework', documentId: item.id, classSubjectTeacherId: item.class_subject_teacher_id,
      selection: { learning_area: item.assignment?.subject?.name || '' },
      constraints: { total_marks: item.total_marks || 10 },
      onImport: async (draft, { importState }) => {
        const questions = Array.isArray(draft.questions) ? draft.questions : [];
        if (!questions.length) return { ok: false, error: 'The draft has no questions to import.' };
        const current = await MGAEMS.get('/api/v1/homework/' + item.id);
        if (!current.ok || !Array.isArray(current.data?.questions)) return { ok: false, error: 'Could not verify current questions. No content was written. Retry when the document can be read.' };
        const saved = [...current.data.questions];
        if (!importState.questions) {
          let offset = saved.reduce((max, question) => Math.max(max, Number(question.position) || 0), 0);
          importState.questions = [];
          for (const question of questions) {
            const values = { question_type: question.question_type, prompt: question.prompt, marks: question.marks,
              options: question.question_type === 'multiple_choice' ? question.options : [], answer_key: question.answer_key || '', marking_guidance: question.marking_guidance || '' };
            if ([...saved, ...importState.questions].some(row => MGAEMS.draftRowMatches(row, values))) continue;
            importState.questions.push({ position: ++offset, ...values });
          }
          importState.totalMarks = [...saved, ...importState.questions].reduce((sum, question) => sum + (Number(question.marks) || 0), 0);
        }
        if (!importState.questions.length) return { ok: false, error: 'Every question in the draft already exists on this homework. Nothing new was imported.' };
        const patch = await MGAEMS.patch('/api/v1/homework/' + item.id, {
          instructions: draft.instructions || 'Complete the questions below.',
          learning_outcomes: (draft.specific_learning_outcomes || []).map(outcome => outcome.text).join('\n') || 'AI-generated draft for teacher review.',
          total_marks: importState.totalMarks || draft.total_marks || null,
        });
        if (!patch.ok) return { ok: false, error: patch.error, fields: patch.fields };
        let added = 0, skipped = 0;
        for (const values of importState.questions) {
          const existing = saved.find(row => Number(row.position) === values.position);
          if (existing) {
            if (!MGAEMS.draftRowMatches(existing, values)) return { ok: false, error: `Question position ${values.position} changed during import. Review the saved homework before continuing.` };
            skipped += 1; continue;
          }
          const result = await MGAEMS.post('/api/v1/homework/' + item.id + '/questions', values);
          if (!result.ok) return { ok: false, error: result.error, fields: result.fields, message: `Saved or verified ${added + skipped} of ${importState.questions.length} questions before stopping. Retry the same draft to continue.` };
          saved.push(values); added += 1;
        }
        await loadHomework(); loadDetail(item.id);
        return { ok: true, message: `${added} question${added === 1 ? '' : 's'} imported into this draft homework${skipped ? ` (${skipped} duplicate${skipped === 1 ? '' : 's'} skipped)` : ''}. Review and edit before publishing.` };
      },
    });
  }
  function openQuestionForm(item, question, trigger) {
    const modal = MGAEMS.openModal({ title: question ? 'Edit question' : 'Add question', trigger, body: `<form id="questionForm" class="homework-dialog"><div data-form-error></div><p class="academic-form-note">Answer keys and marking guidance are restricted to school staff. Multiple-choice questions need at least two options and an answer that matches one option.</p>${formGroup('Question', `<div class="field"><label for="homework_position">Position</label><input id="homework_position" name="position" type="number" min="1" max="100" step="1" value="${esc(question?.position ?? (item.questions.length + 1))}" required></div><div class="field"><label for="homework_question_type">Question type *</label><select id="homework_question_type" name="question_type" required>${options(['short_answer', 'structured', 'multiple_choice'].map(type => ({ id: type, name: questionType(type) })), question?.question_type)}</select></div>` + input('marks', 'Marks', question?.marks ?? '', 'number', true, 'min="1" max="1000" step="1"') + input('diagram_reference', 'Diagram reference (optional)', question?.diagram_reference || '', 'text', false, 'maxlength="255"') + textarea('prompt', 'Question', question?.prompt || '', true, 'maxlength="4000"'))}${formGroup('Multiple-choice options', textarea('options', 'One option per line (multiple choice only)', (question?.options || []).join('\n'), false, 'maxlength="1000"'))}${formGroup('Staff-only assessment keys', `<div class="field"><label for="homework_answer_key">Answer key</label><select id="homework_answer_key" name="answer_key"><option value="">Not recorded</option></select></div>` + textarea('marking_guidance', 'Marking guidance', question?.marking_guidance || '', false, 'maxlength="4000"'))}</form>`, footer: `<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="button" class="btn btn-primary" id="saveQuestion">${question ? 'Save question' : 'Add question'}</button>` });
    const form = modal.body.querySelector('form'), optionControl = form.elements.options, answerControl = form.elements.answer_key;
    function syncAnswers() {
      const selected = answerControl.value;
      const lines = optionControl.value.split('\n').map(line => line.trim()).filter(Boolean);
      answerControl.innerHTML = '<option value="">Not recorded</option>' + lines.map(line => `<option value="${esc(line)}">${esc(line)}</option>`).join('');
      answerControl.value = lines.includes(selected) ? selected : (question?.answer_key && lines.includes(question.answer_key) ? question.answer_key : '');
    }
    optionControl.addEventListener('input', syncAnswers);
    syncAnswers();
    modal.overlay.querySelector('#saveQuestion').addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      const values = formValues(form);
      values.options = (values.options || '').split('\n').map(line => line.trim()).filter(Boolean);
      if (values.question_type !== 'multiple_choice') values.options = [];
      if (values.question_type === 'multiple_choice' && values.options.length < 2) { MGAEMS.showFormErrors(form, { error: 'Multiple-choice questions need at least two options.', fields: { options: ['Add at least two options.'] } }); return; }
      modal.setBusy(true);
      const path = '/api/v1/homework/' + item.id + '/questions' + (question ? '/' + question.id : '');
      const result = question ? await MGAEMS.patch(path, values) : await MGAEMS.post(path, values);
      modal.setBusy(false);
      if (!result.ok) { MGAEMS.showFormErrors(form, result); return; }
      modal.close(); MGAEMS.toast(question ? 'Question updated.' : 'Question added.', 'success');
      loadDetail(item.id); if (state.detail) state.detail = result.data; loadHomework();
    });
  }
  async function deleteQuestion(item, questionId, control) {
    if (!await MGAEMS.confirmAction('Delete question', 'Delete this question from the draft homework?', 'Delete question')) return;
    control.disabled = true; const result = await MGAEMS.del('/api/v1/homework/' + item.id + '/questions/' + questionId); control.disabled = false;
    if (!result.ok) { MGAEMS.toast(result.error, 'error'); return; }
    MGAEMS.toast('Question deleted.', 'success'); loadDetail(item.id); state.detail = result.data; loadHomework();
  }
  async function transition(item, action, control) {
    const messages = { publish: ['Publish homework', 'Published homework becomes visible to linked Parent / Guardian accounts for eligible learners and can no longer be edited.'], close: ['Close homework', 'Closing stops new submissions for this assignment. Completion can still be recorded.'], archive: ['Archive homework', 'Archived homework becomes read-only history.'] };
    if (!await MGAEMS.confirmAction(messages[action][0], messages[action][1], action === 'publish' ? 'Publish' : action === 'close' ? 'Close' : 'Archive')) return;
    control.disabled = true; const result = await MGAEMS.post('/api/v1/homework/' + item.id + '/' + action, {}); control.disabled = false;
    if (!result.ok) { MGAEMS.toast(Object.values(result.fields || {}).flat()[0] || result.error, 'error'); return; }
    MGAEMS.toast('Homework ' + (action === 'publish' ? 'published' : action === 'close' ? 'closed' : 'archived') + '.', 'success'); loadHomework(); state.detail = result.data; loadDetail(item.id);
  }
  async function deleteHomework(item, control) {
    if (!await MGAEMS.confirmAction('Delete homework', 'Delete this draft homework and its questions? Published homework must be archived instead.', 'Delete homework')) return;
    control.disabled = true; const result = await MGAEMS.del('/api/v1/homework/' + item.id); control.disabled = false;
    if (!result.ok) { MGAEMS.toast(result.error, 'error'); return; }
    MGAEMS.toast('Homework deleted.', 'success'); byId('homeworkDetail').hidden = true; loadHomework();
  }
  function exportDocument(item, path, control) {
    control.disabled = true;
    const restricted = path.includes('answer-key');
    MGAEMS.download('/api/v1/homework/' + item.id + '/' + path, (restricted ? 'homework-answer-key-' : 'homework-') + item.id + '.pdf').then(result => {
      control.disabled = false;
      if (!result.ok) MGAEMS.toast(result.error || 'The document could not be downloaded.', 'error');
    });
  }
  async function loadCompletions(item) {
    const request = ++state.completionRequest, target = byId('homeworkCompletions'); target.hidden = false; target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading eligible learners...');
    const result = await MGAEMS.get('/api/v1/homework/' + encodeURIComponent(item.id) + '/completions');
    if (request !== state.completionRequest) return;
    if (!result.ok || !Array.isArray(result.data?.learners)) { failure(target, result.ok ? { error: 'The completion list is incomplete.' } : result, () => loadCompletions(item)); return; }
    const learners = result.data.learners, canRecord = !leader && own(item) && ['published', 'closed'].includes(item.status);
    show(target, `<div class="homework-detail-heading"><div><span class="eyebrow">${esc(assignmentLabel(item.assignment))}</span><h2>Completion tracking · ${esc(item.title)}</h2></div><span class="badge ${['published', 'closed'].includes(item.status) ? 'badge-green' : 'badge-gray'}">${esc(statusLabel(item.status))}</span></div>
      <p class="homework-notice">A learner without a recorded entry is shown as not yet recorded. Missing is only recorded when a teacher explicitly selects it, and any record can be removed to return the learner to not yet recorded.</p>
      <div>${learners.map(learner => `<div class="completion-row"><span class="learner"><strong>${esc(learner.first_name)} ${esc(learner.last_name)}</strong> · ${esc(learner.admission_no)}</span>${learner.status ? `<span class="badge ${learner.status === 'completed' ? 'badge-green' : learner.status === 'missing' ? 'badge-red' : 'badge-navy'}">${esc(learner.status === 'completed' ? 'Completed' : learner.status === 'missing' ? 'Missing' : 'Submitted')}</span>` : '<span class="completion-unrecorded">Not yet recorded</span>'}${canRecord ? `<select aria-label="Completion status for ${esc(learner.first_name)} ${esc(learner.last_name)}" data-completion-status="${esc(learner.student_id)}"><option value="">Record…</option><option value="submitted">Submitted / received</option><option value="completed">Completed</option><option value="missing">Missing (evidence required)</option></select><input type="text" placeholder="Note (optional)" aria-label="Completion note for ${esc(learner.first_name)} ${esc(learner.last_name)}" data-completion-note="${esc(learner.student_id)}" value="${esc(learner.notes || '')}"><button type="button" class="btn btn-secondary btn-sm" data-homework-action="record" data-id="${esc(item.id)}" data-student-id="${esc(learner.student_id)}">Save record</button>${learner.completion_id ? `<button type="button" class="btn btn-danger btn-sm" data-homework-action="removeRecord" data-id="${esc(item.id)}" data-completion-id="${esc(learner.completion_id)}">Remove</button>` : ''}` : ''}</div>`).join('')}</div>
      <div class="homework-actions"><button type="button" class="btn btn-secondary btn-sm" id="closeCompletions">Close tracking</button></div>`);
    byId('closeCompletions').addEventListener('click', () => { target.hidden = true; target.innerHTML = ''; });
    state.completions = { item, learners };
  }
  async function recordCompletion(item, control) {
    const studentId = control.dataset.studentId;
    const select = byId('homeworkCompletions').querySelector(`[data-completion-status="${studentId}"]`);
    const note = byId('homeworkCompletions').querySelector(`[data-completion-note="${studentId}"]`);
    const status = select?.value;
    if (!status) { MGAEMS.toast('Choose an explicit completion status before saving.', 'error'); return; }
    if (status === 'missing' && !await MGAEMS.confirmAction('Record a missing submission', 'Only record missing when you have evidence that the learner did not submit. An unrecorded learner must stay not yet recorded.', 'Record missing')) return;
    control.disabled = true;
    const result = await MGAEMS.post('/api/v1/homework/' + item.id + '/completions', { student_id: Number(studentId), status, notes: note?.value || null });
    control.disabled = false;
    if (!result.ok) { MGAEMS.toast(Object.values(result.fields || {}).flat()[0] || result.error, 'error'); return; }
    MGAEMS.toast('Completion recorded.', 'success'); loadCompletions(item); loadHomework();
  }
  async function removeCompletion(item, control) {
    if (!control.dataset.completionId) { MGAEMS.toast('Reload the completion list before removing this record.', 'error'); return; }
    if (!await MGAEMS.confirmAction('Remove completion record', 'Remove this recorded completion? The learner returns to not yet recorded.', 'Remove record')) return;
    control.disabled = true;
    const result = await MGAEMS.del('/api/v1/homework/' + item.id + '/completions/' + control.dataset.completionId);
    control.disabled = false;
    if (!result.ok) { MGAEMS.toast(result.error, 'error'); return; }
    MGAEMS.toast('Completion record removed.', 'success'); loadCompletions(item); loadHomework();
  }
  setup(); MGAEMS.initIcons();
})();
