/* Loaded only by the isolated demo router, not by the active school app. */
(() => {
  const banner = document.createElement('aside');
  banner.className = 'synthetic-demo-banner';
  banner.innerHTML = '<strong>SYNTHETIC DEMO</strong> Original test material · isolated database · sample drafts, not live AI. <a href="/demo">Demo guide</a>';
  document.body.appendChild(banner);
  const draft = MGAEMS.groundedDraft;
  MGAEMS.groundedDraft = options => draft({ ...options,
    selection: { ...options.selection, grade: 7, learning_area: 'Integrated Science', strand: 'Observing and measuring', sub_strand: 'Temperature readings' },
    constraints: { ...options.constraints, ...('total_marks' in (options.constraints || {}) ? { total_marks: 10 } : {}) },
  });
})();
