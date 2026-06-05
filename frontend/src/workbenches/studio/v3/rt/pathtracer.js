// ArchDisc Studio V3 — CPU progressive path tracer.
//
// Pure-JS (no WASM, no extra deps) two-bounce diffuse path tracer that
// runs as a per-frame ray batch inside the viewport's animate tick. The
// hot path is a triangle-soup ray cast: every renderable mesh in the
// scene is rasterised at install/refresh time into a flat
// Float32Array of triangle vertices + parallel material albedo array,
// then each frame we shoot N rays through randomised pixels and trace
// up to 2 bounces against the soup using Möller–Trumbore intersection.
//
// Performance budget: ~10 ms of CPU work per frame, controlled by a
// running ray counter that breaks the batch loop the moment the
// accumulated wall-clock cost exceeds the budget. At quarter-resolution
// (pixelStride=4, the default) a 1080p viewport has ~130k blocks; one
// frame typically writes 1-2k samples, and the image converges
// progressively over a couple of seconds while the user is idle.
//
// Materials: we read `material.color` (or material[0].color for
// multi-material meshes) as the diffuse albedo. Emissive contribution
// is approximated by `material.emissive * material.emissiveIntensity`
// when present so emissive area lights "just work".
//
// Lighting: a single hemispherical environment ("sky=cool, ground=warm")
// is sampled at the second bounce, plus the actual scene's first found
// DirectionalLight is added as an explicit shadow-rayed sun term. This
// avoids relying on the renderer's PMREM environment (which lives on the
// GPU) while still giving an image that reads as "real lighting".

import * as THREE from 'three';
import { recordSample, resetBuffer } from './buffer.js';

const EPS = 1e-6;

// Per-mesh ignore predicate: skip helpers / gizmos / grids / sky / selection
// outlines so the tracer never wastes rays on UI chrome.
function _isTraceableMesh(obj) {
  if (!obj || !obj.isMesh) return false;
  if (obj.userData) {
    if (obj.userData.isHelper) return false;
    if (obj.userData.archdiscStudioHelper) return false;
    if (obj.userData.archdiscStudioGizmo) return false;
    if (obj.userData.pickable === false && !obj.userData.archdiscStudioPrimitive) return false;
  }
  const nm = (obj.name || '').toLowerCase();
  if (nm.startsWith('__')) return false; // __selection_outline__, __grid__, etc.
  if (nm.includes('helper')) return false;
  if (nm.includes('gizmo')) return false;
  if (nm.includes('grid')) return false;
  if (obj.material && obj.material.wireframe) return false;
  // Skip TransformControls, AxesHelper, GridHelper, SkeletonHelper subtrees:
  let p = obj.parent;
  while (p) {
    if (p.isTransformControls) return false;
    if (p.userData && (p.userData.isHelper || p.userData.archdiscStudioHelper)) return false;
    p = p.parent;
  }
  return true;
}

function _albedoOf(material) {
  const m = Array.isArray(material) ? material[0] : material;
  if (!m) return { r: 0.7, g: 0.7, b: 0.7, er: 0, eg: 0, eb: 0 };
  const c = m.color || { r: 0.7, g: 0.7, b: 0.7 };
  const e = m.emissive || null;
  const ei = (typeof m.emissiveIntensity === 'number') ? m.emissiveIntensity : 1.0;
  return {
    r: c.r != null ? c.r : 0.7,
    g: c.g != null ? c.g : 0.7,
    b: c.b != null ? c.b : 0.7,
    er: e ? e.r * ei : 0,
    eg: e ? e.g * ei : 0,
    eb: e ? e.b * ei : 0,
  };
}

