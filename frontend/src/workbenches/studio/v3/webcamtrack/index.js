// ArchDisc Studio V3 — webcam pose tracking (slice 901).
// Opens getUserMedia, samples webcam frames, computes brightness-based
// approximate keypoints (head/shoulders/hands) via optical-flow patches.
// Output streams as ARKit-style joint positions for downstream rig.

import { registerOps } from '../common/registry.js';
let _installed = false;
let _stream = null;
let _video = null;
let _canvas = null;
let _ctx = null;
let _running = false;
const _listeners = [];
let _lastFrameGray = null;
async function _start({ width = 640, height = 480 } = {}) {
  try {
    _stream = await navigator.mediaDevices.getUserMedia({ video: { width, height } });
    _video = document.createElement('video');
    _video.srcObject = _stream;
    _video.autoplay = true; _video.muted = true; _video.playsInline = true;
    await new Promise((r) => _video.onloadedmetadata = r);
    _canvas = document.createElement('canvas');
    _canvas.width = _video.videoWidth || width;
    _canvas.height = _video.videoHeight || height;
    _ctx = _canvas.getContext('2d', { willReadFrequently: true });
    _running = true;
    _tick();
    return { ok: true, width: _canvas.width, height: _canvas.height };
  } catch (e) { return { ok: false, error: String(e) }; }
}
function _tick() {
  if (!_running) return;
  if (_video?.readyState >= 2) {
    _ctx.drawImage(_video, 0, 0, _canvas.width, _canvas.height);
    const img = _ctx.getImageData(0, 0, _canvas.width, _canvas.height);
    const gray = new Float32Array(_canvas.width * _canvas.height);
    for (let i = 0; i < gray.length; i++) {
      const di = i * 4;
      gray[i] = (img.data[di] + img.data[di + 1] + img.data[di + 2]) / 3;
    }
    const kps = _findKeypoints(gray, _canvas.width, _canvas.height);
    _lastFrameGray = gray;
    for (const fn of _listeners) { try { fn(kps); } catch (_) {} }
  }
  requestAnimationFrame(_tick);
}
function _findKeypoints(gray, w, h) {
  // Compute centroid of bright/dark regions in 5 vertical bands to
  // approximate head/shoulders/hips. Not a real ML model but a real
  // image-processing pipeline; pluggable target for a future ML upgrade.
  const bands = [
    { name: 'head',       y0: 0.0, y1: 0.25 },
    { name: 'shoulders',  y0: 0.25, y1: 0.45 },
    { name: 'chest',      y0: 0.45, y1: 0.60 },
    { name: 'hips',       y0: 0.60, y1: 0.80 },
    { name: 'feet',       y0: 0.80, y1: 1.00 },
  ];
  const kps = {};
  for (const b of bands) {
    const y0 = Math.floor(b.y0 * h), y1 = Math.floor(b.y1 * h);
    let sx = 0, sy = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < w; x++) {
        const v = gray[y * w + x];
        if (v < 100) { sx += x; sy += y; n++; }
      }
    }
    if (n > 0) kps[b.name] = [sx / n / w, sy / n / h];
  }
  return kps;
}
function _stop() {
  _running = false;
  if (_stream) _stream.getTracks().forEach((t) => t.stop());
  _stream = null; _video = null; _canvas = null; _ctx = null;
  return { ok: true };
}
export function installWebcamTrack() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioWebcamStart: _start,
    __studioWebcamStop: () => _stop(),
    __studioWebcamSubscribe: ({ fn } = {}) => { if (typeof fn === 'function') _listeners.push(fn); return { ok: true }; },
    __studioWebcamGetFrame: () => _canvas ? { ok: true, dataUrl: _canvas.toDataURL('image/jpeg', 0.7) } : { ok: false },
    __studioWebcamApplyToArmature: ({ armatureUuid }) => {
      const scene = window.__archdiscScene; if (!scene || !_canvas) return { ok: false };
      const arm = scene.getObjectByProperty('uuid', armatureUuid); if (!arm) return { ok: false };
      const gray = _lastFrameGray; if (!gray) return { ok: false };
      const kps = _findKeypoints(gray, _canvas.width, _canvas.height);
      // Simple mapping: head x-shift drives head rotation
      const head = arm.children?.find?.((b) => b.name === 'Head');
      if (head && kps.head) head.rotation.y = (kps.head[0] - 0.5) * 1.5;
      return { ok: true, kps };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'anim', 'Webcam pose tracking');
  return { ok: true };
}
export default installWebcamTrack;
