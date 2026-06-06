// ArchDisc Studio V3 — ZBrush localized brush sculpt installer (slice 758).
//
// installZBrushDetail() wires up the four window-level ops that turn
// the `brushKernels.js` + `falloffCurves.js` pure modules into a usable
// brush surface:
//
//   __studioZBrushBrush(meshUuid, brush, params)
//     Apply one of the seven kernels (draw/inflate/crease/pinch/
//     flatten/grab/smooth) to the mesh identified by `meshUuid`,
//     within `params.radius` of `params.center`, using the active
//     falloff curve set by __studioZBrushSetFalloffCurve.
//
//   __studioZBrushBrushVerifyAll(meshUuid)
//     Run every kernel once against the mesh and return per-kernel
//     vertex-change counts. The verification smoke test that flips the
//     DCC_PARITY_MAP row from PARTIAL → DONE — proves each mode is
//     individually addressable + does real work.
//
//   __studioZBrushSetFalloffCurve(curve)
//     Select the active curve by name. Persists in module state +
//     window global so callers and the brief-required Settings op can
//     both read it.
//
//   __studioZBrushGetActiveSettings()
//     Returns the current brush state: active curve, last brush, last
//     params, and the kernel + curve name catalogues.
//
// Idempotent: re-invoking returns { alreadyInstalled: true }. Op ids
// register under category 'sculpt' to live alongside the existing
// ZBrush surface (DynaMesh, SubTools, Polypaint, Sculpt Layers).

import { KERNELS, KERNEL_NAMES, getKernel } from './brushKernels.js';
import { CURVES, CURVE_NAMES, getCurve } from './falloffCurves.js';
import { registerOp, unregisterOps } from '../common/registry.js';

let _installed = false;

// Module-level state. Mirrors onto window so __studioZBrushGetActiveSettings
// + window probes (used by tests) can read it without going through ops.
const _state = {
  curve: 'smooth',           // matches the Studio default smoothFalloff
  lastBrush: null,
  lastParams: null,
};

const ACTIVE_CURVE_KEY = '__studioZBrushActiveCurve';
const LAST_BRUSH_KEY   = '__studioZBrushLastBrush';
const LAST_PARAMS_KEY  = '__studioZBrushLastParams';

// ─── helpers ──────────────────────────────────────────────────────────

function _resolveMesh(meshUuid) {
  if (typeof window === 'undefined') return null;
  if (!meshUuid) {
    // Default to the active selection if no uuid was supplied.
    const sel = (typeof window.__studioSelectedMesh === 'function')
      ? window.__studioSelectedMesh()
      : null;
    return sel || null;
  }
  const scene = window.__archdiscScene;
  if (!scene) return null;
  if (typeof scene.getObjectByProperty === 'function') {
    const m = scene.getObjectByProperty('uuid', meshUuid);
    if (m) return m;
  }
  // Walk the scene as a fallback in case the scene is a plain Object3D
  // host without getObjectByProperty (tests use raw THREE.Group sometimes).
  let found = null;
  if (typeof scene.traverse === 'function') {
    scene.traverse((o) => { if (!found && o && o.uuid === meshUuid) found = o; });
  }
  return found;
}

