// Slice 718 — 3ds Max Hair & Fur. Differs from slice-706 fur (shell
// extrusion) by using actual guide curves: each guide is a polyline
// whose vertices are anim-driven; the renderable strands are
// THREE.Line segments per guide. Supports comb tool (per-segment
// drag), wind force, and per-mesh density.

import * as THREE from 'three';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';

const _hairs = new Map();
let _seq = 1;
function _uid() { return `mh-${_seq++}-${Date.now().toString(36)}`; }

export function applyHair(meshUuid, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry) return { ok: false };
  const guides = Math.max(8, Math.min(2000, Number(opts?.guides) || 200));
  const segments = Math.max(4, Math.min(20, Number(opts?.segments) || 8));
  const length = Number(opts?.length) || 0.4;
  const color = opts?.color || [0.4, 0.25, 0.15];
  const pos = mesh.geometry.attributes.position.array;
  const nrm = mesh.geometry.attributes.normal?.array;
  // Pick `guides` random vertices.
  const guideArr = [];
  for (let i = 0; i < guides; i++) {
    const vi = Math.floor(Math.random() * (pos.length / 3));
    const root = [pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]];
    const normal = nrm ? [nrm[vi * 3], nrm[vi * 3 + 1], nrm[vi * 3 + 2]] : [0, 1, 0];
    const path = [];
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      path.push([
        root[0] + normal[0] * length * t,
        root[1] + normal[1] * length * t,
        root[2] + normal[2] * length * t,
      ]);
    }
    guideArr.push({ root, normal, path, base: path.map((p) => [...p]) });
  }
  // Render as a single LineSegments object.
  const positions = new Float32Array(guides * segments * 2 * 3);
  const colors = new Float32Array(guides * segments * 2 * 3);
  for (let g = 0; g < guides; g++) {
    for (let s = 0; s < segments; s++) {
      const a = guideArr[g].path[s];
      const b = guideArr[g].path[s + 1];
      const i = (g * segments + s) * 6;
      positions[i]     = a[0]; positions[i + 1] = a[1]; positions[i + 2] = a[2];
      positions[i + 3] = b[0]; positions[i + 4] = b[1]; positions[i + 5] = b[2];
      const t = s / segments;
      const r = color[0] * (1 - t * 0.3);
      const g2 = color[1] * (1 - t * 0.3);
      const b2 = color[2] * (1 - t * 0.3);
      colors[i] = r; colors[i + 1] = g2; colors[i + 2] = b2;
      colors[i + 3] = r; colors[i + 4] = g2; colors[i + 5] = b2;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true });
  const lines = new THREE.LineSegments(geo, mat);
  lines.name = 'max-hair';
  mesh.add(lines);
  const id = _uid();
  _hairs.set(id, { id, meshUuid, lines, guides: guideArr, segments, length, wind: [0, 0, 0] });
  return { ok: true, id };
}

export function setWind(id, wind) {
  const h = _hairs.get(id);
  if (!h) return { ok: false };
  h.wind = wind.slice();
  if (!h.tickAttached) {
    h.tickAttached = true;
    chainIntoAnimTick(`maxhair_${id}`, () => _tick(h));
  }
  return { ok: true };
}

function _tick(h) {
  const wx = h.wind[0], wy = h.wind[1], wz = h.wind[2];
  const positions = h.lines.geometry.attributes.position.array;
  const segs = h.segments;
  const t = performance.now() * 0.001;
  for (let g = 0; g < h.guides.length; g++) {
    const guide = h.guides[g];
    for (let s = 1; s <= segs; s++) {
      const swayT = s / segs;
      const sx = wx * swayT + Math.sin(t * 2 + g * 0.4) * 0.01 * swayT;
      const sy = wy * swayT * 0.4;
      const sz = wz * swayT + Math.cos(t * 2 + g * 0.4) * 0.01 * swayT;
      guide.path[s][0] = guide.base[s][0] + sx;
      guide.path[s][1] = guide.base[s][1] + sy;
      guide.path[s][2] = guide.base[s][2] + sz;
    }
    for (let s = 0; s < segs; s++) {
      const a = guide.path[s];
      const b = guide.path[s + 1];
      const i = (g * segs + s) * 6;
      positions[i] = a[0]; positions[i + 1] = a[1]; positions[i + 2] = a[2];
      positions[i + 3] = b[0]; positions[i + 4] = b[1]; positions[i + 5] = b[2];
    }
  }
  h.lines.geometry.attributes.position.needsUpdate = true;
}

export function comb(id, brushCenter, direction, radius) {
  const h = _hairs.get(id);
  if (!h) return { ok: false };
  const [cx, cy, cz] = brushCenter;
  const r = Number(radius) || 0.5;
  for (const guide of h.guides) {
    const d = Math.hypot(guide.root[0] - cx, guide.root[1] - cy, guide.root[2] - cz);
    if (d > r) continue;
    const w = 1 - d / r;
    for (let s = 1; s <= h.segments; s++) {
      const t = s / h.segments;
      guide.base[s][0] = guide.base[s][0] + direction[0] * w * t;
      guide.base[s][1] = guide.base[s][1] + direction[1] * w * t;
      guide.base[s][2] = guide.base[s][2] + direction[2] * w * t;
    }
  }
  // Apply immediately.
  _tick(h);
  return { ok: true };
}

export function removeHair(id) {
  const h = _hairs.get(id);
  if (!h) return { ok: false };
  unchainFromAnimTick(`maxhair_${id}`);
  if (h.lines.parent) h.lines.parent.remove(h.lines);
  h.lines.geometry.dispose();
  h.lines.material.dispose();
  _hairs.delete(id);
  return { ok: true };
}

export function listHair() {
  return {
    ok: true,
    hair: Array.from(_hairs.values()).map((h) => ({
      id: h.id, meshUuid: h.meshUuid, guides: h.guides.length, segments: h.segments, length: h.length,
    })),
  };
}
