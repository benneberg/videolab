/**
 * director/index.js
 *
 * Director module: AI-generated shot lists → sequential render → video.
 *
 * Layout (two-column on wide screens):
 *   Left pane:  Controls (style, duration, shot count, render button)
 *   Right pane: Shot list editor + result video
 */

import { ShotList, CAMERA_MOVES, FILM_STYLES } from './shotList.js';
import { renderShot, stitchVideos } from './render.js';
import { get, set } from '../../shell/storage.js';

// ── Icons ─────────────────────────────────────────────────────────────
const ICON_FILM = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="2" y="2" width="20" height="20" rx="2.18"/>
  <line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/>
  <line x1="2" y1="12" x2="22" y2="12"/>
  <line x1="2" y1="7" x2="7" y2="7"/><line x1="17" y1="7" x2="22" y2="7"/>
  <line x1="17" y1="17" x2="22" y2="17"/><line x1="2" y1="17" x2="7" y2="17"/>
</svg>`;

const ICON_PLUS  = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
const ICON_UP    = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>`;
const ICON_DOWN  = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
const ICON_EDIT  = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z"/></svg>`;

// ── Cloudflare Worker URL for AI shot generation ───────────────────────
// Replace with your own worker URL after deployment.
// Falls back to a structured template when not set.
const WORKER_URL = get('directorWorkerUrl', '');

export class DirectorModule {
  constructor(containerSelector, imageSource) {
    this._container   = document.querySelector(containerSelector);
    this._imageSource = imageSource;
    this._shotList    = new ShotList();
    this._rendering   = false;
    this._finalBlob   = null;

    this._settings = {
      style:      get('director:style',      'auto'),
      shotCount:  get('director:shotCount',  5),
      shotDur:    get('director:shotDur',    5),
      resolution: get('director:resolution', '1280x720'),
      workerUrl:  get('directorWorkerUrl',   ''),
    };
  }

  // ── Module interface ──────────────────────────────────────────────

  get id()    { return 'director'; }
  get label() { return 'Director'; }
  get icon()  { return ICON_FILM; }

  mount() {
    this._render();
    this._bind();
    this._shotList.on('change',  shots => this._renderShotList(shots));
    this._shotList.on('update',  shot  => this._updateShotCard(shot));
    // Render the existing saved shots on mount
    if (this._shotList.length) this._renderShotList(this._shotList.shots);
  }

  onImageChange({ dataUrl }) {
    this._imageDataUrl = dataUrl;
    // Enable the generate button now that we have an image
    const btn = this._container.querySelector('#dir-generate-btn');
    if (btn) btn.disabled = false;
  }

  // ── HTML ─────────────────────────────────────────────────────────

