// ArchDisc Studio V3 — Mari-style UDIM tile management.
//
// Mari uses a single integer ("UDIM") to address every tile of a multi-
// texture mesh: 1001 = U[0,1) × V[0,1), 1002 = U[1,2) × V[0,1), 1011 =
// U[0,1) × V[1,2), and so on. The packing is:
//
//   udim = 1001 + tileX + tileY * 10
//
// where tileX = floor(u), tileY = floor(v). Negative UVs clamp to 0
// (Mari treats them as belonging to 1001).
//
// Each mesh stores its UDIM textures in
//   mesh.userData.archdiscStudioUDIMs : Map<udimNumber, CanvasTexture>
//
// Because three.js can't natively bind a different texture per UV tile,
// the high-level Mari panel chooses an "active UDIM" (the tile a brush
// is currently editing) and composites the active tile back into the
// material's main maps. The composited canvas/CanvasTexture flow lives
// in channels.js + multipaint.js — udim.js only owns the addressing +
// per-tile texture storage.

import * as THREE from 'three';

export const UDIM_TEX_SIZE = 512;
export const UDIM_BASE = 1001;

// Convert a (u, v) UV pair to a UDIM tile index. Returns { udim, tileX,
// tileY, localU, localV } where localU/localV are the wrapped UVs in
// [0,1) for that tile.
export function getUDIMTile(meshOrU, vMaybe) {
  // Accept (mesh, u, v) or (u, v) for convenience — meshOrU is used as
  // u when a number is passed first.
  let u, v;
  if (typeof meshOrU === 'number') {
    u = meshOrU;
    v = Number(vMaybe);
  } else if (arguments.length >= 3) {
    u = Number(arguments[1]);
    v = Number(arguments[2]);
  } else {
    u = 0; v = 0;
  }
  if (!Number.isFinite(u)) u = 0;
  if (!Number.isFinite(v)) v = 0;
  // Mari clamps negative UVs into tile 1001.
  const tileX = Math.max(0, Math.floor(u));
  const tileY = Math.max(0, Math.floor(v));
  const udim = UDIM_BASE + tileX + tileY * 10;
  const localU = u - tileX;
  const localV = v - tileY;
  return { ok: true, udim, tileX, tileY, localU, localV };
}

// Reverse: given a UDIM number, return its tileX / tileY.
export function udimToTile(udim) {
  const n = Number(udim) - UDIM_BASE;
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'bad udim' };
  const tileY = Math.floor(n / 10);
  const tileX = n - tileY * 10;
  return { ok: true, tileX, tileY };
}

// Get (or lazily create) the udim map on a mesh.
export function getUDIMMap(mesh) {
  if (!mesh) return null;
  mesh.userData = mesh.userData || {};
  if (!mesh.userData.archdiscStudioUDIMs) {
    mesh.userData.archdiscStudioUDIMs = new Map();
  }
  return mesh.userData.archdiscStudioUDIMs;
}

// Build a blank UDIM canvas pre-filled with a colour (or transparent).
export function blankUDIMCanvas(fillStyle) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = UDIM_TEX_SIZE;
  c.height = UDIM_TEX_SIZE;
  const ctx = c.getContext('2d');
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fillRect(0, 0, UDIM_TEX_SIZE, UDIM_TEX_SIZE);
  } else {
    ctx.clearRect(0, 0, UDIM_TEX_SIZE, UDIM_TEX_SIZE);
  }
  return c;
}

// Decode a data URL onto a fresh canvas at UDIM_TEX_SIZE. Returns the
// canvas synchronously — the draw resolves asynchronously when the
// image decodes. Used by setUDIMTexture so the CanvasTexture has a
// backing canvas immediately.
function _canvasFromDataUrl(dataUrl) {
  const c = blankUDIMCanvas(null);
  if (!c || !dataUrl || typeof Image === 'undefined') return c;
  const img = new Image();
  img.src = dataUrl;
  const draw = () => {
    try {
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, UDIM_TEX_SIZE, UDIM_TEX_SIZE);
      ctx.drawImage(img, 0, 0, UDIM_TEX_SIZE, UDIM_TEX_SIZE);
      // Mark the canvas so dependent CanvasTextures can flag dirty.
      c._archdiscMariDecoded = true;
    } catch (_) { /* ignore */ }
  };
  if (img.decode) img.decode().then(draw).catch(() => {});
  else { img.onload = draw; }
  return c;
}

