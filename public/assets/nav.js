/* ==========================================================================
   Shared navigation shell: header + sidebar. Injected into every
   authenticated page so the nav is defined once, not copy-pasted.
   ========================================================================== */

const MGAEMS_NAV_ITEMS = [
  { href: '/dashboard.html', icon: 'layout-dashboard', label: 'Dashboard' },
  { href: '/students.html', icon: 'users', label: 'Students' },
  { href: '/guardians.html', icon: 'contact-round', label: 'Parents / Guardians', roles: ['system_admin', 'head_teacher', 'deputy_head_teacher'] },
  { href: '/academic.html', icon: 'book-open', label: 'Academics' },
  { href: '/attendance.html', icon: 'calendar-check', label: 'Attendance' },
  { href: '/assessment.html', icon: 'clipboard-check', label: 'Assessment' },
  { href: '/sponsorship.html', icon: 'heart-handshake', label: 'Sponsorship' },
  { href: '/staff.html', icon: 'briefcase', label: 'HR / Staff', roles: ['system_admin', 'head_teacher', 'deputy_head_teacher'] },
  { href: '/communication.html', icon: 'megaphone', label: 'Communication' },
  { href: '/visitors.html', icon: 'clipboard-list', label: 'Visitors', roles: ['system_admin', 'head_teacher', 'deputy_head_teacher', 'sponsor_coordinator'] },
  { href: '/reports.html', icon: 'bar-chart-3', label: 'Reports', roles: ['system_admin', 'head_teacher', 'deputy_head_teacher'] },
  { href: '/administration.html', icon: 'settings', label: 'Administration', roles: ['system_admin', 'head_teacher'] },
];

function renderAppShell(activeHref, logoUrl) {
  if (document.getElementById('appMain')) return;
  const role = MGAEMS.currentUser()?.role;
  const portalItems = role === 'parent_guardian'
    ? [{ href: '/parent-portal.html', icon: 'home', label: 'Parent Portal' }]
    : [{ href: '/sponsor-portal.html', icon: 'heart-handshake', label: 'Sponsor Portal' }];
  const items = (['parent_guardian', 'sponsor'].includes(role) ? portalItems : MGAEMS_NAV_ITEMS)
    .filter(item => !item.roles || item.roles.includes(role));
  const pageTitle = items.find(item => item.href === activeHref)?.label || 'MGAEMS';
  const esc = MGAEMS.escapeHTML;
  const navLinks = items.map(item => `
    <a href="${item.href}" title="${item.label}" class="${item.href === activeHref ? 'active' : ''}" ${item.href === activeHref ? 'aria-current="page"' : ''}>
      <i data-lucide="${item.icon}" aria-hidden="true"></i><span class="sidebar-label">${item.label}</span>
    </a>`).join('');

  document.body.insertAdjacentHTML('afterbegin', `
    <a class="skip-link" href="#appMain">Skip to main content</a>
    <div class="app-shell">
      <aside class="app-sidebar" id="appSidebar" aria-label="School navigation">
        <a class="brand" href="${MGAEMS.landingPage()}" aria-label="MGAEMS home">
          <img id="appSchoolLogo" src="${esc(logoUrl || '/storage/school/DsN4QKTH9nHqIbLiOM7ha8HIjUHyUfOPjcKnBdgq.jpg')}" alt="" onerror="this.hidden=true">
          <div class="sidebar-label"><strong>MGAEMS</strong><div id="appSchoolName">School workspace</div><div class="sub" id="appSchoolMotto"></div></div>
        </a>
        <button type="button" class="btn btn-secondary icon-control sidebar-close" id="closeNavigation" aria-label="Close navigation"><i data-lucide="x" aria-hidden="true"></i></button>
        <nav aria-label="Main navigation">${navLinks}</nav>
      </aside>
      <header class="app-header">
        <div class="header-context">
          <button type="button" class="btn btn-secondary icon-control" id="navigationToggle" aria-controls="appSidebar" aria-expanded="true" aria-label="Collapse navigation"><i data-lucide="menu" aria-hidden="true"></i></button>
          <div><strong>${esc(pageTitle)}</strong>${!['parent_guardian', 'sponsor'].includes(role) ? '<div class="sub" id="academicContext" role="status">Loading academic context…</div>' : ''}</div>
        </div>
        <div class="user">
          <span id="userInfo"></span>
          <button type="button" class="btn btn-secondary icon-control" data-theme-toggle aria-label="Switch theme"></button>
          <button type="button" class="btn btn-secondary btn-sm" id="shellLogout"><i data-lucide="log-out" aria-hidden="true"></i><span>Log Out</span></button>
        </div>
      </header>
      <main class="app-main" id="appMain" tabindex="-1"></main>
    </div>
    <button type="button" class="sidebar-backdrop" id="sidebarBackdrop" aria-label="Close navigation" tabindex="-1" hidden></button>
  `);
  document.getElementById('shellLogout').addEventListener('click', MGAEMS.logout);
  MGAEMS.initSidebar();
  MGAEMS.initThemeControls();
  initAppNavigation();
  loadShellContext();
}

