/* Leadership-only retained report revision viewer, shared by Assessment/Reports. */
MGAEMS.openReportHistory = (cardId, trigger) => {
  const esc = MGAEMS.escapeHTML;
  const leaders = ['system_admin', 'head_teacher', 'deputy_head_teacher'];
  if (!leaders.includes(MGAEMS.currentUser()?.role)) {
    return MGAEMS.openModal({ title: 'Report revisions restricted', trigger,
      body: MGAEMS.errorHTML('Report cards and retained revisions are managed by authorized school leadership.') });
  }
  if (!/^\d+$/.test(String(cardId)) || Number(cardId) <= 0) {
    return MGAEMS.openModal({ title: 'Report unavailable', trigger,
      body: MGAEMS.errorHTML('Select an existing report card before opening retained revisions.') });
  }

  let page = 1, sequence = 0, loading = false, downloading = false;
  const modal = MGAEMS.openModal({ title: 'Retained report revisions', trigger,
    body: MGAEMS.loadingHTML('Loading retained revisions…'), onClose: () => { sequence++; } });
  const formatDate = value => {
    const date = value ? new Date(value) : null;
    return !date || Number.isNaN(date.getTime()) ? 'Date unavailable'
      : new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(date);
  };
  const provenance = value => value === 'captured' ? 'Captured assessment snapshot'
    : value === 'legacy_artifact' ? 'Legacy PDF · sources unknown' : value || 'Source information unavailable';

  async function load() {
    if (modal.closed || loading || downloading) return;
    const request = ++sequence, requestedPage = page;
    loading = true;
    modal.body.innerHTML = MGAEMS.loadingHTML('Loading retained revisions…');
    let result;
    try { result = await MGAEMS.get('/api/v1/report-cards/' + encodeURIComponent(cardId) + '/revisions?page=' + requestedPage); }
    catch (_) { result = { ok: false, error: 'Retained revisions could not be loaded. Please try again.' }; }
    if (request !== sequence || modal.closed) return;
    loading = false;
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!object(result) || typeof result.ok !== 'boolean' || (result.ok && (
      !Array.isArray(result.data) || !result.data.every(object) || !object(result.meta)
      || !Number.isInteger(result.meta.total) || result.meta.total < 0
      || !Number.isInteger(result.meta.per_page) || result.meta.per_page <= 0
      || result.meta.total < result.data.length || result.meta.per_page < result.data.length
      || (result.meta.page !== undefined && (!Number.isInteger(result.meta.page) || result.meta.page !== requestedPage))
    ))) {
      result = { ok: false, error: 'The revision history response could not be read. Please try again.' };
    }
    if (!result.ok) {
      const denied = [401, 403].includes(result.status);
      modal.body.innerHTML = `<div class="report-revisions">${MGAEMS.errorHTML(result.error || 'Retained revisions are unavailable.')}<p class="report-state-note">${denied ? 'An active leadership session is required to view these revisions.' : 'The report has not been changed. Try loading its revision history again.'}</p>${denied ? '' : '<button type="button" class="btn btn-secondary" data-retry>Try again</button>'}</div>`;
      modal.body.querySelector('[data-retry]')?.addEventListener('click', () => {
        modal.body.setAttribute('tabindex', '-1'); modal.body.focus(); load();
      });
      return;
    }
    const rows = result.data;
    const total = result.meta.total, perPage = result.meta.per_page;
    modal.body.innerHTML = `<section class="report-revisions" aria-label="Retained report revision history">
      <p class="report-state-note">Regeneration retains earlier PDFs. Legacy artifacts have unknown source snapshots. Generation times use Nairobi time.</p>
      ${rows.length ? `<ol class="report-revision-list">${rows.map(row => `<li class="report-revision-card">
        <div class="report-revision-heading"><h3>Revision ${esc(row.revision_number)}</h3><span class="badge ${row.download_available ? 'badge-green' : 'badge-amber'}">${row.download_available ? 'PDF available' : 'Record only'}</span></div>
        <dl class="report-revision-meta"><div><dt>Generated</dt><dd>${esc(formatDate(row.generated_at))}</dd></div><div><dt>Provenance</dt><dd>${esc(provenance(row.provenance))}</dd></div><div><dt>Assessment sources</dt><dd>${row.source_count == null ? 'Unknown' : esc(row.source_count)}</dd></div></dl>
        ${row.provenance === 'legacy_artifact' ? '<p class="report-revision-note">The original PDF was retained; its assessment source snapshot was not recorded.</p>' : ''}
        <div class="report-revision-actions">${row.download_available ? `<button type="button" class="btn btn-secondary" data-download="${esc(row.id)}" data-number="${esc(row.revision_number)}" aria-label="Download retained PDF for revision ${esc(row.revision_number)}"><i data-lucide="download" aria-hidden="true"></i> Download retained PDF</button>` : '<p class="report-revision-note">No retained file is available for this revision.</p>'}<p class="report-download-feedback" data-feedback role="status" aria-live="polite"></p></div>
      </li>`).join('')}</ol>` : MGAEMS.emptyStateHTML('No revision metadata yet', 'Any available legacy PDF remains downloadable from the latest report. Revision metadata is retained when a new revision is generated.', 'file-text')}
      <nav class="report-history-pagination" aria-label="Report revision pages"><span>${esc(total)} revisions · Page ${esc(requestedPage)}</span><div class="form-actions"><button type="button" class="btn btn-secondary" data-page="-1" ${requestedPage <= 1 ? 'disabled' : ''}>Previous</button><button type="button" class="btn btn-secondary" data-page="1" ${requestedPage * perPage >= total ? 'disabled' : ''}>Next</button></div></nav>
    </section>`;
    modal.body.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => {
      if (loading || downloading || button.disabled || modal.closed) return;
      page = Math.max(1, requestedPage + Number(button.dataset.page));
      modal.body.setAttribute('tabindex', '-1'); modal.body.focus();
      load();
    }));
    modal.body.querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', async () => {
      if (downloading || loading || modal.closed) return;
      downloading = true;
      const feedback = button.parentElement.querySelector('[data-feedback]');
      feedback.textContent = `Preparing revision ${button.dataset.number} PDF…`;
      modal.setBusy(true);
      let response;
      try {
        response = await MGAEMS.download(`/api/v1/report-cards/${encodeURIComponent(cardId)}/revisions/${encodeURIComponent(button.dataset.download)}/download`, `report-card-r${button.dataset.number}.pdf`);
      } catch (_) { response = { ok: false, error: 'The retained PDF could not be downloaded. Please try again.' }; }
      downloading = false;
      modal.setBusy(false);
      if (modal.closed) return;
      feedback.textContent = response.ok ? `Revision ${button.dataset.number} PDF download started.` : response.error || 'The retained PDF is unavailable.';
      feedback.setAttribute('role', response.ok ? 'status' : 'alert');
      if (!response.ok) MGAEMS.toast(response.error || 'The retained PDF is unavailable.', 'error');
    }));
    MGAEMS.initIcons();
  }
  load();
  return modal;
};
