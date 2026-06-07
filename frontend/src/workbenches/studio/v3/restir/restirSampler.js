// ArchDisc Studio V3 — ReSTIR direct-lighting sampler (slice 792).
//
// Builds on slice 684 / 693's CPU + GPU path tracers (`v3/rt/pathtracer.js`,
// `v3/rtgpu/renderer.js`). At each pixel:
//
//   1. INITIAL CANDIDATE GENERATION (Bitterli §5.2):
//      Sample M=8 random light candidates from the scene's emitter/light
//      list using uniform RIS source pdf p(x) = 1/N. For each candidate
//      evaluate the target function p̂(x) = throughput · BRDF · G · L_e
//      (we use the simplified formulation p̂ = unshadowed-radiance) and
//      stream it into a fresh reservoir with weight p̂/p.
//
//   2. VISIBILITY TEST (Bitterli §5.3):
//      Shoot a shadow ray against the scene's triangle soup to the
//      reservoir's chosen sample. If occluded, zero the reservoir's W so
//      it contributes no radiance — but keep M so the unbiased estimator
//      still accounts for the rejected candidate.
//
//   3. TEMPORAL REUSE (Bitterli §5.4):
//      Combine each pixel's previous-frame reservoir into the current
//      reservoir, M-capped to 20× to keep the estimator responsive to
//      lighting changes.
//
//   4. SPATIAL REUSE (Bitterli §5.5):
//      Repeat `spatialPasses` times: for each pixel pull `K=5` random
//      neighbour reservoirs (within a 30-pixel radius) and combine,
//      re-evaluating p̂ at the destination pixel's hit point each time.
//
//   5. SHADE:
//      Final radiance = throughput · BRDF · L_e(y) · W where W is the
//      reservoir's unbiased contribution weight (Bitterli eq. 5).
//
// The sampler is CPU-side and pixel-stride-aware: at stride=4 the
// reservoir grid is `ceil(w/4) × ceil(h/4)` so the storage budget stays
// small (~12 floats × 130k blocks ≈ 6 MB at 1080p). All maths is pure JS
// — no THREE in the hot path beyond `Vector3` usage at scene rebuild.

import * as THREE from 'three';
import {
  createReservoir, resetReservoir,
  streamReservoir, combineReservoirs, finalizeReservoir, capReservoirM,
  createReservoirGrid, resetGrid,
} from './reservoir.js';

const EPS = 1e-6;
const FLOATS_PER_TRI = 21; // mirrors rt/pathtracer.js soup layout
const TEMPORAL_M_CAP = 20; // Bitterli §5.4 default

// ─── Mulberry32 PRNG ─────────────────────────────────────────────────────
function _mulberry(seed) {
  let s = (seed >>> 0) || 0xdeadbeef;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) % 0xffffff) / 0xffffff;
  };
}

