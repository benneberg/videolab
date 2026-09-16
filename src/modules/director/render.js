/**
 * director/render.js
 *
 * Renders a shot list to video:
 *  1. For each shot, calls an i2v HF Space (Wan 2.1 → LTX-2 fallback)
 *  2. Stitches resulting clips client-side via the MediaRecorder / Canvas API
 *  3. Returns a Blob URL for the final video
 *
 * Note on stitching:
 *  True server-side muxing isn't available client-side, so we play each video
 *  into a hidden canvas frame-by-frame and capture with MediaRecorder.
 *  This produces a WebM file on Chrome/Firefox, MP4 on Safari (HEVC).
 *  For production, you'd want a server-side ffmpeg step — but for a private
 *  tool this works well and stays fully client-side.
 */

import { callWithFallback, getSpaceUrl, dataUrlToFile } from '../../engines/hfClient.js';
import { CAMERA_MOVES } from './shotList.js';

// Ordered fallback chain for image-to-video
const I2V_ENGINES = ['wan22-i2v', 'wan21-i2v', 'ltx2', 'ltx-video', 'svd'];

/**
 * Render a single shot.
 *
 * @param {object} shot        - Shot object from ShotList
 * @param {string} imageDataUrl - Base64 data URL of the source image
 * @param {object} opts
 * @param {function} opts.onStatus   - (string) => void
 * @param {string}   opts.resolution - '1280x720' etc.
 * @returns {Promise<string>}   Object URL for the shot video
 */
export async function renderShot(shot, imageDataUrl, opts = {}) {
  const { onStatus, resolution = '1280x720' } = opts;
  const [width, height] = resolution.split('x').map(Number);
  const moveLabel = CAMERA_MOVES[shot.move] ?? 'Static';

  // Build the motion prompt combining shot prompt + camera move
  const motionPrompt = [
    shot.prompt,
    `Camera: ${moveLabel}.`,
    shot.caption ? `Scene: ${shot.caption}.` : '',
  ].filter(Boolean).join(' ');

  const { engineId, data } = await callWithFallback(
    I2V_ENGINES,
    (id) => _buildI2VData(id, imageDataUrl, motionPrompt, shot.duration, width, height),
    {
      onStatus,
      onEngineStart: id => onStatus?.(`Using engine: ${id}`),
    }
  );

  onStatus?.(`${engineId} complete, fetching video…`);

  // Extract video URL from response
  const videoData = data?.[0];
  let videoUrl;

  if (typeof videoData === 'string') {
    // Already a URL or data URL
    videoUrl = videoData.startsWith('http')
      ? videoData
      : `${getSpaceUrl(engineId)}${videoData}`;
  } else if (videoData?.url) {
    videoUrl = videoData.url.startsWith('http')
      ? videoData.url
      : `${getSpaceUrl(engineId)}${videoData.url}`;
  } else if (videoData?.path) {
    videoUrl = `${getSpaceUrl(engineId)}/file=${videoData.path}`;
  } else {
    throw new Error(`Unexpected response from ${engineId}`);
  }

  // Fetch the video and create a local Object URL
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`Failed to fetch video: ${videoRes.status}`);
  const blob = await videoRes.blob();
  return URL.createObjectURL(blob);
}

/**
 * Build the Gradio data array for each i2v engine.
 * Each Space has its own input signature — this maps to them.
 */
function _buildI2VData(engineId, imageDataUrl, prompt, duration, width, height) {
  // Convert dataUrl → base64 string (strip prefix) for some engines
  const b64 = imageDataUrl.split(',')[1];

  switch (engineId) {
    case 'wan22-i2v':
    case 'wan21-i2v':
      // Wan I2V: [image_b64, prompt, negative_prompt, duration, width, height, seed]
      return [
        { data: b64, mime_type: 'image/jpeg' },
        prompt,
        'worst quality, blurry, watermark',
        duration,
        width,
        height,
        -1, // random seed
      ];

    case 'ltx2':
    case 'ltx-video':
      // LTX: [image, prompt, negative, num_frames, fps, guidance, seed]
      return [
        { data: b64, mime_type: 'image/jpeg' },
        prompt,
        'worst quality, inconsistent motion, blurry',
        Math.round(duration * 24), // frames
        24,  // fps
        3.5, // guidance scale
        -1,
      ];

    case 'svd':
      // Stable Video Diffusion: [image, motion_bucket, noise, decode_chunk]
      return [
        { data: b64, mime_type: 'image/jpeg' },
        127, // motion_bucket_id (0-255, higher = more motion)
        0.02,
        8,
      ];

    default:
      // Generic fallback format
      return [
        { data: b64, mime_type: 'image/jpeg' },
        prompt,
        duration,
      ];
  }
}

/**
 * Stitch an array of video Object URLs into a single WebM using Canvas + MediaRecorder.
 *
 * @param {string[]} videoUrls   - Ordered array of video object URLs
 * @param {object}   opts
 * @param {number}   opts.fps          - Output FPS (default 30)
 * @param {string}   opts.resolution   - '1280x720'
 * @param {function} opts.onProgress   - (0–1) progress callback
 * @param {function} opts.onStatus     - string status callback
 * @returns {Promise<Blob>}  Final video blob
 */
export async function stitchVideos(videoUrls, opts = {}) {
  const { fps = 30, resolution = '1280x720', onProgress, onStatus } = opts;
  const [width, height] = resolution.split('x').map(Number);

  onStatus?.('Setting up canvas for stitching…');

  const canvas   = document.createElement('canvas');
  canvas.width   = width;
  canvas.height  = height;
  const ctx      = canvas.getContext('2d');

  // Pick best supported video MIME
  const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';

  const chunks  = [];
  const recorder = new MediaRecorder(canvas.captureStream(fps), {
    mimeType:    mime,
    videoBitsPerSecond: 8_000_000,
  });
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  recorder.start(200); // collect in 200ms chunks

  for (let i = 0; i < videoUrls.length; i++) {
    onStatus?.(`Stitching clip ${i + 1} / ${videoUrls.length}…`);

    const video = await _loadVideo(videoUrls[i]);
    await _playIntoCanvas(video, canvas, ctx, fps, (p) => {
      onProgress?.((i + p) / videoUrls.length);
    });
  }

  recorder.stop();

  await new Promise(res => { recorder.onstop = res; });

  onStatus?.('Finalising video…');
  return new Blob(chunks, { type: mime });
}

function _loadVideo(src) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.src     = src;
    v.muted   = true;
    v.preload = 'auto';
    v.onloadedmetadata = () => resolve(v);
    v.onerror = reject;
    v.load();
  });
}

function _playIntoCanvas(video, canvas, ctx, fps, onProgress) {
  return new Promise((resolve) => {
    const duration   = video.duration;
    const frameDelay = 1000 / fps;
    let   currentTime = 0;

    function nextFrame() {
      if (currentTime > duration) {
        resolve();
        return;
      }
      video.currentTime = currentTime;
      video.onseeked = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        onProgress?.(currentTime / duration);
        currentTime += 1 / fps;
        setTimeout(nextFrame, frameDelay);
      };
    }

    nextFrame();
  });
}
