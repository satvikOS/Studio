// ArchDisc Studio V3 — procedural mask generators.
//
// Each generator returns a 512×512 RGBA canvas + its data URL. Masks
// are grayscale (R = G = B) with alpha = R so they composite as
// straight intensity when used as a layer mask (`destination-in`).
//
// Three generators:
//   • curvature(mesh) — per-vertex curvature estimate baked through UVs.
//   • dirt()          — voronoi-cell crevices (random seed per call).
//   • edges()         — UV-edge falloff (vignette + UV-island borders).
//
// All masks are sized 512×512 to match the layer-stack TEX_SIZE.

import * as THREE from 'three';
import { TEX_SIZE } from './layerstack.js';

function _blank() {
  if (typeof document === 'undefined') return { canvas: null, ctx: null };
  const c = document.createElement('canvas');
  c.width = TEX_SIZE; c.height = TEX_SIZE;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  return { canvas: c, ctx };
}

function _toDataUrl(c) {
  if (!c) return null;
  try { return c.toDataURL('image/png'); } catch (_) { return null; }
}

// Per-vertex curvature estimate from face-normal divergence.
// For each vertex, average the angle between its triangle's normal and
// the neighbouring triangles' normals → high divergence = sharp edge.
// Rasterise the per-vertex weights into UV space.
export function curvature(mesh) {
  const { canvas, ctx } = _blank();
  if (!canvas) return { canvas: null, dataUrl: null };
  if (!mesh || !mesh.geometry) return { canvas, dataUrl: _toDataUrl(canvas) };
  const geom = mesh.geometry;
  const uvAttr = geom.attributes.uv;
  const posAttr = geom.attributes.position;
  if (!uvAttr || !posAttr) {
    // No UVs — fall back to a soft vertical gradient so the mask isn't
    // pure black (useful for primitive shapes that lack UVs).
    const grad = ctx.createLinearGradient(0, 0, 0, TEX_SIZE);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    return { canvas, dataUrl: _toDataUrl(canvas) };
  }
  // Build per-vertex curvature: sum of (1 - dot(normal_i, normal_j)) for
  // each shared edge in a triangle's neighbourhood.
  const idx = geom.index;
  const triCount = idx ? idx.count / 3 : posAttr.count / 3;
  const vertCount = posAttr.count;
  const normalSum = new Float32Array(vertCount * 3);
  const triNormalCount = new Uint16Array(vertCount);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const tn = new THREE.Vector3();
  const triNormals = new Float32Array(triCount * 3);
  const triIndices = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3)     : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(posAttr, i0);
    b.fromBufferAttribute(posAttr, i1);
    c.fromBufferAttribute(posAttr, i2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    tn.crossVectors(ab, ac).normalize();
    triNormals[t * 3]     = tn.x;
    triNormals[t * 3 + 1] = tn.y;
    triNormals[t * 3 + 2] = tn.z;
    triIndices[t * 3]     = i0;
    triIndices[t * 3 + 1] = i1;
    triIndices[t * 3 + 2] = i2;
    for (const v of [i0, i1, i2]) {
      normalSum[v * 3]     += tn.x;
      normalSum[v * 3 + 1] += tn.y;
      normalSum[v * 3 + 2] += tn.z;
      triNormalCount[v]++;
    }
  }
  // Average vertex normals → smooth normal field.
  const vertCurv = new Float32Array(vertCount);
  const vn = new THREE.Vector3();
  for (let v = 0; v < vertCount; v++) {
    const k = triNormalCount[v];
    if (k === 0) continue;
    vn.set(normalSum[v * 3] / k, normalSum[v * 3 + 1] / k, normalSum[v * 3 + 2] / k);
    if (vn.lengthSq() > 1e-8) vn.normalize();
    // Score per-vertex: how much do this vertex's incident triangle
    // normals deviate from the smooth average?
    let dev = 0; let count = 0;
    for (let t = 0; t < triCount; t++) {
      if (triIndices[t * 3] === v || triIndices[t * 3 + 1] === v || triIndices[t * 3 + 2] === v) {
        const d = vn.x * triNormals[t * 3] + vn.y * triNormals[t * 3 + 1] + vn.z * triNormals[t * 3 + 2];
        dev += 1 - d;
        count++;
      }
    }
    vertCurv[v] = count > 0 ? dev / count : 0;
  }
  // Normalise to 0..1.
  let maxC = 1e-6;
  for (let v = 0; v < vertCount; v++) if (vertCurv[v] > maxC) maxC = vertCurv[v];
  for (let v = 0; v < vertCount; v++) vertCurv[v] = Math.min(1, vertCurv[v] / maxC);
  // Rasterise each triangle into UV space with per-vertex curvature
  // interpolated linearly — use ctx.fill with three small triangle
  // strokes per face (cheap; max ~5k tris for typical primitives).
  const u0 = new THREE.Vector2(), u1 = new THREE.Vector2(), u2 = new THREE.Vector2();
  for (let t = 0; t < triCount; t++) {
    const i0 = triIndices[t * 3];
    const i1 = triIndices[t * 3 + 1];
    const i2 = triIndices[t * 3 + 2];
    u0.fromBufferAttribute(uvAttr, i0);
    u1.fromBufferAttribute(uvAttr, i1);
    u2.fromBufferAttribute(uvAttr, i2);
    // Average curvature on the triangle (cheap approximation).
    const cv = (vertCurv[i0] + vertCurv[i1] + vertCurv[i2]) / 3;
    const alpha = Math.max(0, Math.min(1, cv));
    if (alpha < 0.01) continue;
    const x0 = u0.x * TEX_SIZE; const y0 = (1 - u0.y) * TEX_SIZE;
    const x1 = u1.x * TEX_SIZE; const y1 = (1 - u1.y) * TEX_SIZE;
    const x2 = u2.x * TEX_SIZE; const y2 = (1 - u2.y) * TEX_SIZE;
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.fill();
  }
  return { canvas, dataUrl: _toDataUrl(canvas) };
}

