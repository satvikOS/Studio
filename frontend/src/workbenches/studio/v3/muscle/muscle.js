// Slice 708 — Maya muscle deformer. A muscle is a tube of capsule
// segments anchored to two bones; as the bones squash together, the
// muscle bulges (volume-preserving radius increase). The skin mesh is
// influenced by per-vertex distance falloff to each muscle, adding a
// dynamic bulge to baseline skin weights. Mirrors Maya's Muscle and
// Sticky Lips deformer plug-ins.

import * as THREE from 'three';

const _muscles = new Map();
let _seq = 1;
function _uid() { return `mus-${_seq++}-${Date.now().toString(36)}`; }

export function createMuscle(opts) {
  const id = _uid();
  const anchorA = opts?.anchorA || [0, 0, 0];
  const anchorB = opts?.anchorB || [0, 1, 0];
  const restLen = Math.sqrt(
    (anchorB[0] - anchorA[0]) ** 2 +
    (anchorB[1] - anchorA[1]) ** 2 +
    (anchorB[2] - anchorA[2]) ** 2
  );
  const baseRadius = Number(opts?.baseRadius) || 0.08;
  const muscle = {
    id,
    anchorA: [...anchorA], anchorB: [...anchorB],
    restLen,
    baseRadius,
    bulgeStrength: Number(opts?.bulgeStrength) || 0.5,
    falloff: Number(opts?.falloff) || 0.4,
    skinUuid: opts?.skinUuid || null,
    helper: null,
  };
  _muscles.set(id, muscle);
  _refreshHelper(muscle);
  return { ok: true, id };
}

function _refreshHelper(m) {
  if (m.helper) {
    if (m.helper.parent) m.helper.parent.remove(m.helper);
    m.helper.geometry.dispose();
    m.helper.material.dispose();
  }
  const a = new THREE.Vector3(...m.anchorA);
  const b = new THREE.Vector3(...m.anchorB);
  const len = a.distanceTo(b);
  if (len < 1e-5) return;
  const bulge = Math.max(0, (m.restLen - len) / m.restLen);
  const radius = m.baseRadius * (1 + bulge * m.bulgeStrength);
  const geo = new THREE.CylinderGeometry(radius, radius, len, 12, 1, false);
  geo.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    b.clone().sub(a).normalize());
  geo.applyQuaternion(q);
  geo.translate(a.x, a.y, a.z);
  const mat = new THREE.MeshBasicMaterial({ color: 0xcc4040, wireframe: true });
  const helper = new THREE.Mesh(geo, mat);
  helper.userData.muscleId = m.id;
  if (window.__archdiscScene) window.__archdiscScene.add(helper);
  m.helper = helper;
}

export function setAnchors(id, anchorA, anchorB) {
  const m = _muscles.get(id);
  if (!m) return { ok: false };
  m.anchorA = [...anchorA]; m.anchorB = [...anchorB];
  _refreshHelper(m);
  _applyToSkin(m);
  return { ok: true };
}

export function setBulgeStrength(id, s) {
  const m = _muscles.get(id);
  if (!m) return { ok: false };
  m.bulgeStrength = Number(s);
  _refreshHelper(m);
  _applyToSkin(m);
  return { ok: true };
}

export function setBaseRadius(id, r) {
  const m = _muscles.get(id);
  if (!m) return { ok: false };
  m.baseRadius = Math.max(0.001, Number(r));
  _refreshHelper(m);
  _applyToSkin(m);
  return { ok: true };
}

export function setSkinMesh(id, skinUuid) {
  const m = _muscles.get(id);
  if (!m) return { ok: false };
  // Cache the rest geometry once.
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const skin = scene.getObjectByProperty('uuid', skinUuid);
  if (!skin || !skin.geometry) return { ok: false };
  m.skinUuid = skinUuid;
  if (!skin.userData) skin.userData = {};
  if (!skin.userData.archdiscMuscleBase) {
    skin.userData.archdiscMuscleBase = new Float32Array(skin.geometry.attributes.position.array);
  }
  _applyToSkin(m);
  return { ok: true };
}

function _applyToSkin(m) {
  if (!m.skinUuid) return;
  const scene = window.__archdiscScene;
  if (!scene) return;
  const skin = scene.getObjectByProperty('uuid', m.skinUuid);
  if (!skin || !skin.geometry) return;
  const pos = skin.geometry.attributes.position;
  const base = skin.userData.archdiscMuscleBase;
  if (!base) return;
  const a = new THREE.Vector3(...m.anchorA);
  const b = new THREE.Vector3(...m.anchorB);
  const len = a.distanceTo(b);
  const bulge = Math.max(0, (m.restLen - len) / m.restLen);
  const bulgeAmt = bulge * m.bulgeStrength * m.baseRadius;
  const fall = m.falloff;
  for (let i = 0; i < pos.count; i++) {
    const vx = base[i * 3], vy = base[i * 3 + 1], vz = base[i * 3 + 2];
    // Distance from vertex to muscle line.
    const ax = vx - a.x, ay = vy - a.y, az = vz - a.z;
    const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
    const tDen = bax * bax + bay * bay + baz * baz;
    if (tDen === 0) continue;
    const tParam = Math.max(0, Math.min(1, (ax * bax + ay * bay + az * baz) / tDen));
    const cx = a.x + bax * tParam, cy = a.y + bay * tParam, cz = a.z + baz * tParam;
    const dx = vx - cx, dy = vy - cy, dz = vz - cz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > fall) continue;
    const w = 1 - d / fall;
    const nLen = d === 0 ? 1 : d;
    pos.array[i * 3] = vx + (dx / nLen) * bulgeAmt * w;
    pos.array[i * 3 + 1] = vy + (dy / nLen) * bulgeAmt * w;
    pos.array[i * 3 + 2] = vz + (dz / nLen) * bulgeAmt * w;
  }
  pos.needsUpdate = true;
  skin.geometry.computeVertexNormals();
}

export function deleteMuscle(id) {
  const m = _muscles.get(id);
  if (!m) return { ok: false };
  if (m.helper && m.helper.parent) m.helper.parent.remove(m.helper);
  _muscles.delete(id);
  return { ok: true };
}

export function listMuscles() {
  return {
    ok: true,
    muscles: Array.from(_muscles.values()).map((m) => ({
      id: m.id, anchorA: m.anchorA, anchorB: m.anchorB,
      bulgeStrength: m.bulgeStrength, baseRadius: m.baseRadius,
      skinUuid: m.skinUuid,
    })),
  };
}
