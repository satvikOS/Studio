// ArchDisc Studio V3 — Inference snap engine install entry (slice 748).
//
// Wires the op surface:
//   __studioInferenceInstall / Enable / Query / Lock / SetAnchor /
//   SetTolerancePx / GetState / GetQueryCount

import { registerOps } from '../common/registry.js';
import {
  query, setEnabled, isEnabled, setAnchor, setLockedAxis, setTolerancePx,
  getState, getQueryCount,
} from './inference.js';

let _installed = false;

export function installInference() {
  if (_installed) return { ok: true, already: true };
  _installed = true;

  const ops = {
    __studioInferenceInstall: () => ({ ok: true, installed: true }),
    __studioInferenceEnable: (on) => setEnabled(on === undefined ? true : !!on),
    __studioInferenceQuery: ({ x, y }) => query({ x: Number(x), y: Number(y) }),
    __studioInferenceLock: (axis) => setLockedAxis(axis || null),
    __studioInferenceSetAnchor: (p) => setAnchor(Array.isArray(p) ? p : null),
    __studioInferenceSetTolerancePx: (px) => setTolerancePx(px),
    __studioInferenceGetState: () => getState(),
    __studioInferenceGetQueryCount: () => ({ ok: true, count: getQueryCount() }),
    __studioInferenceIsEnabled: () => ({ ok: true, enabled: isEnabled() }),
  };
  for (const [name, fn] of Object.entries(ops)) window[name] = fn;
  registerOps(ops, 'snap', 'SketchUp live inference snap engine');
  // Auto-on by default — the e2e and Archie agent can disable as needed.
  setEnabled(true);
  return { ok: true, installed: true };
}

export default installInference;
