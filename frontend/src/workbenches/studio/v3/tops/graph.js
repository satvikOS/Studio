// Slice 711 — Houdini TOPs (Task Operator) graph. A DAG of "tasks"
// where each task generates "work items" from inputs; downstream
// tasks process each item. Supports: range (parameter sweep), wedge
// (multi-axis cartesian product), python-task (run a JS function per
// item), partitioner (group items by key), merge (combine work item
// streams). Differs from VEX (per-point) and DOPs (physics): TOPs is
// the batch / wedge / parallel-task scheduler.

const _graphs = new Map();
let _seq = 1;
function _uid() { return `top-${_seq++}-${Date.now().toString(36)}`; }

export function createGraph() {
  const id = _uid();
  _graphs.set(id, { id, tasks: [], edges: [], itemCache: new Map() });
  return { ok: true, id };
}

export function addTask(graphId, kind, params) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  const uuid = _uid();
  g.tasks.push({ uuid, kind, params: params || {} });
  return { ok: true, uuid };
}

export function connect(graphId, fromUuid, toUuid) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  g.edges.push({ from: fromUuid, to: toUuid });
  return { ok: true };
}

function _upstreamItems(g, taskUuid) {
  // Concatenate all upstream task outputs.
  const upstream = g.edges.filter((e) => e.to === taskUuid).map((e) => e.from);
  const items = [];
  for (const up of upstream) {
    const upItems = g.itemCache.get(up) || [];
    items.push(...upItems);
  }
  return items;
}

function _runTask(g, task) {
  const upstreamItems = _upstreamItems(g, task.uuid);
  const items = [];
  switch (task.kind) {
    case 'range': {
      const start = Number(task.params.start) || 0;
      const end = Number(task.params.end) || 10;
      const step = Number(task.params.step) || 1;
      for (let v = start; v <= end; v += step) items.push({ value: v, sourceTask: task.uuid });
      break;
    }
    case 'wedge': {
      // params.axes: [{name, values:[...]}] cartesian product.
      const axes = task.params.axes || [];
      const product = [{}];
      for (const ax of axes) {
        const next = [];
        for (const acc of product) {
          for (const val of ax.values) {
            next.push({ ...acc, [ax.name]: val });
          }
        }
        product.splice(0, product.length, ...next);
      }
      for (const p of product) items.push({ ...p, sourceTask: task.uuid });
      break;
    }
    case 'python-task': {
      // Apply task.params.fn (or .expr) to each upstream item.
      let fn = task.params.fn;
      if (!fn && typeof task.params.expr === 'string') {
        // eslint-disable-next-line no-new-func
        fn = new Function('item', `return (${task.params.expr});`);
      }
      if (typeof fn !== 'function') return [];
      for (const item of upstreamItems) {
        try {
          const out = fn(item);
          if (Array.isArray(out)) items.push(...out);
          else if (out !== undefined) items.push(out);
        } catch (_) {}
      }
      break;
    }
    case 'partitioner': {
      const keyFn = task.params.keyFn || ((i) => i.partitionKey || 'default');
      const groups = new Map();
      for (const item of upstreamItems) {
        const k = keyFn(item);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(item);
      }
      for (const [k, members] of groups.entries()) {
        items.push({ partitionKey: k, members, sourceTask: task.uuid });
      }
      break;
    }
    case 'merge': {
      // Just concat — already done by _upstreamItems.
      items.push(...upstreamItems);
      break;
    }
    case 'studio-op': {
      // Call a window.__studio* op with parameters drawn from each item.
      const opName = task.params.op;
      const argFn = task.params.argFn;
      if (typeof window[opName] !== 'function') break;
      for (const item of upstreamItems) {
        try {
          const args = argFn ? argFn(item) : [item];
          const res = window[opName](...(Array.isArray(args) ? args : [args]));
          items.push({ ...item, result: res, sourceTask: task.uuid });
        } catch (e) {
          items.push({ ...item, error: e.message, sourceTask: task.uuid });
        }
      }
      break;
    }
    case 'filter': {
      const fn = typeof task.params.fn === 'function'
        ? task.params.fn
        : new Function('item', `return (${task.params.expr || 'true'});`);
      for (const item of upstreamItems) {
        try { if (fn(item)) items.push(item); } catch (_) {}
      }
      break;
    }
    case 'static': {
      // Items defined directly on the task.
      for (const it of (task.params.items || [])) items.push(it);
      break;
    }
    default:
      // Unknown — pass through.
      items.push(...upstreamItems);
  }
  g.itemCache.set(task.uuid, items);
  return items;
}

function _topologicalOrder(g) {
  const order = [];
  const visited = new Set();
  const visiting = new Set();
  function _visit(uuid) {
    if (visited.has(uuid) || visiting.has(uuid)) return;
    visiting.add(uuid);
    for (const e of g.edges) {
      if (e.to === uuid) _visit(e.from);
    }
    visiting.delete(uuid);
    visited.add(uuid);
    order.push(uuid);
  }
  for (const t of g.tasks) _visit(t.uuid);
  return order;
}

export function cook(graphId) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  g.itemCache.clear();
  const order = _topologicalOrder(g);
  for (const uuid of order) {
    const task = g.tasks.find((t) => t.uuid === uuid);
    if (task) _runTask(g, task);
  }
  return { ok: true, totalItems: Array.from(g.itemCache.values()).reduce((a, b) => a + b.length, 0) };
}

export function getItems(graphId, taskUuid) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  return { ok: true, items: g.itemCache.get(taskUuid) || [] };
}

export function listTasks(graphId) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  return { ok: true, tasks: g.tasks.map((t) => ({ uuid: t.uuid, kind: t.kind, params: t.params })), edges: g.edges.slice() };
}

export function deleteGraph(graphId) {
  return { ok: _graphs.delete(graphId) };
}
