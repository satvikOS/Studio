// ArchDisc Studio V3 — sim-bake playback / scrubber.
//
// Two top-level operations:
//
//   • scrubToFrame(uuid, frameIdx)
//       Copies the cached frame back into the live source object's
//       vertex storage (geometry.attributes.position.array for mesh-
//       and-points-based sims, per-strand arrays for hair) and marks
//       the position attribute needsUpdate. For hair the merged tube
//       geometry is rebuilt to reflect the new strand positions.
//
//   • playCached(uuid, fps?)
//       Chains a __studioAnimTick link tagged __simbakeChannel:uuid
//       that auto-advances a frame counter at the (optionally
//       overridden) playback fps. Pause / Resume / Stop are wired up
//       independently per cached uuid so the user can scrub one bake
//       while another plays.
//
// Channels are stored in a module-level Map so multiple bakes can
// playback at once without colliding. Splicing the tick link is the
// same pattern used by sim/index.js and fx/index.js — walk via __prev,
// rebuild without the matching link.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { getCached, hasCached } from './store.js';

// channels: uuid → { playing, frame, fps, last, prev?, tick?, vp? }
const _channels = new Map();

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

// ─── hair re-render ────────────────────────────────────────────────────────
// Hair's geometry isn't a single position attribute we can write into —
// it's a merged TubeGeometry rebuilt every step. We recreate the merged
// tube exactly the same way fx/hair.js does, but inline so we don't
// reach into that module's internals (it deliberately doesn't export
// _buildMergedGeometry).
function _rebuildHairGeometry(mesh) {
  const s = mesh.userData && mesh.userData.archdiscStudioHair;
  if (!s) return;
  const geos = [];
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3()]);
  curve.curveType = 'catmullrom';
  curve.tension = 0.5;
  const radialSegments = s.radialSegments || 4;
  const radius = s.radius || 0.01;
  for (let i = 0; i < s.strands.length; i++) {
    const strand = s.strands[i];
    const positions = strand.positions;
    const segs = strand.segCount;
    const pts = [];
    for (let k = 0; k <= segs; k++) {
      pts.push(new THREE.Vector3(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]));
    }
    curve.points = pts;
    const tube = new THREE.TubeGeometry(curve, Math.max(2, segs * 2), radius, radialSegments, false);
    geos.push(tube);
  }
  const merged = (geos.length > 0)
    ? (mergeGeometries(geos, false) || new THREE.BufferGeometry())
    : new THREE.BufferGeometry();
  for (let i = 0; i < geos.length; i++) {
    if (geos[i] && typeof geos[i].dispose === 'function') geos[i].dispose();
  }
  const old = mesh.geometry;
  mesh.geometry = merged;
  if (old && typeof old.dispose === 'function') old.dispose();
}

// ─── scrub ────────────────────────────────────────────────────────────────
// Copy the F-th cached frame into the live source. Returns ok:false if
// the bake or source object is missing or the index is out of range.
export function scrubToFrame(uuid, frameIdx) {
  const entry = getCached(uuid);
  if (!entry) return { ok: false, error: 'no cached bake' };
  const obj = _findByUuid(uuid);
  if (!obj) return { ok: false, error: 'source object missing' };
  const f = Math.max(0, Math.min(entry.frames - 1, Math.floor(Number(frameIdx) || 0)));
  const perFrame = entry.perFrameFloats;
  const ofs = f * perFrame;
  const buf = entry.buffer;

  if (entry.kind === 'hair') {
    const s = obj.userData && obj.userData.archdiscStudioHair;
    if (!s || !s.strands) return { ok: false, error: 'hair source malformed' };
    let r = 0;
    for (let i = 0; i < s.strands.length; i++) {
      const pos = s.strands[i].positions;
      const prev = s.strands[i].prev;
      const L = pos.length;
      for (let k = 0; k < L; k++) {
        pos[k] = buf[ofs + r + k];
        // Sync prev so the Verlet integrator (if it later resumes)
        // doesn't snap things back from a stale prev frame.
        if (prev) prev[k] = pos[k];
      }
      r += L;
    }
    _rebuildHairGeometry(obj);
  } else {
    const pos = obj.geometry
      && obj.geometry.attributes
      && obj.geometry.attributes.position;
    if (!pos) return { ok: false, error: 'no position attribute' };
    const arr = pos.array;
    const N = Math.min(perFrame, arr.length);
    for (let i = 0; i < N; i++) arr[i] = buf[ofs + i];
    pos.needsUpdate = true;
    if (obj.geometry && typeof obj.geometry.computeBoundingSphere === 'function') {
      try { obj.geometry.computeBoundingSphere(); } catch (_) {}
    }
    if (obj.isMesh && obj.geometry && typeof obj.geometry.computeVertexNormals === 'function') {
      try { obj.geometry.computeVertexNormals(); } catch (_) {}
    }
  }

  // Update channel frame index for any in-flight playback so a manual
  // scrub stays in sync with the play head.
  const ch = _channels.get(uuid);
  if (ch) ch.frame = f;
  return { ok: true, frame: f, kind: entry.kind };
}

