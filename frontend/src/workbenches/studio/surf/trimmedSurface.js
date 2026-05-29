import * as THREE from 'three';

/*
 * Studio trimmed surface (Rhino / Maya trimmed surfaces — the FACE-level
 * building block of a trimmed B-rep). A parametric/NURBS patch is sampled on a
 * uv grid and TRIMMED by loops in parameter space: an outer boundary plus inner
 * hole loops. A grid cell survives only if its centre is inside the outer loop
 * and outside every hole, so the surface gets real boundaries/holes following
 * the trim curves. Deterministic.
 *
 * Honest scope: a trimmed SURFACE (one B-rep face). Solid trimmed-B-rep booleans
 * (sewn faces/edges/vertices) still need a B-rep kernel — OCCT was removed in the
 * viewport de-CAD; mesh-level CSG booleans already cover solid combination.
 */

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function circleLoop(cx, cy, r, n = 48) {
  const loop = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; loop.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return loop;
}

// Default surface: a gently bumped square patch, ~1 unit, Y up.
const defaultSurface = (u, v) => [(u - 0.5) * 1.2, 0.12 * Math.sin(Math.PI * 2 * u) * Math.cos(Math.PI * 2 * v), (v - 0.5) * 1.2];

export function buildTrimmedSurface(opts = {}) {
  const N = opts.res || 56;
  const S = opts.surface || defaultSurface;
  const outer = opts.outer || [[0.02, 0.02], [0.98, 0.02], [0.98, 0.98], [0.02, 0.98]];
  const holes = opts.holes || [circleLoop(0.5, 0.5, 0.22, 48)];
  const inside = (u, v) => pointInPoly([u, v], outer) && !holes.some((h) => pointInPoly([u, v], h));

  // grid vertices
  const positions = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const p = S(i / (N - 1), j / (N - 1)); const o = (j * N + i) * 3;
    positions[o] = p[0]; positions[o + 1] = p[1]; positions[o + 2] = p[2];
  }
  // emit two triangles per surviving cell (centre inside the trim region)
  const index = []; let cellsTotal = 0, cellsKept = 0, cellsInHole = 0;
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    cellsTotal++;
    const cu = (i + 0.5) / (N - 1), cv = (j + 0.5) / (N - 1);
    const inOuter = pointInPoly([cu, cv], outer);
    const inHole = holes.some((h) => pointInPoly([cu, cv], h));
    if (inHole) cellsInHole++;
    if (!(inOuter && !inHole)) continue;
    cellsKept++;
    const a = j * N + i, b = j * N + i + 1, c = (j + 1) * N + i + 1, d = (j + 1) * N + i;
    index.push(a, b, d, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals(); geo.computeBoundingBox();
  geo.userData.archdiscTrim = { cellsTotal, cellsKept, cellsInHole, holes: holes.length, triangles: index.length / 3 };
  return geo;
}

// Test helper: is any kept triangle's centroid uv inside a hole? (should be 0)
export { pointInPoly };
