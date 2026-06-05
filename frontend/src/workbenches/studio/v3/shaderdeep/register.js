// ArchDisc Studio V3 — register the 20 deeper shader-node kinds.
//
// Preferred path: the slice-684 shader graph exposes
// `window.__studioShaderRegisterNode(kind, def)` — we call that for
// every entry in MORE_NODE_KINDS so the new kinds slot straight into
// the existing graph editor.
//
// Fallback path: if no such register API exists, we keep the kinds in
// a self-contained `window.__studioShaderDeepNodes` map and expose
// `window.__studioShaderDeepApply(kind, params, inputs)` so callers
// can still drive the evaluator without the host graph being live.
//
// Every registered kind is also surfaced as a thin
// `window.__studioShaderDeep_<kind>(params, inputs)` ops wrapper under
// category `shader` in the V3 command palette.

import { MORE_NODE_KINDS, MORE_NODE_KIND_LIST, evalMoreNode } from './morenodes.js';

let _registered = false;

function registerCommandPalette(kind) {
  if (typeof window === 'undefined') return;
  const reg = window.__studioCommandRegister;
  if (typeof reg !== 'function') return;
  const opName = `__studioShaderDeep_${kind}`;
  const def = MORE_NODE_KINDS[kind];
  if (!window[opName]) {
    window[opName] = (params, inputs, ctx) => {
      try {
        const value = evalMoreNode(kind, params || {}, inputs || {}, ctx || null);
        return { ok: true, kind, value };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    };
  }
  reg(opName, window[opName], {
    category: 'shader',
    description: `Evaluate the ${def.title} shader node`,
  });
}

export function registerShaderDeepNodes() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_registered) return { ok: true, already: true, count: MORE_NODE_KIND_LIST.length };
  _registered = true;

  // ── Fallback map always populated so headless tests can introspect.
  if (!window.__studioShaderDeepNodes || typeof window.__studioShaderDeepNodes !== 'object') {
    window.__studioShaderDeepNodes = {};
  }
  for (const kind of MORE_NODE_KIND_LIST) {
    window.__studioShaderDeepNodes[kind] = MORE_NODE_KINDS[kind];
  }

  // ── Direct evaluator surface.
  if (typeof window.__studioShaderDeepApply !== 'function') {
    window.__studioShaderDeepApply = (kind, params, inputs, ctx) => {
      try {
        const value = evalMoreNode(kind, params || {}, inputs || {}, ctx || null);
        return { ok: true, kind, value };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    };
  }
  if (typeof window.__studioShaderDeepList !== 'function') {
    window.__studioShaderDeepList = () => ({
      ok: true,
      count: MORE_NODE_KIND_LIST.length,
      kinds: MORE_NODE_KIND_LIST.slice(),
    });
  }

  // ── Preferred path: slot into the host graph's register API.
  const hostReg = (typeof window.__studioShaderRegisterNode === 'function')
    ? window.__studioShaderRegisterNode
    : null;
  let hostCount = 0;
  if (hostReg) {
    for (const kind of MORE_NODE_KIND_LIST) {
      try {
        hostReg(kind, MORE_NODE_KINDS[kind]);
        hostCount++;
      } catch (_) { /* swallow per-kind failures */ }
    }
  }

  // ── Command-palette ops, category 'shader'.
  const cmdReg = window.__studioCommandRegister;
  if (typeof cmdReg === 'function') {
    for (const kind of MORE_NODE_KIND_LIST) registerCommandPalette(kind);
    if (!window.__studioShaderDeepApply.__registered) {
      cmdReg('__studioShaderDeepApply', window.__studioShaderDeepApply, {
        category: 'shader',
        description: 'Evaluate any deeper shader-node kind by name',
      });
      cmdReg('__studioShaderDeepList', window.__studioShaderDeepList, {
        category: 'shader',
        description: 'List the 20 deeper shader-node kind names',
      });
      window.__studioShaderDeepApply.__registered = true;
    }
  }

  return {
    ok: true,
    count: MORE_NODE_KIND_LIST.length,
    hostRegistered: hostCount,
    hostAvailable: !!hostReg,
  };
}