// Triangle neighbour table for laplacian smoothing. Built lazily per
// stroke; cached on geometry.userData keyed by the position array
// pointer so repeated strokes on the same mesh skip the rebuild.
function _neighbourSums(geometry, pos) {
  const cacheKey = '__zbrushDetailNbrCache';
  const cache = geometry.userData && geometry.userData[cacheKey];
  if (cache && cache.posRef === pos.array) {
    return cache;
  }
  const sums = new Float32Array(pos.count * 3);
  const counts = new Int32Array(pos.count);
  const idx = geometry.index;
  if (idx) {
    const tri = [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]];
    for (let t = 0; t < idx.count; t += 3) {
      const a = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      for (const [i, j] of tri) {
        const vi = a[i], vj = a[j];
        sums[vi * 3]     += pos.getX(vj);
        sums[vi * 3 + 1] += pos.getY(vj);
        sums[vi * 3 + 2] += pos.getZ(vj);
        counts[vi]++;
      }
    }
  } else {
    // Non-indexed: build edges per-triangle from sequential triples.
    const tri = [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]];
    for (let t = 0; t < pos.count; t += 3) {
      const a = [t, t + 1, t + 2];
      for (const [i, j] of tri) {
        const vi = a[i], vj = a[j];
        sums[vi * 3]     += pos.getX(vj);
        sums[vi * 3 + 1] += pos.getY(vj);
        sums[vi * 3 + 2] += pos.getZ(vj);
        counts[vi]++;
      }
    }
  }
  const entry = { posRef: pos.array, sums, counts };
  if (!geometry.userData) geometry.userData = {};
  geometry.userData[cacheKey] = entry;
  return entry;
}

// Apply a single kernel to every vertex within `radius` of `center`.
// Returns `{ touched, changed }`: touched = verts that entered the
// kernel falloff > 0, changed = verts whose position actually moved
// (after numeric noise filtering).
function _applyKernel(mesh, kernel, params, curveFn) {
  const geo = mesh.geometry;
  if (!geo || !geo.attributes || !geo.attributes.position) {
    return { ok: false, error: 'mesh has no position attribute', touched: 0, changed: 0 };
  }
  const pos = geo.attributes.position;
  let nrm = geo.attributes.normal;
  if (!nrm) {
    geo.computeVertexNormals();
    nrm = geo.attributes.normal;
  }
  const center = Array.isArray(params.center)
    ? [+params.center[0] || 0, +params.center[1] || 0, +params.center[2] || 0]
    : [0, 0, 0];
  const radius = Math.max(1e-6, +params.radius || 0.1);
  const strength = (typeof params.strength === 'number') ? params.strength : 0.5;
  const motion = params.motion || params.delta || null;

  // Compute average normal + centroid of the cap once for flatten.
  let an = [0, 0, 0], ac = [0, 0, 0], na = 0;
  const r2 = radius * radius;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const dx = vx - center[0], dy = vy - center[1], dz = vz - center[2];
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    an[0] += nrm.getX(i); an[1] += nrm.getY(i); an[2] += nrm.getZ(i);
    ac[0] += vx;          ac[1] += vy;          ac[2] += vz;
    na++;
  }
  if (na > 0) {
    ac[0] /= na; ac[1] /= na; ac[2] /= na;
    const len = Math.sqrt(an[0] * an[0] + an[1] * an[1] + an[2] * an[2]);
    if (len > 1e-9) { an[0] /= len; an[1] /= len; an[2] /= len; }
    else { an[0] = 0; an[1] = 1; an[2] = 0; }
  }

  // Pre-compute neighbour averages once for smooth.
  const needsSmooth = (kernel === KERNELS.smooth);
  let nbr = null;
  if (needsSmooth) nbr = _neighbourSums(geo, pos);

  const ctx = {
    center,
    motion,
    plane: { normal: an, point: ac },
    smooth: null, // assigned per-vert
  };

  let touched = 0;
  let changed = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const dx = vx - center[0], dy = vy - center[1], dz = vz - center[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    const d = Math.sqrt(d2);
    const t = 1 - d / radius;
    const w = curveFn(t);
    if (w <= 0) continue;
    touched++;

    const vert = [vx, vy, vz];
    const normal = [nrm.getX(i), nrm.getY(i), nrm.getZ(i)];

    if (needsSmooth) {
      const ni = i;
      const cnt = nbr.counts[ni];
      if (cnt > 0) {
        ctx.smooth = {
          target: [
            nbr.sums[ni * 3]     / cnt,
            nbr.sums[ni * 3 + 1] / cnt,
            nbr.sums[ni * 3 + 2] / cnt,
          ],
        };
      } else {
        ctx.smooth = { target: vert.slice() };
      }
    }

    const disp = kernel(vert, normal, strength, w, ctx);
    if (!disp) continue;
    const ddx = +disp[0] || 0, ddy = +disp[1] || 0, ddz = +disp[2] || 0;
    if (Math.abs(ddx) < 1e-10 && Math.abs(ddy) < 1e-10 && Math.abs(ddz) < 1e-10) continue;
    pos.setXYZ(i, vx + ddx, vy + ddy, vz + ddz);
    changed++;
  }

  if (changed > 0) {
    pos.needsUpdate = true;
    if (typeof geo.computeVertexNormals === 'function') {
      try { geo.computeVertexNormals(); } catch (_) { /* swallow */ }
    }
    // Invalidate the neighbour cache after a stroke that changed
    // positions; smooth-next-stroke will rebuild against the new array.
    if (geo.userData) {
      try { delete geo.userData.__zbrushDetailNbrCache; } catch (_) {}
    }
    if (geo.boundsTree && typeof geo.computeBoundsTree === 'function') {
      try { geo.computeBoundsTree(); } catch (_) {}
    }
    if (typeof geo.computeBoundingBox === 'function')    geo.computeBoundingBox();
    if (typeof geo.computeBoundingSphere === 'function') geo.computeBoundingSphere();
  }

  return { ok: true, touched, changed };
}

