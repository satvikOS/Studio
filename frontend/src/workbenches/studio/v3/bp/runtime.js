// ArchDisc Studio V3 — Blueprints runtime.
//
// installRuntime(graph) wires three real event sources:
//   • OnStart   — fires once, synchronously on install.
//   • OnTick    — fires every frame via the shared
//                 window.__archdiscViewport.__studioAnimTick chain,
//                 tagged __bp so it can be safely unchained.
//   • OnKeyDown — fires when its `key` param matches a real keydown
//                 event. Registers one global window listener for the
//                 whole runtime.
//
// When an event fires we walk its exec chain — each node's exec()
// returns either { next: 'then' }, { next: 'else' }, or
// { next: null, defer: { seconds, then } } (for Delay). For each step
// we pull data inputs through the data resolver before calling exec.
//
// Per-fire data cache lets a downstream node read an upstream action's
// data outputs (e.g. CallStudioOp.result or OnTick.deltaTime) without
// re-firing the event.

import { NODE_KINDS } from './nodes.js';
import { resolveInputs, findExecTarget, listEventNodes } from './graph.js';

function getInvoker() {
  if (typeof window === 'undefined') return null;
  if (typeof window.__studioCommandInvoke === 'function') {
    return window.__studioCommandInvoke;
  }
  return null;
}

function getMeshByUuidImpl(uuid) {
  if (typeof window === 'undefined') return null;
  if (!uuid) {
    if (typeof window.__studioSelectedMesh === 'function') {
      try { return window.__studioSelectedMesh(); } catch (_) { return null; }
    }
    return null;
  }
  const scene = window.__archdiscScene;
  if (!scene || !scene.traverse) return null;
  let hit = null;
  scene.traverse((o) => { if (!hit && o.uuid === uuid) hit = o; });
  return hit;
}

function defaultLog(...args) {
  if (typeof console !== 'undefined') console.log('[bp]', ...args);
}

