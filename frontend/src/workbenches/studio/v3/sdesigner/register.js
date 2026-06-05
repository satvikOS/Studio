// ArchDisc Studio V3 — register the 25 Substance-Designer-style shader
// node kinds.
//
// Preferred path: the slice-684 shader graph exposes
// `window.__studioShaderRegisterNode(kind, def)` — we call that for
// every entry in SDESIGNER_NODE_KIND_LIST so the new kinds slot
// straight into the existing graph editor.
//
// Fallback path: if no such register API exists, we keep the kinds in
// a self-contained `window.__studioSDesignerNodes` map and expose
// `window.__studioSDesignerApply(kind, params, inputs) → value` so
// callers can still drive the evaluator without the host graph being
// live.
//
// Every registered kind is also surfaced as a thin
// `window.__studioSDesigner_<kind>(params, inputs)` ops wrapper under
// category `shader` in the V3 command palette via the shared
// common/registry.js helper (with retry-on-cold-start).
//
// Mirrors shaderdeep/register.js for consistency.

import {
  SDESIGNER_NODE_KINDS,
  SDESIGNER_NODE_KIND_LIST,
  evalSDesignerNode,
} from './morenodes.js';
import { registerOp } from '../common/registry.js';

let _registered = false;

export function registerSDesignerNodes() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_registered) {
    return { ok: true, already: true, count: SDESIGNER_NODE_KIND_LIST.length };
  }
  _registered = true;

  // ── Fallback map always populated so headless tests can introspect.
  if (!window.__studioSDesignerNodes || typeof window.__studioSDesignerNodes !== 'object') {
    window.__studioSDesignerNodes = {};
  }
  for (const kind of SDESIGNER_NODE_KIND_LIST) {
    window.__studioSDesignerNodes[kind] = SDESIGNER_NODE_KINDS[kind];
  }

  // ── Direct evaluator surface.
  if (typeof window.__studioSDesignerApply !== 'function') {
    window.__studioSDesignerApply = (kind, params, inputs, ctx) => {
      try {
        const value = evalSDesignerNode(kind, params || {}, inputs || {}, ctx || null);
        return { ok: true, kind, value };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    };
  }
  if (typeof window.__studioSDesignerList !== 'function') {
    window.__studioSDesignerList = () => ({
      ok: true,
      count: SDESIGNER_NODE_KIND_LIST.length,
      kinds: SDESIGNER_NODE_KIND_LIST.slice(),
    });
  }

  // ── Preferred path: slot into the host graph's register API.
  const hostReg = (typeof window.__studioShaderRegisterNode === 'function')
    ? window.__studioShaderRegisterNode
    : null;
  let hostCount = 0;
  if (hostReg) {
    for (const kind of SDESIGNER_NODE_KIND_LIST) {
      try {
        hostReg(kind, SDESIGNER_NODE_KINDS[kind]);
        hostCount++;
      } catch (_) { /* swallow per-kind failures */ }
    }
  }

  // ── Per-kind window.__studioSDesigner_<kind> ops + palette
  // registration via common/registry.js (handles cold-start retry).
  for (const kind of SDESIGNER_NODE_KIND_LIST) {
    const opName = `__studioSDesigner_${kind}`;
    const def = SDESIGNER_NODE_KINDS[kind];
    if (typeof window[opName] !== 'function') {
      window[opName] = (params, inputs, ctx) => {
        try {
          const value = evalSDesignerNode(kind, params || {}, inputs || {}, ctx || null);
          return { ok: true, kind, value };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      };
    }
    registerOp(opName, window[opName], 'shader',
      `Evaluate the ${def.title} Substance-Designer-style shader node`);
  }

  // Apply + List wrappers.
  registerOp('__studioSDesignerApply', window.__studioSDesignerApply, 'shader',
    'Evaluate any Substance-Designer-style shader node kind by name');
  registerOp('__studioSDesignerList', window.__studioSDesignerList, 'shader',
    'List the 25 Substance-Designer-style shader node kind names');

  return {
    ok: true,
    count: SDESIGNER_NODE_KIND_LIST.length,
    hostRegistered: hostCount,
    hostAvailable: !!hostReg,
  };
}
