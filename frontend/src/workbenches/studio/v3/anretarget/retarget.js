// ArchDisc Studio V3 — Maya HumanIK-style animation retargeting (slice 762).
//
// Solves the daily Maya / MotionBuilder / Mixamo problem: an animation
// clip authored against one armature (the SOURCE) needs to drive a second
// armature (the TARGET) whose bone proportions differ. Three concerns:
//
//   1) Bone-name mapping. Authoring tools name bones inconsistently
//      ("mixamorig:LeftUpLeg" vs "LeftUpLeg" vs "left_up_leg"); we need
//      a fuzzy match that survives the common renamings.
//   2) Rest-pose normalisation. A bone authored with a (1,0,0) world
//      direction can't blindly copy its LOCAL rotation onto a target
//      bone whose rest direction is (0,−1,0); the rotation must be
//      composed through the source's rest-pose inverse and re-expressed
//      in the target's rest pose.
//   3) Per-frame clip apply. With a mapping + normaliser in hand, each
//      frame walks the source's per-bone local quaternions, normalises,
//      and writes the result into the matching target bone — unmatched
//      target bones retain their own rest pose so we don't zero them.
//
// All pure JS. The armature engine (`v3/rig/armature.js`) is the contract:
// every armature root carries `userData.archdiscStudioRigSkeleton` and
// `userData.archdiscStudioRigBones` (a uuid → bone map), so we walk the
// `THREE.Bone` tree directly.

import * as THREE from 'three';

const ARM_TAG = 'archdiscStudioRigArmature';

// ─── Scene helpers ──────────────────────────────────────────────────────

function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function findArmature(armUuid) {
  const scene = getScene();
  if (!scene) return null;
  let arm = null;
  scene.traverse((o) => {
    if (arm) return;
    if (o.userData && o.userData[ARM_TAG] && o.uuid === armUuid) arm = o;
  });
  return arm;
}

// Walk every Bone in an armature root subtree, in deterministic
// breadth-first order so two calls return the same list for the same
// topology.
function collectBones(arm) {
  if (!arm) return [];
  const bones = [];
  arm.traverse((o) => { if (o.isBone) bones.push(o); });
  return bones;
}

// ─── Bone-name fuzzy mapping ────────────────────────────────────────────
//
// Mixamo / Maya / Cascadeur / Cinema4D all decorate bone names with
// distinct prefixes ('mixamorig:', 'mixamorig_', 'Armature|', 'def_',
// 'bn_', 'jnt_', etc.) and use different separators / casing. The
// canonical form strips:
//
//   • Any 'namespace:' prefix (Maya style — 'mixamorig:Hips' → 'Hips').
//   • Any 'rig|' / 'Armature|' prefix (Maya DAG style — chain by '|').
//   • Common skinning prefixes (def_, ctrl_, bn_, jnt_, j_, bone_).
//   • Numeric suffix counters ('Hips01' → 'Hips', '.001' artefacts).
//   • Separators (underscore / dash / dot) so 'left_up_leg' = 'LeftUpLeg'.
//   • Side aliases (l/r/lt/rt/lf/rg → Left/Right when stand-alone tokens).
//
// The result is lowercased so the comparison itself is case-insensitive.

const _NAMESPACE_RE = /^[^:]+:/;
const _DAG_RE = /^.*\|/;
const _PREFIX_RE = /^(def|ctrl|bn|jnt|j|bone|skel|skeleton|rig|root|deform)[_\-.]/i;
const _NUMERIC_SUFFIX_RE = /[_\-.]?\d+$/;
const _SIDE_ALIAS = {
  l: 'left', lt: 'left', lf: 'left', l_: 'left',
  r: 'right', rt: 'right', rg: 'right', r_: 'right',
};

