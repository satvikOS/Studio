// ArchDisc Studio V3 — sim-bake recorder.
//
// `bakeSim(uuid, durationSec, fps)` resolves the source object by uuid,
// detects its sim kind (slice-632 particle system / slice-684 cloth or
// soft-body or fluid / slice-fx hair) and runs the sim forward in
// fixed dt = 1/fps steps for `durationSec` seconds, snapshotting the
// vertex position attribute (or per-strand position arrays for hair)
// into a Float32Array indexed by frame. The cached entry lands in
// store.js keyed by the source uuid.
//
// Step driver dispatches into the existing public op surface:
//
//   particles → window.__studioParticleStep(dt)
//   cloth     → window.__studioClothStep(dt)
//   softbody  → window.__studioSoftBodyStep(dt)
//   fluid     → window.__studioFluidStep(dt)
//   hair      → window.__studioFXHairStep(dt)
//
// Why dispatch through the public ops rather than calling stepOne()? We
// never reach into sim/fx internals so the bake stays correct even if
// those modules change their internal storage. The public op surface
// is the contract.
//
// Snapshot strategy:
//   – meshes  / points : geometry.attributes.position.array (Float32Array)
//   – hair             : per-strand .positions Float32Arrays packed
//                         strand-major into a single per-frame view.
//
// Result shape per spec:
//   { uuid, frames, fps, durationSec, bytes, kind?, vertCount? }

import { setCached } from './store.js';

// ───── helpers ─────────────────────────────────────────────────────────────
function _getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function _findByUuid(uuid) {
  const scene = _getScene();
  if (!scene) return null;
  return scene.getObjectByProperty('uuid', uuid) || null;
}

// Detect what kind of sim source `obj` is. Returns one of:
// 'particles' | 'cloth' | 'softbody' | 'fluid' | 'hair' | null.
//
// We probe userData tags in priority order — hair before particles
// because some hair builds also stash particles userData. Cloth /
// softbody / fluid tags are mutually exclusive in practice.
export function detectKind(obj) {
  if (!obj) return null;
  const ud = obj.userData || {};
  if (ud.archdiscStudioHair) return 'hair';
  if (ud.archdiscStudioCloth) return 'cloth';
  if (ud.archdiscStudioSoftBody) return 'softbody';
  if (ud.archdiscStudioFluid) return 'fluid';
  if (ud.archdiscStudioParticles) return 'particles';
  return null;
}

// List every bakeable object in the scene. Used by the panel and by the
// __studioSimBakeListSources op.
export function listBakeableSources() {
  const scene = _getScene();
  if (!scene) return [];
  const out = [];
  scene.traverse((o) => {
    const k = detectKind(o);
    if (!k) return;
    let vertCount = 0;
    if (k === 'hair') {
      const s = o.userData.archdiscStudioHair;
      if (s && s.strands) {
        for (let i = 0; i < s.strands.length; i++) {
          vertCount += (s.strands[i].segCount + 1);
        }
      }
    } else {
      const pos = o.geometry
        && o.geometry.attributes
        && o.geometry.attributes.position;
      vertCount = pos ? pos.count : 0;
    }
    out.push({
      uuid: o.uuid,
      kind: k,
      name: o.name || '(unnamed)',
      vertCount,
    });
  });
  return out;
}

// Resolve the per-kind stepper. Returns a function (dt) => void OR null.
// We snapshot the function at bake-start so a later install/uninstall of
// the sub-system doesn't interfere with the bake in progress.
function _resolveStepper(kind) {
  if (typeof window === 'undefined') return null;
  switch (kind) {
    case 'particles': return typeof window.__studioParticleStep === 'function' ? window.__studioParticleStep : null;
    case 'cloth':     return typeof window.__studioClothStep    === 'function' ? window.__studioClothStep    : null;
    case 'softbody':  return typeof window.__studioSoftBodyStep === 'function' ? window.__studioSoftBodyStep : null;
    case 'fluid':     return typeof window.__studioFluidStep    === 'function' ? window.__studioFluidStep    : null;
    case 'hair':      return typeof window.__studioFXHairStep   === 'function' ? window.__studioFXHairStep   : null;
    default: return null;
  }
}

// Snapshot one frame of geometry vertex positions.
// Pre-allocated destination view: dst[ofs .. ofs+vertCount*3] ← src.
function _snapshotGeometry(obj, dst, ofs, vertCount) {
  const arr = obj.geometry.attributes.position.array;
  const N = vertCount * 3;
  // Defensive: clamp in case the attribute resized between frames (it
  // shouldn't for any of our sim kinds, but be safe).
  const M = Math.min(N, arr.length);
  for (let i = 0; i < M; i++) dst[ofs + i] = arr[i];
}

