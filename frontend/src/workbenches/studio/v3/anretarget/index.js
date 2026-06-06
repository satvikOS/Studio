// ArchDisc Studio V3 — animation retargeting installer (slice 762).
//
// Wires the retarget primitives into the V3 op surface:
//
//   __studioAnRetargetMap          → build src/tgt bone-name map
//   __studioAnRetargetExtractClip  → snapshot source per-frame quats
//   __studioAnRetargetApply        → write a clip frame into the target
//   __studioAnRetargetSaveClip     → store a named clip for reuse
//   __studioAnRetargetList         → list saved clips
//
// The Map/clip outputs are JSON-friendly so they survive the e2e
// boundary (Playwright serialises every evaluate() return).

import {
  buildBoneNameMap,
  extractClip,
  applyClip,
} from './retarget.js';
import { registerOps } from '../common/registry.js';

let _installed = false;

const ARM_TAG = 'archdiscStudioRigArmature';

function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function findArmature(uuid) {
  const scene = getScene();
  if (!scene) return null;
  let arm = null;
  scene.traverse((o) => {
    if (arm) return;
    if (o.userData && o.userData[ARM_TAG] && o.uuid === uuid) arm = o;
  });
  return arm;
}

// In-memory clip vault. Keys are user-supplied clip names; entries are
// { clip, frameCount, savedAt } so List can surface useful metadata.
const _clips = new Map();
// The "last extracted" clip — keyed by a synthetic id so the workflow
// (extract → apply) can chain without the caller juggling a name.
let _lastClip = null;
let _lastClipKey = null;

function _genKey() {
  return 'clip-' + Date.now().toString(36) + '-'
    + Math.floor(Math.random() * 1e6).toString(36);
}

export function installAnRetarget() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  const mapBones = (srcUuid, tgtUuid) => {
    const src = findArmature(srcUuid);
    const tgt = findArmature(tgtUuid);
    if (!src) return { ok: false, error: 'source armature not found' };
    if (!tgt) return { ok: false, error: 'target armature not found' };
    const map = buildBoneNameMap(src, tgt);
    const out = {};
    for (const [s, t] of map.entries()) out[s] = t;
    return { ok: true, mapping: out, pairs: map.size };
  };

  const doExtract = (srcUuid, frames) => {
    const src = findArmature(srcUuid);
    if (!src) return { ok: false, error: 'source armature not found' };
    const clip = extractClip(src, frames);
    const key = _genKey();
    _clips.set(key, { clip, frameCount: clip.frames.length, savedAt: Date.now(), name: null });
    _lastClip = clip;
    _lastClipKey = key;
    return {
      ok: true,
      clip: clip.frames,           // JSON-serialisable [frameIdx, {boneName: quat}] tuples
      bonesRest: clip.bonesRest,
      frameCount: clip.frames.length,
      clipKey: key,
    };
  };

  const doApply = (tgtUuid, clipKey, frame) => {
    const tgt = findArmature(tgtUuid);
    if (!tgt) return { ok: false, error: 'target armature not found' };
    let clip = null;
    if (clipKey && _clips.has(clipKey)) {
      clip = _clips.get(clipKey).clip;
    } else if (_lastClip) {
      clip = _lastClip;
    } else {
      return { ok: false, error: 'no clip — extract or save one first' };
    }
    // We need a fresh mapping every apply since the user might point at
    // a different target between calls. Recompute (cheap — O(bones²)).
    // The source armature is not available here by uuid (clips are
    // armature-free once captured) so we rebuild the mapping from the
    // CLIP's bone names directly: any bone that appears in the clip's
    // bonesRest is a "source bone". We assemble a synthetic name list,
    // pair it against the target by canonical-name match.
    const synth = _synthArmFromClip(clip);
    const map = buildBoneNameMap(synth, tgt);
    const r = applyClip(tgt, clip, map, typeof frame === 'number' ? frame : 0);
    return { ...r, mapped: map.size };
  };

  const doSave = (name, clipData) => {
    if (typeof name !== 'string' || !name) {
      return { ok: false, error: 'name required' };
    }
    // If the caller passes a clipData (a previously-extracted object),
    // accept it; otherwise reuse the last-extracted clip.
    const clip = clipData && clipData.frames ? clipData : _lastClip;
    if (!clip) return { ok: false, error: 'no clip — extract one first' };
    const key = 'named:' + name;
    _clips.set(key, {
      clip,
      frameCount: clip.frames.length,
      savedAt: Date.now(),
      name,
    });
    return { ok: true, clipKey: key, name, frameCount: clip.frames.length };
  };

  const doList = () => {
    const out = [];
    for (const [key, v] of _clips.entries()) {
      out.push({
        key,
        name: v.name,
        frameCount: v.frameCount,
        savedAt: v.savedAt,
      });
    }
    return { ok: true, clips: out, count: out.length };
  };

  registerOps({
    __studioAnRetargetMap: [mapBones,
      'Build a fuzzy bone-name map from source → target armature (case-insensitive, mixamorig:/namespace strip, Levenshtein ≤2).'],
    __studioAnRetargetExtractClip: [doExtract,
      'Snapshot every source bone\'s local quaternion at the given frames as a clip — returns clipKey so a later Apply call can reach it.'],
    __studioAnRetargetApply: [doApply,
      'Apply a previously-extracted clip frame onto the target — rest-pose normalises each bone\'s rotation through the source rest pose.'],
    __studioAnRetargetSaveClip: [doSave,
      'Persist the last-extracted clip under a stable name so it can be re-applied across sessions / multiple targets.'],
    __studioAnRetargetList: [doList,
      'List every saved clip (key, name, frameCount, savedAt).'],
  }, 'anim', 'Maya HumanIK-style animation retargeting (slice 762).');

  return { ok: true, alreadyInstalled: false };
}

// Build a stand-in armature object that buildBoneNameMap can traverse,
// from a clip's bonesRest. We don't need real THREE.Bone objects —
// `collectBones` only checks `isBone` and reads `name`.
function _synthArmFromClip(clip) {
  const root = { isBone: false, children: [] };
  const stub = (name) => ({ isBone: true, name, children: [] });
  if (clip && clip.bonesRest) {
    for (const name of Object.keys(clip.bonesRest)) {
      root.children.push(stub(name));
    }
  }
  // Provide a `.traverse` method matching THREE.Object3D so collectBones
  // doesn't trip — it traverses recursively visiting `traverse` callbacks.
  root.traverse = function (cb) {
    cb(this);
    for (const c of this.children) cb(c);
  };
  return root;
}
