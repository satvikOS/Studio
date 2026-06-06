// Slice 713 — Cinema 4D XPresso visual scripting.

import { registerOps } from '../common/registry.js';
import {
  createGraph, addNode, connect, setParam, removeNode,
  start, stop, evaluateOnce, listNodes, listKinds,
} from './graph.js';

let _installed = false;

export function installXPresso() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioXPressoCreateGraph: createGraph,
    __studioXPressoAddNode: addNode,
    __studioXPressoConnect: connect,
    __studioXPressoSetParam: setParam,
    __studioXPressoRemoveNode: removeNode,
    __studioXPressoStart: start,
    __studioXPressoStop: stop,
    __studioXPressoEvaluateOnce: evaluateOnce,
    __studioXPressoListNodes: listNodes,
    __studioXPressoListKinds: listKinds,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'bp', 'C4D XPresso visual scripting — 18 node kinds + 7 sink ops');
}
