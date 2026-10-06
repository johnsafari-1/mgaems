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
    if (event.key !== THEME_KEY && event.key !== null) return;
    preferredTheme = ['light', 'dark'].includes(event.newValue) ? event.newValue : null;
    applyTheme(preferredTheme || (systemTheme.matches ? 'dark' : 'light'));
  });
  systemTheme.addEventListener('change', event => {
    if (!preferredTheme) applyTheme(event.matches ? 'dark' : 'light');
  });

  const token = () => localStorage.getItem('mgaems_token');
  const currentUser = () => {
    try { return JSON.parse(localStorage.getItem('mgaems_user') || 'null'); }
    catch { return null; }
  };

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
    fetch('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + token() },
    }).finally(() => {
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
    try {
      const res = await fetch(path, {
        ...options,
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + token(),
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
      });

      if (res.status === 401) {
        logout();
        return { ok: false, status: 401, error: 'Session expired.' };
      }

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = (json.error && json.error.message) || json.message || 'Something went wrong.';
        return { ok: false, error: message, status: res.status, fields: json.error?.fields || json.errors };
      }

      return { ok: true, data: json.data, meta: json.meta };
    } catch (e) {
      return { ok: false, error: 'Could not reach the server. Check your connection.' };
    }
  }

  const get = (path) => api(path);
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });
  const del = (path) => api(path, { method: 'DELETE' });

  async function download(path, filename) {
    try {
      const res = await fetch(path, { headers: { Accept: 'application/pdf', Authorization: 'Bearer ' + token() } });
      if (res.status === 401) { logout(); return { ok: false, error: 'Session expired.' }; }
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        return { ok: false, status: res.status, error: json.error?.message || 'Download failed.' };
      }
      const url = URL.createObjectURL(await res.blob());
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

  function loadingHTML(label = 'Loading…') {
    return `<div class="loading-state" role="status"><div class="spinner" aria-hidden="true"></div>${escapeHTML(label)}</div>`;
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
    if (window.lucide) window.lucide.createIcons();
  }

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
    if (el) el.textContent = `${user.username} — ${String(user.role || '').replace(/_/g, ' ')}`;
  }

  return { requireAuth, landingPage, logout, get, post, patch, del, download, toast, loadingHTML, emptyStateHTML, errorHTML, escapeHTML, showFormErrors, openModal, confirmAction, initIcons, initSidebar, currentUser, setTheme, initThemeControls };
})();
