/**
 * hfClient.js
 *
 * Central abstraction for all Hugging Face Space calls.
 *
 * Design:
 *  - Every engine is defined as an object with { id, name, url, call() }
 *  - callWithFallback(engines, payload) tries each in order, returns first success
 *  - Callers never hardcode URLs — they reference engine IDs from ENGINES.*
 *  - Personal Space overrides can be set via setSpaceOverride(engineId, url)
 *
 * All public HF Spaces expose the Gradio REST API:
 *   POST https://{owner}-{space-name}.hf.space/run/predict
 *   Body: { data: [...args] }
 *   Response: { data: [...outputs] }
 *
 * Some newer Spaces use the Gradio 4 queue API (/queue/join + SSE polling).
 * This client handles both automatically.
 */

// ── Space URL registry ────────────────────────────────────────────────
// Keys match engine IDs used throughout modules.
// Override any entry at runtime via setSpaceOverride().

const SPACE_URLS = {
  // Image-to-video
  'wan21-i2v':       'https://wangfuyun-animatelcm.hf.space',
  'wan22-i2v':       'https://wan-ai-wan2-point-2-i2v.hf.space',
  'ltx-video':       'https://lightricks-ltx-video.hf.space',
  'ltx2':            'https://lightricks-ltx-2.hf.space',
  'hunyuan':         'https://tencent-hunyuanvideo.hf.space',
  'svd':             'https://stabilityai-stable-video-diffusion.hf.space',

  // Text-to-image (for source image generation)
  'flux-schnell':    'https://black-forest-labs-flux-1-schnell.hf.space',
  'sdxl':            'https://diffusers-unofficial-sdxl-turbo-i2i-t2i.hf.space',

  // Lipsync
  'echomimic':       'https://badtobest-echomimic.hf.space',
  'aniportrait':     'https://zjyang-aniportrait.hf.space',
  'latentsync':      'https://bytedance-latentsync.hf.space',
  'fantasytalk':     'https://fantasy-studio-fantasytalk.hf.space',

  // TTS
  'tts-kokoro':      'https://hexgrad-kokoro.hf.space',
  'tts-coqui':       'https://coqui-xtts.hf.space',
};

// Personal Space overrides (set by user in settings)
const _overrides = {};

/**
 * Override a Space URL — e.g. to point at your own cloned Space.
 * Persisted externally by the caller (use storage.js).
 */
export function setSpaceOverride(engineId, url) {
  _overrides[engineId] = url;
}

export function getSpaceUrl(engineId) {
  return _overrides[engineId] ?? SPACE_URLS[engineId] ?? null;
}

export function listEngines() {
  return Object.keys(SPACE_URLS).map(id => ({
    id,
    url: getSpaceUrl(id),
    overridden: !!_overrides[id],
  }));
}

// ── Low-level Gradio caller ───────────────────────────────────────────

const TIMEOUT_MS = 90_000; // 90 s per Space attempt

/**
 * Call a Gradio Space via the predict REST endpoint.
 * Handles both the classic /run/predict and the newer /queue/join SSE path.
 *
 * @param {string} spaceUrl   - Base URL, e.g. "https://foo-bar.hf.space"
 * @param {Array}  data       - Input array passed to the Gradio fn
 * @param {object} [opts]
 * @param {string} [opts.fnIndex]   - Gradio fn_index (default 0)
 * @param {function} [opts.onStatus] - Called with status strings during queue
 * @returns {Promise<Array>}    - Gradio output array
 */
