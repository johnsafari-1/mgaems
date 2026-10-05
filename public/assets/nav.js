/* Shared, role-aware application shell. Backend policies remain authoritative. */
const MGAEMS_NAV_GROUPS = [
  { label: 'Overview', items: [
    { href: '/dashboard.html', icon: 'layout-dashboard', label: 'Dashboard' },
  ]},
  { label: 'People', items: [
    { href: '/students.html', icon: 'graduation-cap', label: 'Learners' },
    { href: '/guardians.html', icon: 'contact-round', label: 'Parents / Guardians', roles: ['system_admin', 'head_teacher', 'deputy_head_teacher'] },
    { href: '/staff.html', icon: 'users-round', label: 'HR / Staff', roles: ['system_admin', 'head_teacher', 'deputy_head_teacher'] },
  ]},
  { label: 'Academics', items: [
    { href: '/academic.html', icon: 'book-open', label: 'Academic Structure' },
    { href: '/attendance.html', icon: 'calendar-check', label: 'Attendance' },
    { href: '/assessment.html', icon: 'clipboard-check', label: 'Assessment' },
  ]},
  { label: 'Sponsorship', items: [
    { href: '/sponsorship.html', icon: 'heart-handshake', label: 'Sponsorship', roles: ['system_admin', 'sponsor_coordinator', 'head_teacher', 'deputy_head_teacher'] },
  ]},
  { label: 'Operations', items: [
    { href: '/communication.html', icon: 'megaphone', label: 'Communication' },
    { href: '/visitors.html', icon: 'clipboard-list', label: 'Visitors', roles: ['system_admin', 'head_teacher', 'deputy_head_teacher', 'sponsor_coordinator'] },
  ]},
  { label: 'Reporting', items: [
    { href: '/reports.html', icon: 'bar-chart-3', label: 'Reports', roles: ['system_admin', 'head_teacher', 'deputy_head_teacher'] },
  ]},
  { label: 'System', items: [
    { href: '/administration.html', icon: 'settings', label: 'Administration', roles: ['system_admin', 'head_teacher'] },
  ]},
];

const MGAEMS_PAGE_TITLES = Object.fromEntries(
  MGAEMS_NAV_GROUPS.flatMap(group => group.items.map(item => [item.href, item.label]))
);

function renderAppShell(activeHref, logoUrl) {
  const user = MGAEMS.currentUser();
  const role = user?.role;
  const isPortal = ['parent_guardian', 'sponsor'].includes(role);
  const groups = isPortal ? [{ label: 'Portal', items: [role === 'parent_guardian'
    ? { href: '/parent-portal.html', icon: 'home', label: 'Parent Portal' }
    : { href: '/sponsor-portal.html', icon: 'heart-handshake', label: 'Sponsor Portal' }
  ]}] : MGAEMS_NAV_GROUPS;
  const visibleGroups = groups.map(group => ({
    ...group,
    items: group.items.filter(item => !item.roles || item.roles.includes(role)),
  })).filter(group => group.items.length);
  const pageTitle = MGAEMS_PAGE_TITLES[activeHref] || visibleGroups.flatMap(group => group.items).find(item => item.href === activeHref)?.label || 'Workspace';
  const nav = visibleGroups.map(group => `
    <section class="nav-group" aria-labelledby="nav-${group.label.toLowerCase()}">
      <h2 id="nav-${group.label.toLowerCase()}" class="nav-group-label">${group.label}</h2>
      ${group.items.map(item => `<a href="${item.href}" class="nav-link${item.href === activeHref ? ' active' : ''}" ${item.href === activeHref ? 'aria-current="page"' : ''} title="${item.label}"><i data-lucide="${item.icon}"></i><span>${item.label}</span></a>`).join('')}
    </section>`).join('');
  const safeName = MGAEMS.escapeHTML(user?.username || 'User');
  const safeRole = MGAEMS.escapeHTML((role || '').replace(/_/g, ' '));

  document.body.insertAdjacentHTML('afterbegin', `
    <div class="app-shell">
      <aside class="app-sidebar" id="appSidebar" aria-label="Primary navigation">
        <div class="sidebar-brand">
          <img src="${logoUrl}" alt="" onerror="this.style.display='none'">
          <div><strong>MGAEMS</strong><span>Manna Goodnews Academy</span></div>
        </div>
        <nav class="sidebar-nav">${nav}</nav>
        <div class="sidebar-footer"><span>School Management System</span></div>
      </aside>
      <div class="app-workspace">
        <header class="app-header">
          <div class="header-leading">
            <button class="icon-btn mobile-menu" id="mobileMenu" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="appSidebar"><i data-lucide="menu"></i></button>
            <button class="icon-btn sidebar-toggle" id="sidebarToggle" type="button" aria-label="Collapse navigation" aria-expanded="true"><i data-lucide="panel-left-close"></i></button>
            <div><span class="eyebrow">Manna Goodnews Academy</span><h1>${pageTitle}</h1></div>
          </div>
          <div class="header-actions">
            <div class="academic-context" id="academicContext" aria-live="polite"><i data-lucide="calendar-range"></i><span>Loading academic context…</span></div>
            <div class="user-menu"><span class="user-avatar" aria-hidden="true">${safeName.charAt(0).toUpperCase()}</span><span class="user-details"><strong>${safeName}</strong><small>${safeRole}</small></span></div>
            <button class="icon-btn" type="button" onclick="MGAEMS.logout()" aria-label="Log out" title="Log out"><i data-lucide="log-out"></i></button>
          </div>
        </header>
        <main class="app-main" id="appMain" tabindex="-1"></main>
      </div>
    </div>
    <button class="sidebar-scrim" id="sidebarScrim" type="button" aria-label="Close navigation"></button>
  `);
}
