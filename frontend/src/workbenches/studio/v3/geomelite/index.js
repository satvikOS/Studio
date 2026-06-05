// Slice 697 — 25 more Geometry Node kinds (geomelite/).

import { registerOps } from '../common/registry.js';
import { GEOM_ELITE_NODES } from './morenodes.js';
import { registerAll } from './register.js';

let _installed = false;

export function installGeomElite() {
  if (_installed) return;
  _installed = true;

  registerAll();

  const ops = {};
  for (const kind of Object.keys(GEOM_ELITE_NODES)) {
    const name = `__studioGeomElite_${kind}`;
    ops[name] = (params, inputs) => window.__studioGeomEliteApply(kind, params, inputs);
    window[name] = ops[name];
  }
  ops.__studioGeomEliteList = window.__studioGeomEliteList;
  ops.__studioGeomEliteApply = window.__studioGeomEliteApply;

  registerOps(ops, 'geomnodes', 'Geometry Nodes — geomelite kinds');
}