// ─── ops ──────────────────────────────────────────────────────────────

// __studioZBrushBrush(meshUuid, brush, params)
function opBrush(meshUuid, brush, params) {
  const mesh = _resolveMesh(meshUuid);
  if (!mesh) return { ok: false, error: 'mesh not found' };
  const name = String(brush || '').toLowerCase();
  const kernel = getKernel(name);
  if (!kernel) {
    return { ok: false, error: 'unknown brush', valid: KERNEL_NAMES };
  }
  const p = params && typeof params === 'object' ? params : {};
  const curveName = p.curve || _state.curve;
  const curveFn = getCurve(curveName);
  if (!curveFn) {
    return { ok: false, error: 'unknown curve', valid: CURVE_NAMES };
  }
  // Push undo so the user can roll back any brush stroke.
  if (typeof window !== 'undefined' && typeof window.__studioPushUndo === 'function') {
    try { window.__studioPushUndo('zbrush-' + name); } catch (_) { /* ignore */ }
  }
  const r = _applyKernel(mesh, kernel, p, curveFn);
  if (r.ok) {
    _state.lastBrush = name;
    _state.lastParams = p;
    if (typeof window !== 'undefined') {
      window[LAST_BRUSH_KEY] = name;
      window[LAST_PARAMS_KEY] = p;
    }
  }
  return Object.assign({}, r, { brush: name, curve: curveName, meshUuid: mesh.uuid });
}

// __studioZBrushBrushVerifyAll(meshUuid) — run every kernel once, report
// per-kernel change counts. This is the smoke test that the brief calls
// out; it proves each of the seven modes is individually addressable.
function opVerifyAll(meshUuid, opts) {
  const mesh = _resolveMesh(meshUuid);
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) {
    return { ok: false, error: 'mesh not found or empty', perKernel: {} };
  }
  const pos = mesh.geometry.attributes.position;
  // Snapshot the original positions so we can restore between kernels.
  const orig = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    orig[i * 3]     = pos.getX(i);
    orig[i * 3 + 1] = pos.getY(i);
    orig[i * 3 + 2] = pos.getZ(i);
  }
  const restore = () => {
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]);
    }
    pos.needsUpdate = true;
    if (mesh.geometry.computeVertexNormals) {
      try { mesh.geometry.computeVertexNormals(); } catch (_) {}
    }
    if (mesh.geometry.userData) {
      try { delete mesh.geometry.userData.__zbrushDetailNbrCache; } catch (_) {}
    }
  };

  // Compute an automatic radius + centre from the mesh's bounding sphere
  // so verifyAll works on any mesh shape, not just our standard sphere.
  let bs = mesh.geometry.boundingSphere;
  if (!bs) {
    mesh.geometry.computeBoundingSphere();
    bs = mesh.geometry.boundingSphere;
  }
  const bsCenter = bs ? [bs.center.x, bs.center.y, bs.center.z] : [0, 0, 0];
  const bsRadius = bs ? bs.radius : 0.5;

  const o = opts && typeof opts === 'object' ? opts : {};
  const center = o.center || [bsCenter[0], bsCenter[1] + bsRadius * 0.9, bsCenter[2]];
  const radius = +o.radius || (bsRadius * 0.5);
  const strength = (typeof o.strength === 'number') ? o.strength : 0.3;
  const motion = o.motion || [0, bsRadius * 0.05, 0];
  const curveFn = getCurve(_state.curve) || CURVES.smooth;

  const perKernel = {};
  let total = 0;
  for (const name of KERNEL_NAMES) {
    restore();
    const params = { center, radius, strength, motion };
    const r = _applyKernel(mesh, KERNELS[name], params, curveFn);
    perKernel[name] = { touched: r.touched || 0, changed: r.changed || 0 };
    total += r.changed || 0;
  }
  // Restore the mesh one last time so verifyAll is a no-op on geometry.
  restore();

  return {
    ok: true,
    meshUuid: mesh.uuid,
    kernels: KERNEL_NAMES.length,
    curves: CURVE_NAMES.length,
    perKernel,
    totalChanged: total,
  };
}

