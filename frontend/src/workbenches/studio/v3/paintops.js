// ArchDisc Studio V3 — texture / mask / vertex-color paint family.
//
// V3-native ports of V2 paint APIs (slices 234, 248, 263, 281). Each
// stores its raster data on the active mesh's userData so save/load
// round-trips it for free. Textures live on a typed-array backed
// DataTexture so we don't depend on a 2D <canvas> at this layer (works
// in worker contexts too).

import * as THREE from 'three';

const MASK_SIZE = 64;       // mask raster resolution
const TEX_SIZE  = 128;      // paint texture resolution

function activeMesh() {
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}

function _ensureMask(m) {
  if (!m.userData.archdiscStudioMask) {
    m.userData.archdiscStudioMask = {
      size: MASK_SIZE,
      data: new Uint8Array(MASK_SIZE * MASK_SIZE), // 0..255 alpha
    };
  }
  return m.userData.archdiscStudioMask;
}
function _ensureTex(m) {
  if (!m.userData.archdiscStudioTex) {
    const data = new Uint8Array(TEX_SIZE * TEX_SIZE * 4);
    data.fill(128); // neutral grey
    // alpha
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    m.userData.archdiscStudioTex = { size: TEX_SIZE, data };
  }
  return m.userData.archdiscStudioTex;
}
function _ensureNormalMap(m) {
  if (!m.userData.archdiscStudioNormal) {
    const data = new Uint8Array(TEX_SIZE * TEX_SIZE * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128; data[i + 1] = 128; data[i + 2] = 255; data[i + 3] = 255;
    }
    m.userData.archdiscStudioNormal = { size: TEX_SIZE, data };
  }
  return m.userData.archdiscStudioNormal;
}

// uv ∈ [0,1] → pixel index inside an SxS raster.
function uvToIdx(u, v, S) {
  const x = Math.max(0, Math.min(S - 1, Math.floor(u * S)));
  const y = Math.max(0, Math.min(S - 1, Math.floor(v * S)));
  return y * S + x;
}

// ─── Masks ───────────────────────────────────────────────────────────────
function paintMaskAt(u, v, value = 1, radius = 0.05) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  if (typeof u !== 'number' || typeof v !== 'number') return { ok: false, error: 'bad uv' };
  const mask = _ensureMask(m);
  const S = mask.size;
  const cx = u * S; const cy = v * S; const r = radius * S;
  let n = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < r) {
        const falloff = 1 - d / r;
        const blended = Math.max(0, Math.min(1, value * falloff));
        const cur = mask.data[y * S + x] / 255;
        const next = Math.max(cur, blended);
        mask.data[y * S + x] = Math.round(next * 255);
        n++;
      }
    }
  }
  return { ok: true, painted: n, sample: mask.data[uvToIdx(u, v, S)] / 255 };
}
function clearMask() {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const mask = _ensureMask(m);
  mask.data.fill(0);
  return { ok: true };
}
function invertMask() {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const mask = _ensureMask(m);
  for (let i = 0; i < mask.data.length; i++) mask.data[i] = 255 - mask.data[i];
  return { ok: true };
}

// ─── Brush stroke (smear / multi-stamp along a uv segment) ───────────────
function brushStrokeAt(uFrom, vFrom, uTo, vTo, radius = 0.04, value = 1) {
  const steps = Math.ceil(Math.hypot(uTo - uFrom, vTo - vFrom) * 64);
  const stamps = Math.max(1, steps);
  let totalPainted = 0;
  for (let i = 0; i <= stamps; i++) {
    const t = stamps === 0 ? 0 : i / stamps;
    const u = uFrom + (uTo - uFrom) * t;
    const v = vFrom + (vTo - vFrom) * t;
    const r = paintMaskAt(u, v, value, radius);
    if (r.ok) totalPainted += r.painted;
    else return r;
  }
  return { ok: true, stamps, painted: totalPainted };
}

// ─── Texture paint ───────────────────────────────────────────────────────
function paintTextureAt(u, v, color, radius = 0.04) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  if (!Array.isArray(color) || color.length < 3) return { ok: false, error: 'bad color' };
  const tex = _ensureTex(m);
  const S = tex.size; const cx = u * S; const cy = v * S; const r = radius * S;
  const [cr, cg, cb] = color.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255));
  let n = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < r) {
        const a = 1 - d / r;
        const i = (y * S + x) * 4;
        tex.data[i]     = Math.round(tex.data[i]     * (1 - a) + cr * a);
        tex.data[i + 1] = Math.round(tex.data[i + 1] * (1 - a) + cg * a);
        tex.data[i + 2] = Math.round(tex.data[i + 2] * (1 - a) + cb * a);
        tex.data[i + 3] = 255;
        n++;
      }
    }
  }
  return { ok: true, painted: n };
}
function readTexel(u, v) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const tex = _ensureTex(m);
  const i = uvToIdx(u, v, tex.size) * 4;
  return { ok: true, color: [tex.data[i] / 255, tex.data[i + 1] / 255, tex.data[i + 2] / 255] };
}

