// ArchDisc Studio V3 — mesh ↔ armature skinning.
//
// Slice 754 — Maya skinning workflow upgraded to a full LBS rig:
//
//   • `_computeAutoWeights(mesh, bones, opts)` — REAL auto-weight pass.
//     For each world-space vertex we compute distance to the bone's full
//     SEGMENT (clamped projection onto the head→tail line), not just the
//     head. Falloff is QUADRATIC (`max(0, 1 - d/radius)^2`) so weights
//     drop smoothly across the segment surface, which is what Maya's
//     "Smooth Bind" and Blender's "Envelope+Heat" tend toward at default
//     settings. Top-4 bones per vertex are kept and normalised so Σw=1.
//     A 2-pass Laplacian smoothing across the mesh-graph 1-ring
//     adjacency relaxes the weight VECTOR per vertex (heat-diffusion
//     approximation — what Pinocchio / Baran-Popović do far more
//     expensively); each pass re-tops-4 and re-normalises. Verts with
//     no bone in radius anchor to their single closest bone (weight 1).
//
//   • `_attachSkinAttrs(geom, idx, wt)` — sets `skinIndex` / `skinWeight`
//     BufferAttributes on a geometry. Shared by the bind path and any
//     future re-weight ops.
//
//   • `autoWeight(meshUuid, armUuid, opts)` — public surface around
//     `_computeAutoWeights` + `_attachSkinAttrs`. Does NOT swap the mesh
//     for a SkinnedMesh — it only stamps the weights on the geometry so
//     a downstream bind (or a re-bind) can use them.
//
//   • `bindMeshToArmature(meshUuid, armUuid, opts)` — auto-weights then
//     swaps the THREE.Mesh in the scene for a THREE.SkinnedMesh that
//     shares its geometry (now carrying `skinIndex` + `skinWeight`) and a
//     cloned MeshStandardMaterial flagged `skinning: true`. The skeleton
//     is bound in the mesh's world matrix (the bind-pose we weighted
//     against).
//
//   • `poseByName(armUuid, {boneName:[ex,ey,ez]})` — Maya-style bulk
//     bone rotation by NAME (not uuid); calls `skeleton.update()` after.
//
//   • `unbindMesh(skinnedMeshUuid)` — reverts a SkinnedMesh back to a
//     plain Mesh: strips the skinning attrs, drops the skinning material
//     flag, keeps the armature alive (only the binding is undone).
//
// The legacy single-pass closest-HEAD linear-falloff path is gone;
// `bindMeshToArmature` now wraps the new helpers so it produces a
// strictly better deformation while staying API-compatible.

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

// Bone tail in WORLD space.
//
//   • First child bone's world position, if any.
//   • Otherwise, head + (boneLength along the bone's local +Y in world).
//   • Otherwise, head + a tiny ε so the segment is degenerate but valid
//     (clamped-projection just returns the head distance).
function _boneTailWorld(bone, head) {
  // Look for the first child Bone.
  if (bone.children) {
    for (const c of bone.children) {
      if (c.isBone) {
        const t = new THREE.Vector3();
        c.getWorldPosition(t);
        return t;
      }
    }
  }
  // Length-along-local-Y fallback.
  const len = (bone.userData && Number(bone.userData.archdiscStudioRigBoneLength)) || 0;
  if (len > 0) {
    const localTail = new THREE.Vector3(0, len, 0);
    const tail = localTail.applyMatrix4(bone.matrixWorld);
    return tail;
  }
  // Degenerate — head + ε along world +Y.
  return head.clone().add(new THREE.Vector3(0, 1e-6, 0));
}

// Distance from point `p` to the segment [a, b] (Euclidean, clamped).
// Returns the actual distance — falloff applies on top.
function _distToSegment(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const ab2 = abx * abx + aby * aby + abz * abz;
  if (ab2 <= 1e-12) {
    // Degenerate segment → distance to the head.
    return Math.hypot(apx, apy, apz);
  }
  let t = (apx * abx + apy * aby + apz * abz) / ab2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = a.x + abx * t, cy = a.y + aby * t, cz = a.z + abz * t;
  const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
  return Math.hypot(dx, dy, dz);
}

