// Slice 699 — Maya MASH-style motion graphics.

import { registerOps } from '../common/registry.js';
import {
  createNetwork, addNode, clearNodes, evaluate, listNetworks, deleteNetwork,
} from './cloner.js';

let _installed = false;

export function installMASH() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioMASHCreateNetwork: createNetwork,
    __studioMASHAddNode: addNode,
    __studioMASHClearNodes: clearNodes,
    __studioMASHEvaluate: evaluate,
    __studioMASHListNetworks: () => ({ ok: true, networks: listNetworks() }),
    __studioMASHDeleteNetwork: deleteNetwork,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'mograph', 'Maya MASH motion graphics — distribute/random/bend/twist/falloff/signal nodes');
}
