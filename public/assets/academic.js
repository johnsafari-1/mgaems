/* Academic configuration. Offerings, teacher allocations, and scheduling are distinct. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || MGAEMS.landingPage(user) !== '/dashboard.html') return;
  renderAppShell('/academic.html');
  const esc = MGAEMS.escapeHTML;
  const canStructure = ['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(user.role);
  const canCalendar = ['system_admin', 'head_teacher'].includes(user.role);
  const state = { years: null, terms: null, classes: null, subjects: null, assignments: null, staff: null, timetable: [], timetableRequest: 0, assignmentRequest: 0, requests: {} };
  let editorOpening = false;
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const sections = [['years', 'Academic years'], ['terms', 'Terms'], ['classes', 'Classes / Grades'], ['subjects', 'Learning Areas / Subjects'], ...(canStructure ? [['assignments', 'Subject teachers'], ['timetable', 'Timetable']] : [])];
  const endpoints = { years: 'academic-years', terms: 'terms', classes: 'classes', subjects: 'subjects' };
  const main = document.getElementById('appMain');
  const table = (headings, rows) => `<div class="table-scroll"><table><thead><tr>${headings.map(heading => `<th scope="col">${heading}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const button = (action, id, label, danger = false) => `<button type="button" class="btn ${danger ? 'btn-danger' : 'btn-secondary'} btn-sm" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
  const current = active => `<span class="badge ${active ? 'badge-green' : 'badge-gray'}">${active ? 'Current' : 'Not current'}</span>`;
  const date = value => esc(String(value || '').slice(0, 10));
  const name = staff => staff ? esc([staff.first_name, staff.last_name].filter(Boolean).join(' ')) : 'Unassigned';
  const options = (items, chosen = '', label = item => item.name, placeholder = 'Select…') => `<option value="">${placeholder}</option>` + items.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(chosen) ? 'selected' : ''}>${esc(label(item))}</option>`).join('');
  const input = (key, title, value = '', type = 'text', required = true, extra = '') => `<div class="field"><label for="academic_${key}">${title}${required ? ' *' : ''}</label><input id="academic_${key}" name="${key}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${extra}></div>`;
  const select = (key, title, content, required = true) => `<div class="field"><label for="academic_${key}">${title}${required ? ' *' : ''}</label><select id="academic_${key}" name="${key}" ${required ? 'required' : ''}>${content}</select></div>`;

  main.innerHTML = `<div class="page-heading"><h1>Academic Structure</h1><p>Configure school periods, classes, learning areas, offerings, and teaching responsibilities.</p></div>
    <div class="tabs" role="tablist" aria-label="Academic Structure sections">${sections.map(([key, title], index) => `<button type="button" class="tab ${index === 0 ? 'active' : ''}" id="academicTab_${key}" role="tab" aria-selected="${index === 0}" aria-controls="academicPanel_${key}" tabindex="${index === 0 ? 0 : -1}" data-tab="${key}">${title}</button>`).join('')}</div>
    ${sections.map(([key, title], index) => `<section class="tab-panel ${index === 0 ? 'active' : ''}" id="academicPanel_${key}" role="tabpanel" aria-labelledby="academicTab_${key}" ${index ? 'hidden' : ''}>
      <div class="section-header"><h2>${title}</h2>${(key === 'years' || key === 'terms' ? canCalendar : canStructure) ? `<button type="button" class="btn btn-primary btn-sm" id="add_${key}" data-add="${key}" disabled>Add ${key === 'years' ? 'year' : key === 'terms' ? 'term' : key === 'classes' ? 'class' : key === 'subjects' ? 'learning area' : key === 'assignments' ? 'subject teacher' : 'timetable entry'}</button>` : ''}</div>
      ${key === 'classes' ? '<p class="text-muted">Offerings define what a class teaches. Class teachers and subject teachers are separate responsibilities.</p>' : key === 'subjects' ? '<p class="text-muted">These are the school’s assessable learning areas/subjects. Category/grouping is optional metadata.</p>' : key === 'timetable' ? '<p class="text-muted">This is the existing recurring weekly timetable; it is not scoped to an academic term.</p>' : ''}
      ${key === 'assignments' ? '<div class="toolbar"><label for="assignmentTerm">Term</label><select id="assignmentTerm"><option value="">All terms</option></select><label for="assignmentClass">Class</label><select id="assignmentClass"><option value="">All classes</option></select></div>' : key === 'timetable' ? '<div class="toolbar"><label for="timetableClass">Class / Grade</label><select id="timetableClass"><option value="">Select a class…</option></select></div>' : ''}
      <div class="card card-table" id="academicData_${key}" aria-busy="true">${MGAEMS.loadingHTML('Loading ' + title.toLowerCase() + '…')}</div></section>`).join('')}`;

  const tabs = [...main.querySelectorAll('[data-tab]')];
  function activateTab(tab) {
    tabs.forEach(item => { const active = item === tab; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1; const panel = document.getElementById(item.getAttribute('aria-controls')); panel.hidden = !active; panel.classList.toggle('active', active); });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : null;
      if (next) { event.preventDefault(); activateTab(next); next.focus(); }
    });
  });
  main.querySelectorAll('[data-add]').forEach(control => control.addEventListener('click', () => openEditor(control.dataset.add, null, control)));
  main.addEventListener('click', event => {
    const control = event.target.closest('[data-action]');
    if (!control || control.disabled) return;
    handleAction(control.dataset.action, control.dataset.id, control);
  });
  if (canStructure) {
    document.getElementById('assignmentTerm').addEventListener('change', loadAssignments);
    document.getElementById('assignmentClass').addEventListener('change', loadAssignments);
    document.getElementById('timetableClass').addEventListener('change', loadTimetable);
    showData('timetable', MGAEMS.emptyStateHTML('Select a class', 'Choose a configured class to view its timetable.', 'calendar'));
  }

  function showData(key, html) {
    const target = document.getElementById('academicData_' + key); target.innerHTML = html; target.setAttribute('aria-busy', 'false'); MGAEMS.initIcons();
  }
  function failure(key, result, retry) {
    showData(key, `<div class="state-panel">${MGAEMS.errorHTML(result.error || 'The academic data could not be loaded.')}<button type="button" class="btn btn-secondary btn-sm" data-retry>Try again</button></div>`);
    document.getElementById('academicData_' + key).querySelector('[data-retry]').addEventListener('click', retry);
  }
  function syncSelectors() {
    function populate(id, items, placeholder, label = item => item.name) {
      const control = document.getElementById(id); if (!control || !items) return;
      const previous = control.value; control.innerHTML = options(items, previous, label, placeholder);
    }
    populate('assignmentTerm', state.terms, 'All terms', term => `${term.name} · ${term.academic_year?.name || ''}`);
    populate('assignmentClass', state.classes, 'All classes'); populate('timetableClass', state.classes, 'Select a class…');
    ['years', 'terms', 'classes', 'subjects', 'assignments', 'timetable'].forEach(key => {
      const control = document.getElementById('add_' + key); if (!control) return;
      control.disabled = key === 'terms' ? !state.years?.length : key === 'assignments' ? !state.classes?.length || !state.subjects || !state.terms?.length : key === 'timetable' ? !state.classes?.length || !document.getElementById('timetableClass').value : !state[key];
    });
  }
  async function load(key) {
    const sequence = state.requests[key] = (state.requests[key] || 0) + 1;
    const target = document.getElementById('academicData_' + key); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading academic data…');
    const result = await MGAEMS.get('/api/v1/' + endpoints[key]);
    if (sequence !== state.requests[key]) return;
    if (!result.ok || !Array.isArray(result.data)) { state[key] = null; syncSelectors(); failure(key, result, () => load(key)); return; }
    state[key] = result.data; render(key); syncSelectors();
  }
  function render(key) {
    const items = state[key];
    if (!items.length) { showData(key, MGAEMS.emptyStateHTML('No ' + sections.find(item => item[0] === key)[1].toLowerCase() + ' configured', 'Create school configuration if your role permits it.', 'book-open')); return; }
    let headings, rows;
    if (key === 'years') {
      headings = ['Year', 'Start', 'End', 'Status', 'Actions'];
      rows = items.map(item => `<tr><td>${esc(item.name)}</td><td>${date(item.start_date)}</td><td>${date(item.end_date)}</td><td>${current(item.is_current)}</td><td><div class="form-actions">${canCalendar ? button('edit_years', item.id, 'Edit') + (!item.is_current ? button('activate_years', item.id, 'Activate') + button('delete_years', item.id, 'Delete', true) : '') : ''}</div></td></tr>`);
    } else if (key === 'terms') {
      headings = ['Term', 'Year', 'Start', 'End', 'Status', 'Actions'];
      rows = items.map(item => `<tr><td>${esc(item.name)}</td><td>${esc(item.academic_year?.name)}</td><td>${date(item.start_date)}</td><td>${date(item.end_date)}</td><td>${current(item.is_current)}</td><td><div class="form-actions">${canCalendar ? button('edit_terms', item.id, 'Edit') + (!item.is_current ? button('activate_terms', item.id, 'Activate') + button('delete_terms', item.id, 'Delete', true) : '') : ''}</div></td></tr>`);
    } else if (key === 'classes') {
      headings = ['Class / Grade', 'Level', 'Order', 'Capacity', 'Learners', 'Class teacher', 'Offerings', 'Actions'];
      rows = items.map(item => `<tr><td>${esc(item.name)}</td><td>${esc(item.level)}</td><td>${esc(item.sequence)}</td><td>${esc(item.capacity ?? '—')}</td><td>${esc(item.students_count ?? '—')}</td><td>${name(item.class_teacher)}</td><td>${esc(item.subjects_count ?? '—')}</td><td><div class="form-actions">${button('offerings', item.id, canStructure ? 'Manage offerings' : 'View offerings')}${canStructure ? button('edit_classes', item.id, 'Edit') + button('delete_classes', item.id, 'Delete', true) : ''}</div></td></tr>`);
    } else {
      headings = ['Learning Area / Subject', 'Code', 'Category / Grouping', 'Status', 'Actions'];
      rows = items.map(item => `<tr><td>${esc(item.name)}</td><td>${esc(item.code || '—')}</td><td>${esc(item.learning_area || '—')}</td><td><span class="badge ${item.status === 'active' ? 'badge-green' : 'badge-gray'}">${esc(item.status)}</span></td><td><div class="form-actions">${canStructure ? button('edit_subjects', item.id, 'Edit') + button('status_subjects', item.id, item.status === 'active' ? 'Retire' : 'Reactivate') + button('delete_subjects', item.id, 'Delete', true) : ''}</div></td></tr>`);
    }
    showData(key, table(headings, rows));
  }
  async function loadAssignments() {
    const sequence = ++state.assignmentRequest;
    const params = new URLSearchParams();
    if (document.getElementById('assignmentTerm').value) params.set('term_id', document.getElementById('assignmentTerm').value);
    if (document.getElementById('assignmentClass').value) params.set('class_id', document.getElementById('assignmentClass').value);
    const target = document.getElementById('academicData_assignments'); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading subject teachers…');
    const result = await MGAEMS.get('/api/v1/teacher-assignments?' + params);
    if (sequence !== state.assignmentRequest) return;
    if (!result.ok) { failure('assignments', result, loadAssignments); return; }
    state.assignments = result.data;
    showData('assignments', result.data.length ? table(['Class', 'Learning area', 'Subject teacher', 'Term / Year', 'Actions'], result.data.map(item => `<tr><td>${esc(item.school_class?.name)}</td><td>${esc(item.subject?.name)}</td><td>${name(item.staff)}</td><td>${esc(item.term?.name)} · ${esc(item.term?.academic_year?.name)}</td><td>${button('delete_assignments', item.id, 'Remove', true)}</td></tr>`)) : MGAEMS.emptyStateHTML('No subject teachers match', 'Allocate an offered learning area to an eligible teacher for a term.', 'user-check'));
  }
  async function loadTimetable() {
    const sequence = ++state.timetableRequest;
    const id = document.getElementById('timetableClass').value; syncSelectors();
    if (!id) { state.timetable = []; showData('timetable', MGAEMS.emptyStateHTML('Select a class', 'Choose a configured class to view its recurring timetable.', 'calendar')); return; }
    const target = document.getElementById('academicData_timetable'); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading timetable…');
    const result = await MGAEMS.get('/api/v1/timetable/by-class?class_id=' + encodeURIComponent(id));
    if (sequence !== state.timetableRequest) return;
    if (!result.ok) { failure('timetable', result, loadTimetable); return; }
    state.timetable = result.data;
    showData('timetable', result.data.length ? table(['Day', 'Time', 'Learning area', 'Teacher', 'Actions'], result.data.map(item => `<tr><td>${esc(days[item.day_of_week - 1] || 'Unknown day')}</td><td>${esc(item.start_time.slice(0, 5))} – ${esc(item.end_time.slice(0, 5))}</td><td>${esc(item.subject?.name)}</td><td>${name(item.staff)}</td><td>${button('delete_timetable', item.id, 'Remove', true)}</td></tr>`)) : MGAEMS.emptyStateHTML('No timetable entries', 'Add lessons using the class’s offered learning areas.', 'calendar'));
  }

  async function ensureStaff() {
    const result = await MGAEMS.get('/api/v1/academic/staff-options');
    if (!result.ok) { MGAEMS.toast(result.error, 'error'); return false; }
    state.staff = result.data; return true;
  }
  function formModal(title, fields, onSave, trigger, note = '') {
    const modal = MGAEMS.openModal({ title, trigger, body: `<form id="academicForm"><div data-form-error></div>${note ? `<p class="text-muted">${note}</p>` : ''}<div class="form-grid">${fields}</div></form>`, footer: '<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="submit" form="academicForm" class="btn btn-primary" data-submit>Save</button>' });
    const form = modal.body.querySelector('form'); let submitting = false;
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (submitting || modal.overlay.querySelector('[data-submit]').disabled || !form.reportValidity()) return;
      submitting = true; modal.setBusy(true); modal.overlay.querySelector('[data-submit]').textContent = 'Saving…';
      const payload = Object.fromEntries(new FormData(form));
      Object.keys(payload).forEach(key => { payload[key] = payload[key].trim(); if (!payload[key]) payload[key] = null; });
      const result = await onSave(payload);
      modal.setBusy(false); submitting = false; modal.overlay.querySelector('[data-submit]').textContent = 'Save';
      if (!result.ok) { MGAEMS.showFormErrors(form, result); return; }
      modal.close(); MGAEMS.toast('Academic configuration saved.', 'success'); refresh();
    });
    return modal;
  }
  async function openEditor(key, item, trigger) {
    if ((key === 'years' || key === 'terms') ? !canCalendar : !canStructure) return;
    if (editorOpening) return;
    editorOpening = true;
    try {
      if (['classes', 'assignments', 'timetable'].includes(key) && !await ensureStaff()) return;
      let fields, note = '', path = '/api/v1/' + (endpoints[key] || (key === 'assignments' ? 'teacher-assignments' : 'timetable'));
      if (key === 'years' || key === 'terms') {
        if (key === 'terms' && !state.years?.length) { MGAEMS.toast('Configure an academic year first.', 'error'); return; }
        fields = (key === 'terms' ? select('academic_year_id', 'Academic year', options(state.years, item?.academic_year_id)) : '') + input('name', key === 'years' ? 'Year name' : 'Term name', item?.name, 'text', true, 'maxlength="20"') + input('start_date', 'Start date', item?.start_date?.slice(0, 10), 'date') + input('end_date', 'End date', item?.end_date?.slice(0, 10), 'date');
        note = key === 'terms' ? 'Term dates must fit within the owning year without overlapping sibling terms. Recorded historical term dates are protected.' : 'Dates must continue to contain all existing terms.';
      } else if (key === 'classes') {
        fields = input('name', 'Class / Grade name', item?.name, 'text', true, 'maxlength="30"') + select('level', 'Level', options([{ id: 'primary', name: 'Primary' }, { id: 'junior', name: 'Junior' }], item?.level)) + input('sequence', 'Display order', item?.sequence, 'number', true, 'min="1" max="255"') + input('capacity', 'Capacity', item?.capacity, 'number', false, 'min="1" max="500"');
        const teachers = [...state.staff];
        if (item?.class_teacher && !teachers.some(teacher => teacher.id === item.class_teacher.id)) teachers.push({ id: item.class_teacher.id, display_name: [item.class_teacher.first_name, item.class_teacher.last_name].join(' ') + ' (existing assignment)' });
        fields += select('class_teacher_id', 'Class teacher', options(teachers, item?.class_teacher_id, teacher => teacher.display_name, 'Unassigned'), false);
        note = 'The class teacher is responsible for the class. Subject-teacher allocations are managed separately.';
      } else if (key === 'subjects') {
        fields = input('name', 'Learning Area / Subject name', item?.name, 'text', true, 'maxlength="60"') + input('code', 'Code', item?.code, 'text', false, 'maxlength="20"') + input('learning_area', 'Category / grouping', item?.learning_area, 'text', false, 'maxlength="80"');
        note = 'Category/grouping is optional. The learning area/subject itself is used for teaching and assessment.';
      } else {
        if (!state.classes?.length || (key === 'assignments' && !state.terms?.length)) { MGAEMS.toast('Configure real classes and academic terms first.', 'error'); return; }
        fields = select('class_id', 'Class / Grade', options(state.classes, key === 'timetable' ? document.getElementById('timetableClass').value : '')) + select('subject_id', 'Offered learning area', '<option value="">Choose a class first</option>') + select('staff_id', 'Subject teacher', options(state.staff, '', teacher => teacher.display_name));
        if (key === 'assignments') fields += select('term_id', 'Term', options(state.terms, '', term => `${term.name} · ${term.academic_year?.name || ''}`));
        else fields += select('day_of_week', 'Day', options(days.map((title, index) => ({ id: index + 1, name: title })))) + input('start_time', 'Start time', '', 'time') + input('end_time', 'End time', '', 'time');
        note = 'Only active learning areas offered by the selected class and active teaching staff can be allocated or scheduled.';
      }
      const modal = formModal((item ? 'Edit ' : 'Add ') + sections.find(section => section[0] === key)[1], fields, payload => {
        if (item) {
          Object.keys(payload).forEach(field => { if (String(payload[field] ?? '') === String(item[field] ?? '').slice(0, ['start_date', 'end_date'].includes(field) ? 10 : undefined)) delete payload[field]; });
          delete payload.academic_year_id;
          return MGAEMS.patch(path + '/' + item.id, payload);
        }
        return MGAEMS.post(path, payload);
      }, trigger, note);
      if (key === 'terms' && item) modal.body.querySelector('[name="academic_year_id"]').disabled = true;
      if (key === 'assignments' || key === 'timetable') {
        const classControl = modal.body.querySelector('[name="class_id"]');
        const subjectControl = modal.body.querySelector('[name="subject_id"]');
        const retry = document.createElement('button');
        retry.type = 'button'; retry.className = 'btn btn-secondary btn-sm'; retry.textContent = 'Retry offerings'; retry.hidden = true;
        subjectControl.parentElement.appendChild(retry);
        const save = modal.overlay.querySelector('[data-submit]'); let sequence = 0;
        async function classOfferings() {
          const request = ++sequence; subjectControl.disabled = true; save.disabled = true;
          retry.hidden = true;
          modal.body.querySelector('[data-form-error]').innerHTML = '';
          if (!classControl.value) { subjectControl.innerHTML = '<option value="">Choose a class first</option>'; return; }
          const result = await MGAEMS.get('/api/v1/class-subjects?class_id=' + encodeURIComponent(classControl.value));
          if (request !== sequence || modal.closed) return;
          if (!result.ok) { retry.hidden = false; subjectControl.innerHTML = '<option value="">Offerings could not be loaded</option>'; MGAEMS.showFormErrors(modal.body.querySelector('form'), result); return; }
          const active = result.data.filter(subject => subject.status === 'active');
          subjectControl.innerHTML = options(active, '', subject => subject.name, active.length ? 'Select…' : 'No active offerings');
          subjectControl.disabled = !active.length; save.disabled = !active.length;
        }
        retry.addEventListener('click', classOfferings);
        classControl.addEventListener('change', classOfferings); classOfferings();
      }
    } finally { editorOpening = false; }
  }

  async function openOfferings(classItem, trigger) {
    const modal = MGAEMS.openModal({ title: `${classItem.name} · Offered learning areas`, trigger, body: MGAEMS.loadingHTML('Loading class offerings…') });
    let sequence = 0;
    async function renderOfferings() {
      const request = ++sequence;
      const [offered, subjects] = await Promise.all([MGAEMS.get('/api/v1/class-subjects?class_id=' + encodeURIComponent(classItem.id)), MGAEMS.get('/api/v1/subjects')]);
      if (request !== sequence || modal.closed) return;
      if (!offered.ok || !subjects.ok) { modal.body.innerHTML = MGAEMS.errorHTML(!offered.ok ? offered.error : subjects.error) + '<button type="button" class="btn btn-secondary" data-retry>Try again</button>'; modal.body.querySelector('[data-retry]').addEventListener('click', renderOfferings); MGAEMS.initIcons(); return; }
      const available = subjects.data.filter(subject => subject.status === 'active' && !offered.data.some(item => item.id === subject.id));
      modal.body.innerHTML = `<p class="text-muted">Offerings define what this class teaches. They are independent of subject-teacher allocations.</p>${offered.data.length ? table(['Learning area', 'Code', 'Status', 'Actions'], offered.data.map(subject => `<tr><td>${esc(subject.name)}</td><td>${esc(subject.code || '—')}</td><td>${esc(subject.status)}</td><td>${canStructure ? button('detach', subject.id, 'Remove offering', true) : ''}</td></tr>`)) : MGAEMS.emptyStateHTML('No offered learning areas', 'Configure offerings before allocating subject teachers or timetable lessons.', 'book-open')}${canStructure ? `<form id="offeringForm"><div data-form-error></div>${select('subject_id', 'Add active learning area', options(available, '', item => item.name, available.length ? 'Select…' : 'No additional active areas'))}<button type="submit" class="btn btn-primary btn-sm" ${available.length ? '' : 'disabled'}>Add offering</button></form>` : ''}`;
      if (canStructure) {
        const form = modal.body.querySelector('form'); let busy = false;
        form.addEventListener('submit', async event => {
          event.preventDefault(); if (busy || !form.reportValidity()) return;
          busy = true; modal.setBusy(true);
          const result = await MGAEMS.post('/api/v1/class-subjects', { class_id: classItem.id, subject_id: Number(form.elements.subject_id.value) });
          modal.setBusy(false); busy = false;
          if (!result.ok) { MGAEMS.showFormErrors(form, result); return; }
          MGAEMS.toast('Offering added.', 'success'); renderOfferings(); load('classes');
        });
        modal.body.querySelectorAll('[data-action="detach"]').forEach(control => control.addEventListener('click', async () => {
          if (busy) return;
          busy = true;
          if (!await MGAEMS.confirmAction('Remove class offering', 'Remove this unused learning area from this class? Dependencies and recorded history will block unsafe removal.', 'Remove offering')) { busy = false; return; }
          modal.setBusy(true);
          const result = await MGAEMS.del('/api/v1/class-subjects?' + new URLSearchParams({ class_id: classItem.id, subject_id: control.dataset.id }));
          modal.setBusy(false); busy = false;
          if (!result.ok) { MGAEMS.toast(result.error, 'error'); return; }
          MGAEMS.toast('Offering removed.', 'success'); renderOfferings(); load('classes');
        }));
      }
      MGAEMS.initIcons();
    }
    renderOfferings();
  }

  async function handleAction(action, id, control) {
    if (action === 'offerings') { const item = state.classes.find(item => String(item.id) === id); openOfferings(item, control); return; }
    const [operation, key] = action.split('_');
    if ((key === 'years' || key === 'terms') ? !canCalendar : !canStructure) return;
    const item = (state[key] || []).find(item => String(item.id) === id);
    if (operation === 'edit') { openEditor(key, item, control); return; }
    control.disabled = true;
    const path = '/api/v1/' + (endpoints[key] || (key === 'assignments' ? 'teacher-assignments' : 'timetable')) + '/' + encodeURIComponent(id);
    const title = operation === 'activate' ? 'Activate academic period' : operation === 'status' ? 'Change learning area status' : 'Remove academic record';
    const message = operation === 'activate' ? (key === 'terms' ? 'Activate this term and its owning academic year? Other current-period flags will be cleared.' : 'Activate this year? A current term from another year will be cleared.') : operation === 'status' ? (item.status === 'active' ? 'Retire this learning area? New offerings, allocations, and lessons will be blocked; existing records are retained.' : 'Reactivate this learning area for new academic configuration?') : 'Remove this unused academic record? Referenced learner, teaching, and assessment history will block unsafe deletion.';
    if (!await MGAEMS.confirmAction(title, message, operation === 'delete' ? 'Remove record' : 'Confirm')) { control.disabled = false; control.focus(); return; }
    const result = operation === 'activate' ? await MGAEMS.post(path + '/activate', {}) : operation === 'status' ? await MGAEMS.patch(path, { status: item.status === 'active' ? 'inactive' : 'active' }) : await MGAEMS.del(path);
    control.disabled = false;
    if (!result.ok) { MGAEMS.toast(Object.values(result.fields || {}).flat()[0] || result.error, 'error'); return; }
    MGAEMS.toast('Academic configuration updated.', 'success'); refresh();
  }
  async function refresh() {
    await Promise.all(['years', 'terms', 'classes', 'subjects'].map(load));
    if (canStructure) { loadAssignments(); loadTimetable(); }
    if (typeof loadShellContext === 'function') loadShellContext();
  }
  refresh(); MGAEMS.initIcons();
})();
