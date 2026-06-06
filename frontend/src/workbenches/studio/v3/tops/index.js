// Slice 711 — Houdini TOPs (Task Operator) graph.

import { registerOps } from '../common/registry.js';
import {
  createGraph, addTask, connect, cook, getItems, listTasks, deleteGraph,
} from './graph.js';

let _installed = false;

export function installTOPs() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioTOPsCreateGraph: createGraph,
    __studioTOPsAddTask: addTask,
    __studioTOPsConnect: connect,
    __studioTOPsCook: cook,
    __studioTOPsGetItems: getItems,
    __studioTOPsListTasks: listTasks,
    __studioTOPsDeleteGraph: deleteGraph,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'bp', 'Houdini TOPs (Task Operators) — batch / wedge / partition task graph');
}
