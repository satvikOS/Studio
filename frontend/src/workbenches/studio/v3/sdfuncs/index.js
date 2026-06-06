// Slice 723 — Substance Designer function graphs.

import { registerOps } from '../common/registry.js';
import {
  defineFunction, addNode, connect, evaluate,
  listFunctions, listKinds, deleteFunction,
} from './funcs.js';

let _installed = false;

export function installSDFuncs() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioSDFuncDefine: defineFunction,
    __studioSDFuncAddNode: addNode,
    __studioSDFuncConnect: connect,
    __studioSDFuncEvaluate: evaluate,
    __studioSDFuncList: listFunctions,
    __studioSDFuncListKinds: listKinds,
    __studioSDFuncDelete: deleteFunction,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'matlib', 'Substance Designer function graphs — typed parameterized math sub-graphs');
}
