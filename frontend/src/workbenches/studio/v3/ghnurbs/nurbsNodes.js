// Slice 759 — Rhino Grasshopper-specific NURBS node palette.
//
// Seven Rhino-flavour NURBS nodes for the Grasshopper-style visual graph
// runner that landed in slice 700. Where v3/ghgraph/graph.js shipped a
// generic dataflow registry (numbers / vectors / arithmetic / studioOp),
// this module adds a *dedicated NURBS palette* — the exact set of
// surfacing primitives a Rhino user reaches for inside Grasshopper:
//
//   nurbsCurve    — degree-3 control-point curve (P0..P3)
//   nurbsSurface  — bidirectional control-net (4×4) Cox-de-Boor surface
//   nurbsExtrude  — sweep a curve along a direction vector
//   nurbsLoft     — skin between two curves (Coons-style ruled surface)
//   nurbsRevolve  — sweep a curve around an axis through a swept angle
//   nurbsTrim     — clip a surface to a closed planar boundary curve
//   nurbsOffset   — fatten a curve into a tube of given radius
//
// Each node is `{ kind, params, evaluate(inputs) }` and returns a real
// THREE.Mesh built off the existing NURBS evaluator (v3/nurbs/bspline.js
// Cox-de-Boor) — not a polygonal placeholder. The mesh is tagged with
// `userData.archdiscStudioPrimitive = true` so the rest of Studio
// (selection / outliner / save-scene / xform) sees it as a normal
// editable primitive.
//
// Deterministic only (no Math.random).

import * as THREE from 'three';

// ─── Cox-de-Boor B-spline basis ──────────────────────────────────────
// Reuses the same recursion the v3/nurbs/bspline.js module ships; kept
// inline here so this palette has no internal dependency cycle on the
// surface-only module (it only imports its top-level installer).

function _uniformKnots(n, degree) {
  const m = n + degree + 1;
  const knots = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    if (i <= degree) knots[i] = 0;
    else if (i >= m - degree - 1) knots[i] = 1;
    else knots[i] = (i - degree) / (n - degree);
  }
  return knots;
}

function _basis(i, p, u, knots) {
  if (p === 0) {
    if (u >= knots[i] && u < knots[i + 1]) return 1;
    if (u === knots[knots.length - 1] && i === knots.length - 2 - p) return 1;
    return 0;
  }
  const d1 = knots[i + p] - knots[i];
  const d2 = knots[i + p + 1] - knots[i + 1];
  let n1 = 0;
  let n2 = 0;
  if (d1 !== 0) n1 = ((u - knots[i]) / d1) * _basis(i, p - 1, u, knots);
  if (d2 !== 0) n2 = ((knots[i + p + 1] - u) / d2) * _basis(i + 1, p - 1, u, knots);
  return n1 + n2;
}

function _evalCurve(controlPoints, u, degree, knots) {
  const n = controlPoints.length;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < n; i++) {
    const N = _basis(i, degree, u, knots);
    if (N === 0) continue;
    const cp = controlPoints[i];
    x += N * cp[0];
    y += N * cp[1];
    z += N * cp[2];
  }
  return [x, y, z];
}

function _evalSurface(grid, u, v, dU, dV, kU, kV) {
  const nU = grid.length;
  const nV = grid[0].length;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < nU; i++) {
    const Nu = _basis(i, dU, u, kU);
    if (Nu === 0) continue;
    for (let j = 0; j < nV; j++) {
      const Nv = _basis(j, dV, v, kV);
      if (Nv === 0) continue;
      const N = Nu * Nv;
      const p = grid[i][j];
      x += N * p[0];
      y += N * p[1];
      z += N * p[2];
    }
  }
  return [x, y, z];
}

// ─── Mesh builders ───────────────────────────────────────────────────

