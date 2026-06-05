// ArchDisc Studio V3 — VSE FX install layer.
//
// installVSEFX() is idempotent. It:
//   • imports the transition + effect kernels.
//   • exposes the window.__studioVSEFX* op surface:
//
//       __studioVSEFXListTransitions()
//         → { ok, kinds: [...6 transition kinds] }
//       __studioVSEFXListEffects()
//         → { ok, kinds: [...6 effect kinds] }
//       __studioVSEFXApplyTransition(kind, aDataUrl, bDataUrl, t, params)
//         → { ok, dataUrl, width, height }
//       __studioVSEFXApplyEffect(kind, aDataUrl, params)
//         → { ok, dataUrl, width, height }
//       __studioVSEFXTestStripA()   → { ok, dataUrl, width, height }
//       __studioVSEFXTestStripB()   → { ok, dataUrl, width, height }
//
//   • auto-registers each op with __studioCommandRegister under
//     category 'vse', mirroring the slice-690 VSE install layer so
//     the command palette surfaces FX next to the base VSE ops.
//
// We intentionally do NOT touch the slice-690 VSE directory or
// api.js. Each module here only registers extra window ops; if the
// VSE engine exposes a transition / effect registry hook
// (window.__studioVSERegisterTransition / __studioVSERegisterEffect),
// the loader-side hookers in transitions.js + effects.js will pick
// them up. If not, our own registry remains authoritative.

import {
  listTransitions, applyTransition, installWindowHook as installTransitionHook,
} from './transitions.js';
import {
  listEffects, applyEffect, installWindowHook as installEffectHook,
} from './effects.js';

let _installed = false;

// ─── DataURL ↔ ImageData helpers ────────────────────────────────────
//
// We accept dataURLs at the op boundary so callers can pass arbitrary
// captures (live viewport, image strips, e2e fixtures) without
// dealing with ImageData JSON-encoding. Decode is synchronous when
// the dataURL is a base64-encoded PNG/JPEG, async only when the
// browser hasn't decoded it yet — we wrap the whole thing in a
// Promise to keep the call shape consistent.

function decodeToImageData(dataUrl) {
  return new Promise((resolve, reject) => {
    if (!dataUrl || typeof dataUrl !== 'string') {
      reject(new Error('decodeToImageData: missing dataUrl'));
      return;
    }
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      reject(new Error('decodeToImageData: no DOM'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          reject(new Error(`decodeToImageData: image has zero dimension (${w}x${h})`));
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, w, h);
        resolve(id);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('decodeToImageData: image load failed'));
    img.src = dataUrl;
  });
}

function encodeFromImageData(id) {
  if (typeof document === 'undefined') {
    throw new Error('encodeFromImageData: no DOM');
  }
  const w = id.width, h = id.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // putImageData expects a real ImageData, but our makeOut returns
  // either ImageData or a duck-typed object — ctx.putImageData will
  // throw on the latter in some browsers, so reconstruct when needed.
  let real = id;
  if (typeof ImageData !== 'undefined' && !(id instanceof ImageData)) {
    try {
      real = new ImageData(new Uint8ClampedArray(id.data), w, h);
    } catch (_) { real = id; }
  }
  ctx.putImageData(real, 0, 0);
  return canvas.toDataURL('image/png');
}

// Best-effort sync resize: if input dims don't match a target, draw
// it onto a canvas of the target size with stretch-fit and re-read.
// Used to normalise transition inputs whose dims differ.
function resizeImageData(id, targetW, targetH) {
  if (id.width === targetW && id.height === targetH) return id;
  if (typeof document === 'undefined') return id;
  const src = document.createElement('canvas');
  src.width = id.width; src.height = id.height;
  src.getContext('2d').putImageData(
    typeof ImageData !== 'undefined' && !(id instanceof ImageData)
      ? new ImageData(new Uint8ClampedArray(id.data), id.width, id.height)
      : id,
    0, 0,
  );
  const dst = document.createElement('canvas');
  dst.width = targetW; dst.height = targetH;
  const ctx = dst.getContext('2d');
  ctx.drawImage(src, 0, 0, targetW, targetH);
  return ctx.getImageData(0, 0, targetW, targetH);
}

// ─── Test fixtures (used by the editor preview + e2e). ──────────────
//
// Two simple procedurally-rendered 256×144 frames. A is a horizontal
// red-to-yellow gradient; B is a blue-to-green gradient with a white
// diagonal band, so transitions show an obvious diff between them.

const TEST_W = 256;
const TEST_H = 144;