// ─── Light table builder ─────────────────────────────────────────────────
//
// Walks the scene picking up: (a) emissive triangles harvested from the
// soup (er+eg+eb > 0), and (b) every DirectionalLight / PointLight /
// SpotLight as a directional/positional "virtual" emitter. Each light
// entry stores enough to evaluate L_e quickly:
//
//   kind:  'tri' | 'dir' | 'point'
//   px,py,pz: position (for 'tri' = centroid; for 'point' = pos;
//              for 'dir' direction is dx/dy/dz instead)
//   nx,ny,nz: surface normal (tri only; zero for point/dir)
//   r,g,b:    radiant intensity
//   triIdx:   parallel index into soup.tris[] for visibility skip
//   area:     surface area in m² (tri only; 1 for non-tri)
//
// We keep the table as parallel typed arrays for cache locality in the
// hot RIS loop.
export function buildLightTable(soup, scene) {
  const lights = {
    count: 0,
    kind: [],
    px: [], py: [], pz: [],
    dx: [], dy: [], dz: [],
    nx: [], ny: [], nz: [],
    r: [], g: [], b: [],
    triIdx: [],
    area: [],
  };
  if (!soup || soup.count === 0 && (!scene || !scene.traverse)) {
    return _packLights(lights);
  }
  // (a) emissive triangles.
  if (soup && soup.tris && soup.count > 0) {
    const tris = soup.tris;
    for (let i = 0; i < soup.count; i++) {
      const o = i * FLOATS_PER_TRI;
      const er = tris[o + 15], eg = tris[o + 16], eb = tris[o + 17];
      if (er + eg + eb <= 0) continue;
      const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
      const bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5];
      const cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8];
      // Centroid + area + (already-normalised) face normal.
      const cxc = (ax + bx + cx) / 3;
      const cyc = (ay + by + cy) / 3;
      const czc = (az + bz + cz) / 3;
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      const crx = e1y * e2z - e1z * e2y;
      const cry = e1z * e2x - e1x * e2z;
      const crz = e1x * e2y - e1y * e2x;
      const area = 0.5 * Math.hypot(crx, cry, crz);
      if (area < EPS) continue;
      lights.kind.push('tri');
      lights.px.push(cxc); lights.py.push(cyc); lights.pz.push(czc);
      lights.dx.push(0);   lights.dy.push(0);   lights.dz.push(0);
      lights.nx.push(tris[o + 9]);
      lights.ny.push(tris[o + 10]);
      lights.nz.push(tris[o + 11]);
      lights.r.push(er); lights.g.push(eg); lights.b.push(eb);
      lights.triIdx.push(i);
      lights.area.push(area);
      lights.count++;
    }
  }
  // (b) scene directional / point lights.
  if (scene && scene.traverse) {
    scene.traverse((o) => {
      if (!o || !o.visible || !(o.intensity > 0)) return;
      if (o.isDirectionalLight) {
        const dir = new THREE.Vector3();
        if (o.target && o.target.isObject3D) {
          dir.subVectors(o.position, o.target.position);
        } else {
          dir.copy(o.position);
        }
        const len = dir.length();
        if (len > EPS) dir.divideScalar(len);
        else { dir.set(0, 1, 0); }
        lights.kind.push('dir');
        lights.px.push(0); lights.py.push(0); lights.pz.push(0);
        lights.dx.push(dir.x); lights.dy.push(dir.y); lights.dz.push(dir.z);
        lights.nx.push(0); lights.ny.push(0); lights.nz.push(0);
        lights.r.push(o.color.r * o.intensity);
        lights.g.push(o.color.g * o.intensity);
        lights.b.push(o.color.b * o.intensity);
        lights.triIdx.push(-1);
        lights.area.push(1);
        lights.count++;
      } else if (o.isPointLight || o.isSpotLight) {
        const wp = new THREE.Vector3();
        o.getWorldPosition(wp);
        lights.kind.push('point');
        lights.px.push(wp.x); lights.py.push(wp.y); lights.pz.push(wp.z);
        lights.dx.push(0); lights.dy.push(0); lights.dz.push(0);
        lights.nx.push(0); lights.ny.push(0); lights.nz.push(0);
        lights.r.push(o.color.r * o.intensity);
        lights.g.push(o.color.g * o.intensity);
        lights.b.push(o.color.b * o.intensity);
        lights.triIdx.push(-1);
        lights.area.push(1);
        lights.count++;
      }
    });
  }
  return _packLights(lights);
}

function _packLights(lights) {
  // Convert parallel JS arrays → typed arrays for the hot path.
  const n = lights.count;
  const out = {
    count: n,
    kind: lights.kind.slice(),
    px: new Float32Array(lights.px),
    py: new Float32Array(lights.py),
    pz: new Float32Array(lights.pz),
    dx: new Float32Array(lights.dx),
    dy: new Float32Array(lights.dy),
    dz: new Float32Array(lights.dz),
    nx: new Float32Array(lights.nx),
    ny: new Float32Array(lights.ny),
    nz: new Float32Array(lights.nz),
    r:  new Float32Array(lights.r),
    g:  new Float32Array(lights.g),
    b:  new Float32Array(lights.b),
    triIdx: new Int32Array(lights.triIdx),
    area: new Float32Array(lights.area),
  };
  return out;
}

