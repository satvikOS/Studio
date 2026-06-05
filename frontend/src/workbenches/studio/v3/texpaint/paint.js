// ArchDisc Studio V3 — texture-paint brush rasteriser.
//
// `paintAt(uv, brushSize, color)` rasterises a soft brush stroke into
// the active paint layer's canvas. UVs are 0..1; brushSize is in
// pixels of the 512×512 layer canvas; color is '#rrggbb' or any value
// the 2D canvas API accepts as fillStyle.
//
// The brush is a radial gradient (soft edge) — `hardness` controls the
// inner-radius / outer-radius ratio. Paint is laid down with a
// `source-over` composite into the live layer canvas; the layer is then
// re-synced to its data URL so the next bake() includes the new pixels.
//
// World-space pickers reach this module via window.__studioMathScreenToWorld
// in the spec; this file only owns the UV→canvas-pixel conversion.

import {
  getLayerCanvas, syncLayerCanvas, activePaintLayer, addLayer, TEX_SIZE,
} from './layerstack.js';

function _activeMaterial(mesh) {
  if (!mesh) return null;
  return Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
}

// Ensure there's a paint layer to draw into; create one if missing.
function _ensurePaintLayer(material) {
  let l = activePaintLayer(material);
  if (l) return l;
  l = addLayer(material, 'paint', { blend: 'normal', opacity: 1.0, name: 'Paint' });
  return l;
}

// Soft round brush. `hardness` 0..1: 0 = fully soft, 1 = solid disc.
function _drawBrush(ctx, cx, cy, radius, color, hardness, opacity) {
  const r = Math.max(0.5, radius);
  const inner = Math.max(0, Math.min(r, r * (typeof hardness === 'number' ? hardness : 0.4)));
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = Math.max(0, Math.min(1, typeof opacity === 'number' ? opacity : 1));
  if (inner < r) {
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, r);
    grad.addColorStop(0, color);
    // Soft falloff to fully transparent at the rim.
    const trans = _withAlpha(color, 0);
    grad.addColorStop(1, trans);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = color;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Build a transparent version of a colour. Supports #rgb / #rrggbb /
// rgb()/rgba()/named; falls back to a generic rgba(0,0,0,0).
function _withAlpha(color, alpha) {
  if (typeof color !== 'string') return 'rgba(0,0,0,' + alpha + ')';
  let c = color.trim();
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
    } else {
      return 'rgba(0,0,0,' + alpha + ')';
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (c.startsWith('rgba')) return c.replace(/,[^,]+\)$/, `, ${alpha})`);
  if (c.startsWith('rgb(')) return c.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  // Best-effort named colours: just emit transparent black.
  return 'rgba(0,0,0,' + alpha + ')';
}

// Paint a single dab. `uv` is [u, v] in 0..1 (THREE convention: 0,0 =
// bottom-left). The canvas's Y axis is flipped vs. UV so we mirror.
// Returns { ok, x, y, radius, layer }.
export function paintAt(mesh, uv, brushSize, color, opts) {
  const o = opts || {};
  const material = _activeMaterial(mesh);
  if (!material) return { ok: false, error: 'no material' };
  if (!Array.isArray(uv) || uv.length < 2) return { ok: false, error: 'bad uv' };
  const layer = _ensurePaintLayer(material);
  if (!layer) return { ok: false, error: 'no paint layer' };
  const c = getLayerCanvas(material, layer.uuid);
  if (!c) return { ok: false, error: 'no canvas' };
  const ctx = c.getContext('2d');
  const u = Math.max(0, Math.min(1, Number(uv[0])));
  const v = Math.max(0, Math.min(1, Number(uv[1])));
  const x = u * (TEX_SIZE - 1);
  // Flip V because GL UV origin is bottom-left, canvas origin is top-left.
  const y = (1 - v) * (TEX_SIZE - 1);
  const r = Math.max(0.5, Number(brushSize) || 8);
  const hardness = typeof o.hardness === 'number' ? o.hardness : 0.4;
  const opacity = typeof o.opacity === 'number' ? o.opacity : 1.0;
  _drawBrush(ctx, x, y, r, color || '#ffffff', hardness, opacity);
  // Re-sync to data URL so the next bake reflects the stroke.
  syncLayerCanvas(material, layer.uuid);
  return { ok: true, x, y, radius: r, layer: layer.uuid };
}

// Bulk-paint a series of UV positions in a single stroke. Useful for
// the Archie agent and the e2e to lay down a visible smear without
// firing one op per pixel.
export function paintStroke(mesh, uvs, brushSize, color, opts) {
  if (!Array.isArray(uvs) || uvs.length === 0) return { ok: false, error: 'no uvs' };
  let last = null;
  for (const uv of uvs) {
    last = paintAt(mesh, uv, brushSize, color, opts);
    if (!last || !last.ok) return last || { ok: false };
  }
  return { ok: true, count: uvs.length, layer: last && last.layer };
}