  _render() {
    this._container.innerHTML = `
      <div class="module-header">
        <div>
          <div class="module-title">Director</div>
          <div class="module-subtitle">
            AI analyzes your image and writes a shot list — edit, then render all shots into one video.
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:260px 1fr;gap:20px;align-items:start;">

        <!-- Controls pane -->
        <div style="display:flex;flex-direction:column;gap:16px;">

          <div class="panel">
            <div class="panel-title">${ICON_FILM} Shot settings</div>

            <div class="field">
              <label class="field-label">Film style</label>
              <select id="dir-style-sel">
                ${Object.entries(FILM_STYLES).map(([v, l]) =>
                  `<option value="${v}" ${v === this._settings.style ? 'selected' : ''}>${l}</option>`
                ).join('')}
              </select>
            </div>

            <div class="grid-2" style="margin-top:12px;">
              <div class="field">
                <label class="field-label">Shots</label>
                <input type="number" id="dir-shot-count" min="1" max="20"
                       value="${this._settings.shotCount}">
              </div>
              <div class="field">
                <label class="field-label">Duration (s)</label>
                <input type="number" id="dir-shot-dur" min="2" max="30"
                       value="${this._settings.shotDur}">
              </div>
            </div>

            <div class="field" style="margin-top:12px;">
              <label class="field-label">Resolution</label>
              <select id="dir-res-sel">
                <option value="854x480"   ${this._settings.resolution==='854x480'?'selected':''}>480p landscape</option>
                <option value="1280x720"  ${this._settings.resolution==='1280x720'?'selected':''}>720p landscape</option>
                <option value="1920x1080" ${this._settings.resolution==='1920x1080'?'selected':''}>1080p landscape</option>
                <option value="720x1280"  ${this._settings.resolution==='720x1280'?'selected':''}>720p portrait</option>
                <option value="1080x1920" ${this._settings.resolution==='1080x1920'?'selected':''}>1080p portrait</option>
              </select>
            </div>

            <button class="btn btn-primary btn-full" id="dir-generate-btn"
                    style="margin-top:16px;" ${this._imageDataUrl ? '' : 'disabled'}>
              Generate shot list
            </button>

            <div class="status-line" id="dir-gen-status" style="margin-top:8px;"></div>
          </div>

          <div class="panel">
            <div class="panel-title">Render</div>
            <p style="font-size:12px;color:var(--text-dim);margin-bottom:12px;line-height:1.5;">
              Renders each shot via public HF Spaces and stitches them into a single video.
            </p>
            <button class="btn btn-primary btn-full" id="dir-render-btn"
                    ${this._shotList.length ? '' : 'disabled'}>
              Render director's cut
            </button>
            <div class="progress-bar" style="margin-top:8px;" id="dir-render-prog">
              <div class="progress-fill" id="dir-render-fill"></div>
            </div>
            <div class="status-line" id="dir-render-status" style="margin-top:6px;"></div>
          </div>

          <details class="panel" style="padding:12px 16px;">
            <summary style="cursor:pointer;font-size:12px;color:var(--text-dim);
                            list-style:none;display:flex;align-items:center;gap:8px;">
              <span>⚙</span> Worker / engine settings
            </summary>
            <div class="field" style="margin-top:12px;">
              <label class="field-label">Cloudflare Worker URL</label>
              <input type="text" id="dir-worker-url"
                     placeholder="https://your-worker.workers.dev"
                     value="${this._settings.workerUrl}">
              <div class="field-hint">
                Leave empty to use built-in structured templates (no AI).
                Set to your Worker URL for Claude-powered shot lists.
              </div>
            </div>
          </details>

        </div>

        <!-- Shot list + result pane -->
        <div style="display:flex;flex-direction:column;gap:16px;">

          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <span style="font-size:12px;color:var(--text-dim);" id="dir-count-label">
              ${this._shotList.length} shot${this._shotList.length !== 1 ? 's' : ''}
            </span>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-ghost btn-sm" id="dir-add-btn">
                ${ICON_PLUS} Add shot
              </button>
              <button class="btn btn-ghost btn-sm" id="dir-clear-btn"
                      ${this._shotList.length ? '' : 'disabled'}>
                Clear all
              </button>
            </div>
          </div>

          <div class="shot-list" id="dir-shot-list">
            ${this._shotList.length === 0 ? this._emptyState() : ''}
          </div>

          <div class="result-panel hidden" id="dir-result">
            <video controls loop playsinline id="dir-result-video"></video>
            <div class="result-actions">
              <button class="btn btn-primary" id="dir-download-btn">Download video</button>
              <button class="btn btn-ghost" id="dir-share-btn">Copy link</button>
            </div>
            <div class="result-meta mono" id="dir-result-meta"></div>
          </div>

        </div>
      </div>
    `;
  }

  _emptyState() {
    return `<div style="border:1px dashed var(--border);border-radius:6px;
      padding:32px;text-align:center;color:var(--text-dim);font-size:13px;">
      Load an image and click <strong style="color:var(--text)">Generate shot list</strong>
      — or add shots manually.
    </div>`;
  }

  // ── Bind ──────────────────────────────────────────────────────────

