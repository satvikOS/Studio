// Slice 721 — ZBrush UV Master.

import { registerOps } from '../common/registry.js';
import { unwrapAll, setControlPainting, pickPole, unwrapDistortion } from './uvmaster.js';

let _installed = false;

export function installZUVMaster() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioZUVMasterUnwrapAll: unwrapAll,
    __studioZUVMasterSetControlPainting: setControlPainting,
    __studioZUVMasterPickPole: pickPole,
    // Slice 734 — LSCM conformal-unwrap quality metric.
    __studioZUVMasterDistortion: unwrapDistortion,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'sculpt', 'ZBrush UV Master — one-click LSCM conformal unwrap (Least Squares Conformal Maps) + relax + pack');
}
