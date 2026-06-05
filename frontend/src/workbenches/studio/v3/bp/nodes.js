// ArchDisc Studio V3 — Blueprints node-type registry.
//
// Inspired by Unreal Engine Blueprints. Each node has two wire flavours:
//
//   • exec wires (yellow triangle sockets) — control flow.
//   • data wires (round, type-coloured sockets) — values.
//
// Node descriptor shape:
//   {
//     title           — short label for the editor
//     category        — palette grouping ('event' | 'action' | 'data')
//     defaultParams() — base param object cloned per instance
//     inputs          — [{ name, type: 'exec' | 'number' | 'vector3' |
//                          'string' | 'boolean' | 'any', default? }]
//     outputs         — same shape
//     event?: true    — node fires from the runtime, not from upstream exec
//     exec(ctx, ins)  — for action/event/branch nodes. Returns one of:
//          { next: 'then'|'else'|null, data?: { outName: value } }
//          Plain null/undefined ≡ { next: 'then' }.
//     evalData(ctx, ins) — for pure data nodes. Returns a map of
//          { outputName → value } OR (single-output shortcut) a raw
//          value, which is bound to the first output's name.
//
// `ctx` shape (built by runtime.js per fire):
//   { event: string, deltaTime: number, key?: string, runtime, graph,
//     now: number, getMeshByUuid(uuid), invoke(opName, ...args),
//     log(...args) }

