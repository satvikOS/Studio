// ArchDisc Studio V3 — sculpt brushes installer.
//
// `installSculptBrushes()` walks the BRUSHES table from `brushes.js`
// and attaches each as a `window.__studioSculptBrush<Name>` op,
// auto-registering with the V3 command palette under category
// 'sculpt'. Also wires the 5 utility ops for active-brush selection
// + radius default.
//
// Idempotent: re-calling no-ops via window.__studioSculptBrushesInstalled.
//
// Contract:
//   __studioSculptBrush<Name>(point, radius?, strength?, opts?)
//     → result from brushes.js (real per-vertex displacement)
//
// All per-brush ops auto-resolve the selected mesh via
// `window.__studioSelectedMesh()` (same convention as slice 684).
// They push undo before mutating, so the user can roll back any
// stroke from the toolbar.

import { BRUSHES } from './brushes.js';

const ACTIVE_KEY = '__studioSculptBrushActiveName';
const RADIUS_KEY = '__studioSculptBrushDefaultRadius';

function getSelectedMesh() {
  if (typeof window === 'undefined') return null;
  const fn = window.__studioSelectedMesh;
  if (typeof fn !== 'function') return null;
  try { return fn() || null; } catch (_) { return null; }
}

function reg(name, fn, description) {
  if (typeof window === 'undefined') return;
  window[name] = fn;
  const doRegister = () => {
    if (typeof window.__studioCommandRegister === 'function') {
      try {
        window.__studioCommandRegister(name, fn, { category: 'sculpt', description });
      } catch (_) {}
    }
  };
  doRegister();
  // The palette registry may not be live yet — retry on next macrotask.
  setTimeout(doRegister, 0);
}

// Build a per-brush op that resolves the selected mesh, pushes undo,
// and forwards to the underlying brush algo. Returns `{ ok:false }`
// when no mesh is selected — the spec asserts ok=true after a spawn,
// so this only trips when callers invoke the op without selection.
function makeBrushOp(name, fn) {
  return (point, radius, strength, opts) => {
    const sel = getSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    const r = radius == null
      ? (typeof window !== 'undefined' && Number.isFinite(window[RADIUS_KEY]) ? window[RADIUS_KEY] : 0.1)
      : radius;
    const s = strength == null ? 0.5 : strength;
    if (typeof window !== 'undefined' && typeof window.__studioPushUndo === 'function') {
      try { window.__studioPushUndo('sculpt-brush-' + name); } catch (_) {}
    }
    try {
      return fn(sel, point, r, s, opts || {});
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  };
}

export function installSculptBrushes() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (window.__studioSculptBrushesInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  window.__studioSculptBrushesInstalled = true;

  // Default radius lives on window so all ops & the SetRadius util
  // share it.
  if (!Number.isFinite(window[RADIUS_KEY])) window[RADIUS_KEY] = 0.1;
  if (!window[ACTIVE_KEY]) window[ACTIVE_KEY] = BRUSHES[0][0];

  const registered = [];

  // Per-brush ops.
  for (const [name, fn, desc] of BRUSHES) {
    const opName = '__studioSculptBrush' + name;
    const op = makeBrushOp(name, fn);
    reg(opName, op, desc);
    registered.push(opName);
  }

  // ── Utility ops ────────────────────────────────────────────────────

  // 1) List every brush + the current active.
  reg('__studioSculptBrushList', () => ({
    ok: true,
    count: BRUSHES.length,
    active: window[ACTIVE_KEY],
    radius: window[RADIUS_KEY],
    names: BRUSHES.map(([n]) => n),
    descriptions: Object.fromEntries(BRUSHES.map(([n, , d]) => [n, d])),
  }), 'List all sculpt brushes + the active one.');

  // 2) Set the active brush by name.
  reg('__studioSculptBrushSetActive', (name) => {
    const hit = BRUSHES.find(([n]) => n === name);
    if (!hit) {
      return {
        ok: false,
        error: 'unknown brush',
        valid: BRUSHES.map(([n]) => n),
      };
    }
    window[ACTIVE_KEY] = hit[0];
    if (typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('studio-sculpt-brush-active-changed', {
          detail: { name: hit[0] },
        }));
      } catch (_) {}
    }
    return { ok: true, active: hit[0] };
  }, 'Set the active sculpt brush by name.');

  // 3) Get the active brush.
  reg('__studioSculptBrushGetActive', () => ({
    ok: true,
    active: window[ACTIVE_KEY] || null,
  }), 'Return the active sculpt brush name.');

  // 4) Apply the active brush at a point with optional radius/strength.
  reg('__studioSculptBrushApplyActive', (point, radius, strength, opts) => {
    const name = window[ACTIVE_KEY];
    const hit = BRUSHES.find(([n]) => n === name);
    if (!hit) return { ok: false, error: 'no active brush' };
    const opName = '__studioSculptBrush' + hit[0];
    const op = window[opName];
    if (typeof op !== 'function') return { ok: false, error: 'op missing: ' + opName };
    const r = op(point, radius, strength, opts);
    return r && typeof r === 'object'
      ? Object.assign({}, r, { active: hit[0] })
      : { ok: !!r, active: hit[0] };
  }, 'Apply the active sculpt brush at point [x,y,z].');

  // 5) Set the default radius used when callers omit it.
  reg('__studioSculptBrushSetRadius', (r) => {
    const num = Number(r);
    if (!Number.isFinite(num) || num <= 0) {
      return { ok: false, error: 'radius must be > 0' };
    }
    window[RADIUS_KEY] = num;
    if (typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('studio-sculpt-brush-radius-changed', {
          detail: { radius: num },
        }));
      } catch (_) {}
    }
    return { ok: true, radius: num };
  }, 'Set the default sculpt brush radius.');

  return {
    ok: true,
    alreadyInstalled: false,
    brushes: BRUSHES.length,
    ops: registered.length + 5,
    names: BRUSHES.map(([n]) => n),
  };
}

export function uninstallSculptBrushes() {
  if (typeof window === 'undefined') return { ok: false };
  if (!window.__studioSculptBrushesInstalled) return { ok: true };
  for (const [name] of BRUSHES) {
    const opName = '__studioSculptBrush' + name;
    try { delete window[opName]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(opName); } catch (_) {}
    }
  }
  for (const util of [
    '__studioSculptBrushList',
    '__studioSculptBrushSetActive',
    '__studioSculptBrushGetActive',
    '__studioSculptBrushApplyActive',
    '__studioSculptBrushSetRadius',
  ]) {
    try { delete window[util]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(util); } catch (_) {}
    }
  }
  window.__studioSculptBrushesInstalled = false;
  return { ok: true };
}

export default installSculptBrushes;
