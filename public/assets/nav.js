/* ==========================================================================
   Shared navigation shell: header + sidebar. Injected into every
   authenticated page so the nav is defined once, not copy-pasted.
   ========================================================================== */

const MGAEMS_NAV_ITEMS = {
  dashboard: { href: '/dashboard.html', icon: 'layout-dashboard', label: 'Dashboard' },
  students: { href: '/students.html', icon: 'users', label: 'Students' },
  guardians: { href: '/guardians.html', icon: 'contact-round', label: 'Parents / Guardians' },
  academic: { href: '/academic.html', icon: 'book-open', label: 'Academics' },
  schemesOfWork: { href: '/schemes-of-work.html', icon: 'notebook-tabs', label: 'Schemes of Work' },
  lessonPlans: { href: '/lesson-plans.html', icon: 'notebook-pen', label: 'Lesson Plans' },
  recordsOfWork: { href: '/records-of-work.html', icon: 'clipboard-check', label: 'Records of Work' },
  attendance: { href: '/attendance.html', icon: 'calendar-check', label: 'Attendance' },
  assessment: { href: '/assessment.html', icon: 'clipboard-check', label: 'Assessment' },
  sponsorship: { href: '/sponsorship.html', icon: 'heart-handshake', label: 'Sponsorship' },
  staff: { href: '/staff.html', icon: 'briefcase', label: 'HR / Staff' },
  communication: { href: '/communication.html', icon: 'megaphone', label: 'Communication' },
  visitors: { href: '/visitors.html', icon: 'clipboard-list', label: 'Visitors' },
  reports: { href: '/reports.html', icon: 'bar-chart-3', label: 'Reports' },
  administration: { href: '/administration.html', icon: 'settings', label: 'Administration' },
  parent: { href: '/parent-portal.html', icon: 'home', label: 'Parent Portal' },
  sponsor: { href: '/sponsor-portal.html', icon: 'heart-handshake', label: 'Sponsor Portal' },
  teacher: { href: '/dashboard.html', icon: 'layout-dashboard', label: 'Teacher Workspace' },
  coordinator: { href: '/dashboard.html', icon: 'layout-dashboard', label: 'Sponsor Coordinator Workspace' },
  myLearners: { href: '/students.html', icon: 'users', label: 'My Learners' },
  myTimetable: { href: '/teacher-timetable.html', icon: 'calendar-days', label: 'My Timetable' },
  health: { href: '/health-welfare.html', icon: 'shield-check', label: 'Health & Safety' },
};

// Page visibility follows current APIs. Laravel remains the authorization boundary.
const MGAEMS_LEADERSHIP_NAV = ['dashboard', 'students', 'guardians', 'academic', 'attendance', 'assessment', 'sponsorship', 'staff', 'communication', 'visitors', 'reports'];
const MGAEMS_ROLE_NAV = {
  system_admin: [...MGAEMS_LEADERSHIP_NAV, 'schemesOfWork', 'lessonPlans', 'recordsOfWork', 'administration'],
  head_teacher: [...MGAEMS_LEADERSHIP_NAV, 'schemesOfWork', 'lessonPlans', 'recordsOfWork', 'health', 'administration'],
  deputy_head_teacher: [...MGAEMS_LEADERSHIP_NAV, 'schemesOfWork', 'lessonPlans', 'recordsOfWork', 'health'],
  teacher: ['teacher', 'myLearners', 'myTimetable', 'schemesOfWork', 'lessonPlans', 'recordsOfWork', 'attendance', 'assessment', 'communication'],
  sponsor_coordinator: ['sponsorship', 'coordinator', 'communication', 'visitors'],
  parent_guardian: ['parent'],
  sponsor: ['sponsor'],
  // Existing announcements are usable; a Student Portal is not implemented.
  student: ['dashboard', 'communication'],
};