// Voronoi-style dirt: scatter N seed points, then for each pixel score
// the distance to the nearest seed → dark where distance is small (so
// dirt accumulates between cells, like crevices).
export function dirt(opts) {
  const { canvas, ctx } = _blank();
  if (!canvas) return { canvas: null, dataUrl: null };
  const o = opts || {};
  const N = Math.max(8, Math.min(2048, Number(o.cells) || 96));
  // Seed positions, deterministic if a seed is given.
  let rand;
  if (typeof o.seed === 'number') {
    let s = o.seed;
    rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  } else {
    rand = Math.random;
  }
  const seeds = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    seeds[i * 2]     = rand() * TEX_SIZE;
    seeds[i * 2 + 1] = rand() * TEX_SIZE;
  }
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const data = img.data;
  // For perf, downsample the scoring grid to every 2 px then re-fill.
  const STEP = 2;
  for (let y = 0; y < TEX_SIZE; y += STEP) {
    for (let x = 0; x < TEX_SIZE; x += STEP) {
      // Find distance to nearest two seeds → use the diff as the "crack"
      // mask (classic voronoi-edge trick).
      let d1 = Infinity, d2 = Infinity;
      for (let k = 0; k < N; k++) {
        const dx = x - seeds[k * 2];
        const dy = y - seeds[k * 2 + 1];
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; }
        else if (d < d2) { d2 = d; }
      }
      // Use sqrt of (d2 - d1) — small near a Voronoi edge.
      const edge = Math.sqrt(Math.max(0, d2 - d1));
      // Inverse mapping → 1 near edges, 0 at cell centres. Tighten with
      // exponent to make the crevices crisp.
      const m = Math.max(0, 1 - edge / 8);
      const v = Math.round(Math.pow(m, 1.6) * 255);
      for (let dy = 0; dy < STEP; dy++) {
        for (let dx = 0; dx < STEP; dx++) {
          const px = x + dx; const py = y + dy;
          if (px >= TEX_SIZE || py >= TEX_SIZE) continue;
          const i = (py * TEX_SIZE + px) * 4;
          data[i]     = v;
          data[i + 1] = v;
          data[i + 2] = v;
          data[i + 3] = v;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, dataUrl: _toDataUrl(canvas) };
}

// UV-edge falloff: vignette darkens toward the texture borders (mimics
// island borders before a proper UV unwrap is available). Optionally
// thickness controls the falloff distance.
export function edges(opts) {
  const { canvas, ctx } = _blank();
  if (!canvas) return { canvas: null, dataUrl: null };
  const thickness = Math.max(4, Math.min(TEX_SIZE / 2, Number((opts || {}).thickness) || 48));
  // White centre, fading to black at the edges.
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
  // Inner solid rectangle.
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  // Stroke a series of inset rounded rectangles with decreasing alpha.
  for (let i = 0; i < thickness; i++) {
    const t = 1 - i / thickness;
    const alpha = Math.pow(t, 1.7);
    ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(i + 0.5, i + 0.5, TEX_SIZE - 2 * i - 1, TEX_SIZE - 2 * i - 1);
  }
  return { canvas, dataUrl: _toDataUrl(canvas) };
}

// Generate by name — dispatch helper used by the index op surface.
export function generate(kind, mesh, opts) {
  if (kind === 'curvature') return curvature(mesh);
  if (kind === 'dirt')      return dirt(opts);
  if (kind === 'edges')     return edges(opts);
  return { canvas: null, dataUrl: null, error: 'unknown kind' };
}

export const MASK_KINDS = ['curvature', 'dirt', 'edges'];
