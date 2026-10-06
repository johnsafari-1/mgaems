/* Leadership-only retained report revision viewer, shared by Assessment/Reports. */
MGAEMS.openReportHistory = (cardId, trigger) => {
  const esc = MGAEMS.escapeHTML;
  const modal = MGAEMS.openModal({ title: 'Retained report revisions', trigger, body: MGAEMS.loadingHTML('Loading revisions…') });
  let page = 1, sequence = 0;
  async function load() {
    const request = ++sequence;
    const result = await MGAEMS.get('/api/v1/report-cards/' + encodeURIComponent(cardId) + '/revisions?page=' + page);
    if (request !== sequence || modal.closed) return;
    if (!result.ok) {
      modal.body.innerHTML = MGAEMS.errorHTML(result.error) + '<button type="button" class="btn btn-secondary" data-retry>Try again</button>';
      modal.body.querySelector('[data-retry]').addEventListener('click', load); return;
    }
    modal.body.innerHTML = `<p class="text-muted">Regeneration retains earlier PDFs. Legacy artifacts have unknown source snapshots.</p>${result.data.length ? `<div class="table-scroll"><table><thead><tr><th scope="col">Revision</th><th scope="col">Generated</th><th scope="col">Provenance</th><th scope="col">Sources</th><th scope="col">PDF</th></tr></thead><tbody>${result.data.map(row => `<tr><td>${esc(row.revision_number)}</td><td>${esc(row.generated_at || 'Unknown')}</td><td>${esc(row.provenance)}</td><td>${esc(row.source_count ?? 'Unknown')}</td><td>${row.download_available ? `<button type="button" class="btn btn-secondary btn-sm" data-download="${esc(row.id)}" data-number="${esc(row.revision_number)}">Download retained PDF</button>` : 'No retained file'}</td></tr>`).join('')}</tbody></table></div>` : MGAEMS.emptyStateHTML('No revision metadata yet', 'An existing legacy PDF remains downloadable from the latest report. Its metadata is retained when a new revision is generated.', 'file-text')}
      <div class="pagination"><span>${esc(result.meta.total)} revisions · Page ${esc(page)}</span><div class="form-actions"><button type="button" class="btn btn-secondary btn-sm" data-page="-1" ${page <= 1 ? 'disabled' : ''}>Previous</button><button type="button" class="btn btn-secondary btn-sm" data-page="1" ${page * result.meta.per_page >= result.meta.total ? 'disabled' : ''}>Next</button></div></div>`;
    modal.body.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { page += Number(button.dataset.page); load(); }));
    modal.body.querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', async () => {
      modal.setBusy(true);
      const response = await MGAEMS.download(`/api/v1/report-cards/${encodeURIComponent(cardId)}/revisions/${encodeURIComponent(button.dataset.download)}/download`, `report-card-r${button.dataset.number}.pdf`);
      modal.setBusy(false); if (!response.ok) MGAEMS.toast(response.error, 'error');
    }));
    MGAEMS.initIcons();
  }
  load(); return modal;
};
