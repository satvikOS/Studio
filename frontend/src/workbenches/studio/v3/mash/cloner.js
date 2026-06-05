// Slice 699 — Maya MASH-style motion graphics: cloners + deformers
// with falloff awareness. Different paradigm from C4D MoGraph (slice
// 684 mograph/): MASH builds an explicit per-clone "input data" array
// that flows through a chain of nodes (Distribute → Random → Bend →
// World) before any matrix is committed.

import * as THREE from 'three';
import { mulberry32, seededRandom01 } from '../common/random.js';
import { makeInstancedMesh, setInstanceMatrices } from '../common/instance.js';

const _networks = new Map();
let _seq = 1;
function _uuid() { return `mash-${_seq++}-${Date.now().toString(36)}`; }

function _emptyClone() {
  return { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, color: [1, 1, 1], hidden: false };
}

const NODES = {
  distribute: (clones, params, rng) => {
    const count = clones.length;
    const mode = params.mode || 'linear';
    if (mode === 'linear') {
      const off = params.offset || [0.5, 0, 0];
      for (let i = 0; i < count; i++) {
        clones[i].x = off[0] * i;
        clones[i].y = off[1] * i;
        clones[i].z = off[2] * i;
      }
    } else if (mode === 'radial') {
      const radius = params.radius ?? 1;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        clones[i].x = Math.cos(a) * radius;
        clones[i].z = Math.sin(a) * radius;
      }
    } else if (mode === 'grid') {
      const nx = params.nx ?? Math.ceil(Math.sqrt(count));
      const spacing = params.spacing || [0.5, 0, 0.5];
      for (let i = 0; i < count; i++) {
        const cx = i % nx, cz = Math.floor(i / nx);
        clones[i].x = (cx - nx / 2) * spacing[0];
        clones[i].z = (cz - nx / 2) * spacing[2];
      }
    } else if (mode === 'sphere') {
      const radius = params.radius ?? 1;
      for (let i = 0; i < count; i++) {
        const phi = Math.acos(1 - 2 * (i + 0.5) / count);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        clones[i].x = Math.cos(theta) * Math.sin(phi) * radius;
        clones[i].y = Math.sin(theta) * Math.sin(phi) * radius;
        clones[i].z = Math.cos(phi) * radius;
      }
    }
  },
  random: (clones, params, rng) => {
    const posVar = params.posVariance || [0.1, 0.1, 0.1];
    const rotVar = params.rotVariance ?? 0;
    const scaleVar = params.scaleVariance ?? 0;
    const seed = params.seed ?? 42;
    for (let i = 0; i < clones.length; i++) {
      clones[i].x += (seededRandom01(seed, i * 3) - 0.5) * 2 * posVar[0];
      clones[i].y += (seededRandom01(seed, i * 3 + 1) - 0.5) * 2 * posVar[1];
      clones[i].z += (seededRandom01(seed, i * 3 + 2) - 0.5) * 2 * posVar[2];
      clones[i].rx += (seededRandom01(seed + 1, i) - 0.5) * 2 * rotVar;
      clones[i].ry += (seededRandom01(seed + 2, i) - 0.5) * 2 * rotVar;
      clones[i].rz += (seededRandom01(seed + 3, i) - 0.5) * 2 * rotVar;
      const sc = 1 + (seededRandom01(seed + 4, i) - 0.5) * 2 * scaleVar;
      clones[i].sx *= sc; clones[i].sy *= sc; clones[i].sz *= sc;
    }
  },
  bend: (clones, params, rng) => {
    const axis = params.axis || 'y';
    const k = params.strength ?? 0.5;
    for (const c of clones) {
      if (axis === 'y') c.rx += c.y * k;
      else if (axis === 'x') c.ry += c.x * k;
      else c.rz += c.z * k;
    }
  },
  twist: (clones, params, rng) => {
    const axis = params.axis || 'y';
    const k = params.strength ?? 0.5;
    for (const c of clones) {
      if (axis === 'y') c.ry += c.y * k;
      else if (axis === 'x') c.rx += c.x * k;
      else c.rz += c.z * k;
    }
  },
  falloff: (clones, params, rng) => {
    // Apply a falloff multiplier to ALL transforms based on distance
    // from a center point. Mash signature falloff.
    const center = params.center || [0, 0, 0];
    const radius = params.radius ?? 2;
    for (const c of clones) {
      const d = Math.hypot(c.x - center[0], c.y - center[1], c.z - center[2]);
      const w = Math.max(0, 1 - d / radius);
      c.rx *= w; c.ry *= w; c.rz *= w;
      c.sx = 1 + (c.sx - 1) * w;
      c.sy = 1 + (c.sy - 1) * w;
      c.sz = 1 + (c.sz - 1) * w;
    }
  },
  signal: (clones, params, rng) => {
    // Drive position by a sin wave per clone.
    const t = params.time ?? 0;
    const amplitude = params.amplitude ?? 0.5;
    const freq = params.freq ?? 1;
    for (let i = 0; i < clones.length; i++) {
      clones[i].y += Math.sin(t * freq + i * 0.2) * amplitude;
    }
  },
};

export function createNetwork(name, sourceMeshUuid, count) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const src = scene.getObjectByProperty('uuid', sourceMeshUuid);
  if (!src || !src.geometry) return { ok: false, error: 'no source mesh' };
  const N = Math.max(1, Math.min(2000, Number(count) || 50));
  const clones = [];
  for (let i = 0; i < N; i++) clones.push(_emptyClone());
  const im = makeInstancedMesh(src, []);
  if (window.__archdiscScene) window.__archdiscScene.add(im);
  const uuid = _uuid();
  _networks.set(uuid, { uuid, name: name || `mash_${_networks.size + 1}`, count: N, nodes: [], clones, im });
  return { ok: true, uuid, count: N };
}

export function addNode(networkUuid, kind, params) {
  const n = _networks.get(networkUuid);
  if (!n) return { ok: false };
  if (!NODES[kind]) return { ok: false, error: 'unknown node kind' };
  n.nodes.push({ kind, params: params || {} });
  return { ok: true, total: n.nodes.length };
}

export function clearNodes(networkUuid) {
  const n = _networks.get(networkUuid);
  if (!n) return { ok: false };
  n.nodes.length = 0;
  return { ok: true };
}

export function evaluate(networkUuid) {
  const n = _networks.get(networkUuid);
  if (!n) return { ok: false };
  // Reset clones.
  for (let i = 0; i < n.count; i++) n.clones[i] = _emptyClone();
  const rng = mulberry32(42);
  for (const nd of n.nodes) NODES[nd.kind](n.clones, nd.params || {}, rng);
  // Commit to InstancedMesh.
  const mat4 = new THREE.Matrix4();
  const euler = new THREE.Euler();
  const matrices = n.clones.map((c) => {
    euler.set(c.rx, c.ry, c.rz);
    mat4.compose(
      new THREE.Vector3(c.x, c.y, c.z),
      new THREE.Quaternion().setFromEuler(euler),
      new THREE.Vector3(c.sx, c.sy, c.sz),
    );
    return mat4.clone();
  });
  setInstanceMatrices(n.im, matrices);
  return { ok: true, evaluated: n.count };
}

export function listNetworks() {
  return Array.from(_networks.values()).map((n) => ({ uuid: n.uuid, name: n.name, count: n.count, nodes: n.nodes.map((x) => x.kind) }));
}

export function deleteNetwork(uuid) {
  const n = _networks.get(uuid);
  if (!n) return { ok: false };
  if (n.im && n.im.parent) n.im.parent.remove(n.im);
  _networks.delete(uuid);
  return { ok: true };
}
