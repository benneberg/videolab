/**
 * imageSource.js
 *
 * Manages the shared image source panel:
 *   - Drag-and-drop / click-to-upload
 *   - Text-prompt → text-to-image (HF FLUX Space, graceful fallback)
 *   - Canvas preview
 *   - Palette mood extraction (median-cut, client-side)
 *   - Exposes the current image as HTMLImageElement + dataURL to consumers
 *
 * Usage:
 *   import { ImageSource } from './imageSource.js';
 *   const src = new ImageSource('#image-source');
 *   src.on('change', ({ img, dataUrl, meta }) => { ... });
 */

import { get, set } from './storage.js';
import { generateImage } from '../engines/hfClient.js';

// ── SVG icons ────────────────────────────────────────────────────────
const ICON_IMAGE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
  <rect x="3" y="3" width="18" height="18" rx="2"/>
  <circle cx="8.5" cy="8.5" r="1.5"/>
  <path d="M21 15l-5-5L5 21"/>
</svg>`;

const ICON_REFRESH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M21 12a9 9 0 11-3.1-6.8L21 8V3"/>
  <path d="M21 3v5h-5"/>
</svg>`;

const ICON_NOTE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
</svg>`;

export class ImageSource {
  constructor(containerSelector) {
    this._container = document.querySelector(containerSelector);
    this._listeners = {};
    this._currentImg = null;
    this._currentDataUrl = null;
    this._lastGenPrompt = '';
    this._busy = false;

    this._render();
    this._bind();
    this._restoreNotepad();
  }

  // ── Public API ────────────────────────────────────────────────────

  /** Register event handler. Event: 'change' */
  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return this;
  }

  /** Get the current image element (null if none loaded). */
  get image() { return this._currentImg; }

  /** Get the current image as a data URL. */
  get dataUrl() { return this._currentDataUrl; }

  /** Programmatically load an image from a URL (e.g. generated). */
  async loadUrl(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    const dataUrl = this._imgToDataUrl(img);
    this._setImage(img, dataUrl, { source: 'url', url });
  }

  // ── Render ────────────────────────────────────────────────────────

  _render() {
    this._container.innerHTML = `
      <div class="sidebar-label">Source image</div>

      <div class="source-preview" id="src-preview">
        <canvas id="src-canvas" width="320" height="180"></canvas>
        <div class="preview-empty" id="src-empty">
          ${ICON_IMAGE}
          <span>No image loaded</span>
        </div>
      </div>

      <div class="drop-zone" id="src-drop" role="button" tabindex="0"
           aria-label="Upload image — drag and drop or click">
        <span>Drop image here</span>
        <span class="drop-label text-dim">JPG · PNG · WEBP</span>
      </div>
      <input type="file" id="src-file-input" accept="image/*" class="hidden">

      <div class="field">
        <div class="generate-row">
          <input type="text" id="src-gen-prompt"
                 placeholder="Describe an image to generate…"
                 maxlength="300">
          <button class="btn btn-secondary btn-sm" id="src-gen-btn" title="Generate image">
            ${ICON_REFRESH}
          </button>
        </div>
        <div class="status-line" id="src-status"></div>
      </div>

      <div class="mood-strip" id="src-mood" style="display:none">
        <div class="mood-swatches" id="src-swatches"></div>
        <span class="mood-label">Mood:</span>
        <span class="mood-value" id="src-mood-val">—</span>
      </div>

      <div class="source-meta hidden" id="src-meta">
        <div>Size: <span id="src-size">—</span></div>
        <div>Source: <span id="src-source">—</span></div>
      </div>
    `;
  }

  // ── Bind events ───────────────────────────────────────────────────

  _bind() {
    const drop       = this._container.querySelector('#src-drop');
    const fileInput  = this._container.querySelector('#src-file-input');
    const genBtn     = this._container.querySelector('#src-gen-btn');
    const genPrompt  = this._container.querySelector('#src-gen-prompt');

    // Click drop zone → open file picker
    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') fileInput.click();
    });

    // Drag events
    drop.addEventListener('dragover', e => {
      e.preventDefault();
      drop.classList.add('drag-over');
    });
    ['dragleave', 'dragend'].forEach(ev =>
      drop.addEventListener(ev, () => drop.classList.remove('drag-over'))
    );
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) this._loadFile(file);
    });

    // File input
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this._loadFile(file);
      fileInput.value = '';
    });

    // Generate
    genBtn.addEventListener('click', () => this._generate());
    genPrompt.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._generate();
    });
  }

  // ── File loading ──────────────────────────────────────────────────

  async _loadFile(file) {
    this._setStatus('busy', `Loading ${file.name}…`);
    const dataUrl = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = dataUrl;
    });
    this._setImage(img, dataUrl, {
      source: 'upload',
      name: file.name,
    });
    this._setStatus('ok', `Loaded: ${file.name}`);
  }

  // ── Generation ────────────────────────────────────────────────────

  async _generate() {
    const prompt = this._container.querySelector('#src-gen-prompt').value.trim();
    if (!prompt || this._busy) return;

    this._busy = true;
    this._lastGenPrompt = prompt;
    this._setStatus('busy', 'Generating image…');
    this._setBusy(true);

    try {
      const result = await generateImage(prompt);
      if (result.ok) {
        await this.loadUrl(result.url);
        this._setStatus('ok', 'Image generated');
        // Show re-roll button label
        this._container.querySelector('#src-gen-btn').title = 'Re-generate';
      } else {
        this._setStatus('error', result.error ?? 'Generation failed');
      }
    } catch (err) {
      this._setStatus('error', err.message ?? 'Generation failed');
    } finally {
      this._busy = false;
      this._setBusy(false);
    }
  }

  // ── Canvas preview ────────────────────────────────────────────────

  _updateCanvas(img) {
    const canvas = this._container.querySelector('#src-canvas');
    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;

    ctx.clearRect(0, 0, cw, ch);

    // Letterbox / pillarbox to fit
    const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    const x = (cw - w) / 2;
    const y = (ch - h) / 2;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, x, y, w, h);

    this._container.querySelector('#src-empty').style.display = 'none';
  }

  // ── Mood extraction (simple median-cut palette) ───────────────────

  _extractMood(img) {
    const canvas = document.createElement('canvas');
    const size = 64; // sample at low res for speed
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);

    const { data } = ctx.getImageData(0, 0, size, size);
    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
      // Skip very dark / very light pixels
      const [r, g, b] = [data[i], data[i+1], data[i+2]];
      const lum = 0.299*r + 0.587*g + 0.114*b;
      if (lum > 20 && lum < 240) pixels.push([r, g, b]);
    }

    if (!pixels.length) return null;

    // Simple k-means k=5
    const k = 5;
    let centroids = pixels.filter((_, i) => i % Math.floor(pixels.length / k) === 0).slice(0, k);

    for (let iter = 0; iter < 8; iter++) {
      const sums = centroids.map(() => [0, 0, 0, 0]);
      for (const p of pixels) {
        let best = 0, bd = Infinity;
        centroids.forEach((c, ci) => {
          const d = (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2;
          if (d < bd) { bd = d; best = ci; }
        });
        sums[best][0] += p[0];
        sums[best][1] += p[1];
        sums[best][2] += p[2];
        sums[best][3]++;
      }
      centroids = sums.map(([r, g, b, n]) =>
        n ? [Math.round(r/n), Math.round(g/n), Math.round(b/n)] : [128,128,128]
      );
    }

    const palette = centroids.map(([r, g, b]) => `rgb(${r},${g},${b})`);

    // Determine mood from dominant hue + saturation
    const dominant = centroids[0];
    const mood = this._classifyMood(dominant);

    return { palette, mood };
  }

  _classifyMood([r, g, b]) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (0.299*r + 0.587*g + 0.114*b) / 255;

    if (sat < 0.15) return lum > 0.6 ? 'bright · neutral' : 'dark · neutral';
    if (r > g && r > b) return 'warm · energetic';
    if (b > r && b > g) return 'cool · calm';
    if (g > r && g > b) return 'natural · balanced';
    return 'mixed';
  }

  _updateMood(img) {
    const result = this._extractMood(img);
    if (!result) return;

    const strip = this._container.querySelector('#src-mood');
    const swatchCtn = this._container.querySelector('#src-swatches');
    const moodVal = this._container.querySelector('#src-mood-val');

    swatchCtn.innerHTML = result.palette.map(c =>
      `<div class="mood-swatch" style="background:${c}"></div>`
    ).join('');
    moodVal.textContent = result.mood;
    strip.style.display = 'flex';

    // Broadcast to modules
    this._emit('mood', result);
  }

  // ── Shared image setter ───────────────────────────────────────────

  _setImage(img, dataUrl, meta = {}) {
    this._currentImg = img;
    this._currentDataUrl = dataUrl;

    this._updateCanvas(img);
    this._updateMood(img);

    // Meta display
    const metaEl = this._container.querySelector('#src-meta');
    const sizeEl = this._container.querySelector('#src-size');
    const srcEl  = this._container.querySelector('#src-source');
    metaEl.classList.remove('hidden');
    sizeEl.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
    srcEl.textContent  = meta.name ?? meta.source ?? 'url';

    // Cache dataUrl for restore across navigations
    try {
      // Only cache if < 2MB to avoid quota issues
      if (dataUrl.length < 2 * 1024 * 1024) {
        set('lastImageDataUrl', dataUrl);
        set('lastImageMeta', meta);
      }
    } catch { /* quota */ }

    this._emit('change', { img, dataUrl, meta });
  }

  // ── UI helpers ────────────────────────────────────────────────────

  _setStatus(kind, msg) {
    const el = this._container.querySelector('#src-status');
    el.className = `status-line ${kind}`;
    el.textContent = msg;
  }

  _setBusy(busy) {
    const btn = this._container.querySelector('#src-gen-btn');
    btn.disabled = busy;
  }

  _imgToDataUrl(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.92);
  }

  _emit(event, data) {
    (this._listeners[event] ?? []).forEach(fn => fn(data));
  }

  // ── Notepad ───────────────────────────────────────────────────────

  _restoreNotepad() {
    // Notepad is mounted elsewhere; this is handled by Notepad class.
  }
}
