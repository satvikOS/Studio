// Slice 727 — Maya constraint system.

import { registerOps } from '../common/registry.js';
import {
  create, setEnabled, setOffset, setPathParameter, remove, listConstraints,
} from './constraints.js';

let _installed = false;

export function installMayaConstraints() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioMayaConstraintCreate: create,
    __studioMayaConstraintSetEnabled: setEnabled,
    __studioMayaConstraintSetOffset: setOffset,
    __studioMayaConstraintSetPathT: setPathParameter,
    __studioMayaConstraintRemove: remove,
    __studioMayaConstraintList: listConstraints,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rig', 'Maya constraints — parent / point / orient / scale / aim / lookAt / path');
}
