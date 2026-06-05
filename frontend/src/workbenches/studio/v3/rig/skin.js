// ArchDisc Studio V3 — mesh ↔ armature skinning.
//
// `bindMeshToArmature(meshUuid, armUuid, opts)` replaces the existing
// THREE.Mesh in the scene with a THREE.SkinnedMesh that shares its
// geometry (modified in-place to carry `skinIndex` + `skinWeight`
// attributes) and a freshly-cloned MeshStandardMaterial flagged
// `skinning: true` so it actually deforms when bones rotate.
//
// Weight algorithm:
//   • For every vertex in the mesh's geometry, find the closest bone
//     head (each bone's head = its world position).
//   • Falloff is linear: weight = max(0, 1 - dist/radius). The four
//     bones with the highest weights are kept (opts.maxBones default 4).
//   • If no bone is within `radius`, the vertex still has to skin to
//     SOMETHING — fall back to the single closest bone with weight 1.
//   • Weights are normalised per-vertex so Σw = 1 (required by the
//     standard skinning shader).
//
// `opts.maxBones` defaults to 4 (Three's MeshStandardMaterial skinning
// shader supports four influences per vertex without recompilation).
// `opts.radius` defaults to a sensible auto-value (largest bone
// distance * 1.2 — keeps the typical short-bone cylinder rig sane).

import * as THREE from 'three';
import { __internal as armInt } from './armature.js';

function getScene() {
  return (typeof window !== 'undefined' && (window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene))) || null;
}

function findMesh(meshUuid) {
  const scene = getScene();
  if (!scene) return null;
  let m = null;
  scene.traverse((o) => {
    if (m) return;
    if ((o.isMesh || o.isSkinnedMesh) && o.uuid === meshUuid) m = o;
  });
  return m;
}

// Collect every bone under an armature, in the same order rebuildSkeleton
// uses so the skinIndex matches Skeleton.bones[].
function collectBones(arm) {
  const bones = [];
  arm.traverse((o) => { if (o.isBone) bones.push(o); });
  return bones;
}

// Auto-pick a sensible radius based on bone spread.
function autoRadius(bones) {
  if (bones.length < 2) return 1.0;
  const pos = new THREE.Vector3();
  const pts = bones.map((b) => { b.getWorldPosition(pos); return [pos.x, pos.y, pos.z]; });
  let maxD = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i][0] - pts[j][0];
      const dy = pts[i][1] - pts[j][1];
      const dz = pts[i][2] - pts[j][2];
      const d = Math.hypot(dx, dy, dz);
      if (d > maxD) maxD = d;
    }
  }
  return maxD * 1.2 || 1.0;
}