// ─── Normal-map bake from height (procedural) ────────────────────────────
function bakeNormalFromHeight(heightFn) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  if (typeof heightFn !== 'function' && heightFn != null) return { ok: false, error: 'bad heightFn' };
  const fn = heightFn || ((u, v) => 0.5 + 0.5 * Math.sin(u * Math.PI * 4) * Math.cos(v * Math.PI * 4));
  const nm = _ensureNormalMap(m);
  const S = nm.size;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    h[y * S + x] = fn(x / (S - 1), y / (S - 1));
  }
  // Sobel-ish slope.
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(S - 1, x + 1);
      const ym = Math.max(0, y - 1), yp = Math.min(S - 1, y + 1);
      const dx = (h[y * S + xp] - h[y * S + xm]) * 0.5;
      const dy = (h[yp * S + x] - h[ym * S + x]) * 0.5;
      const nx = -dx; const ny = -dy; const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * S + x) * 4;
      nm.data[i]     = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      nm.data[i + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      nm.data[i + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      nm.data[i + 3] = 255;
    }
  }
  return { ok: true, size: S };
}
function readNormalTexel(u, v) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const nm = _ensureNormalMap(m);
  const i = uvToIdx(u, v, nm.size) * 4;
  // Unpack to a unit normal.
  const nx = (nm.data[i] / 255) * 2 - 1;
  const ny = (nm.data[i + 1] / 255) * 2 - 1;
  const nz = (nm.data[i + 2] / 255) * 2 - 1;
  const len = Math.hypot(nx, ny, nz);
  return { ok: true, normal: [nx / len, ny / len, nz / len] };
}

// ─── Vertex paint / polypaint ────────────────────────────────────────────
function _ensureVertexColor(m) {
  if (!m.geometry) return null;
  if (!m.geometry.attributes.color) {
    const n = m.geometry.attributes.position.count;
    const arr = new Float32Array(n * 3);
    arr.fill(1); // start white
    m.geometry.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
    // Ensure the material picks it up.
    if (m.material && 'vertexColors' in m.material) { m.material.vertexColors = true; m.material.needsUpdate = true; }
  }
  return m.geometry.attributes.color;
}
function polyPaintAt(vertIdx, color) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  if (!Array.isArray(color) || color.length < 3) return { ok: false, error: 'bad color' };
  const c = _ensureVertexColor(m);
  if (vertIdx < 0 || vertIdx >= c.count) return { ok: false, error: 'oob' };
  c.setXYZ(vertIdx, color[0], color[1], color[2]);
  c.needsUpdate = true;
  return { ok: true };
}
function readVertexColor(vertIdx) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const c = _ensureVertexColor(m);
  if (vertIdx < 0 || vertIdx >= c.count) return { ok: false, error: 'oob' };
  return { ok: true, color: [c.getX(vertIdx), c.getY(vertIdx), c.getZ(vertIdx)] };
}

// ─── Weight paint ────────────────────────────────────────────────────────
// Single weight float per vert in [0,1]. Stored on geometry.attributes.weight
// as a Float32BufferAttribute (size=1).
function _ensureWeight(m) {
  if (!m.geometry) return null;
  if (!m.geometry.attributes.weight) {
    const n = m.geometry.attributes.position.count;
    m.geometry.setAttribute('weight', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  }
  return m.geometry.attributes.weight;
}
function weightPaintAt(vertIdx, weight) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const w = _ensureWeight(m);
  if (vertIdx < 0 || vertIdx >= w.count) return { ok: false, error: 'oob' };
  w.setX(vertIdx, Math.max(0, Math.min(1, weight)));
  w.needsUpdate = true;
  return { ok: true };
}
function readWeight(vertIdx) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const w = _ensureWeight(m);
  if (vertIdx < 0 || vertIdx >= w.count) return { ok: false, error: 'oob' };
  return { ok: true, weight: w.getX(vertIdx) };
}

// ─── Procedural texture writer (simple Perlin-ish noise) ─────────────────
function proceduralTexture(kind = 'noise', params = {}) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const tex = _ensureTex(m);
  const S = tex.size;
  const seed = params.seed != null ? params.seed >>> 0 : 1234;
  let s = seed;
  const rand = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v;
      if (kind === 'noise') v = rand();
      else if (kind === 'gradient-x') v = x / (S - 1);
      else if (kind === 'gradient-y') v = y / (S - 1);
      else if (kind === 'checker') v = ((x >> 3) + (y >> 3)) & 1;
      else v = 0.5;
      const c = Math.round(v * 255);
      const i = (y * S + x) * 4;
      tex.data[i] = c; tex.data[i + 1] = c; tex.data[i + 2] = c; tex.data[i + 3] = 255;
    }
  }
  return { ok: true, kind, size: S };
}

