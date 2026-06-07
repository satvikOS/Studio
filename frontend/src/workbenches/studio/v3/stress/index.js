// ArchDisc Studio V3 — stress test harness op surface (slice 788).
//
// `installStress()` wires the `window.__studioStress*` surface that
// closes the "haven't stress-tested" gap (the parity-map entry under
// `Performance / instrumentation`). It exposes four ops on top of
// `sceneGenerator.js` + `perfMeter.js` + `screenshotter.js`:
//
//   __studioStressGenScene({ targetTris, instanceCount, extent, seed })
//     → { ok, actualTris, instanceCount, perInstanceTris, detail,
//         meshUuid, sceneTime }
//     Build the InstancedMesh from sceneGenerator#generateBigScene and
//     attach it to the live viewport scene at
//     `window.__archdiscScene`. `sceneTime` is wall-clock ms from the
//     call entering this op to the mesh being parented (no rAF wait).
//
//   __studioStressGenParticleScene({ count, life, spawnRate, seed })
//     → { ok, count, meshUuid, sceneTime }
//     Same surface for the slice-764 particle pipeline.
//
//   __studioStressMeasureFPS({ durationMs, includeSamples })
//     → { ok, fps, frameTimeMs, frameCount, minFrameMs, maxFrameMs,
//         medianFrameMs, durationMs, samples? }
//     Clock real frame-time over the window. Sees through the slice-752
//     render-on-demand gate by calling `__studioInvalidate` each tick.
//
//   __studioStressRender4K({ width, height, path })
//     → { ok, dataUrl, width, height, renderTimeMs, path }
//     Render the live scene at the requested resolution (default 4K)
//     into an off-screen WebGLRenderTarget. `dataUrl` is the PNG.
//
//   __studioStressMemoryProfile()
//     → { ok, jsHeap: { used, total, limit } | null,
//         sceneObjects: { meshes, lights, totalTris, geometries,
//                          materials, textures },
//         stressMeshes: number }
//     Snapshot V8 heap (via the Chromium `performance.memory` extension
//     when present) + a one-pass scene traversal counting meshes /
//     lights / total triangles. The honest scope: `performance.memory`
//     is Chrome-only; we report `null` when missing — never fabricate.
//
//   __studioStressClear()
//     → { ok, removed }
//     Remove every stress-generated mesh from the scene (anything
//     tagged `userData.archdiscStudioStress`). Disposes geometry +
//     material so the next run starts clean.
//
//   __studioStressList()
//     → { ok, meshes: [{ uuid, name, kind, triCount, instanceCount }] }
//
// Idempotent. Pure JS, no new deps.

import { registerOps, unregisterOps } from '../common/registry.js';
import {
  generateBigScene,
  generateBigParticleScene,
  findStressMeshes,
} from './sceneGenerator.js';
import { measureFPS } from './perfMeter.js';
import { captureScreenshot } from './screenshotter.js';

let _installed = false;

// Pull the live scene off the slice-396 viewport globals. Lazy
// resolution so the ops still work if the viewport reloads.
function _getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}

// Cheap triangle counter for a single geometry. Handles both indexed
// and non-indexed BufferGeometries; falls back to 0 on unknown shapes.
function _geomTris(geo) {
  if (!geo) return 0;
  if (geo.index) return geo.index.count / 3;
  if (geo.attributes && geo.attributes.position) return geo.attributes.position.count / 3;
  return 0;
}

// Count instance-aware tris for a single mesh (multiplies for
// InstancedMesh).
function _meshTris(mesh) {
  if (!mesh || !mesh.geometry) return 0;
  const baseTris = _geomTris(mesh.geometry);
  const inst = (mesh.isInstancedMesh && Number.isFinite(mesh.count)) ? mesh.count : 1;
  return baseTris * inst;
}

// Dispose a stress mesh and detach it from the scene. Safe against
// re-runs (idempotent).
function _disposeMesh(mesh) {
  if (!mesh) return;
  try { if (mesh.parent) mesh.parent.remove(mesh); } catch (_) {}
  try {
    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') mesh.geometry.dispose();
  } catch (_) {}
  try {
    if (Array.isArray(mesh.material)) {
      for (const m of mesh.material) if (m && typeof m.dispose === 'function') m.dispose();
    } else if (mesh.material && typeof mesh.material.dispose === 'function') {
      mesh.material.dispose();
    }
  } catch (_) {}
}

// ── Op: __studioStressGenScene ───────────────────────────────────────
function opGenScene(opts) {
  const o = opts || {};
  const scene = _getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const r = generateBigScene({
    targetTris: o.targetTris,
    instanceCount: o.instanceCount,
    extent: o.extent,
    seed: o.seed,
    baseScale: o.baseScale,
  });
  scene.add(r.mesh);
  // Bump the render-on-demand gate so the user sees the new mesh
  // without orbiting first.
  try {
    if (typeof window !== 'undefined' && typeof window.__studioInvalidate === 'function') {
      window.__studioInvalidate();
    }
  } catch (_) {}
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    ok: true,
    meshUuid: r.mesh.uuid,
    actualTris: r.actualTris,
    instanceCount: r.instanceCount,
    perInstanceTris: r.perInstanceTris,
    detail: r.detail,
    sceneTime: t1 - t0,
  };
}

// ── Op: __studioStressGenParticleScene ───────────────────────────────
function opGenParticleScene(opts) {
  const o = opts || {};
  const scene = _getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const r = generateBigParticleScene({
    count: o.count,
    life: o.life,
    spawnRate: o.spawnRate,
    seed: o.seed,
    gravity: o.gravity,
  });
  scene.add(r.mesh);
  try {
    if (typeof window !== 'undefined' && typeof window.__studioInvalidate === 'function') {
      window.__studioInvalidate();
    }
  } catch (_) {}
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    ok: true,
    meshUuid: r.mesh.uuid,
    count: r.count,
    sceneTime: t1 - t0,
  };
}

