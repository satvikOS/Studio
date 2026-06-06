// Slice 715 — AutoCAD Dynamic Block library. A "block" is a named
// instance template (group of meshes with relative transforms);
// instances reference the block + optional parameter overrides
// (e.g. stretch, rotation, flip). Mirrors DWG dynamic blocks and is
// a core AutoCAD productivity feature.

import * as THREE from 'three';

const _blockDefs = new Map();   // name → { meshes: [{geo, mat, position, quaternion, scale}], params }
const _instances = new Map();   // uuid → { block, overrides, group }

let _seq = 1;
function _uid() { return `dwbi-${_seq++}-${Date.now().toString(36)}`; }

function _cloneGeometry(geo) {
  return geo.clone();
}

export function defineBlock(name, meshUuids, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const def = { name, meshes: [], params: opts?.params || [] };
  // Compute a centroid origin from given meshes.
  let cx = 0, cy = 0, cz = 0, count = 0;
  for (const uuid of meshUuids) {
    const m = scene.getObjectByProperty('uuid', uuid);
    if (!m) continue;
    m.updateMatrixWorld(true);
    const p = m.getWorldPosition(new THREE.Vector3());
    cx += p.x; cy += p.y; cz += p.z; count++;
  }
  if (count > 0) { cx /= count; cy /= count; cz /= count; }
  for (const uuid of meshUuids) {
    const m = scene.getObjectByProperty('uuid', uuid);
    if (!m || !m.geometry || !m.material) continue;
    def.meshes.push({
      geo: _cloneGeometry(m.geometry),
      mat: m.material.clone(),
      position: [m.position.x - cx, m.position.y - cy, m.position.z - cz],
      quaternion: m.quaternion.toArray(),
      scale: m.scale.toArray(),
    });
  }
  _blockDefs.set(name, def);
  return { ok: true, meshCount: def.meshes.length };
}

export function placeInstance(blockName, position, overrides) {
  const def = _blockDefs.get(blockName);
  if (!def) return { ok: false };
  const group = new THREE.Group();
  group.name = `block-${blockName}`;
  for (const m of def.meshes) {
    const mesh = new THREE.Mesh(_cloneGeometry(m.geo), m.mat);
    mesh.position.set(...m.position);
    mesh.quaternion.fromArray(m.quaternion);
    mesh.scale.fromArray(m.scale);
    group.add(mesh);
  }
  if (position) group.position.set(position[0], position[1], position[2]);
  // Apply parameter overrides — rotation, scale, flip, stretch.
  if (overrides) {
    if (overrides.rotationY !== undefined) group.rotation.y = overrides.rotationY;
    if (overrides.scale !== undefined) group.scale.setScalar(Number(overrides.scale));
    if (overrides.flipX) group.scale.x *= -1;
    if (overrides.stretchX !== undefined) group.scale.x *= overrides.stretchX;
  }
  if (window.__archdiscScene) window.__archdiscScene.add(group);
  const uuid = _uid();
  _instances.set(uuid, { block: blockName, overrides, group });
  group.userData.archdiscDwgInstance = uuid;
  return { ok: true, uuid, groupUuid: group.uuid };
}

export function listBlocks() {
  return {
    ok: true,
    blocks: Array.from(_blockDefs.values()).map((d) => ({
      name: d.name, meshCount: d.meshes.length, params: d.params,
    })),
  };
}

export function listInstances(blockName) {
  return {
    ok: true,
    instances: Array.from(_instances.entries())
      .filter(([_, i]) => !blockName || i.block === blockName)
      .map(([uuid, i]) => ({ uuid, block: i.block, overrides: i.overrides, groupUuid: i.group.uuid })),
  };
}

export function updateInstance(instanceUuid, overrides) {
  const i = _instances.get(instanceUuid);
  if (!i) return { ok: false };
  // Rebuild group's transform from base transforms + new overrides.
  const def = _blockDefs.get(i.block);
  if (!def) return { ok: false };
  i.group.scale.set(1, 1, 1);
  i.group.rotation.set(0, 0, 0);
  if (overrides.rotationY !== undefined) i.group.rotation.y = overrides.rotationY;
  if (overrides.scale !== undefined) i.group.scale.setScalar(Number(overrides.scale));
  if (overrides.flipX) i.group.scale.x *= -1;
  if (overrides.stretchX !== undefined) i.group.scale.x *= overrides.stretchX;
  if (overrides.position) i.group.position.set(...overrides.position);
  i.overrides = overrides;
  return { ok: true };
}

export function deleteInstance(instanceUuid) {
  const i = _instances.get(instanceUuid);
  if (!i) return { ok: false };
  if (i.group.parent) i.group.parent.remove(i.group);
  _instances.delete(instanceUuid);
  return { ok: true };
}

export function redefineBlock(blockName) {
  // After editing the source meshes used to define the block, call this
  // to propagate the changes to every instance. We simply recreate
  // each instance's group from the (assumed updated) def — caller should
  // re-defineBlock first with the latest meshes.
  const def = _blockDefs.get(blockName);
  if (!def) return { ok: false };
  for (const i of _instances.values()) {
    if (i.block !== blockName) continue;
    // Clear children.
    while (i.group.children.length) {
      const c = i.group.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
    for (const m of def.meshes) {
      const mesh = new THREE.Mesh(_cloneGeometry(m.geo), m.mat);
      mesh.position.set(...m.position);
      mesh.quaternion.fromArray(m.quaternion);
      mesh.scale.fromArray(m.scale);
      i.group.add(mesh);
    }
  }
  return { ok: true };
}
