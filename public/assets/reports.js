/* School reporting uses only leadership-authorized APIs. */
(() => {
  const user = MGAEMS.requireAuth();
  const REPORT_ROLES = ['system_admin', 'head_teacher', 'deputy_head_teacher'];
  if (user && !REPORT_ROLES.includes(user.role)) window.location.href = MGAEMS.landingPage(user);

  if (user && REPORT_ROLES.includes(user.role)) {
    renderAppShell('/reports.html');
    MGAEMS.initSidebar();

    const state = {
      statistics: null,
      classes: [],
      years: [],
      terms: [],
      students: [],
      studentPage: 1,
      studentTotal: 0,
      selectedCard: null,
      cardRequest: 0,
      studentRequest: 0,
      studentsLoading: false,
      studentsReady: false,
      downloadingCardId: null,
      exportPreview: null,
      exportPage: 1,
      exportRows: [],
      exportRequest: 0,
      exportDownloading: false,
      overviewRequest: 0,
      lookupRequest: 0,
      lookupsReady: false,
    };
    const esc = MGAEMS.escapeHTML;
    const currentSession = MGAEMS.sessionGuard();
    const current = () => currentSession() && window.location.pathname === '/reports.html';
    const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const validId = value => (typeof value === 'number' || (typeof value === 'string' && /^[1-9]\d*$/.test(value))) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
    const reportStatusLabels = { active: 'Active', promoted: 'Promoted', transferred: 'Transferred', left: 'Left' };
    const staffTypeLabels = { teaching: 'Teaching', non_teaching: 'Non-teaching' };
    const validCount = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
    const count = value => validCount(value) ? String(Number(value)) : 'Unavailable';
    const validLookups = rows => Array.isArray(rows) && rows.every(row => isRecord(row) && validId(row.id) && typeof row.name === 'string');
    const validLearners = rows => Array.isArray(rows) && rows.every(row => isRecord(row) && validId(row.id) && ['first_name', 'last_name', 'admission_no'].every(key => typeof row[key] === 'string'));
    const formatDateTime = value => {
      if (!value) return 'Date unavailable';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(date);
    };

    document.getElementById('appMain').setAttribute('class', 'app-main reports-workspace');
    document.getElementById('appMain').innerHTML = `
      <div class="page-heading reports-heading"><span class="eyebrow">School leadership</span><h1>Reports &amp; Analytics</h1><p>Review saved operational totals, export the learner register and find existing report-card PDFs.</p></div>
      <div class="tabs report-tabs" role="tablist" aria-label="Report categories">
        <button class="tab active" id="overviewTab" type="button" role="tab" aria-selected="true" aria-controls="overviewPanel" tabindex="0">School Overview</button>
        <button class="tab" id="studentsTab" type="button" role="tab" aria-selected="false" aria-controls="studentsPanel" tabindex="-1">Learner export</button>
        <button class="tab" id="reportCardsTab" type="button" role="tab" aria-selected="false" aria-controls="reportCardsPanel" tabindex="-1">Report Cards</button>
      </div>

      <section class="report-panel active" id="overviewPanel" role="tabpanel" aria-labelledby="overviewTab">
        <div class="stat-cards report-summary">
          <div class="card stat-card"><div class="num" id="studentTotal">Loading…</div><div class="label">Learner register total</div></div>
          <div class="card stat-card"><div class="num" id="staffTotal">Loading…</div><div class="label">Staff register total</div></div>
          <div class="card stat-card"><div class="num" id="activeSponsorships">Loading…</div><div class="label">Active sponsorships</div></div>
          <div class="card stat-card"><div class="num" id="todayAttendance">Loading…</div><div class="label">Present / recorded attendance</div></div>
        </div>
        <div id="overviewError"></div>
        <div class="report-grid">
          <div class="card report-card"><h2>Students by status</h2><div id="studentsByStatus">${MGAEMS.loadingHTML('Loading school statistics…')}</div></div>
          <div class="card report-card"><h2>Staff by type</h2><div id="staffByType">${MGAEMS.loadingHTML('Loading school statistics…')}</div></div>
          <div class="card report-card"><h2>Attendance today</h2><div id="attendanceSummary">${MGAEMS.loadingHTML('Loading school statistics…')}</div></div>
          <div class="card report-card"><h2>Sponsorship</h2><div id="sponsorshipSummary">${MGAEMS.loadingHTML('Loading school statistics…')}</div></div>
        </div>
      </section>

      <section class="report-panel" id="studentsPanel" role="tabpanel" aria-labelledby="studentsTab" hidden>
        <div class="card">
          <div class="section-header"><div><h2>Learner register export</h2><p class="report-note">Preview the selected class and enrollment status, then download matching records as Excel. The export includes admission number, names, gender, date of birth, class, status and admission date.</p></div></div>
          <div id="reportExportLookupError"></div>
          <div class="report-filter-grid">
            <div class="field"><label for="exportClass">Class</label><select id="exportClass" disabled><option value="">Loading classes…</option></select></div>
            <div class="field"><label for="exportStatus">Student status</label><select id="exportStatus"><option value="">All statuses</option><option value="active">Active</option><option value="promoted">Promoted</option><option value="transferred">Transferred</option><option value="left">Left</option></select></div>
            <div class="field"><button class="btn btn-secondary" type="button" id="previewStudentReport" disabled><i data-lucide="list-checks" aria-hidden="true"></i> Preview results</button></div>
          </div>
          <div id="studentExportPreview" class="report-result">${MGAEMS.emptyStateHTML('Choose filters to preview', 'The export supports class and student status filters.', 'file-spreadsheet')}</div>
          <div class="report-actions"><button class="btn btn-primary" type="button" id="downloadStudentReport" disabled><i data-lucide="download" aria-hidden="true"></i> Download Excel</button></div><div id="excelDownloadFeedback" class="report-download-feedback" role="status"></div>
        </div>
      </section>

      <section class="report-panel" id="reportCardsPanel" role="tabpanel" aria-labelledby="reportCardsTab" hidden>
        <div class="section-header"><div><h2>Existing Report Cards</h2><p class="report-note">Find generated reports and retained PDFs. Generation remains in Assessment.</p></div><a class="btn btn-secondary" href="/assessment.html">Open Assessment</a></div>
        <div class="card">
          <div id="reportCardLookupError"></div>
          <div class="report-filter-grid">
            <div class="field"><label for="cardYear">Academic year</label><select id="cardYear" disabled><option value="">Loading years…</option></select></div>
            <div class="field"><label for="cardTerm">Term</label><select id="cardTerm" disabled><option value="">Loading terms…</option></select></div>
            <div class="field"><label for="cardClass">Class</label><select id="cardClass" disabled><option value="">Loading classes…</option></select></div>
          </div>
          <div class="report-filter-grid">
            <div class="field"><label for="cardLearnerSearch">Find a learner on this page</label><input id="cardLearnerSearch" type="search" placeholder="Name or admission number"></div>
            <div class="field"><label for="cardStudent">Learner</label><select id="cardStudent" disabled><option value="">Select class first…</option></select><p class="hint" id="cardLearnerCount" role="status"></p></div>
            <div class="field"><div class="report-pagination" id="studentPageBar" hidden></div></div>
          </div>
        </div>
        <div id="reportCardResult" class="report-result">${MGAEMS.emptyStateHTML('Select a student and term', 'Existing report-card status will appear here.', 'file-text')}</div>
      </section>
    `;
    MGAEMS.initIcons();

    const tabs = [
      ['overviewTab', 'overviewPanel'],
      ['studentsTab', 'studentsPanel'],
      ['reportCardsTab', 'reportCardsPanel'],
    ];
    tabs.forEach(([tabId, panelId], index) => {
      const control = document.getElementById(tabId);
      control.addEventListener('click', () => selectTab(tabId, panelId));
      control.addEventListener('keydown', event => {
        const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : null;
        if (next) { event.preventDefault(); selectTab(...next); document.getElementById(next[0]).focus(); }
      });
    });
    document.getElementById('previewStudentReport').addEventListener('click', () => { state.exportPage = 1; previewStudentReport(); });
    document.getElementById('downloadStudentReport').addEventListener('click', downloadStudentReport);
    document.getElementById('exportClass').addEventListener('change', resetStudentPreview);
    document.getElementById('exportStatus').addEventListener('change', resetStudentPreview);
    document.getElementById('cardYear').addEventListener('change', updateCardTerms);
    document.getElementById('cardTerm').addEventListener('change', loadSelectedReportCard);
    document.getElementById('cardClass').addEventListener('change', () => { state.studentPage = 1; loadCardStudents(); });
    document.getElementById('cardStudent').addEventListener('change', loadSelectedReportCard);
    document.getElementById('cardLearnerSearch').addEventListener('input', renderLearnerChoices);

    function selectTab(tabId, panelId) {
      if (!current()) return;
      tabs.forEach(([id, panel]) => {
        const active = id === tabId;
        document.getElementById(id).classList.toggle('active', active);
        document.getElementById(id).setAttribute('aria-selected', String(active));
        document.getElementById(id).tabIndex = active ? 0 : -1;
        document.getElementById(panel).hidden = !active;
        document.getElementById(panel).classList.toggle('active', panel === panelId);
      });
    }

    async function loadSchoolOverview() {
      if (!current()) return;
      const request = ++state.overviewRequest;
      state.statistics = null;
      ['studentTotal', 'staffTotal', 'activeSponsorships', 'todayAttendance'].forEach(id => { document.getElementById(id).textContent = 'Loading…'; });
      ['studentsByStatus', 'staffByType', 'attendanceSummary', 'sponsorshipSummary'].forEach(id => { const target = document.getElementById(id); target.setAttribute('aria-busy', 'true'); target.innerHTML = MGAEMS.loadingHTML('Loading school statistics…'); });
      document.getElementById('overviewError').innerHTML = '';
      const result = await MGAEMS.get('/api/v1/reports/school-statistics');
      if (!current() || request !== state.overviewRequest) return;
      ['studentsByStatus', 'staffByType', 'attendanceSummary', 'sponsorshipSummary'].forEach(id => document.getElementById(id).setAttribute('aria-busy', 'false'));
      if (!result.ok || !isRecord(result.data)) {
        document.getElementById('overviewError').innerHTML = `${MGAEMS.errorHTML(result.status === 403 ? 'You do not have permission to view school reporting.' : result.error || 'School statistics could not be loaded.')}${![401, 403].includes(result.status) ? '<button type="button" class="btn btn-secondary" id="retryOverview">Retry statistics</button>' : ''}`;
        document.getElementById('retryOverview')?.addEventListener('click', loadSchoolOverview);
        ['studentTotal', 'staffTotal', 'activeSponsorships', 'todayAttendance'].forEach(id => { document.getElementById(id).textContent = 'Unavailable'; });
        ['studentsByStatus', 'staffByType', 'attendanceSummary', 'sponsorshipSummary'].forEach(id => { document.getElementById(id).innerHTML = MGAEMS.emptyStateHTML('Statistics unavailable', 'Reload statistics when access or connectivity is restored.', 'chart-no-axes-column'); });
        MGAEMS.initIcons();
        return;
      }
      state.statistics = result.data;
      renderOverview(result.data);
    }

    function renderOverview(data) {
      if (!current()) return;
      document.getElementById('overviewError').innerHTML = '';
      document.getElementById('studentTotal').textContent = count(data.students?.total);
      document.getElementById('staffTotal').textContent = count(data.staff?.total);
      document.getElementById('activeSponsorships').textContent = count(data.active_sponsorships);
      const attendance = isRecord(data.attendance_today) ? data.attendance_today : {};
      const validRate = typeof attendance.rate === 'number' && Number.isFinite(attendance.rate) && attendance.rate >= 0 && attendance.rate <= 100;
      const unrecorded = validCount(attendance.recorded) && Number(attendance.recorded) === 0 && attendance.rate === null;
      document.getElementById('todayAttendance').textContent = unrecorded ? 'Unrecorded' : validCount(attendance.recorded) && Number(attendance.recorded) > 0 && validRate ? `${attendance.rate}%` : 'Unavailable';
      renderDistribution('studentsByStatus', data.students?.by_status, reportStatusLabels, data.students?.total, 'No learner status data.');
      renderDistribution('staffByType', data.staff?.by_type, staffTypeLabels, data.staff?.total, 'No staff type data.');
      document.getElementById('attendanceSummary').innerHTML = unrecorded
        ? MGAEMS.emptyStateHTML('No attendance recorded today', 'Missing records are unrecorded. They are not counted as absent.', 'calendar-check')
        : validCount(attendance.recorded) && Number(attendance.recorded) > 0 && validRate ? `<div class="report-chart-row"><span>Present / recorded</span><meter min="0" max="100" value="${attendance.rate}" aria-label="Present as a percentage of recorded attendance">${attendance.rate}%</meter><strong>${attendance.rate}%</strong></div><p class="report-note">${count(attendance.recorded)} attendance records for ${esc(attendance.date || 'the returned school date')}. Late and Excused records are included in the recorded total; the rate counts Present only.</p>` : MGAEMS.errorHTML('Attendance statistics are unavailable.');
      document.getElementById('sponsorshipSummary').innerHTML = validCount(data.active_sponsorships) ? `<div class="report-result-card"><div class="report-result-meta"><strong>${count(data.active_sponsorships)} active sponsorships</strong><small>Current active total from the sponsorship register.</small></div><i data-lucide="heart-handshake" aria-hidden="true"></i></div>` : MGAEMS.errorHTML('The active sponsorship total is unavailable.');
      const distributionReady = value => isRecord(value) && Object.values(value).every(validCount);
      if (![data.students?.total, data.staff?.total, data.active_sponsorships].every(validCount) || !distributionReady(data.students?.by_status) || !distributionReady(data.staff?.by_type) || !(unrecorded || validCount(attendance.recorded) && Number(attendance.recorded) > 0 && validRate)) {
        document.getElementById('overviewError').innerHTML = MGAEMS.errorHTML('Some statistics are unavailable. Reload to check the current register totals.') + '<button type="button" class="btn btn-secondary" id="retryOverview">Retry statistics</button>';
        document.getElementById('retryOverview').addEventListener('click', loadSchoolOverview);
      }
      MGAEMS.initIcons();
    }

    function renderDistribution(targetId, values, labels, total, emptyMessage) {
      const target = document.getElementById(targetId);
      if (!isRecord(values) || !validCount(total) || Object.values(values).some(value => !validCount(value))) { target.innerHTML = MGAEMS.errorHTML('This distribution is unavailable.'); return; }
      const entries = Object.entries(values).sort((a, b) => Number(b[1]) - Number(a[1]));
      if (!entries.length) {
        target.innerHTML = MGAEMS.emptyStateHTML(emptyMessage, '', 'chart-no-axes-column');
        return;
      }
      target.innerHTML = entries.map(([key, value]) => {
        const amount = Number(value);
        return `<div class="report-chart-row"><span>${esc(labels[key] || key)}</span><meter min="0" max="${Math.max(1, Number(total), amount)}" value="${amount}" aria-label="${esc(labels[key] || key)} out of register total">${amount}</meter><strong>${amount}</strong></div>`;
      }).join('');
    }

    async function loadLookups() {
      if (!current()) return;
      const request = ++state.lookupRequest;
      state.lookupsReady = false;
      resetStudentPreview();
      clearReportCardResult();
      state.studentRequest++;
      state.studentsReady = false;
      state.studentsLoading = false;
      state.students = [];
      document.getElementById('cardStudent').disabled = true;
      document.getElementById('cardStudent').innerHTML = '<option value="">Select class first…</option>';
      document.getElementById('cardLearnerCount').textContent = '';
      document.getElementById('studentPageBar').hidden = true;
      ['exportClass', 'cardClass', 'cardYear', 'cardTerm', 'previewStudentReport'].forEach(id => { document.getElementById(id).disabled = true; });
      document.getElementById('reportCardLookupError').innerHTML = MGAEMS.loadingHTML('Loading class and academic filters…');
      document.getElementById('reportExportLookupError').innerHTML = MGAEMS.loadingHTML('Loading class filters…');
      const [classesResult, yearsResult, termsResult] = await Promise.all([
        MGAEMS.get('/api/v1/classes'),
        MGAEMS.get('/api/v1/academic-years'),
        MGAEMS.get('/api/v1/terms'),
      ]);
      if (!current() || request !== state.lookupRequest) return;
      const lookupErrors = [];
      document.getElementById('reportExportLookupError').innerHTML = '';
      document.getElementById('reportCardLookupError').innerHTML = '';
      if (classesResult.ok && validLookups(classesResult.data)) {
        state.classes = classesResult.data;
        state.lookupsReady = true;
        const options = state.classes.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
        document.getElementById('exportClass').innerHTML = '<option value="">All classes</option>' + options;
        document.getElementById('cardClass').innerHTML = `<option value="">${state.classes.length ? 'Select class…' : 'No classes configured'}</option>` + options;
        document.getElementById('exportClass').disabled = false;
        document.getElementById('cardClass').disabled = !state.classes.length;
        document.getElementById('previewStudentReport').disabled = false;
      } else {
        state.classes = [];
        const message = classesResult.status === 403 ? 'You do not have permission to load class filters.' : classesResult.error || 'Class filters could not be loaded.';
        document.getElementById('reportExportLookupError').innerHTML = MGAEMS.errorHTML(message) + (![401, 403].includes(classesResult.status) ? '<button type="button" class="btn btn-secondary" id="retryExportLookups">Retry class filters</button>' : '');
        document.getElementById('retryExportLookups')?.addEventListener('click', loadLookups);
        ['exportClass', 'cardClass'].forEach(id => { document.getElementById(id).innerHTML = '<option value="">Classes unavailable</option>'; });
        lookupErrors.push(message);
      }
      if (yearsResult.ok && validLookups(yearsResult.data)) {
        state.years = yearsResult.data;
        document.getElementById('cardYear').innerHTML = `<option value="">${state.years.length ? 'All years' : 'No academic years configured'}</option>` + state.years.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
        document.getElementById('cardYear').disabled = !state.years.length;
      } else { state.years = []; document.getElementById('cardYear').innerHTML = '<option value="">Years unavailable</option>'; lookupErrors.push(yearsResult.status === 403 ? 'You do not have permission to load academic years.' : yearsResult.error || 'Academic year filters could not be loaded.'); }
      if (termsResult.ok && validLookups(termsResult.data) && termsResult.data.every(term => validId(term.academic_year_id))) {
        state.terms = termsResult.data;
        updateCardTerms();
      } else { state.terms = []; document.getElementById('cardTerm').innerHTML = '<option value="">Terms unavailable</option>'; lookupErrors.push(termsResult.status === 403 ? 'You do not have permission to load terms.' : termsResult.error || 'Term filters could not be loaded.'); }
      if (lookupErrors.length) {
        document.getElementById('reportCardLookupError').innerHTML = MGAEMS.errorHTML(lookupErrors.join(' ')) + (![classesResult, yearsResult, termsResult].some(result => [401, 403].includes(result.status)) ? '<button type="button" class="btn btn-secondary" id="retryReportLookups">Retry report filters</button>' : '');
        document.getElementById('retryReportLookups')?.addEventListener('click', loadLookups);
      }
      resetStudentPreview();
      MGAEMS.initIcons();
    }

    function updateCardTerms() {
      if (!current()) return;
      const yearId = document.getElementById('cardYear').value;
      const terms = state.terms.filter(term => !yearId || String(term.academic_year_id) === yearId);
      const select = document.getElementById('cardTerm');
      select.innerHTML = `<option value="">${terms.length ? 'Select term…' : 'No terms available'}</option>` + terms.map(term => `<option value="${esc(term.id)}">${esc(term.name)}${term.academic_year?.name ? ` · ${esc(term.academic_year.name)}` : ''}</option>`).join('');
      select.disabled = !terms.length;
      clearReportCardResult();
    }

    async function previewStudentReport() {
      if (!current() || !state.lookupsReady || state.exportDownloading) return;
      const request = ++state.exportRequest;
      const button = document.getElementById('previewStudentReport');
      const preview = document.getElementById('studentExportPreview');
      const filters = studentFilterParams().toString();
      const page = state.exportPage;
      state.exportPreview = null;
      state.exportRows = [];
      document.getElementById('downloadStudentReport').disabled = true;
      button.disabled = true;
      button.textContent = 'Checking…';
      preview.setAttribute('aria-busy', 'true');
      preview.innerHTML = MGAEMS.loadingHTML('Checking matching students…');
      const params = new URLSearchParams(filters);
      params.set('per_page', '25');
      params.set('page', String(page));
      const result = await MGAEMS.get('/api/v1/students?' + params.toString());
      if (!current() || request !== state.exportRequest || filters !== studentFilterParams().toString() || page !== state.exportPage) return;
      preview.setAttribute('aria-busy', 'false');
      button.disabled = false;
      button.innerHTML = '<i data-lucide="list-checks" aria-hidden="true"></i> Preview results';
      MGAEMS.initIcons();
      const classId = document.getElementById('exportClass').value;
      const status = document.getElementById('exportStatus').value;
      if (!result.ok || !validLearners(result.data) || !isRecord(result.meta) || !validCount(result.meta.total) || Number(result.meta.total) < result.data.length || result.data.length > 25 || result.data.some(row => (classId && row.class_id != null && String(row.class_id) !== classId) || (status && row.status !== status))) {
        state.exportPreview = null;
        preview.innerHTML = MGAEMS.errorHTML(result.status === 403 ? 'You do not have permission to view student reports.' : result.error || 'The preview response did not match these filters.') + (![401, 403].includes(result.status) ? '<button type="button" class="btn btn-secondary" id="retryStudentPreview">Retry preview</button>' : '');
        document.getElementById('retryStudentPreview')?.addEventListener('click', previewStudentReport);
        document.getElementById('downloadStudentReport').disabled = true;
        MGAEMS.initIcons();
        return;
      }
      state.exportPreview = Number(result.meta.total);
      state.exportRows = result.data;
      if (!state.exportPreview) {
        preview.innerHTML = MGAEMS.emptyStateHTML('No students match these filters', 'Change the class or status filters and preview again.', 'users');
        document.getElementById('downloadStudentReport').disabled = true;
      } else {
        const totalPages = Math.max(1, Math.ceil(state.exportPreview / 25));
        preview.innerHTML = `<p class="report-preview-summary" role="status">${state.exportPreview} learner record${state.exportPreview === 1 ? '' : 's'} match the selected filters. Excel downloads all matching records, across every page.</p>${state.exportRows.length ? `<div class="table-scroll"><table class="report-preview-table"><caption>Matching learner register · preview page ${page}</caption><thead><tr><th scope="col">Admission number</th><th scope="col">Learner</th><th scope="col">Class</th><th scope="col">Status</th></tr></thead><tbody>${state.exportRows.map(row => `<tr><td>${esc(row.admission_no)}</td><td>${esc(row.first_name)} ${esc(row.last_name)}</td><td>${esc(row.school_class?.name || state.classes.find(item => String(item.id) === String(row.class_id))?.name || 'Not available')}</td><td><span class="badge badge-gray">${esc(reportStatusLabels[row.status] || 'Not available')}</span></td></tr>`).join('')}</tbody></table></div>` : MGAEMS.emptyStateHTML('No learners on this page', 'Choose the previous page to continue reviewing the filtered register.', 'users')}<div class="report-pagination"><span>Page ${page} of ${totalPages} · ${state.exportRows.length} records on this page</span><span class="report-page-controls"><button type="button" class="btn btn-secondary" data-export-page="-1" ${page <= 1 ? 'disabled' : ''}>Previous</button><button type="button" class="btn btn-secondary" data-export-page="1" ${page >= totalPages ? 'disabled' : ''}>Next</button></span></div>`;
        preview.querySelectorAll('[data-export-page]').forEach(control => control.addEventListener('click', () => {
          const next = state.exportPage + Number(control.dataset.exportPage);
          if (!current() || state.exportDownloading || control.disabled || next < 1 || next > totalPages) return;
          state.exportPage = next;
          previewStudentReport();
        }));
        document.getElementById('downloadStudentReport').disabled = false;
      }
      MGAEMS.initIcons();
    }

    async function downloadStudentReport() {
      if (!current() || !state.exportPreview || state.exportDownloading) return;
      state.exportDownloading = true;
      const button = document.getElementById('downloadStudentReport');
      const controls = [...['exportClass', 'exportStatus', 'previewStudentReport'].map(id => document.getElementById(id)), ...document.getElementById('studentExportPreview').querySelectorAll('[data-export-page]')].map(control => [control, control.disabled]);
      controls.forEach(([control]) => { control.disabled = true; });
      const request = state.exportRequest;
      const filters = studentFilterParams().toString();
      const feedback = document.getElementById('excelDownloadFeedback');
      button.disabled = true;
      button.textContent = 'Preparing Excel…';
      feedback.textContent = 'Preparing all matching learner records…';
      let result;
      try { result = await MGAEMS.download('/api/v1/reports/students/export?' + filters, 'students-report.xlsx', { isCurrent: () => current() && request === state.exportRequest && filters === studentFilterParams().toString() }); }
      catch { result = { ok: false, error: 'The Excel download failed. Please try again.' }; }
      state.exportDownloading = false;
      if (!current()) return;
      controls.forEach(([control, disabled]) => { control.disabled = disabled; });
      if (request !== state.exportRequest || filters !== studentFilterParams().toString()) return;
      button.disabled = false;
      button.innerHTML = '<i data-lucide="download" aria-hidden="true"></i> Download Excel';
      MGAEMS.initIcons();
      if (!result.ok) {
        MGAEMS.toast(result.status === 403 ? 'You do not have permission to export student reports.' : result.error, 'error');
        feedback.innerHTML = MGAEMS.errorHTML(result.error || 'The Excel file could not be downloaded. Retry the download.');
        return;
      }
      feedback.textContent = 'Learner register downloaded as Excel.';
      MGAEMS.toast('Learner register downloaded as Excel.', 'success');
    }

    function studentFilterParams() {
      const params = new URLSearchParams();
      const classId = document.getElementById('exportClass').value;
      const status = document.getElementById('exportStatus').value;
      if (classId) params.set('class_id', classId);
      if (status) params.set('status', status);
      return params;
    }

    function resetStudentPreview() {
      if (!current()) return;
      state.exportRequest++;
      state.exportPage = 1;
      state.exportRows = [];
      state.exportPreview = null;
      document.getElementById('previewStudentReport').disabled = !state.lookupsReady || state.exportDownloading;
      document.getElementById('previewStudentReport').innerHTML = '<i data-lucide="list-checks" aria-hidden="true"></i> Preview results';
      document.getElementById('downloadStudentReport').disabled = true;
      document.getElementById('studentExportPreview').setAttribute('aria-busy', 'false');
      document.getElementById('excelDownloadFeedback').textContent = '';
      document.getElementById('studentExportPreview').innerHTML = MGAEMS.emptyStateHTML('Preview required', 'Preview the matching students before downloading.', 'file-spreadsheet');
      MGAEMS.initIcons();
    }

    async function loadCardStudents() {
      if (!current()) return;
      const requestId = ++state.studentRequest;
      const page = state.studentPage;
      const classId = document.getElementById('cardClass').value;
      const select = document.getElementById('cardStudent');
      state.students = [];
      state.studentTotal = 0;
      state.studentsLoading = false;
      state.studentsReady = false;
      select.disabled = true;
      select.innerHTML = '<option value="">Select learner…</option>';
      document.getElementById('cardLearnerSearch').value = '';
      document.getElementById('cardLearnerCount').textContent = '';
      clearReportCardResult();
      const pageBar = document.getElementById('studentPageBar');
      pageBar.hidden = true;
      if (!classId) return;
      if (!state.classes.some(row => String(row.id) === classId)) { document.getElementById('reportCardResult').innerHTML = MGAEMS.errorHTML('Select an available class.'); return; }
      state.studentsLoading = true;
      select.innerHTML = '<option value="">Loading learners…</option>';
      const result = await MGAEMS.get(`/api/v1/students?class_id=${encodeURIComponent(classId)}&per_page=100&page=${page}`);
      if (!current() || requestId !== state.studentRequest || classId !== document.getElementById('cardClass').value || page !== state.studentPage) return;
      state.studentsLoading = false;
      if (!result.ok || !Array.isArray(result.data) || result.data.some(student => !isRecord(student) || !validId(student.id) || !['first_name', 'last_name', 'admission_no'].every(key => typeof student[key] === 'string') || (student.class_id != null && String(student.class_id) !== classId)) || !isRecord(result.meta) || !Number.isInteger(result.meta.total) || result.meta.total < result.data.length) {
        select.innerHTML = '<option value="">Unable to load learners</option>';
        const target = document.getElementById('reportCardResult');
        target.innerHTML = MGAEMS.errorHTML(result.status === 403 ? 'You do not have permission to view these learners.' : result.error || 'Learners could not be loaded.') + (![401, 403].includes(result.status) ? '<button type="button" class="btn btn-secondary" data-retry>Retry learner selection</button>' : '');
        target.querySelector('[data-retry]')?.addEventListener('click', loadCardStudents);
        MGAEMS.initIcons();
        return;
      }
      state.students = result.data;
      state.studentsReady = true;
      state.studentTotal = result.meta?.total ?? result.data.length;
      if (!state.students.length) {
        select.innerHTML = '<option value="">No learners on this page</option>';
        document.getElementById('cardLearnerCount').textContent = '0 learners on this page';
        renderStudentPagination();
        document.getElementById('reportCardResult').innerHTML = MGAEMS.emptyStateHTML('No learners on this page', 'Choose another class or learner page. Existing reports remain unchanged.', 'users');
        MGAEMS.initIcons();
        return;
      }
      renderLearnerChoices();
      renderStudentPagination();
    }

    function renderLearnerChoices() {
      if (!current() || state.studentsLoading || !state.studentsReady) return;
      const select = document.getElementById('cardStudent');
      const previous = select.value;
      const query = document.getElementById('cardLearnerSearch').value.trim().toLowerCase();
      const matches = state.students.filter(student => !query || [student.first_name, student.last_name, student.admission_no].join(' ').toLowerCase().includes(query));
      select.innerHTML = '<option value="">Select learner…</option>' + matches.map(student => `<option value="${esc(student.id)}" ${String(student.id) === previous ? 'selected' : ''}>${esc(student.first_name)} ${esc(student.last_name)} · ${esc(student.admission_no)}${student.status && student.status !== 'active' ? ` · ${esc(reportStatusLabels[student.status] || student.status)}` : ''}</option>`).join('');
      select.disabled = !matches.length;
      document.getElementById('cardLearnerCount').textContent = `${matches.length} of ${state.students.length} learners on this page`;
      if (previous && !matches.some(student => String(student.id) === previous)) clearReportCardResult();
    }

    function renderStudentPagination() {
      if (!current()) return;
      const pageBar = document.getElementById('studentPageBar');
      const totalPages = Math.max(1, Math.ceil(state.studentTotal / 100));
      pageBar.hidden = totalPages <= 1 && state.studentPage <= 1;
      if (pageBar.hidden) return;
      pageBar.innerHTML = `<span>Page ${state.studentPage} of ${totalPages}</span><span class="flex gap-2"><button class="btn btn-secondary btn-sm" type="button" data-student-page="-1" aria-label="Previous learner page" ${state.studentPage <= 1 ? 'disabled' : ''}><i data-lucide="chevron-left" aria-hidden="true"></i></button><button class="btn btn-secondary btn-sm" type="button" data-student-page="1" aria-label="Next learner page" ${state.studentPage >= totalPages ? 'disabled' : ''}><i data-lucide="chevron-right" aria-hidden="true"></i></button></span>`;
      pageBar.querySelectorAll('[data-student-page]').forEach(button => button.addEventListener('click', () => {
        if (!current() || button.disabled) return;
        state.studentPage += Number(button.dataset.studentPage);
        loadCardStudents();
      }));
      MGAEMS.initIcons();
    }

    async function loadSelectedReportCard() {
      if (!current()) return;
      const studentId = document.getElementById('cardStudent').value;
      const termId = document.getElementById('cardTerm').value;
      const target = document.getElementById('reportCardResult');
      if (!studentId || !termId) { clearReportCardResult(); return; }
      if (!state.students.some(row => String(row.id) === studentId) || !state.terms.some(row => String(row.id) === termId)) { clearReportCardResult(); target.innerHTML = MGAEMS.errorHTML('Select an available learner and term.'); return; }
      const requestId = ++state.cardRequest;
      state.downloadingCardId = null;
      state.selectedCard = null;
      target.setAttribute('aria-busy', 'true');
      target.innerHTML = MGAEMS.loadingHTML('Checking for an existing report card…');
      const result = await MGAEMS.get(`/api/v1/report-cards?student_id=${encodeURIComponent(studentId)}&term_id=${encodeURIComponent(termId)}`);
      if (!current() || requestId !== state.cardRequest) return;
      target.setAttribute('aria-busy', 'false');
      if (!result.ok || (result.data !== null && (!isRecord(result.data) || !validId(result.data.id) || !Number.isInteger(result.data.revision_number) || result.data.revision_number < 0 || typeof result.data.download_available !== 'boolean' || !['versioned', 'legacy_artifact'].includes(result.data.history_state) || (result.data.student_id != null && String(result.data.student_id) !== studentId) || (result.data.term_id != null && String(result.data.term_id) !== termId) || (result.data.student?.id != null && String(result.data.student.id) !== studentId) || (result.data.term?.id != null && String(result.data.term.id) !== termId)))) {
        state.selectedCard = null;
        target.innerHTML = MGAEMS.errorHTML(result.status === 403 ? 'You do not have permission to view report cards.' : result.error || 'The report response did not match this learner and term.') + (![401, 403].includes(result.status) ? '<button type="button" class="btn btn-secondary" data-retry>Retry report lookup</button>' : '');
        target.querySelector('[data-retry]')?.addEventListener('click', loadSelectedReportCard);
        MGAEMS.initIcons();
        return;
      }
      state.selectedCard = result.data;
      if (!result.data) {
        target.innerHTML = MGAEMS.emptyStateHTML('No report card found', 'This student and term do not have an existing report-card record.', 'file-text');
        MGAEMS.initIcons();
        return;
      }
      renderReportCard(result.data);
    }

    function renderReportCard(card) {
      if (!current()) return;
      const target = document.getElementById('reportCardResult');
      const generated = card.generated_at ? formatDateTime(card.generated_at) : 'Date unavailable';
      target.innerHTML = `<div class="card report-current-card">
        <div class="report-result-meta">
          <h2>${esc(card.student ? `${card.student.first_name} ${card.student.last_name}` : 'Report Card')}</h2>
          <small>${esc(card.student?.admission_no || '')}${card.term?.name ? ` · ${esc(card.term.name)}` : ''}</small>
          <span class="badge ${card.download_available ? 'badge-green' : 'badge-amber'}">${card.download_available ? 'PDF available' : 'Record only'}</span>
          <dl class="report-publication-summary"><div><dt>Generated</dt><dd>${esc(generated)}</dd></div><div><dt>Revision</dt><dd>${esc(card.revision_number)}</dd></div><div><dt>History</dt><dd>${esc(card.history_state === 'versioned' ? 'Retained revisions' : card.history_state === 'legacy_artifact' ? 'Legacy artifact' : 'Not available')}</dd></div></dl>
          ${card.overall_remark ? `<p class="report-remark">${esc(card.overall_remark)}</p>` : ''}
        </div>
        <div class="report-card-actions">${card.download_available ? '<button class="btn btn-primary" type="button" id="downloadReportCard"><i data-lucide="download" aria-hidden="true"></i> Download latest PDF</button>' : '<span class="report-state-note">No PDF file is available for this record.</span>'}<button type="button" class="btn btn-secondary" id="retainedReportHistory">Retained revisions</button></div><div class="report-download-feedback" id="reportDownloadState" role="status"></div>
      </div>`;
      document.getElementById('downloadReportCard')?.addEventListener('click', downloadReportCard);
      document.getElementById('retainedReportHistory').addEventListener('click', () => { if (current() && state.selectedCard?.id === card.id) MGAEMS.openReportHistory(card.id, document.getElementById('retainedReportHistory')); });
      MGAEMS.initIcons();
    }

    async function downloadReportCard() {
      const card = state.selectedCard;
      if (!current() || !card?.id || !card.download_available || state.downloadingCardId !== null) return;
      state.downloadingCardId = card.id;
      const request = state.cardRequest;
      const student = card.student;
      const filename = `report-card-${student?.admission_no || card.student_id}.pdf`;
      const button = document.getElementById('downloadReportCard');
      button.disabled = true;
      button.textContent = 'Downloading…';
      const feedback = document.getElementById('reportDownloadState');
      feedback.textContent = 'Downloading the latest available PDF…';
      let result;
      try { result = await MGAEMS.download(`/api/v1/report-cards/${encodeURIComponent(card.id)}/download`, filename, { isCurrent: () => current() && state.selectedCard?.id === card.id && document.getElementById('downloadReportCard') === button }); }
      catch { result = { ok: false, error: 'The PDF download failed. Please try again.' }; }
      if (request === state.cardRequest && state.downloadingCardId === card.id) state.downloadingCardId = null;
      if (!current() || state.selectedCard?.id !== card.id || document.getElementById('downloadReportCard') !== button) return;
      if (!result.ok) {
        MGAEMS.toast(result.status === 403 ? 'You do not have permission to download this report card.' : result.error, 'error');
        feedback.innerHTML = MGAEMS.errorHTML(result.error || 'The PDF could not be downloaded. Try again.');
        button.disabled = false;
        button.innerHTML = '<i data-lucide="download"></i> Download PDF';
        MGAEMS.initIcons();
        return;
      }
      MGAEMS.toast('Report-card PDF downloaded.', 'success');
      feedback.textContent = 'Report-card PDF downloaded.';
      button.disabled = false;
      button.innerHTML = '<i data-lucide="download"></i> Download PDF';
      MGAEMS.initIcons();
    }

    function clearReportCardResult() {
      if (!current()) return;
      state.cardRequest++;
      state.downloadingCardId = null;
      state.selectedCard = null;
      const target = document.getElementById('reportCardResult');
      if (target) { target.setAttribute('aria-busy', 'false'); target.innerHTML = MGAEMS.emptyStateHTML('Select a learner and term', 'Existing report-card status will appear here.', 'file-text'); }
      MGAEMS.initIcons();
    }

    loadSchoolOverview();
    loadLookups();
  }

})();
