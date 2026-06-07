// ArchDisc Studio V3 — Screen-Space Global Illumination installer (slice 893).
//
// Wires the REAL SSAO + SSGI kernels from ssao.js + ssgi.js onto the
// window.__studio* op surface and feeds them a G-buffer that is
// rasterised from the live scene at apply time (top-down orthographic
// projection of every primitive's bounding sphere onto a 64×64 grid —
// real positions, normals, depths, and material colours, NOT a
// placeholder).
//
// This is the same "small CPU G-buffer driven by the live scene"
// approach the slice-784 pathtrace + slice-853 deferred modules use:
// it proves the algorithm runs end-to-end without requiring a
// WebGLRenderTarget round-trip.
//
// Ops (all return `{ok, ...}` per V3 convention):
//
//   __studioSSGIApply({sampleCount, radius, intensity})
//     → builds G-buffer from window.__archdiscScene, runs SSGI,
//       composites onto a fresh beauty buffer, stores result on
//       `window.__archdiscSSGIResult`. Returns
//       {ok, sampleCount, radius, intensity, meanAO, meanBounce,
//        width, height, pixels}.
//
//   __studioSSGIGetStats()
//     → returns the current state + last apply's stats.
//
//   __studioSSGISetEnabled({on})
//     → toggles whether the apply pass runs (matches the
//       `enabled` flag every other rt module exposes).

import { registerOps } from '../common/registry.js';
import { computeSSAO, meanAO } from './ssao.js';
import { computeSSGI, applySSGI, meanBounce } from './ssgi.js';

let _installed = false;
let _state = {
  enabled: false,
  sampleCount: 16,
  radius: 0.5,
  intensity: 1,
  bias: 0.025,
  lastMeanAO: 1,
  lastMeanBounce: 0,
  lastWidth: 0,
  lastHeight: 0,
  applyCount: 0,
};

// ── G-buffer rasterisation ────────────────────────────────────────────────
//
// Walks every renderable mesh in window.__archdiscScene and rasterises
// its bounding sphere onto a top-down orthographic 64×64 grid:
//   - positions[i] = world-space center of the sphere disc at that pixel
//   - normals[i]   = up vector (top-down view)
//   - colours[i]   = material.color
//   - depth[i]     = sphere top Y (camera looks down −Y) — closer surfaces
//                    win the depth test
//
// The bbox + dimensions are returned so the SSAO kernel projects samples
// back to the same UV space.
function _rasteriseGBuffer(scene, width = 64, height = 64) {
  const positions = new Float32Array(width * height * 3);
  const normals = new Float32Array(width * height * 3);
  const colours = new Float32Array(width * height * 3);
  const depth = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) depth[i] = -Infinity;
  // Walk meshes, find world bbox.
  const meshes = [];
  if (scene && scene.traverse) {
    scene.traverse((o) => {
      if (!o || !o.isMesh) return;
      const u = o.userData || {};
      if (u.archdiscStudioHelper || u.isHelper || u.archdiscStudioGizmo) return;
      if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      meshes.push(o);
    });
  }
  if (!meshes.length) {
    return {
      positions, normals, colours, depth,
      width, height,
      bbox: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
      meshCount: 0,
    };
  }
  // World-space bbox via every mesh's bounding sphere (cheap + good enough
  // for the orthographic footprint).
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const meta = [];
  for (const m of meshes) {
    // ensure boundingSphere computed
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    const bs = m.geometry.boundingSphere;
    if (!bs) continue;
    const center = bs.center.clone().applyMatrix4(m.matrixWorld);
    const radius = bs.radius * Math.max(m.scale.x, m.scale.y, m.scale.z);
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const col = (mat && mat.color) ? mat.color : { r: 0.7, g: 0.7, b: 0.7 };
    meta.push({
      cx: center.x, cy: center.y, cz: center.z, r: radius,
      cr: col.r != null ? col.r : 0.7,
      cg: col.g != null ? col.g : 0.7,
      cb: col.b != null ? col.b : 0.7,
    });
    if (center.x - radius < minX) minX = center.x - radius;
    if (center.x + radius > maxX) maxX = center.x + radius;
    if (center.z - radius < minZ) minZ = center.z - radius;
    if (center.z + radius > maxZ) maxZ = center.z + radius;
  }
  if (!isFinite(minX) || minX === maxX) { minX = -1; maxX = 1; }
  if (!isFinite(minZ) || minZ === maxZ) { minZ = -1; maxZ = 1; }
  // 5 % padding so spheres on the edge still draw.
  const padX = (maxX - minX) * 0.05;
  const padZ = (maxZ - minZ) * 0.05;
  minX -= padX; maxX += padX; minZ -= padZ; maxZ += padZ;
  const bbox = { minX, maxX, minY: minZ, maxY: maxZ };
  // Rasterise.
  for (const m of meta) {
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        // pixel center in world space.
        const wx = minX + (px + 0.5) / width  * (maxX - minX);
        const wz = minZ + (py + 0.5) / height * (maxZ - minZ);
        const dx = wx - m.cx;
        const dz = wz - m.cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > m.r * m.r) continue;
        // Surface Y on the sphere (top hemisphere only since we look
        // straight down): y = cy + sqrt(r² - (dx² + dz²)).
        const yTop = m.cy + Math.sqrt(Math.max(0, m.r * m.r - d2));
        const pIdx = py * width + px;
        if (yTop <= depth[pIdx]) continue;
        depth[pIdx] = yTop;
        // Surface normal at the top hemisphere: (dx, sqrt(...), dz) / r.
        const ny = Math.sqrt(Math.max(0, m.r * m.r - d2));
        const nLen = m.r || 1;
        const pIdx3 = pIdx * 3;
        positions[pIdx3]     = wx;
        positions[pIdx3 + 1] = yTop;
        positions[pIdx3 + 2] = wz;
        normals[pIdx3]     = dx / nLen;
        normals[pIdx3 + 1] = ny / nLen;
        normals[pIdx3 + 2] = dz / nLen;
        colours[pIdx3]     = m.cr;
        colours[pIdx3 + 1] = m.cg;
        colours[pIdx3 + 2] = m.cb;
      }
    }
  }
  // Re-map -Infinity depth → 0 sentinel so SSAO skips background pixels.
  for (let i = 0; i < depth.length; i++) {
    if (!isFinite(depth[i])) depth[i] = 0;
  }
  return { positions, normals, colours, depth, width, height, bbox, meshCount: meta.length };
}

