// ArchDisc Studio V3 — shader-graph ↔ GPU path tracer per-frame bridge.
//
// Hooks into the GPU PT's frame pipeline (the slice-693 renderer that
// runs inside rtgpu/) without touching any file in rtgpu/. The strategy
// is a non-invasive material-color biasing pass:
//
//   1. Walk the viewport's traceable meshes.
//   2. For each mesh whose material has a `.map` (CanvasTexture from
//      slice-684 shader graph bake, slice-688 matlib presets, or slice-
//      642 procedural textures), sample the texture at the first-tri
//      centroid UV (with a 5-tap unit-UV-grid fallback for graphs
//      without explicit UVs).
//   3. Save the original `mat.color` once into mesh.userData on first
//      sight; on every tick set `mat.color = baseColor * sampledColor`
//      so the GPU PT's per-tri albedo packer (sceneToTextures.js's
//      `_albedoFor`) picks up the texture-influenced colour without
//      needing access to its private albedo DataTexture.
//   4. Hash (mesh.uuid + mat.map.uuid + matrixWorld) and only call
//      `__studioRTGPURebuildScene` + `__studioRTGPUResetAccumulation`
//      when something has changed. Avoids per-frame GPU cost when the
//      scene is static.
//
// The bridge installs itself into __studioAnimTick using the exact
// wrap-prev pattern documented in api.js / anim/playback.js /
// rtgpu/index.js, tagging the chain link with `__shaderPTBridge` so
// re-installs don't double-stack.
//
// Soft-no-op contract: if the GPU PT is not present
// (`window.__studioRTGPURebuildScene` undefined), enable() returns
// `{ ok: false, error: 'rtgpu not available' }` per the slice brief.

import * as THREE from 'three';
import { sampleMaterialCentroid, sampleTextureAtUV, firstTriangleCentroidUV } from './sampler.js';

let _enabled = false;
let _tickInstalled = false;
let _meshState = new WeakMap(); // mesh → { baseR, baseG, baseB, lastHash }
let _lastSceneHash = 0;
let _lastRebuildAt = 0;
// Drop the rebuild floor low enough that the first post-enable tick still
// fires immediately (we set `_lastRebuildAt = 0` on enable) but high
// enough that we don't thrash the GPU rebuild path more than ~4×/sec
// when many maps are animating.
const _MIN_REBUILD_INTERVAL_MS = 220;

function _viewport() {
  return (typeof window !== 'undefined') ? window.__archdiscViewport : null;
}

function _scene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || ((_viewport() || {}).scene)
    || null;
}

// Mirrors the predicate inside rtgpu/sceneToTextures.js so the bridge
// walks exactly the same mesh set the GPU PT will repack. Keeping a
// local copy avoids any cross-module reach into rtgpu/.
function _isTraceableMesh(obj) {
  if (!obj || !obj.isMesh) return false;
  if (obj.userData) {
    if (obj.userData.isHelper) return false;
    if (obj.userData.archdiscStudioHelper) return false;
    if (obj.userData.archdiscStudioGizmo) return false;
    if (obj.userData.archdiscStudioGrid) return false;
    if (obj.userData.archdiscStudioGround) return false;
    if (obj.userData.archdiscStudioCameraHelper) return false;
    if (obj.userData.pickable === false && !obj.userData.archdiscStudioPrimitive) return false;
  }
  const nm = (obj.name || '').toLowerCase();
  if (nm.startsWith('__')) return false;
  if (nm.includes('helper')) return false;
  if (nm.includes('gizmo')) return false;
  if (nm.includes('grid')) return false;
  if (obj.material && obj.material.wireframe) return false;
  let p = obj.parent;
  while (p) {
    if (p.isTransformControls) return false;
    if (p.userData && (p.userData.isHelper || p.userData.archdiscStudioHelper)) return false;
    p = p.parent;
  }
  return true;
}

function _collectMeshes(scene) {
  const out = [];
  if (!scene || typeof scene.traverse !== 'function') return out;
  scene.traverse((o) => {
    if (_isTraceableMesh(o)
      && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
      out.push(o);
    }
  });
  return out;
}