// ─── chain helpers (mirrors sim/index.js pattern) ─────────────────────────
function _spliceTick(viewport, tag) {
  if (!viewport) return;
  const links = [];
  let cur = viewport.__studioAnimTick;
  while (cur) { links.push(cur); cur = cur.__prev; }
  const kept = links.filter((l) => l.__simbakeChannel !== tag);
  for (let i = 0; i < kept.length - 1; i++) kept[i].__prev = kept[i + 1];
  if (kept.length) kept[kept.length - 1].__prev = null;
  viewport.__studioAnimTick = kept[0] || null;
}

// ─── play / pause ─────────────────────────────────────────────────────────
// playCached(uuid, fps?) — auto-advance through cached frames at fps.
// Defaults to the bake's own fps so the playback runs at the speed the
// sim was sampled at.
export function playCached(uuid, fps) {
  if (!hasCached(uuid)) return { ok: false, error: 'no cached bake' };
  const entry = getCached(uuid);
  const v = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  if (!v) return { ok: false, error: 'no viewport' };

  // If a channel for this uuid already exists, resume it.
  let ch = _channels.get(uuid);
  if (!ch) {
    ch = {
      uuid,
      playing: true,
      frame: 0,
      fps: Number(fps) || entry.fps,
      last: (typeof performance !== 'undefined') ? performance.now() : Date.now(),
      tick: null,
      prev: null,
      vp: v,
    };
    _channels.set(uuid, ch);
  } else {
    ch.playing = true;
    ch.fps = Number(fps) || ch.fps || entry.fps;
    ch.last = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  }

  // Build the chained tick if missing.
  const tag = uuid;
  let alreadyChained = false;
  {
    let cur = v.__studioAnimTick;
    while (cur) { if (cur.__simbakeChannel === tag) { alreadyChained = true; break; } cur = cur.__prev; }
  }
  if (!alreadyChained) {
    const prev = v.__studioAnimTick;
    const tick = (now) => {
      const t = (typeof now === 'number') ? now : ((typeof performance !== 'undefined') ? performance.now() : Date.now());
      const c = _channels.get(uuid);
      if (c && c.playing) {
        const e = getCached(uuid);
        if (e) {
          const frameDt = 1000 / Math.max(1, c.fps);
          let advance = Math.floor((t - c.last) / frameDt);
          if (advance > 0) {
            c.frame = (c.frame + advance) % e.frames;
            c.last = t;
            scrubToFrame(uuid, c.frame);
          }
        }
      }
      if (prev) { try { prev(t); } catch (_) {} }
    };
    tick.__simbake = true;
    tick.__simbakeChannel = tag;
    tick.__prev = prev;
    v.__studioAnimTick = tick;
    ch.tick = tick;
    ch.prev = prev;
  }

  return { ok: true, uuid, fps: ch.fps, frames: entry.frames };
}

export function pauseCached(uuid) {
  const ch = _channels.get(uuid);
  if (!ch) return { ok: false, error: 'no channel' };
  ch.playing = false;
  return { ok: true, paused: true, frame: ch.frame };
}

export function stopCached(uuid) {
  const ch = _channels.get(uuid);
  if (!ch) return { ok: false, error: 'no channel' };
  ch.playing = false;
  const v = ch.vp || (typeof window !== 'undefined' ? window.__archdiscViewport : null);
  _spliceTick(v, uuid);
  _channels.delete(uuid);
  return { ok: true, stopped: true };
}

export function stopAll() {
  const ids = Array.from(_channels.keys());
  for (const id of ids) stopCached(id);
  return { ok: true, stopped: ids.length };
}

export function listChannels() {
  const out = [];
  _channels.forEach((c, uuid) => out.push({
    uuid, playing: c.playing, frame: c.frame, fps: c.fps,
  }));
  return out;
}

export function getChannelFrame(uuid) {
  const ch = _channels.get(uuid);
  if (!ch) return -1;
  return ch.frame;
}