// Slice 689 — Sample the active material's `.map` (CanvasTexture from
// slice-684 shader graph bake, slice-642 procedural textures, slice-688
// matlib presets) at a given UV; returns null if no sampleable texture.
// Result is multiplied into the per-tri albedo at soup-build time so
// shader graphs visibly influence the rendered image without needing
// per-hit UV interpolation (a fuller pass for the next iteration).
function _sampleMaterialTextureAtUV(material, u, v) {
  const m = Array.isArray(material) ? material[0] : material;
  if (!m || !m.map) return null;
  const tex = m.map;
  const img = tex.image;
  if (!img || !img.width || !img.height) return null;
  // Wrap UV [0,1) then transform via tex.offset/repeat if set.
  let uu = u, vv = v;
  if (tex.offset) { uu = uu + tex.offset.x; vv = vv + tex.offset.y; }
  if (tex.repeat) { uu *= tex.repeat.x; vv *= tex.repeat.y; }
  uu = ((uu % 1) + 1) % 1;
  vv = ((vv % 1) + 1) % 1;
  // CanvasTexture (preferred) and HTMLImageElement both render to a
  // throwaway canvas to extract a 1×1 pixel via getImageData.
  try {
    let canvas;
    if (img instanceof HTMLCanvasElement) {
      canvas = img;
    } else if (img instanceof HTMLImageElement || (img.tagName === 'IMG' && img.complete)) {
      canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
    } else {
      return null;
    }
    const px = Math.max(0, Math.min(canvas.width - 1, Math.floor(uu * canvas.width)));
    const py = Math.max(0, Math.min(canvas.height - 1, Math.floor((1 - vv) * canvas.height)));
    const data = canvas.getContext('2d').getImageData(px, py, 1, 1).data;
    return { r: data[0] / 255, g: data[1] / 255, b: data[2] / 255 };
  } catch (_) {
    return null;
  }
}

// ── Triangle soup builder ────────────────────────────────────────────────
//
// soup layout (per triangle, 21 floats):
//   [ax ay az  bx by bz  cx cy cz  nx ny nz   r g b  er eg eb  meshId pad pad]
// where (r,g,b) is diffuse albedo, (er,eg,eb) is emissive contribution,
// (nx,ny,nz) is the (constant per tri) face normal, and meshId indexes a
// parallel array of mesh references (unused by the hot path but useful
// for future shadow-ray "ignore source" logic).
const FLOATS_PER_TRI = 21;

export function buildSoup(scene) {
  const meshes = [];
  const tris = [];
  if (!scene || !scene.traverse) return { tris: new Float32Array(0), count: 0, meshes };
  const tmpV = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const nrm = new THREE.Vector3();

  scene.traverse((obj) => {
    if (!_isTraceableMesh(obj)) return;
    if (!obj.geometry || !obj.geometry.attributes || !obj.geometry.attributes.position) return;
    const meshId = meshes.length;
    meshes.push(obj);
    const baseAlbedo = _albedoOf(obj.material);
    obj.updateWorldMatrix(true, false);
    const mat = obj.matrixWorld;
    const pos = obj.geometry.attributes.position;
    const uv = obj.geometry.attributes.uv;
    const idx = obj.geometry.index;
    const triCount = idx ? (idx.count / 3) : (pos.count / 3);
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3 + 0) : (t * 3 + 0);
      const i1 = idx ? idx.getX(t * 3 + 1) : (t * 3 + 1);
      const i2 = idx ? idx.getX(t * 3 + 2) : (t * 3 + 2);
      a.fromBufferAttribute(pos, i0).applyMatrix4(mat);
      b.fromBufferAttribute(pos, i1).applyMatrix4(mat);
      c.fromBufferAttribute(pos, i2).applyMatrix4(mat);
      edge1.subVectors(b, a);
      edge2.subVectors(c, a);
      nrm.crossVectors(edge1, edge2);
      const area2 = nrm.length();
      if (area2 < EPS) continue;
      nrm.divideScalar(area2);
      // Slice 689 — Tint the per-tri albedo with a sample of the active
      // material's texture (if any) at this tri's centroid UV.
      let albedo = baseAlbedo;
      if (uv) {
        const ux = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3;
        const uy = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3;
        const tex = _sampleMaterialTextureAtUV(obj.material, ux, uy);
        if (tex) {
          albedo = {
            r: baseAlbedo.r * tex.r,
            g: baseAlbedo.g * tex.g,
            b: baseAlbedo.b * tex.b,
            er: baseAlbedo.er, eg: baseAlbedo.eg, eb: baseAlbedo.eb,
          };
        }
      }
      tris.push(
        a.x, a.y, a.z,
        b.x, b.y, b.z,
        c.x, c.y, c.z,
        nrm.x, nrm.y, nrm.z,
        albedo.r, albedo.g, albedo.b,
        albedo.er, albedo.eg, albedo.eb,
        meshId, 0, 0,
      );
    }
    // Suppress unused warning from tmpV — used only when we extend to
    // smooth-normal sampling in a future revision.
    void tmpV;
  });

  return {
    tris: new Float32Array(tris),
    count: tris.length / FLOATS_PER_TRI,
    meshes,
  };
}

