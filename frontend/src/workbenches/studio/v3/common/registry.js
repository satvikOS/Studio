// ArchDisc Studio V3 — shared command-palette registration helper.
//
// Every module wave 4+ embedded its own copy of this "register with
// retry-on-cold-start" pattern (>20 implementations counted). The
// canonical version lives here.
//
// Usage:
//   import { registerOps } from '../common/registry.js';
//   registerOps({
//     __studioFooDoStuff:   [fn, 'description'],
//     __studioFooOtherStuff: [fn2, 'description'],
//   }, 'foo');
//
// Each entry can be:
//   - [fn, description?]      → registers fn under the slot
//   - fn                      → registers fn with no description
//
// All ops are also pinned to `window[name]` (mirrors the existing
// surface) so the __studio* globals stay reachable even if the palette
// isn't loaded yet.

const _retryEntries = []; // [{name, fn, opts}]
let _retryTimer = null;

function _scheduleRetry() {
  if (_retryTimer) return;
  // Use setTimeout so we don't busy-poll; same cadence the per-module
  // copies used.
  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    if (!_retryEntries.length) return;
    if (typeof window === 'undefined') return;
    if (typeof window.__studioCommandRegister !== 'function') {
      _retryTimer = setTimeout(arguments.callee, 100);
      return;
    }
    while (_retryEntries.length) {
      const e = _retryEntries.shift();
      try { window.__studioCommandRegister(e.name, e.fn, e.opts); } catch (_) {}
    }
  }, 0);
}

// Internal single-op register with retry-on-cold-start.
function _regOne(name, fn, category, description) {
  if (typeof window === 'undefined') return;
  window[name] = fn;
  const opts = { category };
  if (description) opts.description = description;
  if (typeof window.__studioCommandRegister === 'function') {
    try {
      window.__studioCommandRegister(name, fn, opts);
      return;
    } catch (_) { /* fall through to retry */ }
  }
  _retryEntries.push({ name, fn, opts });
  _scheduleRetry();
}

// Walk an op map and register each.
//
// opMap: { name → fn } or { name → [fn, description] }
// category: string passed to __studioCommandRegister
// defaultDescription: optional fallback description for entries that
//                     don't supply their own.
export function registerOps(opMap, category, defaultDescription) {
  if (!opMap || typeof opMap !== 'object') return;
  for (const name of Object.keys(opMap)) {
    const v = opMap[name];
    if (Array.isArray(v)) {
      _regOne(name, v[0], category, v[1] || defaultDescription);
    } else if (typeof v === 'function') {
      _regOne(name, v, category, defaultDescription);
    }
  }
}

// Single-op variant for call-sites that don't have a map handy.
export function registerOp(name, fn, category, description) {
  _regOne(name, fn, category, description);
}

// Unregister: removes the window slot + asks the palette to drop it.
// Used by the `uninstall*` paths of each module.
export function unregisterOps(names) {
  if (typeof window === 'undefined') return;
  for (const k of names) {
    try { delete window[k]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(k); } catch (_) {}
    }
  }
}
