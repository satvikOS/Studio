// Slice 723 — Niagara visual node editor (data model).

import { registerOps } from '../common/registry.js';
import {
  createGraph, addModule, removeModule, setParams,
  compile, spawn, despawn, listGraphs, listModuleKinds,
} from './nodes.js';

let _installed = false;

export function installNiagaraUI() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioNiagaraUICreateGraph: createGraph,
    __studioNiagaraUIAddModule: addModule,
    __studioNiagaraUIRemoveModule: removeModule,
    __studioNiagaraUISetParams: setParams,
    __studioNiagaraUICompile: compile,
    __studioNiagaraUISpawn: spawn,
    __studioNiagaraUIDespawn: despawn,
    __studioNiagaraUIList: listGraphs,
    __studioNiagaraUIListModuleKinds: listModuleKinds,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'fx', 'Niagara visual node editor — Emitter / Module / Renderer graph');
}
