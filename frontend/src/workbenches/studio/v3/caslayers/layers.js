// Slice 717 — Cascadeur animation layers. Additive animation layer
// stack: each layer holds per-bone transform deltas at keyframes;
// composite at evaluation by walking the stack with per-layer weight
// + blend mode (additive/override). Mirrors Cascadeur layers + Maya
// animation layers.

import * as THREE from 'three';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';

const _layerStacks = new Map();   // rootBoneUuid → { layers: [], frame: 0, fps: 30, playing }
let _seq = 1;
function _uid() { return `cl-${_seq++}-${Date.now().toString(36)}`; }

export function attach(rootBoneUuid, opts) {
  if (_layerStacks.has(rootBoneUuid)) return { ok: true };
  _layerStacks.set(rootBoneUuid, {
    layers: [],
    frame: 0,
    fps: Number(opts?.fps) || 30,
    playing: false,
    base: _captureBase(rootBoneUuid),
  });
  return { ok: true };
}

function _captureBase(rootBoneUuid) {
  const scene = window.__archdiscScene;
  if (!scene) return [];
  const base = [];
  const root = scene.getObjectByProperty('uuid', rootBoneUuid);
  if (!root) return base;
  root.traverse((b) => {
    if (b.isBone) {
      base.push({
        uuid: b.uuid,
        position: b.position.toArray(),
        quaternion: b.quaternion.toArray(),
        scale: b.scale.toArray(),
      });
    }
  });
  return base;
}

export function addLayer(rootBoneUuid, name, opts) {
  const stack = _layerStacks.get(rootBoneUuid);
  if (!stack) return { ok: false };
  const layer = {
    uuid: _uid(),
    name: name || `Layer ${stack.layers.length + 1}`,
    weight: Number(opts?.weight ?? 1),
    blendMode: opts?.blendMode || 'additive',
    enabled: opts?.enabled !== false,
    keyframes: new Map(),  // boneUuid → [{ frame, position?, quaternion?, scale? }]
  };
  stack.layers.push(layer);
  return { ok: true, uuid: layer.uuid };
}

export function setKey(rootBoneUuid, layerUuid, boneUuid, frame, delta) {
  const stack = _layerStacks.get(rootBoneUuid);
  if (!stack) return { ok: false };
  const layer = stack.layers.find((l) => l.uuid === layerUuid);
  if (!layer) return { ok: false };
  if (!layer.keyframes.has(boneUuid)) layer.keyframes.set(boneUuid, []);
  const keys = layer.keyframes.get(boneUuid);
  const idx = keys.findIndex((k) => k.frame === frame);
  if (idx >= 0) keys[idx] = { frame, ...delta };
  else { keys.push({ frame, ...delta }); keys.sort((a, b) => a.frame - b.frame); }
  return { ok: true };
}

function _interp(keys, frame) {
  if (keys.length === 0) return null;
  if (frame <= keys[0].frame) return keys[0];
  if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (keys[i].frame <= frame && keys[i + 1].frame >= frame) {
      const span = keys[i + 1].frame - keys[i].frame;
      const t = (frame - keys[i].frame) / span;
      const blended = { frame };
      if (keys[i].position && keys[i + 1].position) {
        blended.position = keys[i].position.map((v, idx) => v + (keys[i + 1].position[idx] - v) * t);
      }
      if (keys[i].quaternion && keys[i + 1].quaternion) {
        const qa = new THREE.Quaternion(...keys[i].quaternion);
        const qb = new THREE.Quaternion(...keys[i + 1].quaternion);
        const qOut = qa.slerp(qb, t);
        blended.quaternion = qOut.toArray();
      }
      if (keys[i].scale && keys[i + 1].scale) {
        blended.scale = keys[i].scale.map((v, idx) => v + (keys[i + 1].scale[idx] - v) * t);
      }
      return blended;
    }
  }
  return keys[keys.length - 1];
}