// ─── Sample a light: pos, normal, incoming direction at the surface ──────
//
// Returns: { lx,ly,lz, ldx,ldy,ldz, dist, r,g,b, triIdx, geomTerm }
// where (ldx,ldy,ldz) is the unit *from-surface-toward-light* direction
// and geomTerm is the geometric throughput factor (already including
// area pdf for tri / 1/r² for point / 1 for dir).
function _sampleLight(lights, idx, sx, sy, sz, rng) {
  const kind = lights.kind[idx];
  if (kind === 'dir') {
    return {
      ldx: lights.dx[idx], ldy: lights.dy[idx], ldz: lights.dz[idx],
      dist: 1e6,
      r: lights.r[idx], g: lights.g[idx], b: lights.b[idx],
      triIdx: -1,
      geomTerm: 1.0,
      lx: sx + lights.dx[idx] * 1e6,
      ly: sy + lights.dy[idx] * 1e6,
      lz: sz + lights.dz[idx] * 1e6,
    };
  }
  if (kind === 'point') {
    let dx = lights.px[idx] - sx;
    let dy = lights.py[idx] - sy;
    let dz = lights.pz[idx] - sz;
    const d2 = dx * dx + dy * dy + dz * dz;
    const d = Math.sqrt(Math.max(d2, EPS));
    dx /= d; dy /= d; dz /= d;
    return {
      ldx: dx, ldy: dy, ldz: dz,
      dist: d,
      r: lights.r[idx], g: lights.g[idx], b: lights.b[idx],
      triIdx: -1,
      geomTerm: 1 / Math.max(d2, EPS),
      lx: lights.px[idx], ly: lights.py[idx], lz: lights.pz[idx],
    };
  }
  // 'tri' — area light. Sample a random point on the triangle (we don't
  // have the original verts in the light table; using centroid is fine
  // for the target function — Bitterli §5.2 explicitly allows this
  // approximation since RIS corrects it).
  const px = lights.px[idx], py = lights.py[idx], pz = lights.pz[idx];
  let dx = px - sx, dy = py - sy, dz = pz - sz;
  const d2 = dx * dx + dy * dy + dz * dz;
  const d = Math.sqrt(Math.max(d2, EPS));
  dx /= d; dy /= d; dz /= d;
  const lnx = lights.nx[idx], lny = lights.ny[idx], lnz = lights.nz[idx];
  // cosθ_light at the emitter — geometric throughput.
  let cosL = -(dx * lnx + dy * lny + dz * lnz);
  if (cosL < 0) cosL = -cosL;
  const geomTerm = (cosL * lights.area[idx]) / Math.max(d2, EPS);
  void rng;
  return {
    ldx: dx, ldy: dy, ldz: dz,
    dist: d,
    r: lights.r[idx], g: lights.g[idx], b: lights.b[idx],
    triIdx: lights.triIdx[idx],
    geomTerm,
    lx: px, ly: py, lz: pz,
  };
}

// ─── Target function p̂(x) ────────────────────────────────────────────────
//
// Bitterli §5.2: p̂(x) = throughput · BRDF · G · L_e. We use the
// unshadowed-direct-illumination form so it can be cheaply evaluated
// during reservoir combine without shooting a shadow ray (we cast the
// shadow ray once at the end of step 2, per the paper). Result is a
// scalar — the luminance of the candidate's unshadowed contribution.
function _pHatLuminance(_state, sampled, nx, ny, nz) {
  if (!sampled) return 0;
  const cosN = sampled.ldx * nx + sampled.ldy * ny + sampled.ldz * nz;
  if (cosN <= 0) return 0;
  // Lambertian diffuse — albedo factored out (constant per pixel anyway,
  // cancels in W). Scalar luminance ≈ 0.299 R + 0.587 G + 0.114 B.
  const Lr = sampled.r * sampled.geomTerm * cosN;
  const Lg = sampled.g * sampled.geomTerm * cosN;
  const Lb = sampled.b * sampled.geomTerm * cosN;
  return 0.299 * Lr + 0.587 * Lg + 0.114 * Lb;
}

