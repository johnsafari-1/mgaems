/* ==========================================================================
   MGAEMS shared frontend logic.
   Every page includes this before app.css and before its own <script>.
   ========================================================================== */

const MGAEMS = (() => {
  const THEME_KEY = 'mgaems_theme';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  let preferredTheme = null;
  try { preferredTheme = localStorage.getItem(THEME_KEY); } catch { /* Storage may be unavailable. */ }
  if (!['light', 'dark'].includes(preferredTheme)) preferredTheme = null;

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const dark = theme === 'dark';
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
      button.title = button.getAttribute('aria-label');
      button.innerHTML = `<i data-lucide="${dark ? 'sun' : 'moon'}" aria-hidden="true"></i>`;
    });
    initIcons();
  }

  // app.js is loaded before the stylesheet so the saved theme precedes first paint.
  applyTheme(preferredTheme || (systemTheme.matches ? 'dark' : 'light'));

  function setTheme(theme) {
    if (!['light', 'dark'].includes(theme)) return;
    preferredTheme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* Keep the theme for this session. */ }
    applyTheme(theme);
  }

  function initThemeControls() {
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      if (button.dataset.themeBound) return;
      button.dataset.themeBound = 'true';
      button.addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
    });
    applyTheme(document.documentElement.getAttribute('data-theme'));
  }

  window.addEventListener('storage', event => {
    if (['mgaems_token', 'mgaems_user', null].includes(event.key) && !pageSessionCurrent()) {
      clearObsoletePage();
      return;
    }
    if (event.key !== THEME_KEY && event.key !== null) return;
    preferredTheme = ['light', 'dark'].includes(event.newValue) ? event.newValue : null;
    applyTheme(preferredTheme || (systemTheme.matches ? 'dark' : 'light'));
  });
  systemTheme.addEventListener('change', event => {
    if (!preferredTheme) applyTheme(event.matches ? 'dark' : 'light');
  });

  const token = () => {
    try { return localStorage.getItem('mgaems_token'); }
    catch { return null; }
  };
  const currentUser = () => {
    try { return JSON.parse(localStorage.getItem('mgaems_user') || 'null'); }
    catch { return null; }
  };

  // Capture only in memory; callers use this to discard work from an old session.
  function sessionGuard() {
    const sessionToken = token();
    const sessionUser = JSON.stringify([currentUser()?.id, currentUser()?.role]);
    return () => token() === sessionToken && JSON.stringify([currentUser()?.id, currentUser()?.role]) === sessionUser;
  }

  // An old page must not dispatch a confirmed action using a replacement account.
  const pageSessionCurrent = sessionGuard();

  function clearObsoletePage() {
    schoolRevision += 1;
    schoolRequest = null;
    schoolIdentity = null;
    academicRequest = null;
    while (activeModal) {
      const modal = activeModal;
      modal.body.textContent = '';
      modal.setBusy(false);
      modal.close();
      if (activeModal === modal) break;
    }
    const main = document.getElementById('appMain');
    if (main) main.innerHTML = errorHTML('Your account changed. Reloading your workspace…');
    ['userInfo', 'userRole'].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.textContent = '';
    });
    window.location.href = token() && currentUser() ? landingPage() : '/login.html';
  }

  function requireAuth() {
    if (!token() || !currentUser()) {
      window.location.href = '/login.html';
      return null;
    }
    const user = currentUser();
    const landing = landingPage(user);
    if (['parent_guardian', 'sponsor'].includes(user.role) && window.location.pathname !== landing) {
      window.location.href = landing;
    }
    return user;
  }

  function landingPage(user = currentUser()) {
    return user?.role === 'parent_guardian' ? '/parent-portal.html'
      : user?.role === 'sponsor' ? '/sponsor-portal.html' : '/dashboard.html';
  }

  function logout() {
    if (!pageSessionCurrent()) return;
    const currentSession = sessionGuard();
    schoolRevision += 1;
    schoolRequest = null;
    schoolIdentity = null;
    fetch('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + token() },
    }).catch(() => { /* Clear the local session even if the server is unreachable. */ }).finally(() => {
      if (!currentSession()) return;
      localStorage.removeItem('mgaems_token');
      localStorage.removeItem('mgaems_user');
      window.location.href = '/login.html';
    });
  }

  /**
   * Central fetch wrapper. Returns { ok, data, error } — callers never need
   * try/catch or manual status checks. Automatically redirects to login on 401.
   */
  async function api(path, options = {}) {
    const currentSession = sessionGuard();
    const requestToken = token();
    const stale = () => ({ ok: false, stale: true, error: 'This request belongs to an earlier session.' });
    if (!pageSessionCurrent()) return stale();
    try {
      const res = await fetch(path, {
        ...(path.startsWith('/api/v1/health/') ? { cache: 'no-store' } : {}),
        ...options,
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + requestToken,
          ...(options.body && !(typeof FormData !== 'undefined' && options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
      });

      if (!currentSession()) return stale();
      if (res.status === 401) {
        logout();
        return { ok: false, status: 401, error: 'Session expired.' };
      }

      const json = await res.json().catch(() => ({}));
      if (!currentSession()) return stale();

      if (!res.ok) {
        const message = (json.error && json.error.message) || json.message || 'Something went wrong.';
        return { ok: false, error: message, status: res.status, fields: json.error?.fields || json.errors };
      }

      return { ok: true, data: json.data, meta: json.meta };
    } catch (e) {
      if (!currentSession()) return stale();
      return { ok: false, error: 'Could not reach the server. Check your connection.' };
    }
  }

  const get = (path) => api(path);
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });
  const del = (path) => api(path, { method: 'DELETE' });
  const upload = (path, body) => api(path, { method: 'POST', body });

  // Share only in-flight reads. School identity stays in memory; contact settings
  // and authenticated API responses are never persisted as a branding cache.
  let schoolRequest = null;
  let schoolIdentity = null;
  let schoolRevision = 0;
  let logoRevision = 0;
  function schoolBranding() { return schoolIdentity ? { ...schoolIdentity } : null; }
  function updateSchoolSettings(settings, { refreshLogo = false } = {}) {
    schoolRevision += 1;
    schoolRequest = null;
    if (refreshLogo) logoRevision += 1;
    schoolIdentity = {
      school_name: typeof settings?.school_name === 'string' ? settings.school_name : '',
      motto: typeof settings?.motto === 'string' ? settings.motto : '',
      logo_path: typeof settings?.logo_path === 'string' ? settings.logo_path : null,
      logo_revision: logoRevision,
    };
    const branding = schoolBranding();
    if (window.dispatchEvent && typeof window.CustomEvent === 'function') {
      window.dispatchEvent(new window.CustomEvent('mgaems:school-settings', { detail: branding }));
    }
    return branding;
  }
  function schoolSettings() {
    if (schoolRequest) return schoolRequest;
    const revision = schoolRevision;
    const credential = token();
    const request = MGAEMS.get('/api/v1/settings/school').then(result => {
      if (revision !== schoolRevision || credential !== token()) {
        return { ok: false, stale: true, error: 'School settings changed. Please reload.' };
      }
      if (result.ok) updateSchoolSettings(result.data);
      return result;
    }).finally(() => { if (schoolRequest === request) schoolRequest = null; });
    schoolRequest = request;
    return request;
  }
  function schoolLogoURL(path, { revision = 0 } = {}) {
    if (typeof path !== 'string' || !path || path !== path.trim() || /[\\\u0000-\u001f\u007f?#:]/.test(path)) return '';
    const parts = path.split('/');
    if (parts.some(part => !part || part === '.' || part === '..')) return '';
    try {
      if (parts.some(part => /[\\/\u0000-\u001f\u007f]/.test(decodeURIComponent(part)) || ['.', '..'].includes(decodeURIComponent(part)))) return '';
    } catch { return ''; }
    const version = Number.isSafeInteger(revision) && revision > 0 ? `?v=${revision}` : '';
    return '/storage/' + parts.map(encodeURIComponent).join('/') + version;
  }
  function schoolLogoHTML(settings = {}, { className = '', decorative = false } = {}) {
    const url = schoolLogoURL(settings.logo_path, { revision: settings.logo_revision });
    const name = settings.school_name || 'School';
    return `<span class="school-logo ${escapeHTML(className)}" data-school-logo><img class="school-logo-image" data-school-logo-image ${url ? `src="${escapeHTML(url)}"` : 'hidden'} alt="${decorative ? '' : escapeHTML(name + ' logo')}"><span class="school-logo-fallback" data-school-logo-fallback ${url ? 'hidden' : ''} ${decorative ? 'aria-hidden="true"' : 'role="img" aria-label="School logo not configured"'}>MG</span></span>`;
  }
  function initSchoolLogos(root = document) {
    const wrappers = root.matches?.('[data-school-logo]') ? [root] : [...root.querySelectorAll('[data-school-logo]')];
    wrappers.forEach(wrapper => {
      const image = wrapper.querySelector('[data-school-logo-image]');
      const fallback = wrapper.querySelector('[data-school-logo-fallback]');
      if (!image || !fallback || image.dataset.logoBound) return;
      image.dataset.logoBound = 'true';
      image.addEventListener('error', () => {
        image.hidden = true;
        fallback.hidden = false;
        if (fallback.getAttribute('role') === 'img') fallback.setAttribute('aria-label', 'School logo unavailable');
      });
      image.addEventListener('load', () => {
        image.hidden = false;
        fallback.hidden = true;
      });
    });
  }

  // Share concurrent shell/dashboard reads; retain no academic response cache.
  let academicRequest = null;
  function academicContext() {
    if (!academicRequest) academicRequest = Promise.all([MGAEMS.get('/api/v1/academic-years'), MGAEMS.get('/api/v1/terms')]).finally(() => { academicRequest = null; });
    return academicRequest;
  }
  function schoolDate(value = new Date()) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    if (value == null || !Number.isFinite(new Date(value).getTime())) return null;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function academicPeriod(years, terms, today = schoolDate()) {
    const eligible = row => row?.is_current === true && schoolDate(row.start_date) && schoolDate(row.end_date)
      && schoolDate(row.start_date) <= today && schoolDate(row.end_date) >= today;
    const current = years.filter(eligible), year = current.length === 1 ? current[0] : null;
    const matching = year ? terms.filter(term => term?.academic_year_id === year.id && eligible(term)) : [];
    return { year, term: matching.length === 1 ? matching[0] : null };
  }

  async function download(path, filename, { isCurrent = () => true } = {}) {
    const downloadToken = token();
    const downloadUser = JSON.stringify([currentUser()?.id, currentUser()?.role]);
    const current = () => pageSessionCurrent() && token() === downloadToken
      && JSON.stringify([currentUser()?.id, currentUser()?.role]) === downloadUser && isCurrent();
    const cancelled = () => ({ ok: false, stale: true, cancelled: true });
    try {
      if (!current()) return cancelled();
      const res = await fetch(path, { headers: { Accept: 'application/pdf', Authorization: 'Bearer ' + downloadToken } });
      if (!current()) return cancelled();
      if (res.status === 401) { logout(); return { ok: false, error: 'Session expired.' }; }
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        if (!current()) return cancelled();
        return { ok: false, status: res.status, error: json.error?.message || 'Download failed.' };
      }
      const contentType = res.headers?.get('Content-Type') || '';
      if (/\b(?:text\/html|application\/(?:json|problem\+json))\b/i.test(contentType)) return { ok: false, error: 'The server did not return a downloadable file.' };
      const blob = await res.blob();
      if (!current()) return cancelled();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true };
    } catch (e) { return { ok: false, error: 'Could not reach the server. Check your connection.' }; }
  }

  /* ---------- UI helpers ---------- */

  function toast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'false');
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function loadingHTML(label = 'Loading…', skeleton = false) {
    const indicator = skeleton ? '<div class="loading-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>' : '<div class="spinner" aria-hidden="true"></div>';
    return `<div class="loading-state" role="status">${indicator}${escapeHTML(label)}</div>`;
  }

  function emptyStateHTML(title, desc = '', icon = 'inbox') {
    return `
      <div class="empty-state">
        <i data-lucide="${escapeHTML(icon)}" aria-hidden="true"></i>
        <div class="title">${escapeHTML(title)}</div>
        ${desc ? `<div class="desc">${escapeHTML(desc)}</div>` : ''}
      </div>`;
  }

  function errorHTML(message) {
    return `
      <div class="alert alert-error" role="alert">
        <i data-lucide="alert-circle" aria-hidden="true"></i>
        <span>${escapeHTML(message)}</span>
      </div>`;
  }

  function initIcons() {
    try {
      if (window.lucide?.createIcons) { window.lucide.createIcons(); return; }
    } catch { /* Keep controls usable when the optional icon provider fails. */ }
    const symbols = { menu: '☰', x: '×', sun: '☀', moon: '◐', plus: '+', minus: '−',
      download: '↓', upload: '↑', 'refresh-cw': '↻', 'arrow-left': '←', 'arrow-right': '→',
      'arrow-up-right': '↗', 'chevron-left': '‹', 'chevron-right': '›', 'circle-check': '✓',
      check: '✓', 'alert-circle': '!', 'log-in': '→', 'log-out': '→', search: '⌕' };
    document.querySelectorAll('i[data-lucide]').forEach(icon => {
      icon.textContent = symbols[icon.getAttribute('data-lucide')] || '◇';
      icon.setAttribute('aria-hidden', 'true');
      icon.classList.add('icon-fallback');
    });
  }

  document.addEventListener?.('DOMContentLoaded', initIcons);

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function showFormErrors(form, result) {
    form.querySelectorAll('[aria-invalid]').forEach(control => control.removeAttribute('aria-invalid'));
    const fields = result.fields || {};
    const messages = Object.values(fields).flat().filter(message => typeof message === 'string');
    const target = form.querySelector('[data-form-error]');
    if (target) {
      target.innerHTML = errorHTML(result.error || 'Please check the form.') + (messages.length ? `<ul class="form-error-list">${[...new Set(messages)].map(message => `<li>${escapeHTML(message)}</li>`).join('')}</ul>` : '');
      target.tabIndex = -1;
      target.focus();
    }
    [...form.elements].forEach(control => {
      if (Object.keys(fields).some(field => field === control.name || field.startsWith(control.name + '.'))) control.setAttribute('aria-invalid', 'true');
    });
    initIcons();
  }

  let activeModal = null;
  let modalSequence = 0;

  function openModal({ title, body, footer = '', trigger = document.activeElement, onClose = () => {} }) {
    const previous = activeModal;
    const overlay = document.createElement('div');
    const titleId = `mgaemsDialogTitle${++modalSequence}`;
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1"><div class="modal-header"><h2 id="${titleId}">${escapeHTML(title)}</h2><button type="button" class="modal-close" aria-label="Close dialog" data-dialog-close><i data-lucide="x" aria-hidden="true"></i></button></div><div class="modal-body">${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}</div>`;
    const background = [...document.body.children].map(element => [element, element.inert]);
    background.forEach(([element]) => { element.inert = true; });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);
    let busy = false;
    let closed = false;
    let disabledButtons = [];
    const dialog = overlay.querySelector('[role="dialog"]');
    const visibleControls = () => [...overlay.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
    const handle = {
      overlay, body: overlay.querySelector('.modal-body'),
      get closed() { return closed; },
      setBusy(value) {
        if (busy === value || closed) return;
        busy = value;
        dialog.setAttribute('aria-busy', String(value));
        if (value) {
          disabledButtons = [...overlay.querySelectorAll('button')].map(button => [button, button.disabled]);
          disabledButtons.forEach(([button]) => { button.disabled = true; });
        } else disabledButtons.forEach(([button, disabled]) => { button.disabled = disabled; });
      },
      close() {
        if (busy || closed || activeModal !== handle) return;
        closed = true;
        overlay.remove();
        document.removeEventListener('keydown', keydown);
        background.forEach(([element, inert]) => { element.inert = inert; });
        document.body.style.overflow = overflow;
        activeModal = previous;
        onClose();
        const fallback = document.getElementById('searchInput') || document.getElementById('guardianSearch') || document.getElementById('navigationToggle');
        if (trigger?.isConnected && !trigger.closest('[inert]')) trigger.focus();
        else fallback?.focus();
      },
    };
    function keydown(event) {
      if (activeModal !== handle) return;
      if (event.key === 'Escape') { event.preventDefault(); handle.close(); }
      if (event.key === 'Tab') {
        const controls = visibleControls();
        if (!controls.length) { event.preventDefault(); dialog.focus(); return; }
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    }
    activeModal = handle;
    document.addEventListener('keydown', keydown);
    overlay.querySelectorAll('[data-dialog-close]').forEach(button => button.addEventListener('click', handle.close));
    overlay.addEventListener('click', event => { if (event.target === overlay) handle.close(); });
    initIcons();
    (visibleControls().find(element => ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) || dialog).focus();
    return handle;
  }

  function confirmAction(title, message, label = 'Confirm') {
    return new Promise(resolve => {
      let accepted = false;
      const modal = openModal({ title, body: `<p>${escapeHTML(message)}</p>`, footer: `<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button><button type="button" class="btn btn-danger" data-confirm>${escapeHTML(label)}</button>`, onClose: () => resolve(accepted) });
      modal.overlay.querySelector('[data-confirm]').addEventListener('click', () => { accepted = true; modal.close(); });
    });
  }

  function initSidebar() {
    const user = currentUser();
    if (!user) return;
    document.querySelectorAll('.app-sidebar nav a').forEach(a => {
      const active = a.getAttribute('href') === window.location.pathname;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const el = document.getElementById('userInfo');
    if (el) el.textContent = user.username || 'Account';
    const role = document.getElementById('userRole');
    if (role) role.textContent = String(user.role || '').replace(/_/g, ' ');
  }

  return { requireAuth, landingPage, logout, get, post, patch, del, upload, schoolSettings, schoolBranding, updateSchoolSettings, schoolLogoURL, schoolLogoHTML, initSchoolLogos, academicContext, academicPeriod, schoolDate, download, toast, loadingHTML, emptyStateHTML, errorHTML, escapeHTML, showFormErrors, openModal, confirmAction, initIcons, initSidebar, currentUser, sessionGuard, setTheme, initThemeControls };
})();