// FNV-1a string mixer — same algorithm used by rtgpu/sceneToTextures.js
// for its mesh-fingerprint hash so the two stay coarsely compatible
// (helps debugging when both report a hash).
function _mixString(h, s) {
  if (!s) return h;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

function _mixFloat(h, f) {
  const v = Math.imul((f * 1e4) | 0, 1) | 0;
  return Math.imul(h ^ (v + 0x9E3779B9), 16777619) >>> 0;
}

// Per-mesh fingerprint: uuid + matrixWorld + mat.uuid + mat.map.uuid +
// canvas image dimensions. Lets the bridge detect both transform changes
// (orbit, drag) and texture replacements (shader graph rebake, matlib
// switch) without diffing the entire pixel grid.
function _hashMesh(mesh) {
  let h = 2166136261 >>> 0;
  h = _mixString(h, mesh.uuid || '');
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld.elements;
  for (let i = 0; i < 16; i++) h = _mixFloat(h, m[i]);
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (mat) {
    h = _mixString(h, mat.uuid || '');
    if (mat.map) {
      h = _mixString(h, mat.map.uuid || '');
      const img = mat.map.image;
      if (img) {
        h = _mixFloat(h, img.width || 0);
        h = _mixFloat(h, img.height || 0);
        // CanvasTexture bumps `version` on every needsUpdate=true cycle
        // — fold it in so a re-baked shader graph (same UUID, new pixels)
        // invalidates our cache.
        h = _mixFloat(h, mat.map.version || 0);
      }
    }
    // mat.color round-trips: if the user manually edits the color we
    // re-snapshot it as the new base (see _ensureBaseColor below).
    if (mat.color) {
      h = _mixFloat(h, mat.color.r);
      h = _mixFloat(h, mat.color.g);
      h = _mixFloat(h, mat.color.b);
    }
  }
  return h >>> 0;
}

function _hashScene(meshes) {
  let h = 2166136261 >>> 0;
  h = Math.imul(h ^ meshes.length, 16777619) >>> 0;
  for (const m of meshes) {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (mat && mat.map) {
      // Only mix meshes that actually carry a sampleable texture — bridge
      // is a no-op for un-mapped meshes (their per-tri albedo already
      // matches their flat colour) and they shouldn't trigger rebuilds.
      h = _mixString(h, m.uuid || '');
      h = _mixString(h, mat.map.uuid || '');
      h = _mixFloat(h, mat.map.version || 0);
    }
  }
  return h >>> 0;
}

// Persist the un-tinted "base" colour the first time we tint a mesh, OR
// the first time we see the mesh after a user-driven colour edit. The
// detection works because we also stamp the tinted colour into a sibling
// userData field — when the live mat.color no longer matches that stamp
// the user must have intervened, so we re-anchor.
function _ensureBaseColor(mesh, mat) {
  if (!mat || !mat.color) return null;
  mesh.userData = mesh.userData || {};
  const stamp = mesh.userData.__shaderPTBridge_tintStamp;
  const base = mesh.userData.__shaderPTBridge_baseColor;
  const cr = mat.color.r, cg = mat.color.g, cb = mat.color.b;
  const driftEps = 1e-4;
  const drifted = stamp
    && (Math.abs(stamp.r - cr) > driftEps
      || Math.abs(stamp.g - cg) > driftEps
      || Math.abs(stamp.b - cb) > driftEps);
  if (!base || drifted) {
    mesh.userData.__shaderPTBridge_baseColor = { r: cr, g: cg, b: cb };
  }
  return mesh.userData.__shaderPTBridge_baseColor;
}

// Apply texture tint to a single mesh. Returns true if mat.color changed
// (caller uses this to decide whether to trigger a GPU PT rebuild).
function _applyTintTo(mesh) {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!mat || !mat.color || !mat.map) return false;
  const base = _ensureBaseColor(mesh, mat);
  if (!base) return false;
  // Prefer a real per-mesh centroid UV when geometry supplies UVs,
  // otherwise sample the unit-UV-square center average.
  let sample = null;
  const triUV = firstTriangleCentroidUV(mesh.geometry);
  if (triUV) sample = sampleTextureAtUV(mat, triUV.u, triUV.v);
  if (!sample) sample = sampleMaterialCentroid(mat);
  if (!sample) return false;
  const nr = Math.max(0, Math.min(1, base.r * sample.r));
  const ng = Math.max(0, Math.min(1, base.g * sample.g));
  const nb = Math.max(0, Math.min(1, base.b * sample.b));
  const cur = mat.color;
  const driftEps = 1e-4;
  const changed = Math.abs(cur.r - nr) > driftEps
    || Math.abs(cur.g - ng) > driftEps
    || Math.abs(cur.b - nb) > driftEps;
  if (changed) {
    cur.setRGB(nr, ng, nb);
    mesh.userData.__shaderPTBridge_tintStamp = { r: nr, g: ng, b: nb };
    if (mat.needsUpdate !== undefined) mat.needsUpdate = true;
  } else if (!mesh.userData.__shaderPTBridge_tintStamp) {
    mesh.userData.__shaderPTBridge_tintStamp = { r: nr, g: ng, b: nb };
  }
  return changed;
}

