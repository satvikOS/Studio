// ArchDisc Studio V3 — hair-grooming strand engine (slice 760).
//
// Real strands for Unreal Groom / Maya XGen / Blender Hair parity. A
// "strand" is a polyline of per-segment control points growing from a
// root that lies on a source mesh's surface. Roots are area-weighted
// samples of the mesh; the initial straight strand walks along the
// interpolated surface normal at the root.
//
// The four exports below cover the grooming workflow that every DCC
// hair package exposes:
//
//   • generateStrands(meshGeometry, count, length, segments=8)
//     Build `count` strands. Each strand owns `segments + 1` control
//     points (the +1 is the root itself), spaced uniformly along the
//     surface normal at the root. Returned as `{ root, normal, points }`
//     records with `points: Array<{x,y,z}>` so they survive the
//     win.evaluate / JSON boundary cleanly.
//
//   • combStrands(strands, brushCenter, brushDir, radius, strength)
//     Push each strand whose root is within `radius` of `brushCenter`
//     along `brushDir`. Per-strand weighting is the smoothstep of
//     `1 - distance/radius`, per-segment weighting is `t = i/segments`
//     so the root pins and the tip swings the most — matches what
//     XGen / Groom comb brushes do under the hood.
//
//   • lengthStrands(strands, lengthMul)
//     Re-place each interior point along the root→tip direction with
//     the given multiplier. Preserves any existing comb deformation by
//     scaling the per-segment vector from the root, NOT by regenerating
//     from the normal.
//
//   • densifyStrands(strands, multiplier)
//     Insert `multiplier - 1` extra strands between each adjacent root
//     pair (the simplest XGen "density" stroke), interpolating roots,
//     normals and control points. multiplier=2 doubles the count; 3
//     triples; non-integer multipliers round down per-gap with a
//     deterministic distribution so totals are reproducible.
//
// Zero deps beyond THREE. No Math.random — every stochastic decision
// goes through mulberry32 the same way scatter/poissonSurface.js does,
// so the e2e can pin a seed and get identical output between runs.

import * as THREE from 'three';
import { mulberry32 } from '../common/random.js';

// ─── Triangle helpers ──────────────────────────────────────────────────
// Walk a BufferGeometry into per-triangle records carrying the three
// corner positions and normals + the triangle's surface area. Same
// shape `scatter/poissonSurface.js` uses, slimmed down because grooming
// never asks for UVs.
function _tessellate(geometry) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return [];
  const posAttr = geometry.attributes.position;
  const nrmAttr = geometry.attributes.normal || null;
  const index = geometry.index;
  const triCount = index ? (index.count / 3) | 0 : (posAttr.count / 3) | 0;
  const out = new Array(triCount);
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  function readN(attr, i, fallback) {
    if (!attr) return [fallback.x, fallback.y, fallback.z];
    return [attr.getX(i), attr.getY(i), attr.getZ(i)];
  }
  for (let t = 0; t < triCount; t++) {
    let ia, ib, ic;
    if (index) {
      ia = index.getX(t * 3);
      ib = index.getX(t * 3 + 1);
      ic = index.getX(t * 3 + 2);
    } else {
      ia = t * 3; ib = t * 3 + 1; ic = t * 3 + 2;
    }
    va.set(posAttr.getX(ia), posAttr.getY(ia), posAttr.getZ(ia));
    vb.set(posAttr.getX(ib), posAttr.getY(ib), posAttr.getZ(ib));
    vc.set(posAttr.getX(ic), posAttr.getY(ic), posAttr.getZ(ic));
    e1.subVectors(vb, va);
    e2.subVectors(vc, va);
    nrm.crossVectors(e1, e2);
    const cross = nrm.length();
    const area = cross * 0.5;
    const fallbackN = nrm.clone();
    if (cross > 1e-20) fallbackN.multiplyScalar(1 / cross);
    else fallbackN.set(0, 1, 0);
    const na = readN(nrmAttr, ia, fallbackN);
    const nb = readN(nrmAttr, ib, fallbackN);
    const nc = readN(nrmAttr, ic, fallbackN);
    out[t] = {
      ax: va.x, ay: va.y, az: va.z,
      bx: vb.x, by: vb.y, bz: vb.z,
      cx: vc.x, cy: vc.y, cz: vc.z,
      nax: na[0], nay: na[1], naz: na[2],
      nbx: nb[0], nby: nb[1], nbz: nb[2],
      ncx: nc[0], ncy: nc[1], ncz: nc[2],
      area,
    };
  }
  return out;
}

