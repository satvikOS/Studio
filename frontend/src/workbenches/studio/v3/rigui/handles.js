// ArchDisc Studio V3 — IK handle gizmo meshes.
//
// One small sphere per bone, dropped into the scene at the bone's world
// position so the user can grab + drag it. Every handle carries:
//
//   userData.archdiscStudioIKHandle = { boneUuid, chainLength, armatureUuid }
//   userData.archdiscStudioGizmo    = true   (so scrubbers skip it)
//
// Handle position is the single source of truth for the IK target. The
// dragger (dragger.js) calls __studioRigSolveIK(boneUuid, [x,y,z], iters,
// chainLength) whenever the handle moves, then refreshHandles() re-syncs
// every OTHER handle back to its bone's fresh world position (because the
// IK pass moved them too).
//
// `showHandles(armatureUuid, opts)` walks the armature's bone tree and
// adds a handle per end-effector bone (no Bone children) by default. Pass
// `opts.includeAll = true` to handle EVERY bone in the chain — useful for
// posing the shoulder directly. `opts.size` overrides the sphere radius
// (default 0.06 m, in scene units).
//
// `hideHandles(armatureUuid?)` removes every handle (optionally filtered
// by armature uuid). `listHandles()` reports what's live. `setChainLength`
// re-tags an existing handle so subsequent drags use a different chain.
//
// Everything here is pure — no DOM events, no orbit-control twiddling.
// dragger.js / index.js own the pointer flow.

import * as THREE from 'three';

const HANDLE_TAG = 'archdiscStudioIKHandle';
const GIZMO_TAG = 'archdiscStudioGizmo';
const DEFAULT_SIZE = 0.06;
const DEFAULT_CHAIN = 3;
const DEFAULT_ITERS = 8;

function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function findArmature(armatureUuid) {
  const scene = getScene();
  if (!scene) return null;
  let arm = null;
  scene.traverse((o) => {
    if (arm) return;
    if (o.userData && o.userData.archdiscStudioRigArmature && o.uuid === armatureUuid) arm = o;
  });
  return arm;
}

function findHandle(handleUuid) {
  const scene = getScene();
  if (!scene) return null;
  let h = null;
  scene.traverse((o) => {
    if (h) return;
    if (o.userData && o.userData[HANDLE_TAG] && o.uuid === handleUuid) h = o;
  });
  return h;
}

function findBone(boneUuid) {
  const scene = getScene();
  if (!scene) return null;
  let bone = null;
  scene.traverse((o) => {
    if (bone) return;
    if (o.isBone && o.uuid === boneUuid) bone = o;
  });
  return bone;
}

function findArmatureForBone(bone) {
  let cur = bone;
  while (cur) {
    if (cur.userData && cur.userData.archdiscStudioRigArmature) return cur;
    cur = cur.parent;
  }
  return null;
}

function endEffectorBones(arm) {
  const out = [];
  arm.traverse((b) => {
    if (!b.isBone) return;
    // The auto-created Root bone (length 0) isn't a useful IK target.
    if (b.userData && b.userData.archdiscStudioRigBoneLength === 0
      && b.parent && b.parent.userData && b.parent.userData.archdiscStudioRigArmature) {
      return;
    }
    const hasBoneChild = (b.children || []).some((c) => c.isBone);
    if (!hasBoneChild) out.push(b);
  });
  return out;
}