// __studioZBrushSetFalloffCurve(curve)
function opSetCurve(curve) {
  const name = String(curve || '').toLowerCase();
  if (!CURVES[name]) {
    return { ok: false, error: 'unknown curve', valid: CURVE_NAMES };
  }
  _state.curve = name;
  if (typeof window !== 'undefined') {
    window[ACTIVE_CURVE_KEY] = name;
    if (typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('studio-zbrush-falloff-curve-changed', {
          detail: { curve: name },
        }));
      } catch (_) { /* ignore */ }
    }
  }
  return { ok: true, curve: name };
}

// __studioZBrushGetActiveSettings()
function opGetActiveSettings() {
  return {
    ok: true,
    curve: _state.curve,
    lastBrush: _state.lastBrush,
    lastParams: _state.lastParams,
    kernels: KERNEL_NAMES,
    curves: CURVE_NAMES,
  };
}

const OP_NAMES = [
  '__studioZBrushBrush',
  '__studioZBrushBrushVerifyAll',
  '__studioZBrushSetFalloffCurve',
  '__studioZBrushGetActiveSettings',
];

export function installZBrushDetail() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, alreadyInstalled: true };
  _installed = true;

  // Pin the active curve on window from the start so probes see a value.
  window[ACTIVE_CURVE_KEY] = _state.curve;

  registerOp('__studioZBrushBrush', opBrush, 'sculpt',
    'ZBrush localized brush: apply (draw|inflate|crease|pinch|flatten|grab|smooth) at center, radius, strength (slice 758).');
  registerOp('__studioZBrushBrushVerifyAll', opVerifyAll, 'sculpt',
    'Run every ZBrush brush kernel once against the mesh; returns per-mode changed-vertex counts (verify smoke).');
  registerOp('__studioZBrushSetFalloffCurve', opSetCurve, 'sculpt',
    'Select the active ZBrush falloff curve (linear|smooth|sphere|sharp|constant).');
  registerOp('__studioZBrushGetActiveSettings', opGetActiveSettings, 'sculpt',
    'Return the current ZBrush brush state (active curve, last brush, kernel + curve catalogues).');

  return {
    ok: true,
    alreadyInstalled: false,
    ops: OP_NAMES.length,
    kernels: KERNEL_NAMES.length,
    curves: CURVE_NAMES.length,
  };
}

export function uninstallZBrushDetail() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps(OP_NAMES);
  try { delete window[ACTIVE_CURVE_KEY]; } catch (_) {}
  try { delete window[LAST_BRUSH_KEY]; } catch (_) {}
  try { delete window[LAST_PARAMS_KEY]; } catch (_) {}
  _installed = false;
  return { ok: true };
}

export default installZBrushDetail;