// Group only destinations already present in the explicit role policy.
const MGAEMS_NAV_GROUPS = [
  { label: 'Overview', keys: ['dashboard', 'teacher', 'coordinator', 'parent', 'sponsor'] },
  { label: 'Learners', keys: ['students', 'myLearners', 'guardians'] },
  { label: 'Academics', keys: ['academic', 'myTimetable', 'schemesOfWork', 'lessonPlans', 'recordsOfWork', 'attendance', 'assessment'] },
  { label: 'School Operations', keys: ['sponsorship', 'health', 'staff', 'visitors'] },
  { label: 'Communication', keys: ['communication'] },
  { label: 'Reporting', keys: ['reports'] },
  { label: 'Administration', keys: ['administration'] },
];

function renderAppShell(activeHref) {
  if (document.getElementById('appMain')) return;
  // A destination is identified by its path, including when opened from a filtered link.
  activeHref = String(activeHref || window.location.pathname).split(/[?#]/, 1)[0];
  const role = MGAEMS.currentUser()?.role;
  const keys = Object.hasOwn(MGAEMS_ROLE_NAV, role) ? MGAEMS_ROLE_NAV[role] : [];
  const items = keys.map(key => MGAEMS_NAV_ITEMS[key]);
  const pageTitle = items.find(item => item.href === activeHref)?.label || 'MGAEMS';
  const location = MGAEMS_NAV_GROUPS.find(group => group.keys.some(key => keys.includes(key) && MGAEMS_NAV_ITEMS[key].href === activeHref))?.label || 'Workspace';
  const esc = MGAEMS.escapeHTML;
  const navigationLink = item => `
    <a href="${item.href}" title="${item.label}" class="${item.href === activeHref ? 'active' : ''}" ${item.href === activeHref ? 'aria-current="page"' : ''}>
      <i data-lucide="${item.icon}" aria-hidden="true"></i><span class="sidebar-label">${item.label}</span>
    </a>`;
  const navLinks = MGAEMS_NAV_GROUPS.map((group, index) => {
    const permitted = keys.filter(key => group.keys.includes(key));
    return permitted.length ? `<section class="nav-section" aria-labelledby="navGroup${index}"><div class="nav-section-title" id="navGroup${index}">${esc(group.label)}</div>${permitted.map(key => navigationLink(MGAEMS_NAV_ITEMS[key])).join('')}</section>` : '';
  }).join('');

  document.body.insertAdjacentHTML('afterbegin', `
    <a class="skip-link" href="#appMain">Skip to main content</a>
    <div class="app-shell">
      <aside class="app-sidebar" id="appSidebar" aria-label="School navigation">
        <a class="brand" id="schoolHome" href="${MGAEMS.landingPage()}" aria-label="Manna Goodnews Academy home" title="Manna Goodnews Academy">
          <span class="brand-mark" aria-hidden="true"><span>MG</span><img id="appSchoolLogo" hidden alt=""></span>
          <div class="sidebar-label"><strong>MGAEMS</strong><div id="appSchoolName">Manna Goodnews Academy</div><div class="sub" id="appSchoolMotto"></div></div>
        </a>
        <button type="button" class="btn btn-secondary icon-control sidebar-close" id="closeNavigation" aria-label="Close navigation"><i data-lucide="x" aria-hidden="true"></i></button>
        <nav aria-label="Main navigation">${navLinks}</nav>
      </aside>
      <header class="app-header">
        <div class="header-context">
          <button type="button" class="btn btn-secondary icon-control" id="navigationToggle" aria-controls="appSidebar" aria-expanded="true" aria-label="Collapse navigation"><i data-lucide="menu" aria-hidden="true"></i></button>
          <div><div class="header-location">${esc(location)}</div><strong class="header-title">${esc(pageTitle)}</strong>${['system_admin', 'head_teacher', 'deputy_head_teacher', 'teacher'].includes(role) ? '<div class="sub" id="academicContext" role="status">Loading academic context…</div>' : ''}</div>
        </div>
        <div class="user">
          <div class="user-identity"><span id="userInfo"></span><span id="userRole"></span></div>
          <button type="button" class="btn btn-secondary icon-control" data-theme-toggle aria-label="Switch theme"></button>
          <button type="button" class="btn btn-secondary btn-sm" id="shellLogout"><i data-lucide="log-out" aria-hidden="true"></i><span>Log Out</span></button>
        </div>
      </header>
      <main class="app-main" id="appMain" tabindex="-1"></main>
    </div>
    <button type="button" class="sidebar-backdrop" id="sidebarBackdrop" aria-label="Close navigation" tabindex="-1" hidden></button>
  `);
  document.getElementById('shellLogout').addEventListener('click', MGAEMS.logout);
  document.getElementById('appSchoolLogo').addEventListener('error', event => { event.target.hidden = true; });
  window.addEventListener('mgaems:school-settings', event => renderShellSchoolIdentity(event.detail));
  renderShellSchoolIdentity(MGAEMS.schoolBranding());
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

  function focusableControls() {
    return [...sidebar.querySelectorAll('a[href], button, [tabindex]')].filter(element =>
      !element.hidden && !element.disabled && !element.inert && element.getAttribute('aria-hidden') !== 'true'
      && element.tabIndex !== -1 && (typeof element.getClientRects !== 'function' || element.getClientRects().length > 0));
  }

  function focusInside() {
    const first = focusableControls()[0];
    if (first) first.focus();
    else sidebar.focus();
  }

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
      sidebar.setAttribute('tabindex', '-1');
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
      sidebar.removeAttribute('tabindex');
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
  sidebar.addEventListener('click', event => {
    if (!mobile.matches || !open || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (event.target.closest?.('a[href]')) dismiss();
  });
  document.addEventListener('keydown', event => {
    if (!mobile.matches || !open) return;
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if (event.key === 'Tab') {
      const controls = focusableControls();
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); sidebar.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
  });
  document.addEventListener('focusin', () => {
    // The skip link and browser/script focus can otherwise escape an open drawer.
    if (mobile.matches && open && !sidebar.contains(document.activeElement)) focusInside();
  });
  mobile.addEventListener('change', () => {
    const wasInSidebar = sidebar.contains(document.activeElement);
    const wasClose = document.activeElement === close;
    open = false;
    update();
    if ((mobile.matches && wasInSidebar) || (!mobile.matches && wasClose)) toggle.focus();
  });
  update();
}

function renderShellSchoolIdentity(settings) {
  if (!settings) return;
  const name = document.getElementById('appSchoolName');
  const motto = document.getElementById('appSchoolMotto');
  const logo = document.getElementById('appSchoolLogo');
  if (!name || !motto || !logo) return;
  name.textContent = settings.school_name || 'Manna Goodnews Academy';
  const home = document.getElementById('schoolHome');
  if (home) { home.setAttribute('aria-label', `${name.textContent} home`); home.setAttribute('title', name.textContent); }
  motto.textContent = settings.motto || '';
  const logoUrl = MGAEMS.schoolLogoURL(settings.logo_path, { revision: settings.logo_revision });
  if (logoUrl) { logo.src = logoUrl; logo.hidden = false; }
  else { logo.removeAttribute('src'); logo.hidden = true; }
}

async function loadShellContext() {
  if (!MGAEMS.currentUser()) return;
  const schoolRequest = MGAEMS.schoolSettings().then(result => {
    if (result.ok && result.data && !result.stale) renderShellSchoolIdentity(MGAEMS.schoolBranding() || result.data);
  }).catch(() => { /* Keep the safe school placeholder when identity is unavailable. */ });
  const context = document.getElementById('academicContext');
  if (context) {
    const [years, terms] = await MGAEMS.academicContext();
    if (!years.ok || !terms.ok || !Array.isArray(years.data) || !Array.isArray(terms.data)) {
      context.textContent = 'Academic context unavailable';
    } else {
      const { year, term } = MGAEMS.academicPeriod(years.data, terms.data);
      context.textContent = year && term ? `${year.name} · ${term.name}` : 'Academic setup required';
    }
  }
  await schoolRequest;
}