function makeHandleMesh(size, color) {
  const geom = new THREE.SphereGeometry(size, 16, 12);
  const mat = new THREE.MeshBasicMaterial({
    color: color || 0x55ddff,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  // Always render on top so the handle never disappears inside the mesh.
  mesh.renderOrder = 999;
  return mesh;
}

function disposeHandle(handle) {
  try {
    if (handle.geometry && typeof handle.geometry.dispose === 'function') handle.geometry.dispose();
  } catch (_) {}
  try {
    if (handle.material && typeof handle.material.dispose === 'function') handle.material.dispose();
  } catch (_) {}
}

export function showHandles(armatureUuid, opts = {}) {
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const arm = findArmature(armatureUuid);
  if (!arm) return { ok: false, error: 'no armature' };
  // Refresh world matrices so handles drop on the LIVE positions, not
  // the stale ones from before the last bone rotation.
  arm.updateMatrixWorld(true);

  // Drop any prior handles bound to this armature so re-call is idempotent.
  hideHandles(armatureUuid);

  const includeAll = !!opts.includeAll;
  const size = Number.isFinite(opts.size) && opts.size > 0 ? Number(opts.size) : DEFAULT_SIZE;
  const chainLength = Number.isFinite(opts.chainLength) && opts.chainLength > 0
    ? Math.floor(Number(opts.chainLength))
    : DEFAULT_CHAIN;
  const iterations = Number.isFinite(opts.iterations) && opts.iterations > 0
    ? Math.floor(Number(opts.iterations))
    : DEFAULT_ITERS;
  const color = opts.color != null ? opts.color : 0x55ddff;

  const targets = includeAll
    ? (() => {
      const all = [];
      arm.traverse((b) => {
        if (!b.isBone) return;
        if (b.userData && b.userData.archdiscStudioRigBoneLength === 0
          && b.parent && b.parent.userData && b.parent.userData.archdiscStudioRigArmature) return;
        all.push(b);
      });
      return all;
    })()
    : endEffectorBones(arm);

  const out = [];
  const wp = new THREE.Vector3();
  for (const bone of targets) {
    bone.getWorldPosition(wp);
    const mesh = makeHandleMesh(size, color);
    mesh.position.copy(wp);
    mesh.name = `IKHandle:${bone.name || bone.uuid.slice(0, 6)}`;
    mesh.userData[HANDLE_TAG] = {
      boneUuid: bone.uuid,
      armatureUuid: arm.uuid,
      chainLength,
      iterations,
      size,
    };
    mesh.userData[GIZMO_TAG] = true;
    scene.add(mesh);
    out.push({
      uuid: mesh.uuid,
      boneUuid: bone.uuid,
      boneName: bone.name || '',
      position: [wp.x, wp.y, wp.z],
      chainLength,
    });
  }
  return { ok: true, armatureUuid: arm.uuid, count: out.length, handles: out };
}

export function hideHandles(armatureUuid) {
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const doomed = [];
  scene.traverse((o) => {
    if (!o.userData || !o.userData[HANDLE_TAG]) return;
    if (armatureUuid && o.userData[HANDLE_TAG].armatureUuid !== armatureUuid) return;
    doomed.push(o);
  });
  for (const h of doomed) {
    if (h.parent) h.parent.remove(h);
    disposeHandle(h);
  }
  return { ok: true, removed: doomed.length };
}

export function listHandles() {
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene', count: 0, handles: [] };
  const out = [];
  scene.traverse((o) => {
    if (!o.userData || !o.userData[HANDLE_TAG]) return;
    const tag = o.userData[HANDLE_TAG];
    out.push({
      uuid: o.uuid,
      boneUuid: tag.boneUuid,
      armatureUuid: tag.armatureUuid,
      chainLength: tag.chainLength,
      iterations: tag.iterations,
      position: [o.position.x, o.position.y, o.position.z],
    });
  });
  return { ok: true, count: out.length, handles: out };
}

// Programmatic drag — used by dragger.js on pointermove and by tests
// driving the handle without real mouse events. Moves the handle to
// `worldPos` and re-runs the IK solver. Returns the solver result + the
// effector's actual achieved world position (the IK may not perfectly
// reach the target if the chain is too short).
export function dragHandle(handleUuid, worldPos) {
  if (!Array.isArray(worldPos) || worldPos.length !== 3) {
    return { ok: false, error: 'bad worldPos' };
  }
  const handle = findHandle(handleUuid);
  if (!handle) return { ok: false, error: 'no handle' };
  const tag = handle.userData[HANDLE_TAG];
  const bone = findBone(tag.boneUuid);
  if (!bone) return { ok: false, error: 'no bone for handle' };

  handle.position.set(worldPos[0], worldPos[1], worldPos[2]);

  const solver = (typeof window !== 'undefined') ? window.__studioRigSolveIK : null;
  if (typeof solver !== 'function') {
    return {
      ok: false,
      error: 'no __studioRigSolveIK — rig module not installed',
      handleUuid,
    };
  }
  const ik = solver(tag.boneUuid, worldPos, tag.iterations || DEFAULT_ITERS, tag.chainLength || DEFAULT_CHAIN);

  // After the solver moved the chain, the OTHER handles on the same
  // armature are now stale (their bones moved). Re-sync every handle on
  // this armature EXCEPT the one the user is dragging — the user's
  // handle stays at the requested target so the cursor doesn't snap.
  const wp = new THREE.Vector3();
  const arm = findArmatureForBone(bone);
  if (arm) arm.updateMatrixWorld(true);
  const scene = getScene();
  if (scene && arm) {
    scene.traverse((o) => {
      if (!o.userData || !o.userData[HANDLE_TAG]) return;
      if (o.uuid === handleUuid) return;
      if (o.userData[HANDLE_TAG].armatureUuid !== arm.uuid) return;
      const b = findBone(o.userData[HANDLE_TAG].boneUuid);
      if (!b) return;
      b.getWorldPosition(wp);
      o.position.copy(wp);
    });
  }

  // Achieved effector world position.
  bone.getWorldPosition(wp);
  return {
    ok: true,
    handleUuid,
    boneUuid: tag.boneUuid,
    target: worldPos.slice(),
    achieved: [wp.x, wp.y, wp.z],
    ik,
  };
}

export function setChainLength(handleUuid, n) {
  const handle = findHandle(handleUuid);
  if (!handle) return { ok: false, error: 'no handle' };
  const k = Math.max(1, Math.min(16, Math.floor(Number(n) || 0)));
  if (!k) return { ok: false, error: 'bad chain length' };
  handle.userData[HANDLE_TAG].chainLength = k;
  return { ok: true, handleUuid, chainLength: k };
}

export function refreshHandles() {
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  let refreshed = 0;
  const wp = new THREE.Vector3();
  // Make sure every armature has fresh matrices before we sample.
  scene.traverse((o) => {
    if (o.userData && o.userData.archdiscStudioRigArmature) o.updateMatrixWorld(true);
  });
  scene.traverse((o) => {
    if (!o.userData || !o.userData[HANDLE_TAG]) return;
    const tag = o.userData[HANDLE_TAG];
    const bone = findBone(tag.boneUuid);
    if (!bone) return;
    bone.getWorldPosition(wp);
    o.position.copy(wp);
    refreshed++;
  });
  return { ok: true, refreshed };
}

// Internal — exposed for dragger.js so it can find a handle under the
// pointer without re-implementing the traverse.
export const __internal = {
  findHandle,
  findBone,
  findArmatureForBone,
  getScene,
  HANDLE_TAG,
  GIZMO_TAG,
  DEFAULT_SIZE,
  DEFAULT_CHAIN,
  DEFAULT_ITERS,
};