export function canonicalBoneName(name) {
  if (typeof name !== 'string') return '';
  let s = name;
  // Strip "mixamorig:" / namespace prefix.
  s = s.replace(_NAMESPACE_RE, '');
  // Strip Maya "Armature|root|spine" DAG-path prefix.
  s = s.replace(_DAG_RE, '');
  // Strip common skinning prefixes — loop in case of stacked prefixes.
  let prev = '';
  while (prev !== s) { prev = s; s = s.replace(_PREFIX_RE, ''); }
  // Strip numeric trailing counters.
  s = s.replace(_NUMERIC_SUFFIX_RE, '');
  // Strip separators.
  s = s.replace(/[_\-.\s]+/g, '');
  // Expand stand-alone side aliases at the very start (l_arm → leftarm).
  // We checked that before stripping separators; do a final pass on the
  // collapsed form for safety.
  const lower = s.toLowerCase();
  if (lower.startsWith('l') && !lower.startsWith('left') && !lower.startsWith('lower') && lower.length > 1) {
    // Heuristic: a leading 'l' followed by an uppercase token in the
    // original (LArm, LHand) means 'left'. We only know this if the
    // ORIGINAL had a capital after the 'l'.
    const orig = name.replace(_NAMESPACE_RE, '').replace(_DAG_RE, '');
    const firstAlpha = orig.search(/[A-Za-z]/);
    if (firstAlpha >= 0
        && orig[firstAlpha] === 'L'
        && firstAlpha + 1 < orig.length
        && orig[firstAlpha + 1] >= 'A' && orig[firstAlpha + 1] <= 'Z') {
      return 'left' + lower.slice(1);
    }
  }
  if (lower.startsWith('r') && !lower.startsWith('right') && !lower.startsWith('root') && lower.length > 1) {
    const orig = name.replace(_NAMESPACE_RE, '').replace(_DAG_RE, '');
    const firstAlpha = orig.search(/[A-Za-z]/);
    if (firstAlpha >= 0
        && orig[firstAlpha] === 'R'
        && firstAlpha + 1 < orig.length
        && orig[firstAlpha + 1] >= 'A' && orig[firstAlpha + 1] <= 'Z') {
      return 'right' + lower.slice(1);
    }
  }
  return lower;
}

// Levenshtein distance — small alphabets, both strings already
// canonicalised so this is just a guard against single-character
// drift ("Spine1" vs "Spine"). The threshold is the calling code's
// concern.
function levenshtein(a, b) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (!la) return lb;
  if (!lb) return la;
  const dp = new Uint16Array(lb + 1);
  for (let j = 0; j <= lb; j++) dp[j] = j;
  for (let i = 1; i <= la; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= lb; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[lb];
}

// Build a Map<sourceBoneName, targetBoneName> by fuzzy match. The
// algorithm:
//
//   1) Canonicalise every target name once.
//   2) For each source bone, canonicalise its name; if a target shares
//      the same canonical form, that's a direct hit.
//   3) Otherwise, accept the closest target by Levenshtein distance
//      within a small tolerance (≤2 edits OR ≤25 % of the longer name).
//   4) A target may only be claimed once — first source wins; later
//      sources that also map to the claimed target fall through.
//
// The Map's keys are the ORIGINAL source bone names (so the caller can
// use them as-is for lookups) and the values are the ORIGINAL target
// names.
export function buildBoneNameMap(sourceArmature, targetArmature) {
  const srcBones = collectBones(sourceArmature);
  const tgtBones = collectBones(targetArmature);
  const tgtCanon = tgtBones.map((b) => canonicalBoneName(b.name));
  const claimed = new Set();
  const out = new Map();
  // Pass 1 — exact canonical match (preferred).
  for (const src of srcBones) {
    const sc = canonicalBoneName(src.name);
    if (!sc) continue;
    const idx = tgtCanon.findIndex((c, i) => c === sc && !claimed.has(i));
    if (idx >= 0) {
      out.set(src.name, tgtBones[idx].name);
      claimed.add(idx);
    }
  }
  // Pass 2 — small-edit fuzzy match for the survivors.
  for (const src of srcBones) {
    if (out.has(src.name)) continue;
    const sc = canonicalBoneName(src.name);
    if (!sc) continue;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < tgtCanon.length; i++) {
      if (claimed.has(i)) continue;
      const tc = tgtCanon[i];
      if (!tc) continue;
      const d = levenshtein(sc, tc);
      const maxAllowed = Math.max(2, Math.floor(Math.max(sc.length, tc.length) * 0.25));
      if (d < bestD && d <= maxAllowed) { bestD = d; best = i; }
    }
    if (best >= 0) {
      out.set(src.name, tgtBones[best].name);
      claimed.add(best);
    }
  }
  return out;
}

