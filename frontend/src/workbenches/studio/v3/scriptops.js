// ArchDisc Studio V3 — script / graph execution family.
//
// V3-native ports of:
//   __studioRunVexExpr     — Houdini VEX-style per-vertex expression
//                            evaluator on the active mesh
//   __studioRunGrasshopper — Rhino Grasshopper directed-graph evaluator
//                            (number / add / multiply / point / translate
//                             / spawnPoints)
//   __studioRunTaskGraph   — Houdini PDG / TOPs DAG task runner with
//                            wait / spawn / bakeAOToTexture / screenshot

import * as THREE from 'three';
import { spawnPrimitive } from './spawn';

function scene() {
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}
function activeMesh() {
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}

function runVexExpr(exprString, opts = {}) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh' };
  const g = mesh.geometry;
  const pos = g.attributes.position;
  if (!pos) return { ok: false, error: 'no position attribute' };
  if (pos.count > 200000) return { ok: false, error: 'vertex cap exceeded' };
  const MATH_SAFE = Object.freeze({
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    sqrt: Math.sqrt, pow: Math.pow, exp: Math.exp, log: Math.log,
    abs: Math.abs, sign: Math.sign, floor: Math.floor, ceil: Math.ceil, round: Math.round,
    min: Math.min, max: Math.max, hypot: Math.hypot,
    PI: Math.PI, E: Math.E, TAU: Math.PI * 2,
  });
  let fn;
  try {
    fn = new Function('P', 't', 'Math',
      '"use strict"; return (' + String(exprString) + ');');
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  const t = (opts.t != null) ? opts.t : (performance.now() / 1000);
  const P = { x: 0, y: 0, z: 0 };
  let changed = 0;
  try {
    for (let i = 0; i < pos.count; i++) {
      P.x = pos.getX(i); P.y = pos.getY(i); P.z = pos.getZ(i);
      const r = fn(P, t, MATH_SAFE);
      if (typeof r === 'number') { pos.setX(i, r); changed++; }
      else if (Array.isArray(r) && r.length === 3) { pos.setXYZ(i, r[0], r[1], r[2]); changed++; }
      else if (r && typeof r === 'object' && 'x' in r) { pos.setXYZ(i, r.x, r.y, r.z); changed++; }
    }
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  pos.needsUpdate = true;
  g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
  mesh.userData.archdiscStudioVexExpr = (mesh.userData.archdiscStudioVexExpr || 0) + 1;
  return { ok: true, changed, expr: exprString };
}

function runGrasshopper(graph) {
  const nodes = (graph && graph.nodes) || [];
  const wires = (graph && graph.wires) || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map();
  const deps = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const w of wires) {
    const [s, sp] = w.from.split('.'); const [d, dp] = w.to.split('.');
    if (!byId.has(s) || !byId.has(d)) return { ok: false, error: `bad wire ${w.from}->${w.to}` };
    deps.get(d).add(s);
    const inc = incoming.get(d) || {}; inc[dp] = { srcId: s, srcPort: sp || 'out' };
    incoming.set(d, inc);
  }
  const order = []; const visited = new Set(); const temp = new Set();
  const visit = (id) => {
    if (temp.has(id)) throw new Error('cycle');
    if (visited.has(id)) return;
    temp.add(id);
    for (const d of deps.get(id)) visit(d);
    temp.delete(id); visited.add(id); order.push(id);
  };
  try { for (const n of nodes) visit(n.id); } catch (e) { return { ok: false, error: e.message }; }
  const OPS = {
    number:   (p) => p.value,
    add:      (_, i) => (i.a == null ? 0 : i.a) + (i.b == null ? 0 : i.b),
    multiply: (_, i) => (i.a == null ? 1 : i.a) * (i.b == null ? 1 : i.b),
    point:    (p, i) => [i.x == null ? (p.x || 0) : i.x, i.y == null ? (p.y || 0) : i.y, i.z == null ? (p.z || 0) : i.z],
    translate:(p, i) => {
      const pt = i.point || [0, 0, 0];
      const d = i.delta || p.delta || [0, 0, 0];
      return [pt[0] + d[0], pt[1] + d[1], pt[2] + d[2]];
    },
    spawnPoints: (p, i) => {
      const pts = i.points || p.points || [];
      const s = scene(); if (!s) return { value: null };
      const geom = new THREE.BufferGeometry();
      const arr = new Float32Array(pts.length * 3);
      for (let k = 0; k < pts.length; k++) {
        arr[k * 3] = pts[k][0]; arr[k * 3 + 1] = pts[k][1]; arr[k * 3 + 2] = pts[k][2];
      }
      geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const mat = new THREE.PointsMaterial({ color: 0xff66aa, size: 0.06, sizeAttenuation: true });
      const obj = new THREE.Points(geom, mat);
      obj.userData.archdiscStudioPrimitive = true;
      obj.userData.archdiscStudioPrimitiveKind = 'grasshopper-points';
      obj.userData.pickable = true;
      obj.name = 'studio-grasshopper-points';
      s.add(obj);
      return { value: pts, spawnedUuid: obj.uuid };
    },
  };
  const out = new Map();
  let spawned = null;
  for (const id of order) {
    const n = byId.get(id);
    const ins = {};
    const inc = incoming.get(id) || {};
    for (const k of Object.keys(inc)) ins[k] = out.get(inc[k].srcId);
    const fn = OPS[n.type];
    if (!fn) { out.set(id, null); continue; }
    const r = fn(n.params || {}, ins);
    if (r && typeof r === 'object' && 'value' in r && !Array.isArray(r)) {
      out.set(id, r.value);
      if (r.spawnedUuid) spawned = r.spawnedUuid;
    } else { out.set(id, r); }
  }
  return {
    ok: true,
    nodes: order.map((id) => ({ id, type: byId.get(id).type, output: out.get(id) })),
    spawned,
  };
}

