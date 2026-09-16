/**
 * main.js — VideoLab app bootstrap
 *
 * 1. Builds the shell HTML (topbar, sidebar, main)
 * 2. Mounts the ImageSource panel in the sidebar
 * 3. Registers and mounts all modules
 * 4. Wires image-change events to every module
 * 5. Initialises the tab switcher and notepad
 * 6. Handles mobile-specific UI interactions (slide-up drawer)
 */

import './style/base.css';
import './style/shell.css';
import './style/modules.css';

import { ImageSource } from './shell/imageSource.js';
import { TabBar }      from './shell/tabBar.js';
import { Notepad }     from './shell/notepad.js';

import { DirectorModule } from './modules/director/index.js';
import { LipsyncModule  } from './modules/lipsync/index.js';

// ── SVG Icons for the tab bar ──────────────────────────────────────────
const ICON_DIRECTOR = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="2" y="2" width="20" height="20" rx="2.18"/>
  <line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/>
  <line x1="2" y1="12" x2="22" y2="12"/>
</svg>`;

const ICON_LIPSYNC = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
  <path d="M19 10v2a7 7 0 01-14 0v-2"/>
  <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
</svg>`;

// ── Build shell structure ──────────────────────────────────────────────

function buildShell() {
  document.body.innerHTML = `
    <div id="app">

      <header id="topbar">
        <div class="topbar-brand">
          <span class="name">VideoLab</span>
          <span class="version">v0.1</span>
        </div>
        <div class="topbar-spacer"></div>
        
        <!-- Mobile Image Source Toggle Button (Hidden on Desktop) -->
        <button id="mobile-image-toggle" class="btn-icon btn-ghost mobile-only" aria-label="Toggle image source">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <path d="M21 15l-5-5L5 21"/>
          </svg>
        </button>

        <!-- Desktop Status (Hidden on Mobile) -->
        <div class="topbar-status desktop-only">
          <div class="status-dot ready" id="global-dot"></div>
          <span id="global-status">Ready</span>
        </div>
      </header>

      <nav id="sidebar">
        <div class="sidebar-section">
          <div class="sidebar-label">Modules</div>
          <div id="module-nav" class="module-nav"></div>
        </div>

        <div id="image-source"></div>
      </nav>

      <main id="main">
        <div class="module-view" data-module="director" id="module-director"></div>
        <div class="module-view" data-module="lipsync"  id="module-lipsync"></div>
      </main>

    </div>
    
    <!-- Backdrop for mobile drawer -->
    <div id="mobile-backdrop" class="mobile-backdrop"></div>
  `;
}

// ── Global status helpers ──────────────────────────────────────────────

function setGlobalStatus(kind, text) {
  const dot = document.getElementById('global-dot');
  const lbl = document.getElementById('global-status');
  dot.className = `status-dot ${kind}`;
  lbl.textContent = text;
}

// ── Boot ───────────────────────────────────────────────────────────────

buildShell();

// Image source panel
const imageSource = new ImageSource('#image-source');

// Modules
const modules = [
  new DirectorModule('#module-director', imageSource),
  new LipsyncModule('#module-lipsync',   imageSource),
];

// Tab bar
const tabBar = new TabBar('#module-nav', '#main');

tabBar.register({ id: 'director', label: 'Director', icon: ICON_DIRECTOR });
tabBar.register({ id: 'lipsync',  label: 'Lipsync',  icon: ICON_LIPSYNC  });

tabBar.init('director');

// Mount all modules
for (const mod of modules) {
  mod.mount();
}

// Wire image changes → all modules
imageSource.on('change', data => {
  for (const mod of modules) {
    mod.onImageChange?.(data);
  }
  setGlobalStatus('ready', 'Image loaded');
});

imageSource.on('mood', data => {
  // Future: modules can opt in to mood data
});

// Wire tab switches → module lifecycle
tabBar.on('activate', ({ id }) => {
  const mod = modules.find(m => m.id === id);
  mod?.onActivate?.();
  
  // Proactive: Auto-close the mobile drawer when switching tabs
  closeMobileDrawer();
});

// Notepad
new Notepad();

// ── Mobile Image Source Drawer Logic ─────────────────────────────────

const mobileToggle = document.getElementById('mobile-image-toggle');
const imageSourceEl = document.getElementById('image-source');
const backdrop = document.getElementById('mobile-backdrop');

function closeMobileDrawer() {
  if (imageSourceEl) imageSourceEl.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.remove('active');
}

if (mobileToggle) {
  mobileToggle.addEventListener('click', () => {
    const isOpen = imageSourceEl?.classList.contains('mobile-open');
    if (isOpen) {
      closeMobileDrawer();
    } else {
      if (imageSourceEl) imageSourceEl.classList.add('mobile-open');
      if (backdrop) backdrop.classList.add('active');
    }
  });
}

if (backdrop) {
  backdrop.addEventListener('click', closeMobileDrawer);
}

// ── Global error display (development aid) ─────────────────────────────
window.addEventListener('unhandledrejection', evt => {
  console.error('[VideoLab] Unhandled rejection:', evt.reason);
  setGlobalStatus('error', evt.reason?.message ?? 'Unexpected error');
});
