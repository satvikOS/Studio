// ArchDisc Studio V3 — Substance-Painter-style texture layer stack.
//
// Each material on a mesh gets a stack of layers (fill / paint /
// generator). Layers composite bottom-to-top through 2D canvas blend
// operations into a single CanvasTexture that becomes `mat.map`.
//
// Layer shape:
//   {
//     uuid: string,
//     kind: 'fill' | 'paint' | 'generator',
//     blend: 'normal' | 'multiply' | 'screen' | 'overlay',
//     opacity: 0..1,
//     enabled: boolean,
//     locked: boolean,
//     color: '#rrggbb'                  // fill layers
//     canvasDataUrl: 'data:image/png…'  // paint + generator layers (baked)
//     maskCanvasDataUrl: ?              // optional alpha mask
//     name: string,
//   }
//
// The stack is per-material; we key by the material's uuid so swapping
// the active mesh swaps the active stack. A bake produces a single
// CanvasTexture sized 512×512.

import * as THREE from 'three';

export const TEX_SIZE = 512;
export const BLENDS = ['normal', 'multiply', 'screen', 'overlay'];

// material uuid → { layers: Layer[], canvas: HTMLCanvasElement, tex: CanvasTexture }
const _stacks = new Map();

function _uuid() {
  // Local stable id generator — three's MathUtils is also fine, but we
  // want zero-dep so this stays self-contained.
  return 'tp-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function _ensureStack(material) {
  if (!material) return null;
  let s = _stacks.get(material.uuid);
  if (s) return s;
  s = { layers: [], canvas: null, tex: null };
  _stacks.set(material.uuid, s);
  return s;
}

export function getStack(material) {
  return _ensureStack(material);
}

export function listLayers(material) {
  const s = _ensureStack(material);
  if (!s) return { count: 0, layers: [] };
  return {
    count: s.layers.length,
    layers: s.layers.map((l) => ({
      uuid: l.uuid,
      kind: l.kind,
      blend: l.blend,
      opacity: l.opacity,
      enabled: l.enabled,
      locked: !!l.locked,
      color: l.color,
      name: l.name,
      hasCanvas: !!l.canvasDataUrl,
      hasMask: !!l.maskCanvasDataUrl,
    })),
  };
}

// Create a 512×512 RGBA canvas pre-cleared to (color, alpha) — used as
// the painted layer's working surface when first allocated.
function _blankCanvas(fillStyle) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = TEX_SIZE;
  c.height = TEX_SIZE;
  const ctx = c.getContext('2d');
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  } else {
    ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
  }
  return c;
}

// Convert a canvas to data URL safely.
function _toDataUrl(canvas) {
  if (!canvas) return null;
  try { return canvas.toDataURL('image/png'); } catch (_) { return null; }
}

// Add a new layer. `opts` may contain:
//   { blend, opacity, color, name, canvasDataUrl, maskCanvasDataUrl }
export function addLayer(material, kind, opts) {
  const s = _ensureStack(material);
  if (!s) return null;
  const o = opts || {};
  const blend = BLENDS.includes(o.blend) ? o.blend : 'normal';
  const opacity = typeof o.opacity === 'number' ? Math.max(0, Math.min(1, o.opacity)) : 1.0;
  const k = (kind === 'paint' || kind === 'generator') ? kind : 'fill';
  const color = o.color || '#ffffff';
  let canvasDataUrl = o.canvasDataUrl || null;
  // For freshly-created paint layers, allocate a blank transparent canvas
  // so paintAt() has something to draw into.
  if (k === 'paint' && !canvasDataUrl) {
    canvasDataUrl = _toDataUrl(_blankCanvas(null));
  }
  // Generator layers always come with a baked canvasDataUrl (from
  // smartmat / maskgen). If somehow missing, treat as fill.
  if (k === 'generator' && !canvasDataUrl) {
    canvasDataUrl = _toDataUrl(_blankCanvas(color));
  }
  const layer = {
    uuid: _uuid(),
    kind: k,
    blend,
    opacity,
    enabled: o.enabled !== false,
    locked: false,
    color,
    canvasDataUrl,
    maskCanvasDataUrl: o.maskCanvasDataUrl || null,
    name: o.name || `${k} ${s.layers.length + 1}`,
  };
  s.layers.push(layer);
  return layer;
}

export function deleteLayer(material, uuid) {
  const s = _ensureStack(material);
  if (!s) return false;
  const before = s.layers.length;
  s.layers = s.layers.filter((l) => l.uuid !== uuid);
  return s.layers.length < before;
}