// Build the 1-ring adjacency list from a triangulated geometry. The
// adjacency is undirected — every triangle (i, j, k) adds three edges
// {i,j} {j,k} {k,i}, de-duped via Set per vertex.
function _buildAdjacency(geom, vertexCount) {
  const sets = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) sets[i] = new Set();
  const idx = geom.index ? geom.index.array : null;
  if (idx) {
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      if (a < vertexCount && b < vertexCount && c < vertexCount) {
        sets[a].add(b); sets[a].add(c);
        sets[b].add(a); sets[b].add(c);
        sets[c].add(a); sets[c].add(b);
      }
    }
  } else {
    // Non-indexed: every 3 consecutive vertices is a triangle.
    const n = vertexCount - (vertexCount % 3);
    for (let t = 0; t < n; t += 3) {
      const a = t, b = t + 1, c = t + 2;
      sets[a].add(b); sets[a].add(c);
      sets[b].add(a); sets[b].add(c);
      sets[c].add(a); sets[c].add(b);
    }
  }
  // Flatten to arrays for tight loops.
  const adj = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) adj[i] = Array.from(sets[i]);
  return adj;
}

// Given dense per-vertex weights packed (vertexCount × boneCount) keep
// only the top-4 entries per vertex and renormalise to Σ=1.
// `dense` is mutated; returns nothing.
function _topKAndNormaliseDense(dense, vertexCount, boneCount, K) {
  for (let v = 0; v < vertexCount; v++) {
    const off = v * boneCount;
    // Find the K largest entries via simple K-pass selection (K=4).
    const keptIdx = new Array(K).fill(-1);
    const keptW = new Array(K).fill(0);
    for (let b = 0; b < boneCount; b++) {
      const w = dense[off + b];
      if (w <= 0) continue;
      // Insert into kept[] (sorted high→low).
      let pos = K;
      for (let i = 0; i < K; i++) {
        if (w > keptW[i]) { pos = i; break; }
      }
      if (pos < K) {
        for (let j = K - 1; j > pos; j--) {
          keptW[j] = keptW[j - 1];
          keptIdx[j] = keptIdx[j - 1];
        }
        keptW[pos] = w;
        keptIdx[pos] = b;
      }
    }
    // Zero out everything else in this row.
    for (let b = 0; b < boneCount; b++) dense[off + b] = 0;
    let sum = 0;
    for (let i = 0; i < K; i++) if (keptIdx[i] >= 0) sum += keptW[i];
    if (sum <= 0) {
      // Fallback: leave row zero; caller's outlier pass already anchored
      // these to a single bone, so this should be unreachable.
      continue;
    }
    for (let i = 0; i < K; i++) {
      if (keptIdx[i] >= 0) dense[off + keptIdx[i]] = keptW[i] / sum;
    }
  }
}

// One pass of Laplacian smoothing on the weight VECTORS:
//   w_v ← 0.5·w_v + 0.5·mean(w_neighbours)
// `dense` is overwritten by a fresh buffer; caller pipes it back in.
function _laplacianSmooth(dense, adj, vertexCount, boneCount) {
  const out = new Float32Array(dense.length);
  for (let v = 0; v < vertexCount; v++) {
    const off = v * boneCount;
    const neigh = adj[v];
    if (!neigh || !neigh.length) {
      // Isolated vertex — copy through.
      for (let b = 0; b < boneCount; b++) out[off + b] = dense[off + b];
      continue;
    }
    // Mean of neighbours.
    const inv = 1 / neigh.length;
    // We'll accumulate into out[] directly.
    for (let b = 0; b < boneCount; b++) {
      let mean = 0;
      for (let n = 0; n < neigh.length; n++) {
        mean += dense[neigh[n] * boneCount + b];
      }
      mean *= inv;
      out[off + b] = 0.5 * dense[off + b] + 0.5 * mean;
    }
  }
  return out;
}

