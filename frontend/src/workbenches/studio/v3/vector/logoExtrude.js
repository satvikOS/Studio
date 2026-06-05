// ArchDisc Studio V3 — JSON-path → extruded logo mesh.
//
// `extrudeFromPaths(pathsJson, depth, bevel)` takes an
// Illustrator-style JSON description of a logo and produces a single
// THREE.Group of extruded sub-meshes. Useful when an SVG file isn't
// available but the path geometry is — e.g. a logo described by a
// product designer as raw coordinates, or paths generated
// programmatically by Archie.
//
// pathsJson shape:
//   [
//     {
//       points: [[x, y], [x, y], ...],   // OUTER ring; auto-closed.
//       holes?: [[[x, y], ...], ...],    // optional inner rings.
//       color?: number | '#rrggbb',      // optional per-path colour.
//     },
//     ...
//   ]
//
// Behaviour notes
// ───────────────
// • Each path becomes one THREE.Shape with optional holes; all shapes
//   are extruded together into one ExtrudeGeometry per path (so
//   per-path colour can survive a shared material policy).
// • bevel > 0 enables a smooth bevel on both extrusion caps.
// • Logos are commonly authored in screen-space (y-down), but this
//   path JSON convention here is plain Cartesian (y-up) — no flip.
// • The resulting Group is centred on its combined bounding box,
//   added to the scene, and selected.

import * as THREE from 'three';

function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function attachAndSelect(obj) {
  const s = getScene();
  if (!s) return false;
  s.add(obj);
  if (typeof window !== 'undefined' && typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(obj); } catch (_) {}
  }
  return true;
}

function toXY(p) {
  if (!p) return null;
  if (Array.isArray(p)) {
    if (p.length < 2) return null;
    return [Number(p[0]) || 0, Number(p[1]) || 0];
  }
  if (typeof p === 'object' && typeof p.x === 'number') return [p.x, p.y || 0];
  return null;
}

function buildShape(points, holes) {
  const pts = [];
  for (const raw of points) {
    const xy = toXY(raw);
    if (xy) pts.push(xy);
  }
  if (pts.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  if (Array.isArray(holes)) {
    for (const holePts of holes) {
      if (!Array.isArray(holePts) || holePts.length < 3) continue;
      const hole = new THREE.Path();
      const h0 = toXY(holePts[0]);
      if (!h0) continue;
      hole.moveTo(h0[0], h0[1]);
      for (let i = 1; i < holePts.length; i++) {
        const hp = toXY(holePts[i]);
        if (hp) hole.lineTo(hp[0], hp[1]);
      }
      hole.closePath();
      shape.holes.push(hole);
    }
  }
  return shape;
}

function centreGroup(group) {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return [0, 0, 0];
  const c = new THREE.Vector3();
  box.getCenter(c);
  group.position.sub(c);
  group.updateMatrixWorld(true);
  return [c.x, c.y, c.z];
}

export function extrudeFromPaths(pathsJson, depth, bevel) {
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  if (!Array.isArray(pathsJson) || pathsJson.length === 0) {
    return { ok: false, error: 'pathsJson must be a non-empty array' };
  }

  const d = Math.max(0.001, Number(depth) || 0.1);
  const b = Math.max(0, Number(bevel) || 0);

  const group = new THREE.Group();
  group.name = 'studio-vector-logo';
  group.userData.archdiscStudioPrimitive = true;
  group.userData.archdiscStudioPrimitiveKind = 'vector-logo';
  group.userData.pickable = true;

  let built = 0;
  const meta = [];

  for (let i = 0; i < pathsJson.length; i++) {
    const entry = pathsJson[i];
    if (!entry || !Array.isArray(entry.points)) continue;
    const shape = buildShape(entry.points, entry.holes);
    if (!shape) continue;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: d,
      bevelEnabled: b > 0,
      bevelSize: b,
      bevelThickness: b,
      bevelSegments: b > 0 ? 2 : 0,
      curveSegments: 12,
      steps: 1,
    });
    geo.translate(0, 0, -d / 2);
    const color = entry.color != null ? entry.color : 0xdfdfe6;
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.archdiscStudioVectorPathIndex = i;
    mesh.userData.archdiscStudioVectorFill = entry.color != null ? entry.color : null;
    group.add(mesh);
    built++;
    meta.push({
      index: i,
      points: entry.points.length,
      holes: Array.isArray(entry.holes) ? entry.holes.length : 0,
      color,
    });
  }

  if (built === 0) {
    return { ok: false, error: 'no valid paths (need ≥3 points each)' };
  }

  group.userData.archdiscStudioVectorPaths = meta;
  group.userData.archdiscStudioVectorDepth = d;
  group.userData.archdiscStudioVectorBevel = b;

  attachAndSelect(group);
  const offset = centreGroup(group);

  return {
    ok: true,
    uuid: group.uuid,
    paths: built,
    depth: d,
    bevel: b,
    centreOffset: offset,
  };
}