// ── Op: __studioStressMeasureFPS ─────────────────────────────────────
async function opMeasureFPS(opts) {
  const o = opts || {};
  const r = await measureFPS({
    durationMs: o.durationMs,
    includeSamples: o.includeSamples,
    forceRender: o.forceRender,
  });
  return r;
}

// ── Op: __studioStressRender4K ───────────────────────────────────────
async function opRender4K(opts) {
  const o = opts || {};
  const r = await captureScreenshot({
    width: o.width != null ? o.width : 3840,
    height: o.height != null ? o.height : 2160,
    path: o.path,
  });
  return r;
}

// ── Op: __studioStressMemoryProfile ──────────────────────────────────
function opMemoryProfile() {
  let jsHeap = null;
  try {
    // Chromium / V8-only `performance.memory` extension. Spec: a numbers
    // triple in bytes. Other engines return undefined.
    if (typeof performance !== 'undefined' && performance.memory) {
      const m = performance.memory;
      jsHeap = {
        used: m.usedJSHeapSize,
        total: m.totalJSHeapSize,
        limit: m.jsHeapSizeLimit,
      };
    }
  } catch (_) { jsHeap = null; }

  const scene = _getScene();
  const sceneObjects = {
    meshes: 0,
    lights: 0,
    totalTris: 0,
    geometries: 0,
    materials: 0,
    textures: 0,
  };
  let stressMeshes = 0;
  if (scene && typeof scene.traverse === 'function') {
    const seenGeo = new Set();
    const seenMat = new Set();
    const seenTex = new Set();
    scene.traverse((o) => {
      if (!o) return;
      if (o.isLight) sceneObjects.lights++;
      if (o.isMesh) {
        sceneObjects.meshes++;
        sceneObjects.totalTris += _meshTris(o);
        if (o.geometry && !seenGeo.has(o.geometry.uuid)) {
          seenGeo.add(o.geometry.uuid);
          sceneObjects.geometries++;
        }
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m && !seenMat.has(m.uuid)) {
            seenMat.add(m.uuid);
            sceneObjects.materials++;
            // Walk material maps for textures.
            for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap',
                             'emissiveMap', 'aoMap', 'displacementMap', 'bumpMap',
                             'alphaMap', 'envMap', 'lightMap', 'clearcoatMap',
                             'transmissionMap']) {
              const t = m[k];
              if (t && t.uuid && !seenTex.has(t.uuid)) {
                seenTex.add(t.uuid);
                sceneObjects.textures++;
              }
            }
          }
        }
      }
      if (o.userData && o.userData.archdiscStudioStress) stressMeshes++;
    });
  }
  return { ok: true, jsHeap, sceneObjects, stressMeshes };
}

// ── Op: __studioStressClear ──────────────────────────────────────────
function opClear() {
  const scene = _getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const found = findStressMeshes(scene);
  let removed = 0;
  for (const m of found) {
    _disposeMesh(m);
    removed++;
  }
  try {
    if (typeof window !== 'undefined' && typeof window.__studioInvalidate === 'function') {
      window.__studioInvalidate();
    }
  } catch (_) {}
  return { ok: true, removed };
}

// ── Op: __studioStressList ───────────────────────────────────────────
function opList() {
  const scene = _getScene();
  if (!scene) return { ok: true, meshes: [] };
  const found = findStressMeshes(scene);
  return {
    ok: true,
    meshes: found.map((m) => ({
      uuid: m.uuid,
      name: m.name || '',
      kind: (m.userData && m.userData.archdiscStudioStressKind) || 'unknown',
      triCount: _meshTris(m),
      instanceCount: (m.isInstancedMesh && Number.isFinite(m.count)) ? m.count : 1,
    })),
  };
}

// ── Install / uninstall ──────────────────────────────────────────────

const OP_NAMES = [
  '__studioStressGenScene',
  '__studioStressGenParticleScene',
  '__studioStressMeasureFPS',
  '__studioStressRender4K',
  '__studioStressMemoryProfile',
  '__studioStressClear',
  '__studioStressList',
];

export function installStress() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioStressInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioStressInstalled = true;
  const ops = {
    __studioStressGenScene: [opGenScene,
      'Spawn a high-poly InstancedMesh stress scene (target ≈1M tris by default).'],
    __studioStressGenParticleScene: [opGenParticleScene,
      'Spawn a slice-764 Niagara particle stress scene (target ≈200k particles by default).'],
    __studioStressMeasureFPS: [opMeasureFPS,
      'Clock real frame time / FPS over a duration window (default 1 s).'],
    __studioStressRender4K: [opRender4K,
      'Render the live viewport to a PNG dataURL at 4K (or any) resolution.'],
    __studioStressMemoryProfile: [opMemoryProfile,
      'Snapshot V8 heap + scene-object counts + total triangles in flight.'],
    __studioStressClear: [opClear,
      'Remove every stress-generated mesh from the scene + dispose GPU resources.'],
    __studioStressList: [opList,
      'Enumerate every stress mesh currently in the scene.'],
  };
  registerOps(ops, 'rt',
    'Stress test harness — 1M-tri scenes, FPS meter, 4K render, memory profiler (slice 788).');
  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallStress() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  // Tear down any stress meshes still sitting in the scene before
  // dropping the ops — otherwise a re-install would happily double-add.
  try { opClear(); } catch (_) { /* swallow */ }
  unregisterOps(OP_NAMES);
  _installed = false;
  window.__studioStressInstalled = false;
  return { ok: true };
}

export default installStress;