// ─── Ray vs soup (Möller-Trumbore — visibility shadow ray) ───────────────
function _shadowOccluded(soup, ox, oy, oz, dx, dy, dz, maxT, skipTri) {
  const tris = soup.tris;
  const count = soup.count;
  for (let i = 0; i < count; i++) {
    if (i === skipTri) continue;
    const o = i * FLOATS_PER_TRI;
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
    const bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5];
    const cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const pvx = dy * e2z - dz * e2y;
    const pvy = dz * e2x - dx * e2z;
    const pvz = dx * e2y - dy * e2x;
    const det = e1x * pvx + e1y * pvy + e1z * pvz;
    if (det > -EPS && det < EPS) continue;
    const invDet = 1 / det;
    const tvx = ox - ax, tvy = oy - ay, tvz = oz - az;
    const u = (tvx * pvx + tvy * pvy + tvz * pvz) * invDet;
    if (u < 0 || u > 1) continue;
    const qvx = tvy * e1z - tvz * e1y;
    const qvy = tvz * e1x - tvx * e1z;
    const qvz = tvx * e1y - tvy * e1x;
    const v = (dx * qvx + dy * qvy + dz * qvz) * invDet;
    if (v < 0 || u + v > 1) continue;
    const tHit = (e2x * qvx + e2y * qvy + e2z * qvz) * invDet;
    if (tHit > 1e-3 && tHit < maxT - 1e-3) return true;
  }
  return false;
}

// ─── Primary ray cast — returns first hit + surface frame ────────────────
function _primaryHit(soup, ox, oy, oz, dx, dy, dz) {
  const tris = soup.tris;
  const count = soup.count;
  let nearestT = 1e6;
  let hitIdx = -1;
  for (let i = 0; i < count; i++) {
    const o = i * FLOATS_PER_TRI;
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
    const bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5];
    const cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const pvx = dy * e2z - dz * e2y;
    const pvy = dz * e2x - dx * e2z;
    const pvz = dx * e2y - dy * e2x;
    const det = e1x * pvx + e1y * pvy + e1z * pvz;
    if (det > -EPS && det < EPS) continue;
    const invDet = 1 / det;
    const tvx = ox - ax, tvy = oy - ay, tvz = oz - az;
    const u = (tvx * pvx + tvy * pvy + tvz * pvz) * invDet;
    if (u < 0 || u > 1) continue;
    const qvx = tvy * e1z - tvz * e1y;
    const qvy = tvz * e1x - tvx * e1z;
    const qvz = tvx * e1y - tvy * e1x;
    const v = (dx * qvx + dy * qvy + dz * qvz) * invDet;
    if (v < 0 || u + v > 1) continue;
    const tHit = (e2x * qvx + e2y * qvy + e2z * qvz) * invDet;
    if (tHit > EPS && tHit < nearestT) {
      nearestT = tHit;
      hitIdx = i;
    }
  }
  if (hitIdx < 0) return null;
  const o = hitIdx * FLOATS_PER_TRI;
  let nx = tris[o + 9], ny = tris[o + 10], nz = tris[o + 11];
  // Flip normal toward incoming ray.
  if (dx * nx + dy * ny + dz * nz > 0) { nx = -nx; ny = -ny; nz = -nz; }
  return {
    t: nearestT,
    triIdx: hitIdx,
    hx: ox + dx * nearestT,
    hy: oy + dy * nearestT,
    hz: oz + dz * nearestT,
    nx, ny, nz,
    albedoR: tris[o + 12], albedoG: tris[o + 13], albedoB: tris[o + 14],
    emR: tris[o + 15], emG: tris[o + 16], emB: tris[o + 17],
  };
}

