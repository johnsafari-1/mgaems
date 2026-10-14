/* Account-owned history is independent of a selected child or sponsorship programme. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || !['parent_guardian', 'sponsor'].includes(user.role)) return;
  const page = user.role === 'parent_guardian' ? '/parent-portal.html' : '/sponsor-portal.html';
  const main = document.getElementById('appMain');
  if (!main || window.location.pathname !== page || document.getElementById('portalAccountMessages')) return;
  const positiveID = value => (typeof value === 'number' || typeof value === 'string' && /^[1-9]\d*$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  if (!positiveID(user.id)) return;
  const esc = MGAEMS.escapeHTML, sessionCurrent = MGAEMS.sessionGuard();
  const state = { rows: null, request: 0, loading: false, modal: null, invalidated: false };
  const section = document.createElement('section');
  section.setAttribute('id', 'portalAccountMessages');
  section.setAttribute('class', 'card portal-account-messages');
  section.setAttribute('aria-labelledby', 'portalMessageHeading');
  section.setAttribute('tabindex', '-1');
  section.innerHTML = `<div class="portal-message-heading"><div><h2 id="portalMessageHeading">Your account messages</h2><p class="text-muted">Received and sent messages belonging to your account. Switching a child or programme does not change this inbox. This portal provides history and explicit read acknowledgements, with no compose or reply action.</p></div><button type="button" class="btn btn-secondary" id="portalMessageRefresh">Refresh messages</button></div><div class="portal-message-toolbar"><div class="field"><label for="portalMessageSearch">Search your messages</label><input type="search" id="portalMessageSearch" placeholder="Participant or message text"></div><div class="field"><label for="portalMessageFilter">Message view</label><select id="portalMessageFilter"><option value="">All owned messages</option><option value="received">Received</option><option value="unread">Unread received</option><option value="read">Read received</option><option value="sent">Sent</option></select></div></div><p id="portalMessageCount" role="status" aria-live="polite"></p><div id="portalMessageList" aria-live="polite" aria-busy="true"></div>`;
  main.appendChild(section);
  const byId = id => section.querySelector('#' + id);
  function invalidate(message) {
    if (!state.invalidated) {
      state.invalidated = true; state.rows = null; ++state.request;
      section.innerHTML = MGAEMS.errorHTML(message);
      if (state.modal && !state.modal.closed) {
        state.modal.body.innerHTML = MGAEMS.errorHTML('This message is no longer available to the current session.');
        state.modal.setBusy(false); state.modal.close();
      }
    }
  }
  function current() {
    if (sessionCurrent() && window.location.pathname === page && !state.invalidated) return true;
    invalidate('Your session changed. Reopen your authorized portal to read account messages.');
    return false;
  }
  const owned = row => String(row.sender_id) === String(user.id) || String(row.recipient_id) === String(user.id);
  const incoming = row => String(row.recipient_id) === String(user.id);
  const unread = row => incoming(row) && !row.read_at;
  const participant = row => (incoming(row) ? row.sender?.username : row.recipient?.username) || `Account #${incoming(row) ? row.sender_id : row.recipient_id}`;
  const status = row => unread(row) ? 'Unread received' : incoming(row) ? 'Read received' : row.read_at ? 'Read by recipient' : 'Sent';
  const valid = row => row && typeof row === 'object' && !Array.isArray(row) && positiveID(row.id) && positiveID(row.sender_id) && positiveID(row.recipient_id) && typeof row.body === 'string' && (row.read_at == null || typeof row.read_at === 'string' && Number.isFinite(Date.parse(row.read_at)));
  const date = value => {
    if (!value || !Number.isFinite(new Date(value).getTime())) return 'Date unavailable';
    const parsed = new Date(value);
    return `<time datetime="${esc(parsed.toISOString())}">${esc(new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(parsed))}</time>`;
  };
  byId('portalMessageRefresh').addEventListener('click', load);
  byId('portalMessageSearch').addEventListener('input', render);
  byId('portalMessageFilter').addEventListener('change', render);
  window.addEventListener('storage', event => { if (event.key == null || ['mgaems_token', 'mgaems_user'].includes(event.key)) current(); });
  async function load() {
    if (!current()) return;
    const request = ++state.request;
    state.rows = null; state.loading = true;
    byId('portalMessageCount').textContent = 'Loading account messages…';
    byId('portalMessageList').setAttribute('aria-busy', 'true');
    byId('portalMessageList').innerHTML = MGAEMS.loadingHTML('Loading your account messages…');
    const result = await MGAEMS.get('/api/v1/messages');
    if (!current() || request !== state.request) return;
    if (result.status === 401 || result.status === 403) { invalidate('Account message access is unavailable. Reopen your authorized portal or contact the school.'); return; }
    state.loading = false; byId('portalMessageList').setAttribute('aria-busy', 'false');
    if (!result.ok || !Array.isArray(result.data) || !result.data.every(valid) || new Set(result.data.map(row => String(row.id))).size !== result.data.length) {
      byId('portalMessageCount').textContent = 'Account messages unavailable';
      byId('portalMessageList').innerHTML = MGAEMS.errorHTML(result.error || 'Your message history could not be loaded.') + '<button type="button" class="btn btn-secondary" id="portalMessageRetry">Retry messages</button>';
      byId('portalMessageRetry').addEventListener('click', load);
    } else {
      state.rows = result.data.filter(owned).sort((first, second) => (Date.parse(second.sent_at) || 0) - (Date.parse(first.sent_at) || 0));
      render();
    }
    MGAEMS.initIcons();
  }
  function render() {
    if (!current() || state.loading || state.rows === null) return;
    const query = byId('portalMessageSearch').value.trim().toLowerCase(), filter = byId('portalMessageFilter').value;
    const rows = state.rows.filter(row => (!query || [participant(row), row.body].join(' ').toLowerCase().includes(query)) && (!filter || filter === 'received' && incoming(row) || filter === 'unread' && unread(row) || filter === 'read' && incoming(row) && !unread(row) || filter === 'sent' && !incoming(row)));
    const count = state.rows.filter(unread).length;
    byId('portalMessageCount').textContent = `${rows.length} of ${state.rows.length} owned messages · ${count} unread received`;
    byId('portalMessageList').innerHTML = rows.length ? `<div class="portal-message-records">${rows.map(row => `<button type="button" class="portal-message-record ${unread(row) ? 'portal-message-unread' : ''}" data-portal-message="${esc(row.id)}" aria-label="${status(row)} message ${incoming(row) ? 'from' : 'to'} ${esc(participant(row))}"><span class="portal-message-content"><strong>${incoming(row) ? 'From' : 'To'} ${esc(participant(row))}</strong><span class="portal-message-preview">${esc(row.body)}</span></span><span class="portal-message-state"><span class="badge ${unread(row) ? 'badge-amber' : incoming(row) ? 'badge-gray' : 'badge-navy'}">${status(row)}</span>${date(row.sent_at)}</span></button>`).join('')}</div>` : MGAEMS.emptyStateHTML(state.rows.length ? 'No messages match these filters' : 'No account messages', state.rows.length ? 'Change the search or message view.' : 'Messages received or sent by your account will appear here.', 'mail');
    byId('portalMessageList').querySelectorAll('[data-portal-message]').forEach(button => button.addEventListener('click', () => open(button.dataset.portalMessage, button)));
    MGAEMS.initIcons();
  }
  function open(id, trigger) {
    if (!current() || state.modal && !state.modal.closed) return;
    const row = state.rows?.find(item => String(item.id) === String(id));
    if (!row || !owned(row)) return;
    const canRead = unread(row);
    const handle = MGAEMS.openModal({ title: `Message ${incoming(row) ? 'from' : 'to'} ${participant(row)}`, trigger, body: `<div id="portalMessageAlert" role="status"></div><dl class="portal-message-details"><div><dt>${incoming(row) ? 'From' : 'To'}</dt><dd>${esc(participant(row))}</dd></div><div><dt>Sent (school time)</dt><dd>${date(row.sent_at)}</dd></div><div><dt>Status</dt><dd>${status(row)}</dd></div></dl><div class="portal-message-body">${esc(row.body)}</div>`, footer: `<button type="button" class="btn btn-secondary" data-dialog-close>Close</button>${canRead ? '<button type="button" class="btn btn-primary" data-portal-mark-read>Mark as read</button>' : ''}`, onClose: () => { if (state.modal === handle) state.modal = null; } });
    handle.overlay.setAttribute('class', 'modal-overlay portal-message-dialog'); state.modal = handle;
    if (!canRead) return;
    const button = handle.overlay.querySelector('[data-portal-mark-read]'); let saving = false;
    button.addEventListener('click', async () => {
      if (!current() || saving || handle.closed || state.modal !== handle || !unread(row) || !owned(row)) return;
      saving = true; handle.setBusy(true); button.textContent = 'Marking as read…';
      const result = await MGAEMS.patch('/api/v1/messages/' + encodeURIComponent(row.id) + '/read', {});
      if (!current() || handle.closed || state.modal !== handle) { handle.setBusy(false); handle.close(); return; }
      saving = false; handle.setBusy(false); button.textContent = 'Mark as read';
      if (result.status === 401 || result.status === 403) { invalidate('Account message access is unavailable. Reopen your authorized portal or contact the school.'); return; }
      if (!result.ok || !valid(result.data) || String(result.data.id) !== String(row.id) || String(result.data.recipient_id) !== String(user.id) || String(result.data.sender_id) !== String(row.sender_id) || !result.data.read_at) {
        const alert = handle.body.querySelector('#portalMessageAlert');
        alert.innerHTML = MGAEMS.errorHTML(result.error || 'The read status could not be confirmed. Retry or refresh your account messages.'); alert.tabIndex = -1; alert.focus(); MGAEMS.initIcons(); return;
      }
      row.read_at = result.data.read_at;
      const listed = state.rows?.find(item => String(item.id) === String(row.id) && incoming(item));
      if (listed) listed.read_at = result.data.read_at;
      ++state.request;
      handle.close();
      if (state.rows === null) load(); else render();
      MGAEMS.toast('Message marked as read.', 'success');
    });
  }
  MGAEMS.initIcons(); load();
})();
