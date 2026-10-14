/* Public sign-in uses a safe school identity fallback; protected settings are not read. */
(() => {
  const form = document.getElementById('loginForm');
  const username = document.getElementById('username');
  const password = document.getElementById('password');
  const toggle = document.getElementById('passwordToggle');
  const button = document.getElementById('loginBtn');
  const label = document.getElementById('loginBtnLabel');
  const status = document.getElementById('loginStatus');
  let pending = false;
  MGAEMS.initThemeControls();
  MGAEMS.initIcons();
  toggle.addEventListener('click', () => {
    if (pending) return;
    const visible = password.type !== 'text';
    password.type = visible ? 'text' : 'password';
    toggle.textContent = visible ? 'Hide' : 'Show';
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  });
  toggle.setAttribute('aria-label', 'Show password');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    const accountName = username.value.trim();
    const accountPassword = password.value;
    const fields = {};
    if (!accountName) fields.username = ['Enter your username.'];
    if (!accountPassword) fields.password = ['Enter your password.'];
    if (Object.keys(fields).length) { MGAEMS.showFormErrors(form, { error: 'Enter your username and password.', fields }); return; }
    if (!form.reportValidity()) return;
    document.getElementById('alertBox').innerHTML = '';
    form.querySelectorAll('[aria-invalid]').forEach(control => control.removeAttribute('aria-invalid'));
    pending = true;
    form.setAttribute('aria-busy', 'true');
    [username, password, toggle, button].forEach(control => { control.disabled = true; });
    label.textContent = 'Signing in…'; status.textContent = 'Checking your account…';
    const currentSession = MGAEMS.sessionGuard();
    let signedIn = false;
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username: accountName, password: accountPassword })
      });
      const payload = await response.json().catch(() => ({}));
      if (!currentSession()) { MGAEMS.showFormErrors(form, { error: 'Another sign-in changed this browser session. Reload to continue.' }); return; }
      if (!response.ok) {
        MGAEMS.showFormErrors(form, { error: payload.error?.message || payload.message || 'Sign-in failed. Check your details and try again.', fields: payload.error?.fields || payload.errors });
        return;
      }
      const data = payload.data;
      if (!data || typeof data.token !== 'string' || !data.token || !data.user || !Number.isSafeInteger(Number(data.user.id)) || Number(data.user.id) < 1 || typeof data.user.role !== 'string' || typeof data.user.username !== 'string') {
        MGAEMS.showFormErrors(form, { error: 'The sign-in response could not be confirmed. Please try again.' }); return;
      }
      try {
        localStorage.setItem('mgaems_token', data.token);
        localStorage.setItem('mgaems_user', JSON.stringify(data.user));
      } catch {
        try { localStorage.removeItem('mgaems_token'); localStorage.removeItem('mgaems_user'); } catch { /* Storage remains unavailable. */ }
        MGAEMS.showFormErrors(form, { error: 'Your browser could not save this sign-in session. Allow site storage and try again.' }); return;
      }
      password.value = '';
      status.textContent = 'Signed in. Opening your workspace…';
      signedIn = true;
      window.location.href = MGAEMS.landingPage(data.user);
    } catch {
      MGAEMS.showFormErrors(form, { error: 'Could not reach the server. Check your connection and try again.' });
    } finally {
      pending = false;
      form.setAttribute('aria-busy', 'false');
      [username, password, toggle, button].forEach(control => { control.disabled = false; });
      label.textContent = 'Sign In';
      if (!signedIn) status.textContent = '';
      MGAEMS.initIcons();
    }
  });
})();