// ─── Camera unproject helper ─────────────────────────────────────────────
function _cameraRay(cm, halfW, halfH, ndx, ndy) {
  const rx = cm[0],  ry = cm[1],  rz = cm[2];
  const ux = cm[4],  uy = cm[5],  uz = cm[6];
  const fx = -cm[8], fy = -cm[9], fz = -cm[10];
  const cx = cm[12], cy = cm[13], cz = cm[14];
  const wx = ndx * halfW, wy = ndy * halfH;
  let dx = fx + rx * wx + ux * wy;
  let dy = fy + ry * wx + uy * wy;
  let dz = fz + rz * wx + uz * wy;
  const l = Math.hypot(dx, dy, dz);
  if (l < EPS) return null;
  dx /= l; dy /= l; dz /= l;
  return { ox: cx, oy: cy, oz: cz, dx, dy, dz };
}

// ─── Per-pixel ReSTIR core ───────────────────────────────────────────────
//
// Runs steps 1-2 (initial candidate generation + visibility) for one
// pixel. Used both during sample() and during spatial combine (where the
// target-pdf must be re-evaluated at the destination pixel's hit point).
function _initialCandidates(state, hit, M, rng, reservoir) {
  resetReservoir(reservoir);
  const lights = state.lights;
  if (!lights || lights.count === 0) return reservoir;
  const N = lights.count;
  const invSrcPdf = N; // p(x) = 1/N, weight = p̂/p
  for (let i = 0; i < M; i++) {
    const idx = Math.min(N - 1, (rng() * N) | 0);
    const sampled = _sampleLight(lights, idx, hit.hx, hit.hy, hit.hz, rng);
    const pHat = _pHatLuminance(state, sampled, hit.nx, hit.ny, hit.nz);
    const w = pHat * invSrcPdf;
    streamReservoir(reservoir, { lightIdx: idx, sampled }, w, pHat, rng);
  }
  return reservoir;
}

function _visibilityTest(state, reservoir, hit) {
  if (!reservoir.y || !state.soup) return;
  const s = reservoir.y.sampled;
  // Shoot the shadow ray from hit point toward the sampled light.
  const ox = hit.hx + hit.nx * 1e-3;
  const oy = hit.hy + hit.ny * 1e-3;
  const oz = hit.hz + hit.nz * 1e-3;
  const occluded = _shadowOccluded(
    state.soup, ox, oy, oz,
    s.ldx, s.ldy, s.ldz,
    Math.min(s.dist, 1e6),
    s.triIdx, // skip the light triangle itself
  );
  if (occluded) {
    // Bitterli §5.3 — keep M but null wSum so W collapses to 0.
    reservoir.wSum = 0;
    reservoir.pHat = 0;
  }
}

// ─── Per-pixel sample → grid (one frame's worth) ─────────────────────────
//
// Steps 1-2 for every pixel in the grid, fills currentGrid with
// post-visibility reservoirs ready for temporal + spatial reuse.
function _generateInitialGrid(state, hitGrid, M, rng) {
  const grid = state.currentGrid;
  resetGrid(grid);
  const tmpRes = createReservoir();
  for (let i = 0; i < grid.count; i++) {
    const hit = hitGrid[i];
    if (!hit) continue;
    _initialCandidates(state, hit, M, rng, tmpRes);
    _visibilityTest(state, tmpRes, hit);
    finalizeReservoir(tmpRes);
    // Write to grid.
    grid.yIdx[i] = tmpRes.y ? tmpRes.y.lightIdx : -1;
    grid.wSum[i] = tmpRes.wSum;
    grid.M[i] = tmpRes.M;
    grid.W[i] = tmpRes.W;
    grid.pHat[i] = tmpRes.pHat;
  }
}

