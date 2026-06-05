// ArchDisc Studio V3 — MoGraph Cloners.
//
// C4D MoGraph "Cloner Object" parity. Each cloner reads the active
// Studio mesh (the one currently selected in the viewport) as the
// source clone, then emits a single `THREE.InstancedMesh` carrying the
// requested grid/line/radial/on-object layout. Every per-instance
// matrix is also cached on `userData.archdiscStudioCloner.baseMatrices`
// so effectors can re-bind from the original layout instead of
// compounding deltas across re-runs.
//
//   __studioClonerLinear(count, offsetXYZ)
//   __studioClonerRadial(count, radius, axis)
//   __studioClonerGrid(nx, ny, nz, spacingXYZ)
//   __studioClonerOnObject(targetMeshUuid)
//
// All ops return { ok, uuid, count } on success.

import * as THREE from 'three';

function scene() {
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function viewport() {
  return window.__archdiscViewport || null;
}

// Active mesh = current viewport selection (matches every other v3 op).
function activeMesh() {
  const vp = viewport();
  const sel = vp && vp.getSelected && vp.getSelected();
  if (sel && sel.isMesh && sel.geometry && sel.material) return sel;
  // Some specs attach via TransformControls without going through
  // setSelected; fall back to the gizmo's current target.
  if (vp && vp.transformControls && vp.transformControls.object
      && vp.transformControls.object.isMesh) {
    return vp.transformControls.object;
  }
  return null;
}

function findMeshByUuid(uuid) {
  const s = scene(); if (!s) return null;
  let m = null;
  s.traverse((o) => { if (!m && o.uuid === uuid) m = o; });
  return m;
}

function attachAndSelect(mesh) {
  const s = scene(); if (!s) return;
  s.add(mesh);
  if (window.__studioSelectMesh) {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
}

// Build an InstancedMesh from the source mesh + N pre-built matrices.
// Mutates: each matrix is committed via setMatrixAt. Caches a snapshot
// of every matrix4 (flat 16-element array) on userData so effectors can
// re-base. Returns the new InstancedMesh.
function emitInstancedMesh(src, matrices, kind, extraUserData) {
  const N = matrices.length;
  const inst = new THREE.InstancedMesh(src.geometry, src.material, N);
  inst.castShadow = !!src.castShadow;
  inst.receiveShadow = !!src.receiveShadow;
  const baseMatrices = new Array(N);
  for (let i = 0; i < N; i++) {
    const m = matrices[i];
    inst.setMatrixAt(i, m);
    baseMatrices[i] = m.elements.slice(0); // snapshot as plain array
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.userData.archdiscStudioPrimitive = true;
  inst.userData.archdiscStudioPrimitiveKind = 'cloner';
  inst.userData.pickable = true;
  inst.userData.archdiscStudioCloner = {
    kind,
    sourceUuid: src.uuid,
    baseMatrices,
    fieldUuid: null,
    ...extraUserData,
  };
  inst.name = `studio-primitive-cloner-${kind}-${N}`;
  return inst;
}

// ─── Linear ─────────────────────────────────────────────────────────────
export function clonerLinear(count, offsetXYZ) {
  const src = activeMesh();
  if (!src) return { ok: false, error: 'no active mesh' };
  const N = Math.max(1, Math.floor(+count || 0));
  const o = (Array.isArray(offsetXYZ) && offsetXYZ.length === 3) ? offsetXYZ : [0.05, 0, 0];
  const ox = +o[0] || 0, oy = +o[1] || 0, oz = +o[2] || 0;
  const matrices = new Array(N);
  const tmp = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    tmp.position.set(src.position.x + ox * i, src.position.y + oy * i, src.position.z + oz * i);
    tmp.rotation.set(src.rotation.x, src.rotation.y, src.rotation.z);
    tmp.scale.set(src.scale.x, src.scale.y, src.scale.z);
    tmp.updateMatrix();
    matrices[i] = tmp.matrix.clone();
  }
  const inst = emitInstancedMesh(src, matrices, 'linear', { offset: [ox, oy, oz] });
  attachAndSelect(inst);
  return { ok: true, uuid: inst.uuid, count: N };
}

// ─── Radial ─────────────────────────────────────────────────────────────
export function clonerRadial(count, radius, axis) {
  const src = activeMesh();
  if (!src) return { ok: false, error: 'no active mesh' };
  const N = Math.max(1, Math.floor(+count || 0));
  const R = Number.isFinite(+radius) && +radius > 0 ? +radius : 0.5;
  const ax = (axis || 'y').toLowerCase();
  const matrices = new Array(N);
  const tmp = new THREE.Object3D();
  const base = src.position.clone();
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const cos = Math.cos(t) * R, sin = Math.sin(t) * R;
    if (ax === 'y') tmp.position.set(base.x + cos, base.y, base.z + sin);
    else if (ax === 'x') tmp.position.set(base.x, base.y + cos, base.z + sin);
    else if (ax === 'z') tmp.position.set(base.x + cos, base.y + sin, base.z);
    else tmp.position.set(base.x + cos, base.y, base.z + sin);
    tmp.rotation.set(src.rotation.x, src.rotation.y, src.rotation.z);
    tmp.scale.set(src.scale.x, src.scale.y, src.scale.z);
    tmp.updateMatrix();
    matrices[i] = tmp.matrix.clone();
  }
  const inst = emitInstancedMesh(src, matrices, 'radial', { radius: R, axis: ax });
  attachAndSelect(inst);
  return { ok: true, uuid: inst.uuid, count: N };
}

// ─── Grid ───────────────────────────────────────────────────────────────
export function clonerGrid(nx, ny, nz, spacingXYZ) {
  const src = activeMesh();
  if (!src) return { ok: false, error: 'no active mesh' };
  const Nx = Math.max(1, Math.floor(+nx || 1));
  const Ny = Math.max(1, Math.floor(+ny || 1));
  const Nz = Math.max(1, Math.floor(+nz || 1));
  const s = (Array.isArray(spacingXYZ) && spacingXYZ.length === 3) ? spacingXYZ : [0.06, 0.06, 0.06];
  const sx = +s[0] || 0, sy = +s[1] || 0, sz = +s[2] || 0;
  const total = Nx * Ny * Nz;
  const matrices = new Array(total);
  const tmp = new THREE.Object3D();
  const base = src.position.clone();
  let k = 0;
  for (let iz = 0; iz < Nz; iz++) {
    for (let iy = 0; iy < Ny; iy++) {
      for (let ix = 0; ix < Nx; ix++) {
        const px = base.x + (ix - (Nx - 1) / 2) * sx;
        const py = base.y + (iy - (Ny - 1) / 2) * sy;
        const pz = base.z + (iz - (Nz - 1) / 2) * sz;
        tmp.position.set(px, py, pz);
        tmp.rotation.set(src.rotation.x, src.rotation.y, src.rotation.z);
        tmp.scale.set(src.scale.x, src.scale.y, src.scale.z);
        tmp.updateMatrix();
        matrices[k++] = tmp.matrix.clone();
      }
    }
  }
  const inst = emitInstancedMesh(src, matrices, 'grid', {
    nx: Nx, ny: Ny, nz: Nz, spacing: [sx, sy, sz],
  });
  attachAndSelect(inst);
  return { ok: true, uuid: inst.uuid, count: total };
}

// ─── On Object ──────────────────────────────────────────────────────────
// Distribute clones across the target mesh's unique vertex positions
// (in world space). One clone per target vertex.
export function clonerOnObject(targetMeshUuid) {
  const src = activeMesh();
  if (!src) return { ok: false, error: 'no active mesh' };
  const tgt = findMeshByUuid(targetMeshUuid);
  if (!tgt || !tgt.isMesh || !tgt.geometry) {
    return { ok: false, error: 'no target mesh by uuid' };
  }
  const posAttr = tgt.geometry.getAttribute('position');
  if (!posAttr) return { ok: false, error: 'target has no position attribute' };
  // Update target's world matrix so we can transform vertex positions
  // into world space.
  tgt.updateMatrixWorld(true);
  const N = posAttr.count;
  if (N <= 0) return { ok: false, error: 'target has zero vertices' };
  const matrices = new Array(N);
  const tmp = new THREE.Object3D();
  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    v.fromBufferAttribute(posAttr, i);
    v.applyMatrix4(tgt.matrixWorld);
    tmp.position.copy(v);
    tmp.rotation.set(src.rotation.x, src.rotation.y, src.rotation.z);
    tmp.scale.set(src.scale.x, src.scale.y, src.scale.z);
    tmp.updateMatrix();
    matrices[i] = tmp.matrix.clone();
  }
  const inst = emitInstancedMesh(src, matrices, 'on-object', {
    targetUuid: targetMeshUuid,
  });
  attachAndSelect(inst);
  return { ok: true, uuid: inst.uuid, count: N };
}

// ─── Lookup helper (used by effectors) ──────────────────────────────────
export function findClonerByUuid(uuid) {
  const s = scene(); if (!s) return null;
  let m = null;
  s.traverse((o) => {
    if (!m && o.uuid === uuid && o.isInstancedMesh
        && o.userData && o.userData.archdiscStudioCloner) m = o;
  });
  return m;
}

// Convenience: list every cloner in the scene.
export function listCloners() {
  const s = scene();
  if (!s) return { ok: true, count: 0, cloners: [] };
  const cloners = [];
  s.traverse((o) => {
    if (o.isInstancedMesh && o.userData && o.userData.archdiscStudioCloner) {
      const c = o.userData.archdiscStudioCloner;
      cloners.push({
        uuid: o.uuid, kind: c.kind, count: o.count,
        fieldUuid: c.fieldUuid || null,
      });
    }
  });
  return { ok: true, count: cloners.length, cloners };
}