  _bind() {
    const $ = id => this._container.querySelector(id);

    // Settings persistence
    $('#dir-style-sel').addEventListener('change', e => {
      this._settings.style = e.target.value;
      set('director:style', e.target.value);
    });
    $('#dir-shot-count').addEventListener('change', e => {
      this._settings.shotCount = Number(e.target.value);
      set('director:shotCount', this._settings.shotCount);
    });
    $('#dir-shot-dur').addEventListener('change', e => {
      this._settings.shotDur = Number(e.target.value);
      set('director:shotDur', this._settings.shotDur);
    });
    $('#dir-res-sel').addEventListener('change', e => {
      this._settings.resolution = e.target.value;
      set('director:resolution', e.target.value);
    });
    $('#dir-worker-url').addEventListener('change', e => {
      this._settings.workerUrl = e.target.value.trim();
      set('directorWorkerUrl', this._settings.workerUrl);
    });

    $('#dir-generate-btn').addEventListener('click', () => this._generateShotList());
    $('#dir-render-btn').addEventListener('click',   () => this._renderAll());
    $('#dir-add-btn').addEventListener('click',      () => this._addShot());
    $('#dir-clear-btn').addEventListener('click',    () => this._clearAll());
    $('#dir-download-btn')?.addEventListener('click', () => this._download());
  }

  // ── Shot list generation ──────────────────────────────────────────

  async _generateShotList() {
    if (!this._imageDataUrl) {
      this._setGenStatus('error', 'Load an image first');
      return;
    }

    this._setGenStatus('busy', 'Generating shot list…');
    const btn = this._container.querySelector('#dir-generate-btn');
    btn.disabled = true;

    try {
      const shots = await this._callDirectorAI();
      this._shotList.replace(shots);
      this._setGenStatus('ok', `${shots.length} shots generated`);
    } catch (err) {
      this._setGenStatus('error', err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async _callDirectorAI() {
    const workerUrl = this._settings.workerUrl;
    const n         = this._settings.shotCount;
    const dur       = this._settings.shotDur;
    const style     = FILM_STYLES[this._settings.style] ?? 'auto';

    if (workerUrl) {
      // Call the Cloudflare Worker with the image
      const res = await fetch(workerUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action:     'director',
          imageData:  this._imageDataUrl,
          style,
          shotCount:  n,
          shotDur:    dur,
        }),
      });
      if (!res.ok) throw new Error(`Worker error: ${res.status}`);
      const json = await res.json();
      return json.shots ?? [];
    }

    // Fallback: structured template shots (no AI, but usable)
    return this._templateShots(n, dur, style);
  }

  _templateShots(n, dur, style) {
    const moves   = Object.keys(CAMERA_MOVES);
    const prompts = [
      'Wide establishing shot, slow push in',
      'Close-up on face, shallow depth of field, subtle focus pull',
      'Medium shot, character in motion, warm ambient light',
      'Low angle shot looking up, dramatic perspective',
      'Over-the-shoulder view, bokeh background',
      'Tracking shot following motion through the frame',
      'Static wide shot with environmental detail',
      'Intimate close-up, eyes sharp, background blurred',
      'Dutch angle for tension, slow drift',
      'Aerial-style crane up revealing the full scene',
    ];

    return Array.from({ length: Math.min(n, prompts.length) }, (_, i) => ({
      prompt:   prompts[i] ?? `Shot ${i + 1}`,
      caption:  '',
      duration: dur,
      move:     moves[i % moves.length],
    }));
  }

  // ── Render all shots ──────────────────────────────────────────────

  async _renderAll() {
    if (!this._imageDataUrl) {
      this._setRenderStatus('error', 'Load an image first');
      return;
    }
    if (!this._shotList.length) {
      this._setRenderStatus('error', 'Generate or add shots first');
      return;
    }
    if (this._rendering) return;

    this._rendering  = true;
    this._finalBlob  = null;
    const renderBtn  = this._container.querySelector('#dir-render-btn');
    renderBtn.disabled = true;
    this._setProgress(0);

    const shots     = this._shotList.shots;
    const videoUrls = [];
    const total     = shots.length;

    try {
      for (let i = 0; i < total; i++) {
        const shot = shots[i];
        this._shotList.update(shot.id, { status: 'rendering' });
        this._setRenderStatus('busy', `Rendering shot ${i + 1} / ${total}…`);

        try {
          const url = await renderShot(shot, this._imageDataUrl, {
            onStatus:   msg => this._setRenderStatus('busy', msg),
            resolution: this._settings.resolution,
          });
          videoUrls.push(url);
          this._shotList.update(shot.id, { status: 'done', videoUrl: url });
        } catch (err) {
          this._shotList.update(shot.id, { status: 'error', error: err.message });
          this._setRenderStatus('error', `Shot ${i + 1} failed: ${err.message}`);
          // Continue with remaining shots
        }

        this._setProgress((i + 1) / total);
      }

      if (videoUrls.length === 0) throw new Error('All shots failed to render');

      this._setRenderStatus('busy', 'Stitching clips…');
      const blob = await stitchVideos(videoUrls, {
        fps:        30,
        resolution: this._settings.resolution,
        onStatus:   msg => this._setRenderStatus('busy', msg),
        onProgress: p => this._setProgress(p),
      });

      this._finalBlob = blob;
      this._showResult(blob, videoUrls.length);
      this._setRenderStatus('ok', `Done — ${videoUrls.length} clips stitched`);

    } catch (err) {
      this._setRenderStatus('error', err.message);
    } finally {
      this._rendering   = false;
      renderBtn.disabled = false;
    }
  }

