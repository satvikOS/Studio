// Slice 712 — Plasticity implicit (SDF) sculpt brushes.

import { registerOps } from '../common/registry.js';
import {
  beginSculpt, stampSphere, stampBox, stampCapsule, finishSculpt, listSessions,
} from './sdfbrush.js';

let _installed = false;

export function installImplicitSculpt() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioImplicitSculptBegin: beginSculpt,
    __studioImplicitSculptStampSphere: stampSphere,
    __studioImplicitSculptStampBox: stampBox,
    __studioImplicitSculptStampCapsule: stampCapsule,
    __studioImplicitSculptFinish: finishSculpt,
    __studioImplicitSculptListSessions: listSessions,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'sculpt', 'Plasticity implicit-SDF sculpt: voxel SDF + CSG stamps');
}
