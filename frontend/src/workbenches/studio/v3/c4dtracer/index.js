// Slice 724 — C4D MoGraph Tracer object.

import { registerOps } from '../common/registry.js';
import {
  trackObjects, setEnabled, clearTrail, removeTracker, listTrackers,
} from './tracer.js';

let _installed = false;

export function installC4DTracer() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioC4DTracerTrack: trackObjects,
    __studioC4DTracerSetEnabled: setEnabled,
    __studioC4DTracerClearTrail: clearTrail,
    __studioC4DTracerRemove: removeTracker,
    __studioC4DTracerList: listTrackers,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'mograph', 'C4D MoGraph Tracer — per-object motion trails as THREE.Line');
}
