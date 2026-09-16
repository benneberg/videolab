/**
 * tabBar.js
 *
 * Manages the sidebar module navigation.
 * Each module registers itself with { id, label, icon, status }.
 * Switching a tab shows the matching .module-view and fires 'activate'.
 */

export class TabBar {
  constructor(navSelector, mainSelector) {
    this._nav     = document.querySelector(navSelector);
    this._main    = document.querySelector(mainSelector);
    this._modules = [];
    this._active  = null;
    this._listeners = {};
  }

  /** Register a module button in the nav. Call before init(). */
  register({ id, label, icon, status = null }) {
    this._modules.push({ id, label, icon, status });
  }

  /** Render nav buttons and activate the first (or saved) module. */
  init(defaultId) {
    this._nav.innerHTML = '';

    for (const mod of this._modules) {
      const btn = document.createElement('button');
      btn.className    = 'module-btn';
      btn.dataset.id   = mod.id;
      btn.setAttribute('aria-label', mod.label);
      btn.innerHTML = `
        ${mod.icon}
        <span>${mod.label}</span>
        ${mod.status ? `<span class="badge ${mod.status.type ?? ''}">${mod.status.label}</span>` : ''}
      `;
      btn.addEventListener('click', () => this.activate(mod.id));
      this._nav.appendChild(btn);
    }

    this.activate(defaultId ?? this._modules[0]?.id);
  }

  activate(id) {
    if (!id) return;

    // Update button states
    this._nav.querySelectorAll('.module-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.id === id);
    });

    // Show / hide module views
    this._main.querySelectorAll('.module-view').forEach(view => {
      view.classList.toggle('active', view.dataset.module === id);
    });

    const prev = this._active;
    this._active = id;

    if (prev !== id) {
      this._emit('activate', { id, prev });
    }
  }

  get activeId() { return this._active; }

  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return this;
  }

  _emit(event, data) {
    (this._listeners[event] ?? []).forEach(fn => fn(data));
  }
}