// ── Hot path: ray vs soup (Möller–Trumbore) ──────────────────────────────
//
// Single triangle test, inlined into intersectSoup below for performance.
// Returns the nearest hit's t plus the triangle index, or -1 if miss.
function _intersectSoup(soup, ox, oy, oz, dx, dy, dz, tMin, tMax, skipTri) {
  const tris = soup.tris;
  const count = soup.count;
  let nearestT = tMax;
  let hitIdx = -1;
  for (let i = 0; i < count; i++) {
    if (i === skipTri) continue;
    const o = i * FLOATS_PER_TRI;
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
    const bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5];
    const cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8];
    // edge1 = b - a
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    // edge2 = c - a
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    // pvec = dir × edge2
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
    if (tHit > tMin && tHit < nearestT) {
      nearestT = tHit;
      hitIdx = i;
    }
  }
  return { t: nearestT, idx: hitIdx };
}

// Environment radiance: gradient between zenith ("sky", cool blue) and
// horizon/ground ("warm earth"), driven by ray.y. Cheap, deterministic,
// independent of the scene's PMREM (which lives on the GPU).
function _sampleEnv(dx, dy, dz) {
  // y=1 → full sky; y=-1 → ground; y=0 → horizon mix.
  const t = 0.5 * (dy + 1);
  const sky = { r: 0.55, g: 0.72, b: 1.0 };   // cool sky
  const grd = { r: 0.85, g: 0.75, b: 0.60 };  // warm ground bounce
  const r = sky.r * t + grd.r * (1 - t);
  const g = sky.g * t + grd.g * (1 - t);
  const b = sky.b * t + grd.b * (1 - t);
  void dx; void dz;
  return { r: r * 1.1, g: g * 1.1, b: b * 1.05 }; // gentle boost
}

// Cosine-weighted hemisphere sample around a normal — branchless basis.
function _cosineSample(nx, ny, nz, rng) {
  const r1 = rng();
  const r2 = rng();
  const phi = 2 * Math.PI * r1;
  const cosT = Math.sqrt(1 - r2);
  const sinT = Math.sqrt(r2);
  const lx = Math.cos(phi) * sinT;
  const ly = Math.sin(phi) * sinT;
  const lz = cosT;
  // Build an orthonormal basis around n. Pick the smallest-magnitude axis
  // to avoid degenerate cross product when n is near a cardinal axis.
  const absX = Math.abs(nx), absY = Math.abs(ny), absZ = Math.abs(nz);
  let ax, ay, az;
  if (absX <= absY && absX <= absZ) { ax = 1; ay = 0; az = 0; }
  else if (absY <= absZ)            { ax = 0; ay = 1; az = 0; }
  else                              { ax = 0; ay = 0; az = 1; }
  // tangent = normalize(cross(n, a))
  let tx = ny * az - nz * ay;
  let ty = nz * ax - nx * az;
  let tz = nx * ay - ny * ax;
  const tLen = Math.hypot(tx, ty, tz);
  if (tLen < EPS) return { x: nx, y: ny, z: nz };
  tx /= tLen; ty /= tLen; tz /= tLen;
  // bitangent = cross(n, tangent)
  const bx = ny * tz - nz * ty;
  const by = nz * tx - nx * tz;
  const bz = nx * ty - ny * tx;
  return {
    x: tx * lx + bx * ly + nx * lz,
    y: ty * lx + by * ly + ny * lz,
    z: tz * lx + bz * ly + nz * lz,
  };
}

// Mulberry32 PRNG — small, fast, deterministic, dependency-free. Used
// per-frame so accumulation jitter is reproducible in tests.
function _mulberry(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) % 0xffffff) / 0xffffff;
  };
}

// Find the first DirectionalLight in the scene (if any). Used as an
// explicit "sun" sample on the first bounce so contact shadows show up
// even with few samples.
function _findSun(scene) {
  if (!scene || !scene.traverse) return null;
  let sun = null;
  scene.traverse((o) => {
    if (sun) return;
    if (o.isDirectionalLight && o.visible !== false && (o.intensity || 0) > 0) sun = o;
  });
  if (!sun) return null;
  // Direction FROM lit point TO the sun. three.js's DirectionalLight
  // shines along (target - position), so the "toward sun" vector from
  // any point is the negative of that.
  const dir = new THREE.Vector3();
  if (sun.target && sun.target.isObject3D) {
    dir.subVectors(sun.position, sun.target.position).normalize();
  } else {
    dir.copy(sun.position).normalize();
  }
  return {
    dx: dir.x, dy: dir.y, dz: dir.z,
    r: sun.color.r * sun.intensity,
    g: sun.color.g * sun.intensity,
    b: sun.color.b * sun.intensity,
  };
}

