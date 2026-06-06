// Slice 711 — 3ds Max Reactor rigid body.

import { registerOps } from '../common/registry.js';
import {
  addBody, addPointConstraint, addHingeConstraint, buildChain,
  start, stop, reset, listBodies,
} from './rigid.js';

let _installed = false;

export function installReactor() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioReactorAddBody: addBody,
    __studioReactorAddPointConstraint: addPointConstraint,
    __studioReactorAddHingeConstraint: addHingeConstraint,
    __studioReactorBuildChain: buildChain,
    __studioReactorStart: start,
    __studioReactorStop: stop,
    __studioReactorReset: reset,
    __studioReactorList: listBodies,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'sim', '3ds Max Reactor rigid body — Verlet bodies + constraints + chain builder');
}
