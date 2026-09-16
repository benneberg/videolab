/**
 * lipsync/index.js
 *
 * Lipsync module:
 *   1. Type a script → TTS → preview audio
 *   2. Place mouth marker on portrait
 *   3. Choose lipsync engine → render → download
 *
 * Mic recording is wired up to the UI but marked "coming soon"
 * so the UX skeleton is already there for activation later.
 */

import { TTS_VOICES, generateSpeech, getAudioDuration } from './tts.js';
import { LIPSYNC_ENGINES, runLipsync } from './sync.js';
import { get, set } from '../../shell/storage.js';

// ── Icons ─────────────────────────────────────────────────────────────
const ICON_MIC = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
  <path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
  <line x1="8" y1="23" x2="16" y2="23"/>
</svg>`;

const ICON_PLAY = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
  <polygon points="5 3 19 12 5 21 5 3"/>
</svg>`;

const ICON_SYNC = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
  <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
</svg>`;

export class LipsyncModule {
  constructor(containerSelector, imageSource) {
    this._container   = document.querySelector(containerSelector);
    this._imageSource = imageSource;
    this._audioBlob   = null;
    this._audioBlobUrl = null;
    this._mouthPoint  = null;   // { x, y } relative 0-1
    this._rendering   = false;
    this._finalBlobUrl = null;

    this._settings = {
      voice:    get('lipsync:voice',    TTS_VOICES[0].id),
      engine:   get('lipsync:engine',  'echomimic'),
      fallback: get('lipsync:fallback', true),
    };
  }

  // ── Module interface ──────────────────────────────────────────────

  get id()    { return 'lipsync'; }
  get label() { return 'Lipsync'; }
  get icon()  { return ICON_SYNC; }

  mount() {
    this._render();
    this._bind();
  }

  onImageChange({ img, dataUrl }) {
    this._imageDataUrl = dataUrl;
    this._renderPortraitPlacement(img);
  }

  // ── HTML ─────────────────────────────────────────────────────────

  _render() {
    this._container.innerHTML = `
      <div class="module-header">
        <div>
          <div class="module-title">Lipsync</div>
          <div class="module-subtitle">
            Type a script, generate speech, place the mouth marker — then animate the portrait.
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start;">

        <!-- Left: script + audio -->
        <div style="display:flex;flex-direction:column;gap:16px;">

          <div class="panel">
            <div class="panel-title">Script</div>
            <div class="field">
              <label class="field-label">Text to speak</label>
              <textarea id="ls-script" rows="5"
                placeholder="Type the words the character will say…">${get('lipsync:script','')}</textarea>
              <div class="field-hint" id="ls-char-count">0 characters</div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-title">Voice</div>
            <div class="voice-grid" id="ls-voice-grid">
              ${TTS_VOICES.map(v => `
                <div class="voice-card ${v.id === this._settings.voice ? 'selected' : ''}"
                     data-voice="${v.id}" tabindex="0" role="button"
                     aria-pressed="${v.id === this._settings.voice}">
                  <div class="voice-name">${v.label}</div>
                  <div class="voice-desc">${v.desc}</div>
                </div>
              `).join('')}
            </div>

            <div style="display:flex;gap:8px;margin-top:12px;">
              <button class="btn btn-primary" id="ls-tts-btn" style="flex:1;">
                Generate speech
              </button>
              <button class="btn btn-ghost" id="ls-mic-btn"
                      title="Mic recording — coming soon" disabled>
                ${ICON_MIC}
              </button>
            </div>

            <div class="progress-bar" style="margin-top:8px;" id="ls-tts-prog">
              <div class="progress-fill indeterminate hidden" id="ls-tts-fill"></div>
            </div>
            <div class="status-line" id="ls-tts-status" style="margin-top:6px;"></div>

            <!-- Audio player -->
            <div id="ls-audio-wrap" style="margin-top:12px;display:none;">
              <audio id="ls-audio" controls style="width:100%;height:36px;"></audio>
              <div class="result-meta mono" id="ls-audio-meta" style="margin-top:4px;border:none;padding:0;"></div>
            </div>

            <div class="field" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
              <div style="display:flex;align-items:center;gap:8px;">
                <label class="field-label" style="margin:0;">Mic recording</label>
                <span style="font-size:10px;font-family:var(--font-mono);
                             color:var(--amber);border:1px solid var(--amber);
                             padding:1px 5px;border-radius:10px;">coming soon</span>
              </div>
              <div class="field-hint">
                Record your own voice instead of TTS. Wiring is ready — enable when mic access is added.
              </div>
            </div>
          </div>

        </div>

        <!-- Right: portrait placement + render -->
        <div style="display:flex;flex-direction:column;gap:16px;">

          <div class="panel">
            <div class="panel-title">Portrait</div>
            <div class="field-hint" style="margin-bottom:8px;">
              Click on the image below to place the mouth marker.
              The engine uses this hint to align the lip animation.
            </div>

            <div id="ls-portrait-area" style="position:relative;cursor:crosshair;
                 background:var(--bg);border:1px solid var(--border);border-radius:4px;
                 overflow:hidden;min-height:160px;display:flex;align-items:center;justify-content:center;">
              <div id="ls-portrait-empty" style="color:var(--text-dim);font-size:12px;">
                Load a portrait image from the sidebar
              </div>
              <canvas id="ls-portrait-canvas" style="display:none;max-width:100%;"></canvas>
              <div id="ls-mouth-marker" class="mouth-marker" style="display:none;"></div>
            </div>
            <div class="field-hint" id="ls-mouth-hint" style="margin-top:6px;">
              ${this._mouthPoint
                ? `Mouth at (${(this._mouthPoint.x*100).toFixed(0)}%, ${(this._mouthPoint.y*100).toFixed(0)}%)`
                : 'Click image to set mouth position'}
            </div>
          </div>

          <div class="panel">
            <div class="panel-title">Lipsync engine</div>

            <div style="display:flex;flex-direction:column;gap:6px;" id="ls-engine-group">
              ${LIPSYNC_ENGINES.map(e => `
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                              font-size:13px;padding:6px 8px;border-radius:4px;
                              border:1px solid var(--border);
                              background:${e.id === this._settings.engine ? 'var(--accent-dim)' : 'transparent'};
                              border-color:${e.id === this._settings.engine ? 'var(--accent)' : 'var(--border)'};"
                      data-engine-label="${e.id}">
                  <input type="radio" name="ls-engine" value="${e.id}"
                         ${e.id === this._settings.engine ? 'checked' : ''}
                         style="accent-color:var(--accent);">
                  <div>
                    <div style="font-weight:500;">${e.label}</div>
                    <div style="font-size:11px;color:var(--text-dim);">${e.desc}</div>
                  </div>
                </label>
              `).join('')}
            </div>

            <label style="display:flex;align-items:center;gap:8px;margin-top:10px;
                          font-size:12px;color:var(--text-dim);cursor:pointer;">
              <input type="checkbox" id="ls-fallback-chk"
                     ${this._settings.fallback ? 'checked' : ''}
                     style="accent-color:var(--accent);">
              Auto-fallback to next engine if selected fails
            </label>

            <button class="btn btn-primary btn-full" id="ls-render-btn"
                    style="margin-top:14px;"
                    ${this._canRender() ? '' : 'disabled'}>
              Animate portrait
            </button>

            <div class="progress-bar" style="margin-top:8px;" id="ls-render-prog">
              <div class="progress-fill" id="ls-render-fill"></div>
            </div>
            <div class="status-line" id="ls-render-status" style="margin-top:6px;"></div>
          </div>

          <div class="result-panel hidden" id="ls-result">
            <video controls playsinline id="ls-result-video"></video>
            <div class="result-actions">
              <button class="btn btn-primary" id="ls-download-btn">Download video</button>
            </div>
            <div class="result-meta mono" id="ls-result-meta"></div>
          </div>

        </div>
      </div>
    `;

    // Restore portrait if image already loaded
    if (this._imageSource.image) {
      this.onImageChange({
        img: this._imageSource.image,
        dataUrl: this._imageSource.dataUrl,
      });
    }
  }

  // ── Bind ──────────────────────────────────────────────────────────

  _bind() {
    const $ = id => this._container.querySelector(id);

    // Script char count
    const scriptTa = $('#ls-script');
    const updateCount = () => {
      $('#ls-char-count').textContent = `${scriptTa.value.length} characters`;
      set('lipsync:script', scriptTa.value);
      this._refreshRenderBtn();
    };
    scriptTa.addEventListener('input', updateCount);
    updateCount();

    // Voice selection
    this._container.querySelectorAll('.voice-card').forEach(card => {
      const select = () => {
        this._settings.voice = card.dataset.voice;
        set('lipsync:voice', this._settings.voice);
        this._container.querySelectorAll('.voice-card').forEach(c => {
          c.classList.toggle('selected', c.dataset.voice === this._settings.voice);
          c.setAttribute('aria-pressed', c.dataset.voice === this._settings.voice);
        });
      };
      card.addEventListener('click', select);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') select(); });
    });

    // TTS button
    $('#ls-tts-btn').addEventListener('click', () => this._generateTTS());

    // Engine radio buttons
    this._container.querySelectorAll('input[name="ls-engine"]').forEach(radio => {
      radio.addEventListener('change', e => {
        this._settings.engine = e.target.value;
        set('lipsync:engine', e.target.value);
        // Update label highlights
        this._container.querySelectorAll('[data-engine-label]').forEach(lbl => {
          const sel = lbl.dataset.engineLabel === e.target.value;
          lbl.style.background    = sel ? 'var(--accent-dim)' : 'transparent';
          lbl.style.borderColor   = sel ? 'var(--accent)'     : 'var(--border)';
        });
      });
    });

    // Fallback toggle
    $('#ls-fallback-chk').addEventListener('change', e => {
      this._settings.fallback = e.target.checked;
      set('lipsync:fallback', e.target.checked);
    });

    // Render
    $('#ls-render-btn').addEventListener('click', () => this._render_lipsync());

    // Download
    $('#ls-download-btn')?.addEventListener('click', () => this._download());

    // Portrait click → mouth marker
    $('#ls-portrait-area').addEventListener('click', e => this._setMouthFromClick(e));
  }

  // ── Portrait placement ────────────────────────────────────────────

  _renderPortraitPlacement(img) {
    const area    = this._container.querySelector('#ls-portrait-area');
    const canvas  = this._container.querySelector('#ls-portrait-canvas');
    const empty   = this._container.querySelector('#ls-portrait-empty');

    canvas.style.display = 'block';
    empty.style.display  = 'none';

    // Size canvas to image (capped at area width)
    const maxW = area.clientWidth || 340;
    const scale = Math.min(maxW / img.naturalWidth, 400 / img.naturalHeight, 1);
    canvas.width  = img.naturalWidth  * scale;
    canvas.height = img.naturalHeight * scale;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Restore saved mouth position if any
    const saved = get('lipsync:mouthPoint', null);
    if (saved) {
      this._mouthPoint = saved;
      this._drawMouthMarker(saved.x * canvas.width, saved.y * canvas.height);
    }

    this._refreshRenderBtn();
  }

  _setMouthFromClick(e) {
    const canvas = this._container.querySelector('#ls-portrait-canvas');
    if (canvas.style.display === 'none') return;

    const rect = canvas.getBoundingClientRect();
    const x    = (e.clientX - rect.left)  / rect.width;
    const y    = (e.clientY - rect.top)   / rect.height;

    // Clamp to canvas bounds
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    this._mouthPoint = { x, y };
    set('lipsync:mouthPoint', this._mouthPoint);
    this._drawMouthMarker(x * canvas.width, y * canvas.height);

    const hint = this._container.querySelector('#ls-mouth-hint');
    if (hint) hint.textContent = `Mouth at (${(x*100).toFixed(0)}%, ${(y*100).toFixed(0)}%)`;

    this._refreshRenderBtn();
  }

  _drawMouthMarker(px, py) {
    const marker = this._container.querySelector('#ls-mouth-marker');
    const canvas = this._container.querySelector('#ls-portrait-canvas');
    const canvasRect = canvas.getBoundingClientRect();
    const areaRect   = this._container.querySelector('#ls-portrait-area').getBoundingClientRect();

    // Position relative to the portrait area container
    const offsetX = canvasRect.left - areaRect.left;
    const offsetY = canvasRect.top  - areaRect.top;

    const displayScale = canvasRect.width / canvas.width;
    marker.style.display = 'block';
    marker.style.left    = `${offsetX + px * displayScale}px`;
    marker.style.top     = `${offsetY + py * displayScale}px`;
  }

  // ── TTS ───────────────────────────────────────────────────────────

  async _generateTTS() {
    const script = this._container.querySelector('#ls-script').value.trim();
    if (!script) {
      this._setTtsStatus('error', 'Enter a script first');
      return;
    }

    const btn  = this._container.querySelector('#ls-tts-btn');
    const fill = this._container.querySelector('#ls-tts-fill');
    btn.disabled = true;
    fill.classList.remove('hidden');
    this._setTtsStatus('busy', 'Generating speech…');

    try {
      const { blobUrl, blob } = await generateSpeech(
        script,
        this._settings.voice,
        { onStatus: msg => this._setTtsStatus('busy', msg) }
      );

      this._audioBlob    = blob;
      this._audioBlobUrl = blobUrl;

      // Show player
      const wrap  = this._container.querySelector('#ls-audio-wrap');
      const audio = this._container.querySelector('#ls-audio');
      const meta  = this._container.querySelector('#ls-audio-meta');
      audio.src   = blobUrl;
      wrap.style.display = 'block';

      const dur = await getAudioDuration(blobUrl);
      meta.textContent = `${dur.toFixed(1)}s · ${(blob.size/1024).toFixed(0)} KB · ${blob.type || 'audio'}`;

      this._setTtsStatus('ok', 'Speech ready — preview above');
      this._refreshRenderBtn();
    } catch (err) {
      this._setTtsStatus('error', err.message);
    } finally {
      btn.disabled = false;
      fill.classList.add('hidden');
    }
  }

  // ── Lipsync render ────────────────────────────────────────────────

  async _render_lipsync() {
    if (!this._canRender()) return;
    if (this._rendering) return;

    this._rendering = true;
    const btn = this._container.querySelector('#ls-render-btn');
    btn.disabled = true;
    this._setProgress(0.1);
    this._setRenderStatus('busy', 'Starting lipsync…');

    try {
      const { blobUrl, engineId } = await runLipsync(
        this._imageDataUrl,
        this._audioBlob,
        {
          engineId:   this._settings.engine,
          mouthPoint: this._mouthPoint ?? { x: 0.5, y: 0.65 },
          onStatus:   msg => this._setRenderStatus('busy', msg),
          fallback:   this._settings.fallback,
        }
      );

      this._finalBlobUrl = blobUrl;
      this._setProgress(1);
      this._showResult(blobUrl, engineId);
      this._setRenderStatus('ok', `Done via ${engineId}`);
    } catch (err) {
      this._setRenderStatus('error', err.message);
      this._setProgress(0);
    } finally {
      this._rendering = false;
      btn.disabled = false;
    }
  }

  // ── Result ────────────────────────────────────────────────────────

  _showResult(blobUrl, engineId) {
    const panel = this._container.querySelector('#ls-result');
    const video = this._container.querySelector('#ls-result-video');
    const meta  = this._container.querySelector('#ls-result-meta');

    video.src = blobUrl;
    panel.classList.remove('hidden');
    meta.textContent = `Engine: ${engineId}`;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  _download() {
    if (!this._finalBlobUrl) return;
    const a    = document.createElement('a');
    a.href     = this._finalBlobUrl;
    a.download = 'lipsync.mp4';
    a.click();
  }

  // ── Helpers ───────────────────────────────────────────────────────

  _canRender() {
    return !!(this._imageDataUrl && this._audioBlob);
  }

  _refreshRenderBtn() {
    const btn = this._container.querySelector('#ls-render-btn');
    if (btn) btn.disabled = !this._canRender();
  }

  _setTtsStatus(kind, msg) {
    const el = this._container.querySelector('#ls-tts-status');
    if (el) { el.className = `status-line ${kind}`; el.textContent = msg; }
  }

  _setRenderStatus(kind, msg) {
    const el = this._container.querySelector('#ls-render-status');
    if (el) { el.className = `status-line ${kind}`; el.textContent = msg; }
  }

  _setProgress(ratio) {
    const fill = this._container.querySelector('#ls-render-fill');
    if (fill) fill.style.width = `${Math.round(ratio * 100)}%`;
  }
}