export async function callSpace(spaceUrl, data, opts = {}) {
  const { fnIndex = 0, onStatus } = opts;
  const base = spaceUrl.replace(/\/$/, '');

  // Try /run/predict first (Gradio 3 style)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${base}/run/predict`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ data, fn_index: fnIndex }),
      signal:  controller.signal,
    });

    if (res.ok) {
      const json = await res.json();
      if (json?.data) return json.data;
    }

    // 422 / 404 usually means queue API is needed
    if (res.status === 422 || res.status === 404) {
      return await _callQueue(base, data, fnIndex, onStatus);
    }

    throw new Error(`Space returned HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Gradio 4 queue API — POST /queue/join, then poll /queue/status SSE */
async function _callQueue(base, data, fnIndex, onStatus) {
  // Join the queue
  const joinRes = await fetch(`${base}/queue/join`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ data, fn_index: fnIndex }),
  });

  if (!joinRes.ok) throw new Error(`Queue join failed: ${joinRes.status}`);
  const { hash } = await joinRes.json();

  // Poll status via SSE
  return new Promise((resolve, reject) => {
    const es = new EventSource(`${base}/queue/status`);
    const timeout = setTimeout(() => {
      es.close();
      reject(new Error('Queue timeout'));
    }, TIMEOUT_MS);

    es.addEventListener('message', e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.hash !== hash) return;

      if (msg.msg === 'estimation') {
        onStatus?.(`Queue position ${msg.rank ?? '?'}…`);
      } else if (msg.msg === 'process_starts') {
        onStatus?.('Processing…');
      } else if (msg.msg === 'process_completed') {
        clearTimeout(timeout);
        es.close();
        if (msg.success && msg.output?.data) {
          resolve(msg.output.data);
        } else {
          reject(new Error(msg.output?.error ?? 'Process failed'));
        }
      } else if (msg.msg === 'queue_full') {
        clearTimeout(timeout);
        es.close();
        reject(new Error('Queue full'));
      }
    });

    es.onerror = () => {
      clearTimeout(timeout);
      es.close();
      reject(new Error('SSE connection error'));
    };
  });
}

// ── Fallback chain runner ─────────────────────────────────────────────

/**
 * Try each engine in order, return the first success.
 *
 * @param {string[]} engineIds  - Ordered list of engine IDs to try
 * @param {function} buildData  - (engineId) => Array  — builds the input data per engine
 * @param {object}   [opts]
 * @param {function} [opts.onStatus]      - Status string callback
 * @param {function} [opts.onEngineStart] - (engineId) => void
 * @returns {Promise<{ engineId, data }>}
 */
export async function callWithFallback(engineIds, buildData, opts = {}) {
  const { onStatus, onEngineStart } = opts;
  const errors = [];

  for (const id of engineIds) {
    const url = getSpaceUrl(id);
    if (!url) continue;

    onEngineStart?.(id);
    onStatus?.(`Trying ${id}…`);

    try {
      const inputData = buildData(id);
      const result    = await callSpace(url, inputData, {
        onStatus: msg => onStatus?.(`[${id}] ${msg}`),
      });
      return { engineId: id, data: result };
    } catch (err) {
      errors.push(`${id}: ${err.message}`);
      onStatus?.(`${id} unavailable, trying next…`);
    }
  }

  throw new Error(`All engines failed:\n${errors.join('\n')}`);
}

// ── High-level helpers ────────────────────────────────────────────────

/**
 * Generate an image from a text prompt.
 * Returns { ok: true, url: string } or { ok: false, error: string }
 */
export async function generateImage(prompt, opts = {}) {
  const engines = [
    { id: 'flux-schnell', buildData: () => [prompt, 0, true, 512, 512] },
    { id: 'sdxl',         buildData: () => [prompt, null, 0.8, 7, 25, 'DPM++ 2M', 512, 512] },
  ];

  for (const { id, buildData } of engines) {
    const url = getSpaceUrl(id);
    if (!url) continue;

    try {
      opts.onStatus?.(`Generating via ${id}…`);
      const result = await callSpace(url, buildData(), {
        onStatus: opts.onStatus,
      });

      // Gradio returns file objects for images: { url, orig_name, ... }
      const imgData = result?.[0];
      if (!imgData) continue;

      const imgUrl = typeof imgData === 'string' ? imgData
        : imgData?.url ?? imgData?.path ?? null;
      if (!imgUrl) continue;

      // Make absolute if needed
      const absolute = imgUrl.startsWith('http') ? imgUrl : `${url}${imgUrl}`;
      return { ok: true, url: absolute, engineId: id };
    } catch (err) {
      opts.onStatus?.(`${id} failed: ${err.message}`);
    }
  }

  return { ok: false, error: 'All image generation engines unavailable' };
}

/**
 * Convert base64 dataURL to a Blob, then to a File.
 * HF Spaces that accept file inputs need this.
 */
export function dataUrlToFile(dataUrl, filename = 'image.jpg') {
  const [header, b64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
  const raw  = atob(b64);
  const arr  = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return new File([arr], filename, { type: mime });
}

/**
 * Convert a Blob/File to base64 data URL.
 */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Fetch a URL and convert to base64 data URL.
 * Used to grab generated image blobs returned by Spaces.
 */
export async function urlToDataUrl(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return fileToDataUrl(blob);
}