// ─── public ──────────────────────────────────────────────────────────────

// Compute the auto-weights for a mesh against a bone list. The mesh
// must already have its `matrixWorld` updated; the bones must be in
// their bind pose (we capture head + tail in world). Returns the packed
// (vertexCount × 4) skinIndex + skinWeight Float32Arrays plus a
// per-bone average influence (sum of weights ÷ vertexCount) — useful
// for sanity tests (e.g. "TopBone owns the upper half").
export function _computeAutoWeights(mesh, bones, opts) {
  const o = opts || {};
  const K = 4; // SkinnedMesh shader expects exactly 4 influences/vertex.
  const radius = (Number(o.radius) > 0 ? Number(o.radius) : autoRadius(bones)) * (Number(o.falloff) > 0 ? Number(o.falloff) : 1.0);
  const smoothPasses = Number.isFinite(o.smoothPasses) ? Math.max(0, Math.floor(o.smoothPasses)) : 2;

  const posAttr = mesh.geometry.attributes.position;
  const vertexCount = posAttr.count;
  const boneCount = bones.length;

  // Capture bone head + tail in world.
  const heads = new Array(boneCount);
  const tails = new Array(boneCount);
  const tmp = new THREE.Vector3();
  for (let b = 0; b < boneCount; b++) {
    bones[b].updateMatrixWorld(true);
    bones[b].getWorldPosition(tmp);
    heads[b] = new THREE.Vector3(tmp.x, tmp.y, tmp.z);
    tails[b] = _boneTailWorld(bones[b], heads[b]);
  }

  // Dense per-vertex per-bone weight table (Float32 to save memory; we
  // only need precision-of-1e-7 here).
  const dense = new Float32Array(vertexCount * boneCount);

  const meshWorld = mesh.matrixWorld;
  const pv = new THREE.Vector3();
  for (let v = 0; v < vertexCount; v++) {
    pv.set(posAttr.getX(v), posAttr.getY(v), posAttr.getZ(v)).applyMatrix4(meshWorld);
    let anyIn = false;
    let closestIdx = 0;
    let closestDist = Infinity;
    for (let b = 0; b < boneCount; b++) {
      const d = _distToSegment(pv, heads[b], tails[b]);
      if (d < closestDist) { closestDist = d; closestIdx = b; }
      const f = 1 - d / radius;
      if (f > 0) {
        dense[v * boneCount + b] = f * f; // QUADRATIC falloff.
        anyIn = true;
      }
    }
    if (!anyIn) {
      // Outlier — anchor to the single closest bone with weight 1.
      dense[v * boneCount + closestIdx] = 1;
    }
  }

  // Initial top-4 + normalise so smoothing operates on properly
  // bounded weight VECTORS.
  _topKAndNormaliseDense(dense, vertexCount, boneCount, K);

  // Build the mesh-graph adjacency once, then smooth N times.
  let smoothed = dense;
  if (smoothPasses > 0) {
    const adj = _buildAdjacency(mesh.geometry, vertexCount);
    for (let pass = 0; pass < smoothPasses; pass++) {
      smoothed = _laplacianSmooth(smoothed, adj, vertexCount, boneCount);
      _topKAndNormaliseDense(smoothed, vertexCount, boneCount, K);
    }
  }

  // Pack into the SkinnedMesh-style (count × 4) layout. We pick the
  // top-4 columns again (the smoothing pass already top-4'd, but we
  // still need to flatten the sparse dense rows into the 4-wide layout).
  const indices = new Float32Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  const perBoneSum = new Float32Array(boneCount);

  for (let v = 0; v < vertexCount; v++) {
    const off = v * boneCount;
    const ranked = [];
    for (let b = 0; b < boneCount; b++) {
      const w = smoothed[off + b];
      if (w > 0) ranked.push({ idx: b, w });
    }
    ranked.sort((a, b) => b.w - a.w);
    const kept = ranked.slice(0, K);
    let sum = 0;
    for (const k of kept) sum += k.w;
    if (sum <= 0) {
      // Fallback again — should be unreachable thanks to the outlier
      // anchor, but be safe.
      indices[v * 4 + 0] = 0; weights[v * 4 + 0] = 1;
      indices[v * 4 + 1] = 0; weights[v * 4 + 1] = 0;
      indices[v * 4 + 2] = 0; weights[v * 4 + 2] = 0;
      indices[v * 4 + 3] = 0; weights[v * 4 + 3] = 0;
      perBoneSum[0] += 1;
      continue;
    }
    for (let i = 0; i < 4; i++) {
      if (i < kept.length) {
        const wNorm = kept[i].w / sum;
        indices[v * 4 + i] = kept[i].idx;
        weights[v * 4 + i] = wNorm;
        perBoneSum[kept[i].idx] += wNorm;
      } else {
        indices[v * 4 + i] = 0;
        weights[v * 4 + i] = 0;
      }
    }
  }

  const perBoneAvg = new Array(boneCount);
  for (let b = 0; b < boneCount; b++) perBoneAvg[b] = vertexCount > 0 ? perBoneSum[b] / vertexCount : 0;

  return { indices, weights, perBoneAvg, radius, boneCount, vertexCount };
}