// Snapshot one frame of hair positions, packed strand-major.
function _snapshotHair(obj, dst, ofs, perFrameFloats) {
  const s = obj.userData.archdiscStudioHair;
  if (!s || !s.strands) return;
  let w = 0;
  for (let i = 0; i < s.strands.length; i++) {
    const src = s.strands[i].positions;
    const L = src.length;
    for (let k = 0; k < L; k++) {
      if (w + k >= perFrameFloats) break;
      dst[ofs + w + k] = src[k];
    }
    w += L;
  }
}

// Compute the hair per-frame float count (sum of every strand's
// (segCount+1)·3).
function _hairPerFrameFloats(obj) {
  const s = obj.userData.archdiscStudioHair;
  if (!s || !s.strands) return 0;
  let n = 0;
  for (let i = 0; i < s.strands.length; i++) {
    n += (s.strands[i].segCount + 1) * 3;
  }
  return n;
}

// ───── public ──────────────────────────────────────────────────────────────

// bakeSim(uuid, durationSec, fps)
//
// Walks `frames = round(durationSec · fps)` ticks of the relevant
// sub-sim at fixed dt = 1/fps, snapshotting each frame into a
// pre-allocated Float32Array.
//
// Returns:
//   { ok: true,  uuid, kind, frames, fps, durationSec, bytes, vertCount }
//   { ok: false, error, uuid }
//
// On a kind we don't recognise OR when the stepper isn't installed yet
// we return `{ ok: false, reason }` so callers can surface a useful
// message instead of throwing.
export function bakeSim(uuid, durationSec, fps) {
  const obj = _findByUuid(uuid);
  if (!obj) return { ok: false, uuid, reason: 'no object' };
  const kind = detectKind(obj);
  if (!kind) return { ok: false, uuid, reason: 'not a sim source' };
  const step = _resolveStepper(kind);
  if (typeof step !== 'function') {
    return { ok: false, uuid, kind, reason: `stepper __studio${kind}Step missing` };
  }

  const fpsClamped = Math.max(1, Math.min(240, Math.floor(Number(fps) || 30)));
  const durClamped = Math.max(0.05, Math.min(120, Number(durationSec) || 1));
  const frames = Math.max(1, Math.round(durClamped * fpsClamped));
  const dt = 1.0 / fpsClamped;

  // Per-frame float count + total buffer size.
  let perFrameFloats = 0;
  let vertCount = 0;
  if (kind === 'hair') {
    perFrameFloats = _hairPerFrameFloats(obj);
    vertCount = perFrameFloats / 3;
  } else {
    const pos = obj.geometry
      && obj.geometry.attributes
      && obj.geometry.attributes.position;
    if (!pos) return { ok: false, uuid, kind, reason: 'no position attribute' };
    vertCount = pos.count;
    perFrameFloats = vertCount * 3;
  }

  if (perFrameFloats === 0) {
    return { ok: false, uuid, kind, reason: 'zero verts' };
  }

  // Guard against accidentally giant bakes — 256 MB ceiling.
  const totalFloats = frames * perFrameFloats;
  const totalBytes = totalFloats * 4;
  const MAX_BYTES = 256 * 1024 * 1024;
  if (totalBytes > MAX_BYTES) {
    return {
      ok: false, uuid, kind,
      reason: `bake would be ${(totalBytes / 1048576).toFixed(1)} MB > 256 MB cap`,
    };
  }

  const buffer = new Float32Array(totalFloats);

  for (let f = 0; f < frames; f++) {
    // Step first so frame 0 captures the state after one dt.
    try { step(dt); } catch (_) { /* keep going so partial bake still lands */ }
    const ofs = f * perFrameFloats;
    if (kind === 'hair') {
      _snapshotHair(obj, buffer, ofs, perFrameFloats);
    } else {
      _snapshotGeometry(obj, buffer, ofs, vertCount);
    }
  }

  const entry = {
    uuid,
    kind,
    name: obj.name || '(unnamed)',
    fps: fpsClamped,
    frames,
    durationSec: frames * dt,
    vertCount,
    perFrameFloats,
    buffer,
    bytes: buffer.byteLength,
    bakedAt: (typeof performance !== 'undefined') ? performance.now() : Date.now(),
    paused: true,
  };
  if (kind === 'hair') {
    const s = obj.userData.archdiscStudioHair;
    entry.strands = {
      count: s.strands.length,
      segCount: s.strands[0] ? s.strands[0].segCount : 0,
    };
  }
  setCached(uuid, entry);

  return {
    ok: true,
    uuid,
    kind,
    frames,
    fps: fpsClamped,
    durationSec: entry.durationSec,
    bytes: entry.bytes,
    vertCount,
  };
}
