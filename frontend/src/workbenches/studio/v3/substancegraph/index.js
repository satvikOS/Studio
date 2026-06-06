// Slice 716 — Substance Designer node graph.

import { registerOps } from '../common/registry.js';
import {
  createGraph, addNode, connect, cook, getOutputs, listNodes, listKinds,
} from './graph.js';

let _installed = false;

export function installSubstanceGraph() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioSubstanceGraphCreate: createGraph,
    __studioSubstanceGraphAddNode: addNode,
    __studioSubstanceGraphConnect: connect,
    __studioSubstanceGraphCook: cook,
    __studioSubstanceGraphGetOutputs: getOutputs,
    __studioSubstanceGraphListNodes: listNodes,
    __studioSubstanceGraphListKinds: listKinds,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'matlib', 'Substance Designer node graph — 17 node kinds for procedural materials');
}
