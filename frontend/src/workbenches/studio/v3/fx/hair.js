// ArchDisc Studio V3 — hair strand simulation.
//
// Blender's particle-hair system grows strands from a source mesh's
// surface, each strand a chain of segment vertices simulated as a
// position-based dynamics rope (gravity + wind + force fields). Each
// strand is rendered as a swept tube along a CatmullRomCurve3.
//
// This module ships the same conceptual surface natively (three.js
// only — no new packages, no WASM):
//
//   • createHair(sourceMeshUuid, opts) — sample N root points from the
//     source mesh's *vertex positions* (cheap + deterministic). Each
//     strand has `segCount + 1` simulation nodes including the root.
//     Strand length = baseLength · (1 ± variance · rand). Initial
//     direction = vertex normal (or +Y if normals absent).
//
//   • Per-frame simulation (under installFX()'s chained tick):
//       1. Apply gravity + global wind to every non-root segment.
//       2. Apply registered force fields (forces.js applyForces).
//       3. Verlet integrate position from prev/current.
//       4. Pin the root to the source mesh's current world-space vertex.
//       5. Distance-constraint solve (Jakobsen 2001): each segment edge
//          is clamped back to its rest length. We do a small fixed
//          number of relaxation iterations top-down → root-anchored
//          tip-pull behaviour that matches what your eye expects.
//
//   • Rendering: every strand → CatmullRomCurve3 sampled to a per-frame
//     TubeGeometry. All strand tubes are stuffed into a single
//     BufferGeometry via BufferGeometryUtils.mergeGeometries() and that
//     one geometry replaces the hair mesh's geometry each frame. Single
//     draw call for the whole head of hair.
//
//   • Public op surface (wrapped by fx/index.js):
//       hairCreate(meshUuid, opts) → { ok, uuid, strands, segs, length }
//       hairSetLength(uuid, length)
//       hairSetVariance(uuid, variance)
//       hairSetWind(vec3)
//       hairStep(dt)
//       hairList()
//       hairRemove(uuid)
//
// State lives on the hair mesh's userData.archdiscStudioHair so we can
// support multiple hair instances side-by-side.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { applyForces } from './forces.js';

const HAIR_TAG = 'archdiscStudioHair';

const _wind = new THREE.Vector3(0, 0, 0);

function _getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function _findMesh(uuid) {
  const scene = _getScene();
  if (!scene) return null;
  let m = null;
  scene.traverse((o) => {
    if (m) return;
    if (o.uuid === uuid && (o.isMesh || o.isPoints)) m = o;
  });
  return m;
}

function _findHair(uuid) {
  const scene = _getScene();
  if (!scene) return null;
  let h = null;
  scene.traverse((o) => {
    if (h) return;
    if (o.uuid === uuid && o.userData && o.userData[HAIR_TAG]) h = o;
  });
  return h;
}

function _allHair() {
  const scene = _getScene();
  if (!scene) return [];
  const out = [];
  scene.traverse((o) => { if (o.userData && o.userData[HAIR_TAG]) out.push(o); });
  return out;
}

// Build a fresh swept-tube geometry for every strand and merge into one.
// Re-built per frame because strands change shape every step. The cost
// scales with (strands · segCount · tubularSegments · radialSegments) so
// keep counts modest — 60 strands × 8 segments × 4 radial is a fluffy
// patch of hair in real time.
function _buildMergedGeometry(state) {
  const geos = [];
  const { strands, radius, radialSegments } = state;
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3()]);
  curve.curveType = 'catmullrom';
  curve.tension = 0.5;
  for (let s = 0; s < strands.length; s++) {
    const strand = strands[s];
    const positions = strand.positions;     // (segCount+1)*3 floats
    const segs = strand.segCount;
    // Reuse the Vector3 array on the curve by mutating in place.
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      pts.push(new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
    }
    curve.points = pts;
    // tubularSegments slightly higher than segs for a smoother bend.
    const tube = new THREE.TubeGeometry(curve, Math.max(2, segs * 2), radius, radialSegments, false);
    geos.push(tube);
  }
  // mergeGeometries handles disposal of inputs at our discretion. We
  // dispose the intermediates immediately because we'll never reuse them.
  const merged = (geos.length > 0) ? (mergeGeometries(geos, false) || new THREE.BufferGeometry()) : new THREE.BufferGeometry();
  for (let i = 0; i < geos.length; i++) {
    if (geos[i] && typeof geos[i].dispose === 'function') geos[i].dispose();
  }
  return merged;
}

