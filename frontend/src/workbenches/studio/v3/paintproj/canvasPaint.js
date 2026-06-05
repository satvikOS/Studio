// ArchDisc Studio V3 — Mari-style projection painting canvas writer.
//
// `stampAt(mesh, uv, color, brushSize, brushOpacity, hardness)` writes a
// soft circular brush dab onto the mesh's material.map (a CanvasTexture).
//
// If the material has no map, we create a 1024×1024 CanvasTexture
// pre-cleared to white, install it as `mat.map`, mark
// `mat.needsUpdate = true`, and stash the canvas under
// `mat.userData.__paintprojCanvas` so future stamps grab it without a
// readback. The mesh is also tagged `userData.archdiscStudioPaintProj`
// so other ops + the export pipeline can detect a projection-painted
// surface.
//
// The brush is a radial gradient circle (soft falloff) painted with
// `source-over` composite. UVs use the THREE convention (origin =
// bottom-left); the canvas origin is top-left so we flip Y.

import * as THREE from 'three';

export const DEFAULT_TEX_SIZE = 1024;
export const PAINTPROJ_MARKER  = 'archdiscStudioPaintProj';
const _CANVAS_KEY = '__paintprojCanvas';
const _CONTEXT_KEY = '__paintprojCtx';

function _materialOf(mesh) {
  if (!mesh) return null;
  return Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
}

// Build a new 1024×1024 CanvasTexture pre-cleared to `fillStyle`. The
// underlying canvas is kept addressable on mat.userData so we don't
// have to readbacks every stamp.
function _newCanvasTexture(size, fillStyle) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = fillStyle || '#ffffff';
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  // Match three.js modern defaults so the canvas reads as sRGB and
  // doesn't flip Y again (we already flipped UV→canvas-Y manually).
  try { tex.colorSpace = THREE.SRGBColorSpace; } catch (_) {}
  tex.flipY = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return { canvas: c, ctx, tex };
}

// Promote a material's existing map (an Image-backed Texture) into a
// CanvasTexture we can keep painting into. If no map exists, we make a
// blank one. Returns { canvas, ctx, tex }.
function _ensurePaintableMap(material, size) {
  if (!material) return null;
  // Fast path: previous stamps cached a canvas on the material itself.
  if (material.userData && material.userData[_CANVAS_KEY]) {
    return {
      canvas: material.userData[_CANVAS_KEY],
      ctx:    material.userData[_CONTEXT_KEY] || material.userData[_CANVAS_KEY].getContext('2d'),
      tex:    material.map,
    };
  }
  const s = size || DEFAULT_TEX_SIZE;
  // If a non-canvas map already exists, copy its image into a new
  // canvas so we paint over the existing colours (Mari style).
  let bundle;
  const existing = material.map;
  const existingImg = existing && existing.image;
  const looksLikeCanvas = existing && (existing.isCanvasTexture || (existingImg && existingImg.tagName === 'CANVAS'));
  if (looksLikeCanvas && existingImg && existingImg.tagName === 'CANVAS') {
    // Already a CanvasTexture — adopt the existing canvas in place.
    const canvas = existingImg;
    const ctx = canvas.getContext('2d');
    bundle = { canvas, ctx, tex: existing };
    try { existing.flipY = false; } catch (_) {}
  } else if (existingImg) {
    // Bake whatever's there into a new canvas.
    const cw = existingImg.width  || s;
    const ch = existingImg.height || s;
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    try { ctx.drawImage(existingImg, 0, 0, cw, ch); }
    catch (_) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch); }
    const tex = new THREE.CanvasTexture(c);
    try { tex.colorSpace = THREE.SRGBColorSpace; } catch (_) {}
    tex.flipY = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    bundle = { canvas: c, ctx, tex };
    material.map = tex;
  } else {
    bundle = _newCanvasTexture(s, '#ffffff');
    if (bundle) material.map = bundle.tex;
  }
  if (!bundle) return null;
  material.needsUpdate = true;
  material.userData = material.userData || {};
  material.userData[_CANVAS_KEY]  = bundle.canvas;
  material.userData[_CONTEXT_KEY] = bundle.ctx;
  return bundle;
}

// Convert a hex / rgb / named colour into rgba(...) with a custom alpha.
// We need this so the brush's outer ring fades to fully transparent.
function _withAlpha(color, alpha) {
  if (typeof color !== 'string') return `rgba(0,0,0,${alpha})`;
  const c = color.trim();
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    let r, g, b;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else { return `rgba(0,0,0,${alpha})`; }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (c.startsWith('rgba')) return c.replace(/,[^,]+\)$/, `, ${alpha})`);
  if (c.startsWith('rgb(')) return c.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  return `rgba(0,0,0,${alpha})`;
}

