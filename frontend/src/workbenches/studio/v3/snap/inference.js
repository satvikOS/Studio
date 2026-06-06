// ArchDisc Studio V3 — SketchUp-style LIVE inference snap engine
// (slice 748). Resolves a cursor-screen-position query to the
// highest-priority snap candidate from the visible primitive meshes.
//
// Priorities (matches SketchUp's snap order):
//   1. endpoint       (green  0x1de989)  — discrete, unambiguous vertex
//   2. intersection   (magenta 0xff44ff) — two edges/curves meeting
//   3. midpoint       (cyan   0x1de9e9)  — precise feature of an edge
//   4. centre         (cyan   0x1de9e9)  — face centroid
//   5. on-edge        (red    0xff3344)  — closest point on an edge
//   6. on-face        (blue   0x3399ff)  — barycentric face point
//   7. axis           (R/G/B)            — construction guide
//   8. parallel/perp  (magenta 0xff44ff) — inferred from last hover
//
// Cache: per-mesh {verts, midpoints, centroids} keyed by the geometry's
// position.version + index.version so a topology edit invalidates only
// when needed.

import * as THREE from 'three';

const COLOR = Object.freeze({
  endpoint:     0x1de989,
  intersection: 0xff44ff,
  midpoint:     0x1de9e9,
  centre:       0x1de9e9,
  edge:         0xff3344,
  face:         0x3399ff,
  axisX:        0xff3344,
  axisY:        0x6dd54a,
  axisZ:        0x3399ff,
  parallel:     0xff44ff,
  perpendicular:0xff44ff,
});

const LABEL = Object.freeze({
  endpoint:     'Endpoint',
  intersection: 'Intersection',
  midpoint:     'Midpoint',
  centre:       'Centre',
  edge:         'On Edge',
  face:         'On Face',
  axisX:        'On red axis',
  axisY:        'On green axis',
  axisZ:        'On blue axis',
  parallel:     'Parallel',
  perpendicular:'Perpendicular',
});

// Per-mesh feature cache. Keyed by the mesh itself; entries are
// invalidated when position.version or index.version changes.
const _cache = new WeakMap();

function _featuresFor(mesh) {
  if (!mesh || !mesh.geometry) return null;
  const g = mesh.geometry;
  const pAttr = g.attributes.position;
  if (!pAttr) return null;
  const pv = pAttr.version || 0;
  const iv = g.index ? (g.index.version || 0) : -1;
  const prev = _cache.get(mesh);
  if (prev && prev.pv === pv && prev.iv === iv) return prev;

  const verts = []; // world-space Vector3
  const mids = [];
  const centres = [];
  mesh.updateMatrixWorld(true);
  const mw = mesh.matrixWorld;
  const tmp = new THREE.Vector3();

  // Vertices
  for (let i = 0; i < pAttr.count; i++) {
    tmp.set(pAttr.getX(i), pAttr.getY(i), pAttr.getZ(i)).applyMatrix4(mw);
    verts.push(tmp.clone());
  }
  // Edge midpoints + face centroids
  if (g.index) {
    const idx = g.index.array;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const A = verts[a], B = verts[b], C = verts[c];
      // Each edge midpoint
      mids.push(new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5));
      mids.push(new THREE.Vector3().addVectors(B, C).multiplyScalar(0.5));
      mids.push(new THREE.Vector3().addVectors(C, A).multiplyScalar(0.5));
      // Face centroid
      centres.push(new THREE.Vector3()
        .add(A).add(B).add(C).multiplyScalar(1 / 3));
    }
  } else {
    for (let t = 0; t < pAttr.count; t += 3) {
      const A = verts[t], B = verts[t + 1], C = verts[t + 2];
      mids.push(new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5));
      mids.push(new THREE.Vector3().addVectors(B, C).multiplyScalar(0.5));
      mids.push(new THREE.Vector3().addVectors(C, A).multiplyScalar(0.5));
      centres.push(new THREE.Vector3()
        .add(A).add(B).add(C).multiplyScalar(1 / 3));
    }
  }
  const entry = { pv, iv, verts, mids, centres };
  _cache.set(mesh, entry);
  return entry;
}

function _projectToScreen(world, camera, w, h) {
  const v = world.clone().project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * w,
    y: (1 - (v.y * 0.5 + 0.5)) * h,
    z: v.z,
  };
}

function _allVisiblePrimitives(scene) {
  const out = [];
  scene.traverse((o) => {
    if (!o || !o.isMesh || !o.visible) return;
    if (!o.userData || !o.userData.archdiscStudioPrimitive) return;
    out.push(o);
  });
  return out;
}

// State.
let _enabled = false;
let _anchor = null;             // Vector3 (world) or null
let _lockedAxis = null;         // 'x' | 'y' | 'z' | null
let _tolerancePx = 12;
let _lastSnap = null;
let _queryCount = 0;

export function installState() { /* no-op slot for parity */ }