export function setEnabled(material, uuid, on) {
  const s = _ensureStack(material);
  if (!s) return false;
  const l = s.layers.find((x) => x.uuid === uuid);
  if (!l) return false;
  l.enabled = !!on;
  return true;
}

export function setOpacity(material, uuid, w) {
  const s = _ensureStack(material);
  if (!s) return false;
  const l = s.layers.find((x) => x.uuid === uuid);
  if (!l) return false;
  l.opacity = Math.max(0, Math.min(1, Number(w) || 0));
  return true;
}

export function setBlend(material, uuid, blend) {
  const s = _ensureStack(material);
  if (!s) return false;
  if (!BLENDS.includes(blend)) return false;
  const l = s.layers.find((x) => x.uuid === uuid);
  if (!l) return false;
  l.blend = blend;
  return true;
}

export function setLocked(material, uuid, locked) {
  const s = _ensureStack(material);
  if (!s) return false;
  const l = s.layers.find((x) => x.uuid === uuid);
  if (!l) return false;
  l.locked = !!locked;
  return true;
}

export function setLayerCanvas(material, uuid, canvas) {
  const s = _ensureStack(material);
  if (!s) return false;
  const l = s.layers.find((x) => x.uuid === uuid);
  if (!l) return false;
  l.canvasDataUrl = _toDataUrl(canvas);
  return true;
}

// Move layer `from` to the index of layer `to`. Reordering bottom→top
// means lower index renders first (under). Returns true if the order
// actually changed.
export function reorder(material, uuidFrom, uuidTo) {
  const s = _ensureStack(material);
  if (!s) return false;
  const fi = s.layers.findIndex((l) => l.uuid === uuidFrom);
  const ti = s.layers.findIndex((l) => l.uuid === uuidTo);
  if (fi < 0 || ti < 0 || fi === ti) return false;
  const [moved] = s.layers.splice(fi, 1);
  s.layers.splice(ti, 0, moved);
  return true;
}

// Map a layer.blend string to the 2D context's compositing operation.
function _blendToOp(blend) {
  switch (blend) {
    case 'multiply': return 'multiply';
    case 'screen':   return 'screen';
    case 'overlay':  return 'overlay';
    case 'normal':
    default:         return 'source-over';
  }
}

// Synchronously load an image from a data URL. We accept that this
// returns immediately for already-loaded data URLs in modern Chromium
// (Image src= triggers decode but data URLs decode pretty quickly).
// For the headed e2e + the user-facing UI, the layer's canvasDataUrl is
// always set when we own the layer, so this read pattern is fine.
function _imageFromDataUrl(url) {
  if (!url || typeof Image === 'undefined') return null;
  const img = new Image();
  img.src = url;
  // Note: data URLs are not subject to CORS; img.complete will be true
  // on the next paint frame in Chromium. Tests await a tick so the
  // composite reads decoded pixels.
  return img;
}

// Composite the layer stack into a destination 2D context. Bottom layer
// first. Mask layers (maskCanvasDataUrl) modulate alpha multiplicatively
// using 'destination-in' on a per-layer offscreen, then drawn into dst.
async function _composite(s, dst) {
  if (!s) return;
  const ctx = dst.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1.0;
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

  for (const layer of s.layers) {
    if (!layer.enabled) continue;
    // Build the layer's RGBA buffer onto an offscreen canvas.
    let off = null;
    if (typeof document !== 'undefined') {
      off = document.createElement('canvas');
      off.width = TEX_SIZE; off.height = TEX_SIZE;
    }
    if (!off) continue;
    const octx = off.getContext('2d');
    if (layer.kind === 'fill') {
      octx.fillStyle = layer.color || '#ffffff';
      octx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    } else if (layer.canvasDataUrl) {
      // Decode the data URL synchronously where possible.
      const img = _imageFromDataUrl(layer.canvasDataUrl);
      if (img) {
        // Wait for decode (data URLs decode quickly but we still need to
        // await to be correct in headless environments).
        try { if (img.decode) await img.decode(); } catch (_) { /* ignore */ }
        octx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);
      }
    }
    // Apply mask via 'destination-in' if provided.
    if (layer.maskCanvasDataUrl) {
      const mimg = _imageFromDataUrl(layer.maskCanvasDataUrl);
      if (mimg) {
        try { if (mimg.decode) await mimg.decode(); } catch (_) { /* ignore */ }
        octx.globalCompositeOperation = 'destination-in';
        octx.drawImage(mimg, 0, 0, TEX_SIZE, TEX_SIZE);
        octx.globalCompositeOperation = 'source-over';
      }
    }
    // Composite layer into destination with its blend + opacity.
    ctx.globalCompositeOperation = _blendToOp(layer.blend);
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
    ctx.drawImage(off, 0, 0);
  }
  ctx.restore();
}