// ─── Rest-pose normalisation ────────────────────────────────────────────
//
// The source bone B_s holds an authored local rotation Q_s relative to
// its own bind/rest rotation R_s (identity for an armature freshly
// built by createArmature, but the matching Mixamo / Maya armature will
// have non-identity rest orientations).
//
// The target's bone B_t has rest rotation R_t. We want the target to
// undergo the SAME *delta* relative to its own rest pose that the
// source undergoes relative to its.
//
//   delta_source = R_s⁻¹ · Q_s
//   Q_t = R_t · delta_source · R_t⁻¹ · R_t   = R_t · delta_source
//
// In quaternion form (B has rest R, current Q): the target bone gets
//
//   Q_t = R_t · R_s⁻¹ · Q_s
//
// applied as its LOCAL rotation. We compose left-to-right (THREE
// quaternion .multiply is post-multiply, q.multiply(p) ⇒ q·p).
//
// The output is a plain `{x,y,z,w}` for serialisation across the
// e2e/JSON boundary — quaternions are tiny so we keep them allocation-
// cheap rather than threading a THREE.Quaternion through.

export function normalizeRetarget(sourceRestPose, targetRestPose, sourceQuat) {
  const Rs = _asQuat(sourceRestPose);
  const Rt = _asQuat(targetRestPose);
  const Qs = _asQuat(sourceQuat);
  const RsInv = Rs.clone().invert();
  const out = new THREE.Quaternion();
  // out = Rt · RsInv · Qs
  out.copy(Rt).multiply(RsInv).multiply(Qs);
  return { x: out.x, y: out.y, z: out.z, w: out.w };
}

function _asQuat(q) {
  if (!q) return new THREE.Quaternion();
  if (q.isQuaternion) return q.clone();
  if (Array.isArray(q) && q.length === 4) {
    return new THREE.Quaternion(q[0], q[1], q[2], q[3]);
  }
  if (typeof q === 'object' && 'x' in q && 'y' in q && 'z' in q && 'w' in q) {
    return new THREE.Quaternion(q.x, q.y, q.z, q.w);
  }
  return new THREE.Quaternion();
}

// ─── Clip extract / apply ───────────────────────────────────────────────
//
// A "clip" is a JSON-friendly array of frames. Each frame is a tuple
// `[frameIndex, { boneName: {x,y,z,w} }]` capturing every bone's LOCAL
// quaternion AND the bone's rest quaternion (so the apply pass can
// normalise without needing the original source armature on hand).
//
// The shape:
//
//   {
//     bonesRest: { boneName: {x,y,z,w} },
//     frames: [
//       [0, { 'mixamorig:Hips': {x,y,z,w}, ... }],
//       [1, { ... }],
//       ...
//     ],
//   }
//
// `frames` is an array of frame INDICES the caller supplies; an empty
// array snapshots the current pose at frame 0. For the canonical
// "extract one pose" use the caller can pass `[0]`.