// ─── Temporal reuse: prev frame → current ────────────────────────────────
function _temporalReuse(state, hitGrid, rng) {
  const cur = state.currentGrid;
  const prev = state.prevGrid;
  if (!prev || prev.count !== cur.count) return;
  const tmp = createReservoir();
  const lights = state.lights;
  for (let i = 0; i < cur.count; i++) {
    const hit = hitGrid[i];
    if (!hit) continue;
    if (cur.yIdx[i] < 0 && prev.yIdx[i] < 0) continue;
    // Re-hydrate current reservoir.
    tmp.y = (cur.yIdx[i] >= 0) ? {
      lightIdx: cur.yIdx[i],
      sampled: _sampleLight(lights, cur.yIdx[i], hit.hx, hit.hy, hit.hz, rng),
    } : null;
    tmp.wSum = cur.wSum[i]; tmp.M = cur.M[i]; tmp.W = cur.W[i]; tmp.pHat = cur.pHat[i];
    // Combine prev into tmp.
    if (prev.yIdx[i] >= 0) {
      const prevSampled = _sampleLight(lights, prev.yIdx[i], hit.hx, hit.hy, hit.hz, rng);
      const prevRes = {
        y: { lightIdx: prev.yIdx[i], sampled: prevSampled },
        wSum: prev.wSum[i], M: prev.M[i], W: prev.W[i], pHat: prev.pHat[i],
      };
      // Cap prev's M before combine so a stale reservoir can't dominate.
      capReservoirM(prevRes, TEMPORAL_M_CAP);
      combineReservoirs(tmp, prevRes,
        (y) => _pHatLuminance(state, y.sampled, hit.nx, hit.ny, hit.nz),
        rng);
    }
    finalizeReservoir(tmp);
    cur.yIdx[i] = tmp.y ? tmp.y.lightIdx : -1;
    cur.wSum[i] = tmp.wSum;
    cur.M[i] = tmp.M;
    cur.W[i] = tmp.W;
    cur.pHat[i] = tmp.pHat;
  }
}

// ─── Spatial reuse: pull K neighbours per pixel ──────────────────────────
function _spatialReuse(state, hitGrid, rng, passes, K, radius) {
  const cur = state.currentGrid;
  const src = createReservoirGrid(cur.width, cur.height);
  const tmp = createReservoir();
  const lights = state.lights;
  for (let pass = 0; pass < passes; pass++) {
    // Snapshot the current grid into src so reads are stable while we write
    // the destination grid in place.
    src.yIdx.set(cur.yIdx);
    src.wSum.set(cur.wSum);
    src.M.set(cur.M);
    src.W.set(cur.W);
    src.pHat.set(cur.pHat);
    for (let py = 0; py < cur.height; py++) {
      for (let px = 0; px < cur.width; px++) {
        const i = py * cur.width + px;
        const hit = hitGrid[i];
        if (!hit) continue;
        // Re-hydrate current pixel into tmp.
        tmp.y = (src.yIdx[i] >= 0) ? {
          lightIdx: src.yIdx[i],
          sampled: _sampleLight(lights, src.yIdx[i], hit.hx, hit.hy, hit.hz, rng),
        } : null;
        tmp.wSum = src.wSum[i]; tmp.M = src.M[i];
        tmp.W = src.W[i]; tmp.pHat = src.pHat[i];
        // Pull K neighbours.
        for (let k = 0; k < K; k++) {
          // Uniform disk sample.
          const theta = 2 * Math.PI * rng();
          const rad = Math.sqrt(rng()) * radius;
          const nx = Math.max(0, Math.min(cur.width - 1, (px + Math.cos(theta) * rad) | 0));
          const ny = Math.max(0, Math.min(cur.height - 1, (py + Math.sin(theta) * rad) | 0));
          if (nx === px && ny === py) continue;
          const ni = ny * cur.width + nx;
          const nHit = hitGrid[ni];
          if (!nHit) continue;
          if (src.yIdx[ni] < 0) continue;
          // Normal similarity gate — Bitterli §5.5 anti-bias heuristic.
          const cosN = nHit.nx * hit.nx + nHit.ny * hit.ny + nHit.nz * hit.nz;
          if (cosN < 0.9) continue;
          // Depth similarity gate.
          const dz = Math.abs(nHit.t - hit.t);
          if (dz > 0.1 * Math.max(0.1, hit.t)) continue;
          const nSampled = _sampleLight(lights, src.yIdx[ni], hit.hx, hit.hy, hit.hz, rng);
          const nRes = {
            y: { lightIdx: src.yIdx[ni], sampled: nSampled },
            wSum: src.wSum[ni], M: src.M[ni], W: src.W[ni], pHat: src.pHat[ni],
          };
          combineReservoirs(tmp, nRes,
            (y) => _pHatLuminance(state, y.sampled, hit.nx, hit.ny, hit.nz),
            rng);
        }
        finalizeReservoir(tmp);
        cur.yIdx[i] = tmp.y ? tmp.y.lightIdx : -1;
        cur.wSum[i] = tmp.wSum;
        cur.M[i] = tmp.M;
        cur.W[i] = tmp.W;
        cur.pHat[i] = tmp.pHat;
      }
    }
  }
}

