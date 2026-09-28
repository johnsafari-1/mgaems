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
  const role = MGAEMS.currentUser()?.role;
  const portalItems = role === 'parent_guardian'
    ? [{ href: '/parent-portal.html', icon: 'home', label: 'Parent Portal' }]
    : [{ href: '/sponsor-portal.html', icon: 'heart-handshake', label: 'Sponsor Portal' }];
  const items = (['parent_guardian', 'sponsor'].includes(role) ? portalItems : MGAEMS_NAV_ITEMS)
    .filter(item => !item.roles || item.roles.includes(role));
  const navLinks = items.map(item => `
    <a href="${item.href}" class="${item.href === activeHref ? 'active' : ''}">
      <i data-lucide="${item.icon}"></i> ${item.label}
    </a>`).join('');

  document.body.insertAdjacentHTML('afterbegin', `
    <header class="app-header">
      <div class="brand">
        <img src="${logoUrl}" onerror="this.style.display='none'">
        <div>
          <h1 id="schoolName">MGAEMS</h1>
          <div class="sub" id="schoolMotto"></div>
        </div>
      </div>
      <div class="user">
        <span id="userInfo"></span>
        <button class="btn btn-secondary btn-sm" onclick="MGAEMS.logout()">
          <i data-lucide="log-out"></i> Log Out
        </button>
      </div>
    </header>
    <div class="app-shell">
      <nav class="app-sidebar">${navLinks}</nav>
      <main class="app-main" id="appMain"></main>
    </div>
  `);
}