export function bindMeshToArmature(meshUuid, armUuid, opts = {}) {
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const mesh = findMesh(meshUuid);
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (mesh.isSkinnedMesh) return { ok: false, error: 'mesh already skinned' };
  if (!mesh.geometry || !mesh.geometry.attributes || !mesh.geometry.attributes.position) {
    return { ok: false, error: 'mesh has no geometry' };
  }
  const arm = armInt.findArmature(armUuid);
  if (!arm) return { ok: false, error: 'no armature' };
  arm.updateMatrixWorld(true);
  const bones = collectBones(arm);
  if (!bones.length) return { ok: false, error: 'armature has no bones' };

  const maxBones = Math.max(1, Math.min(4, Number(opts.maxBones) || 4));
  const radius = Number(opts.radius) > 0 ? Number(opts.radius) : autoRadius(bones);

  // Bone world positions, captured once.
  const tmpV = new THREE.Vector3();
  const bonePos = bones.map((b) => {
    b.getWorldPosition(tmpV);
    return new THREE.Vector3(tmpV.x, tmpV.y, tmpV.z);
  });

  const posAttr = mesh.geometry.attributes.position;
  const vertexCount = posAttr.count;

  // Mesh-local vertex → world. We must compare in world space because
  // the bone positions are world-space.
  mesh.updateMatrixWorld(true);
  const meshWorld = mesh.matrixWorld;

  const skinIndices = new Float32Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);

  // Re-usable scratch.
  const scoreBuf = new Array(bones.length);

  for (let v = 0; v < vertexCount; v++) {
    tmpV.set(posAttr.getX(v), posAttr.getY(v), posAttr.getZ(v)).applyMatrix4(meshWorld);
    // Score every bone.
    let anyInRadius = false;
    let closestIdx = 0;
    let closestDist = Infinity;
    for (let b = 0; b < bones.length; b++) {
      const d = tmpV.distanceTo(bonePos[b]);
      if (d < closestDist) { closestDist = d; closestIdx = b; }
      const w = 1 - d / radius;
      if (w > 0) { scoreBuf[b] = w; anyInRadius = true; }
      else scoreBuf[b] = 0;
    }
    if (!anyInRadius) {
      // Fully outside the radius: anchor to the single closest bone.
      skinIndices[v * 4 + 0] = closestIdx;
      skinWeights[v * 4 + 0] = 1;
      skinIndices[v * 4 + 1] = 0; skinWeights[v * 4 + 1] = 0;
      skinIndices[v * 4 + 2] = 0; skinWeights[v * 4 + 2] = 0;
      skinIndices[v * 4 + 3] = 0; skinWeights[v * 4 + 3] = 0;
      continue;
    }
    // Pick the top-`maxBones` weights.
    const ranked = [];
    for (let b = 0; b < bones.length; b++) {
      if (scoreBuf[b] > 0) ranked.push({ idx: b, w: scoreBuf[b] });
    }
    ranked.sort((a, b) => b.w - a.w);
    const kept = ranked.slice(0, maxBones);
    let sum = 0;
    for (const k of kept) sum += k.w;
    if (sum <= 0) sum = 1;
    for (let i = 0; i < 4; i++) {
      if (i < kept.length) {
        skinIndices[v * 4 + i] = kept[i].idx;
        skinWeights[v * 4 + i] = kept[i].w / sum;
      } else {
        skinIndices[v * 4 + i] = 0;
        skinWeights[v * 4 + i] = 0;
      }
    }
  }

  // Attach attributes; SkinnedMesh requires both.
  mesh.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array.from(skinIndices), 4));
  mesh.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  // Build the SkinnedMesh. We share geometry; material gets cloned and
  // flagged so the skinning vertex-shader path is compiled.
  let mat;
  if (Array.isArray(mesh.material)) {
    mat = mesh.material.map((m) => {
      const c = m.clone();
      // r150+ — skinning is enabled automatically when the geometry has
      // skinIndex/skinWeight, but setting the explicit flag also works
      // for older versions used in dependent suites.
      c.skinning = true;
      c.needsUpdate = true;
      return c;
    });
  } else {
    mat = mesh.material.clone();
    mat.skinning = true;
    mat.needsUpdate = true;
  }
  const skinned = new THREE.SkinnedMesh(mesh.geometry, mat);
  skinned.name = mesh.name || `Skinned-${mesh.uuid.slice(0, 6)}`;
  skinned.position.copy(mesh.position);
  skinned.quaternion.copy(mesh.quaternion);
  skinned.scale.copy(mesh.scale);
  skinned.castShadow = mesh.castShadow;
  skinned.receiveShadow = mesh.receiveShadow;
  // Carry forward the primitive marker so outliners / select-all still
  // include the skinned mesh.
  skinned.userData = {
    ...mesh.userData,
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: mesh.userData?.archdiscStudioPrimitiveKind || 'skinnedmesh',
    archdiscStudioRigArmatureUuid: arm.uuid,
    archdiscStudioRigOriginalMeshUuid: mesh.uuid,
  };

  // Skeleton: use armature's. bind() takes the skeleton + the inverse-
  // bind matrix (defaults to the mesh's current world matrix, which is
  // exactly the bind-pose we computed weights against).
  const skel = arm.userData.archdiscStudioRigSkeleton || armInt.rebuildSkeleton(arm);
  // Add to scene first so its matrixWorld is in the scene's frame, then
  // bind in the same world-space we used for weight scoring.
  scene.add(skinned);
  skinned.updateMatrixWorld(true);
  skinned.bind(skel, skinned.matrixWorld);

  // Swap the old mesh out of the scene.
  mesh.parent && mesh.parent.remove(mesh);

  return {
    ok: true,
    skinnedMeshUuid: skinned.uuid,
    originalMeshUuid: mesh.uuid,
    armUuid: arm.uuid,
    boneCount: bones.length,
    vertexCount,
    radius,
  };
}