function _areaCDF(triangles) {
  const N = triangles.length;
  const cdf = new Float64Array(N);
  let total = 0;
  for (let i = 0; i < N; i++) {
    total += triangles[i].area;
    cdf[i] = total;
  }
  return { cdf, total };
}

function _pickTriangle(cdf, total, r) {
  const target = r * total;
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cdf[mid] < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// ─── 1) generateStrands ────────────────────────────────────────────────
// generateStrands(meshGeometry, count, length, segments=8, opts?) → strands[]
//
// strands[i] = {
//   root:    {x, y, z},
//   normal:  {x, y, z},          // unit
//   points:  Array<{x, y, z}>,   // length = segments + 1, points[0] = root
//   length:  number,             // total length along the strand
// }
//
// opts:
//   seed     PRNG seed (default 1337)
//
// Roots are drawn with area-weighted triangle sampling (matches the
// existing scatter routine's distribution; we don't enforce Poisson-
// disk minimum-distance here because grooming wants HIGH density — the
// 500-strand default would only accept ~50 % of darts under typical
// minDist auto-derivation, and the user expects 500 strands).
export function generateStrands(meshGeometry, count, length, segments, opts) {
  const N = Math.max(0, Math.floor(+count || 0));
  const L = Math.max(0, +length || 0);
  const S = Math.max(1, Math.floor(+segments || 8));
  const seed = (opts && Number.isFinite(+opts.seed)) ? (+opts.seed | 0) : 1337;
  const triangles = _tessellate(meshGeometry);
  if (!triangles.length || N === 0) return [];
  const { cdf, total } = _areaCDF(triangles);
  if (!(total > 0)) return [];
  const rng = mulberry32(seed);
  const strands = new Array(N);
  const nrmScratch = new THREE.Vector3();
  for (let s = 0; s < N; s++) {
    const tIdx = _pickTriangle(cdf, total, rng());
    const tri = triangles[tIdx];
    let u = rng();
    let v = rng();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    // Barycentric-interp position + normal at the root.
    const rx = tri.ax * w + tri.bx * u + tri.cx * v;
    const ry = tri.ay * w + tri.by * u + tri.cy * v;
    const rz = tri.az * w + tri.bz * u + tri.cz * v;
    let nx = tri.nax * w + tri.nbx * u + tri.ncx * v;
    let ny = tri.nay * w + tri.nby * u + tri.ncy * v;
    let nz = tri.naz * w + tri.nbz * u + tri.ncz * v;
    nrmScratch.set(nx, ny, nz);
    if (nrmScratch.lengthSq() > 1e-20) nrmScratch.normalize();
    else nrmScratch.set(0, 1, 0);
    nx = nrmScratch.x; ny = nrmScratch.y; nz = nrmScratch.z;
    // Build segments + 1 control points; the +1 is the root itself.
    const points = new Array(S + 1);
    for (let i = 0; i <= S; i++) {
      const t = i / S;
      points[i] = {
        x: rx + nx * L * t,
        y: ry + ny * L * t,
        z: rz + nz * L * t,
      };
    }
    strands[s] = {
      root: { x: rx, y: ry, z: rz },
      normal: { x: nx, y: ny, z: nz },
      points,
      length: L,
    };
  }
  return strands;
}

// ─── 2) combStrands ────────────────────────────────────────────────────
// combStrands(strands, brushCenter, brushDir, radius, strength) →
//   { perturbedCount, totalDelta }
//
// Mutates the input strand array in place. A strand qualifies when its
// root lies within `radius` of `brushCenter`. The push direction is
// `brushDir` (auto-normalised; identity-tolerant); per-strand falloff
// is smoothstep on `1 - d/r`, per-segment weighting is `t = i/segments`
// so the root pins and the tip swings the most. Strength is the
// multiplier on the world-space push at t=1.
export function combStrands(strands, brushCenter, brushDir, radius, strength) {
  if (!Array.isArray(strands) || !strands.length) {
    return { perturbedCount: 0, totalDelta: 0 };
  }
  const cx = brushCenter ? (+brushCenter.x || (Array.isArray(brushCenter) ? brushCenter[0] : 0)) : 0;
  const cy = brushCenter ? (+brushCenter.y || (Array.isArray(brushCenter) ? brushCenter[1] : 0)) : 0;
  const cz = brushCenter ? (+brushCenter.z || (Array.isArray(brushCenter) ? brushCenter[2] : 0)) : 0;
  let dx = brushDir ? (+brushDir.x || (Array.isArray(brushDir) ? brushDir[0] : 0)) : 0;
  let dy = brushDir ? (+brushDir.y || (Array.isArray(brushDir) ? brushDir[1] : 0)) : 0;
  let dz = brushDir ? (+brushDir.z || (Array.isArray(brushDir) ? brushDir[2] : 0)) : 0;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dl > 1e-12) { dx /= dl; dy /= dl; dz /= dl; }
  else { dx = 1; dy = 0; dz = 0; }
  const r = Math.max(0, +radius || 0);
  const r2 = r * r;
  const st = Number.isFinite(+strength) ? +strength : 1;
  let perturbed = 0;
  let totalDelta = 0;
  for (let s = 0; s < strands.length; s++) {
    const strand = strands[s];
    if (!strand || !strand.root || !Array.isArray(strand.points)) continue;
    const rx = strand.root.x, ry = strand.root.y, rz = strand.root.z;
    const ddx = rx - cx, ddy = ry - cy, ddz = rz - cz;
    const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d2 > r2) continue;
    if (r <= 0) continue;
    const d = Math.sqrt(d2);
    const u = 1 - d / r;            // 0 at edge, 1 at centre
    const fall = u * u * (3 - 2 * u); // smoothstep
    const segCount = strand.points.length - 1;
    if (segCount <= 0) continue;
    let touched = false;
    for (let i = 1; i <= segCount; i++) {
      const t = i / segCount;
      const k = fall * st * t;
      strand.points[i].x += dx * k;
      strand.points[i].y += dy * k;
      strand.points[i].z += dz * k;
      totalDelta += Math.abs(k);
      touched = true;
    }
    if (touched) perturbed++;
  }
  return { perturbedCount: perturbed, totalDelta };
}

