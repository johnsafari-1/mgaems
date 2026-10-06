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
        return { ok: false, error: message, status: res.status, fields: json.error?.fields };
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

  return { requireAuth, landingPage, logout, get, post, patch, del, download, toast, loadingHTML, emptyStateHTML, errorHTML, escapeHTML, initIcons, initSidebar, currentUser, setTheme, initThemeControls };
})();