export function createRuntime(graph) {
  const rt = {
    graph,
    started: false,
    _dataCache: new Map(), // per-frame data publish from event/action nodes
    _keyListener: null,
    _tickFn: null,
    _timers: new Set(),
    _logSink: defaultLog,
    _lastResult: null,
    _stepCount: 0,
  };

  function buildCtx(extra = {}) {
    return {
      runtime: rt,
      graph,
      now: (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now(),
      deltaTime: 0,
      key: '',
      event: '',
      getMeshByUuid: getMeshByUuidImpl,
      invoke: getInvoker(),
      log: (...args) => { try { rt._logSink(...args); } catch (_) {} },
      ...extra,
    };
  }

  // Walk the exec chain starting at `node`. The first hop has `seed`
  // data outputs (typically the event's payload, e.g. deltaTime).
  function fireFromExecNode(node, ctx, seed) {
    if (!node) return;
    const cache = new Map();
    if (seed && typeof seed === 'object') cache.set(node.id, seed);
    rt._dataCache = cache;
    _walkExec(node, ctx, cache, 0);
  }

  function _walkExec(node, ctx, cache, depth) {
    if (!node || depth > 1000) return; // safety cap
    rt._stepCount++;
    const g = rt.graph;
    const def = NODE_KINDS[node.kind];
    if (!def) return;
    // Resolve data inputs *and* fold in cached outputs from this node
    // (e.g. event payload published into cache by the seed).
    const ins = resolveInputs(g, node, ctx, cache);
    let r;
    try { r = def.exec ? def.exec.call(node, ctx, ins) : null; }
    catch (e) { defaultLog('exec error', node.kind, e && e.message); return; }
    const norm = r || { next: 'then' };
    // Publish this node's data outputs so downstream pure-data resolvers
    // can read e.g. CallStudioOp.result on the same fire.
    if (norm.data && typeof norm.data === 'object') {
      const existing = cache.get(node.id) || {};
      cache.set(node.id, { ...existing, ...norm.data });
    }
    // Deferred continuation (Delay).
    if (norm.defer && norm.defer.seconds >= 0) {
      const secs = norm.defer.seconds;
      const branch = norm.defer.then || 'then';
      const tgt = findExecTarget(g, node.id, branch);
      if (!tgt) return;
      const dst = g.nodes.get(tgt.dstId);
      const handle = setTimeout(() => {
        rt._timers.delete(handle);
        if (!rt.started) return;
        _walkExec(dst, ctx, cache, depth + 1);
      }, Math.max(0, secs * 1000));
      rt._timers.add(handle);
      return;
    }
    if (!norm.next) return;
    const tgt = findExecTarget(g, node.id, norm.next);
    if (!tgt) return;
    const dst = g.nodes.get(tgt.dstId);
    _walkExec(dst, ctx, cache, depth + 1);
  }

  // ─── Event sources ─────────────────────────────────────────────────
  function fireOnStart() {
    for (const ev of listEventNodes(rt.graph)) {
      if (ev.kind !== 'OnStart') continue;
      const ctx = buildCtx({ event: 'OnStart' });
      fireFromExecNode(ev, ctx, { then: null });
    }
  }

  function fireOnTick(deltaTime) {
    for (const ev of listEventNodes(rt.graph)) {
      if (ev.kind !== 'OnTick') continue;
      const ctx = buildCtx({ event: 'OnTick', deltaTime });
      fireFromExecNode(ev, ctx, { then: null, deltaTime });
    }
  }

  function fireOnKeyDown(key) {
    for (const ev of listEventNodes(rt.graph)) {
      if (ev.kind !== 'OnKeyDown') continue;
      const wantKey = String(ev.params && ev.params.key || '').toLowerCase();
      if (wantKey && wantKey !== String(key).toLowerCase()) continue;
      const ctx = buildCtx({ event: 'OnKeyDown', key });
      fireFromExecNode(ev, ctx, { then: null, key });
    }
  }

  // Hook the tick fn into __studioAnimTick using the standard pattern
  // (preserve prev, tag with __bp). Re-arming is idempotent.
  function _attachTick() {
    if (typeof window === 'undefined') return;
    const v = window.__archdiscViewport;
    if (!v) return;
    if (v.__studioAnimTick && v.__studioAnimTick.__bp) return;
    const prev = v.__studioAnimTick;
    let lastNow = 0;
    const fn = (now) => {
      if (rt.started) {
        const ms = typeof now === 'number' ? now : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
        const dt = lastNow ? (ms - lastNow) / 1000 : 0;
        lastNow = ms;
        try { fireOnTick(dt); } catch (_) {}
      }
      if (prev) prev(now);
    };
    fn.__bp = true;
    fn.__prev = prev;
    v.__studioAnimTick = fn;
    rt._tickFn = fn;
  }

  function _detachTick() {
    if (typeof window === 'undefined') return;
    const v = window.__archdiscViewport;
    if (!v) return;
    // Walk the chain and splice out our __bp link.
    if (v.__studioAnimTick && v.__studioAnimTick.__bp) {
      v.__studioAnimTick = v.__studioAnimTick.__prev || null;
    } else if (v.__studioAnimTick) {
      let head = v.__studioAnimTick;
      while (head && head.__prev) {
        if (head.__prev.__bp) {
          head.__prev = head.__prev.__prev || null;
          break;
        }
        head = head.__prev;
      }
    }
    rt._tickFn = null;
  }

  function _attachKeydown() {
    if (typeof window === 'undefined' || rt._keyListener) return;
    const listener = (e) => {
      if (!rt.started) return;
      // Ignore keydown that happened inside an input/textarea/etc.
      const ae = (typeof document !== 'undefined') ? document.activeElement : null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      try { fireOnKeyDown(e.key); } catch (_) {}
    };
    window.addEventListener('keydown', listener);
    rt._keyListener = listener;
  }

  function _detachKeydown() {
    if (typeof window === 'undefined' || !rt._keyListener) return;
    window.removeEventListener('keydown', rt._keyListener);
    rt._keyListener = null;
  }

  function _clearTimers() {
    for (const t of rt._timers) {
      try { clearTimeout(t); } catch (_) {}
    }
    rt._timers.clear();
  }

  // ─── Public ────────────────────────────────────────────────────────
  rt.start = () => {
    if (rt.started) return { ok: true, already: true };
    rt.started = true;
    _attachTick();
    _attachKeydown();
    // OnStart fires synchronously on start.
    try { fireOnStart(); } catch (_) {}
    return { ok: true };
  };

  rt.stop = () => {
    if (!rt.started) return { ok: true, already: true };
    rt.started = false;
    _detachTick();
    _detachKeydown();
    _clearTimers();
    return { ok: true };
  };

  rt.fireKey = (key) => { fireOnKeyDown(String(key || '')); return { ok: true }; };
  rt.fireStart = () => { fireOnStart(); return { ok: true }; };
  rt.fireTick = (dt) => { fireOnTick(Number(dt) || 0); return { ok: true }; };

  rt.setGraph = (g) => {
    // Replace graph in-place; running events bind to the new one on
    // next fire because we read graph from the closure on each event.
    rt.graph = g;
  };

  rt.setLogSink = (fn) => { if (typeof fn === 'function') rt._logSink = fn; };

  return rt;
}