  // ── Manual shot management ────────────────────────────────────────

  _addShot() {
    this._shotList.add({
      prompt:   '',
      duration: this._settings.shotDur,
      move:     'static',
    });
    // Focus the new shot's textarea
    setTimeout(() => {
      const cards = this._container.querySelectorAll('.shot-card');
      const last  = cards[cards.length - 1];
      last?.querySelector('textarea')?.focus();
    }, 50);
  }

  _clearAll() {
    if (!confirm('Clear all shots?')) return;
    this._shotList.clear();
    this._container.querySelector('#dir-result')?.classList.add('hidden');
    this._setRenderStatus('', '');
  }

  // ── Shot list DOM rendering ───────────────────────────────────────

  _renderShotList(shots) {
    const list     = this._container.querySelector('#dir-shot-list');
    const countLbl = this._container.querySelector('#dir-count-label');
    const renderBtn = this._container.querySelector('#dir-render-btn');
    const clearBtn  = this._container.querySelector('#dir-clear-btn');

    countLbl.textContent = `${shots.length} shot${shots.length !== 1 ? 's' : ''}`;
    renderBtn.disabled   = shots.length === 0;
    clearBtn.disabled    = shots.length === 0;

    if (!shots.length) {
      list.innerHTML = this._emptyState();
      return;
    }

    list.innerHTML = shots.map((s, i) => this._shotCardHTML(s, i + 1)).join('');
    this._bindShotCards();
  }

  _shotCardHTML(shot, num) {
    const statusClass = shot.status === 'done' ? 'done'
      : shot.status === 'rendering' ? 'rendering'
      : shot.status === 'error' ? 'error' : '';

    return `
      <div class="shot-card ${statusClass}" data-id="${shot.id}">
        <div class="shot-num">${String(num).padStart(2, '0')}</div>
        <div class="shot-body">
          <textarea class="shot-prompt-ta" data-id="${shot.id}"
                    rows="2" placeholder="Describe this shot…">${shot.prompt}</textarea>
          <div class="shot-meta">
            <select class="shot-move-sel" data-id="${shot.id}" style="width:auto;font-size:11px;padding:2px 20px 2px 6px;">
              ${Object.entries(CAMERA_MOVES).map(([v, l]) =>
                `<option value="${v}" ${v === shot.move ? 'selected' : ''}>${l}</option>`
              ).join('')}
            </select>
            <span class="shot-tag">${shot.duration}s</span>
            ${shot.status === 'done'     ? '<span class="shot-tag" style="color:var(--green);border-color:var(--green)">✓ done</span>' : ''}
            ${shot.status === 'rendering' ? '<span class="shot-tag" style="color:var(--amber);border-color:var(--amber)">⟳ rendering</span>' : ''}
            ${shot.status === 'error'     ? `<span class="shot-tag" style="color:var(--red);border-color:var(--red)" title="${shot.error}">✗ error</span>` : ''}
          </div>
          <input type="text" class="shot-caption-in" data-id="${shot.id}"
                 placeholder="Caption (optional)"
                 value="${shot.caption ?? ''}"
                 style="font-size:11px;">
        </div>
        <div class="shot-actions">
          <button class="btn btn-icon btn-ghost shot-up-btn"   data-id="${shot.id}" title="Move up">${ICON_UP}</button>
          <button class="btn btn-icon btn-ghost shot-down-btn" data-id="${shot.id}" title="Move down">${ICON_DOWN}</button>
          <button class="btn btn-icon btn-danger shot-del-btn" data-id="${shot.id}" title="Delete">${ICON_TRASH}</button>
        </div>
      </div>
    `;
  }