// ─── Shade the final image using the reservoir grid ──────────────────────
function _shadeGrid(state, hitGrid, outRgb) {
  const cur = state.currentGrid;
  const lights = state.lights;
  for (let i = 0; i < cur.count; i++) {
    const hit = hitGrid[i];
    const o = i * 3;
    if (!hit) {
      outRgb[o] = 0; outRgb[o + 1] = 0; outRgb[o + 2] = 0;
      continue;
    }
    // Sky background for misses already handled (hit==null) — here the
    // emissive contribution is the hit's own emission.
    let r = hit.emR, g = hit.emG, b = hit.emB;
    if (cur.yIdx[i] >= 0 && cur.W[i] > 0) {
      const sampled = _sampleLight(lights, cur.yIdx[i], hit.hx, hit.hy, hit.hz, state.rng);
      const cosN = sampled.ldx * hit.nx + sampled.ldy * hit.ny + sampled.ldz * hit.nz;
      if (cosN > 0) {
        const W = cur.W[i];
        r += hit.albedoR * sampled.r * sampled.geomTerm * cosN * W;
        g += hit.albedoG * sampled.g * sampled.geomTerm * cosN * W;
        b += hit.albedoB * sampled.b * sampled.geomTerm * cosN * W;
      }
    }
    outRgb[o] = r;
    outRgb[o + 1] = g;
    outRgb[o + 2] = b;
  }
}

