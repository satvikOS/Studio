// Slice 720 — Marvelous Designer wear & fray. Adds simulated rips,
// fades, and pull-strings to a garment over time. Each wear event
// is a localized perturbation: rip (split triangles), fade (lower
// vertex colors), pull (move a chain of vertices in a direction).

import * as THREE from 'three';

const _wearStates = new Map();
let _seq = 1;
function _uid() { return `wr-${_seq++}-${Date.now().toString(36)}`; }

export function attach(meshUuid) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry) return { ok: false };
  _wearStates.set(meshUuid, {
    events: [],
    baseColors: mesh.geometry.attributes.color
      ? new Float32Array(mesh.geometry.attributes.color.array)
      : null,
  });
  return { ok: true };
}

export function rip(meshUuid, worldPos, radius, depth) {
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry) return { ok: false };
  const state = _wearStates.get(meshUuid);
  if (!state) return { ok: false };
  const r = Number(radius) || 0.1;
  const d = Number(depth) || 0.05;
  const pos = mesh.geometry.attributes.position;
  const target = new THREE.Vector3(...worldPos);
  mesh.updateMatrixWorld(true);
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.array[i * 3], pos.array[i * 3 + 1], pos.array[i * 3 + 2]).applyMatrix4(mesh.matrixWorld);
    const dist = v.distanceTo(target);
    if (dist > r) continue;
    const w = Math.pow(1 - dist / r, 2);
    // Move vertex along normal by -d (creates inward dent → tear).
    const nx = mesh.geometry.attributes.normal.array[i * 3];
    const ny = mesh.geometry.attributes.normal.array[i * 3 + 1];
    const nz = mesh.geometry.attributes.normal.array[i * 3 + 2];
    pos.array[i * 3]     -= nx * d * w;
    pos.array[i * 3 + 1] -= ny * d * w;
    pos.array[i * 3 + 2] -= nz * d * w;
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  state.events.push({ kind: 'rip', uuid: _uid(), pos: worldPos, radius: r, depth: d });
  return { ok: true };
}

export function fade(meshUuid, worldPos, radius, fadeAmount) {
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry) return { ok: false };
  const state = _wearStates.get(meshUuid);
  if (!state) return { ok: false };
  // Ensure mesh has vertex colors.
  if (!mesh.geometry.attributes.color) {
    const colors = new Float32Array(mesh.geometry.attributes.position.count * 3);
    colors.fill(1);
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (mesh.material) {
      mesh.material.vertexColors = true;
      mesh.material.needsUpdate = true;
    }
  }
  const r = Number(radius) || 0.1;
  const f = Math.max(0, Math.min(1, Number(fadeAmount)));
  const pos = mesh.geometry.attributes.position;
  const colors = mesh.geometry.attributes.color;
  const target = new THREE.Vector3(...worldPos);
  mesh.updateMatrixWorld(true);
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.array[i * 3], pos.array[i * 3 + 1], pos.array[i * 3 + 2]).applyMatrix4(mesh.matrixWorld);
    const dist = v.distanceTo(target);
    if (dist > r) continue;
    const w = Math.pow(1 - dist / r, 2) * f;
    // Fade toward grey.
    colors.array[i * 3]     = colors.array[i * 3]     * (1 - w) + 0.5 * w;
    colors.array[i * 3 + 1] = colors.array[i * 3 + 1] * (1 - w) + 0.5 * w;
    colors.array[i * 3 + 2] = colors.array[i * 3 + 2] * (1 - w) + 0.5 * w;
  }
  colors.needsUpdate = true;
  state.events.push({ kind: 'fade', uuid: _uid(), pos: worldPos, radius: r, fade: f });
  return { ok: true };
}

export function pull(meshUuid, worldPos, direction, radius, strength) {
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry) return { ok: false };
  const state = _wearStates.get(meshUuid);
  if (!state) return { ok: false };
  const r = Number(radius) || 0.1;
  const s = Number(strength) || 0.1;
  const pos = mesh.geometry.attributes.position;
  const target = new THREE.Vector3(...worldPos);
  const dirV = new THREE.Vector3(...direction).normalize();
  mesh.updateMatrixWorld(true);
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.array[i * 3], pos.array[i * 3 + 1], pos.array[i * 3 + 2]).applyMatrix4(mesh.matrixWorld);
    const dist = v.distanceTo(target);
    if (dist > r) continue;
    const w = Math.pow(1 - dist / r, 2);
    pos.array[i * 3]     += dirV.x * s * w;
    pos.array[i * 3 + 1] += dirV.y * s * w;
    pos.array[i * 3 + 2] += dirV.z * s * w;
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  state.events.push({ kind: 'pull', uuid: _uid(), pos: worldPos, dir: direction, radius: r, strength: s });
  return { ok: true };
}

export function listEvents(meshUuid) {
  const state = _wearStates.get(meshUuid);
  if (!state) return { ok: false };
  return { ok: true, events: state.events };
}

export function clearEvents(meshUuid) {
  const state = _wearStates.get(meshUuid);
  if (!state) return { ok: false };
  state.events = [];
  return { ok: true };
}
