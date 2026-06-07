// ArchDisc Studio V3 — BVH clip player (slice 887).
//
// Takes a parsed clip from parser.js + a THREE.SkinnedMesh / armature
// and applies a frame's worth of channel values to the live bone graph.
//
// Two mechanics are involved:
//
//   1. Bone-name fuzzy matching.  BVH files name bones however the
//      capture software wants. Mixamo prefixes everything with
//      "mixamorig:" / "mixamorig_". CMU uses descriptive names. The
//      live armature was built by the artist with their own taste
//      (often via FBX import which adds an "Armature|" Maya DAG path
//      or "DEF-" Rigify prefix). We canonicalise both sides and match.
//
//   2. Channel-order rotation composition.  BVH stores rotations as
//      Euler triples in the channel order declared per joint (typically
//      ZXY for Mixamo, ZYX for some MotionBuilder exports, XYZ for
//      hand-crafted clips). We compose the rotation in that exact
//      order — naive XYZ composition would cause limb-twist artefacts.
//
// All maths goes through THREE so we get a real quaternion on each
// bone — same path Three's built-in AnimationMixer takes.

import * as THREE from 'three';
import { readJointSample } from './parser.js';

// ── Canonical-name fuzzy matching ───────────────────────────────────

// Sample, lowercased, stripped of every cosmetic prefix /
// separator / numeric suffix. The same shape as the canonical-name
// helper in v3/anretarget/ — kept independent so this module stays
// importable in isolation.
const _NAMESPACE_RE = /^[A-Za-z_][A-Za-z0-9_]*:/; // mixamorig:Hips
const _DAG_RE = /^([^|]+\|)+/;                   // Armature|root|Hips
const _PREFIX_RE = /^(def_|ctrl_|bn_|jnt_|j_|bone_|mixamorig_)/i;
const _NUMERIC_SUFFIX_RE = /\d+$/;

export function canonicalBoneName(name) {
  if (typeof name !== 'string') return '';
  let s = name;
  s = s.replace(_NAMESPACE_RE, '');
  s = s.replace(_DAG_RE, '');
  let prev = '';
  while (prev !== s) { prev = s; s = s.replace(_PREFIX_RE, ''); }
  // Common Mixamo-style joints carry a trailing digit (Spine1, Spine2),
  // which is meaningful — leave those alone. Only strip when the name
  // is alpha+digits+digits (DEF_arm.001 → arm).
  s = s.replace(/\.\d+$/, '');
  // Strip separators, collapse case.
  s = s.replace(/[_\-.\s|]+/g, '');
  return s.toLowerCase();
}

// Tiny Levenshtein for last-resort fuzzy match (off-by-one drift).
function _lev(a, b) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (!la) return lb;
  if (!lb) return la;
  let prev = new Uint16Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  let cur = new Uint16Array(lb + 1);
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[lb];
}

// Build a name-map clip→armature. The result is { mappedCount, missingClipBones,
// matches: { clipBoneName → armatureBoneName } }.
export function buildBoneMap(clipBoneNames, armatureBones) {
  const matches = Object.create(null);
  const missing = [];
  const armCanon = armatureBones.map((b) => ({ bone: b, canon: canonicalBoneName(b.name) }));
  // Pre-bucket by canonical form for O(N) lookup.
  const armByCanon = new Map();
  for (const e of armCanon) {
    if (!armByCanon.has(e.canon)) armByCanon.set(e.canon, e.bone);
  }
  for (const cn of clipBoneNames) {
    const cc = canonicalBoneName(cn);
    let hit = armByCanon.get(cc);
    if (!hit) {
      // Fall back to Levenshtein ≤2 (off-by-one drift).
      let best = null;
      let bestDist = 3;
      for (const e of armCanon) {
        const d = _lev(cc, e.canon);
        if (d < bestDist) { bestDist = d; best = e.bone; if (d === 0) break; }
      }
      if (best) hit = best;
    }
    if (hit) matches[cn] = hit.name;
    else missing.push(cn);
  }
  return { matches, missingClipBones: missing, mappedCount: Object.keys(matches).length };
}

// ── Channel-order rotation composition ──────────────────────────────

const _qX = new THREE.Quaternion();
const _qY = new THREE.Quaternion();
const _qZ = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();
const _AX_X = new THREE.Vector3(1, 0, 0);
const _AX_Y = new THREE.Vector3(0, 1, 0);
const _AX_Z = new THREE.Vector3(0, 0, 1);

// Compose a quaternion from the per-axis Euler triple in the file's
// declared channel order. `rotation` is degrees, `order` is the
// concatenation of the channel letters in the order they appeared in
// CHANNELS (e.g. "ZXY"). The composition mirrors BVH semantics:
// child = parent * Rz * Rx * Ry  (for ZXY).
//
// Math reference: same as THREE's setFromEuler "ZXY" / "XYZ" cases —
// we re-implement because we need to respect arbitrary BVH orderings
// (and THREE's Euler.set rejects orders like "ZYX" depending on its
// build flags).
export function eulerToQuaternionByOrder(rotation, order, out) {
  const target = out || new THREE.Quaternion();
  const [rx, ry, rz] = rotation;
  const dx = THREE.MathUtils.degToRad(rx);
  const dy = THREE.MathUtils.degToRad(ry);
  const dz = THREE.MathUtils.degToRad(rz);
  _qX.setFromAxisAngle(_AX_X, dx);
  _qY.setFromAxisAngle(_AX_Y, dy);
  _qZ.setFromAxisAngle(_AX_Z, dz);
  target.identity();
  // The order string is read left-to-right.
  for (const ch of order) {
    if (ch === 'X') target.multiply(_qX);
    else if (ch === 'Y') target.multiply(_qY);
    else if (ch === 'Z') target.multiply(_qZ);
  }
  return target;
}

