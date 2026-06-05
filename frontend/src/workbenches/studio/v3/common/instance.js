// ArchDisc Studio V3 — shared InstancedMesh helpers.
//
// Before dedup, mograph/cloner.js owned the canonical builder
// (emitInstancedMesh). Foliage (wave 8) and api.js' slice-619
// __studioInstanceColorAt re-rolled the same code. This module hosts the
// canonical builder + a couple of common mutations.

import * as THREE from 'three';

// Build an InstancedMesh from a source mesh + an array of THREE.Matrix4
// instance matrices. Tags userData with archdiscStudioPrimitive so the
// Studio viewport recognises it.
//
// `extraUserData` is merged onto userData.archdiscStudioCloner so the
// existing cloner contract keeps working (foliage / mograph rely on it).
export function makeInstancedMesh(sourceMesh, matrices, kindTag, extraUserData) {
  const N = matrices.length;
  const inst = new THREE.InstancedMesh(sourceMesh.geometry, sourceMesh.material, N);
  inst.castShadow = !!sourceMesh.castShadow;
  inst.receiveShadow = !!sourceMesh.receiveShadow;
  const baseMatrices = new Array(N);
  for (let i = 0; i < N; i++) {
    const m = matrices[i];
    inst.setMatrixAt(i, m);
    baseMatrices[i] = m.elements.slice(0);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.userData.archdiscStudioPrimitive = true;
  inst.userData.archdiscStudioPrimitiveKind = kindTag || 'instance';
  inst.userData.pickable = true;
  if (kindTag || extraUserData) {
    inst.userData.archdiscStudioCloner = {
      kind: kindTag || 'instance',
      sourceUuid: sourceMesh.uuid,
      baseMatrices,
      fieldUuid: null,
      ...(extraUserData || {}),
    };
  }
  inst.name = `studio-primitive-${kindTag || 'instance'}-${N}`;
  return inst;
}

// Replace the instance matrices on an existing InstancedMesh. If the
// length differs the call returns false (callers must rebuild). Marks
// instanceMatrix.needsUpdate.
export function setInstanceMatrices(im, matrices) {
  if (!im || !im.isInstancedMesh || im.count !== matrices.length) return false;
  for (let i = 0; i < matrices.length; i++) {
    im.setMatrixAt(i, matrices[i]);
  }
  im.instanceMatrix.needsUpdate = true;
  return true;
}

// Apply a colour to every instance. `colorFn` receives (i) and returns
// either a THREE.Color, an [r,g,b] triple, or a numeric hex.
// Allocates the InstancedBufferAttribute on first call.
export function recolorInstances(im, colorFn) {
  if (!im || !im.isInstancedMesh) return false;
  const N = im.count;
  if (!im.instanceColor || im.instanceColor.count < N) {
    const arr = new Float32Array(N * 3);
    im.instanceColor = new THREE.InstancedBufferAttribute(arr, 3);
  }
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const r = colorFn(i);
    if (r && r.isColor) c.copy(r);
    else if (Array.isArray(r)) c.setRGB(r[0], r[1], r[2]);
    else if (typeof r === 'number') c.setHex(r);
    else c.setRGB(1, 1, 1);
    im.instanceColor.setXYZ(i, c.r, c.g, c.b);
  }
  im.instanceColor.needsUpdate = true;
  return true;
}
