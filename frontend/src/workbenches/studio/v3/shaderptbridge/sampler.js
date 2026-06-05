// ArchDisc Studio V3 — shader-graph ↔ GPU path tracer texture sampler.
//
// Mirrors the slice-689 CPU-side sampler in rt/pathtracer.js
// (`_sampleMaterialTextureAtUV`). Reads the active material's `.map`
// (CanvasTexture from the slice-684 shader graph bake, slice-642
// procedural textures, slice-688 matlib presets, or raw HTMLImageElement)
// via a 1×1 getImageData against the underlying canvas. The bridge layer
// (bridge.js) feeds the resulting RGB into each mesh's mat.color so the
// frozen-at-pack-time `_albedoFor()` inside sceneToTextures.js picks the
// texture-tinted value up next rebuild.
//
// We keep this as a leaf module — pure functions, no window touching —
// so it stays trivially unit-testable from headless contexts. The bridge
// wraps it for the actual scene walk.
//
// Why centroid UV (vs. per-pixel sampling): we deliberately cannot reach
// into the GPU path tracer's albedo texture (it lives behind the private
// `_gpu` closure in rtgpu/index.js and is therefore off-limits per the
// slice constraint). Instead we collapse each material to a single
// representative texel — the centroid of the unit UV square — and let
// the GPU PT keep its flat-per-tri albedo model. Future iterations can
// upgrade to per-triangle centroid UV by extending the bridge once
// rtgpu/ gains an explicit "write into albedo texture" op.

const _canvasCache = new WeakMap();
const _imageCanvases = new WeakMap();

// Coerce a THREE.Texture's image (HTMLCanvasElement / HTMLImageElement /
// OffscreenCanvas / ImageBitmap) into a 2D-canvas-context we can sample.
// Returns { canvas, ctx, w, h } or null when the image isn't readable
// yet (e.g. an <img> still loading, or an unsupported source type).
function _ctxFor(image) {
  if (!image) return null;
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    let entry = _canvasCache.get(image);
    if (!entry) {
      const ctx = image.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      entry = { canvas: image, ctx, w: image.width, h: image.height };
      _canvasCache.set(image, entry);
    } else {
      // Keep dims in sync — CanvasTextures resize on demand.
      entry.w = image.width;
      entry.h = image.height;
    }
    return entry;
  }
  if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) {
    let entry = _canvasCache.get(image);
    if (!entry) {
      const ctx = image.getContext('2d');
      if (!ctx) return null;
      entry = { canvas: image, ctx, w: image.width, h: image.height };
      _canvasCache.set(image, entry);
    }
    return entry;
  }
  // HTMLImageElement / ImageBitmap → blit into a one-shot scratch canvas.
  const isImg = (typeof HTMLImageElement !== 'undefined') && (image instanceof HTMLImageElement);
  const isBitmap = (typeof ImageBitmap !== 'undefined') && (image instanceof ImageBitmap);
  if (!isImg && !isBitmap) return null;
  if (isImg && !image.complete) return null;
  const iw = image.width | 0;
  const ih = image.height | 0;
  if (iw <= 0 || ih <= 0) return null;
  let entry = _imageCanvases.get(image);
  if (!entry || entry.w !== iw || entry.h !== ih) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = iw;
    canvas.height = ih;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    try { ctx.drawImage(image, 0, 0); } catch (_) { return null; }
    entry = { canvas, ctx, w: iw, h: ih };
    _imageCanvases.set(image, entry);
  }
  return entry;
}

// Sample the material's `.map` at UV (u, v). Returns
//   { r, g, b }  with each channel in [0, 1]
// or null if there is no sampleable texture / the underlying image is
// not yet ready. Honours tex.offset, tex.repeat, and wrap-by-modulo
// for [0,1) UVs (matches the slice-689 CPU sampler).
export function sampleTextureAtUV(material, u, v) {
  const mat = Array.isArray(material) ? material[0] : material;
  if (!mat || !mat.map) return null;
  const tex = mat.map;
  const img = tex.image;
  if (!img) return null;
  let uu = Number.isFinite(u) ? u : 0;
  let vv = Number.isFinite(v) ? v : 0;
  if (tex.offset) { uu += tex.offset.x; vv += tex.offset.y; }
  if (tex.repeat) { uu *= tex.repeat.x; vv *= tex.repeat.y; }
  uu = ((uu % 1) + 1) % 1;
  vv = ((vv % 1) + 1) % 1;
  const entry = _ctxFor(img);
  if (!entry) return null;
  const w = entry.w | 0;
  const h = entry.h | 0;
  if (w <= 0 || h <= 0) return null;
  const px = Math.max(0, Math.min(w - 1, Math.floor(uu * w)));
  // CanvasTexture flipY default = true (matches WebGL convention) — invert v
  // to align the GPU-sample direction with the slice-684 bake orientation.
  const py = Math.max(0, Math.min(h - 1, Math.floor((1 - vv) * h)));
  try {
    const data = entry.ctx.getImageData(px, py, 1, 1).data;
    return { r: data[0] / 255, g: data[1] / 255, b: data[2] / 255 };
  } catch (_) {
    // Cross-origin or 0-byte canvas — drop the sample.
    return null;
  }
}

// Pull the average of a small UV grid so a checker/noise graph doesn't
// reduce to a single dominant cell. Sampled at the geometric centroid of
// the unit-UV square plus four neighbours so a uniform tint reads as the
// tint colour. Falls back to `sampleTextureAtUV(mat, 0.5, 0.5)` when any
// of the 5-tap samples come back null.
export function sampleMaterialCentroid(material) {
  const c = sampleTextureAtUV(material, 0.5, 0.5);
  if (!c) return null;
  const samples = [c];
  const offsets = [
    [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75],
  ];
  for (const [u, v] of offsets) {
    const s = sampleTextureAtUV(material, u, v);
    if (s) samples.push(s);
  }
  let r = 0, g = 0, b = 0;
  for (const s of samples) { r += s.r; g += s.g; b += s.b; }
  const n = samples.length;
  return { r: r / n, g: g / n, b: b / n };
}

// Compute the centroid UV of a mesh's first triangle. Returns null if
// the geometry lacks a `uv` attribute (procedural primitives without
// UVs fall through to per-mat colour). Used by the bridge to bias the
// sample location toward the first visible face rather than the unit-UV
// midpoint when actual UV coordinates exist.
export function firstTriangleCentroidUV(geometry) {
  if (!geometry || !geometry.attributes) return null;
  const uv = geometry.attributes.uv;
  if (!uv) return null;
  const idx = geometry.index;
  const i0 = idx ? idx.getX(0) : 0;
  const i1 = idx ? idx.getX(1) : 1;
  const i2 = idx ? idx.getX(2) : 2;
  if (i0 >= uv.count || i1 >= uv.count || i2 >= uv.count) return null;
  const u = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3;
  const v = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3;
  return { u, v };
}

// Free cached scratch canvases for an image (e.g. when a CanvasTexture
// is disposed). Tests poke this between fixtures to keep the WeakMaps
// from holding references that confuse the GC sampler.
export function _resetSamplerCacheForTests() {
  // WeakMap doesn't expose iteration — re-create on each call.
  // (Tests don't actually need to *clear* existing entries; this hook
  // exists so future cleanup logic can hang off a single named export.)
}

// Internals re-exported for the bridge module's hash mixer + e2e probes.
export const __internals__ = { _ctxFor };