// ─── Public render entry point ───────────────────────────────────────────
//
// renderReSTIR(state, opts) — produces a Float32Array RGB image at the
// configured `width × height`. Steps:
//   • Cast a primary ray per pixel (build hit grid).
//   • Initial candidate gen + visibility (steps 1-2).
//   • Temporal reuse (step 3).
//   • Spatial reuse × N passes (step 4).
//   • Shade (step 5).
// Returns { rgb, width, height, stats }.
export function renderReSTIR(state, opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const width = Math.max(1, Math.min(2048, o.width | 0 || state.width || 256));
  const height = Math.max(1, Math.min(2048, o.height | 0 || state.height || 256));
  const samples = Math.max(1, Math.min(64, o.samples | 0 || 1));
  const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  if (!state.soup || state.soup.count === 0) {
    return {
      ok: false, error: 'no scene soup',
      rgb: new Float32Array(width * height * 3),
      width, height,
    };
  }
  if (!state.camera) {
    return {
      ok: false, error: 'no camera',
      rgb: new Float32Array(width * height * 3),
      width, height,
    };
  }
  // Resize the reservoir grid if needed.
  if (!state.currentGrid || state.currentGrid.width !== width || state.currentGrid.height !== height) {
    state.currentGrid = createReservoirGrid(width, height);
    state.prevGrid = null;
  }
  // Build hit grid (one primary ray per pixel, jittered).
  const hitGrid = new Array(width * height);
  state.camera.updateMatrixWorld(true);
  const cm = state.camera.matrixWorld.elements;
  const fov = (state.camera.fov || 50) * Math.PI / 180;
  const aspect = state.camera.aspect || (width / height);
  const halfH = Math.tan(fov * 0.5);
  const halfW = halfH * aspect;
  const rng = state.rng;
  let hitCount = 0;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const ndx = ((px + 0.5) / width) * 2 - 1;
      const ndy = 1 - ((py + 0.5) / height) * 2;
      const ray = _cameraRay(cm, halfW, halfH, ndx, ndy);
      if (!ray) { hitGrid[py * width + px] = null; continue; }
      const h = _primaryHit(state.soup, ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz);
      hitGrid[py * width + px] = h;
      if (h) hitCount++;
    }
  }
  // Accumulate `samples` ReSTIR passes (each is one full step-1→step-5).
  const out = new Float32Array(width * height * 3);
  const tmp = new Float32Array(width * height * 3);
  for (let s = 0; s < samples; s++) {
    _generateInitialGrid(state, hitGrid, state.M, rng);
    _temporalReuse(state, hitGrid, rng);
    _spatialReuse(state, hitGrid, rng, state.spatialPasses, 5, 30);
    _shadeGrid(state, hitGrid, tmp);
    for (let i = 0; i < tmp.length; i++) out[i] += tmp[i];
    // Roll current→prev for the next temporal frame.
    if (!state.prevGrid || state.prevGrid.count !== state.currentGrid.count) {
      state.prevGrid = createReservoirGrid(width, height);
    }
    state.prevGrid.yIdx.set(state.currentGrid.yIdx);
    state.prevGrid.wSum.set(state.currentGrid.wSum);
    state.prevGrid.M.set(state.currentGrid.M);
    state.prevGrid.W.set(state.currentGrid.W);
    state.prevGrid.pHat.set(state.currentGrid.pHat);
  }
  // Divide by sample count for the running mean.
  if (samples > 1) {
    const inv = 1 / samples;
    for (let i = 0; i < out.length; i++) out[i] *= inv;
  }
  const elapsed = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0;
  state.lastRenderMs = elapsed;
  state.lastSamples = samples;
  state.lastWidth = width;
  state.lastHeight = height;
  state.lastHitCount = hitCount;
  return {
    ok: true,
    rgb: out,
    width, height, samples,
    stats: {
      hitCount, hitCoverage: hitCount / (width * height),
      lights: state.lights ? state.lights.count : 0,
      M: state.M,
      spatialPasses: state.spatialPasses,
      elapsedMs: elapsed,
    },
  };
}

// ─── State factory ───────────────────────────────────────────────────────
export function createSamplerState() {
  return {
    enabled: false,
    M: 8,
    spatialPasses: 2,
    width: 256,
    height: 256,
    soup: null,
    camera: null,
    lights: null,
    rng: _mulberry((Date.now() & 0x7fffffff) >>> 0),
    currentGrid: null,
    prevGrid: null,
    lastRenderMs: 0,
    lastSamples: 0,
    lastWidth: 0,
    lastHeight: 0,
    lastHitCount: 0,
  };
}

export function rebuildFromScene(state, scene, soup) {
  state.soup = soup;
  state.lights = buildLightTable(soup, scene);
  // Lighting changed — drop any temporal history so the M-cap doesn't
  // lock us to stale luminance.
  state.prevGrid = null;
  return state.lights.count;
}

export const __internals__ = {
  TEMPORAL_M_CAP,
  _sampleLight, _pHatLuminance, _shadowOccluded,
  _initialCandidates, _visibilityTest,
  _generateInitialGrid, _temporalReuse, _spatialReuse, _shadeGrid,
  _primaryHit, _cameraRay, _mulberry,
};

export default {
  createSamplerState,
  rebuildFromScene,
  renderReSTIR,
  buildLightTable,
};
