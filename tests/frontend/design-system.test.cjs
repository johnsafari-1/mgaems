// Static design contracts and computed token contrast; visual acceptance is separate.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.resolve(__dirname, '../../public/assets/app.css'), 'utf8');
const tokens = block => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]));
const light = tokens(css.match(/:root, :root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/)[1]);
const dark = { ...light, ...tokens(css.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)[1]) };
const luminance = hex => {
  const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels.reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
};
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };

test('institutional palette and shared density tokens remain centralized with safe system typography', () => {
  assert.equal(light.navy, '#16324F'); assert.equal(light.teal, '#197E83'); assert.equal(light['gray-100'], '#F1F5F9'); assert.equal(light.surface, '#FFFFFF'); assert.equal(light.gold, '#E5A93D');
  for (const name of ['font-sans', 'radius', 'radius-lg', 'shadow', 'focus-ring', 'sidebar-width', 'content-width', 'control-height', 'touch-target', 'table-cell-y', 'table-cell-x', 'breakpoint-compact', 'breakpoint-drawer', 'breakpoint-laptop']) assert.ok(light[name], name);
  assert.doesNotMatch(css, /@import|fonts\.google|linear-gradient/); assert.match(css, /font-family: var\(--font-sans\)/);
});

for (const [theme, palette] of [['light', light], ['dark', dark]]) {
  test(`${theme} text and functional color tokens meet normal-text contrast`, () => {
    const pairs = [['gray-900', 'surface'], ['gray-500', 'surface'], ['gray-700', 'gray-100'], ['navy-light', 'gray-100'], ['navy-light', 'info-bg'], ['on-primary', 'primary-bg'], ['on-primary', 'primary-hover'], ['on-danger', 'danger-bg'], ['green', 'green-light'], ['red', 'red-light'], ['amber', 'amber-light'], ['navy', 'teal-light'], ['sidebar-text', 'sidebar-bg'], ['sidebar-muted', 'sidebar-bg'], ['sidebar-text', 'sidebar-active']];
    for (const [foreground, background] of pairs) assert.ok(contrast(palette[foreground], palette[background]) >= 4.5, `${foreground}/${background}: ${contrast(palette[foreground], palette[background]).toFixed(2)}`);
  });
  test(`${theme} focus rings and control boundaries remain visible`, () => {
    for (const [foreground, background] of [['focus-ring', 'surface'], ['gray-300', 'surface'], ['gold', 'sidebar-bg']]) assert.ok(contrast(palette[foreground], palette[background]) >= 3, `${foreground}/${background}`);
  });
}

test('shared responsive contracts contain tables, reflow dashboards and forms, and preserve touch/focus/motion support', () => {
  assert.match(css, /\.app-main\s*\{[^}]*min-width: 0/); assert.match(css, /\.table-scroll\s*\{[^}]*overflow-x: auto[^}]*max-width: 100%/);
  assert.match(css, /\.card:has\(> table\)\s*\{ overflow-x: auto/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?\.dashboard-grid \{ grid-template-columns: 1fr/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.quick-links, \.period-detail, \.dashboard-summary-grid, \.admin-detail-grid \{ grid-template-columns: 1fr/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?min-height: var\(--touch-target\)/); assert.equal(light['touch-target'], '44px');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/); assert.match(css, /:focus-visible/);
  assert.match(css, /\.modal-body[^}]*max-height: 65dvh/); assert.match(css, /\.navigation-open \.app-sidebar/);
});
