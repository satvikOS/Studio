// Slice 700 — Houdini DOPs (Dynamics OPs) graph.

import { registerOps } from '../common/registry.js';
import {
  addObject, addForce, addConstraint,
  removeObject, removeForce, removeConstraint,
  start, stop, reset, setGround, getStats,
} from './solver.js';

let _installed = false;

export function installDOPs() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioDOPsAddObject: addObject,
    __studioDOPsAddForce: addForce,
    __studioDOPsAddConstraint: addConstraint,
    __studioDOPsRemoveObject: removeObject,
    __studioDOPsRemoveForce: removeForce,
    __studioDOPsRemoveConstraint: removeConstraint,
    __studioDOPsStart: start,
    __studioDOPsStop: stop,
    __studioDOPsReset: reset,
    __studioDOPsSetGround: setGround,
    __studioDOPsGetStats: getStats,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'sim', 'Houdini DOPs — dynamics graph (objects/forces/constraints + ground)');
}
