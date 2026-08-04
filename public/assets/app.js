/* ==========================================================================
   MGAEMS shared frontend logic.
   Every page includes this after app.css and before its own <script>.
   ========================================================================== */

const MGAEMS = (() => {
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
    return currentUser();
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
        return { ok: false, error: 'Session expired.' };
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

  /* ---------- UI helpers ---------- */

  function toast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function loadingHTML(label = 'Loading…') {
    return `<div class="loading-state"><div class="spinner"></div>${label}</div>`;
  }

  function emptyStateHTML(title, desc = '', icon = 'inbox') {
    return `
      <div class="empty-state">
        <i data-lucide="${icon}"></i>
        <div class="title">${title}</div>
        ${desc ? `<div class="desc">${desc}</div>` : ''}
      </div>`;
  }

  function errorHTML(message) {
    return `
      <div class="alert alert-error">
        <i data-lucide="alert-circle"></i>
        <span>${message}</span>
      </div>`;
  }

  function initIcons() {
    if (window.lucide) window.lucide.createIcons();
  }

  function initSidebar() {
    const user = currentUser();
    if (!user) return;
    document.querySelectorAll('.app-sidebar a').forEach(a => {
      if (a.getAttribute('href') === window.location.pathname) a.classList.add('active');
    });
    const el = document.getElementById('userInfo');
    if (el) el.textContent = `${user.username} — ${user.role.replace(/_/g, ' ')}`;
  }

  return { requireAuth, logout, get, post, patch, del, toast, loadingHTML, emptyStateHTML, errorHTML, initIcons, initSidebar, currentUser };
})();
