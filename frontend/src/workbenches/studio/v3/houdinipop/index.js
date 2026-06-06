// Slice 727 — Houdini POP (Particle Operator) chains.

import { registerOps } from '../common/registry.js';
import {
  createChain, addOp, setParam, emit, tick, getParticles,
  clearChain, deleteChain, listChains,
} from './pop.js';

let _installed = false;

export function installHoudiniPOP() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioPOPCreateChain: createChain,
    __studioPOPAddOp: addOp,
    __studioPOPSetParam: setParam,
    __studioPOPEmit: emit,
    __studioPOPTick: tick,
    __studioPOPGetParticles: getParticles,
    __studioPOPClearChain: clearChain,
    __studioPOPDeleteChain: deleteChain,
    __studioPOPListChains: listChains,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'fx', 'Houdini POP chains — location/velocity/force/attractor/collision/kill');
}
