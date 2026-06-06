// Slice 708 — Niagara extras: mesh-surface emitter + mesh collider.

import { registerOps } from '../common/registry.js';
import {
  attachMeshEmitter, takeSampleForSystem, attachMeshCollider,
  listEmitters, clearEmitter,
} from './emit.js';

let _installed = false;

export function installNiagaraMesh() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioNiagaraMeshAttachEmitter: attachMeshEmitter,
    __studioNiagaraMeshTakeSample: takeSampleForSystem,
    __studioNiagaraMeshAttachCollider: attachMeshCollider,
    __studioNiagaraMeshListEmitters: listEmitters,
    __studioNiagaraMeshClear: clearEmitter,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'fx', 'Niagara extras — emit from mesh surface + collide with mesh');
}