// ─── 3) lengthStrands ──────────────────────────────────────────────────
// lengthStrands(strands, lengthMul) → { newAvgLength }
//
// Scales every interior point's offset from the root by `lengthMul`,
// preserving any combing that's already been baked into the per-segment
// positions. lengthMul < 1 shortens; > 1 lengthens. Updates each
// strand's tracked `length` field too so listGroom() reports it.
export function lengthStrands(strands, lengthMul) {
  if (!Array.isArray(strands) || !strands.length) {
    return { newAvgLength: 0 };
  }
  const k = Number.isFinite(+lengthMul) ? +lengthMul : 1;
  let totalLen = 0;
  let counted = 0;
  for (const strand of strands) {
    if (!strand || !strand.root || !Array.isArray(strand.points)) continue;
    const rx = strand.root.x, ry = strand.root.y, rz = strand.root.z;
    for (let i = 1; i < strand.points.length; i++) {
      const p = strand.points[i];
      p.x = rx + (p.x - rx) * k;
      p.y = ry + (p.y - ry) * k;
      p.z = rz + (p.z - rz) * k;
    }
    // Re-measure the strand's polyline length so callers / outliner get
    // honest numbers post-scale.
    let plen = 0;
    for (let i = 1; i < strand.points.length; i++) {
      const a = strand.points[i - 1];
      const b = strand.points[i];
      const sdx = b.x - a.x, sdy = b.y - a.y, sdz = b.z - a.z;
      plen += Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz);
    }
    strand.length = plen;
    totalLen += plen;
    counted++;
  }
  return { newAvgLength: counted ? totalLen / counted : 0 };
}