function initAppNavigation() {
  const sidebar = document.getElementById('appSidebar');
  const toggle = document.getElementById('navigationToggle');
  const close = document.getElementById('closeNavigation');
  const backdrop = document.getElementById('sidebarBackdrop');
  const mobile = window.matchMedia('(max-width: 900px)');
  let collapsed = false;
  let open = false;

  function update() {
    document.body.classList.toggle('sidebar-collapsed', !mobile.matches && collapsed);
    document.body.classList.toggle('navigation-open', mobile.matches && open);
    backdrop.hidden = !mobile.matches || !open;
    sidebar.inert = mobile.matches && !open;
    document.querySelector('.app-header').inert = mobile.matches && open;
    document.getElementById('appMain').inert = mobile.matches && open;
    if (mobile.matches && open) {
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
    }
    const expanded = mobile.matches ? open : !collapsed;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', mobile.matches ? (open ? 'Close navigation' : 'Open navigation') : (collapsed ? 'Expand navigation' : 'Collapse navigation'));
    toggle.title = toggle.getAttribute('aria-label');
  }
  function dismiss() {
    open = false;
    update();
    toggle.focus();
  }
  toggle.addEventListener('click', () => {
    if (mobile.matches) open = !open;
    else collapsed = !collapsed;
    update();
    if (mobile.matches && open) close.focus();
  });
  close.addEventListener('click', dismiss);
  backdrop.addEventListener('click', dismiss);
  document.addEventListener('keydown', event => {
    if (!mobile.matches || !open) return;
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if (event.key === 'Tab') {
      const controls = [...sidebar.querySelectorAll('a[href], button')].filter(el => !el.hidden);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
  });
  mobile.addEventListener('change', () => {
    const wasInSidebar = sidebar.contains(document.activeElement);
    open = false;
    update();
    if (mobile.matches && wasInSidebar) toggle.focus();
  });
  update();
}

async function loadShellContext() {
  if (!MGAEMS.currentUser()) return;
  const schoolRequest = MGAEMS.get('/api/v1/settings/school').then(result => {
    if (!result.ok || !result.data) return;
    document.getElementById('appSchoolName').textContent = result.data.school_name || 'School workspace';
    document.getElementById('appSchoolMotto').textContent = result.data.motto || '';
    if (result.data.logo_path) {
      const logo = document.getElementById('appSchoolLogo');
      logo.src = '/storage/' + String(result.data.logo_path).replace(/^\/+/, '');
      logo.hidden = false;
    }
  });
  const context = document.getElementById('academicContext');
  if (context) {
    const [years, terms] = await Promise.all([MGAEMS.get('/api/v1/academic-years'), MGAEMS.get('/api/v1/terms')]);
    if (!years.ok || !terms.ok || !Array.isArray(years.data) || !Array.isArray(terms.data)) {
      context.textContent = 'Academic context unavailable';
    } else {
      const year = years.data.find(item => item.is_current);
      const term = terms.data.find(item => item.is_current && (!year || item.academic_year_id === year.id));
      context.textContent = [year?.name, term?.name].filter(Boolean).join(' · ') || 'No current academic year or term';
    }
  }
  await schoolRequest;
}
