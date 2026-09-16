/**
 * notepad.js
 *
 * Floating notepad widget, persisted to localStorage.
 * Mounts a toggle button (bottom-right) that opens/closes a panel.
 */

import { get, set } from './storage.js';

const ICON_NOTE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
</svg>`;

export class Notepad {
  constructor() {
    this._open    = get('notepad:open', false);
    this._content = get('notepad:content', '');
    this._saveTimer = null;

    this._mount();
    this._bind();

    if (this._open) this._show();
  }

  _mount() {
    const el = document.createElement('div');
    el.id = 'notepad-stub';
    el.innerHTML = `
      <div id="notepad-panel" class="${this._open ? '' : 'hidden'}">
        <div class="notepad-header">
          <span class="mono" style="font-size:11px">Notepad</span>
          <span id="notepad-save-status" style="font-size:10px;color:var(--text-dim)">saved</span>
        </div>
        <textarea id="notepad-textarea"
          placeholder="Scratch notes, prompts, ideas…"
          aria-label="Notepad">${this._escHtml(this._content)}</textarea>
      </div>
      <button id="notepad-toggle" title="Notepad" aria-label="Toggle notepad">
        ${ICON_NOTE}
      </button>
    `;
    document.body.appendChild(el);
  }

  _bind() {
    document.getElementById('notepad-toggle')
      .addEventListener('click', () => this._toggle());

    const ta = document.getElementById('notepad-textarea');
    ta.addEventListener('input', () => {
      this._content = ta.value;
      this._scheduleSave();
    });
  }

  _toggle() {
    this._open = !this._open;
    set('notepad:open', this._open);
    this._open ? this._show() : this._hide();
  }

  _show() {
    document.getElementById('notepad-panel').classList.remove('hidden');
    document.getElementById('notepad-textarea').focus();
  }

  _hide() {
    document.getElementById('notepad-panel').classList.add('hidden');
  }

  _scheduleSave() {
    const status = document.getElementById('notepad-save-status');
    status.textContent = 'saving…';
    status.style.color = 'var(--amber)';

    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      set('notepad:content', this._content);
      status.textContent = 'saved';
      status.style.color = 'var(--text-dim)';
    }, 600);
  }

  _escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}