export function extractClip(sourceArmature, frames) {
  const bones = collectBones(sourceArmature);
  const rest = {};
  // Snapshot the bind rotation per bone. For an armature freshly built
  // via createArmature, the bind rotation is identity (the bones were
  // added with translations only — no rotations specified). For a
  // Mixamo / Maya import the importer is expected to stamp the original
  // bind rotation onto `userData.archdiscStudioRigBoneRest`. We honour
  // that stamp when present, otherwise default to IDENTITY rather than
  // the bone's current local quaternion — using current would lock the
  // current-pose-as-rest, which breaks the normaliser the moment the
  // caller poses the source then extracts (the most common workflow).
  for (const b of bones) {
    const r = (b.userData && b.userData.archdiscStudioRigBoneRest)
      ? b.userData.archdiscStudioRigBoneRest
      : { x: 0, y: 0, z: 0, w: 1 };
    rest[b.name] = { x: r.x, y: r.y, z: r.z, w: r.w };
  }

  const frameList = Array.isArray(frames) && frames.length ? frames.slice() : [0];
  const out = [];
  for (const f of frameList) {
    const snap = {};
    for (const b of bones) {
      snap[b.name] = {
        x: b.quaternion.x, y: b.quaternion.y, z: b.quaternion.z, w: b.quaternion.w,
      };
    }
    out.push([f, snap]);
  }
  return { bonesRest: rest, frames: out };
}

// Apply a clip's `frameIndex` to a target armature using a name map.
// Bones that don't appear in the mapping (or whose match's source has no
// recorded rotation) keep their current local rotation — we never zero
// them, because that would snap the unmatched chain back to bind and
// produce the classic "snap-to-T-pose" retarget artefact.
//
// `mapping` is the Map<sourceName, targetName> from buildBoneNameMap.
// `clip` is the {bonesRest, frames} from extractClip.
// `frame` is the frame index to apply. If the clip has only one frame
// the frame argument is ignored.
//
// Returns { ok, applied, missingSource, unmatchedTarget } — counts that
// let the e2e prove the rest-pose normalisation actually fired on a
// non-trivial number of bones.

export function applyClip(targetArmature, clip, mapping, frame) {
  if (!targetArmature || !clip || !clip.frames || !clip.frames.length) {
    return { ok: false, applied: 0, missingSource: 0, unmatchedTarget: 0 };
  }
  // Find the frame entry. If frame is omitted use the first.
  let entry = clip.frames[0];
  if (typeof frame === 'number') {
    const found = clip.frames.find((f) => f[0] === frame);
    if (found) entry = found;
  }
  const srcRots = entry[1] || {};
  const tgtBones = collectBones(targetArmature);
  // Map from bone name → bone object for O(1) lookup.
  const tgtByName = {};
  for (const b of tgtBones) tgtByName[b.name] = b;
  // Targets we touched, so we can count "unmatched target" left at rest.
  const touched = new Set();
  let applied = 0;
  let missingSource = 0;
  // Iterate mapping rather than tgtBones so we honour the source order.
  for (const [srcName, tgtName] of mapping.entries()) {
    const tgt = tgtByName[tgtName];
    if (!tgt) continue;
    const srcQuat = srcRots[srcName];
    if (!srcQuat) { missingSource++; continue; }
    const srcRest = (clip.bonesRest && clip.bonesRest[srcName]) || { x: 0, y: 0, z: 0, w: 1 };
    // Target rest: prefer the bone's own recorded rest if the armature
    // engine stamped one (the importer's responsibility). Otherwise
    // treat the rest as IDENTITY rather than the current quat — using
    // current would lock whatever pose the target happens to hold at
    // apply time into the normaliser, which is the wrong semantics
    // (e.g. if the caller mid-pose-snapshots the target, the normaliser
    // would treat that snapshot as the bind reference).
    const tgtRest = (tgt.userData && tgt.userData.archdiscStudioRigBoneRest)
      ? tgt.userData.archdiscStudioRigBoneRest
      : { x: 0, y: 0, z: 0, w: 1 };
    const next = normalizeRetarget(srcRest, tgtRest, srcQuat);
    tgt.quaternion.set(next.x, next.y, next.z, next.w);
    touched.add(tgtName);
    applied++;
  }
  // Recompute world matrices + push the new bone matrices to the GPU.
  targetArmature.updateMatrixWorld(true);
  const skel = targetArmature.userData && targetArmature.userData.archdiscStudioRigSkeleton;
  if (skel && typeof skel.update === 'function') skel.update();
  const unmatchedTarget = tgtBones.filter((b) => !touched.has(b.name)).length;
  return { ok: true, applied, missingSource, unmatchedTarget };
}