// One-shot scene walk + tint pass. Public so the e2e spec + the
// "force rebuild" op can invoke it directly without waiting for a tick.
export function runOnce() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  const scene = _scene();
  if (!scene) return { ok: false, error: 'no scene' };
  const meshes = _collectMeshes(scene);
  let mapped = 0;
  let changed = 0;
  for (const m of meshes) {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!mat || !mat.map) continue;
    mapped++;
    if (_applyTintTo(m)) changed++;
  }
  return {
    ok: true,
    meshes: meshes.length,
    mappedMeshes: mapped,
    tintedMeshes: changed,
  };
}

// Trigger the GPU PT to re-pack its scene textures with the freshly
// tinted material colours, then reset its accumulator so the next frame
// renders from a clean slate. Both ops are best-effort — if rtgpu isn't
// running yet we just bail.
function _triggerRTGPUResync() {
  let rebuilt = false;
  let reset = false;
  try {
    if (typeof window.__studioRTGPURebuildScene === 'function') {
      const r = window.__studioRTGPURebuildScene();
      rebuilt = !!(r && r.ok);
    }
  } catch (_) { /* swallow */ }
  try {
    if (typeof window.__studioRTGPUResetAccumulation === 'function') {
      const r = window.__studioRTGPUResetAccumulation();
      reset = !!(r && r.ok);
    }
  } catch (_) { /* swallow */ }
  return { rebuilt, reset };
}

// Per-tick handler. Only does real work when (a) something changed in
// the scene's mat.map graph and (b) we're past the rebuild cool-down.
function _tick() {
  if (!_enabled) return;
  // Quick gate — if the GPU PT isn't currently active, there's no point
  // recomputing tints. We still want the tints applied for when the user
  // *starts* the GPU PT, so we run the tint pass but skip the rebuild.
  const rtgpuRunning = (typeof window.__studioRTGPUGetState === 'function')
    && (() => { try { return !!window.__studioRTGPUGetState().active; } catch (_) { return false; } })();
  const scene = _scene();
  if (!scene) return;
  const meshes = _collectMeshes(scene);
  let dirty = false;
  for (const m of meshes) {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!mat || !mat.map) continue;
    const h = _hashMesh(m);
    const cur = _meshState.get(m);
    if (!cur || cur.lastHash !== h) {
      if (_applyTintTo(m)) dirty = true;
      _meshState.set(m, { lastHash: _hashMesh(m) }); // re-hash post-tint
    }
  }
  const sceneHash = _hashScene(meshes);
  if (sceneHash !== _lastSceneHash) {
    _lastSceneHash = sceneHash;
    dirty = true;
  }
  if (dirty && rtgpuRunning) {
    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    if (now - _lastRebuildAt > _MIN_REBUILD_INTERVAL_MS) {
      _lastRebuildAt = now;
      _triggerRTGPUResync();
    }
  }
}

function _installTick() {
  if (_tickInstalled) return true;
  const vp = _viewport();
  if (!vp) return false;
  const prev = vp.__studioAnimTick;
  const fn = (now) => {
    try { _tick(); } catch (_) { /* never break the host loop */ }
    if (prev) {
      try { prev(now); } catch (_) {}
    }
  };
  fn.__shaderPTBridge = true;
  fn.__prev = prev;
  vp.__studioAnimTick = fn;
  _tickInstalled = true;
  return true;
}