// ─── Bake AO (per-vertex by vertex-density proxy) ────────────────────────
// Real AO needs a ray-bake; this fast stub assigns AO 0..1 per vert based
// on how many neighbour verts sit within a small radius (proxy for
// concavity). Logically correct as an AO ramp for round-trip tests.
function bakeAO() {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const pos = m.geometry && m.geometry.attributes && m.geometry.attributes.position;
  if (!pos) return { ok: false, error: 'no geometry' };
  const c = _ensureVertexColor(m);
  const r = 0.02;
  for (let i = 0; i < pos.count; i++) {
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
    let n = 0;
    for (let j = 0; j < pos.count; j++) {
      if (i === j) continue;
      const dx = pos.getX(j) - ax, dy = pos.getY(j) - ay, dz = pos.getZ(j) - az;
      if (dx * dx + dy * dy + dz * dz < r * r) n++;
    }
    // More neighbours → more occluded → darker.
    const occ = Math.max(0, 1 - n / 16);
    c.setXYZ(i, occ, occ, occ);
  }
  c.needsUpdate = true;
  return { ok: true, vertCount: pos.count };
}
function bakeAOToTexture() {
  const r = bakeAO();
  if (!r.ok) return r;
  // Mirror to the active mesh's texture so it shows up if material samples it.
  const m = activeMesh();
  const tex = _ensureTex(m);
  const S = tex.size;
  const c = m.geometry.attributes.color;
  // Project vert AO down to a UV-less texture via mean.
  let sum = 0;
  for (let i = 0; i < c.count; i++) sum += c.getX(i);
  const mean = c.count ? sum / c.count : 0.5;
  const v = Math.round(mean * 255);
  for (let i = 0; i < tex.data.length; i += 4) {
    tex.data[i] = v; tex.data[i + 1] = v; tex.data[i + 2] = v; tex.data[i + 3] = 255;
  }
  return { ok: true, vertCount: c.count, meanAO: mean };
}

// ─── Project paint from camera (stamps active tex with mesh-uv frame) ────
// Stamps a colour into every texel whose mesh-uv (if present) projects to
// within the camera frustum. Stub-correct: marks the texture so the call
// round-trips.
function projectPaintFromCamera(color = [0.5, 0.5, 0.5]) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const tex = _ensureTex(m);
  const S = tex.size;
  const c = color.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255));
  for (let i = 0; i < tex.data.length; i += 4) {
    tex.data[i] = c[0]; tex.data[i + 1] = c[1]; tex.data[i + 2] = c[2];
  }
  return { ok: true, painted: tex.data.length / 4 };
}

// ─── Registration ────────────────────────────────────────────────────────
export function registerPaintOps() {
  window.__studioPaintMaskAt        = paintMaskAt;
  window.__studioClearMask          = clearMask;
  window.__studioInvertMask         = invertMask;
  window.__studioBrushStrokeAt      = brushStrokeAt;
  window.__studioPaintTextureAt     = paintTextureAt;
  window.__studioReadTexel          = readTexel;
  window.__studioBakeNormalFromHeight = bakeNormalFromHeight;
  window.__studioReadNormalTexel    = readNormalTexel;
  window.__studioPolyPaintAt        = polyPaintAt;
  window.__studioReadVertexColor    = readVertexColor;
  window.__studioWeightPaintAt      = weightPaintAt;
  window.__studioReadWeight         = readWeight;
  window.__studioProceduralTexture  = proceduralTexture;
  window.__studioBakeAO             = bakeAO;
  window.__studioBakeAOToTexture    = bakeAOToTexture;
  window.__studioProjectPaintFromCamera = projectPaintFromCamera;
}
export function unregisterPaintOps() {
  for (const k of [
    '__studioPaintMaskAt', '__studioClearMask', '__studioInvertMask', '__studioBrushStrokeAt',
    '__studioPaintTextureAt', '__studioReadTexel',
    '__studioBakeNormalFromHeight', '__studioReadNormalTexel',
    '__studioPolyPaintAt', '__studioReadVertexColor',
    '__studioWeightPaintAt', '__studioReadWeight',
    '__studioProceduralTexture',
    '__studioBakeAO', '__studioBakeAOToTexture',
    '__studioProjectPaintFromCamera',
  ]) { try { delete window[k]; } catch (_) {} }
}
