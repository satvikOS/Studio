// Slice 713 — KeyShot-style stage lighting. One-call setups for
// product photography: 3-point lighting, ring light, softbox + fill,
// rim light, cyclorama background. Each tags its lights with a
// slice-707 light group name so users can later tweak gain/tint.

import * as THREE from 'three';

const _setups = new Map();
let _seq = 1;
function _uid() { return `sl-${_seq++}-${Date.now().toString(36)}`; }

function _addLight(scene, light, groupName) {
  scene.add(light);
  if (typeof window.__studioLightGroupAssign === 'function') {
    try { window.__studioLightGroupAssign(light.uuid, groupName); } catch (_) {}
  }
  return light;
}

function _addReflectorCard(scene, position, lookAt, size, color) {
  const geo = new THREE.PlaneGeometry(size, size);
  const mat = new THREE.MeshBasicMaterial({
    color: color || 0xffffff,
    side: THREE.DoubleSide,
  });
  const card = new THREE.Mesh(geo, mat);
  card.position.set(...position);
  card.lookAt(...lookAt);
  card.userData.archdiscStudioStageProp = true;
  scene.add(card);
  return card;
}

export function threePoint(opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const target = opts?.target || [0, 0, 0];
  const distance = Number(opts?.distance) || 3;
  const intensity = Number(opts?.intensity) || 1;
  const group = `stage_${_uid()}`;
  const key = _addLight(scene, new THREE.DirectionalLight(0xffffff, intensity * 1.0), group);
  key.position.set(target[0] + distance * 0.7, target[1] + distance * 0.7, target[2] + distance * 0.5);
  key.target.position.set(...target);
  const fill = _addLight(scene, new THREE.DirectionalLight(0xfff4d8, intensity * 0.4), group);
  fill.position.set(target[0] - distance * 0.7, target[1] + distance * 0.3, target[2] + distance * 0.4);
  fill.target.position.set(...target);
  const back = _addLight(scene, new THREE.DirectionalLight(0xeed8ff, intensity * 0.6), group);
  back.position.set(target[0], target[1] + distance * 0.8, target[2] - distance * 0.6);
  back.target.position.set(...target);
  const ids = [key.uuid, fill.uuid, back.uuid];
  _setups.set(group, { kind: '3point', ids });
  return { ok: true, group, lightUuids: ids };
}

export function ringLight(opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const target = opts?.target || [0, 0, 0];
  const radius = Number(opts?.radius) || 2;
  const count = Math.max(6, Math.min(36, Number(opts?.count) || 12));
  const intensity = Number(opts?.intensity) || 0.5;
  const group = `ring_${_uid()}`;
  const ids = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const light = _addLight(scene, new THREE.PointLight(0xffffff, intensity), group);
    light.position.set(target[0] + Math.cos(a) * radius, target[1] + radius * 0.5, target[2] + Math.sin(a) * radius);
    ids.push(light.uuid);
  }
  _setups.set(group, { kind: 'ring', ids });
  return { ok: true, group, lightUuids: ids };
}

export function softboxFill(opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const target = opts?.target || [0, 0, 0];
  const distance = Number(opts?.distance) || 3;
  const cardSize = Number(opts?.cardSize) || 1.5;
  const group = `softbox_${_uid()}`;
  const main = _addLight(scene, new THREE.SpotLight(0xffffff, 1.6, 0, Math.PI / 6, 0.5), group);
  main.position.set(target[0] + distance * 0.5, target[1] + distance * 0.4, target[2] + distance * 0.6);
  main.target.position.set(...target);
  const card = _addReflectorCard(scene,
    [target[0] - distance * 0.4, target[1] + distance * 0.2, target[2] + distance * 0.3],
    target, cardSize, 0xfafafa);
  _setups.set(group, { kind: 'softbox', ids: [main.uuid], props: [card.uuid] });
  return { ok: true, group, lightUuids: [main.uuid], propUuids: [card.uuid] };
}

export function rimLight(opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const target = opts?.target || [0, 0, 0];
  const distance = Number(opts?.distance) || 3;
  const intensity = Number(opts?.intensity) || 1.5;
  const group = `rim_${_uid()}`;
  const rim = _addLight(scene, new THREE.SpotLight(0xfff8e8, intensity, 0, Math.PI / 5, 0.3), group);
  rim.position.set(target[0], target[1] + distance * 0.5, target[2] - distance);
  rim.target.position.set(...target);
  _setups.set(group, { kind: 'rim', ids: [rim.uuid] });
  return { ok: true, group, lightUuids: [rim.uuid] };
}

export function cyclorama(opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const color = opts?.color || [0.92, 0.92, 0.92];
  const radius = Number(opts?.radius) || 8;
  const height = Number(opts?.height) || 6;
  // Quarter-pipe cyclorama: vertical wall + floor + smooth fillet.
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2.4, height, 32, 32),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(...color), roughness: 0.95, side: THREE.DoubleSide }));
  wall.position.set(0, height / 2, -radius);
  wall.userData.archdiscStudioStageProp = true;
  scene.add(wall);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2.4, radius * 2.4, 32, 32),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(...color), roughness: 0.95, side: THREE.DoubleSide }));
  floor.rotation.x = -Math.PI / 2;
  floor.userData.archdiscStudioStageProp = true;
  scene.add(floor);
  const fillet = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.6, 12, 32, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(...color), roughness: 0.95 }));
  fillet.position.set(0, 0.6, -radius);
  fillet.rotation.x = -Math.PI / 2;
  fillet.userData.archdiscStudioStageProp = true;
  scene.add(fillet);
  const id = _uid();
  _setups.set(id, { kind: 'cyclorama', ids: [], props: [wall.uuid, floor.uuid, fillet.uuid] });
  return { ok: true, group: id, propUuids: [wall.uuid, floor.uuid, fillet.uuid] };
}

export function listSetups() {
  return {
    ok: true,
    setups: Array.from(_setups.entries()).map(([g, s]) => ({ group: g, kind: s.kind, lightCount: s.ids.length, propCount: (s.props || []).length })),
  };
}

export function clearSetup(group) {
  const s = _setups.get(group);
  if (!s) return { ok: false };
  const scene = window.__archdiscScene;
  if (scene) {
    for (const uuid of s.ids) {
      const o = scene.getObjectByProperty('uuid', uuid);
      if (o) scene.remove(o);
    }
    for (const uuid of (s.props || [])) {
      const o = scene.getObjectByProperty('uuid', uuid);
      if (o) scene.remove(o);
    }
  }
  _setups.delete(group);
  return { ok: true };
}
