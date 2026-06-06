// Slice 720 — Rhino SubD (Catmull-Clark).

import { registerOps } from '../common/registry.js';
import { subdivide, setCrease } from './catmull.js';

let _installed = false;

export function installRhinoSubD() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioRhinoSubDSubdivide: subdivide,
    __studioRhinoSubDSetCrease: setCrease,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'edit', 'Rhino SubD — Catmull-Clark subdivision surfaces');
}