function buildTestStripA() {
  const w = TEST_W, h = TEST_H;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      d[i]     = 255;                              // R high
      d[i + 1] = Math.round((x / (w - 1)) * 255);  // G ramps
      d[i + 2] = 32;                               // B low
      d[i + 3] = 255;
    }
  }
  const id = typeof ImageData !== 'undefined' ? new ImageData(d, w, h)
    : { width: w, height: h, data: d };
  return id;
}

function buildTestStripB() {
  const w = TEST_W, h = TEST_H;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const diag = Math.abs((x + y * 2) % 60 - 30) < 6;   // diagonal band
      d[i]     = diag ? 255 : Math.round((x / (w - 1)) * 64);
      d[i + 1] = diag ? 255 : Math.round((y / (h - 1)) * 255);
      d[i + 2] = diag ? 255 : 224;
      d[i + 3] = 255;
    }
  }
  const id = typeof ImageData !== 'undefined' ? new ImageData(d, w, h)
    : { width: w, height: h, data: d };
  return id;
}

// ─── Op registration helper (mirror of vse/index.js). ───────────────

function reg(name, fn, description) {
  if (typeof window === 'undefined') return;
  window[name] = fn;
  const register = () => {
    try {
      if (typeof window.__studioCommandRegister === 'function') {
        window.__studioCommandRegister(name, fn, { category: 'vse', description });
        return true;
      }
    } catch (_) {}
    return false;
  };
  if (!register()) {
    // Palette may not have spun up yet; retry next macrotask. Same
    // pattern used by vse/index.js.
    setTimeout(register, 0);
  }
}

// ─── Install ────────────────────────────────────────────────────────

export function installVSEFX() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  // Hook the kernel-level entry points + any host-side VSE registry.
  installTransitionHook();
  installEffectHook();

  // ── List ops ───────────────────────────────────────────────────
  reg('__studioVSEFXListTransitions', () => ({
    ok: true,
    kinds: listTransitions(),
  }), 'List every VSE FX transition kind.');

  reg('__studioVSEFXListEffects', () => ({
    ok: true,
    kinds: listEffects(),
  }), 'List every VSE FX effect kind.');

  // ── Apply transition (dataUrl-flavoured) ───────────────────────
  reg('__studioVSEFXApplyTransition', async (kind, aDataUrl, bDataUrl, t, params) => {
    try {
      const [aId0, bId0] = await Promise.all([
        decodeToImageData(aDataUrl),
        decodeToImageData(bDataUrl),
      ]);
      // Normalise dims to A's so the kernels always get matching inputs.
      const bId = resizeImageData(bId0, aId0.width, aId0.height);
      const out = applyTransition(kind, aId0, bId, t, params || {});
      const dataUrl = encodeFromImageData(out);
      return {
        ok: true,
        dataUrl,
        width: out.width,
        height: out.height,
        kind: String(kind),
        t: Number(t),
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, 'Apply a VSE FX transition between two dataURL frames at time t∈[0,1].');

  // ── Apply effect (dataUrl-flavoured) ───────────────────────────
  reg('__studioVSEFXApplyEffect', async (kind, aDataUrl, params) => {
    try {
      const aId = await decodeToImageData(aDataUrl);
      const out = applyEffect(kind, aId, params || {});
      const dataUrl = encodeFromImageData(out);
      return {
        ok: true,
        dataUrl,
        width: out.width,
        height: out.height,
        kind: String(kind),
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, 'Apply a VSE FX effect to a dataURL frame.');

  // ── Test fixtures ───────────────────────────────────────────────
  reg('__studioVSEFXTestStripA', () => {
    try {
      const id = buildTestStripA();
      const dataUrl = encodeFromImageData(id);
      return { ok: true, dataUrl, width: id.width, height: id.height };
    } catch (e) { return { ok: false, error: e.message }; }
  }, 'Generate a test source image A (red→yellow gradient).');

  reg('__studioVSEFXTestStripB', () => {
    try {
      const id = buildTestStripB();
      const dataUrl = encodeFromImageData(id);
      return { ok: true, dataUrl, width: id.width, height: id.height };
    } catch (e) { return { ok: false, error: e.message }; }
  }, 'Generate a test source image B (blue→green gradient + diagonal band).');

  return { ok: true, alreadyInstalled: false };
}

export function uninstallVSEFX() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  for (const k of [
    '__studioVSEFXListTransitions',
    '__studioVSEFXListEffects',
    '__studioVSEFXApplyTransition',
    '__studioVSEFXApplyEffect',
    '__studioVSEFXTestStripA',
    '__studioVSEFXTestStripB',
    '__studioVSEFXApply',
    '__studioVSEFXApplyOne',
  ]) {
    try { delete window[k]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(k); } catch (_) {}
    }
  }
  _installed = false;
  return { ok: true };
}

export default installVSEFX;
