// Slice 728 — UDIM-aware painting. Extends slice-686 paintproj by
// recognizing UV tiles 1001+ and routing strokes to per-tile texture
// canvases. Each UDIM (1001 = 0-1,0-1; 1002 = 1-2,0-1; ...) lives in
// its own offscreen canvas so users can paint across a multi-tile UV
// layout without bleeding between tiles. Mirrors Mari's UDIM system.

const _udimTextures = new Map();   // meshUuid → { tiles: Map<udim, canvas>, size }

export function attachUDIM(meshUuid, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry?.attributes?.uv) return { ok: false };
  const tileSize = Number(opts?.tileSize) || 1024;
  const state = { tiles: new Map(), size: tileSize };
  _udimTextures.set(meshUuid, state);
  // Pre-populate tiles for every UV tile referenced by the mesh.
  const uv = mesh.geometry.attributes.uv;
  const tiles = new Set();
  for (let i = 0; i < uv.count; i++) {
    const u = uv.array[i * 2];
    const v = uv.array[i * 2 + 1];
    const tu = Math.floor(u);
    const tv = Math.floor(v);
    tiles.add(1001 + tu + tv * 10);
  }
  for (const t of tiles) {
    const cv = document.createElement('canvas');
    cv.width = tileSize; cv.height = tileSize;
    cv.getContext('2d').fillStyle = '#888888';
    cv.getContext('2d').fillRect(0, 0, tileSize, tileSize);
    state.tiles.set(t, cv);
  }
  return { ok: true, tiles: Array.from(tiles).sort() };
}

export function paintStrokeAtUV(meshUuid, u, v, brush) {
  const state = _udimTextures.get(meshUuid);
  if (!state) return { ok: false };
  const tu = Math.floor(u);
  const tv = Math.floor(v);
  const udim = 1001 + tu + tv * 10;
  const tile = state.tiles.get(udim);
  if (!tile) return { ok: false, error: 'no tile for UDIM ' + udim };
  const tx = (u - tu) * tile.width;
  const ty = (1 - (v - tv)) * tile.height;
  const ctx = tile.getContext('2d');
  const r = (brush?.radius || 0.05) * tile.width;
  const color = brush?.color || '#ff8030';
  ctx.fillStyle = color;
  ctx.globalAlpha = brush?.opacity ?? 1;
  ctx.beginPath();
  ctx.arc(tx, ty, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  return { ok: true, udim };
}

export function getTileCanvas(meshUuid, udim) {
  const state = _udimTextures.get(meshUuid);
  if (!state) return { ok: false };
  const t = state.tiles.get(udim);
  if (!t) return { ok: false };
  return { ok: true, canvas: t, dataURL: t.toDataURL('image/png') };
}

export function listTiles(meshUuid) {
  const state = _udimTextures.get(meshUuid);
  if (!state) return { ok: false };
  return { ok: true, udims: Array.from(state.tiles.keys()).sort() };
}

export function exportTile(meshUuid, udim, filename) {
  const t = getTileCanvas(meshUuid, udim);
  if (!t.ok) return t;
  const a = document.createElement('a');
  a.href = t.dataURL;
  a.download = filename || `udim_${udim}.png`;
  a.click();
  return { ok: true };
}

export function exportAll(meshUuid) {
  const state = _udimTextures.get(meshUuid);
  if (!state) return { ok: false };
  for (const [udim, cv] of state.tiles.entries()) {
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = `udim_${udim}.png`;
    a.click();
  }
  return { ok: true, exported: state.tiles.size };
}

export function clearTile(meshUuid, udim) {
  const state = _udimTextures.get(meshUuid);
  if (!state) return { ok: false };
  const cv = state.tiles.get(udim);
  if (!cv) return { ok: false };
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#888888';
  ctx.fillRect(0, 0, cv.width, cv.height);
  return { ok: true };
}