// ─── 4) densifyStrands ─────────────────────────────────────────────────
// densifyStrands(strands, multiplier) → strands[] (NEW array)
//
// Insert linearly-interpolated strands between adjacent input strands so
// the returned array has approximately `multiplier * strands.length`
// entries. `multiplier <= 1` returns a shallow-cloned copy of the input
// (we still re-emit so callers don't have to special-case).
//
// We treat the input strands as a 1-D sequence: between strand[i] and
// strand[i+1] we add `multiplier - 1` interpolated strands (linear lerp
// of root + normal + every control point + length). At the boundary
// strand[N-1] no neighbour exists so nothing is inserted after it.
// Non-integer multipliers map to `floor(multiplier - 1)` plus a
// fractional insert that walks the gaps deterministically so the total
// hits `round(multiplier * N)`.
export function densifyStrands(strands, multiplier) {
  if (!Array.isArray(strands) || !strands.length) return [];
  const N = strands.length;
  const m = Math.max(1, +multiplier || 1);
  if (m <= 1) {
    return strands.map(_cloneStrand);
  }
  if (N === 1) {
    // No neighbour to lerp toward — emit `ceil(m)` copies of the lone
    // strand. Avoids losing density on a 1-strand input.
    const copies = Math.max(1, Math.round(m));
    const out = new Array(copies);
    for (let i = 0; i < copies; i++) out[i] = _cloneStrand(strands[0]);
    return out;
  }
  const targetTotal = Math.max(N, Math.round(m * N));
  const gaps = N - 1;
  const inserts = targetTotal - N; // total new strands to distribute
  const base = Math.floor(inserts / gaps);
  const remainder = inserts - base * gaps;
  const out = [];
  for (let i = 0; i < gaps; i++) {
    out.push(_cloneStrand(strands[i]));
    let here = base + (i < remainder ? 1 : 0);
    if (here <= 0) continue;
    const a = strands[i];
    const b = strands[i + 1];
    for (let k = 1; k <= here; k++) {
      const t = k / (here + 1);
      out.push(_lerpStrand(a, b, t));
    }
  }
  out.push(_cloneStrand(strands[N - 1]));
  return out;
}

function _cloneStrand(s) {
  return {
    root: { x: s.root.x, y: s.root.y, z: s.root.z },
    normal: { x: s.normal.x, y: s.normal.y, z: s.normal.z },
    points: s.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    length: +s.length || 0,
  };
}

function _lerpStrand(a, b, t) {
  const seg = Math.min(a.points.length, b.points.length);
  const points = new Array(seg);
  for (let i = 0; i < seg; i++) {
    const pa = a.points[i];
    const pb = b.points[i];
    points[i] = {
      x: pa.x * (1 - t) + pb.x * t,
      y: pa.y * (1 - t) + pb.y * t,
      z: pa.z * (1 - t) + pb.z * t,
    };
  }
  return {
    root: {
      x: a.root.x * (1 - t) + b.root.x * t,
      y: a.root.y * (1 - t) + b.root.y * t,
      z: a.root.z * (1 - t) + b.root.z * t,
    },
    normal: {
      x: a.normal.x * (1 - t) + b.normal.x * t,
      y: a.normal.y * (1 - t) + b.normal.y * t,
      z: a.normal.z * (1 - t) + b.normal.z * t,
    },
    points,
    length: ((+a.length || 0) * (1 - t)) + ((+b.length || 0) * t),
  };
}

// Test / extension hatch (matches scatter/poissonSurface.js convention
// — keeps the private CDF + tessellation walkers reachable from tests
// without pulling them into the module's public surface).
export const __internal = {
  _tessellate,
  _areaCDF,
  _pickTriangle,
  _cloneStrand,
  _lerpStrand,
};

export default generateStrands;
