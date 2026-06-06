// Slice 707 — Real B-spline NURBS surface evaluation. Takes a UV
// control grid + degrees + (optional) knot vectors, evaluates points
// at (u,v) by Cox-de Boor recursion and triangulates into a mesh.
// Mirrors Rhino's actual NURBS evaluation pipeline (not just polygonal
// sweeps).

import * as THREE from 'three';

function _uniformKnots(n, degree) {
  // n = number of control points along one axis; degree = polynomial degree.
  // Knot vector length = n + degree + 1.
  const m = n + degree + 1;
  const knots = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    if (i <= degree) knots[i] = 0;
    else if (i >= m - degree - 1) knots[i] = 1;
    else knots[i] = (i - degree) / (n - degree);
  }
  return knots;
}

function _basisFn(i, p, u, knots) {
  // Cox-de Boor.
  if (p === 0) return (u >= knots[i] && u < knots[i + 1]) ? 1 : (u === knots[knots.length - 1] && i === knots.length - 2 - p ? 1 : 0);
  const d1 = knots[i + p] - knots[i];
  const d2 = knots[i + p + 1] - knots[i + 1];
  let n1 = 0, n2 = 0;
  if (d1 !== 0) n1 = ((u - knots[i]) / d1) * _basisFn(i, p - 1, u, knots);
  if (d2 !== 0) n2 = ((knots[i + p + 1] - u) / d2) * _basisFn(i + 1, p - 1, u, knots);
  return n1 + n2;
}

// Evaluate a NURBS surface point at (u, v).
function _evaluatePoint(controlGrid, u, v, degreeU, degreeV, knotsU, knotsV, weights) {
  const nU = controlGrid.length;
  const nV = controlGrid[0].length;
  let x = 0, y = 0, z = 0, wSum = 0;
  for (let i = 0; i < nU; i++) {
    const Nu = _basisFn(i, degreeU, u, knotsU);
    if (Nu === 0) continue;
    for (let j = 0; j < nV; j++) {
      const Nv = _basisFn(j, degreeV, v, knotsV);
      if (Nv === 0) continue;
      const w = weights ? weights[i][j] : 1;
      const N = Nu * Nv * w;
      const p = controlGrid[i][j];
      x += N * p[0];
      y += N * p[1];
      z += N * p[2];
      wSum += N;
    }
  }
  if (wSum === 0) return [0, 0, 0];
  return [x / wSum, y / wSum, z / wSum];
}

export function evaluateSurface(opts) {
  const grid = opts?.controlGrid;
  if (!Array.isArray(grid) || grid.length < 2 || !Array.isArray(grid[0]) || grid[0].length < 2) {
    return { ok: false, error: 'need 2D control grid (≥2x2)' };
  }
  const degreeU = Math.max(1, Math.min(grid.length - 1, Number(opts?.degreeU) || 3));
  const degreeV = Math.max(1, Math.min(grid[0].length - 1, Number(opts?.degreeV) || 3));
  const samplesU = Math.max(4, Math.min(256, Number(opts?.samplesU) || 32));
  const samplesV = Math.max(4, Math.min(256, Number(opts?.samplesV) || 32));
  const knotsU = opts?.knotsU ?? _uniformKnots(grid.length, degreeU);
  const knotsV = opts?.knotsV ?? _uniformKnots(grid[0].length, degreeV);
  const weights = opts?.weights ?? null;
  const positions = new Float32Array(samplesU * samplesV * 3);
  for (let s = 0; s < samplesU; s++) {
    const u = s / (samplesU - 1);
    for (let t = 0; t < samplesV; t++) {
      const v = t / (samplesV - 1);
      const p = _evaluatePoint(grid, u, v, degreeU, degreeV, knotsU, knotsV, weights);
      const idx = (s * samplesV + t) * 3;
      positions[idx] = p[0]; positions[idx + 1] = p[1]; positions[idx + 2] = p[2];
    }
  }
  const indices = [];
  for (let s = 0; s < samplesU - 1; s++) {
    for (let t = 0; t < samplesV - 1; t++) {
      const a = s * samplesV + t;
      const b = s * samplesV + t + 1;
      const c = (s + 1) * samplesV + t + 1;
      const d = (s + 1) * samplesV + t;
      indices.push(a, b, c, a, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: opts?.color ? new THREE.Color(...opts.color) : 0xc0a070,
    roughness: 0.45, metalness: 0.15, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'nurbs-surface';
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'nurbs-surface';
  mesh.userData.archdiscStudioNurbsParams = {
    controlGrid: grid, degreeU, degreeV, samplesU, samplesV,
    knotsU: Array.from(knotsU), knotsV: Array.from(knotsV),
    weights,
  };
  if (window.__archdiscScene) window.__archdiscScene.add(mesh);
  if (typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
  return { ok: true, uuid: mesh.uuid, samples: samplesU * samplesV };
}

// Move one control point and re-evaluate. For interactive editing.
export function moveControlPoint(meshUuid, i, j, newPos) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.userData?.archdiscStudioNurbsParams) return { ok: false };
  const params = mesh.userData.archdiscStudioNurbsParams;
  if (!params.controlGrid[i] || !params.controlGrid[i][j]) return { ok: false };
  params.controlGrid[i][j] = [newPos[0], newPos[1], newPos[2]];
  // Re-evaluate in place.
  const positions = mesh.geometry.attributes.position.array;
  const knotsU = params.knotsU instanceof Float32Array ? params.knotsU : new Float32Array(params.knotsU);
  const knotsV = params.knotsV instanceof Float32Array ? params.knotsV : new Float32Array(params.knotsV);
  for (let s = 0; s < params.samplesU; s++) {
    const u = s / (params.samplesU - 1);
    for (let t = 0; t < params.samplesV; t++) {
      const v = t / (params.samplesV - 1);
      const p = _evaluatePoint(params.controlGrid, u, v, params.degreeU, params.degreeV, knotsU, knotsV, params.weights);
      const idx = (s * params.samplesV + t) * 3;
      positions[idx] = p[0]; positions[idx + 1] = p[1]; positions[idx + 2] = p[2];
    }
  }
  mesh.geometry.attributes.position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  return { ok: true };
}

export function setWeight(meshUuid, i, j, w) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.userData?.archdiscStudioNurbsParams) return { ok: false };
  const p = mesh.userData.archdiscStudioNurbsParams;
  if (!p.weights) {
    p.weights = p.controlGrid.map((row) => row.map(() => 1));
  }
  p.weights[i][j] = Math.max(0, Number(w));
  return moveControlPoint(meshUuid, i, j, p.controlGrid[i][j]);
}

export function getControlGrid(meshUuid) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.userData?.archdiscStudioNurbsParams) return { ok: false };
  return { ok: true, controlGrid: mesh.userData.archdiscStudioNurbsParams.controlGrid };
}