  _updateShotCard(shot) {
    const card = this._container.querySelector(`.shot-card[data-id="${shot.id}"]`);
    if (!card) return;
    card.className = `shot-card ${shot.status === 'done' ? 'done' : shot.status === 'rendering' ? 'rendering' : shot.status === 'error' ? 'error' : ''}`;
    const metaEl = card.querySelector('.shot-meta');
    if (metaEl) {
      // Re-render just the status tags
      const staticTags = metaEl.querySelectorAll('.shot-tag');
      staticTags.forEach(t => {
        if (t.textContent.includes('done') || t.textContent.includes('rendering') || t.textContent.includes('error')) {
          t.remove();
        }
      });
      if (shot.status === 'done')
        metaEl.insertAdjacentHTML('beforeend', '<span class="shot-tag" style="color:var(--green);border-color:var(--green)">✓ done</span>');
      if (shot.status === 'rendering')
        metaEl.insertAdjacentHTML('beforeend', '<span class="shot-tag" style="color:var(--amber);border-color:var(--amber)">⟳ rendering</span>');
      if (shot.status === 'error')
        metaEl.insertAdjacentHTML('beforeend', `<span class="shot-tag" style="color:var(--red);border-color:var(--red)" title="${shot.error}">✗ error</span>`);
    }
  }

  _bindShotCards() {
    const $ = sel => this._container.querySelectorAll(sel);

    $('[data-id].shot-prompt-ta').forEach(ta => {
      ta.addEventListener('change', e => {
        this._shotList.update(Number(e.target.dataset.id), { prompt: e.target.value });
      });
    });

    $('[data-id].shot-caption-in').forEach(inp => {
      inp.addEventListener('change', e => {
        this._shotList.update(Number(e.target.dataset.id), { caption: e.target.value });
      });
    });

    $('[data-id].shot-move-sel').forEach(sel => {
      sel.addEventListener('change', e => {
        this._shotList.update(Number(e.target.dataset.id), { move: e.target.value });
      });
    });

    $('[data-id].shot-up-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        this._shotList.move(Number(e.currentTarget.dataset.id), 'up');
      });
    });

    $('[data-id].shot-down-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        this._shotList.move(Number(e.currentTarget.dataset.id), 'down');
      });
    });

    $('[data-id].shot-del-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        this._shotList.remove(Number(e.currentTarget.dataset.id));
      });
    });
  }

  // ── Result ────────────────────────────────────────────────────────

  _showResult(blob, clipCount) {
    const panel    = this._container.querySelector('#dir-result');
    const video    = this._container.querySelector('#dir-result-video');
    const metaEl   = this._container.querySelector('#dir-result-meta');
    const url      = URL.createObjectURL(blob);

    video.src = url;
    panel.classList.remove('hidden');
    metaEl.textContent = `${clipCount} clips · ${(blob.size / 1024 / 1024).toFixed(1)} MB · ${blob.type}`;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  _download() {
    if (!this._finalBlob) return;
    const ext  = this._finalBlob.type.includes('mp4') ? 'mp4' : 'webm';
    const url  = URL.createObjectURL(this._finalBlob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `director-cut.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ── Helpers ───────────────────────────────────────────────────────

  _setGenStatus(kind, msg) {
    const el = this._container.querySelector('#dir-gen-status');
    if (el) { el.className = `status-line ${kind}`; el.textContent = msg; }
  }

  _setRenderStatus(kind, msg) {
    const el = this._container.querySelector('#dir-render-status');
    if (el) { el.className = `status-line ${kind}`; el.textContent = msg; }
  }

  _setProgress(ratio) {
    const fill = this._container.querySelector('#dir-render-fill');
    if (fill) fill.style.width = `${Math.round(ratio * 100)}%`;
  }
}