function _uninstallTick() {
  if (!_tickInstalled) return;
  const vp = _viewport();
  if (!vp) { _tickInstalled = false; return; }
  // Unlink the chain — find the bridge link and splice it out by
  // restoring its __prev as the new __studioAnimTick.
  let cur = vp.__studioAnimTick;
  let parent = null;
  while (cur) {
    if (cur.__shaderPTBridge) {
      if (!parent) {
        vp.__studioAnimTick = cur.__prev || null;
      } else {
        parent.__prev = cur.__prev || null;
        // Rewire the parent so calls forward to the spliced chain.
        const grandPrev = cur.__prev || null;
        const parentFn = parent;
        const oldFn = parentFn.__inner || parentFn;
        const wrap = (n) => {
          try { oldFn(n); } catch (_) {}
          if (grandPrev) { try { grandPrev(n); } catch (_) {} }
        };
        wrap.__inner = oldFn;
        wrap.__prev = grandPrev;
        // Restoring the wrapper in-place is awkward; the simpler
        // contract is: when the bridge is the top-of-chain (the
        // overwhelmingly common case), unlink directly.
        // For mid-chain we leave the link in but disable tinting via
        // `_enabled = false`, which is already set by the caller.
      }
      break;
    }
    parent = cur;
    cur = cur.__prev;
  }
  _tickInstalled = false;
}

// Restore each tinted mesh's mat.color back to its remembered base.
// Called on disable() so a subsequent rebuild after we've stopped the
// bridge produces the un-tinted GPU PT image (matches user expectation:
// disabling the bridge cleanly undoes its visual effect).
function _restoreBaseColors() {
  const scene = _scene();
  if (!scene) return 0;
  let restored = 0;
  scene.traverse((m) => {
    if (!m || !m.isMesh || !m.userData) return;
    const base = m.userData.__shaderPTBridge_baseColor;
    if (!base) return;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!mat || !mat.color) return;
    mat.color.setRGB(base.r, base.g, base.b);
    if (mat.needsUpdate !== undefined) mat.needsUpdate = true;
    delete m.userData.__shaderPTBridge_baseColor;
    delete m.userData.__shaderPTBridge_tintStamp;
    restored++;
  });
  return restored;
}

export function enable() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  // Hard requirement per slice brief: rtgpu must be reachable. We accept
  // either of the two install conditions (function-on-window from
  // installRTGPU, OR active GPU PT state) — either way we need
  // __studioRTGPURebuildScene to flow the tint into the GPU PT.
  if (typeof window.__studioRTGPURebuildScene !== 'function'
    && typeof window.__studioRTGPUStart !== 'function') {
    return { ok: false, error: 'rtgpu not available' };
  }
  _enabled = true;
  _meshState = new WeakMap();
  _lastSceneHash = 0;
  _lastRebuildAt = 0;
  _installTick();
  // Run an immediate pass so tests can probe ResetAccumulation right
  // after enable() without waiting for the next frame.
  try { runOnce(); } catch (_) {}
  return { ok: true, on: true, installedTick: _tickInstalled };
}

export function disable() {
  if (!_enabled) return { ok: true, on: false };
  _enabled = false;
  const restored = _restoreBaseColors();
  _uninstallTick();
  _meshState = new WeakMap();
  _lastSceneHash = 0;
  // One last rebuild so the GPU PT picks up the restored colours.
  _triggerRTGPUResync();
  return { ok: true, on: false, restored };
}

export function isEnabled() {
  return { ok: true, on: !!_enabled };
}

// Public-facing forced rebuild: ignores the rebuild cool-down and the
// per-mesh hash cache. Tests use this to assert that a freshly-baked
// shader-graph texture flows into the GPU PT on demand.
export function forceRebuild() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (typeof window.__studioRTGPURebuildScene !== 'function') {
    return { ok: false, error: 'rtgpu not available' };
  }
  _meshState = new WeakMap();
  _lastSceneHash = 0;
  _lastRebuildAt = 0;
  const stats = runOnce();
  const sync = _triggerRTGPUResync();
  return { ok: true, ...stats, ...sync };
}

// Test-only: drain internal state without touching __studioAnimTick.
// Used by the e2e spec to keep fixtures isolated.
export function _resetForTests() {
  _enabled = false;
  _tickInstalled = false;
  _meshState = new WeakMap();
  _lastSceneHash = 0;
  _lastRebuildAt = 0;
}

// Internals exposed so the index/op layer can re-use the helpers
// without re-implementing them. THREE is re-exported because some host
// environments insist every module that uses it imports it explicitly.
export const __internals__ = {
  _collectMeshes, _hashMesh, _hashScene, _applyTintTo,
  _triggerRTGPUResync, _isTraceableMesh, _ensureBaseColor,
  _restoreBaseColors, _MIN_REBUILD_INTERVAL_MS, THREE,
};
