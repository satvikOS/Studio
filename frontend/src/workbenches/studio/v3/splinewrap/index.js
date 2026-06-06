// Slice 716 — C4D Spline Wrap deformer.

import { registerOps } from '../common/registry.js';
import { bind, setSpline, unbind, listBindings, bindRail } from './wrap.js';

let _installed = false;

export function installSplineWrap() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioSplineWrapBind: bind,
    __studioSplineWrapSetSpline: setSpline,
    __studioSplineWrapUnbind: unbind,
    __studioSplineWrapList: listBindings,
    __studioSplineWrapBindRail: bindRail,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'mograph', 'C4D Spline Wrap + Spline Rail deformer');
}
