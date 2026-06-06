// Slice 711 — Substance material atlas. 24 prebuilt PBR materials
// each generated procedurally from slice-696 sdesigner + slice-702
// sdesignpro primitives. Materials expose RGBA Float32Array buffers
// + a Three.js MeshStandardMaterial that wraps the canvas-converted
// CanvasTextures. Mirrors Substance's "Source" material library.

import * as THREE from 'three';

const _materials = new Map();

function _bufToTex(buf, size) {
  // Float RGBA → Uint8 canvas → CanvasTexture (depth + perf headroom).
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    img.data[i * 4]     = Math.max(0, Math.min(255, buf[i * 4]     * 255));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, buf[i * 4 + 1] * 255));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, buf[i * 4 + 2] * 255));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function _heightFn(opts, fn) {
  const size = opts?.size || 256;
  const buf = new Float32Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const c = fn(u, v);
      const i = (y * size + x) * 4;
      buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 1;
    }
  }
  return { buf, size };
}

function _hash(x, y) {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

// 24 procedural PBR materials.
const MATERIAL_GENERATORS = {
  red_brick: (o) => _heightFn(o, (u, v) => {
    const row = Math.floor(v * 24);
    const offset = (row % 2) * 0.5;
    const col = Math.floor((u + offset) * 12);
    const mortarV = ((v * 24) % 1) < 0.07 || (((u + offset) * 12) % 1) < 0.07;
    if (mortarV) return [0.5, 0.45, 0.4];
    const brick = 0.6 + _hash(col, row) * 0.2;
    return [brick * 0.7, brick * 0.25, brick * 0.2];
  }),
  weathered_concrete: (o) => _heightFn(o, (u, v) => {
    const n1 = _hash(u * 12, v * 12);
    const n2 = _hash(u * 60, v * 60) * 0.4;
    const v01 = 0.5 + n1 * 0.2 + n2;
    return [v01 * 0.85, v01 * 0.85, v01 * 0.8];
  }),
  asphalt: (o) => _heightFn(o, (u, v) => {
    const grain = _hash(u * 200, v * 200) * 0.3 + _hash(u * 20, v * 20) * 0.1;
    return [0.15 + grain, 0.15 + grain, 0.17 + grain];
  }),
  oak_wood: (o) => _heightFn(o, (u, v) => {
    const rings = Math.sin(u * 60 + _hash(0, v * 4) * 6) * 0.5 + 0.5;
    const r = 0.6 + rings * 0.3;
    return [r * 0.65, r * 0.42, r * 0.2];
  }),
  marble: (o) => _heightFn(o, (u, v) => {
    const m = Math.abs(Math.sin(u * 16 + _hash(u, v) * 8));
    return [0.95 - m * 0.15, 0.95 - m * 0.15, 0.92 - m * 0.15];
  }),
  copper: (o) => _heightFn(o, (u, v) => {
    const patina = _hash(u * 8, v * 8) * 0.2;
    return [0.85 - patina, 0.5 + patina, 0.3 + patina * 2];
  }),
  brushed_steel: (o) => _heightFn(o, (u, v) => {
    const stripe = Math.sin(v * 600) * 0.05 + 0.5;
    return [stripe + 0.4, stripe + 0.4, stripe + 0.45];
  }),
  rusty_iron: (o) => _heightFn(o, (u, v) => {
    const rust = _hash(u * 8, v * 8) * 0.4 + _hash(u * 40, v * 40) * 0.1;
    return [0.55 + rust * 0.2, 0.3 + rust * 0.15, 0.15 + rust * 0.05];
  }),
  gold: () => _heightFn({ size: 32 }, () => [1.0, 0.78, 0.34]),
  silver: () => _heightFn({ size: 32 }, () => [0.96, 0.96, 0.97]),
  carbon_fiber: (o) => _heightFn(o, (u, v) => {
    const a = Math.floor(u * 40), b = Math.floor(v * 40);
    const dark = ((a + b) % 2) ? 0.05 : 0.15;
    return [dark, dark, dark];
  }),
  leather: (o) => _heightFn(o, (u, v) => {
    const n = _hash(u * 24, v * 24);
    const dark = 0.35 + n * 0.1;
    return [dark, dark * 0.7, dark * 0.5];
  }),
  cobblestone: (o) => _heightFn(o, (u, v) => {
    const cell = [Math.floor(u * 6), Math.floor(v * 6)];
    const c = _hash(cell[0], cell[1]) * 0.3 + 0.5;
    const edge = (u * 6 % 1 < 0.06) || (v * 6 % 1 < 0.06);
    if (edge) return [0.1, 0.1, 0.1];
    return [c * 0.6, c * 0.6, c * 0.55];
  }),
  grass: (o) => _heightFn(o, (u, v) => {
    const n = _hash(u * 60, v * 60);
    return [0.2 + n * 0.1, 0.55 + n * 0.2, 0.15 + n * 0.05];
  }),
  sand: (o) => _heightFn(o, (u, v) => {
    const n = _hash(u * 80, v * 80) * 0.3 + 0.7;
    return [n, n * 0.9, n * 0.6];
  }),
  snow: () => _heightFn({ size: 32 }, () => [0.97, 0.98, 1.0]),
  ice: (o) => _heightFn(o, (u, v) => {
    const n = _hash(u * 16, v * 16) * 0.1 + 0.85;
    return [n * 0.85, n * 0.92, n];
  }),
  fabric_blue: (o) => _heightFn(o, (u, v) => {
    const weave = ((Math.floor(u * 32) + Math.floor(v * 32)) % 2) * 0.15 + 0.3;
    return [weave * 0.2, weave * 0.4, weave * 0.8];
  }),
  fabric_red: (o) => _heightFn(o, (u, v) => {
    const weave = ((Math.floor(u * 32) + Math.floor(v * 32)) % 2) * 0.15 + 0.3;
    return [weave * 0.8, weave * 0.15, weave * 0.1];
  }),
  rubber: () => _heightFn({ size: 32 }, () => [0.08, 0.08, 0.08]),
  plaster: (o) => _heightFn(o, (u, v) => {
    const n = _hash(u * 30, v * 30) * 0.1 + 0.9;
    return [n, n * 0.95, n * 0.9];
  }),
  tile: (o) => _heightFn(o, (u, v) => {
    const cell = (Math.floor(u * 8) + Math.floor(v * 8)) % 2;
    return cell ? [0.95, 0.95, 0.95] : [0.2, 0.2, 0.25];
  }),
  porcelain: () => _heightFn({ size: 32 }, () => [0.97, 0.96, 0.93]),
  velvet: (o) => _heightFn(o, (u, v) => {
    const n = _hash(u * 60, v * 60) * 0.05 + 0.4;
    return [n * 0.5, n * 0.1, n * 0.5];
  }),
};

// Per-material PBR params.
const PBR_PARAMS = {
  red_brick:         { roughness: 0.85, metalness: 0.0 },
  weathered_concrete:{ roughness: 0.9, metalness: 0.0 },
  asphalt:           { roughness: 0.95, metalness: 0.0 },
  oak_wood:          { roughness: 0.7, metalness: 0.0 },
  marble:            { roughness: 0.2, metalness: 0.0 },
  copper:            { roughness: 0.4, metalness: 0.95 },
  brushed_steel:     { roughness: 0.4, metalness: 0.9 },
  rusty_iron:        { roughness: 0.8, metalness: 0.4 },
  gold:              { roughness: 0.2, metalness: 1.0 },
  silver:            { roughness: 0.15, metalness: 1.0 },
  carbon_fiber:      { roughness: 0.4, metalness: 0.0 },
  leather:           { roughness: 0.75, metalness: 0.0 },
  cobblestone:       { roughness: 0.9, metalness: 0.0 },
  grass:             { roughness: 0.95, metalness: 0.0 },
  sand:              { roughness: 0.95, metalness: 0.0 },
  snow:              { roughness: 0.85, metalness: 0.0 },
  ice:               { roughness: 0.05, metalness: 0.0, transmission: 0.5, ior: 1.31 },
  fabric_blue:       { roughness: 0.85, metalness: 0.0 },
  fabric_red:        { roughness: 0.85, metalness: 0.0 },
  rubber:            { roughness: 0.95, metalness: 0.0 },
  plaster:           { roughness: 0.92, metalness: 0.0 },
  tile:              { roughness: 0.25, metalness: 0.0 },
  porcelain:         { roughness: 0.18, metalness: 0.0 },
  velvet:            { roughness: 0.95, metalness: 0.0 },
};

export function getMaterial(name) {
  if (_materials.has(name)) return _materials.get(name);
  const gen = MATERIAL_GENERATORS[name];
  if (!gen) return null;
  const { buf, size } = gen({ size: 256 });
  const tex = _bufToTex(buf, size);
  const params = PBR_PARAMS[name] || {};
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: params.roughness ?? 0.5,
    metalness: params.metalness ?? 0.0,
  });
  if (params.transmission !== undefined) {
    mat.transmission = params.transmission;
    mat.ior = params.ior;
  }
  _materials.set(name, { mat, buf, size });
  return _materials.get(name);
}

export function listMaterials() {
  return { ok: true, names: Object.keys(MATERIAL_GENERATORS) };
}

export function applyMaterial(meshUuid, name) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return { ok: false };
  const m = getMaterial(name);
  if (!m) return { ok: false, error: 'unknown material: ' + name };
  mesh.material = m.mat;
  return { ok: true };
}

export function getMaterialDataURL(name) {
  const m = getMaterial(name);
  if (!m) return null;
  return m.mat.map.image.toDataURL?.('image/png');
}