function _evaluate(rootBoneUuid) {
  const stack = _layerStacks.get(rootBoneUuid);
  if (!stack) return;
  const scene = window.__archdiscScene;
  if (!scene) return;
  // Reset each bone to base.
  for (const b of stack.base) {
    const bone = scene.getObjectByProperty('uuid', b.uuid);
    if (!bone) continue;
    bone.position.fromArray(b.position);
    bone.quaternion.fromArray(b.quaternion);
    bone.scale.fromArray(b.scale);
  }
  // Apply each enabled layer.
  for (const layer of stack.layers) {
    if (!layer.enabled || layer.weight === 0) continue;
    for (const [boneUuid, keys] of layer.keyframes.entries()) {
      const bone = scene.getObjectByProperty('uuid', boneUuid);
      if (!bone) continue;
      const v = _interp(keys, stack.frame);
      if (!v) continue;
      const w = layer.weight;
      if (layer.blendMode === 'override') {
        if (v.position) bone.position.fromArray(v.position);
        if (v.quaternion) bone.quaternion.fromArray(v.quaternion);
        if (v.scale) bone.scale.fromArray(v.scale);
      } else {
        if (v.position) {
          bone.position.x += v.position[0] * w;
          bone.position.y += v.position[1] * w;
          bone.position.z += v.position[2] * w;
        }
        if (v.quaternion) {
          const q = new THREE.Quaternion(...v.quaternion);
          bone.quaternion.slerp(q, w);
        }
        if (v.scale) {
          bone.scale.x *= (1 + (v.scale[0] - 1) * w);
          bone.scale.y *= (1 + (v.scale[1] - 1) * w);
          bone.scale.z *= (1 + (v.scale[2] - 1) * w);
        }
      }
    }
  }
}

export function setFrame(rootBoneUuid, frame) {
  const stack = _layerStacks.get(rootBoneUuid);
  if (!stack) return { ok: false };
  stack.frame = Number(frame) || 0;
  _evaluate(rootBoneUuid);
  return { ok: true };
}

export function play(rootBoneUuid) {
  const stack = _layerStacks.get(rootBoneUuid);
  if (!stack) return { ok: false };
  stack.playing = true;
  const key = `caslayer_${rootBoneUuid}`;
  chainIntoAnimTick(key, () => {
    if (!stack.playing) return;
    stack.frame++;
    _evaluate(rootBoneUuid);
  });
  return { ok: true };
}

export function pause(rootBoneUuid) {
  const stack = _layerStacks.get(rootBoneUuid);
  if (!stack) return { ok: false };
  stack.playing = false;
  return { ok: true };
}

export function setWeight(rootBoneUuid, layerUuid, weight) {
  const stack = _layerStacks.get(rootBoneUuid);
  const layer = stack?.layers.find((l) => l.uuid === layerUuid);
  if (!layer) return { ok: false };
  layer.weight = Math.max(0, Math.min(1, Number(weight)));
  _evaluate(rootBoneUuid);
  return { ok: true };
}

export function setEnabled(rootBoneUuid, layerUuid, enabled) {
  const stack = _layerStacks.get(rootBoneUuid);
  const layer = stack?.layers.find((l) => l.uuid === layerUuid);
  if (!layer) return { ok: false };
  layer.enabled = !!enabled;
  _evaluate(rootBoneUuid);
  return { ok: true };
}

export function removeLayer(rootBoneUuid, layerUuid) {
  const stack = _layerStacks.get(rootBoneUuid);
  if (!stack) return { ok: false };
  stack.layers = stack.layers.filter((l) => l.uuid !== layerUuid);
  return { ok: true };
}

export function listLayers(rootBoneUuid) {
  const stack = _layerStacks.get(rootBoneUuid);
  if (!stack) return { ok: false };
  return {
    ok: true,
    layers: stack.layers.map((l) => ({
      uuid: l.uuid, name: l.name, weight: l.weight, blendMode: l.blendMode,
      enabled: l.enabled,
      keyCount: Array.from(l.keyframes.values()).reduce((a, b) => a + b.length, 0),
    })),
    frame: stack.frame,
    playing: stack.playing,
  };
}

export function detach(rootBoneUuid) {
  unchainFromAnimTick(`caslayer_${rootBoneUuid}`);
  _layerStacks.delete(rootBoneUuid);
  return { ok: true };
}
