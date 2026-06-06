// Slice 707 — Real B-spline NURBS surface evaluation.

import { registerOps } from '../common/registry.js';
import { evaluateSurface, moveControlPoint, setWeight, getControlGrid } from './bspline.js';

let _installed = false;

export function installNurbs() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioNurbsEvaluate: evaluateSurface,
    __studioNurbsMoveCP: moveControlPoint,
    __studioNurbsSetWeight: setWeight,
    __studioNurbsGetCPGrid: getControlGrid,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'edit', 'Real NURBS B-spline surface evaluator (Rhino-style control grid)');
}
