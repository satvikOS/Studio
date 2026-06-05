// Slice 700 — Grasshopper-style visual graph runner.

import { registerOps } from '../common/registry.js';
import {
  addNode, setParam, connect, disconnect, removeNode, evaluate,
  listNodes, getNodeOutput, listKinds, exportJson, importJson, clearGraph,
} from './graph.js';

let _installed = false;

export function installGHGraph() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioGHAddNode: addNode,
    __studioGHSetParam: setParam,
    __studioGHConnect: connect,
    __studioGHDisconnect: disconnect,
    __studioGHRemoveNode: removeNode,
    __studioGHEvaluate: evaluate,
    __studioGHListNodes: () => ({ ok: true, count: listNodes().length, nodes: listNodes() }),
    __studioGHGetNodeOutput: getNodeOutput,
    __studioGHListKinds: () => ({ ok: true, kinds: listKinds() }),
    __studioGHExport: () => ({ ok: true, json: exportJson() }),
    __studioGHImport: importJson,
    __studioGHClear: clearGraph,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'bp', 'Grasshopper-style visual graph (parametric pipeline of Studio ops)');
}