// ─── Helpers ─────────────────────────────────────────────────────────────
export function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (Array.isArray(v) && v.length) return Number(v[0]) || 0;
  return 0;
}
export function toVector3(v) {
  if (Array.isArray(v) && v.length >= 3) {
    return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
  }
  if (v && typeof v === 'object' && 'x' in v) {
    return [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0];
  }
  if (typeof v === 'number') return [v, v, v];
  return [0, 0, 0];
}
export function toBoolean(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '' && v !== 'false' && v !== '0';
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}
export function toStringy(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

// Type → swatch colour for the editor's data sockets. Exec uses a separate
// yellow triangle and never participates here.
export const TYPE_COLOR = {
  exec:    '#f5c542',
  number:  '#7ad06d',
  vector3: '#f5915e',
  string:  '#d678e8',
  boolean: '#e35d6a',
  any:     '#9aa6b2',
};

// ─── Node definitions ────────────────────────────────────────────────────
export const NODE_KINDS = {
  // ═════ EVENTS ═════════════════════════════════════════════════════════
  OnStart: {
    title: 'OnStart',
    category: 'event',
    event: true,
    defaultParams: () => ({}),
    inputs: [],
    outputs: [{ name: 'then', type: 'exec' }],
    exec() { return { next: 'then' }; },
  },

  OnTick: {
    title: 'OnTick',
    category: 'event',
    event: true,
    defaultParams: () => ({}),
    inputs: [],
    outputs: [
      { name: 'then', type: 'exec' },
      { name: 'deltaTime', type: 'number' },
    ],
    exec(ctx) {
      return { next: 'then', data: { deltaTime: ctx.deltaTime || 0 } };
    },
  },

  OnKeyDown: {
    title: 'OnKeyDown',
    category: 'event',
    event: true,
    defaultParams: () => ({ key: 'k' }),
    inputs: [],
    outputs: [
      { name: 'then', type: 'exec' },
      { name: 'key', type: 'string' },
    ],
    exec(ctx) {
      return { next: 'then', data: { key: ctx.key || this.params.key || '' } };
    },
  },

  // ═════ ACTIONS ════════════════════════════════════════════════════════
  CallStudioOp: {
    title: 'CallStudioOp',
    category: 'action',
    defaultParams: () => ({ opName: '__studioCountPrimitives', argsJson: '[]' }),
    inputs: [
      { name: 'exec', type: 'exec' },
      { name: 'opName', type: 'string', default: '' },
      { name: 'argsJson', type: 'string', default: '' },
    ],
    outputs: [
      { name: 'then', type: 'exec' },
      { name: 'result', type: 'any' },
    ],
    exec(ctx, ins) {
      const opName = (ins.has('opName') && ins.get('opName')) ||
                     String(this.params.opName || '');
      const argsRaw = ins.has('argsJson') ? ins.get('argsJson') :
                      this.params.argsJson;
      let args = [];
      if (typeof argsRaw === 'string' && argsRaw.trim()) {
        try {
          const parsed = JSON.parse(argsRaw);
          args = Array.isArray(parsed) ? parsed : [parsed];
        } catch (_) { args = [argsRaw]; }
      } else if (Array.isArray(argsRaw)) {
        args = argsRaw;
      }
      let result = null;
      try {
        const invoke = ctx.invoke;
        // Use __studioCommandInvoke when available — it lives behind the
        // command registry so blueprints can drive every shipped op.
        if (typeof invoke === 'function') {
          const out = invoke(opName, ...args);
          // The command invoker is async; .then is fine but we don't
          // block exec on it. Capture synchronously what we can.
          if (out && typeof out.then === 'function') {
            out.then((r) => { if (ctx.runtime) ctx.runtime._lastResult = r; });
            result = { pending: true };
          } else {
            result = out;
          }
        } else if (typeof window !== 'undefined' && typeof window[opName] === 'function') {
          result = window[opName](...args);
        } else {
          result = { ok: false, error: 'no invoker' };
        }
      } catch (e) {
        result = { ok: false, error: e && e.message };
      }
      return { next: 'then', data: { result } };
    },
  },

  SetMeshTransform: {
    title: 'SetMeshTransform',
    category: 'action',
    defaultParams: () => ({ uuid: '', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] }),
    inputs: [
      { name: 'exec', type: 'exec' },
      { name: 'uuid', type: 'string', default: '' },
      { name: 'pos', type: 'vector3', default: [0, 0, 0] },
      { name: 'rot', type: 'vector3', default: [0, 0, 0] },
      { name: 'scale', type: 'vector3', default: [1, 1, 1] },
    ],
    outputs: [{ name: 'then', type: 'exec' }],
    exec(ctx, ins) {
      const uuid = String(ins.has('uuid') ? ins.get('uuid') : this.params.uuid || '');
      const mesh = ctx.getMeshByUuid ? ctx.getMeshByUuid(uuid) : null;
      if (mesh) {
        const p = toVector3(ins.has('pos') ? ins.get('pos') : this.params.pos);
        const r = toVector3(ins.has('rot') ? ins.get('rot') : this.params.rot);
        const s = toVector3(ins.has('scale') ? ins.get('scale') : this.params.scale);
        if (mesh.position && mesh.position.set) mesh.position.set(p[0], p[1], p[2]);
        if (mesh.rotation && mesh.rotation.set) mesh.rotation.set(r[0], r[1], r[2]);
        if (mesh.scale && mesh.scale.set) mesh.scale.set(s[0], s[1], s[2]);
        if (mesh.updateMatrixWorld) mesh.updateMatrixWorld(true);
      }
      return { next: 'then' };
    },
  },

  Log: {
    title: 'Log',
    category: 'action',
    defaultParams: () => ({ message: 'hello' }),
    inputs: [
      { name: 'exec', type: 'exec' },
      { name: 'message', type: 'any', default: '' },
    ],
    outputs: [{ name: 'then', type: 'exec' }],
    exec(ctx, ins) {
      const msg = ins.has('message') ? ins.get('message') : this.params.message;
      const text = toStringy(msg);
      if (ctx.log) ctx.log(text);
      else if (typeof console !== 'undefined') console.log('[bp]', text);
      return { next: 'then' };
    },
  },

  Branch: {
    title: 'Branch',
    category: 'action',
    defaultParams: () => ({ condition: false }),
    inputs: [
      { name: 'exec', type: 'exec' },
      { name: 'condition', type: 'boolean', default: false },
    ],
    outputs: [
      { name: 'then', type: 'exec' },
      { name: 'else', type: 'exec' },
    ],
    exec(ctx, ins) {
      const cond = toBoolean(ins.has('condition') ? ins.get('condition') : this.params.condition);
      return { next: cond ? 'then' : 'else' };
    },
  },

  Delay: {
    title: 'Delay',
    category: 'action',
    defaultParams: () => ({ seconds: 1 }),
    inputs: [
      { name: 'exec', type: 'exec' },
      { name: 'seconds', type: 'number', default: 1 },
    ],
    outputs: [{ name: 'then', type: 'exec' }],
    exec(ctx, ins) {
      const secs = Math.max(0, toNumber(ins.has('seconds') ? ins.get('seconds') : this.params.seconds));
      // Defer continuation. The runtime treats `defer` as a marker to
      // schedule the downstream exec on a setTimeout instead of running
      // it immediately. The continuation timer key is set by the runtime.
      return { next: null, defer: { seconds: secs, then: 'then' } };
    },
  },

  // ═════ DATA ═══════════════════════════════════════════════════════════
  Number: {
    title: 'Number',
    category: 'data',
    defaultParams: () => ({ value: 0 }),
    inputs: [],
    outputs: [{ name: 'value', type: 'number' }],
    evalData() { return { value: toNumber(this.params.value) }; },
  },

  Vector3: {
    title: 'Vector3',
    category: 'data',
    defaultParams: () => ({ x: 0, y: 0, z: 0 }),
    inputs: [],
    outputs: [{ name: 'value', type: 'vector3' }],
    evalData() {
      return {
        value: [
          toNumber(this.params.x),
          toNumber(this.params.y),
          toNumber(this.params.z),
        ],
      };
    },
  },

  Get: {
    title: 'Get',
    category: 'data',
    defaultParams: () => ({ meshUuid: '', property: 'position' }),
    inputs: [
      { name: 'meshUuid', type: 'string', default: '' },
      { name: 'property', type: 'string', default: 'position' },
    ],
    outputs: [{ name: 'value', type: 'vector3' }],
    evalData(ctx, ins) {
      const uuid = String(ins.has('meshUuid') ? ins.get('meshUuid') : this.params.meshUuid || '');
      const prop = String(ins.has('property') ? ins.get('property') : this.params.property || 'position');
      const mesh = ctx && ctx.getMeshByUuid ? ctx.getMeshByUuid(uuid) : null;
      if (!mesh) return { value: [0, 0, 0] };
      const src = mesh[prop];
      if (!src) return { value: [0, 0, 0] };
      return { value: [Number(src.x) || 0, Number(src.y) || 0, Number(src.z) || 0] };
    },
  },

  Math: {
    title: 'Math',
    category: 'data',
    defaultParams: () => ({ op: 'add' }),
    inputs: [
      { name: 'a', type: 'number', default: 0 },
      { name: 'b', type: 'number', default: 0 },
    ],
    outputs: [{ name: 'value', type: 'number' }],
    evalData(ctx, ins) {
      const a = toNumber(ins.has('a') ? ins.get('a') : 0);
      const b = toNumber(ins.has('b') ? ins.get('b') : 0);
      const op = String(this.params.op || 'add');
      let v = 0;
      switch (op) {
        case 'add': v = a + b; break;
        case 'sub': v = a - b; break;
        case 'mul': v = a * b; break;
        case 'div': v = b === 0 ? 0 : a / b; break;
        case 'min': v = Math.min(a, b); break;
        case 'max': v = Math.max(a, b); break;
        default:    v = a + b; break;
      }
      return { value: v };
    },
  },
};

export function listKinds() { return Object.keys(NODE_KINDS); }

let _uuid = 0;
export function makeNode(kind, params) {
  const def = NODE_KINDS[kind];
  if (!def) throw new Error(`unknown bp node kind: ${kind}`);
  const id = `bp_${Date.now().toString(36)}_${(_uuid++).toString(36)}`;
  return {
    id,
    kind,
    title: def.title,
    params: { ...def.defaultParams(), ...(params || {}) },
    x: 0,
    y: 0,
  };
}

// Helper used by the editor + graph: classify a socket as exec vs data.
export function isExecSlot(slot) { return slot && slot.type === 'exec'; }
