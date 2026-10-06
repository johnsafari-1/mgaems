/* Guardian contacts and optional Parent Portal accounts remain distinct. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || MGAEMS.landingPage(user) !== '/dashboard.html') return;
  if (!['system_admin', 'head_teacher', 'deputy_head_teacher'].includes(user.role)) { window.location.href = '/dashboard.html'; return; }
  renderAppShell('/guardians.html');
  const esc = MGAEMS.escapeHTML;
  const main = document.getElementById('appMain');
  const linkedId = new URLSearchParams(window.location.search).get('student_id');
  const state = { page: 1, request: 0, search: '', timer: null, studentId: /^\d+$/.test(linkedId || '') && Number(linkedId) > 0 ? linkedId : null };
  main.innerHTML = `<div class="section-header"><div><h1>Parents / Guardians</h1><p class="text-muted">Manage contact records, learner links, and optional Parent Portal access.</p></div><button type="button" class="btn btn-primary" id="addGuardianBtn"><i data-lucide="user-round-plus" aria-hidden="true"></i> Add guardian</button></div>
    ${state.studentId ? '<div class="selection-summary" id="guardianFilter">Showing guardians linked to the selected learner. <button type="button" class="btn btn-secondary btn-sm" id="clearLearnerFilter">Show all guardians</button></div>' : ''}
    <div class="card"><div class="toolbar"><div class="search-input"><label class="sr-only" for="guardianSearch">Search guardians</label><i data-lucide="search" aria-hidden="true"></i><input type="search" id="guardianSearch" maxlength="150" placeholder="Guardian, contact, learner, or admission number"></div></div><div id="guardiansTable" aria-busy="true">${MGAEMS.loadingHTML('Loading guardians…')}</div><div class="pagination" id="guardianPagination" hidden></div></div>`;
  document.getElementById('addGuardianBtn').addEventListener('click', event => openGuardianForm(null, event.currentTarget));
  document.getElementById('guardianSearch').addEventListener('input', event => {
    state.page = 1; state.search = event.target.value.trim(); state.request++; clearTimeout(state.timer);
    state.timer = setTimeout(loadGuardians, 300);
  });
  document.getElementById('clearLearnerFilter')?.addEventListener('click', () => { state.studentId = null; state.page = 1; document.getElementById('guardianFilter').remove(); window.history.replaceState(null, '', '/guardians.html'); loadGuardians(); });

  function pagination(target, meta, change) {
    const pages = Math.max(1, Math.ceil(meta.total / meta.per_page));
    target.hidden = meta.total === 0;
    target.innerHTML = `<span>Page ${esc(meta.page)} of ${esc(pages)} · ${esc(meta.total)} records</span><div class="flex gap-2"><button type="button" class="btn btn-secondary btn-sm" data-page="-1" ${meta.page <= 1 ? 'disabled' : ''}>Previous</button><button type="button" class="btn btn-secondary btn-sm" data-page="1" ${meta.page >= pages ? 'disabled' : ''}>Next</button></div>`;
    target.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => change(Number(meta.page) + Number(button.dataset.page))));
  }

  async function loadGuardians() {
    const sequence = ++state.request;
    const wrap = document.getElementById('guardiansTable');
    const pages = document.getElementById('guardianPagination');
    wrap.setAttribute('aria-busy', 'true'); pages.hidden = true; wrap.innerHTML = MGAEMS.loadingHTML('Loading guardians…');
    const params = new URLSearchParams({ page: state.page, per_page: 20 });
    if (state.search) params.set('search', state.search);
    if (state.studentId) params.set('student_id', state.studentId);
    const result = await MGAEMS.get('/api/v1/guardians?' + params);
    if (sequence !== state.request) return;
    wrap.setAttribute('aria-busy', 'false');
    if (!result.ok) {
      wrap.innerHTML = MGAEMS.errorHTML(result.error) + '<button type="button" class="btn btn-secondary btn-sm">Try again</button>';
      wrap.querySelector('button').addEventListener('click', loadGuardians);
    } else {
      const totalPages = Math.max(1, Math.ceil(result.meta.total / result.meta.per_page));
      if (state.page > totalPages) { state.page = totalPages; loadGuardians(); return; }
      if (!result.data.length) wrap.innerHTML = MGAEMS.emptyStateHTML(state.search || state.studentId ? 'No matching guardians' : 'No guardian contacts recorded', 'Add a contact and explicitly link one or more learners.', 'contact-round');
      else {
        wrap.innerHTML = `<div class="table-scroll"><table><caption class="sr-only">Guardian contacts and learner relationships</caption><thead><tr><th scope="col">Contact</th><th scope="col">Linked learners</th><th scope="col">Portal access</th><th scope="col">Actions</th></tr></thead><tbody>${result.data.map(guardian => `<tr><td><strong>${esc(guardian.full_name)}</strong><span class="text-meta">${esc(guardian.relationship)}</span><span class="text-meta">${esc(guardian.phone)}${guardian.email ? ' · ' + esc(guardian.email) : ''}</span></td><td>${guardian.students.map(student => `<div class="record-item"><div><a href="/students.html?student_id=${encodeURIComponent(student.id)}">${esc(student.name)}</a><span class="text-meta">${esc(student.admission_no)} · ${esc(student.class || 'No class')}</span><span class="text-meta">${esc(student.relationship)}${student.is_primary_contact ? ' · Primary contact' : ''}</span></div><button type="button" class="btn btn-secondary icon-control" data-unlink="${esc(guardian.id)}" data-student="${esc(student.id)}" aria-label="Unlink ${esc(student.name)}"><i data-lucide="unlink" aria-hidden="true"></i></button></div>`).join('')}${guardian.students_truncated ? `<p class="text-muted">Showing the first 100 of ${esc(guardian.students_count)} links. Search by learner to find a particular relationship.</p>` : ''}</td><td><span class="badge ${guardian.access_status === 'active' ? 'badge-green' : guardian.access_status === 'no_account' ? 'badge-gray' : 'badge-amber'}">${esc(guardian.access_status === 'no_account' ? 'No portal account' : guardian.access_status.replace(/_/g, ' '))}</span>${guardian.account ? `<span class="text-meta">${esc(guardian.account.username)}</span>` : ''}</td><td><div class="actions"><button type="button" class="btn btn-secondary btn-sm" data-edit="${esc(guardian.id)}">Edit</button><button type="button" class="btn btn-secondary btn-sm" data-link="${esc(guardian.id)}">Link learner</button></div></td></tr>`).join('')}</tbody></table></div>`;
        const find = id => result.data.find(guardian => String(guardian.id) === id);
        wrap.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => openGuardianForm(find(button.dataset.edit), button)));
        wrap.querySelectorAll('[data-link]').forEach(button => button.addEventListener('click', () => openLinkForm(find(button.dataset.link), button)));
        wrap.querySelectorAll('[data-unlink]').forEach(button => button.addEventListener('click', () => unlink(find(button.dataset.unlink), button.dataset.student, button)));
      }
      pagination(pages, result.meta, page => { state.page = page; loadGuardians(); });
    }
    MGAEMS.initIcons();
  }

  function input(name, label, type = 'text', value = '', required = false, maximum = 150) {
    const id = 'guardian_' + name.replace(/\./g, '_');
    return `<div class="field"><label for="${id}">${label}${required ? ' *' : ''}</label><input id="${id}" name="${name}" type="${type}" value="${esc(value)}" maxlength="${maximum}" ${required ? 'required' : ''}></div>`;
  }

  function pickerHTML() {
    return '<div class="profile-subsection"><div class="field"><label for="learnerSearch">Find learners to link *</label><input id="learnerSearch" type="search" maxlength="150" placeholder="Name or admission number"></div><div id="selectedLearners" class="selection-summary" role="status"></div><div id="learnerChoices" class="record-list"></div><div class="pagination" id="learnerPagination" hidden></div></div>';
  }

  function learnerPicker(modal, excluded = new Set()) {
    const selected = new Map();
    let page = 1, search = '', request = 0, timer;
    const choices = modal.body.querySelector('#learnerChoices');
    const summary = modal.body.querySelector('#selectedLearners');
    const pages = modal.body.querySelector('#learnerPagination');
    const searchControl = modal.body.querySelector('#learnerSearch');
    function selection() {
      summary.innerHTML = `<strong>${selected.size} learner(s) selected</strong>${selected.size ? `<div class="form-actions">${[...selected].map(([id, learner]) => `<button type="button" class="btn btn-secondary btn-sm" data-remove="${esc(id)}" aria-label="Remove ${esc(learner.first_name)} ${esc(learner.last_name)} from selection">${esc(learner.first_name)} ${esc(learner.last_name)} ×</button>`).join('')}</div>` : '<span class="text-meta">Selections are retained when you search or change pages. Maximum 100 per submission.</span>'}`;
      summary.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => { selected.delete(button.dataset.remove); choices.querySelectorAll('[data-choice]').forEach(control => { if (control.dataset.choice === button.dataset.remove) control.checked = false; }); selection(); }));
    }
    async function load() {
      if (modal.closed) return;
      const sequence = ++request;
      choices.setAttribute('aria-busy', 'true'); choices.innerHTML = MGAEMS.loadingHTML('Loading learner choices…'); pages.hidden = true;
      const params = new URLSearchParams({ page, per_page: 25 }); if (search) params.set('search', search);
      const result = await MGAEMS.get('/api/v1/students?' + params);
      if (sequence !== request || modal.closed) return;
      choices.setAttribute('aria-busy', 'false');
      if (!result.ok) {
        choices.innerHTML = MGAEMS.errorHTML(result.error) + '<button type="button" class="btn btn-secondary btn-sm">Retry learner choices</button>';
        choices.querySelector('button').addEventListener('click', load); return;
      }
      const learners = result.data.filter(learner => !excluded.has(String(learner.id)));
      choices.innerHTML = !learners.length ? MGAEMS.emptyStateHTML('No available learners on this page', 'Search by name/admission number or use the next page.', 'users') : learners.map(learner => `<label class="record-item"><input type="checkbox" name="student_ids" value="${esc(learner.id)}" data-choice="${esc(learner.id)}" ${selected.has(String(learner.id)) ? 'checked' : ''}><span>${esc(learner.first_name)} ${esc(learner.last_name)}<span class="text-meta">${esc(learner.admission_no)} · ${esc(learner.school_class?.name || 'No class')} · ${esc(learner.status)}</span></span></label>`).join('');
      choices.querySelectorAll('[data-choice]').forEach(control => control.addEventListener('change', () => {
        if (control.checked && selected.size >= 100) { control.checked = false; MGAEMS.toast('Link at most 100 learners per submission.', 'error'); return; }
        if (control.checked) selected.set(control.dataset.choice, learners.find(learner => String(learner.id) === control.dataset.choice));
        else selected.delete(control.dataset.choice);
        selection();
      }));
      pagination(pages, result.meta, value => { page = value; load(); }); MGAEMS.initIcons();
    }
    searchControl.addEventListener('input', event => { page = 1; search = event.target.value.trim(); request++; clearTimeout(timer); timer = setTimeout(load, 250); });
    selection(); load();
    return selected;
  }

  function openGuardianForm(guardian, trigger) {
    const initialMode = guardian?.account ? 'existing' : 'none';
    const modal = MGAEMS.openModal({ title: guardian ? 'Edit guardian' : 'Add guardian', trigger, body: `<form id="guardianForm"><div data-form-error></div><p class="text-muted">A guardian contact does not automatically grant Parent Portal access. Account creation and association are optional.</p><div class="form-grid">${input('full_name', 'Full name', 'text', guardian?.full_name, true)}${input('relationship', 'Relationship', 'text', guardian?.relationship, true, 30)}${input('phone', 'Phone', 'tel', guardian?.phone, true, 20)}${input('email', 'Contact email', 'email', guardian?.email)}${input('address', 'Address', 'text', guardian?.address, false, 255)}</div>
      <label class="flex gap-2"><input type="checkbox" name="is_primary_contact" ${guardian?.is_primary_contact ? 'checked' : ''}> Primary contact for linked learners</label><p class="text-meta">Primary status can differ by learner. Changing this checkbox applies your choice to all linked learners. Selecting primary replaces their previous primary contact.</p>
      <div class="field profile-subsection"><label for="accountMode">Parent Portal account</label><select id="accountMode"><option value="none" ${initialMode === 'none' ? 'selected' : ''}>No portal account</option><option value="existing" ${initialMode === 'existing' ? 'selected' : ''}>Associate existing parent account</option><option value="create">Create parent account</option></select></div>
      <div id="existingAccountFields" hidden><div class="field"><label for="accountSearch">Search parent accounts</label><input id="accountSearch" type="search" maxlength="150" placeholder="Username or login email"></div><div class="field"><label for="guardianAccount">Parent account *</label><select id="guardianAccount" name="user_id"><option value="">Select account…</option></select></div><div id="accountError"></div><div class="pagination" id="accountPagination" hidden></div></div>
      <div id="newAccountFields" hidden><div class="form-grid">${input('account.username', 'Username', 'text', '', false, 100)}${input('account.email', 'Login email', 'email', '', false)}${input('account.password', 'Temporary password', 'password', '', false, 200)}</div><p class="text-meta">Use at least 10 characters. Share the password securely; it will not be shown again.</p></div>${guardian ? '' : pickerHTML()}</form>`, footer: '<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="submit" form="guardianForm" class="btn btn-primary" data-submit>Save guardian</button>' });
    const form = modal.body.querySelector('form');
    let primaryChanged = false;
    form.elements.is_primary_contact.addEventListener('change', () => { primaryChanged = true; });
    const selected = guardian ? null : learnerPicker(modal);
    const modeControl = modal.body.querySelector('#accountMode');
    const accountControl = modal.body.querySelector('#guardianAccount');
    const accountPages = modal.body.querySelector('#accountPagination');
    let accountPage = 1, accountSearch = '', accountRequest = 0, accountTimer;
    let chosenAccount = guardian?.access_status !== 'role_mismatch' ? guardian?.account || null : null;
    if (chosenAccount) accountControl.innerHTML += `<option value="${esc(chosenAccount.id)}" selected>${esc(chosenAccount.username)} · ${esc(chosenAccount.email)}</option>`;
    accountControl.addEventListener('change', () => { chosenAccount = accountControl.value ? { id: Number(accountControl.value), username: accountControl.selectedOptions[0].textContent, email: '' } : null; });

    async function loadAccounts() {
      if (modal.closed) return;
      const sequence = ++accountRequest;
      const errors = modal.body.querySelector('#accountError');
      accountControl.disabled = true; accountPages.hidden = true; errors.innerHTML = MGAEMS.loadingHTML('Loading parent accounts…');
      const params = new URLSearchParams({ page: accountPage, per_page: 20 }); if (accountSearch) params.set('search', accountSearch);
      const result = await MGAEMS.get('/api/v1/guardians/accounts?' + params);
      if (sequence !== accountRequest || modal.closed) return;
      if (!result.ok) {
        errors.innerHTML = MGAEMS.errorHTML(result.error) + '<button type="button" class="btn btn-secondary btn-sm">Retry parent accounts</button>';
        errors.querySelector('button').addEventListener('click', loadAccounts);
      } else {
        errors.innerHTML = !result.data.length ? MGAEMS.emptyStateHTML('No parent accounts on this page', 'Change the search, create an account explicitly, or use no account.', 'user') : '';
        const accounts = result.data;
        if (chosenAccount && !accounts.some(account => account.id === chosenAccount.id)) accounts.unshift(chosenAccount);
        accountControl.innerHTML = '<option value="">Select account…</option>' + accounts.map(account => `<option value="${esc(account.id)}" ${String(account.id) === String(chosenAccount?.id) ? 'selected' : ''} ${account.linked && account.id !== guardian?.account?.id ? 'disabled' : ''}>${esc(account.username)}${account.email ? ' · ' + esc(account.email) : ''}${account.linked && account.id !== guardian?.account?.id ? ' · already linked' : ''}</option>`).join('');
        accountControl.disabled = modeControl.value !== 'existing';
        pagination(accountPages, result.meta, page => { accountPage = page; loadAccounts(); });
      }
      MGAEMS.initIcons();
    }
    function syncMode() {
      const mode = modeControl.value;
      modal.body.querySelector('#existingAccountFields').hidden = mode !== 'existing';
      modal.body.querySelector('#newAccountFields').hidden = mode !== 'create';
      accountControl.disabled = mode !== 'existing'; accountControl.required = mode === 'existing';
      [...form.elements].filter(control => control.name.startsWith('account.')).forEach(control => { control.disabled = mode !== 'create'; control.required = mode === 'create'; });
      form.elements.namedItem('account.password').minLength = 10;
      form.elements.namedItem('account.password').autocomplete = 'new-password';
      if (mode === 'existing') loadAccounts();
    }
    modeControl.addEventListener('change', syncMode);
    modal.body.querySelector('#accountSearch').addEventListener('input', event => { accountPage = 1; accountSearch = event.target.value.trim(); accountRequest++; clearTimeout(accountTimer); accountTimer = setTimeout(loadAccounts, 250); });
    syncMode();
    let submitting = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submitting || !form.reportValidity()) return;
      const mode = modeControl.value;
      if (mode === 'existing' && (accountControl.disabled || !accountControl.value)) { MGAEMS.showFormErrors(form, { error: 'Choose a loaded parent account before submitting.' }); return; }
      const payload = Object.fromEntries(['full_name', 'relationship', 'phone', 'email', 'address'].map(name => [name, form.elements.namedItem(name).value.trim() || null]));
      if (!guardian || primaryChanged) payload.is_primary_contact = form.elements.is_primary_contact.checked;
      if (guardian) Object.keys(payload).filter(name => name !== 'is_primary_contact').forEach(name => { if (payload[name] === (guardian[name] || null)) delete payload[name]; });
      payload.user_id = mode === 'existing' ? Number(accountControl.value) : null;
      if (mode === 'create') { delete payload.user_id; payload.account = Object.fromEntries(['username', 'email', 'password'].map(name => [name, name === 'password' ? form.elements.namedItem('account.' + name).value : form.elements.namedItem('account.' + name).value.trim()])); }
      if (!guardian) payload.student_ids = [...selected.keys()].map(Number);
      if (!guardian && !payload.student_ids.length) { MGAEMS.showFormErrors(form, { error: 'Select at least one learner.', fields: { student_ids: ['Choose learners to link to this contact.'] } }); return; }
      submitting = true;
      if (guardian && (mode === 'create' || payload.user_id !== (guardian.account?.id || null))) {
        if (!await MGAEMS.confirmAction('Change Parent Portal association', `Change the portal account associated with ${guardian.full_name}? Access to all of this contact’s linked learners will follow the chosen association.`, 'Change association')) { submitting = false; return; }
      }
      modal.setBusy(true); const submit = modal.overlay.querySelector('[data-submit]'); submit.textContent = 'Saving…';
      const result = guardian ? await MGAEMS.patch(`/api/v1/guardians/${guardian.id}`, payload) : await MGAEMS.post('/api/v1/guardians', payload);
      modal.setBusy(false); submitting = false; submit.textContent = 'Save guardian';
      if (!result.ok) { MGAEMS.showFormErrors(form, result); return; }
      modal.close(); MGAEMS.toast(guardian ? 'Guardian updated.' : 'Guardian contact created.', 'success'); loadGuardians();
    });
  }

  function openLinkForm(guardian, trigger) {
    const modal = MGAEMS.openModal({ title: `Link learners to ${guardian.full_name}`, trigger, body: `<form id="guardianLinkForm"><div data-form-error></div><p class="text-muted">Linking a learner to a contact with a Parent Portal account grants that account access to the learner’s portal records.</p><label class="flex gap-2"><input type="checkbox" name="is_primary_contact"> Make this contact primary for the selected learners</label>${pickerHTML()}</form>`, footer: '<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="submit" form="guardianLinkForm" class="btn btn-primary" data-submit>Link learners</button>' });
    const selected = learnerPicker(modal, new Set(guardian.students.map(student => String(student.id))));
    const form = modal.body.querySelector('form');
    let submitting = false;
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (submitting) return;
      const student_ids = [...selected.keys()].map(Number);
      if (!student_ids.length) { MGAEMS.showFormErrors(form, { error: 'Select at least one learner.' }); return; }
      submitting = true; modal.setBusy(true); const submit = modal.overlay.querySelector('[data-submit]'); submit.textContent = 'Linking…';
      const result = await MGAEMS.post(`/api/v1/guardians/${guardian.id}/students`, { student_ids, is_primary_contact: form.elements.is_primary_contact.checked });
      modal.setBusy(false); submitting = false; submit.textContent = 'Link learners';
      if (!result.ok) { MGAEMS.showFormErrors(form, result); return; }
      modal.close(); MGAEMS.toast('Learner relationships added.', 'success'); loadGuardians();
    });
  }

  async function unlink(guardian, studentId, button) {
    if (button.disabled) return;
    button.disabled = true;
    const accepted = await MGAEMS.confirmAction('Unlink learner', `Unlink this learner from ${guardian.full_name}? This contact’s portal access to the learner will be removed. Other learner links remain. Removing the final relationship removes the contact record; any portal account is retained.`, 'Unlink learner');
    if (!accepted) { button.disabled = false; button.focus(); return; }
    const result = await MGAEMS.del(`/api/v1/guardians/${guardian.id}/students/${encodeURIComponent(studentId)}`);
    if (!result.ok) { button.disabled = false; MGAEMS.toast(result.error, 'error'); return; }
    MGAEMS.toast('Learner relationship removed.', 'success'); await loadGuardians(); document.getElementById('guardianSearch').focus();
  }

  loadGuardians(); MGAEMS.initIcons();
})();