// ── Trace one ray ────────────────────────────────────────────────────────
//
// Returns radiance {r,g,b}. Walks up to `maxBounces` diffuse bounces and
// adds environment + sun contributions at each scatter event. No Russian
// roulette — we cap bounces hard at 2 (configurable) so the worst case
// per-ray cost stays bounded.
function _traceRay(soup, sun, ox, oy, oz, dx, dy, dz, rng, maxBounces) {
  let accR = 0, accG = 0, accB = 0;
  let throughR = 1, throughG = 1, throughB = 1;
  let skip = -1;
  for (let b = 0; b <= maxBounces; b++) {
    const hit = _intersectSoup(soup, ox, oy, oz, dx, dy, dz, 1e-4, 1e6, skip);
    if (hit.idx < 0) {
      // Sky / env miss → add environment, terminate.
      const env = _sampleEnv(dx, dy, dz);
      accR += throughR * env.r;
      accG += throughG * env.g;
      accB += throughB * env.b;
      break;
    }
    const o = hit.idx * FLOATS_PER_TRI;
    const nx = soup.tris[o + 9], ny = soup.tris[o + 10], nz = soup.tris[o + 11];
    const ar = soup.tris[o + 12], ag = soup.tris[o + 13], ab = soup.tris[o + 14];
    const er = soup.tris[o + 15], eg = soup.tris[o + 16], eb = soup.tris[o + 17];
    // Flip normal toward the incoming ray so back faces still shade.
    let nnx = nx, nny = ny, nnz = nz;
    if (dx * nx + dy * ny + dz * nz > 0) { nnx = -nx; nny = -ny; nnz = -nz; }
    // Emissive contribution at hit point.
    accR += throughR * er;
    accG += throughG * eg;
    accB += throughB * eb;
    // Explicit sun shadow ray (only on first bounce — cheaper and visually
    // most impactful for contact shadows).
    if (sun && b === 0) {
      const sdot = nnx * sun.dx + nny * sun.dy + nnz * sun.dz;
      if (sdot > 0) {
        const hx = ox + dx * hit.t;
        const hy = oy + dy * hit.t;
        const hz = oz + dz * hit.t;
        const shadowHit = _intersectSoup(
          soup,
          hx + nnx * 1e-3, hy + nny * 1e-3, hz + nnz * 1e-3,
          sun.dx, sun.dy, sun.dz,
          1e-4, 1e6, hit.idx,
        );
        if (shadowHit.idx < 0) {
          accR += throughR * ar * sun.r * sdot;
          accG += throughG * ag * sun.g * sdot;
          accB += throughB * ab * sun.b * sdot;
        }
      }
    }
    // Diffuse bounce — cosine-weighted hemisphere sample.
    if (b >= maxBounces) break;
    const hx = ox + dx * hit.t;
    const hy = oy + dy * hit.t;
    const hz = oz + dz * hit.t;
    const d = _cosineSample(nnx, nny, nnz, rng);
    ox = hx + nnx * 1e-4;
    oy = hy + nny * 1e-4;
    oz = hz + nnz * 1e-4;
    dx = d.x; dy = d.y; dz = d.z;
    // Throughput multiplied by albedo (cosine weight is baked into the
    // sampling pdf for a Lambertian BRDF, so no explicit cosT factor).
    throughR *= ar;
    throughG *= ag;
    throughB *= ab;
    skip = hit.idx;
    // Cheap early-out — if throughput collapses to ~0, more bounces add nothing.
    if (throughR + throughG + throughB < 0.01) break;
  }
  return { r: accR, g: accG, b: accB };
}

