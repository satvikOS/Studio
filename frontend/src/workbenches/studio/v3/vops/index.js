// Slice 705 — Houdini VOPs (visual VEX node graph).

import { registerOps } from '../common/registry.js';
import {
  createGraph, addNode, connect, removeNode, setParam,
  compile, compileAndRun, listNodes, listKinds,
} from './graph.js';

let _installed = false;

export function installVOPs() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioVOPsCreateGraph: createGraph,
    __studioVOPsAddNode: addNode,
    __studioVOPsConnect: connect,
    __studioVOPsRemoveNode: removeNode,
    __studioVOPsSetParam: setParam,
    __studioVOPsCompile: compile,
    __studioVOPsCompileAndRun: compileAndRun,
    __studioVOPsListNodes: listNodes,
    __studioVOPsListKinds: listKinds,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'vex', 'Houdini VOPs — visual VEX node graph that compiles + runs on points');
}
