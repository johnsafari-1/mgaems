// DOM interface tests for shared focus/validation behavior; not browser rendering tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const handlers = new Set();
  const document = { activeElement: null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener: (name, handler) => handlers.add(handler), removeEventListener: (name, handler) => handlers.delete(handler) };
  class Element {
    constructor(tag = 'DIV') { this.tagName = tag; this.children = []; this.attrs = new Map(); this.disabled = false; this.inert = false; this.style = {}; this.listeners = {}; this.tabIndex = ['BUTTON', 'INPUT'].includes(tag) ? 0 : -1; }
    get isConnected() { let element = this; while (element) { if (element === document.body) return true; element = element.parentElement; } return false; }
    appendChild(element) { this.children.push(element); element.parentElement = this; return element; }
    remove() { const parent = this.parentElement; if (parent) parent.children = parent.children.filter(element => element !== this); this.parentElement = null; }
    setAttribute(name, value) { this.attrs.set(name, value); }
    getAttribute(name) { return this.attrs.get(name); }
    removeAttribute(name) { this.attrs.delete(name); }
    focus() { document.activeElement = this; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    getClientRects() { return [1]; }
    closest() { let element = this; while (element) { if (element.inert) return element; element = element.parentElement; } return null; }
    set innerHTML(html) {
      this.html = html;
      if (!html.includes('role="dialog"')) return;
      this.dialog = this.appendChild(new Element());
      this.modalBody = this.dialog.appendChild(new Element());
      this.controls = [...html.matchAll(/<(button|input)\b([^>]*)>/g)].map(([, tag, attrs]) => {
        const control = this.dialog.appendChild(new Element(tag.toUpperCase()));
        control.disabled = /\bdisabled\b/.test(attrs);
        if (attrs.includes('data-dialog-close')) control.attrs.set('data-dialog-close', '');
        if (attrs.includes('data-confirm')) control.attrs.set('data-confirm', '');
        return control;
      });
    }
    get innerHTML() { return this.html; }
    querySelector(selector) {
      if (selector === '[role="dialog"]') return this.dialog;
      if (selector === '.modal-body') return this.modalBody;
      return this.controls?.find(control => control.attrs.has(selector.slice(1, -1)));
    }
    querySelectorAll(selector) {
      if (selector === 'button') return this.controls.filter(control => control.tagName === 'BUTTON');
      if (selector === '[data-dialog-close]') return this.controls.filter(control => control.attrs.has('data-dialog-close'));
      return this.controls || [];
    }
  }
  document.body = new Element('BODY'); document.body.style.overflow = '';
  document.documentElement = new Element('HTML');
  document.createElement = () => new Element();
  const background = document.body.appendChild(new Element());
  const trigger = background.appendChild(new Element('BUTTON')); trigger.focus();
  const previouslyInert = document.body.appendChild(new Element()); previouslyInert.inert = true;
  const context = vm.createContext({ document, window: { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} }, localStorage: { getItem: () => null }, setTimeout });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../public/assets/app.js'), 'utf8'), context);
  return { app: vm.runInContext('MGAEMS', context), document, background, previouslyInert, trigger, Element, key(event) { for (const handler of handlers) handler(event); } };
}

test('shared dialog initializes focus, traps both Tab directions, and restores focus/inert state', () => {
  const h = harness();
  const modal = h.app.openModal({ title: 'Test dialog', body: '<input>', footer: '<button data-dialog-close>Cancel</button><button>Save</button>' });
  const controls = modal.overlay.controls;
  assert.equal(h.document.activeElement.tagName, 'INPUT');
  assert.equal(h.background.inert, true);
  assert.equal(h.document.body.style.overflow, 'hidden');
  let prevented = false;
  controls.at(-1).focus(); h.key({ key: 'Tab', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(h.document.activeElement, controls[0]);
  h.key({ key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.equal(h.document.activeElement, controls.at(-1));
  h.key({ key: 'Escape', preventDefault() {} });
  assert.equal(modal.closed, true); assert.equal(h.document.activeElement, h.trigger);
  assert.equal(h.background.inert, false); assert.equal(h.previouslyInert.inert, true);
  assert.equal(h.document.body.style.overflow, '');
});

test('busy submissions prevent dismissal and nested confirmation preserves parent dialog', async () => {
  const h = harness();
  const parent = h.app.openModal({ title: 'Edit', body: '<input>', footer: '<button>Save</button>' });
  parent.setBusy(true); h.key({ key: 'Escape', preventDefault() {} });
  assert.equal(parent.closed, false);
  assert.equal(parent.overlay.querySelector('[role="dialog"]').getAttribute('aria-busy'), 'true');
  assert.equal(parent.overlay.controls.every(control => control.tagName !== 'BUTTON' || control.disabled), true);
  parent.setBusy(false);
  const result = h.app.confirmAction('Confirm', 'Test confirmation');
  const child = h.document.body.children.at(-1);
  assert.equal(parent.overlay.inert, true);
  child.querySelector('[data-confirm]').listeners.click();
  assert.equal(await result, true);
  assert.equal(parent.closed, false); assert.equal(parent.overlay.inert, false); assert.equal(h.background.inert, true);
  parent.close(); assert.equal(h.background.inert, false);
});

test('form errors escape API text, mark controls, and focus the error summary', () => {
  const h = harness();
  const summary = new h.Element();
  const control = new h.Element('INPUT'); control.name = 'account.email';
  const form = { elements: [control], querySelectorAll: () => [], querySelector: () => summary };
  h.app.showFormErrors(form, { error: '<Server error>', fields: { 'account.email': ['<Invalid email>'] } });
  assert.match(summary.innerHTML, /&lt;Server error&gt;/); assert.match(summary.innerHTML, /&lt;Invalid email&gt;/);
  assert.doesNotMatch(summary.innerHTML, /<Server error>/);
  assert.equal(control.getAttribute('aria-invalid'), 'true'); assert.equal(h.document.activeElement, summary);
});
