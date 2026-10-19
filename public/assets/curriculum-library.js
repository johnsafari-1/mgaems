/* Administrator-only source evidence and review UI. The browser never fetches curriculum URLs. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || user.role !== 'system_admin') { if (user) window.location.href = MGAEMS.landingPage(user); return; }
  renderAppShell('/curriculum-library.html');
  const main = document.getElementById('appMain'), esc = MGAEMS.escapeHTML;
  const state = { sources: [], grade: '', area: '', request: 0 };
  const byId = id => document.getElementById(id);
  const input = (name, label, value = '', type = 'text', required = true, extra = '') => `<div class="field"><label for="curriculum_${name}">${esc(label)}${required ? ' *' : ''}</label><input id="curriculum_${name}" name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${extra}></div>`;
  const textarea = (name, label, value = '', required = true, extra = '') => `<div class="field full"><label for="curriculum_${name}">${esc(label)}${required ? ' *' : ''}</label><textarea id="curriculum_${name}" name="${name}" ${required ? 'required' : ''} ${extra}>${esc(value)}</textarea></div>`;
  const formValues = form => Object.fromEntries([...form.elements].filter(control => control.name && !control.disabled && !['file', 'checkbox'].includes(control.type)).map(control => [control.name, String(control.value || '').trim()]));
  const editable = version => version.approval_status === 'draft' && version.verification_status === 'pending';
  const versionState = version => `${version.approval_status || 'draft'} / ${version.verification_status || 'pending'}`;

  main.className = 'app-main curriculum-library-workspace';
  main.innerHTML = `<div class="lesson-plans-heading"><div><span class="eyebrow">Administration</span><h1>Curriculum Library</h1><p>Register source evidence, manage structured records, and make verified curriculum available only after administrator review.</p></div><button class="btn btn-primary" type="button" id="registerSource"><i data-lucide="plus" aria-hidden="true"></i>Register source</button></div>
    <p class="lesson-plans-notice">Official hosting does not grant reproduction or private storage rights. Register the April 2024 KICD URL as metadata only until an administrator has explicit authority to upload a private PDF.</p>
    <div class="lesson-plans-toolbar"><div class="field"><label for="curriculumGrade">Grade</label><select id="curriculumGrade"><option value="">All grades</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">Grade ${i + 1}</option>`).join('')}</select></div><div class="field"><label for="curriculumArea">Learning area</label><input id="curriculumArea" type="search" placeholder="Integrated Science"></div></div><p id="curriculumCount" class="academic-result-count" role="status"></p><section id="curriculumSources" aria-busy="true">${MGAEMS.loadingHTML('Loading curriculum sources...')}</section>`;
  byId('registerSource').addEventListener('click', event => sourceForm(null, event.currentTarget));
  byId('curriculumGrade').addEventListener('change', event => { state.grade = event.target.value; render(); });
  byId('curriculumArea').addEventListener('input', event => { state.area = event.target.value.trim().toLowerCase(); render(); });
  main.addEventListener('click', event => {
    const control = event.target.closest?.('[data-curriculum-action]'); if (!control || control.disabled) return;
    const source = state.sources.find(item => String(item.id) === control.dataset.source); if (!source) return;
    if (control.dataset.curriculumAction === 'edit-source') sourceForm(source, control);
    if (control.dataset.curriculumAction === 'upload-version') versionForm(source, control);
    if (control.dataset.curriculumAction === 'version-detail') versionDetail(control.dataset.version, control);
  });

  function sourceRows(data) { return Array.isArray(data?.data) ? data.data : null; }
  async function load() {
    const request = ++state.request, target = byId('curriculumSources'); target.setAttribute('aria-busy', 'true');
    const result = await MGAEMS.get('/api/v1/curriculum-library/sources');
    if (request !== state.request) return;
    if (!result.ok || !sourceRows(result.data)) { target.innerHTML = MGAEMS.errorHTML(result.error || 'The curriculum library could not be loaded.') + '<button type="button" class="btn btn-secondary" data-retry>Try again</button>'; target.querySelector('[data-retry]').addEventListener('click', load); target.setAttribute('aria-busy', 'false'); return; }
    state.sources = result.data.data; render();
  }
  function render() {
    const target = byId('curriculumSources');
    const rows = state.sources.filter(source => (!state.grade || String(source.grade) === state.grade) && (!state.area || String(source.learning_area || '').toLowerCase().includes(state.area)));
    byId('curriculumCount').textContent = `${rows.length} of ${state.sources.length} registered sources`;
    if (!rows.length) { target.innerHTML = MGAEMS.emptyStateHTML(state.sources.length ? 'No matching curriculum sources' : 'No curriculum sources registered', state.sources.length ? 'Try another grade or learning-area filter.' : 'Register official source metadata before any authorized document upload.', 'book-marked'); target.setAttribute('aria-busy', 'false'); MGAEMS.initIcons(); return; }
    target.innerHTML = `<div class="plan-grid">${rows.map(source => `<article class="plan-card"><div class="plan-card-heading"><h2>${esc(source.title)}</h2><span class="badge badge-navy">Grade ${esc(source.grade)}</span></div><dl class="plan-meta"><div><dt>Learning area</dt><dd>${esc(source.learning_area)}</dd></div><div><dt>Publisher</dt><dd>${esc(source.publisher)}</dd></div><div><dt>Official URL</dt><dd><a href="${esc(source.official_url)}" target="_blank" rel="noopener noreferrer">Open source</a></dd></div><div><dt>Versions</dt><dd>${esc(source.versions?.length || 0)}</dd></div></dl><div class="plan-actions"><button type="button" class="btn btn-secondary btn-sm" data-curriculum-action="edit-source" data-source="${esc(source.id)}">Edit source</button><button type="button" class="btn btn-primary btn-sm" data-curriculum-action="upload-version" data-source="${esc(source.id)}">Upload authorized PDF</button></div>${(source.versions || []).map(version => `<p><button type="button" class="btn btn-secondary btn-sm" data-curriculum-action="version-detail" data-source="${esc(source.id)}" data-version="${esc(version.id)}">${esc(version.edition)} · ${esc(versionState(version))}</button></p>`).join('')}</article>`).join('')}</div>`;
    target.setAttribute('aria-busy', 'false'); MGAEMS.initIcons();
  }
  async function sourceForm(source, trigger) {
    const official = source || { identifier: 'kicd-integrated-science-grade7-april-2024', title: 'Integrated Science Grade 7 - April 2024', official_url: 'https://kicd.ac.ke/wp-content/uploads/2024/06/Integrated-Science-Grade-7-Design-Formatted-April-2024.pdf', publisher: 'Kenya Institute of Curriculum Development (KICD)', grade: 7, learning_area: 'Integrated Science' };
    const modal = MGAEMS.openModal({ title: source ? 'Edit curriculum source' : 'Register source metadata', trigger, body: `<form id="curriculumSourceForm" class="plan-dialog"><div data-form-error></div><p class="academic-form-note">This stores only provenance metadata. It does not download, index, reproduce, verify, or approve the linked document.</p><div class="form-grid">${source ? '' : input('identifier', 'Stable identifier', official.identifier, 'text', true, 'maxlength="120" pattern="[a-z0-9][a-z0-9._-]*"')}${input('title', 'Source title / edition', official.title, 'text', true, 'maxlength="200"')}${input('official_url', 'Official source URL', official.official_url, 'url', true, 'maxlength="1000"')}${input('publisher', 'Publisher', official.publisher, 'text', true, 'maxlength="160"')}${input('grade', 'Grade', official.grade, 'number', true, 'min="1" max="12"')}${input('learning_area', 'Learning area', official.learning_area, 'text', true, 'maxlength="160"')}</div></form>`, footer: `<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="button" class="btn btn-primary" id="saveCurriculumSource">${source ? 'Save source' : 'Register source'}</button>` });
    const form = modal.body.querySelector('form');
    const subjectField = document.createElement('div');
    subjectField.className = 'field full';
    subjectField.innerHTML = `<label for="curriculum_subject_id">Linked school subject (optional)</label><select id="curriculum_subject_id" name="subject_id" disabled aria-describedby="curriculumSubjectNotice"><option value="">Not linked</option>${official.subject_id ? `<option value="${esc(official.subject_id)}" selected>Subject #${esc(official.subject_id)} (current link)</option>` : ''}</select><p id="curriculumSubjectNotice" class="academic-form-note" role="status">Loading subjects; the existing link will be preserved.</p>`;
    form.appendChild(subjectField);
    const subjectControl = form.elements.subject_id, subjectNotice = subjectField.querySelector('#curriculumSubjectNotice');
    let saving = false;
    modal.overlay.querySelector('#saveCurriculumSource').addEventListener('click', async () => {
      if (modal.closed || saving || !form.reportValidity()) return;
      const body = formValues(form);
      body.grade = Number(body.grade);
      if (subjectControl.disabled) body.subject_id = official.subject_id ?? null;
      else {
        body.subject_id = subjectControl.value === '' ? null : Number(subjectControl.value);
        if (body.subject_id !== null && (!Number.isInteger(body.subject_id) || body.subject_id < 1)) { MGAEMS.showFormErrors(form, { fields: { subject_id: ['Choose an existing school subject.'] } }); return; }
      }
      saving = true; modal.setBusy(true);
      try {
        const result = source ? await MGAEMS.put('/api/v1/curriculum-library/sources/' + source.id, body) : await MGAEMS.post('/api/v1/curriculum-library/sources', body);
        if (modal.closed) return;
        if (!result.ok) { MGAEMS.showFormErrors(form, result); return; }
        modal.setBusy(false); modal.close();
        MGAEMS.toast(source ? 'Curriculum source updated.' : 'Source provenance registered without document ingestion.', 'success');
        load();
      } catch {
        MGAEMS.showFormErrors(form, { error: 'The source could not be saved. Your entries are retained; check the library before retrying an uncertain save.' });
      } finally { saving = false; modal.setBusy(false); }
    });
    try {
      const result = await MGAEMS.get('/api/v1/subjects');
      if (modal.closed || saving) return;
      const subjects = result.ok && Array.isArray(result.data) ? result.data : null;
      if (!subjects || !subjects.every(subject => Number.isInteger(subject?.id) && subject.id > 0 && typeof subject.name === 'string') || new Set(subjects.map(subject => subject.id)).size !== subjects.length) throw new Error('Unavailable subjects');
      subjectControl.innerHTML = '<option value="">Not linked</option>' + subjects.map(subject => `<option value="${esc(subject.id)}">${esc(subject.name)}${subject.code ? ' (' + esc(subject.code) + ')' : ''}</option>`).join('') + (official.subject_id && !subjects.some(subject => subject.id === official.subject_id) ? `<option value="${esc(official.subject_id)}">Subject #${esc(official.subject_id)} (current link)</option>` : '');
      subjectControl.value = official.subject_id == null ? '' : String(official.subject_id);
      subjectControl.disabled = false;
      subjectNotice.textContent = 'Choose the matching existing subject. Select Not linked only to intentionally remove the link.';
    } catch {
      if (!modal.closed) subjectNotice.textContent = 'Subject list unavailable. You can save metadata; the existing subject link will be preserved.';
    }
  }
  function versionForm(source, trigger) {
    const modal = MGAEMS.openModal({ title: 'Upload authorized source PDF', trigger, body: `<form id="curriculumVersionForm" class="plan-dialog"><div data-form-error></div><p class="academic-form-note">The PDF is stored privately and checksummed by the server. Upload only where the school has an explicit right to retain and review it.</p><div class="form-grid">${input('edition', 'Edition', '', 'text', true, 'maxlength="120"')}${input('publication_date', 'Publication date', '', 'date', false)}${input('document_url', 'Official document URL', source.official_url, 'url', true, 'maxlength="1000"')}${textarea('authorization_basis', 'Rights / authorization basis', '', true, 'minlength="20" maxlength="2000"')}<div class="field full"><label for="curriculum_document">Authorized PDF *</label><input id="curriculum_document" name="document" type="file" accept="application/pdf,.pdf" required><p class="academic-form-note">Maximum 20 MiB. Actual PDF bytes are checked server-side.</p></div><div class="field full"><label><input name="rights_confirmed" type="checkbox" required> I confirm authorized private retention and review.</label></div></div></form>`, footer: `<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="button" class="btn btn-primary" id="uploadCurriculumVersion">Upload private PDF</button>` });
    const form = modal.body.querySelector('form'); modal.overlay.querySelector('#uploadCurriculumVersion').addEventListener('click', async () => { if (!form.reportValidity()) return; const file = form.elements.document.files?.[0]; if (!file || file.type !== 'application/pdf' || file.size > 20 * 1024 * 1024) { MGAEMS.showFormErrors(form, { fields: { document: ['Choose an application/pdf file no larger than 20 MiB.'] } }); return; } const body = new FormData(form); body.delete('rights_confirmed'); modal.setBusy(true); const result = await MGAEMS.upload('/api/v1/curriculum-library/sources/' + source.id + '/versions', body); modal.setBusy(false); if (!result.ok) { MGAEMS.showFormErrors(form, result); return; } modal.close(); MGAEMS.toast('Private PDF registered as an unverified draft.', 'success'); load(); });
  }
  async function versionDetail(id, trigger) {
    const modal = MGAEMS.openModal({ title: 'Curriculum version review', trigger, body: MGAEMS.loadingHTML('Loading source evidence...') });
    const result = await MGAEMS.get('/api/v1/curriculum-library/versions/' + encodeURIComponent(id));
    if (modal.closed) return;
    if (!result.ok || !result.data?.version) { modal.body.innerHTML = MGAEMS.errorHTML(result.error || 'The source version could not be loaded.'); return; }
    const version = result.data.version, source = version.source || {}, canEdit = editable(version);
    modal.body.innerHTML = `<div data-form-error></div><dl class="plan-meta">
      <div><dt>Source</dt><dd>${esc(source.title || '')}</dd></div><div><dt>Edition</dt><dd>${esc(version.edition)}</dd></div>
      <div><dt>Grade / learning area</dt><dd>${esc(source.grade)} / ${esc(source.learning_area)}</dd></div><div><dt>Linked subject</dt><dd>${source.subject_id ? 'Subject #' + esc(source.subject_id) : 'Not linked'}</dd></div>
      <div><dt>Status</dt><dd>${esc(versionState(version))}</dd></div><div><dt>Authorization basis</dt><dd>${esc(version.authorization_basis || 'Not recorded')}</dd></div>
      <div><dt>Verification notes</dt><dd>${esc(version.verification_notes || 'Not reviewed')}</dd></div>
      <div><dt>Document SHA-256</dt><dd><code>${esc(version.document_sha256)}</code></dd></div><div><dt>Structured content SHA-256</dt><dd><code>${esc(result.data.review_content_sha256)}</code></dd></div></dl>
      <div class="plan-actions"><button type="button" class="btn btn-secondary btn-sm" id="downloadCurriculumPdf">Download private PDF</button>${canEdit ? '<button type="button" class="btn btn-secondary btn-sm" id="showImport">Import reviewed records</button><button type="button" class="btn btn-primary btn-sm" id="showApproval">Verify and approve</button>' : ''}</div>
      ${canEdit ? `<section id="importRecords" hidden><label for="curriculumRecords">Reviewed JSON records</label><textarea id="curriculumRecords" rows="14" placeholder='{"records":[{"record_key":"...","strand":"...","sub_strand":"...","specific_learning_outcomes":["..."],"suggested_learning_experiences":[],"key_inquiry_questions":[],"assessment_approaches":[],"page_reference":"p. 1"}]}'></textarea><button type="button" class="btn btn-primary" id="submitImport">Validate and import</button></section>` : ''}
      ${['approved', 'superseded'].includes(version.approval_status) ? '<div class="plan-actions"><button type="button" class="btn btn-secondary btn-sm" id="withdrawCurriculumVersion">Withdraw verified edition</button></div>' : ''}
      ${version.records?.length ? `<h3>Structured records</h3><div class="plan-sections">${version.records.map(recordReview).join('')}</div>` : '<p>No structured records imported.</p>'}`;
    modal.body.querySelector('#downloadCurriculumPdf').addEventListener('click', () => MGAEMS.download('/api/v1/curriculum-library/versions/' + version.id + '/document', 'curriculum-source-' + version.id + '.pdf'));
    const withdraw = modal.body.querySelector('#withdrawCurriculumVersion');
    if (withdraw) withdraw.addEventListener('click', async () => {
      const reason = window.prompt('State why this verified edition must be withdrawn (at least 20 characters).');
      if (reason === null) return;
      const result = await MGAEMS.post('/api/v1/curriculum-library/versions/' + version.id + '/withdraw', { reason: reason.trim() });
      if (!result.ok) { MGAEMS.toast(result.error, 'error'); return; }
      modal.close(); MGAEMS.toast('Curriculum edition withdrawn.', 'success'); load();
    });
    if (!canEdit) return;
    modal.body.querySelector('#showImport').addEventListener('click', () => { modal.body.querySelector('#importRecords').hidden = false; });
    modal.body.querySelector('#submitImport').addEventListener('click', async () => { let payload; try { payload = JSON.parse(modal.body.querySelector('#curriculumRecords').value); } catch { MGAEMS.showFormErrors(modal.body, { fields: { records: ['Enter valid JSON with a records array.'] } }); return; } const imported = await MGAEMS.post('/api/v1/curriculum-library/versions/' + version.id + '/records', payload); if (!imported.ok) { MGAEMS.showFormErrors(modal.body, imported); return; } MGAEMS.toast('Records imported as an unverified draft.', 'success'); modal.close(); load(); });
    modal.body.querySelector('#showApproval').addEventListener('click', () => approvalForm(version, result.data.review_content_sha256, modal));
  }
  function recordReview(record) {
    const list = (label, values) => `<h5>${esc(label)}</h5>${values?.length ? `<ul>${values.map(value => `<li>${esc(value)}</li>`).join('')}</ul>` : '<p>None recorded.</p>'}`;
    return `<section class="plan-section"><h4>${esc(record.strand)} - ${esc(record.sub_strand)}</h4><p>Record key: ${esc(record.record_key)} · Page reference: ${esc(record.page_reference)}</p>${list('Specific learning outcomes', (record.outcomes || []).map(outcome => outcome.description))}${list('Suggested learning experiences', record.suggested_learning_experiences)}${list('Key inquiry questions', record.key_inquiry_questions)}${list('Assessment approaches', record.assessment_approaches)}</section>`;
  }
  function approvalForm(version, contentHash, modal) {
    modal.body.innerHTML = `<form id="curriculumApprovalForm" class="plan-dialog"><div data-form-error></div><p>Approval requires a verified document, accurate extraction, and authorized use. It makes the edition retrievable for grounded drafts.</p>${textarea('verification_notes', 'Verification notes', '', true, 'minlength="20" maxlength="4000"')}<label><input type="checkbox" required> I checked the actual document bytes.</label><label><input type="checkbox" required> I checked every imported record against the document.</label><label><input type="checkbox" required> I confirm authorized use and private retention.</label></form><div class="plan-actions"><button type="button" class="btn btn-secondary" id="cancelApproval">Cancel</button><button type="button" class="btn btn-primary" id="submitApproval">Approve verified edition</button></div>`;
    const form = modal.body.querySelector('form'); modal.body.querySelector('#cancelApproval').addEventListener('click', () => modal.close()); modal.body.querySelector('#submitApproval').addEventListener('click', async () => { if (!form.reportValidity()) return; modal.setBusy(true); const result = await MGAEMS.post('/api/v1/curriculum-library/versions/' + version.id + '/approve', { document_sha256: version.document_sha256, content_sha256: contentHash, actual_document_checked: true, extracted_content_checked: true, authorized_use_confirmed: true, verification_notes: formValues(form).verification_notes }); modal.setBusy(false); if (!result.ok) { MGAEMS.showFormErrors(form, result); return; } modal.close(); MGAEMS.toast('Curriculum edition verified and approved.', 'success'); load(); });
  }
  load(); MGAEMS.initIcons();
})();
