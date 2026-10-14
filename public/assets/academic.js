/* Academic configuration. Offerings, teacher allocations, and scheduling are distinct. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || MGAEMS.landingPage(user) !== '/dashboard.html') return;
  renderAppShell('/academic.html');
  const esc = MGAEMS.escapeHTML;
  const canStructure = ['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(user.role);
  const canCalendar = ['system_admin', 'head_teacher'].includes(user.role);
  const state = { years: null, terms: null, events: null, classes: null, subjects: null, assignments: null, staff: null, timetable: [], timetableRequest: 0, assignmentRequest: 0, requests: {}, searches: {}, statuses: {}, failures: {} };
  let editorOpening = false;
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const sections = [['years', 'Academic years'], ['terms', 'Terms'], ['events', 'Calendar events'], ['classes', 'Classes / Grades'], ['subjects', 'Learning Areas / Subjects'], ...(canStructure ? [['assignments', 'Subject teachers'], ['timetable', 'Timetable']] : [])];
  const endpoints = { years: 'academic-years', terms: 'terms', events: 'academic-events', classes: 'classes', subjects: 'subjects' };
  const main = document.getElementById('appMain');
  const button = (action, id, label, danger = false) => `<button type="button" class="btn ${danger ? 'btn-danger' : 'btn-secondary'} btn-sm" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
  const current = active => `<span class="badge ${active === true ? 'badge-green' : 'badge-gray'}">${active === true ? 'Active' : 'Inactive'}</span>`;
  const dateValue = value => {
    if (value == null || value === '') return '';
    const day = MGAEMS.schoolDate(value);
    const parsed = new Date(day + 'T12:00:00Z');
    return day && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : '';
  };
  const date = value => {
    const day = dateValue(value);
    if (!day) return 'Not available';
    const readable = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' }).format(new Date(day + 'T12:00:00Z'));
    return `<time datetime="${esc(day)}">${esc(readable)}</time>`;
  };
  const name = staff => staff ? esc([staff.first_name, staff.last_name].filter(Boolean).join(' ')) : 'Unassigned';
  const detail = (label, value) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
  const count = value => Number.isInteger(value) && value >= 0 ? String(value) : 'Not available';
  const group = (title, fields) => `<fieldset class="academic-form-group"><legend>${esc(title)}</legend><div class="form-grid">${fields}</div></fieldset>`;
  const options = (items, chosen = '', label = item => item.name, placeholder = 'Select…') => `<option value="">${placeholder}</option>` + items.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(chosen) ? 'selected' : ''}>${esc(label(item))}</option>`).join('');
  const input = (key, title, value = '', type = 'text', required = true, extra = '') => `<div class="field"><label for="academic_${key}">${title}${required ? ' *' : ''}</label><input id="academic_${key}" name="${key}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${extra}></div>`;
  const select = (key, title, content, required = true) => `<div class="field"><label for="academic_${key}">${title}${required ? ' *' : ''}</label><select id="academic_${key}" name="${key}" ${required ? 'required' : ''}>${content}</select></div>`;

  const notes = {
    years: 'Active marks the saved current year. Date ranges still determine which period is ready for school workflows.',
    terms: 'Each term belongs to an academic year. Activation and historical date protections remain controlled by the school calendar.',
    events: 'Dated school events and academic activities belong to an academic year and can optionally be linked to one of its terms.',
    classes: 'Class Teachers are responsible for a class. Offered learning areas and term-specific Subject Teachers are managed separately.',
    subjects: 'Assessable learning areas and subjects. Category / grouping is optional metadata; inactive areas remain available in historical records.',
    assignments: 'Subject Teachers are allocated to a class and learning area for a term. This does not change the Class Teacher.',
    timetable: 'Recurring weekly lessons, independent of academic terms. The server protects teachers and classes against overlapping bookings.',
  };
  function filters(key) {
    if (endpoints[key]) return `<div class="academic-toolbar"><div class="field"><label for="academicSearch_${key}">Search ${sections.find(item => item[0] === key)[1].toLowerCase()}</label><input type="search" id="academicSearch_${key}" data-search="${key}" placeholder="Search this directory…"></div>${['years', 'terms', 'subjects'].includes(key) ? `<div class="field"><label for="academicStatus_${key}">Status</label><select id="academicStatus_${key}" data-status="${key}"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>` : ''}</div>`;
    if (key === 'assignments') return '<div class="academic-toolbar"><div class="field"><label for="assignmentTerm">Term / academic year</label><select id="assignmentTerm"><option value="">All terms</option></select></div><div class="field"><label for="assignmentClass">Class</label><select id="assignmentClass"><option value="">All classes</option></select></div></div>';
    return '<div class="academic-toolbar"><div class="field"><label for="timetableClass">Class / Grade</label><select id="timetableClass"><option value="">Select a class…</option></select></div></div>';
  }
  main.setAttribute('class', 'app-main academic-workspace');
  main.innerHTML = `<div class="page-heading academic-heading"><span class="eyebrow">School academics</span><h1>Academic Management</h1><p>Manage the school calendar, inspect class offerings and make teaching responsibilities clear.</p></div>
    <div class="academic-summary" id="academicSummary" aria-busy="true"><div class="academic-summary-item">${MGAEMS.loadingHTML('Loading current periods…')}</div></div>
    <div class="tabs academic-tabs" role="tablist" aria-label="Academic Management sections">${sections.map(([key, title], index) => `<button type="button" class="tab ${index === 0 ? 'active' : ''}" id="academicTab_${key}" role="tab" aria-selected="${index === 0}" aria-controls="academicPanel_${key}" tabindex="${index === 0 ? 0 : -1}" data-tab="${key}">${title}</button>`).join('')}</div>
    ${sections.map(([key, title], index) => `<section class="tab-panel ${index === 0 ? 'active' : ''}" id="academicPanel_${key}" role="tabpanel" aria-labelledby="academicTab_${key}" ${index ? 'hidden' : ''}>
      <div class="academic-panel-heading"><div><h2>${title}</h2><p class="academic-section-note">${esc(notes[key])}</p></div>${(['years', 'terms', 'events'].includes(key) ? canCalendar : canStructure) ? `<button type="button" class="btn btn-primary btn-sm" id="add_${key}" data-add="${key}" disabled><i data-lucide="plus" aria-hidden="true"></i>Add ${key === 'years' ? 'year' : key === 'terms' ? 'term' : key === 'events' ? 'event' : key === 'classes' ? 'class' : key === 'subjects' ? 'learning area' : key === 'assignments' ? 'subject teacher' : 'timetable entry'}</button>` : ''}</div>
      ${filters(key)}<p class="academic-result-count" id="academicCount_${key}" role="status"></p>
      <div id="academicData_${key}" aria-busy="true">${MGAEMS.loadingHTML('Loading ' + title.toLowerCase() + '…')}</div></section>`).join('')}`;

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
  main.querySelectorAll('[data-search]').forEach(control => control.addEventListener('input', () => { state.searches[control.dataset.search] = control.value.trim().toLowerCase(); if (state[control.dataset.search]) render(control.dataset.search); }));
  main.querySelectorAll('[data-status]').forEach(control => control.addEventListener('change', () => { state.statuses[control.dataset.status] = control.value; if (state[control.dataset.status]) render(control.dataset.status); }));
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
    document.getElementById('academicCount_' + key).textContent = '';
    if ([401, 403].includes(result.status)) { showData(key, MGAEMS.emptyStateHTML(result.status === 401 ? 'Session expired' : 'Access restricted', result.status === 401 ? 'Sign in again to continue.' : 'Your account does not have permission to view this section.', 'lock-keyhole')); return; }
    showData(key, `<div class="state-panel">${MGAEMS.errorHTML(result.error || 'The academic data could not be loaded.')}<button type="button" class="btn btn-secondary btn-sm" data-retry aria-label="Retry ${esc(key)}">Try again</button></div>`);
    document.getElementById('academicData_' + key).querySelector('[data-retry]').addEventListener('click', retry);
  }
  function renderSummary() {
    const target = document.getElementById('academicSummary');
    const period = state.years ? MGAEMS.academicPeriod(state.years, state.terms || []) : {};
    const periodCard = (label, record, key) => `<div class="academic-summary-item"><dl>${detail(label, esc(record?.name || (state.failures[key] || (key === 'terms' && state.failures.years) ? 'Unavailable' : state[key] === null || (key === 'terms' && state.years === null) ? 'Loading…' : 'No current period')))}</dl><p>${record ? date(record.start_date) + ' to ' + date(record.end_date) : 'Current workflow context requires a selected period with valid dates.'}</p></div>`;
    target.innerHTML = periodCard('Current academic year', period.year, 'years') + periodCard('Current term', period.term, 'terms') + '<div class="academic-summary-item"><dl><dt>Teaching responsibilities</dt><dd>Class Teacher / Subject Teacher</dd></dl><p>Class ownership and term-specific subject allocations remain separate.</p></div>';
    target.setAttribute('aria-busy', String((state.years === null && !state.failures.years) || (state.terms === null && !state.failures.terms)));
  }
  function syncSelectors() {
    function populate(id, items, placeholder, label = item => item.name) {
      const control = document.getElementById(id); if (!control || !items) return;
      const previous = control.value; control.innerHTML = options(items, previous, label, placeholder);
    }
    populate('assignmentTerm', state.terms, 'All terms', term => `${term.name} · ${term.academic_year?.name || ''}`);
    populate('assignmentClass', state.classes, 'All classes'); populate('timetableClass', state.classes, 'Select a class…');
    ['years', 'terms', 'events', 'classes', 'subjects', 'assignments', 'timetable'].forEach(key => {
      const control = document.getElementById('add_' + key); if (!control) return;
      control.disabled = key === 'terms' || key === 'events' ? !state.years?.length : key === 'assignments' ? !state.classes?.length || !state.subjects || !state.terms?.length : key === 'timetable' ? !state.classes?.length || !document.getElementById('timetableClass').value : !state[key];
    });
  }
  async function load(key) {
    const sequence = state.requests[key] = (state.requests[key] || 0) + 1;
    const target = document.getElementById('academicData_' + key); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading academic data…');
    document.getElementById('academicCount_' + key).textContent = '';
    const result = await MGAEMS.get('/api/v1/' + endpoints[key]);
    if (sequence !== state.requests[key]) return;
    if (!result.ok || !Array.isArray(result.data) || result.data.some(item => !item || typeof item !== 'object')) { state[key] = null; state.failures[key] = true; syncSelectors(); renderSummary(); failure(key, result, () => load(key)); return; }
    delete state.failures[key]; state[key] = result.data; render(key); syncSelectors(); renderSummary();
  }
  function render(key) {
    const all = state[key];
    const query = state.searches[key] || '';
    const status = state.statuses[key] || '';
    const searchable = item => key === 'classes' ? [item.name, item.level, item.class_teacher?.first_name, item.class_teacher?.last_name] : key === 'subjects' ? [item.name, item.code, item.learning_area] : key === 'events' ? [item.title, item.description, item.event_type, item.academic_year?.name, item.term?.name, dateValue(item.starts_on), dateValue(item.ends_on)] : [item.name, item.academic_year?.name, dateValue(item.start_date), dateValue(item.end_date)];
    const items = all.filter(item => (!query || searchable(item).filter(Boolean).join(' ').toLowerCase().includes(query)) && (!status || (key === 'subjects' ? item.status : item.is_current === true ? 'active' : 'inactive') === status));
    document.getElementById('academicCount_' + key).textContent = `${items.length} of ${all.length} records`;
    if (!items.length) { showData(key, MGAEMS.emptyStateHTML(all.length ? 'No matching records' : 'No ' + sections.find(item => item[0] === key)[1].toLowerCase() + ' configured', all.length ? 'Try another search or status filter.' : 'School configuration will appear here when it is available.', 'book-open')); return; }
    let cards;
    if (key === 'years') {
      cards = items.map(item => `<article class="academic-record-card"><div class="academic-record-title"><h3>${esc(item.name)}</h3>${current(item.is_current)}</div><dl class="academic-record-meta">${detail('Start date', date(item.start_date))}${detail('End date', date(item.end_date))}</dl>${canCalendar ? `<div class="academic-card-actions">${button('edit_years', item.id, 'Edit year')}${!item.is_current ? button('activate_years', item.id, 'Activate') + button('delete_years', item.id, 'Delete', true) : ''}</div>` : ''}</article>`);
    } else if (key === 'terms') {
      cards = items.map(item => `<article class="academic-record-card"><div class="academic-record-title"><h3>${esc(item.name)}</h3>${current(item.is_current)}</div><dl class="academic-record-meta">${detail('Academic year', esc(item.academic_year?.name || 'Not available'))}${detail('Start date', date(item.start_date))}${detail('End date', date(item.end_date))}</dl>${canCalendar ? `<div class="academic-card-actions">${button('edit_terms', item.id, 'Edit term')}${!item.is_current ? button('activate_terms', item.id, 'Activate') + button('delete_terms', item.id, 'Delete', true) : ''}</div>` : ''}</article>`);
    } else if (key === 'events') {
      const labels = { academic_activity: 'Academic activity', assessment: 'Assessment', meeting: 'Meeting', closure: 'Closure', school_event: 'School event' };
      cards = items.map(item => `<article class="academic-record-card"><div class="academic-record-title"><h3>${esc(item.title)}</h3><span class="badge badge-navy">${esc(labels[item.event_type] || 'School event')}</span></div><dl class="academic-record-meta">${detail('Date', date(item.starts_on) + (dateValue(item.starts_on) === dateValue(item.ends_on) ? '' : ' to ' + date(item.ends_on)))}${detail('Academic year', esc(item.academic_year?.name || 'Not available'))}${detail('Term', esc(item.term?.name || 'All-year event'))}${item.description ? detail('Details', esc(item.description)) : ''}</dl>${canCalendar ? `<div class="academic-card-actions">${button('edit_events', item.id, 'Edit event')}${button('delete_events', item.id, 'Delete', true)}</div>` : ''}</article>`);
    } else if (key === 'classes') {
      cards = items.map(item => `<article class="academic-record-card"><div class="academic-record-title"><h3>${esc(item.name)}</h3><span class="badge badge-navy">${esc(({ primary: 'Primary', junior: 'Junior' })[item.level] || item.level || 'Not available')}</span></div><dl class="academic-record-meta">${detail('Capacity', item.capacity === null ? 'Not set' : count(item.capacity))}${detail('Learner count', count(item.students_count))}${detail('Class Teacher', Object.hasOwn(item, 'class_teacher') ? name(item.class_teacher) : 'Not available')}${detail('Subject offerings', count(item.subjects_count))}${detail('Display order', count(item.sequence))}</dl><div class="academic-card-actions">${button('offerings', item.id, canStructure ? 'Manage offerings' : 'View offerings')}${canStructure ? button('edit_classes', item.id, 'Edit class') + button('delete_classes', item.id, 'Delete', true) : ''}</div></article>`);
    } else {
      cards = items.map(item => `<article class="academic-record-card"><div class="academic-record-title"><h3>${esc(item.name)}</h3><span class="badge ${item.status === 'active' ? 'badge-green' : 'badge-gray'}">${esc(item.status === 'active' ? 'Active' : item.status === 'inactive' ? 'Inactive' : 'Not available')}</span></div><dl class="academic-record-meta">${detail('Code', esc(item.code || 'Not set'))}${detail('Category / grouping', esc(item.learning_area || 'Not set'))}</dl>${canStructure ? `<div class="academic-card-actions">${button('edit_subjects', item.id, 'Edit learning area')}${button('status_subjects', item.id, item.status === 'active' ? 'Retire' : 'Reactivate')}${button('delete_subjects', item.id, 'Delete', true)}</div>` : ''}</article>`);
    }
    showData(key, `<div class="academic-record-grid">${cards.join('')}</div>`);
  }
  async function loadAssignments() {
    const sequence = ++state.assignmentRequest;
    document.getElementById('academicCount_assignments').textContent = '';
    const params = new URLSearchParams();
    if (document.getElementById('assignmentTerm').value) params.set('term_id', document.getElementById('assignmentTerm').value);
    if (document.getElementById('assignmentClass').value) params.set('class_id', document.getElementById('assignmentClass').value);
    const target = document.getElementById('academicData_assignments'); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading subject teachers…');
    const result = await MGAEMS.get('/api/v1/teacher-assignments?' + params);
    if (sequence !== state.assignmentRequest) return;
    if (!result.ok || !Array.isArray(result.data) || result.data.some(item => !item || typeof item !== 'object')) { state.assignments = null; failure('assignments', result, loadAssignments); return; }
    state.assignments = result.data;
    document.getElementById('academicCount_assignments').textContent = `${result.data.length} assignments for these filters`;
    showData('assignments', result.data.length ? `<div class="academic-record-grid">${result.data.map(item => `<article class="academic-record-card"><div class="academic-record-title"><h3>${esc(item.subject?.name || 'Learning area unavailable')}</h3><span class="badge badge-navy">Subject Teacher</span></div><dl class="academic-record-meta">${detail('Class', esc(item.school_class?.name || 'Not available'))}${detail('Subject Teacher', name(item.staff))}${detail('Term', esc(item.term?.name || 'Not available'))}${detail('Academic year', esc(item.term?.academic_year?.name || 'Not available'))}</dl><div class="academic-card-actions">${button('delete_assignments', item.id, 'Remove assignment', true)}</div></article>`).join('')}</div>` : MGAEMS.emptyStateHTML('No subject teachers match', 'Choose another filter or allocate an offered learning area to an eligible teacher for a term.', 'user-check'));
  }
  async function loadTimetable() {
    const sequence = ++state.timetableRequest;
    document.getElementById('academicCount_timetable').textContent = '';
    const id = document.getElementById('timetableClass').value; syncSelectors();
    if (!id) { state.timetable = []; showData('timetable', MGAEMS.emptyStateHTML('Select a class', 'Choose a configured class to view its recurring timetable.', 'calendar')); return; }
    const target = document.getElementById('academicData_timetable'); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading timetable…');
    const result = await MGAEMS.get('/api/v1/timetable/by-class?class_id=' + encodeURIComponent(id));
    if (sequence !== state.timetableRequest) return;
    const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
    if (!result.ok || !Array.isArray(result.data) || result.data.some(item => !item || !Number.isInteger(item.day_of_week) || item.day_of_week < 1 || item.day_of_week > 7 || !validTime(item.start_time) || !validTime(item.end_time) || item.end_time.slice(0, 5) <= item.start_time.slice(0, 5) || (item.class_id != null && String(item.class_id) !== String(id)))) { state.timetable = []; failure('timetable', result, loadTimetable); return; }
    state.timetable = result.data;
    const className = state.classes?.find(item => String(item.id) === String(id))?.name || 'Class unavailable';
    const entries = [...result.data].sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time) || Number(a.id) - Number(b.id));
    document.getElementById('academicCount_timetable').textContent = `${entries.length} recurring lessons · ${className}`;
    const week = days.map((day, index) => {
      const lessons = entries.filter(item => item.day_of_week === index + 1);
      if (!lessons.length) return '';
      return `<section class="academic-day"><div class="academic-day-heading"><h3>${day}</h3><span class="badge badge-gray">${lessons.length} ${lessons.length === 1 ? 'lesson' : 'lessons'}</span></div><ul>${lessons.map(item => `<li class="academic-lesson"><span class="academic-time-range"><time>${esc(item.start_time.slice(0, 5))}</time> – <time>${esc(item.end_time.slice(0, 5))}</time></span><h4>${esc(item.subject?.name || 'Learning area unavailable')}</h4><dl class="academic-record-meta">${detail('Class', esc(item.school_class?.name || className))}${detail('Assigned teacher', name(item.staff))}${detail('Start time', esc(item.start_time.slice(0, 5)))}${detail('End time', esc(item.end_time.slice(0, 5)))}</dl><div class="academic-card-actions">${button('delete_timetable', item.id, 'Remove lesson', true)}</div></li>`).join('')}</ul></section>`;
    }).join('');
    showData('timetable', entries.length ? `<div class="academic-week-grid">${week}</div>` : MGAEMS.emptyStateHTML('No timetable entries', 'This class has no recurring lessons. Add a lesson using its offered learning areas.', 'calendar'));
  }

  async function ensureStaff() {
    const result = await MGAEMS.get('/api/v1/academic/staff-options');
    if (!result.ok || !Array.isArray(result.data) || result.data.some(item => !item || typeof item !== 'object')) { MGAEMS.toast(result.error || 'Teaching staff options could not be loaded.', 'error'); return false; }
    state.staff = result.data; return true;
  }
  function formModal(title, fields, onSave, trigger, note = '', validate = () => ({})) {
    const modal = MGAEMS.openModal({ title, trigger, body: `<form class="academic-dialog" id="academicForm"><div data-form-error></div>${note ? `<p class="academic-form-note" id="academicFormNote">${esc(note)}</p>` : ''}<p class="academic-form-note">Fields marked * are required.</p>${fields}</form>`, footer: '<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="submit" form="academicForm" class="btn btn-primary" data-submit>Save</button>' });
    modal.overlay.classList?.toggle('academic-dialog', true);
    const form = modal.body.querySelector('form'); let submitting = false;
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (submitting || modal.overlay.querySelector('[data-submit]').disabled || !form.reportValidity()) return;
      const payload = Object.fromEntries(new FormData(form));
      Object.keys(payload).forEach(key => { payload[key] = payload[key].trim(); if (!payload[key]) payload[key] = null; });
      const fields = validate(payload);
      if (Object.keys(fields).length) { MGAEMS.showFormErrors(form, { error: 'Please check the highlighted fields.', fields }); return; }
      const controls = [...form.elements].filter(control => ['INPUT', 'SELECT', 'TEXTAREA'].includes(String(control.tagName || control.tag).toUpperCase())).map(control => [control, control.disabled]);
      submitting = true; modal.setBusy(true); form.setAttribute('aria-busy', 'true'); modal.overlay.querySelector('[data-submit]').textContent = 'Saving…';
      controls.forEach(([control]) => { control.disabled = true; });
      let result;
      try { result = await onSave(payload); }
      catch { result = { ok: false, error: 'Could not save the academic configuration. Please try again.' }; }
      controls.forEach(([control, disabled]) => { control.disabled = disabled; });
      form.setAttribute('aria-busy', 'false'); modal.setBusy(false); submitting = false; modal.overlay.querySelector('[data-submit]').textContent = 'Save';
      if (!result.ok) { MGAEMS.showFormErrors(form, result); return; }
      modal.close(); MGAEMS.toast('Academic configuration saved.', 'success'); refresh();
    });
    return modal;
  }
  async function openEditor(key, item, trigger) {
    if (['years', 'terms', 'events'].includes(key) ? !canCalendar : !canStructure) return;
    if (editorOpening) return;
    editorOpening = true;
    try {
      if (['classes', 'assignments', 'timetable'].includes(key) && !await ensureStaff()) return;
      let fields, note = '', path = '/api/v1/' + (endpoints[key] || (key === 'assignments' ? 'teacher-assignments' : 'timetable'));
      if (key === 'years' || key === 'terms') {
        if (key === 'terms' && !state.years?.length) { MGAEMS.toast('Configure an academic year first.', 'error'); return; }
        fields = group('Period details', (key === 'terms' ? select('academic_year_id', 'Academic year', options(state.years, item?.academic_year_id, year => `${year.name} · ${dateValue(year.start_date)} to ${dateValue(year.end_date)}`)) : '') + input('name', key === 'years' ? 'Year name' : 'Term name', item?.name, 'text', true, 'maxlength="20"')) + group('Date range', input('start_date', 'Start date', dateValue(item?.start_date), 'date') + input('end_date', 'End date', dateValue(item?.end_date), 'date'));
        note = key === 'terms' ? 'Term dates must fit within the owning year without overlapping sibling terms. Recorded historical term dates are protected.' : 'Dates must continue to contain all existing terms.';
      } else if (key === 'events') {
        if (!state.years?.length) { MGAEMS.toast('Configure an academic year first.', 'error'); return; }
        const types = [{ id: 'academic_activity', name: 'Academic activity' }, { id: 'assessment', name: 'Assessment' }, { id: 'meeting', name: 'Meeting' }, { id: 'closure', name: 'Closure' }, { id: 'school_event', name: 'School event' }];
        fields = group('Event details', input('title', 'Event title', item?.title, 'text', true, 'maxlength="160"') + select('event_type', 'Event type', options(types, item?.event_type)) + select('academic_year_id', 'Academic year', options(state.years, item?.academic_year_id, year => year.name)) + select('term_id', 'Term context', options(state.terms || [], item?.term_id, term => `${term.name} · ${term.academic_year?.name || ''}`, 'No specific term'), false)) + group('Date range', input('starts_on', 'Start date', dateValue(item?.starts_on), 'date') + input('ends_on', 'End date', dateValue(item?.ends_on), 'date')) + group('Additional details', '<div class="field full"><label for="academic_description">Details</label><textarea id="academic_description" name="description" maxlength="4000">' + esc(item?.description || '') + '</textarea></div>');
        note = 'Events are dated school activities. This form does not create recurring timetable lessons or verify curriculum content.';
      } else if (key === 'classes') {
        fields = group('Class details', input('name', 'Class / Grade name', item?.name, 'text', true, 'maxlength="30"') + select('level', 'Level', options([{ id: 'primary', name: 'Primary' }, { id: 'junior', name: 'Junior' }], item?.level)) + input('sequence', 'Display order', item?.sequence, 'number', true, 'min="1" max="255" step="1"') + input('capacity', 'Capacity', item?.capacity, 'number', false, 'min="1" max="500" step="1"'));
        const teachers = [...state.staff];
        if (item?.class_teacher && !teachers.some(teacher => teacher.id === item.class_teacher.id)) teachers.push({ id: item.class_teacher.id, display_name: [item.class_teacher.first_name, item.class_teacher.last_name].join(' ') + ' (existing assignment)' });
        fields += group('Class Teacher responsibility', select('class_teacher_id', 'Class Teacher', options(teachers, item?.class_teacher_id, teacher => teacher.display_name, 'Unassigned'), false));
        note = 'The class teacher is responsible for the class. Subject-teacher allocations are managed separately.';
      } else if (key === 'subjects') {
        fields = group('Learning area details', input('name', 'Learning Area / Subject name', item?.name, 'text', true, 'maxlength="60"') + input('code', 'Code', item?.code, 'text', false, 'maxlength="20"') + input('learning_area', 'Category / grouping', item?.learning_area, 'text', false, 'maxlength="80"'));
        note = 'Category/grouping is optional. The learning area/subject itself is used for teaching and assessment.';
      } else {
        if (!state.classes?.length || (key === 'assignments' && !state.terms?.length)) { MGAEMS.toast('Configure real classes and academic terms first.', 'error'); return; }
        fields = group('Teaching responsibility', select('class_id', 'Class / Grade', options(state.classes, key === 'timetable' ? document.getElementById('timetableClass').value : document.getElementById('assignmentClass').value)) + select('subject_id', 'Offered learning area', '<option value="">Choose a class first</option>') + select('staff_id', key === 'assignments' ? 'Subject Teacher' : 'Assigned teacher', options(state.staff, '', teacher => teacher.display_name)));
        if (key === 'assignments') fields += group('Academic term', select('term_id', 'Term / academic year', options(state.terms, document.getElementById('assignmentTerm').value, term => `${term.name} · ${term.academic_year?.name || ''}`)));
        else fields += group('Recurring weekly lesson', select('day_of_week', 'Day', options(days.map((title, index) => ({ id: index + 1, name: title })))) + input('start_time', 'Start time', '', 'time') + input('end_time', 'End time', '', 'time'));
        note = key === 'assignments' ? 'Assign an active teaching staff member to an offered learning area for this term. Class Teacher responsibility stays unchanged.' : 'This lesson recurs weekly, independently of terms. Only active offered learning areas and active teaching staff can be scheduled. Teacher and class overlaps are checked by the server.';
      }
      const modal = formModal((item ? 'Edit ' : 'Add ') + sections.find(section => section[0] === key)[1], fields, payload => {
        if (item) {
          Object.keys(payload).forEach(field => { if (String(payload[field] ?? '') === (['start_date', 'end_date'].includes(field) ? dateValue(item[field]) : String(item[field] ?? ''))) delete payload[field]; });
          delete payload.academic_year_id;
          return MGAEMS.patch(path + '/' + item.id, payload);
        }
        return MGAEMS.post(path, payload);
      }, trigger, note, payload => {
        const fields = {};
        if (['years', 'terms'].includes(key)) {
          if (payload.start_date > payload.end_date) fields.end_date = ['The end date must be on or after the start date.'];
          if (key === 'terms') {
            const year = state.years?.find(year => String(year.id) === String(item?.academic_year_id || payload.academic_year_id));
            if (year && (payload.start_date < dateValue(year.start_date) || payload.end_date > dateValue(year.end_date))) fields.start_date = ['Term dates must fall within their academic year.'];
          }
        }
        if (key === 'events' && payload.starts_on > payload.ends_on) fields.ends_on = ['The end date must be on or after the start date.'];
        if (key === 'events') {
          const term = state.terms?.find(term => String(term.id) === String(payload.term_id));
          if (term && String(term.academic_year_id) !== String(payload.academic_year_id)) fields.term_id = ['Choose a term from the selected academic year.'];
        }
        if (key === 'timetable' && payload.end_time <= payload.start_time) fields.end_time = ['The end time must be after the start time.'];
        return fields;
      });
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
          if (!result.ok || !Array.isArray(result.data) || result.data.some(item => !item || typeof item !== 'object')) { retry.hidden = false; subjectControl.innerHTML = '<option value="">Offerings could not be loaded</option>'; MGAEMS.showFormErrors(modal.body.querySelector('form'), { ...result, error: result.error || 'Offerings could not be loaded.' }); return; }
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
    modal.overlay.classList?.toggle('academic-dialog', true);
    let sequence = 0;
    async function renderOfferings() {
      const request = ++sequence;
      const [offered, subjects] = await Promise.all([MGAEMS.get('/api/v1/class-subjects?class_id=' + encodeURIComponent(classItem.id)), MGAEMS.get('/api/v1/subjects')]);
      if (request !== sequence || modal.closed) return;
      if (!offered.ok || !subjects.ok || !Array.isArray(offered.data) || !Array.isArray(subjects.data) || [...offered.data, ...subjects.data].some(item => !item || typeof item !== 'object')) { modal.body.innerHTML = MGAEMS.errorHTML((!offered.ok ? offered.error : !subjects.ok ? subjects.error : null) || 'The learning area offerings could not be loaded.') + '<button type="button" class="btn btn-secondary" data-retry>Try again</button>'; modal.body.querySelector('[data-retry]').addEventListener('click', renderOfferings); MGAEMS.initIcons(); return; }
      const available = subjects.data.filter(subject => subject.status === 'active' && !offered.data.some(item => item.id === subject.id));
      modal.body.innerHTML = `<p class="academic-dialog-context"><strong>${esc(classItem.name)}</strong> · Offerings define what this class teaches. They are independent of term-specific Subject Teacher allocations.</p><p class="academic-result-count">${offered.data.length} offered learning areas</p>${offered.data.length ? `<div class="academic-record-grid">${offered.data.map(subject => `<article class="academic-record-card"><div class="academic-record-title"><h3>${esc(subject.name)}</h3><span class="badge ${subject.status === 'active' ? 'badge-green' : 'badge-gray'}">${esc(subject.status === 'active' ? 'Active' : subject.status === 'inactive' ? 'Inactive' : 'Not available')}</span></div><dl class="academic-record-meta">${detail('Code', esc(subject.code || 'Not set'))}${detail('Category / grouping', esc(subject.learning_area || 'Not set'))}</dl>${canStructure ? `<div class="academic-card-actions">${button('detach', subject.id, 'Remove offering', true)}</div>` : ''}</article>`).join('')}</div>` : MGAEMS.emptyStateHTML('No offered learning areas', 'Configure offerings before allocating subject teachers or recurring timetable lessons.', 'book-open')}${canStructure ? `<form class="academic-dialog" id="offeringForm"><div data-form-error></div>${group('Add an offering', select('subject_id', 'Active learning area', options(available, '', item => `${item.name}${item.code ? ' · ' + item.code : ''}`, available.length ? 'Select…' : 'No additional active areas')))}<p class="academic-form-note">Only active learning areas can be added. Existing teaching or assessment dependencies can block removal.</p><button type="submit" class="btn btn-primary btn-sm" ${available.length ? '' : 'disabled'}>Add offering</button></form>` : ''}`;
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
    if (action === 'offerings') { const item = state.classes?.find(item => String(item.id) === id); if (item) openOfferings(item, control); return; }
    const [operation, key] = action.split('_');
    if (['years', 'terms', 'events'].includes(key) ? !canCalendar : !canStructure) return;
    const item = (state[key] || []).find(item => String(item.id) === id);
    if (!item) return;
    if (operation === 'edit') { openEditor(key, item, control); return; }
    control.disabled = true;
    const path = '/api/v1/' + (endpoints[key] || (key === 'assignments' ? 'teacher-assignments' : 'timetable')) + '/' + encodeURIComponent(id);
    const title = operation === 'activate' ? 'Activate academic period' : operation === 'status' ? 'Change learning area status' : 'Remove academic record';
    const message = operation === 'activate' ? (key === 'terms' ? 'Activate this term and its owning academic year? Other current-period flags will be cleared.' : 'Activate this year? A current term from another year will be cleared.') : operation === 'status' ? (item.status === 'active' ? 'Retire this learning area? New offerings, allocations, and lessons will be blocked; existing records are retained.' : 'Reactivate this learning area for new academic configuration?') : key === 'events' ? 'Delete this calendar event? This does not change academic years, terms, or timetable lessons.' : 'Remove this unused academic record? Referenced learner, teaching, and assessment history will block unsafe deletion.';
    if (!await MGAEMS.confirmAction(title, message, operation === 'delete' ? 'Remove record' : 'Confirm')) { control.disabled = false; control.focus(); return; }
    const result = operation === 'activate' ? await MGAEMS.post(path + '/activate', {}) : operation === 'status' ? await MGAEMS.patch(path, { status: item.status === 'active' ? 'inactive' : 'active' }) : await MGAEMS.del(path);
    control.disabled = false;
    if (!result.ok) { MGAEMS.toast(Object.values(result.fields || {}).flat()[0] || result.error, 'error'); return; }
    MGAEMS.toast('Academic configuration updated.', 'success'); refresh();
  }
  async function refresh() {
    await Promise.all(['years', 'terms', 'events', 'classes', 'subjects'].map(load));
    if (canStructure) { loadAssignments(); loadTimetable(); }
    if (typeof loadShellContext === 'function') loadShellContext();
  }
  refresh(); MGAEMS.initIcons();
})();
