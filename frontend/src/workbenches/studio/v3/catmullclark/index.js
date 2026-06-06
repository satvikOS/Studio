// ArchDisc Studio V3 — real Catmull-Clark op surface (slice 749).

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
import { subdivideQuads, edgeKey } from './catmullclark.js';

let _installed = false;

function _resolveMesh(uuid) {
  const scene = window.__archdiscScene;
  if (!scene) return null;
  if (uuid) return scene.getObjectByProperty('uuid', uuid) || null;
  if (typeof window.__studioSelectedMesh === 'function') {
    try { return window.__studioSelectedMesh() || null; } catch (_) { return null; }
  }
  return null;
}

// Convert a triangle BufferGeometry to a quad cage by pairing adjacent
// triangles that share an edge AND are coplanar (~0.5°). Two paired
// triangles form one logical quad. This handles BoxGeometry's 12 tris
// → 6 quads case directly.
function _extractQuadCage(geom) {
  const g = geom.index ? geom : geom.toNonIndexed();
  const positions = g.attributes.position;
  const triCount = g.index ? g.index.array.length / 3 : positions.count / 3;
  const idx = g.index ? g.index.array : null;

  // Vertex dedup at 1e-5 — BoxGeometry duplicates verts per face.
  const tol = 1e-5;
  const buckets = new Map();
  const verts = [];
  function _addVert(x, y, z) {
    const k = `${Math.round(x / tol)}_${Math.round(y / tol)}_${Math.round(z / tol)}`;
    const cached = buckets.get(k);
    if (cached !== undefined) return cached;
    const id = verts.length / 3;
    verts.push(x, y, z);
    buckets.set(k, id);
    return id;
  }
  const tris = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t*3]     : t*3;
    const i1 = idx ? idx[t*3 + 1] : t*3 + 1;
    const i2 = idx ? idx[t*3 + 2] : t*3 + 2;
    const a = _addVert(positions.getX(i0), positions.getY(i0), positions.getZ(i0));
    const b = _addVert(positions.getX(i1), positions.getY(i1), positions.getZ(i1));
    const c = _addVert(positions.getX(i2), positions.getY(i2), positions.getZ(i2));
    tris.push([a, b, c]);
  }
  // Edge → tri map.
  const edgeMap = new Map();
  for (let t = 0; t < tris.length; t++) {
    const [a, b, c] = tris[t];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = edgeKey(u, v);
      if (!edgeMap.has(k)) edgeMap.set(k, []);
      edgeMap.get(k).push(t);
    }
  }
  // Triangle normals.
  function _triNormal(t) {
    const [a, b, c] = tris[t];
    const ax = verts[a*3], ay = verts[a*3+1], az = verts[a*3+2];
    const bx = verts[b*3], by = verts[b*3+1], bz = verts[b*3+2];
    const cx = verts[c*3], cy = verts[c*3+1], cz = verts[c*3+2];
    const ex1 = bx-ax, ey1 = by-ay, ez1 = bz-az;
    const ex2 = cx-ax, ey2 = cy-ay, ez2 = cz-az;
    const nx = ey1*ez2 - ez1*ey2;
    const ny = ez1*ex2 - ex1*ez2;
    const nz = ex1*ey2 - ey1*ex2;
    const L = Math.hypot(nx, ny, nz) || 1;
    return [nx/L, ny/L, nz/L];
  }
  // Pair coplanar adjacent triangles into quads.
  const paired = new Set();
  const quads = [];
  for (let t = 0; t < tris.length; t++) {
    if (paired.has(t)) continue;
    let partner = -1, sharedEdge = null;
    const [a, b, c] = tris[t];
    const n0 = _triNormal(t);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = edgeKey(u, v);
      const ts = edgeMap.get(k) || [];
      for (const nt of ts) {
        if (nt === t || paired.has(nt)) continue;
        const n1 = _triNormal(nt);
        const d = n0[0]*n1[0] + n0[1]*n1[1] + n0[2]*n1[2];
        if (d >= 0.99) { partner = nt; sharedEdge = [u, v]; break; }
      }
      if (partner !== -1) break;
    }
    if (partner !== -1) {
      paired.add(t); paired.add(partner);
      // Build the quad: corners of tri t in order, then the partner's
      // third vertex inserted between the shared edge's two verts.
      const [a, b, c] = tris[t];
      const [pa, pb, pc] = tris[partner];
      const partnerThird = [pa, pb, pc].find((vIdx) =>
        vIdx !== sharedEdge[0] && vIdx !== sharedEdge[1],
      );
      // Walk t's tri and replace the shared edge with [u, partnerThird, v].
      const ring = [a, b, c];
      const idxU = ring.indexOf(sharedEdge[0]);
      const idxV = ring.indexOf(sharedEdge[1]);
      // Ensure u, v are consecutive going forward.
      if ((idxU + 1) % 3 === idxV) {
        // u-v edge — insert partnerThird between.
        const quad = [ring[idxU], partnerThird, ring[idxV], ring[(idxV + 1) % 3]];
        quads.push(quad);
      } else {
        // v-u edge — invert.
        const quad = [ring[idxV], partnerThird, ring[idxU], ring[(idxU + 1) % 3]];
        quads.push(quad);
      }
    } else {
      // Unpaired triangle — emit as a degenerate quad (a, b, c, c) so
      // the subdivider still processes it (the duplicate doesn't break
      // the math; the resulting quad is just degenerate).
      quads.push([a, b, c, c]);
    }
  }
  return {
    verts: Float32Array.from(verts),
    quads: Uint32Array.from(quads.flat()),
  };
}

