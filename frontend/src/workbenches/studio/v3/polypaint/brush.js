// Slice 714 — ZBrush Polypaint vertex color brush. Paints per-vertex
// colors on a mesh via raycast brush. Supports brush radius, falloff,
// flow rate, color, alpha, smooth-color, fill, gradient, layer stack
// (independent paint layers with blending modes).

import * as THREE from 'three';

const _state = {
  activeUuid: null,
  layers: new Map(),  // meshUuid → [{ name, colors, opacity, blend, visible }]
  brush: { radius: 0.5, falloff: 0.5, color: [1, 1, 1], flow: 0.5, alpha: 1 },
  baseColors: new Map(), // meshUuid → original Float32Array
};

function _ensureMeshLayers(meshUuid) {
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', meshUuid);
  if (!mesh || !mesh.geometry) return null;
  if (!_state.layers.has(meshUuid)) {
    const pos = mesh.geometry.attributes.position;
    const base = new Float32Array(pos.count * 3);
    base.fill(1);
    _state.baseColors.set(meshUuid, base);
    _state.layers.set(meshUuid, [{
      name: 'Base',
      colors: new Float32Array(base),
      opacity: 1,
      blend: 'normal',
      visible: true,
    }]);
    // Apply to mesh.
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(base), 3));
    if (mesh.material) {
      mesh.material.vertexColors = true;
      mesh.material.needsUpdate = true;
    }
  }
  return _state.layers.get(meshUuid);
}

function _composite(meshUuid) {
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return;
  const layers = _state.layers.get(meshUuid);
  if (!layers || layers.length === 0) return;
  const base = _state.baseColors.get(meshUuid);
  const colors = mesh.geometry.attributes.color;
  // Composite from base + each visible layer.
  for (let i = 0; i < colors.count; i++) {
    let r = base[i * 3], g = base[i * 3 + 1], b = base[i * 3 + 2];
    for (const l of layers) {
      if (!l.visible) continue;
      const lr = l.colors[i * 3], lg = l.colors[i * 3 + 1], lb = l.colors[i * 3 + 2];
      const op = l.opacity;
      if (l.blend === 'multiply') {
        r = r * (1 - op) + (r * lr) * op;
        g = g * (1 - op) + (g * lg) * op;
        b = b * (1 - op) + (b * lb) * op;
      } else if (l.blend === 'add') {
        r += lr * op; g += lg * op; b += lb * op;
      } else {
        r = r * (1 - op) + lr * op;
        g = g * (1 - op) + lg * op;
        b = b * (1 - op) + lb * op;
      }
    }
    colors.array[i * 3]     = Math.max(0, Math.min(1, r));
    colors.array[i * 3 + 1] = Math.max(0, Math.min(1, g));
    colors.array[i * 3 + 2] = Math.max(0, Math.min(1, b));
  }
  colors.needsUpdate = true;
}

export function setActiveMesh(meshUuid) {
  _ensureMeshLayers(meshUuid);
  _state.activeUuid = meshUuid;
  return { ok: true };
}

export function setBrush(opts) {
  Object.assign(_state.brush, opts || {});
  return { ok: true, brush: { ..._state.brush } };
}

export function paintAt(layerIdx, worldPos) {
  const meshUuid = _state.activeUuid;
  if (!meshUuid) return { ok: false };
  const layers = _ensureMeshLayers(meshUuid);
  if (!layers) return { ok: false };
  const layer = layers[layerIdx];
  if (!layer) return { ok: false };
  const scene = window.__archdiscScene;
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return { ok: false };
  const pos = mesh.geometry.attributes.position;
  mesh.updateMatrixWorld(true);
  const target = new THREE.Vector3(...worldPos);
  const r = _state.brush.radius;
  const falloff = _state.brush.falloff;
  const flow = _state.brush.flow;
  const [cr, cg, cb] = _state.brush.color;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.array[i * 3], pos.array[i * 3 + 1], pos.array[i * 3 + 2]).applyMatrix4(mesh.matrixWorld);
    const d = v.distanceTo(target);
    if (d > r) continue;
    const w = Math.pow(1 - d / r, 1 + falloff * 3) * flow;
    layer.colors[i * 3]     = layer.colors[i * 3]     * (1 - w) + cr * w;
    layer.colors[i * 3 + 1] = layer.colors[i * 3 + 1] * (1 - w) + cg * w;
    layer.colors[i * 3 + 2] = layer.colors[i * 3 + 2] * (1 - w) + cb * w;
  }
  _composite(meshUuid);
  return { ok: true };
}

export function addLayer(name, opts) {
  const meshUuid = _state.activeUuid;
  if (!meshUuid) return { ok: false };
  const layers = _ensureMeshLayers(meshUuid);
  const scene = window.__archdiscScene;
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  const pos = mesh.geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  colors.fill(0);
  layers.push({
    name: name || `Layer ${layers.length + 1}`,
    colors,
    opacity: Number(opts?.opacity ?? 1),
    blend: opts?.blend || 'normal',
    visible: opts?.visible !== false,
  });
  _composite(meshUuid);
  return { ok: true, idx: layers.length - 1 };
}

export function removeLayer(idx) {
  const meshUuid = _state.activeUuid;
  if (!meshUuid) return { ok: false };
  const layers = _state.layers.get(meshUuid);
  if (!layers || idx <= 0 || idx >= layers.length) return { ok: false };
  layers.splice(idx, 1);
  _composite(meshUuid);
  return { ok: true };
}

export function setLayerOpacity(idx, opacity) {
  const meshUuid = _state.activeUuid;
  const layers = _state.layers.get(meshUuid);
  if (!layers || !layers[idx]) return { ok: false };
  layers[idx].opacity = Math.max(0, Math.min(1, Number(opacity)));
  _composite(meshUuid);
  return { ok: true };
}

export function setLayerVisible(idx, visible) {
  const meshUuid = _state.activeUuid;
  const layers = _state.layers.get(meshUuid);
  if (!layers || !layers[idx]) return { ok: false };
  layers[idx].visible = !!visible;
  _composite(meshUuid);
  return { ok: true };
}

export function setLayerBlend(idx, blend) {
  const meshUuid = _state.activeUuid;
  const layers = _state.layers.get(meshUuid);
  if (!layers || !layers[idx]) return { ok: false };
  layers[idx].blend = blend;
  _composite(meshUuid);
  return { ok: true };
}

export function listLayers() {
  const meshUuid = _state.activeUuid;
  const layers = _state.layers.get(meshUuid);
  if (!layers) return { ok: false };
  return {
    ok: true,
    layers: layers.map((l, i) => ({ idx: i, name: l.name, opacity: l.opacity, blend: l.blend, visible: l.visible })),
  };
}

export function fillLayer(idx, color) {
  const meshUuid = _state.activeUuid;
  const layers = _state.layers.get(meshUuid);
  if (!layers || !layers[idx]) return { ok: false };
  const [r, g, b] = color;
  const c = layers[idx].colors;
  for (let i = 0; i < c.length; i += 3) {
    c[i] = r; c[i + 1] = g; c[i + 2] = b;
  }
  _composite(meshUuid);
  return { ok: true };
}