// ── Armature discovery ─────────────────────────────────────────────

// Find the bone graph attached to a scene object by uuid.
// Accepts a SkinnedMesh uuid, an armature-root Bone uuid, or any
// Object3D that has bones underneath.
export function collectBones(scene, uuid) {
  if (!scene) return [];
  const target = scene.getObjectByProperty('uuid', uuid);
  if (!target) return [];
  const bones = [];
  // Three exposes .skeleton on SkinnedMesh; prefer that path when
  // available because it gives us THREE's official traversal order.
  if (target.isSkinnedMesh && target.skeleton?.bones) {
    return target.skeleton.bones.slice();
  }
  target.traverse((o) => { if (o.isBone) bones.push(o); });
  return bones;
}

// ── Apply a frame ───────────────────────────────────────────────────

const _frameTmpQ = new THREE.Quaternion();
const _frameTmpV = new THREE.Vector3();

// Apply a single frame from a parsed clip to a live armature.
//
// clip:         output of parser.exportClip OR a parsed result still
//               carrying skeleton + motion.
// armatureUuid: the SkinnedMesh / Bone / armature-root UUID.
// frameIndex:   integer frame number.
// opts.boneMap: optional pre-built map (returned by buildBoneMap) —
//               recommended when applying many consecutive frames.
//
// Returns { ok, applied, mapped, missing, warnings? }.
export function applyClipFrame(clip, scene, armatureUuid, frameIndex, opts) {
  if (!clip || !scene) return { ok: false, error: 'no clip or scene' };
  // Accept either a fresh parseBVH result or the exportClip wrapper.
  const skeleton = clip.skeleton || null;
  const motion = clip.motion || null;
  let bonesMeta, frames, totalChannels, frameCount;
  if (skeleton && motion) {
    bonesMeta = skeleton.jointsInOrder.map((j) => ({
      name: j.uniqueName || j.name,
      channels: j.channels,
      channelIndex: j.channelIndex,
      type: j.type,
      node: j,
    }));
    frames = motion.frames;
    totalChannels = skeleton.totalChannels;
    frameCount = motion.frameCount;
  } else if (clip.bones && clip.frames) {
    bonesMeta = clip.bones.filter((b) => b.type !== 'end').map((b) => ({
      name: b.name,
      channels: b.channels,
      channelIndex: b.channelIndex,
      type: b.type,
      node: null,
    }));
    frames = clip.frames;
    totalChannels = clip.totalChannels;
    frameCount = clip.frameCount;
  } else {
    return { ok: false, error: 'malformed clip' };
  }
  if (frameIndex < 0 || frameIndex >= frameCount) {
    return { ok: false, error: `frame ${frameIndex} out of range 0..${frameCount - 1}` };
  }
  const armBones = collectBones(scene, armatureUuid);
  if (!armBones.length) return { ok: false, error: 'no bones under armature' };

  const map = opts?.boneMap ? opts.boneMap : buildBoneMap(bonesMeta.map((b) => b.name), armBones);
  const armByName = Object.create(null);
  for (const b of armBones) armByName[b.name] = b;

  const row = frames.subarray(frameIndex * totalChannels, frameIndex * totalChannels + totalChannels);
  let applied = 0;
  for (const cb of bonesMeta) {
    const targetName = map.matches[cb.name];
    if (!targetName) continue;
    const bone = armByName[targetName];
    if (!bone) continue;
    // Reconstruct the sample by using the joint metadata.
    const sample = readJointSample(
      { type: cb.type, channels: cb.channels, channelIndex: cb.channelIndex },
      row,
    );
    if (!sample) continue;
    eulerToQuaternionByOrder(sample.rotation, sample.rotationOrder, _frameTmpQ);
    bone.quaternion.copy(_frameTmpQ);
    if (sample.position) {
      _frameTmpV.set(sample.position[0], sample.position[1], sample.position[2]);
      bone.position.copy(_frameTmpV);
    }
    applied++;
  }

  // Push the matrix update — SkinnedMesh GPU bone texture needs it.
  for (const b of armBones) {
    // Update bones whose ancestors changed.
    b.updateMatrix();
  }
  const target = scene.getObjectByProperty('uuid', armatureUuid);
  if (target?.skeleton?.update) {
    try { target.skeleton.update(); } catch (_) { /* skeleton may be partial */ }
  }
  if (target?.updateMatrixWorld) {
    try { target.updateMatrixWorld(true); } catch (_) {}
  }

  return {
    ok: true,
    applied,
    mapped: map.mappedCount,
    missing: map.missingClipBones,
    frame: frameIndex,
  };
}

export default applyClipFrame;