// Store a CanvasTexture for a given UDIM tile on a mesh. `dataUrl` may
// be a data URL or a raw HTMLCanvasElement (when stamping in-place).
// Returns { ok, udim, tex }.
export function setUDIMTexture(mesh, udim, dataUrlOrCanvas) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const n = Number(udim);
  if (!Number.isFinite(n) || n < UDIM_BASE) return { ok: false, error: 'bad udim' };
  const map = getUDIMMap(mesh);
  if (!map) return { ok: false, error: 'no map' };
  let canvas;
  if (dataUrlOrCanvas && dataUrlOrCanvas.tagName === 'CANVAS') {
    canvas = dataUrlOrCanvas;
  } else if (typeof dataUrlOrCanvas === 'string') {
    canvas = _canvasFromDataUrl(dataUrlOrCanvas);
  } else {
    canvas = blankUDIMCanvas(null);
  }
  if (!canvas) return { ok: false, error: 'no canvas' };
  let entry = map.get(n);
  if (entry && entry.canvas === canvas) {
    if (entry.tex) entry.tex.needsUpdate = true;
  } else {
    if (entry && entry.tex && entry.tex.dispose) {
      try { entry.tex.dispose(); } catch (_) {}
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    entry = { canvas, tex };
    map.set(n, entry);
  }
  return { ok: true, udim: n, tex: entry.tex };
}

// Look up a UDIM tile's CanvasTexture for a mesh. Returns null when the
// tile hasn't been touched yet — callers may choose to allocate a blank
// one via setUDIMTexture.
export function getUDIMTexture(mesh, udim) {
  if (!mesh) return null;
  const map = getUDIMMap(mesh);
  if (!map) return null;
  const e = map.get(Number(udim));
  return e ? e.tex : null;
}

// Look up the raw HTMLCanvasElement for a tile. Used by the per-channel
// paint stamper so it can draw directly without re-decoding.
export function getUDIMCanvas(mesh, udim) {
  if (!mesh) return null;
  const map = getUDIMMap(mesh);
  if (!map) return null;
  const e = map.get(Number(udim));
  return e ? e.canvas : null;
}

// List every UDIM tile currently stored on a mesh.
export function listUDIMs(mesh) {
  if (!mesh) return { ok: true, count: 0, udims: [] };
  const map = getUDIMMap(mesh);
  if (!map) return { ok: true, count: 0, udims: [] };
  const out = [];
  for (const [udim, entry] of map) {
    const tile = udimToTile(udim);
    out.push({
      udim,
      tileX: tile.ok ? tile.tileX : null,
      tileY: tile.ok ? tile.tileY : null,
      hasTexture: !!(entry && entry.tex),
    });
  }
  out.sort((a, b) => a.udim - b.udim);
  return { ok: true, count: out.length, udims: out };
}

// Drop a single UDIM tile (e.g. after a "clear tile" op).
export function clearUDIM(mesh, udim) {
  if (!mesh) return false;
  const map = getUDIMMap(mesh);
  if (!map) return false;
  const e = map.get(Number(udim));
  if (!e) return false;
  if (e.tex && e.tex.dispose) { try { e.tex.dispose(); } catch (_) {} }
  return map.delete(Number(udim));
}

// Test-only: drop the whole UDIM map for a mesh.
export function clearAllUDIMs(mesh) {
  if (!mesh) return false;
  const map = getUDIMMap(mesh);
  if (!map) return false;
  for (const [, e] of map) {
    if (e.tex && e.tex.dispose) { try { e.tex.dispose(); } catch (_) {} }
  }
  map.clear();
  return true;
}

// Export the UDIM tile's canvas as a PNG data URL — useful for round-
// trip persistence + the panel preview thumbnails.
export function exportUDIMDataUrl(mesh, udim) {
  const c = getUDIMCanvas(mesh, Number(udim));
  if (!c) return null;
  try { return c.toDataURL('image/png'); } catch (_) { return null; }
}
