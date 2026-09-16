/**
 * lipsync/tts.js
 *
 * Text-to-speech via public HF Spaces.
 * Returns an AudioBuffer + Blob URL.
 *
 * Engines (ordered by quality/reliability):
 *   1. Kokoro (hexgrad/Kokoro-82M) — high quality, fast
 *   2. Coqui XTTS v2 — multilingual, slower
 */

import { callSpace, getSpaceUrl } from '../../engines/hfClient.js';

export const TTS_VOICES = [
  // Kokoro voices
  { id: 'af_heart',   label: 'Heart',    engine: 'kokoro', desc: 'warm · female' },
  { id: 'af_bella',   label: 'Bella',    engine: 'kokoro', desc: 'bright · female' },
  { id: 'am_adam',    label: 'Adam',     engine: 'kokoro', desc: 'calm · male' },
  { id: 'am_michael', label: 'Michael',  engine: 'kokoro', desc: 'deep · male' },
  { id: 'bf_emma',    label: 'Emma',     engine: 'kokoro', desc: 'british · female' },
  { id: 'bm_george',  label: 'George',   engine: 'kokoro', desc: 'british · male' },
  // Coqui fallback voices
  { id: 'coqui_en_f', label: 'Coqui F',  engine: 'coqui',  desc: 'neutral · female' },
  { id: 'coqui_en_m', label: 'Coqui M',  engine: 'coqui',  desc: 'neutral · male' },
];

/**
 * Generate speech audio from text.
 *
 * @param {string} text        - Script to speak
 * @param {string} voiceId     - Voice ID from TTS_VOICES
 * @param {object} [opts]
 * @param {function} [opts.onStatus]
 * @returns {Promise<{ blobUrl: string, blob: Blob }>}
 */
export async function generateSpeech(text, voiceId, opts = {}) {
  const { onStatus } = opts;
  const voice = TTS_VOICES.find(v => v.id === voiceId) ?? TTS_VOICES[0];

  if (voice.engine === 'kokoro') {
    return _kokoro(text, voice.id, onStatus);
  } else {
    return _coqui(text, onStatus);
  }
}

async function _kokoro(text, voiceId, onStatus) {
  const url = getSpaceUrl('tts-kokoro');
  if (!url) throw new Error('Kokoro Space not configured');

  onStatus?.('Generating speech with Kokoro…');

  // Kokoro Gradio interface: [text, voice, speed]
  const data = await callSpace(url, [text, voiceId, 1.0], {
    onStatus,
  });

  return _audioFromGradioResponse(data, url);
}

async function _coqui(text, onStatus) {
  const url = getSpaceUrl('tts-coqui');
  if (!url) throw new Error('Coqui Space not configured');

  onStatus?.('Generating speech with Coqui XTTS…');

  // XTTS v2: [text, speaker_audio_or_null, language]
  const data = await callSpace(url, [text, null, 'en'], {
    onStatus,
  });

  return _audioFromGradioResponse(data, url);
}

async function _audioFromGradioResponse(data, spaceUrl) {
  // Gradio audio output can be a file path, URL, or base64
  const audioData = data?.[0];
  if (!audioData) throw new Error('No audio in response');

  let audioUrl;
  if (typeof audioData === 'string') {
    audioUrl = audioData.startsWith('http') ? audioData
      : audioData.startsWith('data:') ? audioData
      : `${spaceUrl}/file=${audioData}`;
  } else if (audioData?.url) {
    audioUrl = audioData.url.startsWith('http')
      ? audioData.url
      : `${spaceUrl}${audioData.url}`;
  } else if (audioData?.path) {
    audioUrl = `${spaceUrl}/file=${audioData.path}`;
  } else {
    throw new Error('Unrecognised audio response format');
  }

  const res  = await fetch(audioUrl);
  if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
  const blob = await res.blob();
  return { blobUrl: URL.createObjectURL(blob), blob };
}

/**
 * Get audio duration in seconds from a Blob.
 */
export function getAudioDuration(blobUrl) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(blobUrl);
    audio.onloadedmetadata = () => resolve(audio.duration);
    audio.onerror = reject;
  });
}