// Attach the auto-weights to a geometry as BufferAttributes.
export function _attachSkinAttrs(geom, idx, wt) {
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array.from(idx), 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
}

// Public — stamp auto-weights onto a Mesh's geometry WITHOUT swapping
// it for a SkinnedMesh. Useful for "weight first, bind later" flows and
// for re-weighting a mesh that's already been bound (caller can re-bind
// afterwards).
export function autoWeight(meshUuid, armUuid, opts) {
  const mesh = findMesh(meshUuid);
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (!mesh.geometry || !mesh.geometry.attributes || !mesh.geometry.attributes.position) {
    return { ok: false, error: 'mesh has no geometry' };
  }
  const arm = armInt.findArmature(armUuid);
  if (!arm) return { ok: false, error: 'no armature' };
  arm.updateMatrixWorld(true);
  const bones = collectBones(arm);
  if (!bones.length) return { ok: false, error: 'armature has no bones' };
  mesh.updateMatrixWorld(true);

  const r = _computeAutoWeights(mesh, bones, opts || {});
  _attachSkinAttrs(mesh.geometry, r.indices, r.weights);

  return {
    ok: true,
    meshUuid: mesh.uuid,
    armUuid: arm.uuid,
    boneCount: r.boneCount,
    vertexCount: r.vertexCount,
    radius: r.radius,
    perBoneAvg: r.perBoneAvg,
    boneNames: bones.map((b) => b.name),
  };
}

