/**
 * worker/director.js
 *
 * Cloudflare Worker — proxies the Director's AI shot-list generation
 * through Claude (Haiku) without exposing the API key in the browser.
 *
 * Deploy:
 *   1. Install Wrangler: npm i -g wrangler
 *   2. wrangler secret put ANTHROPIC_API_KEY
 *   3. wrangler deploy
 *
 * The frontend calls this worker at:
 *   POST https://your-worker.workers.dev
 *   Body: { action: 'director', imageData: <base64 dataUrl>, style, shotCount, shotDur }
 *
 * Returns:
 *   { shots: [{ prompt, caption, duration, move }] }
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-haiku-4-5';

const CAMERA_MOVES = [
  'static', 'push_in', 'pull_out', 'pan_right',
  'pan_left', 'orbit', 'crane_up', 'crane_down', 'handheld',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const { action, imageData, style, shotCount = 5, shotDur = 5 } = body;

    if (action !== 'director') {
      return json({ error: `Unknown action: ${action}` }, 400);
    }

    if (!imageData || !imageData.startsWith('data:image/')) {
      return json({ error: 'imageData must be a base64 image data URL' }, 400);
    }

    const n   = Math.min(Math.max(Number(shotCount) || 5, 1), 20);
    const dur = Math.min(Math.max(Number(shotDur)   || 5, 2), 30);

    // Strip the data URL prefix to get pure base64
    const [header, b64] = imageData.split(',');
    const mimeMatch     = header.match(/data:([^;]+)/);
    const mediaType     = mimeMatch?.[1] ?? 'image/jpeg';

    const prompt = buildPrompt(style, n, dur);

    // Call Claude with vision
    const claudeRes = await fetch(ANTHROPIC_API, {
      method:  'POST',
      headers: {
        'x-api-key':         env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type:   'image',
              source: { type: 'base64', media_type: mediaType, data: b64 },
            },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return json({ error: `Claude API error ${claudeRes.status}: ${err}` }, 502);
    }

    const claudeJson = await claudeRes.json();
    const text       = claudeJson.content?.[0]?.text ?? '';

    // Parse the JSON shot list from Claude's response
    let shots;
    try {
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('No JSON array found');
      const raw = JSON.parse(match[0]);
      shots = raw.map(s => ({
        prompt:   String(s.prompt   ?? ''),
        caption:  String(s.caption  ?? ''),
        duration: Math.min(Math.max(Number(s.duration ?? dur), 2), 30),
        move:     CAMERA_MOVES.includes(s.move) ? s.move : 'static',
      }));
    } catch (err) {
      // If JSON parse fails, return structured fallback
      console.error('Claude response parse error:', err.message, '\nRaw:', text.slice(0, 300));
      shots = fallbackShots(n, dur, style);
    }

    return json({ shots }, 200);
  },
};

function buildPrompt(style, n, dur) {
  return `You are a film director. Analyze this image and write a shot list for a ${style ?? 'cinematic'} short film.

Create exactly ${n} shots, each ${dur} seconds long.

Return ONLY a JSON array with no other text. Each element must have:
- "prompt": cinematic description of the shot and motion (2-3 sentences, specific, visual)
- "caption": optional on-screen text or dialogue snippet (1 short line, or empty string)
- "duration": ${dur}
- "move": one of ${JSON.stringify(CAMERA_MOVES)}

The shots should tell a visual story, vary in framing (wide, medium, close-up), and build emotional momentum. Be specific about lighting, movement, and atmosphere.

JSON array:`;
}

function fallbackShots(n, dur, style) {
  const templates = [
    { prompt: 'Wide establishing shot, slow push in toward the subject, warm ambient light.', move: 'push_in' },
    { prompt: 'Medium shot, subject in frame, shallow depth of field with soft bokeh background.', move: 'static' },
    { prompt: 'Close-up on face, subtle focus pull, intimate and revealing.', move: 'static' },
    { prompt: 'Low angle looking up, dramatic perspective, subject dominates the frame.', move: 'crane_up' },
    { prompt: 'Over-the-shoulder view into the environment, slow pan revealing the scene.', move: 'pan_right' },
    { prompt: 'Aerial-style pull back, revealing the full context of the scene.', move: 'pull_out' },
    { prompt: 'Tracking shot following motion, handheld energy, dynamic and present.', move: 'handheld' },
    { prompt: 'Static wide shot, minimal motion, environmental storytelling.', move: 'static' },
    { prompt: 'Intimate close-up on detail, sharp and textured, slow drift.', move: 'orbit' },
    { prompt: 'Final wide frame, slow crane down to rest position, cinematic close.', move: 'crane_down' },
  ];
  return templates.slice(0, n).map(t => ({ ...t, caption: '', duration: dur }));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
