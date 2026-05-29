/*
 * Studio NURBS curve (Maya / Rhino / Plasticity). A real rational B-spline
 * curve: control points carry per-point weights (Vector4 x,y,z,w), clamped
 * knot vector, degree-3, evaluated by three's Cox-de Boor NURBSCurve and swept
 * into a tube. Rational weights genuinely warp the curve toward heavier control
 * points (distinguishing a NURBS curve from a plain B-spline). Deterministic.
 */
import * as THREE from 'three';
import { NURBSCurve } from 'three/examples/jsm/curves/NURBSCurve.js';

function clampedKnots(n, degree) {
  const knots = [];
  for (let i = 0; i <= degree; i++) knots.push(0);
  const interior = n - degree - 1;
  for (let i = 1; i <= interior; i++) knots.push(i / (interior + 1));
  for (let i = 0; i <= degree; i++) knots.push(1);
  return knots;
}

export function buildNurbsCurveGeometry(opts = {}) {
  const degree = opts.degree || 3;
  const midWeight = opts.midWeight != null ? opts.midWeight : 1;
  const ctrl = opts.controlPoints
    ? opts.controlPoints.map((c) => new THREE.Vector4(c[0], c[1], c[2], c[3] != null ? c[3] : 1))
    : [
      new THREE.Vector4(-0.45, 0.0, 0.0, 1),
      new THREE.Vector4(-0.22, 0.32, 0.12, 1),
      new THREE.Vector4(0.0, 0.0, -0.28, midWeight), // heavier weight pulls the curve here
      new THREE.Vector4(0.22, 0.32, 0.12, 1),
      new THREE.Vector4(0.45, 0.0, 0.0, 1),
    ];
  const knots = opts.knots || clampedKnots(ctrl.length, degree);
  const curve = new NURBSCurve(degree, knots, ctrl);
  const samples = opts.samples || 140;
  const tube = new THREE.TubeGeometry(curve, samples, opts.radius || 0.012, 10, false);
  const start = curve.getPoint(0), end = curve.getPoint(1), mid = curve.getPoint(0.5);
  const midCtrl = ctrl[Math.floor(ctrl.length / 2)];
  tube.userData.archdiscNurbsCurve = {
    degree, points: ctrl.length, midWeight,
    start: [start.x, start.y, start.z], end: [end.x, end.y, end.z], mid: [mid.x, mid.y, mid.z],
    controlMid: [midCtrl.x, midCtrl.y, midCtrl.z],
    controlStart: [ctrl[0].x, ctrl[0].y, ctrl[0].z], controlEnd: [ctrl[ctrl.length - 1].x, ctrl[ctrl.length - 1].y, ctrl[ctrl.length - 1].z],
  };
  return tube;
}