function _quadsToTriangulatedGeom(verts, quads) {
  const positions = Float32Array.from(verts);
  const tri = [];
  for (let q = 0; q < quads.length / 4; q++) {
    const a = quads[q*4], b = quads[q*4+1], c = quads[q*4+2], d = quads[q*4+3];
    tri.push(a, b, c, a, c, d);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(tri);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  geom.computeBoundingBox();
  return geom;
}

const _creaseMaps = new WeakMap();

export function installCatmullClark() {
  if (_installed) return { ok: true, already: true };
  _installed = true;

  const ops = {
    __studioCatmullClark: (uuid, levels) => {
      const m = _resolveMesh(uuid);
      if (!m || !m.geometry) return { ok: false, error: 'no mesh' };
      const L = Math.max(1, Math.min(4, (levels | 0) || 1));
      let cage = m.userData && m.userData.archdiscStudioCCQuads;
      if (!cage) {
        cage = _extractQuadCage(m.geometry);
      }
      const creases = _creaseMaps.get(m) || new Map();
      const r = subdivideQuads(cage.verts, cage.quads, L, creases);
      const newGeom = _quadsToTriangulatedGeom(r.verts, r.quads);
      const oldGeom = m.geometry;
      m.geometry = newGeom;
      try { oldGeom.dispose && oldGeom.dispose(); } catch (_) {}
      m.userData = m.userData || {};
      m.userData.archdiscStudioCCQuads = { verts: r.verts, quads: r.quads };
      m.userData.archdiscStudioCatmullClark =
        (m.userData.archdiscStudioCatmullClark || 0) + L;
      _creaseMaps.set(m, r.creases);
      return {
        ok: true,
        verts: r.verts.length / 3,
        quads: r.quads.length / 4,
        tris: r.quads.length / 4 * 2,
        level: m.userData.archdiscStudioCatmullClark,
      };
    },
    __studioCatmullClarkMarkCrease: (uuid, vA, vB, sharpness) => {
      const m = _resolveMesh(uuid);
      if (!m) return { ok: false, error: 'no mesh' };
      let cm = _creaseMaps.get(m);
      if (!cm) { cm = new Map(); _creaseMaps.set(m, cm); }
      cm.set(edgeKey(vA | 0, vB | 0), Math.max(0, Number(sharpness) || 0));
      return { ok: true, edgeKey: edgeKey(vA | 0, vB | 0), sharpness };
    },
    __studioCatmullClarkClearCreases: (uuid) => {
      const m = _resolveMesh(uuid);
      if (!m) return { ok: false, error: 'no mesh' };
      _creaseMaps.set(m, new Map());
      return { ok: true };
    },
    __studioCatmullClarkGetStats: (uuid) => {
      const m = _resolveMesh(uuid);
      if (!m) return { ok: false, error: 'no mesh' };
      const cage = m.userData && m.userData.archdiscStudioCCQuads;
      return {
        ok: true,
        hasCage: !!cage,
        verts: cage ? cage.verts.length / 3 : 0,
        quads: cage ? cage.quads.length / 4 : 0,
        level: (m.userData && m.userData.archdiscStudioCatmullClark) || 0,
      };
    },
  };
  for (const [name, fn] of Object.entries(ops)) window[name] = fn;
  registerOps(ops, 'edit', 'Catmull-Clark quad subdivision with Hoppe-94 creases');
  return { ok: true };
}

export default installCatmullClark;
