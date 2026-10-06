// Small DOM interface for workflow checks; this does not emulate browser layout.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
module.exports = function createDOM(role = 'teacher', pathname = '/assessment.html') {
  const ids = new Map();
  const document = { activeElement: null, getElementById: id => ids.get(id) || null, querySelectorAll: () => [] };
  class Element {
    constructor(tag = 'div', attrs = {}) {
      this.tag = tag; this.attrs = attrs; this.children = []; this.listeners = {}; this.dataset = {}; this.value = attrs.value || ''; this.name = attrs.name || '';
      this.disabled = 'disabled' in attrs; this.required = 'required' in attrs; this.hidden = 'hidden' in attrs; this.classList = { toggle() {} };
      for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      if (attrs.id) ids.set(attrs.id, this);
    }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name]; }
    removeAttribute(name) { delete this.attrs[name]; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    focus() { document.activeElement = this; }
    appendChild(child) { this.children.push(child); child.parentElement = this; }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    get elements() { const controls = this.descendants().filter(child => ['input', 'select', 'button', 'textarea'].includes(child.tag)); for (const control of controls) if (control.name) controls[control.name] = control; return controls; }
    reportValidity() { return this.elements.every(control => control.disabled || !control.required || control.value !== ''); }
    querySelectorAll(selector) {
      const matches = (node, part) => {
        if (part.startsWith('#')) return node.attrs.id === part.slice(1);
        if (part.startsWith('[')) { const [, key, value] = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/) || []; return key in node.attrs && (value === undefined || node.attrs[key] === value); }
        return node.tag === part;
      };
      return this.descendants().filter(child => selector.split(',').some(part => {
        const parts = part.trim().split(/\s+/); if (!matches(child, parts.at(-1))) return false;
        if (parts.length === 1) return true;
        let parent = child.parentElement; while (parent) { if (matches(parent, parts[0])) return true; parent = parent.parentElement; } return false;
      }));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get innerHTML() { return this.html || ''; }
    set innerHTML(html) {
      for (const node of this.descendants()) if (node.attrs.id && ids.get(node.attrs.id) === node) ids.delete(node.attrs.id);
      this.html = html; this.children = []; const stack = [this];
      for (const token of html.matchAll(/<\/?[a-z][^>]*>/gi)) {
        const source = token[0], closing = /^<\//.test(source), tag = source.match(/^<\/?([a-z0-9]+)/i)[1].toLowerCase();
        if (closing) { const index = stack.map(node => node.tag).lastIndexOf(tag); if (index > 0) stack.length = index; continue; }
        const attrs = {}; for (const match of source.slice(tag.length + 1, -1).matchAll(/([a-z][\w-]*)(?:="([^"]*)")?/gi)) attrs[match[1]] = match[2] || '';
        const node = new Element(tag, attrs); stack.at(-1).appendChild(node);
        if (!['input', 'br', 'hr', 'meta', 'link', 'img'].includes(tag)) stack.push(node);
      }
      for (const control of this.descendants().filter(node => node.tag === 'select')) { const choices = control.children.filter(node => node.tag === 'option'); control.value = (choices.find(node => 'selected' in node.attrs) || choices[0])?.attrs.value || ''; }
    }
  }
  document.documentElement = new Element('html');
  const window = { location: { pathname, href: pathname }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  const context = vm.createContext({ document, window, URLSearchParams, setTimeout,
    localStorage: { getItem: key => key === 'mgaems_token' ? 'memory-session' : key === 'mgaems_user' ? JSON.stringify({ username: 'test-user', role }) : null },
    renderAppShell() { new Element('main', { id: 'appMain' }); } });
  const run = name => vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../../public/assets', name), 'utf8'), context);
  run('app.js'); const app = vm.runInContext('MGAEMS', context); const modals = [];
  app.openModal = definition => {
    const overlay = new Element(), body = new Element(); overlay.appendChild(body); body.innerHTML = definition.body;
    const footer = new Element(); overlay.appendChild(footer); footer.innerHTML = definition.footer || '';
    const modal = { ...definition, overlay, body, closed: false, setBusy(value) { this.busy = value; overlay.querySelectorAll('button').forEach(button => { button.disabled = value; }); }, close() { this.closed = true; } };
    modals.push(modal); return modal;
  };
  return { app, context, document, ids, modals, run, Element };
};
