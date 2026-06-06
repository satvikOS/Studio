// Slice 721 — ZBrush UV Master.

import { registerOps } from '../common/registry.js';
import { unwrapAll, setControlPainting, pickPole, unwrapDistortion, unwrapWithSeams, chartCount } from './uvmaster.js';

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
    // Slice 736 — auto seam-cut + multi-chart LSCM (closed meshes).
    __studioZUVMasterUnwrapWithSeams: unwrapWithSeams,
    __studioZUVMasterChartCount: chartCount,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'sculpt', 'ZBrush UV Master — LSCM conformal unwrap + auto seam-cut into developable charts (Blender Smart UV Project / Maya Automatic)');
}
