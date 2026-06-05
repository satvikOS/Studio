// Slice 701 — Blendshape (morph target) animation. A mesh stores N
// alternate vertex-position arrays as "targets"; a weight vector blends
// each target into the rendered geometry. Mirrors Maya / Blender shape
// keys / Cascadeur / ZBrush's morph-target paradigm.

const _meta = new Map();   // meshUuid → { base: Float32Array, targets: [{uuid, name, positions:Float32Array, weight}] }

let _seq = 1;
function _uuid() { return `bs-${_seq++}-${Date.now().toString(36)}`; }

function _meshOf(meshUuid) {
  const scene = window.__archdiscScene;
  return scene ? scene.getObjectByProperty('uuid', meshUuid) : null;
}

function _ensureMeta(mesh) {
  if (!_meta.has(mesh.uuid)) {
    const pos = mesh.geometry.attributes.position;
    _meta.set(mesh.uuid, {
      base: new Float32Array(pos.array),
      targets: [],
    });
  }
  return _meta.get(mesh.uuid);
}

export function addTarget(meshUuid, name, positionsArray) {
  const mesh = _meshOf(meshUuid);
  if (!mesh || !mesh.geometry) return { ok: false };
  const meta = _ensureMeta(mesh);
  const positions = positionsArray instanceof Float32Array
    ? new Float32Array(positionsArray)
    : new Float32Array(mesh.geometry.attributes.position.array);
  if (positions.length !== meta.base.length) {
    return { ok: false, error: 'target length mismatch' };
  }
  const t = { uuid: _uuid(), name: name || `target_${meta.targets.length + 1}`, positions, weight: 0 };
  meta.targets.push(t);
  return { ok: true, uuid: t.uuid, name: t.name };
}

export function setWeight(meshUuid, targetUuid, weight) {
  const meta = _meta.get(meshUuid);
  if (!meta) return { ok: false };
  const t = meta.targets.find((x) => x.uuid === targetUuid);
  if (!t) return { ok: false };
  t.weight = Math.max(0, Math.min(1, Number(weight) || 0));
  return apply(meshUuid);
}

export function setWeightByName(meshUuid, name, weight) {
  const meta = _meta.get(meshUuid);
  if (!meta) return { ok: false };
  const t = meta.targets.find((x) => x.name === name);
  if (!t) return { ok: false };
  t.weight = Math.max(0, Math.min(1, Number(weight) || 0));
  return apply(meshUuid);
}

export function apply(meshUuid) {
  const mesh = _meshOf(meshUuid);
  if (!mesh || !mesh.geometry) return { ok: false };
  const meta = _meta.get(meshUuid);
  if (!meta) return { ok: false };
  const pos = mesh.geometry.attributes.position;
  // pos = base + sum(weight_i * (target_i - base))
  for (let i = 0; i < pos.array.length; i++) {
    let v = meta.base[i];
    for (const t of meta.targets) {
      if (t.weight !== 0) v += (t.positions[i] - meta.base[i]) * t.weight;
    }
    pos.array[i] = v;
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
  return { ok: true };
}

export function removeTarget(meshUuid, targetUuid) {
  const meta = _meta.get(meshUuid);
  if (!meta) return { ok: false };
  meta.targets = meta.targets.filter((t) => t.uuid !== targetUuid);
  return apply(meshUuid);
}

export function listTargets(meshUuid) {
  const meta = _meta.get(meshUuid);
  if (!meta) return { ok: false };
  return {
    ok: true,
    count: meta.targets.length,
    targets: meta.targets.map((t) => ({ uuid: t.uuid, name: t.name, weight: t.weight, vertCount: t.positions.length / 3 })),
  };
}

export function captureCurrentAsTarget(meshUuid, name) {
  const mesh = _meshOf(meshUuid);
  if (!mesh) return { ok: false };
  const pos = mesh.geometry.attributes.position.array;
  return addTarget(meshUuid, name, new Float32Array(pos));
}

export function resetToBase(meshUuid) {
  const mesh = _meshOf(meshUuid);
  const meta = _meta.get(meshUuid);
  if (!mesh || !meta) return { ok: false };
  const pos = mesh.geometry.attributes.position;
  pos.array.set(meta.base);
  pos.needsUpdate = true;
  for (const t of meta.targets) t.weight = 0;
  mesh.geometry.computeVertexNormals();
  return { ok: true };
}

export function clearTargets(meshUuid) {
  const meta = _meta.get(meshUuid);
  if (!meta) return { ok: false };
  meta.targets = [];
  return resetToBase(meshUuid);
}
