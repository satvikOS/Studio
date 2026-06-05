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

// Slice 695 dedup: the actual UV-to-RGB read is delegated to
// common/sample-texture.js's sampleMaterialTextureAtUV — same wrap /
// offset / repeat / flip-Y math the slice-689 CPU sampler used, but
// shared so rt/pathtracer.js, shaderptbridge and any future consumers
// stay in lockstep.
import { sampleMaterialTextureAtUV as _commonSampleMaterialTextureAtUV } from '../common/sample-texture.js';

// Sample the material's `.map` at UV (u, v). Returns
//   { r, g, b }  with each channel in [0, 1]
// or null if there is no sampleable texture / the underlying image is
// not yet ready. Honours tex.offset, tex.repeat, and wrap-by-modulo
// for [0,1) UVs (matches the slice-689 CPU sampler).
export function sampleTextureAtUV(material, u, v) {
  return _commonSampleMaterialTextureAtUV(material, u, v);
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
// Slice 695: _ctxFor was removed when the UV-to-RGB read was delegated
// to common/sample-texture.js; the bridge no longer needs a direct
// canvas handle so the export now points at the common sampler entry.
export const __internals__ = { _sampleMaterialTextureAtUV: _commonSampleMaterialTextureAtUV };