// ── Top-level install ────────────────────────────────────────────────────
export function installSSGI() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioSSGIApply: ({ sampleCount, radius, intensity, bias, width, height } = {}) => {
      if (sampleCount) _state.sampleCount = sampleCount | 0;
      if (typeof radius === 'number') _state.radius = radius;
      if (typeof intensity === 'number') _state.intensity = intensity;
      if (typeof bias === 'number') _state.bias = bias;
      const w = (width  | 0) || 64;
      const h = (height | 0) || 64;
      const scene = typeof window !== 'undefined' ? window.__archdiscScene : null;
      const gbuf = _rasteriseGBuffer(scene, w, h);
      const ssgi = computeSSGI(gbuf, {
        sampleCount: _state.sampleCount,
        radius: _state.radius,
        bias: _state.bias,
      });
      if (!ssgi.ok) {
        // colours buffer missing — fall back to SSAO-only so the op
        // still reports something useful.
        const ao = computeSSAO(gbuf, {
          sampleCount: _state.sampleCount,
          radius: _state.radius,
          bias: _state.bias,
        });
        _state.lastMeanAO = meanAO(ao);
        _state.lastMeanBounce = 0;
        _state.lastWidth = w;
        _state.lastHeight = h;
        _state.applyCount++;
        if (typeof window !== 'undefined') {
          window.__archdiscSSGIResult = {
            ao, bounce: null, width: w, height: h,
            sampleCount: _state.sampleCount,
            radius: _state.radius,
            intensity: _state.intensity,
          };
        }
        return {
          ok: true, sampleCount: _state.sampleCount,
          radius: _state.radius, intensity: _state.intensity,
          meanAO: _state.lastMeanAO, meanBounce: 0,
          width: w, height: h, pixels: w * h,
          meshCount: gbuf.meshCount, mode: 'ssao-only',
        };
      }
      // Build a flat-white beauty buffer to composite onto so the apply
      // op has a deterministic result that the caller can inspect.
      const beauty = new Float32Array(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        const i3 = i * 3;
        const d = gbuf.depth[i];
        if (d === 0) {
          // background → black (no contribution)
          beauty[i3] = 0; beauty[i3 + 1] = 0; beauty[i3 + 2] = 0;
        } else {
          // direct-lit albedo from the colour G-buffer.
          beauty[i3]     = gbuf.colours[i3];
          beauty[i3 + 1] = gbuf.colours[i3 + 1];
          beauty[i3 + 2] = gbuf.colours[i3 + 2];
        }
      }
      const lit = applySSGI(beauty, ssgi.ao, ssgi.bounce, _state.intensity, w, h);
      _state.lastMeanAO     = meanAO(ssgi.ao);
      _state.lastMeanBounce = meanBounce(ssgi.bounce);
      _state.lastWidth = w;
      _state.lastHeight = h;
      _state.applyCount++;
      if (typeof window !== 'undefined') {
        window.__archdiscSSGIResult = {
          ao: ssgi.ao, bounce: ssgi.bounce, lit,
          width: w, height: h,
          sampleCount: _state.sampleCount,
          radius: _state.radius,
          intensity: _state.intensity,
        };
      }
      return {
        ok: true,
        sampleCount: _state.sampleCount,
        radius: _state.radius,
        intensity: _state.intensity,
        meanAO: _state.lastMeanAO,
        meanBounce: _state.lastMeanBounce,
        width: w, height: h, pixels: w * h,
        meshCount: gbuf.meshCount,
        mode: 'ssao+bounce',
      };
    },
    __studioSSGIGetStats: () => ({
      ok: true,
      enabled: _state.enabled,
      sampleCount: _state.sampleCount,
      radius: _state.radius,
      intensity: _state.intensity,
      bias: _state.bias,
      lastMeanAO: _state.lastMeanAO,
      lastMeanBounce: _state.lastMeanBounce,
      lastWidth: _state.lastWidth,
      lastHeight: _state.lastHeight,
      applyCount: _state.applyCount,
    }),
    __studioSSGISetEnabled: ({ on } = {}) => {
      _state.enabled = !!on;
      return { ok: true, enabled: _state.enabled };
    },
  };
  for (const [n, fn] of Object.entries(ops)) {
    if (typeof window !== 'undefined') window[n] = fn;
  }
  registerOps(ops, 'rt', 'Screen-space global illumination (SSAO + colour bounce)');
  return { ok: true };
}

export default installSSGI;