// hairCreate — sample `strands` root points from source mesh verts,
// instantiate the strand chains, render the initial merged tube.
export function hairCreate(sourceMeshUuid, opts) {
  const scene = _getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const src = _findMesh(sourceMeshUuid);
  if (!src) return { ok: false, error: 'source mesh not in scene' };
  if (!src.geometry || !src.geometry.attributes || !src.geometry.attributes.position) {
    return { ok: false, error: 'source mesh has no position attribute' };
  }
  const o = opts || {};
  const strandCount = Math.max(1, Math.min(2000, Math.floor(Number(o.strands) || 80)));
  const segCount    = Math.max(2, Math.min(32, Math.floor(Number(o.segs) || 8)));
  const baseLength  = Math.max(0.01, Number(o.length) || 0.6);
  const variance    = Math.max(0, Math.min(1, Number(o.variance) || 0.25));
  const radius      = Math.max(0.0005, Number(o.radius) || 0.01);
  const radialSegs  = Math.max(3, Math.min(12, Math.floor(Number(o.radialSegments) || 4)));
  const gravity     = Array.isArray(o.gravity) ? o.gravity.slice() : [0, -9.81, 0];
  const stiffness   = Math.max(0, Math.min(1, Number(o.stiffness) != null ? Number(o.stiffness) : 0.9));
  const iterations  = Math.max(1, Math.min(8, Math.floor(Number(o.iterations) || 3)));

  src.updateMatrixWorld(true);
  const m4 = src.matrixWorld;
  const srcPos = src.geometry.attributes.position;
  const srcNor = src.geometry.attributes.normal || null;
  const V = srcPos.count;

  // Build a per-strand record.
  //
  //   strand.rootIdx      — index into srcPos (so we can re-pin every tick
  //                          to the source mesh's current world-space
  //                          position — important once source moves).
  //   strand.positions    — current (segCount+1)*3 floats, world space.
  //   strand.prev         — previous positions for Verlet.
  //   strand.restLen      — fixed segment length.
  //   strand.segCount.
  const strands = [];
  const tmpV = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(m4);
  for (let s = 0; s < strandCount; s++) {
    // Deterministic spread for the first V strands, then cycle with jitter.
    const rootIdx = (V > 0) ? (s % V) : 0;
    tmpV.fromBufferAttribute(srcPos, rootIdx);
    tmpV.applyMatrix4(m4);
    // Initial growth direction = transformed vertex normal or +Y.
    if (srcNor) {
      tmpN.fromBufferAttribute(srcNor, rootIdx);
      tmpN.applyMatrix3(normalMatrix);
      const ln = tmpN.length() || 1;
      tmpN.multiplyScalar(1 / ln);
    } else {
      tmpN.set(0, 1, 0);
    }
    const lenJitter = 1.0 + (Math.random() * 2 - 1) * variance;
    const totalLen = baseLength * lenJitter;
    const restLen = totalLen / segCount;
    const positions = new Float32Array((segCount + 1) * 3);
    const prev = new Float32Array((segCount + 1) * 3);
    for (let k = 0; k <= segCount; k++) {
      const px = tmpV.x + tmpN.x * restLen * k;
      const py = tmpV.y + tmpN.y * restLen * k;
      const pz = tmpV.z + tmpN.z * restLen * k;
      positions[k * 3]     = px; positions[k * 3 + 1] = py; positions[k * 3 + 2] = pz;
      prev[k * 3]          = px; prev[k * 3 + 1]      = py; prev[k * 3 + 2]      = pz;
    }
    strands.push({
      rootIdx,
      positions,
      prev,
      initial: new Float32Array(positions),
      restLen,
      totalLen,
      segCount,
      dir: [tmpN.x, tmpN.y, tmpN.z],
    });
  }

  const state = {
    source: sourceMeshUuid,
    strandCount,
    segCount,
    baseLength,
    variance,
    radius,
    radialSegments: radialSegs,
    gravity,
    stiffness,
    iterations,
    strands,
  };

  // Build the initial merged geometry and material.
  const merged = _buildMergedGeometry(state);
  const mat = o.material || new THREE.MeshStandardMaterial({
    color: o.color != null ? o.color : 0x6a3a1c,
    roughness: 0.82,
    metalness: 0.05,
    side: THREE.DoubleSide,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.name = o.name || `hair-${(src.name || 'mesh')}`;
  mesh.userData = {
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'hair',
    pickable: true,
    [HAIR_TAG]: state,
  };
  scene.add(mesh);

  if (typeof window !== 'undefined' && window.__studioToast) {
    window.__studioToast(`Hair ×${strandCount} (${segCount} segs)`, 'ok');
  }
  return {
    ok: true,
    uuid: mesh.uuid,
    strands: strandCount,
    segs: segCount,
    length: baseLength,
  };
}

export function hairSetLength(uuid, length) {
  const m = _findHair(uuid); if (!m) return { ok: false, error: 'no hair' };
  const s = m.userData[HAIR_TAG];
  const L = Math.max(0.01, Number(length));
  if (!Number.isFinite(L)) return { ok: false, error: 'bad length' };
  // Preserve each strand's per-strand variance ratio:
  //   ratio = oldTotalLen / oldBaseLength = (1 ± variance · rand)
  // Then the new totalLen = L · ratio and restLen = totalLen / segs.
  const oldBase = Math.max(1e-6, s.baseLength);
  for (let i = 0; i < s.strands.length; i++) {
    const st = s.strands[i];
    const ratio = st.totalLen / oldBase;
    st.totalLen = L * ratio;
    st.restLen = st.totalLen / st.segCount;
  }
  s.baseLength = L;
  return { ok: true, length: L };
}

export function hairSetVariance(uuid, variance) {
  const m = _findHair(uuid); if (!m) return { ok: false, error: 'no hair' };
  const s = m.userData[HAIR_TAG];
  const V = Math.max(0, Math.min(1, Number(variance)));
  if (!Number.isFinite(V)) return { ok: false, error: 'bad variance' };
  s.variance = V;
  // Re-roll per-strand totalLen with the new variance.
  for (let i = 0; i < s.strands.length; i++) {
    const st = s.strands[i];
    const lenJitter = 1.0 + (Math.random() * 2 - 1) * V;
    st.totalLen = s.baseLength * lenJitter;
    st.restLen = st.totalLen / st.segCount;
  }
  return { ok: true, variance: V };
}

export function hairSetWind(vec) {
  if (Array.isArray(vec) && vec.length === 3) {
    _wind.set(Number(vec[0]) || 0, Number(vec[1]) || 0, Number(vec[2]) || 0);
  } else if (vec && typeof vec === 'object' && 'x' in vec) {
    _wind.set(Number(vec.x) || 0, Number(vec.y) || 0, Number(vec.z) || 0);
  } else {
    _wind.set(0, 0, 0);
  }
  return { ok: true, wind: [_wind.x, _wind.y, _wind.z] };
}

export function hairList() {
  return {
    ok: true,
    hairs: _allHair().map((m) => {
      const s = m.userData[HAIR_TAG];
      return {
        uuid: m.uuid,
        source: s.source,
        strands: s.strandCount,
        segs: s.segCount,
        length: s.baseLength,
        variance: s.variance,
      };
    }),
  };
}

export function hairRemove(uuid) {
  const m = _findHair(uuid); if (!m) return { ok: false, error: 'no hair' };
  if (m.parent) m.parent.remove(m);
  if (m.geometry && typeof m.geometry.dispose === 'function') m.geometry.dispose();
  if (m.material && typeof m.material.dispose === 'function') m.material.dispose();
  return { ok: true, removed: uuid };
}

// hairStep — Verlet integration of every strand under gravity + wind +
// forces, then Jakobsen distance constraints, then re-pin root, then
// rebuild the merged tube geometry.
const _scratch = [0, 0, 0];

export function hairStep(dt) {
  const step = Math.max(1e-4, Math.min(0.05, Number(dt) || 0.016));
  const hairs = _allHair();
  if (!hairs.length) return { ok: false, error: 'no hair' };
  for (const m of hairs) _stepOne(m, step);
  return { ok: true, count: hairs.length, dt: step };
}

function _stepOne(mesh, dt) {
  const s = mesh.userData[HAIR_TAG];
  if (!s) return;

  // Re-pin root using current source-mesh world position (so the hair
  // follows if the user moves the source mesh between frames).
  const src = _findMesh(s.source);
  if (src) {
    src.updateMatrixWorld(true);
  }
  const srcPos = src && src.geometry && src.geometry.attributes && src.geometry.attributes.position;
  const m4 = src && src.matrixWorld;
  const tmpV = new THREE.Vector3();

  const gx = s.gravity[0], gy = s.gravity[1], gz = s.gravity[2];
  const wx = _wind.x, wy = _wind.y, wz = _wind.z;

  const dt2 = dt * dt;

  for (let si = 0; si < s.strands.length; si++) {
    const st = s.strands[si];
    const pos = st.positions, prev = st.prev;
    const segCount = st.segCount;
    const rest = st.restLen;

    // Pin root from live source vertex (world space).
    if (srcPos && m4) {
      tmpV.fromBufferAttribute(srcPos, st.rootIdx);
      tmpV.applyMatrix4(m4);
      pos[0] = tmpV.x; pos[1] = tmpV.y; pos[2] = tmpV.z;
      prev[0] = pos[0]; prev[1] = pos[1]; prev[2] = pos[2];
    }

    // Verlet integrate every non-root node.
    for (let k = 1; k <= segCount; k++) {
      const px = pos[k * 3], py = pos[k * 3 + 1], pz = pos[k * 3 + 2];
      const lx = prev[k * 3], ly = prev[k * 3 + 1], lz = prev[k * 3 + 2];
      // Velocity inferred from prev → current.
      const vx = px - lx, vy = py - ly, vz = pz - lz;
      // Forces.
      applyForces(px, py, pz, vx / dt, vy / dt, vz / dt, _scratch);
      const ax = gx + wx + _scratch[0];
      const ay = gy + wy + _scratch[1];
      const az = gz + wz + _scratch[2];
      // Verlet: x' = x + (x - prev) * damping + a·dt²
      const damping = 0.99;
      const nx = px + vx * damping + ax * dt2;
      const ny = py + vy * damping + ay * dt2;
      const nz = pz + vz * damping + az * dt2;
      prev[k * 3]     = px; prev[k * 3 + 1] = py; prev[k * 3 + 2] = pz;
      pos[k * 3]      = nx; pos[k * 3 + 1]  = ny; pos[k * 3 + 2]  = nz;
    }

    // Jakobsen distance constraints. With root pinned (node 0), iterate
    // a few passes pulling each subsequent node back to rest distance.
    // We use a stiffness term ∈ [0,1] — 1 == fully rigid, lower lets
    // the strand stretch slightly for a softer look.
    const k = s.stiffness;
    const iters = s.iterations;
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < segCount; i++) {
        const a = i, b = i + 1;
        const ax2 = pos[a * 3], ay2 = pos[a * 3 + 1], az2 = pos[a * 3 + 2];
        const bx2 = pos[b * 3], by2 = pos[b * 3 + 1], bz2 = pos[b * 3 + 2];
        const dx = bx2 - ax2, dy = by2 - ay2, dz = bz2 - az2;
        const L = Math.hypot(dx, dy, dz);
        if (L < 1e-8) continue;
        const diff = (L - rest) / L * k;
        // Root is pinned (i == 0) → only node b moves.
        if (a === 0) {
          pos[b * 3]     = bx2 - dx * diff;
          pos[b * 3 + 1] = by2 - dy * diff;
          pos[b * 3 + 2] = bz2 - dz * diff;
        } else {
          const half = diff * 0.5;
          pos[a * 3]     = ax2 + dx * half;
          pos[a * 3 + 1] = ay2 + dy * half;
          pos[a * 3 + 2] = az2 + dz * half;
          pos[b * 3]     = bx2 - dx * half;
          pos[b * 3 + 1] = by2 - dy * half;
          pos[b * 3 + 2] = bz2 - dz * half;
        }
      }
    }
  }

  // Re-build the merged tube geometry and swap it in. Dispose the old
  // one immediately so we don't leak GPU buffers each frame.
  const oldGeom = mesh.geometry;
  const newGeom = _buildMergedGeometry(s);
  mesh.geometry = newGeom;
  if (oldGeom && typeof oldGeom.dispose === 'function') oldGeom.dispose();
}

// hairReset — restore each strand to its initial straight-along-normal
// configuration captured at hairCreate time. Useful as a hard reset
// after the user lifts the source mesh out of the floor or similar.
export function hairReset(uuid) {
  const m = _findHair(uuid); if (!m) return { ok: false, error: 'no hair' };
  const s = m.userData[HAIR_TAG];
  for (let i = 0; i < s.strands.length; i++) {
    const st = s.strands[i];
    const N = (st.segCount + 1) * 3;
    for (let k = 0; k < N; k++) {
      st.positions[k] = st.initial[k];
      st.prev[k]      = st.initial[k];
    }
  }
  const oldGeom = m.geometry;
  m.geometry = _buildMergedGeometry(s);
  if (oldGeom && typeof oldGeom.dispose === 'function') oldGeom.dispose();
  return { ok: true };
}