function _curveTube(controlPoints, degree, samples, radius, radial) {
  const n = controlPoints.length;
  const d = Math.max(1, Math.min(n - 1, degree | 0));
  const knots = _uniformKnots(n, d);
  const path = [];
  for (let s = 0; s < samples; s++) {
    const u = s / (samples - 1);
    path.push(new THREE.Vector3(..._evalCurve(controlPoints, u, d, knots)));
  }
  // Frenet-like frame: pick an initial up axis and parallel-transport.
  const positions = new Float32Array(samples * radial * 3);
  const indices = [];
  let prevUp = new THREE.Vector3(0, 1, 0);
  for (let s = 0; s < samples; s++) {
    let tan;
    if (s === 0) tan = new THREE.Vector3().subVectors(path[1], path[0]).normalize();
    else if (s === samples - 1) tan = new THREE.Vector3().subVectors(path[s], path[s - 1]).normalize();
    else tan = new THREE.Vector3().subVectors(path[s + 1], path[s - 1]).normalize();
    if (tan.lengthSq() < 1e-10) tan.set(1, 0, 0);
    // Stable up: project prevUp onto plane orthogonal to tan, renormalise.
    let up = prevUp.clone().sub(tan.clone().multiplyScalar(prevUp.dot(tan)));
    if (up.lengthSq() < 1e-8) {
      const ref = Math.abs(tan.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      up = ref.sub(tan.clone().multiplyScalar(ref.dot(tan)));
    }
    up.normalize();
    const right = new THREE.Vector3().crossVectors(tan, up).normalize();
    prevUp = up;
    for (let r = 0; r < radial; r++) {
      const a = (r / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const px = path[s].x + (right.x * ca + up.x * sa) * radius;
      const py = path[s].y + (right.y * ca + up.y * sa) * radius;
      const pz = path[s].z + (right.z * ca + up.z * sa) * radius;
      const idx = (s * radial + r) * 3;
      positions[idx] = px;
      positions[idx + 1] = py;
      positions[idx + 2] = pz;
    }
  }
  for (let s = 0; s < samples - 1; s++) {
    for (let r = 0; r < radial; r++) {
      const r1 = (r + 1) % radial;
      const a = s * radial + r;
      const b = s * radial + r1;
      const c = (s + 1) * radial + r1;
      const d2 = (s + 1) * radial + r;
      indices.push(a, b, c, a, c, d2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function _surfaceMesh(grid, dU, dV, samplesU, samplesV) {
  const dUc = Math.max(1, Math.min(grid.length - 1, dU | 0));
  const dVc = Math.max(1, Math.min(grid[0].length - 1, dV | 0));
  const kU = _uniformKnots(grid.length, dUc);
  const kV = _uniformKnots(grid[0].length, dVc);
  const positions = new Float32Array(samplesU * samplesV * 3);
  const indices = [];
  for (let s = 0; s < samplesU; s++) {
    const u = s / (samplesU - 1);
    for (let t = 0; t < samplesV; t++) {
      const v = t / (samplesV - 1);
      const p = _evalSurface(grid, u, v, dUc, dVc, kU, kV);
      const idx = (s * samplesV + t) * 3;
      positions[idx] = p[0];
      positions[idx + 1] = p[1];
      positions[idx + 2] = p[2];
    }
  }
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
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function _stdMat(hex) {
  return new THREE.MeshStandardMaterial({
    color: hex,
    roughness: 0.45,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
}

function _tag(mesh, kind, params) {
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = kind;
  mesh.userData.archdiscStudioGHNurbsParams = params;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ─── Node factories ──────────────────────────────────────────────────
// Each factory returns a Grasshopper-shaped node:
//   { kind, params, evaluate(inputs) → THREE.Mesh }

export function makeNurbsCurveNode(params = {}) {
  return {
    kind: 'nurbsCurve',
    params: {
      controlPoints: params.controlPoints || [[0, 0, 0], [1, 1, 0], [2, -1, 0], [3, 0, 0]],
      degree: params.degree == null ? 3 : params.degree,
      samples: params.samples == null ? 64 : params.samples,
      radius: params.radius == null ? 0.03 : params.radius,
      radial: params.radial == null ? 8 : params.radial,
      color: params.color == null ? 0xe0b070 : params.color,
    },
    evaluate(_inputs) {
      const p = this.params;
      const cps = p.controlPoints;
      if (!Array.isArray(cps) || cps.length < 2) return null;
      const geo = _curveTube(cps, p.degree, p.samples, p.radius, p.radial);
      const mesh = new THREE.Mesh(geo, _stdMat(p.color));
      mesh.name = 'ghnurbs-curve';
      return _tag(mesh, 'ghnurbs-curve', { ...p });
    },
  };
}

export function makeNurbsSurfaceNode(params = {}) {
  // Default: a saggy 4×4 patch (centre dipped).
  const defaultGrid = [];
  for (let i = 0; i < 4; i++) {
    const row = [];
    for (let j = 0; j < 4; j++) {
      const x = (i - 1.5);
      const z = (j - 1.5);
      const y = (i > 0 && i < 3 && j > 0 && j < 3) ? -0.8 : 0;
      row.push([x, y, z]);
    }
    defaultGrid.push(row);
  }
  return {
    kind: 'nurbsSurface',
    params: {
      controlNet: params.controlNet || defaultGrid,
      degreeU: params.degreeU == null ? 3 : params.degreeU,
      degreeV: params.degreeV == null ? 3 : params.degreeV,
      samplesU: params.samplesU == null ? 24 : params.samplesU,
      samplesV: params.samplesV == null ? 24 : params.samplesV,
      color: params.color == null ? 0xc0a070 : params.color,
    },
    evaluate(_inputs) {
      const p = this.params;
      const grid = p.controlNet;
      if (!Array.isArray(grid) || grid.length < 2 || !Array.isArray(grid[0]) || grid[0].length < 2) return null;
      const geo = _surfaceMesh(grid, p.degreeU, p.degreeV, p.samplesU, p.samplesV);
      const mesh = new THREE.Mesh(geo, _stdMat(p.color));
      mesh.name = 'ghnurbs-surface';
      return _tag(mesh, 'ghnurbs-surface', { ...p });
    },
  };
}

export function makeNurbsExtrudeNode(params = {}) {
  return {
    kind: 'nurbsExtrude',
    params: {
      controlPoints: params.controlPoints || [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
      degree: params.degree == null ? 3 : params.degree,
      dir: params.dir || [0, 1, 0],
      distance: params.distance == null ? 1 : params.distance,
      samples: params.samples == null ? 32 : params.samples,
      color: params.color == null ? 0xb0a080 : params.color,
    },
    evaluate(inputs) {
      const p = this.params;
      // Curve may come in via input; else use param.
      const cps = (inputs && Array.isArray(inputs.curve)) ? inputs.curve : p.controlPoints;
      if (!Array.isArray(cps) || cps.length < 2) return null;
      const d = Math.max(1, Math.min(cps.length - 1, p.degree | 0));
      const knots = _uniformKnots(cps.length, d);
      const dx = (p.dir[0] || 0) * p.distance;
      const dy = (p.dir[1] || 0) * p.distance;
      const dz = (p.dir[2] || 0) * p.distance;
      // Build a ruled extrusion: sample curve at N u's, lay down two
      // rings (start + offset by dir*distance), bridge.
      const samples = Math.max(4, p.samples | 0);
      const positions = new Float32Array(samples * 2 * 3);
      const indices = [];
      for (let s = 0; s < samples; s++) {
        const u = s / (samples - 1);
        const c = _evalCurve(cps, u, d, knots);
        // base ring (v=0)
        const i0 = s * 2 * 3;
        positions[i0] = c[0];
        positions[i0 + 1] = c[1];
        positions[i0 + 2] = c[2];
        // offset ring (v=1)
        positions[i0 + 3] = c[0] + dx;
        positions[i0 + 4] = c[1] + dy;
        positions[i0 + 5] = c[2] + dz;
      }
      for (let s = 0; s < samples - 1; s++) {
        const a = s * 2;
        const b = s * 2 + 1;
        const c = (s + 1) * 2 + 1;
        const d2 = (s + 1) * 2;
        indices.push(a, b, c, a, c, d2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, _stdMat(p.color));
      mesh.name = 'ghnurbs-extrude';
      return _tag(mesh, 'ghnurbs-extrude', { ...p });
    },
  };
}

export function makeNurbsLoftNode(params = {}) {
  return {
    kind: 'nurbsLoft',
    params: {
      curveA: params.curveA || [[0, 0, 0], [1, 0.4, 0], [2, -0.2, 0], [3, 0, 0]],
      curveB: params.curveB || [[0, 1.5, 1], [1, 1.8, 1], [2, 1.2, 1], [3, 1.5, 1]],
      degree: params.degree == null ? 3 : params.degree,
      samples: params.samples == null ? 24 : params.samples,
      color: params.color == null ? 0x9090c0 : params.color,
    },
    evaluate(inputs) {
      const p = this.params;
      const a = (inputs && Array.isArray(inputs.curveA)) ? inputs.curveA : p.curveA;
      const b = (inputs && Array.isArray(inputs.curveB)) ? inputs.curveB : p.curveB;
      if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return null;
      const dA = Math.max(1, Math.min(a.length - 1, p.degree | 0));
      const dB = Math.max(1, Math.min(b.length - 1, p.degree | 0));
      const kA = _uniformKnots(a.length, dA);
      const kB = _uniformKnots(b.length, dB);
      const samples = Math.max(4, p.samples | 0);
      const positions = new Float32Array(samples * 2 * 3);
      const indices = [];
      for (let s = 0; s < samples; s++) {
        const u = s / (samples - 1);
        const pa = _evalCurve(a, u, dA, kA);
        const pb = _evalCurve(b, u, dB, kB);
        const i0 = s * 2 * 3;
        positions[i0] = pa[0];
        positions[i0 + 1] = pa[1];
        positions[i0 + 2] = pa[2];
        positions[i0 + 3] = pb[0];
        positions[i0 + 4] = pb[1];
        positions[i0 + 5] = pb[2];
      }
      for (let s = 0; s < samples - 1; s++) {
        const a0 = s * 2;
        const a1 = s * 2 + 1;
        const a2 = (s + 1) * 2 + 1;
        const a3 = (s + 1) * 2;
        indices.push(a0, a1, a2, a0, a2, a3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, _stdMat(p.color));
      mesh.name = 'ghnurbs-loft';
      return _tag(mesh, 'ghnurbs-loft', { ...p });
    },
  };
}

export function makeNurbsRevolveNode(params = {}) {
  return {
    kind: 'nurbsRevolve',
    params: {
      controlPoints: params.controlPoints || [[0.5, 0, 0], [0.8, 0.5, 0], [0.4, 1.0, 0], [0.7, 1.5, 0]],
      degree: params.degree == null ? 3 : params.degree,
      axis: params.axis || [0, 1, 0],
      angle: params.angle == null ? Math.PI * 2 : params.angle,
      samplesU: params.samplesU == null ? 32 : params.samplesU,
      samplesV: params.samplesV == null ? 24 : params.samplesV,
      color: params.color == null ? 0xa8c0a0 : params.color,
    },
    evaluate(inputs) {
      const p = this.params;
      const cps = (inputs && Array.isArray(inputs.curve)) ? inputs.curve : p.controlPoints;
      if (!Array.isArray(cps) || cps.length < 2) return null;
      const d = Math.max(1, Math.min(cps.length - 1, p.degree | 0));
      const knots = _uniformKnots(cps.length, d);
      const ax = new THREE.Vector3(p.axis[0] || 0, p.axis[1] || 1, p.axis[2] || 0).normalize();
      const samplesU = Math.max(4, p.samplesU | 0);
      const samplesV = Math.max(4, p.samplesV | 0);
      const positions = new Float32Array(samplesU * samplesV * 3);
      const indices = [];
      const tmp = new THREE.Vector3();
      for (let s = 0; s < samplesU; s++) {
        const u = s / (samplesU - 1);
        const c = _evalCurve(cps, u, d, knots);
        for (let t = 0; t < samplesV; t++) {
          const theta = (t / (samplesV - 1)) * p.angle;
          tmp.set(c[0], c[1], c[2]);
          // Rotate tmp around ax by theta (Rodrigues).
          const cosT = Math.cos(theta);
          const sinT = Math.sin(theta);
          const dot = tmp.dot(ax);
          const cross = new THREE.Vector3().crossVectors(ax, tmp);
          const rx = tmp.x * cosT + cross.x * sinT + ax.x * dot * (1 - cosT);
          const ry = tmp.y * cosT + cross.y * sinT + ax.y * dot * (1 - cosT);
          const rz = tmp.z * cosT + cross.z * sinT + ax.z * dot * (1 - cosT);
          const idx = (s * samplesV + t) * 3;
          positions[idx] = rx;
          positions[idx + 1] = ry;
          positions[idx + 2] = rz;
        }
      }
      for (let s = 0; s < samplesU - 1; s++) {
        for (let t = 0; t < samplesV - 1; t++) {
          const a = s * samplesV + t;
          const b = s * samplesV + t + 1;
          const c = (s + 1) * samplesV + t + 1;
          const d2 = (s + 1) * samplesV + t;
          indices.push(a, b, c, a, c, d2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, _stdMat(p.color));
      mesh.name = 'ghnurbs-revolve';
      return _tag(mesh, 'ghnurbs-revolve', { ...p });
    },
  };
}

export function makeNurbsTrimNode(params = {}) {
  // Trim a 4×4 surface to inside/outside of a closed polyline boundary
  // projected onto the surface UV plane. Implemented as point-in-polygon
  // in UV space on each sampled grid quad — quads whose centroid falls
  // outside the boundary are dropped from the index buffer.
  return {
    kind: 'nurbsTrim',
    params: {
      controlNet: params.controlNet || (() => {
        const g = [];
        for (let i = 0; i < 4; i++) {
          const row = [];
          for (let j = 0; j < 4; j++) row.push([i - 1.5, 0, j - 1.5]);
          g.push(row);
        }
        return g;
      })(),
      degreeU: params.degreeU == null ? 3 : params.degreeU,
      degreeV: params.degreeV == null ? 3 : params.degreeV,
      samplesU: params.samplesU == null ? 32 : params.samplesU,
      samplesV: params.samplesV == null ? 32 : params.samplesV,
      // 2D closed boundary in UV (each entry [u, v] ∈ [0,1]²).
      boundary: params.boundary || [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]],
      keepInside: params.keepInside == null ? true : !!params.keepInside,
      color: params.color == null ? 0xb0908a : params.color,
    },
    evaluate(inputs) {
      const p = this.params;
      const grid = (inputs && Array.isArray(inputs.surface)) ? inputs.surface : p.controlNet;
      const boundary = (inputs && Array.isArray(inputs.boundary)) ? inputs.boundary : p.boundary;
      if (!Array.isArray(grid) || grid.length < 2) return null;
      if (!Array.isArray(boundary) || boundary.length < 3) return null;
      const dU = Math.max(1, Math.min(grid.length - 1, p.degreeU | 0));
      const dV = Math.max(1, Math.min(grid[0].length - 1, p.degreeV | 0));
      const kU = _uniformKnots(grid.length, dU);
      const kV = _uniformKnots(grid[0].length, dV);
      const sU = Math.max(4, p.samplesU | 0);
      const sV = Math.max(4, p.samplesV | 0);
      // Sample all positions.
      const positions = new Float32Array(sU * sV * 3);
      for (let s = 0; s < sU; s++) {
        const u = s / (sU - 1);
        for (let t = 0; t < sV; t++) {
          const v = t / (sV - 1);
          const pt = _evalSurface(grid, u, v, dU, dV, kU, kV);
          const idx = (s * sV + t) * 3;
          positions[idx] = pt[0];
          positions[idx + 1] = pt[1];
          positions[idx + 2] = pt[2];
        }
      }
      // Quad cull by point-in-polygon at quad-centre.
      const indices = [];
      const inside = (u, v) => {
        let inside = false;
        for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
          const ui = boundary[i][0];
          const vi = boundary[i][1];
          const uj = boundary[j][0];
          const vj = boundary[j][1];
          const intersect = ((vi > v) !== (vj > v)) &&
            (u < (uj - ui) * (v - vi) / ((vj - vi) || 1e-12) + ui);
          if (intersect) inside = !inside;
        }
        return inside;
      };
      for (let s = 0; s < sU - 1; s++) {
        for (let t = 0; t < sV - 1; t++) {
          const u = (s + 0.5) / (sU - 1);
          const v = (t + 0.5) / (sV - 1);
          const isIn = inside(u, v);
          if (p.keepInside ? !isIn : isIn) continue;
          const a = s * sV + t;
          const b = s * sV + t + 1;
          const c = (s + 1) * sV + t + 1;
          const d2 = (s + 1) * sV + t;
          indices.push(a, b, c, a, c, d2);
        }
      }
      if (!indices.length) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, _stdMat(p.color));
      mesh.name = 'ghnurbs-trim';
      return _tag(mesh, 'ghnurbs-trim', { ...p });
    },
  };
}

export function makeNurbsOffsetNode(params = {}) {
  // Curve-offset = parallel curve at signed distance in the curve's local
  // frame, swept around the original. Surfaces it as a tube of radius=
  // distance so the offset is *visible* as geometry, matching how
  // Grasshopper renders an Offset Curve component.
  return {
    kind: 'nurbsOffset',
    params: {
      controlPoints: params.controlPoints || [[0, 0, 0], [1, 0.5, 0], [2, -0.5, 0], [3, 0, 0]],
      degree: params.degree == null ? 3 : params.degree,
      distance: params.distance == null ? 0.25 : params.distance,
      samples: params.samples == null ? 64 : params.samples,
      radial: params.radial == null ? 12 : params.radial,
      color: params.color == null ? 0x80c0c0 : params.color,
    },
    evaluate(inputs) {
      const p = this.params;
      const cps = (inputs && Array.isArray(inputs.curve)) ? inputs.curve : p.controlPoints;
      if (!Array.isArray(cps) || cps.length < 2) return null;
      const geo = _curveTube(cps, p.degree, p.samples, Math.abs(p.distance), p.radial);
      const mesh = new THREE.Mesh(geo, _stdMat(p.color));
      mesh.name = 'ghnurbs-offset';
      return _tag(mesh, 'ghnurbs-offset', { ...p });
    },
  };
}

// ─── Registry ────────────────────────────────────────────────────────

export const NURBS_NODE_FACTORIES = {
  nurbsCurve: makeNurbsCurveNode,
  nurbsSurface: makeNurbsSurfaceNode,
  nurbsExtrude: makeNurbsExtrudeNode,
  nurbsLoft: makeNurbsLoftNode,
  nurbsRevolve: makeNurbsRevolveNode,
  nurbsTrim: makeNurbsTrimNode,
  nurbsOffset: makeNurbsOffsetNode,
};

export const NURBS_NODE_KINDS = Object.keys(NURBS_NODE_FACTORIES);

export function makeNode(kind, params) {
  const f = NURBS_NODE_FACTORIES[kind];
  if (!f) return null;
  return f(params || {});
}