function _drawSoftBrush(ctx, cx, cy, radius, color, hardness, opacity) {
  const r = Math.max(0.5, radius);
  const h = typeof hardness === 'number' ? Math.max(0, Math.min(1, hardness)) : 0.5;
  const inner = Math.max(0, Math.min(r, r * h));
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = Math.max(0, Math.min(1, typeof opacity === 'number' ? opacity : 1));
  if (inner < r) {
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, _withAlpha(color, 0));
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = color;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Public — stamp the brush at a UV coord on the mesh's mat.map.
//
//   stampAt(mesh, [u,v], '#ff8800', 32, 0.85, 0.5)
//
// brushSize is interpreted in the source canvas's pixel space (so a
// 1024×1024 map with brushSize=32 draws a 32-px circle). Returns
// { ok, x, y, radius, texSize, mesh }.
export function stampAt(mesh, uv, color, brushSize, brushOpacity, hardness) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const mat = _materialOf(mesh);
  if (!mat) return { ok: false, error: 'no material' };
  if (!Array.isArray(uv) || uv.length < 2) return { ok: false, error: 'bad uv' };
  const bundle = _ensurePaintableMap(mat, DEFAULT_TEX_SIZE);
  if (!bundle) return { ok: false, error: 'no canvas (no DOM?)' };
  const { canvas, ctx, tex } = bundle;
  const w = canvas.width, h = canvas.height;
  const u = Math.max(0, Math.min(1, Number(uv[0])));
  const v = Math.max(0, Math.min(1, Number(uv[1])));
  const x = u * (w - 1);
  // Flip V — GL UV bottom-left → canvas top-left.
  const y = (1 - v) * (h - 1);
  const r = Math.max(0.5, Number(brushSize) || 24);
  const a = typeof brushOpacity === 'number' ? brushOpacity : 1.0;
  const hard = typeof hardness === 'number' ? hardness : 0.4;
  _drawSoftBrush(ctx, x, y, r, color || '#ffffff', hard, a);
  if (tex) tex.needsUpdate = true;
  mesh.userData = mesh.userData || {};
  mesh.userData[PAINTPROJ_MARKER] = {
    ts: Date.now(),
    texSize: [w, h],
    lastUv: [u, v],
  };
  return { ok: true, x, y, radius: r, texSize: [w, h], mesh };
}

// Write raw RGBA bytes at a UV coordinate (used by projectImage to
// stamp a 1×1 pixel — faster than going through the brush path).
export function writeTexel(mesh, uv, rgba) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const mat = _materialOf(mesh);
  if (!mat) return { ok: false, error: 'no material' };
  if (!Array.isArray(uv)) return { ok: false, error: 'bad uv' };
  const bundle = _ensurePaintableMap(mat, DEFAULT_TEX_SIZE);
  if (!bundle) return { ok: false, error: 'no canvas' };
  const { canvas, ctx, tex } = bundle;
  const w = canvas.width, h = canvas.height;
  const u = Math.max(0, Math.min(1, Number(uv[0])));
  const v = Math.max(0, Math.min(1, Number(uv[1])));
  const x = Math.round(u * (w - 1));
  const y = Math.round((1 - v) * (h - 1));
  const r = Math.max(0, Math.min(255, rgba[0] | 0));
  const g = Math.max(0, Math.min(255, rgba[1] | 0));
  const b = Math.max(0, Math.min(255, rgba[2] | 0));
  const aByte = Math.max(0, Math.min(255, rgba[3] == null ? 255 : rgba[3] | 0));
  ctx.save();
  ctx.globalAlpha = aByte / 255;
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(x, y, 1, 1);
  ctx.restore();
  if (tex) tex.needsUpdate = true;
  return { ok: true, x, y };
}

// Read whatever's currently painted as a PNG data URL — handy for the
// export pipeline + e2e visual verification.
export function exportCanvasDataUrl(mesh) {
  const mat = _materialOf(mesh);
  if (!mat || !mat.userData || !mat.userData[_CANVAS_KEY]) return null;
  try { return mat.userData[_CANVAS_KEY].toDataURL('image/png'); }
  catch (_) { return null; }
}

// Wipe the paint canvas back to a solid colour.
export function clearCanvas(mesh, fillStyle) {
  if (!mesh) return { ok: false, error: 'no mesh' };
  const mat = _materialOf(mesh);
  if (!mat) return { ok: false, error: 'no material' };
  const bundle = _ensurePaintableMap(mat, DEFAULT_TEX_SIZE);
  if (!bundle) return { ok: false, error: 'no canvas' };
  const { canvas, ctx, tex } = bundle;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1.0;
  ctx.fillStyle = fillStyle || '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  if (tex) tex.needsUpdate = true;
  return { ok: true, width: canvas.width, height: canvas.height };
}

// Internal accessor — used by projectImage so it can grab the canvas
// once + batch-write many texels without re-resolving the material.
export function getOrCreateCanvas(mesh, size) {
  const mat = _materialOf(mesh);
  if (!mat) return null;
  return _ensurePaintableMap(mat, size || DEFAULT_TEX_SIZE);
}