// ── Frame entry point ────────────────────────────────────────────────────
//
// `rayBatch(state, nowMs)` runs up to `state.budgetMs` worth of rays
// (capped at `state.maxRaysPerFrame`) and writes the results into the
// accumulation buffer. Called from the viewport's animate-tick chain.
export function rayBatch(state, nowMs) {
  const { soup, buffer, camera, rng, budgetMs, maxRaysPerFrame, maxBounces } = state;
  if (!soup || soup.count === 0) return 0;
  if (!buffer) return 0;
  if (!camera) return 0;
  if (buffer.samples >= (state.maxSamples || Infinity)) return 0;
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const budget = Math.max(1, budgetMs || 10);
  const sun = state.sun;
  // Cache camera basis. We use a custom unproject so we don't allocate
  // Vector3s per ray.
  camera.updateMatrixWorld(true);
  // Camera right / up / forward in world space.
  const cm = camera.matrixWorld.elements;
  const rx = cm[0],  ry = cm[1],  rz = cm[2];
  const ux = cm[4],  uy = cm[5],  uz = cm[6];
  const fx = -cm[8], fy = -cm[9], fz = -cm[10]; // camera looks down -Z in local
  const cx = cm[12], cy = cm[13], cz = cm[14];
  // FOV → focal scale.
  const fov = (camera.fov || 50) * Math.PI / 180;
  const aspect = camera.aspect || (buffer.width / Math.max(1, buffer.height));
  const halfH = Math.tan(fov * 0.5);
  const halfW = halfH * aspect;
  const bw = buffer.blockW;
  const bh = buffer.blockH;
  const cap = Math.max(1, Math.min(maxRaysPerFrame | 0 || 4000, 20000));
  let rays = 0;
  const checkEvery = 256; // perf.now() is itself non-trivial.
  while (rays < cap) {
    rays++;
    const bx = (rng() * bw) | 0;
    const by = (rng() * bh) | 0;
    // Sub-block jitter for anti-aliasing — picks a random sub-pixel
    // within the block in screen space.
    const px = (bx + rng()) / bw;
    const py = (by + rng()) / bh;
    // NDC: x in [-1,1] left→right, y in [1,-1] top→bottom (flip y because
    // pixel-Y increases downward but world-Y increases upward in NDC).
    const ndx = (px * 2 - 1) * halfW;
    const ndy = (1 - py * 2) * halfH;
    // World direction = normalize(camera forward + right*ndx + up*ndy).
    let dxr = fx + rx * ndx + ux * ndy;
    let dyr = fy + ry * ndx + uy * ndy;
    let dzr = fz + rz * ndx + uz * ndy;
    const dLen = Math.hypot(dxr, dyr, dzr);
    if (dLen < EPS) continue;
    dxr /= dLen; dyr /= dLen; dzr /= dLen;
    const rad = _traceRay(soup, sun, cx, cy, cz, dxr, dyr, dzr, rng, maxBounces);
    recordSample(buffer, bx, by, rad.r, rad.g, rad.b);
    if ((rays % checkEvery) === 0) {
      const t = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (t - t0 > budget) break;
    }
  }
  state.lastBatchMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
  state.lastBatchRays = rays;
  void nowMs;
  return rays;
}

// ── Camera-move detection ────────────────────────────────────────────────
//
// A 64-bit-ish hash over the camera's matrixWorld + projectionMatrix —
// when it changes we reset accumulation.
export function hashCamera(camera) {
  if (!camera) return 0;
  camera.updateMatrixWorld(true);
  const m = camera.matrixWorld.elements;
  const p = camera.projectionMatrix.elements;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < 16; i++) {
    const v = (m[i] * 1e6) | 0;
    h = Math.imul(h ^ (v + 0x9E3779B9), 16777619) >>> 0;
  }
  for (let i = 0; i < 16; i++) {
    const v = (p[i] * 1e6) | 0;
    h = Math.imul(h ^ (v + 0x85EBCA77), 2246822507) >>> 0;
  }
  return h >>> 0;
}

// ── State factory used by index.js ───────────────────────────────────────
export function createState() {
  return {
    soup: null,
    buffer: null,
    camera: null,
    sun: null,
    rng: _mulberry((Date.now() & 0x7fffffff) >>> 0),
    budgetMs: 10,
    maxRaysPerFrame: 4000,
    maxBounces: 2,
    maxSamples: 1_000_000,
    lastCamHash: 0,
    lastBatchMs: 0,
    lastBatchRays: 0,
  };
}

// Re-export internals for unit/debug introspection.
export const __internals__ = {
  _intersectSoup, _cosineSample, _sampleEnv, _mulberry, _findSun, _isTraceableMesh,
  FLOATS_PER_TRI,
};

// Expose helpers used by index.js install path.
export function rebuildScene(state, scene) {
  state.soup = buildSoup(scene);
  state.sun = _findSun(scene);
  if (state.buffer) resetBuffer(state.buffer);
  return state.soup.count;
}