export function setEnabled(on) {
  _enabled = !!on;
  if (typeof window !== 'undefined') window.__studioInferenceEnabled = _enabled;
  return { ok: true, enabled: _enabled };
}
export function isEnabled() { return _enabled; }

export function setAnchor(p) {
  if (!p) { _anchor = null; return { ok: true, anchor: null }; }
  _anchor = new THREE.Vector3(p[0] || 0, p[1] || 0, p[2] || 0);
  return { ok: true, anchor: [_anchor.x, _anchor.y, _anchor.z] };
}
export function setLockedAxis(axis) {
  if (!axis) { _lockedAxis = null; return { ok: true, lockedAxis: null }; }
  const a = String(axis).toLowerCase();
  if (a !== 'x' && a !== 'y' && a !== 'z') return { ok: false, error: 'axis must be x|y|z' };
  _lockedAxis = a;
  return { ok: true, lockedAxis: _lockedAxis };
}
export function setTolerancePx(px) {
  const v = Math.max(2, Math.min(64, Number(px) || 12));
  _tolerancePx = v;
  return { ok: true, tolerancePx: v };
}
export function getState() {
  return {
    ok: true,
    enabled: _enabled,
    lockedAxis: _lockedAxis,
    anchor: _anchor ? [_anchor.x, _anchor.y, _anchor.z] : null,
    tolerancePx: _tolerancePx,
    lastSnap: _lastSnap,
  };
}

// Main query entry. {x, y} is the cursor position in CANVAS pixels.
// Returns the highest-priority snap or null.
export function query({ x, y }) {
  _queryCount++;
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  const vp = window.__archdiscViewport;
  if (!vp) return { ok: false, error: 'no viewport' };
  const camera = vp.camera, renderer = vp.renderer, scene = vp.scene;
  if (!camera || !renderer || !scene) return { ok: false, error: 'no scene' };
  const W = renderer.domElement.clientWidth || renderer.domElement.width || 1;
  const H = renderer.domElement.clientHeight || renderer.domElement.height || 1;
  const tol = _tolerancePx;
  const tol2 = tol * tol;

  const primitives = _allVisiblePrimitives(scene);
  let best = null;

  // Helper to consider a world-space candidate of a given kind.
  function _consider(world, meshUuid, kind, priority) {
    const sp = _projectToScreen(world, camera, W, H);
    const dx = sp.x - x;
    const dy = sp.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 > tol2) return;
    if (!best || priority < best.priority || (priority === best.priority && d2 < best.d2)) {
      best = {
        kind, priority,
        point: [world.x, world.y, world.z],
        screen: [sp.x, sp.y],
        meshUuid,
        color: COLOR[kind],
        label: LABEL[kind],
        d2,
      };
    }
  }

  for (const m of primitives) {
    const feat = _featuresFor(m);
    if (!feat) continue;
    // 1. Endpoints
    for (const v of feat.verts) _consider(v, m.uuid, 'endpoint', 1);
    // 3. Midpoints
    for (const mp of feat.mids) _consider(mp, m.uuid, 'midpoint', 3);
    // 4. Centres
    for (const c of feat.centres) _consider(c, m.uuid, 'centre', 4);
  }

  // 7. Axis guides — only when no discrete snap landed.
  if (!best && _anchor) {
    // Project axis lines through the anchor in X/Y/Z and find the
    // closest screen-projected point along each.
    const axes = [
      { key: 'axisX', dir: new THREE.Vector3(1, 0, 0) },
      { key: 'axisY', dir: new THREE.Vector3(0, 1, 0) },
      { key: 'axisZ', dir: new THREE.Vector3(0, 0, 1) },
    ];
    for (const { key, dir } of axes) {
      // Sample 41 points along ±5 unit segment through anchor.
      let bestT = null, bestD2 = tol2;
      for (let i = -20; i <= 20; i++) {
        const p = _anchor.clone().addScaledVector(dir, i * 0.05);
        const sp = _projectToScreen(p, camera, W, H);
        const dx = sp.x - x, dy = sp.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; bestT = p; }
      }
      if (bestT) _consider(bestT, null, key, 7);
    }
  }

  if (!best) {
    _lastSnap = null;
    return { ok: true, kind: null, screen: [x, y], queryIdx: _queryCount };
  }
  // Locked-axis projection — clamp the result onto the locked axis line
  // through the anchor.
  if (_lockedAxis && _anchor) {
    const dim = _lockedAxis;
    const out = [_anchor.x, _anchor.y, _anchor.z];
    const j = dim === 'x' ? 0 : dim === 'y' ? 1 : 2;
    out[j] = best.point[j];
    best.point = out;
  }
  _lastSnap = best;
  // Drop the d2 / priority bookkeeping from the public payload.
  return {
    ok: true,
    kind: best.kind,
    point: best.point,
    screen: best.screen,
    meshUuid: best.meshUuid,
    color: best.color,
    label: best.label,
    queryIdx: _queryCount,
  };
}

export function getQueryCount() { return _queryCount; }