// Bake the stack to a CanvasTexture and assign as `material.map`. Also
// upgrades the material to MeshStandardMaterial if needed so the .map
// channel renders correctly. Returns { ok, dataUrl, count }.
export async function bake(mesh) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  let mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!mat) return { ok: false, error: 'no material' };
  if (!(mat instanceof THREE.MeshStandardMaterial)) {
    const oldColor = mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
    if (mat.dispose) mat.dispose();
    mat = new THREE.MeshStandardMaterial({ color: oldColor, roughness: 0.65, metalness: 0.05 });
    if (Array.isArray(mesh.material)) mesh.material[0] = mat;
    else mesh.material = mat;
  }
  const s = _ensureStack(mat);
  // Make / reuse the destination canvas.
  if (!s.canvas || typeof document === 'undefined') {
    if (typeof document === 'undefined') {
      return { ok: false, error: 'no document for bake' };
    }
    s.canvas = document.createElement('canvas');
    s.canvas.width = TEX_SIZE; s.canvas.height = TEX_SIZE;
  }
  await _composite(s, s.canvas);
  // Reuse / create the CanvasTexture.
  if (!s.tex) {
    s.tex = new THREE.CanvasTexture(s.canvas);
    s.tex.colorSpace = THREE.SRGBColorSpace;
    s.tex.wrapS = THREE.RepeatWrapping;
    s.tex.wrapT = THREE.RepeatWrapping;
  }
  s.tex.needsUpdate = true;
  // Swap into material.map. Dispose the previous map only if it was a
  // different texture instance (don't dispose our own cached one).
  if (mat.map && mat.map !== s.tex && mat.map.dispose) mat.map.dispose();
  mat.map = s.tex;
  if (mat.color) mat.color.set(0xffffff);
  mat.needsUpdate = true;
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioTexPaint = true;
  const dataUrl = _toDataUrl(s.canvas);
  return { ok: true, dataUrl, count: s.layers.length };
}

// Test-only: drop a material's stack (e.g. when the e2e tears down).
export function clearStack(material) {
  if (!material) return false;
  return _stacks.delete(material.uuid);
}

// Internal — used by paint.js so the brush rasteriser knows where to
// draw. Returns the live 2D canvas for the layer, allocating one if
// needed (and rehydrating from canvasDataUrl).
export function getLayerCanvas(material, uuid) {
  if (typeof document === 'undefined') return null;
  const s = _ensureStack(material);
  if (!s) return null;
  const l = s.layers.find((x) => x.uuid === uuid);
  if (!l) return null;
  // Cache the live canvas on the layer so repeated brushstrokes don't
  // re-decode every time.
  if (l._liveCanvas) return l._liveCanvas;
  const c = document.createElement('canvas');
  c.width = TEX_SIZE; c.height = TEX_SIZE;
  if (l.canvasDataUrl) {
    const img = new Image();
    img.src = l.canvasDataUrl;
    // Synchronous draw is fine for data URLs in Chromium once decode is
    // dispatched; for first-stroke correctness we trigger a re-bake on
    // decode complete.
    if (img.decode) {
      img.decode().then(() => {
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);
      }).catch(() => {});
    }
  }
  l._liveCanvas = c;
  return c;
}

// Sync the live canvas back into the layer's data URL — call after
// stroke ends. Returns the new dataUrl.
export function syncLayerCanvas(material, uuid) {
  const s = _ensureStack(material);
  if (!s) return null;
  const l = s.layers.find((x) => x.uuid === uuid);
  if (!l || !l._liveCanvas) return null;
  l.canvasDataUrl = _toDataUrl(l._liveCanvas);
  return l.canvasDataUrl;
}

// Find the active "paint" layer for the material (the most recent
// enabled paint layer). If none exists, return null.
export function activePaintLayer(material) {
  const s = _ensureStack(material);
  if (!s) return null;
  for (let i = s.layers.length - 1; i >= 0; i--) {
    if (s.layers[i].kind === 'paint' && s.layers[i].enabled && !s.layers[i].locked) {
      return s.layers[i];
    }
  }
  return null;
}
