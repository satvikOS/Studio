// ArchDisc Studio V3 — shared __studioAnimTick chain helpers.
//
// Pre-dedup, every module that needed per-frame work owned its own copy
// of the chain-into / chain-out-of boilerplate:
//
//   - bp/runtime.js   (tagged __bp)
//   - fx/index.js     (tagged __fx)
//   - rt/index.js     (tagged __rt)
//   - rtgpu/index.js  (tagged __rtgpu)
//   - sim/index.js    (tagged __sim)
//   - anim/playback.js (tagged __animGraph)
//   - …and more pending.
//
// chainIntoAnimTick(label, fn) installs `fn` at the head of
// window.__archdiscViewport.__studioAnimTick, preserving any pre-existing
// chain via fn.__prev. Tags the wrapper with fn[`__${label}`] = true so
// re-arming is idempotent and unchainFromAnimTick can splice it out
// regardless of where it sits in the chain.

function _vp() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscViewport || null;
}

// Check whether a chain labelled `label` already exists anywhere in the
// current __studioAnimTick chain.
export function isChained(label) {
  const v = _vp();
  if (!v) return false;
  const tag = `__${label}`;
  let cur = v.__studioAnimTick;
  while (cur) {
    if (cur[tag]) return true;
    cur = cur.__prev || null;
  }
  return false;
}

// Install `fn` at the head of the chain. fn is invoked as fn(now) where
// `now` is the millisecond timestamp from requestAnimationFrame (or
// performance.now / Date.now fallback). The wrapper auto-calls the
// previous link after `fn`.
//
// Returns { ok, alreadyChained?, attached? }.
export function chainIntoAnimTick(label, fn) {
  const v = _vp();
  if (!v) return { ok: false, error: 'no viewport' };
  if (isChained(label)) return { ok: true, alreadyChained: true };
  const tag = `__${label}`;
  const prev = v.__studioAnimTick;
  const chained = (now) => {
    const t = (typeof now === 'number')
      ? now
      : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
    try { fn(t); } catch (_) {}
    if (prev) { try { prev(t); } catch (_) {} }
  };
  chained[tag] = true;
  chained.__prev = prev;
  v.__studioAnimTick = chained;
  return { ok: true, attached: true };
}

// Remove the chain link tagged `label` from the __studioAnimTick chain.
// Walks the chain so it works regardless of installation order.
export function unchainFromAnimTick(label) {
  const v = _vp();
  if (!v) return { ok: false, error: 'no viewport' };
  const tag = `__${label}`;
  if (!v.__studioAnimTick) return { ok: true, alreadyDetached: true };
  if (v.__studioAnimTick[tag]) {
    v.__studioAnimTick = v.__studioAnimTick.__prev || null;
    return { ok: true, detached: true };
  }
  let head = v.__studioAnimTick;
  while (head && head.__prev) {
    if (head.__prev[tag]) {
      head.__prev = head.__prev.__prev || null;
      return { ok: true, detached: true };
    }
    head = head.__prev;
  }
  return { ok: true, alreadyDetached: true };
}
