/**
 * lipsync/sync.js
 *
 * Sends a portrait image + audio to a lipsync HF Space.
 * Returns a video Blob URL.
 *
 * Engine fallback order:
 *   EchoMimic → AniPortrait → LatentSync → FantasyTalk
 */

import { callSpace, getSpaceUrl } from '../../engines/hfClient.js';

export const LIPSYNC_ENGINES = [
  { id: 'echomimic',   label: 'EchoMimic',       desc: 'Best quality, slower' },
  { id: 'aniportrait', label: 'AniPortrait',      desc: 'Fast, good quality' },
  { id: 'latentsync',  label: 'LatentSync',       desc: 'ByteDance, reliable' },
  { id: 'fantasytalk', label: 'FantasyTalk',      desc: 'Expressive motion' },
];

/**
 * Run lipsync on a portrait image + audio.
 *
 * @param {string} imageDataUrl  - Source portrait image (base64)
 * @param {Blob}   audioBlob     - Audio blob (wav/mp3)
 * @param {object} opts
 * @param {string}   opts.engineId      - Engine to try first
 * @param {{ x, y }} opts.mouthPoint    - Relative mouth position (0–1 each)
 * @param {function} opts.onStatus
 * @param {boolean}  opts.fallback      - Auto-fallback to next engine (default true)
 * @returns {Promise<{ blobUrl: string, engineId: string }>}
 */
export async function runLipsync(imageDataUrl, audioBlob, opts = {}) {
  const {
    engineId  = 'echomimic',
    mouthPoint = { x: 0.5, y: 0.65 },
    onStatus,
    fallback = true,
  } = opts;

  const b64Image = imageDataUrl.split(',')[1];
  const audioDataUrl = await _blobToDataUrl(audioBlob);
  const b64Audio = audioDataUrl.split(',')[1];
  const audioMime = audioBlob.type || 'audio/wav';

  // Build ordered engine list starting from the selected one
  const order = _reorder(LIPSYNC_ENGINES.map(e => e.id), engineId);
  const engines = fallback ? order : [engineId];
  const errors  = [];

  for (const id of engines) {
    const url = getSpaceUrl(id);
    if (!url) continue;

    onStatus?.(`Trying ${id}…`);

    try {
      const inputData = _buildData(id, b64Image, b64Audio, audioMime, mouthPoint);
      const result    = await callSpace(url, inputData, { onStatus });
      const videoUrl  = await _extractVideoUrl(result, url);
      return { blobUrl: videoUrl, engineId: id };
    } catch (err) {
      errors.push(`${id}: ${err.message}`);
      onStatus?.(`${id} failed, trying next…`);
    }
  }

  throw new Error(`All lipsync engines failed:\n${errors.join('\n')}`);
}

function _buildData(engineId, b64Image, b64Audio, audioMime, mouth) {
  const img = { data: b64Image, mime_type: 'image/jpeg' };
  const aud = { data: b64Audio, mime_type: audioMime };

  switch (engineId) {
    case 'echomimic':
      // EchoMimic: [image, audio, width, height, length, steps, cfg, seed, acc_mode]
      return [img, aud, 512, 512, 0, 20, 2.5, -1, false];

    case 'aniportrait':
      // AniPortrait: [image, audio, pose_reference, width, height, fps, seed]
      return [img, aud, null, 512, 512, 25, -1];

    case 'latentsync':
      // LatentSync: [video_or_image, audio, guidance_scale, seed]
      return [img, aud, 1.5, -1];

    case 'fantasytalk':
      // FantasyTalking: [image, audio, seed, do_classifier_free_guidance]
      return [img, aud, -1, true];

    default:
      return [img, aud];
  }
}

async function _extractVideoUrl(data, spaceUrl) {
  const raw = data?.[0];
  if (!raw) throw new Error('No video in response');

  let videoUrl;
  if (typeof raw === 'string') {
    videoUrl = raw.startsWith('http') ? raw
      : raw.startsWith('data:') ? raw
      : `${spaceUrl}/file=${raw}`;
  } else if (raw?.url) {
    videoUrl = raw.url.startsWith('http') ? raw.url : `${spaceUrl}${raw.url}`;
  } else if (raw?.path) {
    videoUrl = `${spaceUrl}/file=${raw.path}`;
  } else {
    throw new Error('Unrecognised video response format');
  }

  const res  = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Video fetch failed: ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function _blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function _reorder(arr, first) {
  const idx = arr.indexOf(first);
  if (idx <= 0) return arr;
  return [arr[idx], ...arr.slice(0, idx), ...arr.slice(idx + 1)];
}
