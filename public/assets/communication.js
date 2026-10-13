/* Role-delivered announcements and owned message history. Laravel authorizes every request. */
(() => {
  const user = MGAEMS.requireAuth();
  if (!user || MGAEMS.landingPage(user) !== '/dashboard.html') return;
  renderAppShell('/communication.html');
  const main = document.getElementById('appMain');
  const receiveRoles = ['system_admin', 'head_teacher', 'deputy_head_teacher', 'sponsor_coordinator', 'teacher', 'student'];
  if (!receiveRoles.includes(user.role)) {
    main.innerHTML = MGAEMS.emptyStateHTML('Communication unavailable', 'Your account does not have access to this workspace.', 'lock-keyhole');
    MGAEMS.initIcons();
    return;
  }
  const canPublish = ['system_admin', 'head_teacher', 'deputy_head_teacher', 'sponsor_coordinator'].includes(user.role);
  const canMessage = ['system_admin', 'head_teacher', 'deputy_head_teacher', 'sponsor_coordinator', 'teacher'].includes(user.role);
  const canSend = canMessage && user.role !== 'sponsor_coordinator';
  const esc = MGAEMS.escapeHTML;
  const identity = () => JSON.stringify([localStorage.getItem('mgaems_token'), MGAEMS.currentUser()?.id, MGAEMS.currentUser()?.role]);
  const initialIdentity = identity();
  const current = () => identity() === initialIdentity && window.location.pathname === '/communication.html';
  const positiveID = value => (typeof value === 'number' || typeof value === 'string' && /^[1-9]\d*$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const validRows = (rows, messages = false) => Array.isArray(rows) && rows.every(row => row && typeof row === 'object' && !Array.isArray(row) && positiveID(row.id) && typeof row.body === 'string' && (messages ? positiveID(row.sender_id) && positiveID(row.recipient_id) : typeof row.title === 'string' && Object.hasOwn(audiences, row.audience)));
  const audiences = { school_wide: 'School-wide', staff: 'Staff', parents: 'Parents / Guardians', sponsors: 'Sponsors' };
  const state = { announcements: null, messages: null, announcementRequest: 0, messageRequest: 0, announcementLoading: true, messageLoading: canMessage, announcementSearch: '', audience: '', messageSearch: '', messageFilter: '', modal: null };
  const incoming = message => String(message.recipient_id) === String(user.id);
  const unread = message => incoming(message) && !message.read_at;
  const messageStatus = message => unread(message) ? 'Unread' : incoming(message) ? 'Read' : message.read_at ? 'Read by recipient' : 'Sent';
  const participant = message => {
    const account = incoming(message) ? message.sender : message.recipient;
    const id = incoming(message) ? message.sender_id : message.recipient_id;
    return account?.username || (id ? `Account #${id}` : 'Participant unavailable');
  };
  const date = value => {
    if (!value) return 'Date unavailable';
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return 'Date unavailable';
    const label = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(parsed);
    return `<time datetime="${esc(parsed.toISOString())}">${esc(label)}</time>`;
  };
  const tabs = [['announcements', 'Announcements'], ...(canMessage ? [['messages', 'Messages']] : [])];
  main.setAttribute('class', 'app-main communication-workspace');
  main.innerHTML = `<div class="page-heading communication-heading"><span class="eyebrow">School communication</span><h1>Communication</h1><p>Read announcements delivered to your role and keep track of your own messages.</p></div>
    <dl class="communication-summary" aria-label="Available communication"><div class="communication-summary-item"><dt>Announcements available</dt><dd id="announcementCount">Loading…</dd></div>${canMessage ? '<div class="communication-summary-item"><dt>Unread received messages</dt><dd id="unreadCount">Loading…</dd></div><div class="communication-summary-item"><dt>Sent and received messages</dt><dd id="totalMessageCount">Loading…</dd></div>' : ''}</dl>
    <div class="communication-tabs"><div class="tabs" role="tablist" aria-label="Communication sections">${tabs.map(([key, title], index) => `<button type="button" class="tab ${index ? '' : 'active'}" id="${key}Tab" role="tab" aria-selected="${index === 0}" aria-controls="${key}Panel" tabindex="${index ? -1 : 0}" data-communication-tab="${key}">${title}${key === 'messages' ? ' <span id="tabUnreadCount"></span>' : ''}</button>`).join('')}</div><div class="communication-actions">${canPublish ? '<button type="button" class="btn btn-primary" id="newAnnouncement"><i data-lucide="megaphone" aria-hidden="true"></i>New announcement</button>' : ''}${canSend ? '<button type="button" class="btn btn-secondary" id="newMessage"><i data-lucide="square-pen" aria-hidden="true"></i>New message</button>' : ''}</div></div>
    <section id="announcementsPanel" role="tabpanel" aria-labelledby="announcementsTab"><div class="communication-panel-heading"><h2>Announcement directory</h2><p class="communication-note">Only announcements available to your audience are listed. Publication dates use school time (Africa/Nairobi).${canPublish ? ' Announcements for other audiences may not appear here after publication.' : ''}</p></div><div class="communication-toolbar"><div class="field"><label for="announcementSearch">Search announcements</label><input id="announcementSearch" type="search" placeholder="Title or announcement text"></div><div class="field"><label for="announcementAudienceFilter">Audience</label><select id="announcementAudienceFilter"><option value="">All available audiences</option>${Object.entries(audiences).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></div></div><p class="communication-result-count" id="announcementResults" role="status"></p><div id="announcementList" aria-busy="true">${MGAEMS.loadingHTML('Loading announcements…')}</div></section>
    ${canMessage ? `<section id="messagesPanel" role="tabpanel" aria-labelledby="messagesTab" hidden><div class="communication-panel-heading"><h2>Your messages</h2><p class="communication-note">Received and sent messages belonging to your account. Opening a message does not automatically mark it as read.</p></div>${!canSend ? '<p class="communication-policy-note">New messages are unavailable until the approved recipient policy is implemented. Use the school’s established contact channels.</p>' : ''}<div class="communication-toolbar"><div class="field"><label for="messageSearch">Search your messages</label><input id="messageSearch" type="search" placeholder="Participant or message text"></div><div class="field"><label for="messageFilter">Message view</label><select id="messageFilter"><option value="">All messages</option><option value="received">Received</option><option value="unread">Unread received</option><option value="read">Read received</option><option value="sent">Sent</option></select></div></div><p class="communication-result-count" id="messageResults" role="status"></p><div id="messageList" aria-busy="true">${MGAEMS.loadingHTML('Loading messages…')}</div></section>` : ''}`;

  const tabControls = tabs.map(([key]) => document.getElementById(key + 'Tab'));
  function activateTab(control) {
    if (!current()) return;
    tabControls.forEach(tab => {
      const active = tab === control;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.dataset.communicationTab + 'Panel').hidden = !active;
    });
  }
  tabControls.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? tabControls[(index + 1) % tabControls.length] : event.key === 'ArrowLeft' ? tabControls[(index + tabControls.length - 1) % tabControls.length] : event.key === 'Home' ? tabControls[0] : event.key === 'End' ? tabControls.at(-1) : null;
      if (next) { event.preventDefault(); activateTab(next); next.focus(); }
    });
  });
  document.getElementById('newAnnouncement')?.addEventListener('click', event => openAnnouncementForm(event.currentTarget));
  document.getElementById('newMessage')?.addEventListener('click', event => openMessageForm(event.currentTarget));
  const filters = [['announcementSearch', 'announcementSearch', 'input', renderAnnouncements], ['announcementAudienceFilter', 'audience', 'change', renderAnnouncements], ['messageSearch', 'messageSearch', 'input', renderMessages], ['messageFilter', 'messageFilter', 'change', renderMessages]];
  filters.forEach(([id, key, event, render]) => document.getElementById(id)?.addEventListener(event, e => { state[key] = e.target.value.trim(); render(); }));

  function updateSummary() {
    if (!current()) return;
    document.getElementById('announcementCount').textContent = state.announcementLoading ? 'Loading…' : state.announcements === null ? 'Unavailable' : String(state.announcements.length);
    if (!canMessage) return;
    const count = state.messages?.filter(unread).length;
    document.getElementById('unreadCount').textContent = state.messageLoading ? 'Loading…' : count === undefined ? 'Unavailable' : String(count);
    document.getElementById('totalMessageCount').textContent = state.messageLoading ? 'Loading…' : state.messages === null ? 'Unavailable' : String(state.messages.length);
    document.getElementById('tabUnreadCount').innerHTML = count ? `<span class="unread-count" aria-label="${count} unread received messages">${count}</span>` : '';
  }
  async function loadAnnouncements() {
    if (!current()) return;
    const request = ++state.announcementRequest;
    state.announcementLoading = true;
    updateSummary();
    const target = document.getElementById('announcementList');
    target.setAttribute('aria-busy', 'true');
    target.innerHTML = MGAEMS.loadingHTML('Loading announcements…');
    document.getElementById('announcementResults').textContent = '';
    const result = await MGAEMS.get('/api/v1/announcements');
    if (!current() || request !== state.announcementRequest) return;
    state.announcementLoading = false;
    target.setAttribute('aria-busy', 'false');
    if (!result.ok || !validRows(result.data)) {
      state.announcements = null;
      target.innerHTML = MGAEMS.errorHTML(result.error || 'Announcements could not be loaded.') + '<button class="btn btn-secondary" type="button" id="retryAnnouncements">Retry announcements</button>';
      document.getElementById('retryAnnouncements').addEventListener('click', loadAnnouncements);
    } else {
      state.announcements = [...result.data].sort((a, b) => (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0));
      renderAnnouncements();
    }
    updateSummary();
    MGAEMS.initIcons();
  }
  function renderAnnouncements() {
    if (!current() || state.announcementLoading || state.announcements === null) return;
    const target = document.getElementById('announcementList');
    const search = state.announcementSearch.toLocaleLowerCase();
    const items = state.announcements.filter(item => (!state.audience || item.audience === state.audience) && (!search || `${item.title} ${item.body}`.toLocaleLowerCase().includes(search)));
    document.getElementById('announcementResults').textContent = `${items.length} of ${state.announcements.length} available announcements`;
    if (!items.length) target.innerHTML = MGAEMS.emptyStateHTML(state.announcements.length ? 'No announcements match' : 'No announcements available', state.announcements.length ? 'Try another search or audience filter.' : 'Announcements published for your audience will appear here.', 'megaphone');
    else target.innerHTML = `<div class="announcement-list">${items.map(item => `<article class="announcement-item"><div class="announcement-heading"><div><h3>${esc(item.title)}</h3></div><span class="badge badge-navy">${esc(audiences[item.audience] || 'Audience unavailable')}</span></div><div class="announcement-meta"><span><i data-lucide="calendar-days" aria-hidden="true"></i>Published ${date(item.published_at)}</span><span><i data-lucide="user-round" aria-hidden="true"></i>${item.publisher?.username ? esc(item.publisher.username) : item.published_by ? `Publisher account #${esc(item.published_by)}` : 'Publisher unavailable'}</span></div><p class="announcement-summary">${esc(item.body)}</p></article>`).join('')}</div>`;
    MGAEMS.initIcons();
  }
  async function loadMessages() {
    if (!current() || !canMessage) return;
    const request = ++state.messageRequest;
    state.messageLoading = true;
    updateSummary();
    const target = document.getElementById('messageList');
    target.setAttribute('aria-busy', 'true');
    target.innerHTML = MGAEMS.loadingHTML('Loading messages…');
    document.getElementById('messageResults').textContent = '';
    const result = await MGAEMS.get('/api/v1/messages');
    if (!current() || request !== state.messageRequest) return;
    state.messageLoading = false;
    target.setAttribute('aria-busy', 'false');
    if (!result.ok || !validRows(result.data, true)) {
      state.messages = null;
      target.innerHTML = MGAEMS.errorHTML(result.error || 'Messages could not be loaded.') + '<button class="btn btn-secondary" type="button" id="retryMessages">Retry messages</button>';
      document.getElementById('retryMessages').addEventListener('click', loadMessages);
    } else {
      state.messages = result.data.filter(message => incoming(message) || String(message.sender_id) === String(user.id)).sort((a, b) => (Date.parse(b.sent_at) || 0) - (Date.parse(a.sent_at) || 0));
      renderMessages();
    }
    updateSummary();
    MGAEMS.initIcons();
  }
  function renderMessages() {
    if (!current() || !canMessage || state.messageLoading || state.messages === null) return;
    const target = document.getElementById('messageList');
    const search = state.messageSearch.toLocaleLowerCase();
    const items = state.messages.filter(message => (!search || `${participant(message)} ${message.body}`.toLocaleLowerCase().includes(search)) && (!state.messageFilter || state.messageFilter === 'received' && incoming(message) || state.messageFilter === 'unread' && unread(message) || state.messageFilter === 'read' && incoming(message) && !unread(message) || state.messageFilter === 'sent' && !incoming(message)));
    document.getElementById('messageResults').textContent = `${items.length} of ${state.messages.length} owned messages`;
    if (!items.length) target.innerHTML = MGAEMS.emptyStateHTML(state.messages.length ? 'No messages match' : 'No messages yet', state.messages.length ? 'Try another search or message view.' : 'Messages you receive or send will appear here.', 'mail');
    else target.innerHTML = `<div class="message-list">${items.map(message => `<button class="message-item ${unread(message) ? 'unread' : ''}" type="button" data-open-message="${esc(message.id)}" aria-label="${esc(messageStatus(message))} message ${incoming(message) ? 'from' : 'to'} ${esc(participant(message))}"><span class="message-content"><span class="message-participant">${incoming(message) ? 'From' : 'To'} ${esc(participant(message))}</span><span class="message-preview">${esc(message.body)}</span></span><span class="message-state"><span class="badge ${unread(message) ? 'badge-amber' : incoming(message) ? 'badge-gray' : 'badge-navy'}">${esc(messageStatus(message))}</span>${date(message.sent_at)}</span></button>`).join('')}</div>`;
    target.querySelectorAll('[data-open-message]').forEach(button => button.addEventListener('click', () => openMessage(button.dataset.openMessage, button)));
    MGAEMS.initIcons();
  }
  function modal(definition) {
    if (!current() || state.modal && !state.modal.closed) return null;
    const handle = MGAEMS.openModal({ ...definition, onClose: () => { state.modal = null; } });
    handle.overlay.setAttribute('class', 'modal-overlay communication-dialog');
    state.modal = handle;
    return handle;
  }
  function discardModal(handle) {
    handle.setBusy(false);
    handle.close();
  }
  function openMessage(id, trigger) {
    if (!current()) return;
    const message = state.messages?.find(item => String(item.id) === String(id));
    if (!message) return;
    const canMarkRead = unread(message);
    const handle = modal({ title: `Message ${incoming(message) ? 'from' : 'to'} ${participant(message)}`, trigger,
      body: `<div id="messageReadAlert" role="status"></div><dl class="message-dialog-meta"><div><dt>${incoming(message) ? 'From' : 'To'}</dt><dd>${esc(participant(message))}</dd></div><div><dt>Sent (school time)</dt><dd>${date(message.sent_at)}</dd></div><div><dt>Status</dt><dd>${esc(messageStatus(message))}${message.read_at ? ` · ${date(message.read_at)}` : ''}</dd></div></dl><div class="message-body">${esc(message.body)}</div>`,
      footer: `<button type="button" class="btn btn-secondary" data-dialog-close>Close</button>${canMarkRead ? '<button type="button" class="btn btn-primary" data-mark-read>Mark as read</button>' : ''}` });
    if (!handle || !canMarkRead) return;
    const button = handle.overlay.querySelector('[data-mark-read]');
    let saving = false;
    button.addEventListener('click', async () => {
      if (!current() || saving || handle.closed || state.modal !== handle || !incoming(message)) return;
      saving = true;
      handle.setBusy(true);
      button.textContent = 'Marking as read…';
      const result = await MGAEMS.patch(`/api/v1/messages/${encodeURIComponent(message.id)}/read`, {});
      if (!current() || handle.closed || state.modal !== handle) { discardModal(handle); saving = false; return; }
      handle.setBusy(false);
      saving = false;
      if (handle.closed) return;
      if (!result.ok || !result.data?.read_at || !Number.isFinite(Date.parse(result.data.read_at)) || String(result.data.id) !== String(message.id) || String(result.data.recipient_id) !== String(user.id)) {
        const alert = handle.body.querySelector('#messageReadAlert');
        alert.innerHTML = MGAEMS.errorHTML(result.error || 'The read status could not be confirmed. Retry or reload your messages.');
        alert.tabIndex = -1;
        alert.focus();
        button.textContent = 'Mark as read';
        MGAEMS.initIcons();
        return;
      }
      message.read_at = result.data.read_at;
      handle.close();
      renderMessages();
      updateSummary();
      MGAEMS.toast('Message marked as read.', 'success');
    });
  }
  function openAnnouncementForm(trigger) {
    if (!current() || !canPublish) return;
    openForm({ title: 'Publish announcement', label: 'Publish announcement', progress: 'Publishing…', success: 'Announcement published.', endpoint: '/api/v1/announcements', reload: loadAnnouncements, trigger,
      fields: `<fieldset class="communication-form-group"><legend>Announcement details</legend><div class="field"><label for="announcementTitle">Title *</label><input type="text" name="title" id="announcementTitle" maxlength="200" required></div><div class="field"><label for="announcementAudience">Audience *</label><select id="announcementAudience" name="audience" required>${Object.entries(audiences).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select><p class="communication-note">The school delivers this announcement to the selected audience.</p></div><div class="field"><label for="announcementBody">Announcement *</label><textarea id="announcementBody" name="body" required></textarea></div></fieldset><p class="communication-note">Publishing makes this announcement available immediately to its permitted audience. Review the title, audience and text carefully before publishing.</p>`,
      payload: form => ({ title: form.elements.namedItem('title').value.trim(), body: form.elements.namedItem('body').value.trim(), audience: form.elements.namedItem('audience').value }),
      validate: data => ({ ...(!data.title || data.title.length > 200 ? { title: ['Enter a title of 1–200 characters.'] } : {}), ...(!data.body ? { body: ['Enter announcement text.'] } : {}), ...(!Object.hasOwn(audiences, data.audience) ? { audience: ['Choose a supported audience.'] } : {}) }),
      confirmation: data => `Publish “${data.title}” immediately for ${audiences[data.audience]}?` });
  }
  function openMessageForm(trigger) {
    if (!current() || !canSend) return;
    openForm({ title: 'New message', label: 'Send message', progress: 'Sending…', success: 'Message sent.', endpoint: '/api/v1/messages', reload: loadMessages, trigger,
      fields: '<fieldset class="communication-form-group"><legend>Recipient and message</legend><div class="field"><label for="messageRecipient">Recipient account number *</label><input type="number" name="recipient_id" id="messageRecipient" min="1" step="1" inputmode="numeric" required aria-describedby="messageRecipientHint"><p class="communication-note" id="messageRecipientHint">Enter the recipient’s existing account number supplied through the school’s established contact process.</p></div><div class="field"><label for="messageBody">Message *</label><textarea id="messageBody" name="body" required></textarea></div></fieldset>',
      payload: form => ({ recipient_id: Number(form.elements.namedItem('recipient_id').value), body: form.elements.namedItem('body').value.trim() }),
      validate: data => ({ ...(!Number.isSafeInteger(data.recipient_id) || data.recipient_id < 1 ? { recipient_id: ['Enter a valid positive recipient account number.'] } : {}), ...(!data.body ? { body: ['Enter a message.'] } : {}) }),
      confirmation: data => `Send this message to account #${data.recipient_id}? Review the recipient carefully before sending.` });
  }
  function openForm(definition) {
    const handle = modal({ title: definition.title, trigger: definition.trigger, body: `<form id="communicationForm"><div data-form-error role="status"></div>${definition.fields}</form>`, footer: `<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button class="btn btn-primary" type="submit" form="communicationForm" data-save-communication>${esc(definition.label)}</button>` });
    if (!handle) return;
    const form = handle.body.querySelector('form');
    const button = handle.overlay.querySelector('[data-save-communication]');
    let saving = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!current() || saving || handle.closed || state.modal !== handle) return;
      const payload = definition.payload(form);
      const fields = definition.validate(payload);
      if (Object.keys(fields).length) { MGAEMS.showFormErrors(form, { error: 'Please check the highlighted fields.', fields }); return; }
      if (!form.reportValidity()) return;
      saving = true;
      handle.setBusy(true);
      const controls = [...form.elements].filter(control => ['input', 'select', 'textarea'].includes(control.tagName?.toLowerCase() || control.tag)).map(control => [control, control.disabled]);
      controls.forEach(([control]) => { control.disabled = true; });
      button.textContent = 'Confirming…';
      const confirmed = await MGAEMS.confirmAction(definition.title, definition.confirmation(payload), definition.label);
      if (!current() || handle.closed || state.modal !== handle) { discardModal(handle); saving = false; return; }
      if (!confirmed) {
        controls.forEach(([control, disabled]) => { control.disabled = disabled; });
        handle.setBusy(false);
        saving = false;
        button.textContent = definition.label;
        return;
      }
      form.querySelector('[data-form-error]').innerHTML = '';
      form.querySelectorAll('[aria-invalid]').forEach(control => control.removeAttribute('aria-invalid'));
      button.textContent = definition.progress;
      const result = await MGAEMS.post(definition.endpoint, payload);
      if (!current() || handle.closed || state.modal !== handle) { discardModal(handle); saving = false; return; }
      controls.forEach(([control, disabled]) => { control.disabled = disabled; });
      handle.setBusy(false);
      saving = false;
      if (handle.closed) return;
      if (!result.ok) { MGAEMS.showFormErrors(form, result); button.textContent = definition.label; return; }
      handle.close();
      MGAEMS.toast(definition.success, 'success');
      await definition.reload();
    });
  }
  updateSummary();
  MGAEMS.initIcons();
  loadAnnouncements();
  if (canMessage) loadMessages();
})();