export function bindMeshToArmature(meshUuid, armUuid, opts) {
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

  mesh.updateMatrixWorld(true);

  // Auto-weight unless the geometry already carries skin attrs from a
  // prior __studioSkinAutoWeight call.
  let perBoneAvg = null;
  let radius = 0;
  if (!mesh.geometry.attributes.skinIndex || !mesh.geometry.attributes.skinWeight) {
    const r = _computeAutoWeights(mesh, bones, opts || {});
    _attachSkinAttrs(mesh.geometry, r.indices, r.weights);
    perBoneAvg = r.perBoneAvg;
    radius = r.radius;
  } else {
    radius = (opts && Number(opts.radius) > 0) ? Number(opts.radius) : autoRadius(bones);
  }

  // Build the SkinnedMesh. We share geometry; material gets cloned and
  // flagged so the skinning vertex-shader path is compiled.
  let mat;
  if (Array.isArray(mesh.material)) {
    mat = mesh.material.map((m) => {
      const c = m.clone();
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
    vertexCount: mesh.geometry.attributes.position.count,
    radius,
    perBoneAvg,
  };
}

// Maya-style bulk pose-by-name. `poses` is `{boneName: [ex,ey,ez]}`.
// Bones whose names aren't in the armature are ignored (returned in
// `missing[]` so the caller can validate).
export function poseByName(armUuid, poses) {
  const arm = armInt.findArmature(armUuid);
  if (!arm) return { ok: false, error: 'no armature' };
  if (!poses || typeof poses !== 'object') return { ok: false, error: 'no poses' };
  const bones = collectBones(arm);
  const byName = new Map();
  for (const b of bones) byName.set(b.name, b);
  const posed = [];
  const missing = [];
  for (const name of Object.keys(poses)) {
    const euler = poses[name];
    if (!Array.isArray(euler) || euler.length !== 3) { missing.push(name); continue; }
    const b = byName.get(name);
    if (!b) { missing.push(name); continue; }
    b.rotation.set(
      Number(euler[0]) || 0,
      Number(euler[1]) || 0,
      Number(euler[2]) || 0,
    );
    posed.push(name);
  }
  arm.updateMatrixWorld(true);
  const skel = arm.userData.archdiscStudioRigSkeleton;
  if (skel && typeof skel.update === 'function') skel.update();
  return { ok: true, posed, missing };
}

// Revert a SkinnedMesh back to a plain Mesh. The armature stays in the
// scene — we only undo the BINDING. The geometry's skinIndex /
// skinWeight attributes are removed so a future bind starts clean.
export function unbindMesh(skinnedMeshUuid) {
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const sm = findMesh(skinnedMeshUuid);
  if (!sm) return { ok: false, error: 'no skinned mesh' };
  if (!sm.isSkinnedMesh) return { ok: false, error: 'mesh is not skinned' };

  // Strip skin attrs from the geometry.
  if (sm.geometry) {
    if (sm.geometry.attributes && sm.geometry.attributes.skinIndex) {
      try { sm.geometry.deleteAttribute('skinIndex'); } catch (_) {}
    }
    if (sm.geometry.attributes && sm.geometry.attributes.skinWeight) {
      try { sm.geometry.deleteAttribute('skinWeight'); } catch (_) {}
    }
  }

  // Drop the skinning flag on the material (avoid leaking the
  // skinning shader path back onto a plain Mesh).
  if (Array.isArray(sm.material)) {
    for (const m of sm.material) { try { m.skinning = false; m.needsUpdate = true; } catch (_) {} }
  } else if (sm.material) {
    try { sm.material.skinning = false; sm.material.needsUpdate = true; } catch (_) {}
  }

  const mesh = new THREE.Mesh(sm.geometry, sm.material);
  mesh.position.copy(sm.position);
  mesh.quaternion.copy(sm.quaternion);
  mesh.scale.copy(sm.scale);
  mesh.castShadow = sm.castShadow;
  mesh.receiveShadow = sm.receiveShadow;
  mesh.name = sm.name && sm.name.startsWith('Skinned-') ? sm.name.slice(8) : (sm.name || 'Mesh');
  mesh.userData = { ...sm.userData };
  delete mesh.userData.archdiscStudioRigArmatureUuid;
  delete mesh.userData.archdiscStudioRigOriginalMeshUuid;
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = sm.userData?.archdiscStudioPrimitiveKind === 'skinnedmesh'
    ? 'mesh'
    : (sm.userData?.archdiscStudioPrimitiveKind || 'mesh');

  const parent = sm.parent || scene;
  parent.add(mesh);
  parent.remove(sm);

  return {
    ok: true,
    restoredUuid: mesh.uuid,
    formerSkinnedUuid: skinnedMeshUuid,
  };
}
