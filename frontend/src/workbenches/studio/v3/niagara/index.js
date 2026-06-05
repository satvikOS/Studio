// Slice 703 — Niagara-style real-time particle systems.

import { registerOps } from '../common/registry.js';
import {
  createSystem, destroySystem, setEmitter, setModules,
  setSpawnRate, pause, resume, listSystems, getStats,
} from './system.js';

let _installed = false;

export function installNiagara() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioNiagaraCreate: createSystem,
    __studioNiagaraDestroy: destroySystem,
    __studioNiagaraSetEmitter: setEmitter,
    __studioNiagaraSetModules: setModules,
    __studioNiagaraSetSpawnRate: setSpawnRate,
    __studioNiagaraPause: pause,
    __studioNiagaraResume: resume,
    __studioNiagaraList: listSystems,
    __studioNiagaraStats: getStats,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'fx', 'Niagara-style real-time GPU particle systems');
}