async function runTaskGraph(graph) {
  const tasks = (graph && graph.tasks) || [];
  if (!tasks.length) return { ok: true, tasks: [] };
  const ids = new Set(tasks.map((t) => t.id));
  const deps = new Map(tasks.map((t) => [t.id, (t.dependsOn || []).filter((d) => ids.has(d))]));
  const done = new Set();
  const results = new Map();
  const OPS = {
    wait: (p) => new Promise((r) => setTimeout(() => r({ waited: (p && p.ms) | 0 }), (p && p.ms) | 0)),
    spawn: (p) => {
      const kind = (p && p.kind) || 'cube';
      const s = scene(); if (!s) return { error: 'no scene' };
      const m = spawnPrimitive(kind, s);
      return { uuid: m && m.uuid, kind };
    },
    bakeAOToTexture: (p) => window.__studioBakeAOToTexture && window.__studioBakeAOToTexture((p && p.size) || 64, p && p.rays),
    screenshot: () => {
      const vp = window.__archdiscViewport;
      if (!vp || !vp.renderer) return { len: 0 };
      const url = vp.renderer.domElement.toDataURL();
      return { len: url.length, mime: url.slice(5, url.indexOf(';')) };
    },
  };
  while (done.size < tasks.length) {
    const ready = tasks.filter((t) => !done.has(t.id) && deps.get(t.id).every((d) => done.has(d)));
    if (!ready.length) {
      for (const t of tasks) if (!done.has(t.id)) {
        results.set(t.id, { id: t.id, op: t.op, status: 'skipped', error: 'cycle or missing dep', ms: 0 });
        done.add(t.id);
      }
      break;
    }
    await Promise.all(ready.map(async (t) => {
      const failedDep = (deps.get(t.id) || []).some((d) => results.get(d) && results.get(d).status !== 'ok');
      if (failedDep) {
        results.set(t.id, { id: t.id, op: t.op, status: 'skipped', error: 'dep failed', ms: 0 });
      } else {
        const fn = OPS[t.op];
        if (!fn) { results.set(t.id, { id: t.id, op: t.op, status: 'error', error: 'unknown op', ms: 0 }); return; }
        const t0 = performance.now();
        try {
          const r = await fn(t.params || {});
          results.set(t.id, { id: t.id, op: t.op, status: 'ok', result: r, ms: performance.now() - t0 });
        } catch (e) {
          results.set(t.id, { id: t.id, op: t.op, status: 'error', error: String(e && e.message || e), ms: performance.now() - t0 });
        }
      }
      done.add(t.id);
    }));
  }
  return { ok: true, tasks: tasks.map((t) => results.get(t.id)) };
}

export function registerScriptOps() {
  window.__studioRunVexExpr     = runVexExpr;
  window.__studioRunGrasshopper = runGrasshopper;
  window.__studioRunTaskGraph   = runTaskGraph;
}

export function unregisterScriptOps() {
  for (const k of ['__studioRunVexExpr', '__studioRunGrasshopper', '__studioRunTaskGraph']) {
    try { delete window[k]; } catch (_) {}
  }
}
