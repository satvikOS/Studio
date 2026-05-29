/*
 * Studio NURBS surface (Maya / Rhino / Plasticity NURBS modelling).
 *
 * A real tensor-product NURBS surface — rational (per-control-point weights),
 * degree-3 in both directions, evaluated by three's Cox-de Boor NURBSSurface
 * and tessellated to a BufferGeometry. Deterministic control-point field (no
 * Math.random) per Studio's rule. Used both as a ribbon primitive and as a
 * geometry-node-graph source node (the Grasshopper-style NURBS node).
 */
import * as THREE from 'three';
import { NURBSSurface } from 'three/examples/jsm/curves/NURBSSurface.js';
import { ParametricGeometry } from 'three/examples/jsm/geometries/ParametricGeometry.js';

const S = 0.03; // PRIMITIVE_SIZE

// Clamped (open-uniform) knot vector for `n` control points of the given degree.
function clampedKnots(n, degree) {
  const k = [];
  for (let i = 0; i <= degree; i++) k.push(0);
  const interior = n - degree - 1;
  for (let i = 1; i <= interior; i++) k.push(i / (interior + 1));
  for (let i = 0; i <= degree; i++) k.push(1);
  return k; // length = n + degree + 1
}

export function buildNurbsSurfaceGeometry(opts = {}) {
  const degree = 3;
  const nu = Math.max(4, Math.min(10, Math.floor(opts.nu || 5)));
  const nv = Math.max(4, Math.min(10, Math.floor(opts.nv || 5)));
  const span = (opts.span || 6) * S;
  const amp = (opts.amplitude == null ? 1.5 : opts.amplitude) * S;
  const centerWeight = opts.centerWeight == null ? 2.2 : opts.centerWeight; // rational pull
  const ci = Math.floor(nu / 2), cj = Math.floor(nv / 2);
  const cps = [];
  for (let i = 0; i < nu; i++) {
    const row = [];
    for (let j = 0; j < nv; j++) {
      const x = (i / (nu - 1) - 0.5) * span;
      const z = (j / (nv - 1) - 0.5) * span;
      // deterministic curved control field — a saddle/bump so the patch is
      // clearly a sculpted NURBS sheet, not a flat plane.
      const y = amp * Math.sin((i / (nu - 1)) * Math.PI * 1.5) * Math.cos((j / (nv - 1)) * Math.PI * 1.2);
      const w = (i === ci && j === cj) ? centerWeight : 1; // heavier centre = rational NURBS
      row.push(new THREE.Vector4(x, y, z, w));
    }
    cps.push(row);
  }
  const surface = new NURBSSurface(degree, degree, clampedKnots(nu, degree), clampedKnots(nv, degree), cps);
  const slices = opts.slices || 32, stacks = opts.stacks || 32;
  const geo = new ParametricGeometry((u, v, target) => surface.getPoint(u, v, target), slices, stacks);
  geo.computeVertexNormals(); geo.computeBoundingBox(); geo.computeBoundingSphere();
  geo.userData.archdiscNurbs = { nu, nv, degree, rational: centerWeight !== 1 };
  return geo;
}
