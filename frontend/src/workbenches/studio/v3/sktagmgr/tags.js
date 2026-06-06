// Slice 715 — SketchUp Tag Manager (Layers in classic SketchUp). Each
// mesh can be assigned to a tag; tags can be made visible/hidden,
// locked, recolored. Closes the org-tooling gap (vs. SketchUp's
// Outliner + Tags panels).

const _tags = new Map();   // tagName → { visible, locked, color, meshUuids }
const _meshTag = new Map(); // meshUuid → tagName

function _ensureTag(name) {
  if (!_tags.has(name)) {
    _tags.set(name, { visible: true, locked: false, color: null, meshUuids: new Set() });
  }
  return _tags.get(name);
}

export function createTag(name, opts) {
  const t = _ensureTag(name);
  if (opts?.color) t.color = opts.color;
  if (opts?.visible !== undefined) t.visible = !!opts.visible;
  if (opts?.locked !== undefined) t.locked = !!opts.locked;
  _applyTagState(name);
  return { ok: true };
}

export function deleteTag(name) {
  const t = _tags.get(name);
  if (!t) return { ok: false };
  for (const uuid of t.meshUuids) _meshTag.delete(uuid);
  _tags.delete(name);
  return { ok: true };
}

export function assignToTag(meshUuid, tagName) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return { ok: false };
  // Remove from old tag.
  const oldTag = _meshTag.get(meshUuid);
  if (oldTag) {
    const o = _tags.get(oldTag);
    if (o) o.meshUuids.delete(meshUuid);
  }
  // Add to new.
  const t = _ensureTag(tagName);
  t.meshUuids.add(meshUuid);
  _meshTag.set(meshUuid, tagName);
  _applyMeshState(meshUuid);
  return { ok: true };
}

function _applyTagState(name) {
  const t = _tags.get(name);
  if (!t) return;
  for (const uuid of t.meshUuids) _applyMeshState(uuid);
}

function _applyMeshState(uuid) {
  const scene = window.__archdiscScene;
  if (!scene) return;
  const mesh = scene.getObjectByProperty('uuid', uuid);
  if (!mesh) return;
  const tagName = _meshTag.get(uuid);
  if (!tagName) return;
  const t = _tags.get(tagName);
  if (!t) return;
  mesh.visible = t.visible;
  if (!mesh.userData) mesh.userData = {};
  mesh.userData.archdiscTagLocked = t.locked;
  if (t.color && mesh.material?.color && !mesh.userData.archdiscOrigColor) {
    mesh.userData.archdiscOrigColor = mesh.material.color.clone();
  }
  if (t.color && mesh.material?.color) {
    mesh.material.color.setRGB(t.color[0], t.color[1], t.color[2]);
  } else if (!t.color && mesh.userData.archdiscOrigColor) {
    mesh.material.color.copy(mesh.userData.archdiscOrigColor);
    delete mesh.userData.archdiscOrigColor;
  }
}

export function setVisible(name, visible) {
  const t = _ensureTag(name);
  t.visible = !!visible;
  _applyTagState(name);
  return { ok: true };
}

export function setLocked(name, locked) {
  const t = _ensureTag(name);
  t.locked = !!locked;
  _applyTagState(name);
  return { ok: true };
}

export function setColor(name, color) {
  const t = _ensureTag(name);
  t.color = color;
  _applyTagState(name);
  return { ok: true };
}

export function listTags() {
  return {
    ok: true,
    tags: Array.from(_tags.entries()).map(([name, t]) => ({
      name, visible: t.visible, locked: t.locked, color: t.color,
      memberCount: t.meshUuids.size,
    })),
  };
}

export function getTagOf(meshUuid) {
  return { ok: true, tag: _meshTag.get(meshUuid) || null };
}

export function isolateTag(name) {
  for (const [other, t] of _tags.entries()) {
    t.visible = (other === name);
  }
  for (const tag of _tags.keys()) _applyTagState(tag);
  return { ok: true };
}

export function showAll() {
  for (const t of _tags.values()) t.visible = true;
  for (const tag of _tags.keys()) _applyTagState(tag);
  return { ok: true };
}
