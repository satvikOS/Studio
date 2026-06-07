// ArchDisc Studio V3 — driver expression system (slice 812).
import { registerOps } from '../common/registry.js';
let _installed = false;
const _drivers = [];
// Safe expression evaluator (no eval/Function): supports +, -, *, /, parens, numeric literals, single variable `v`.
function _evalExpr(expr, v) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === ' ') { i++; continue; }
    if (c === 'v') { tokens.push({ kind: 'NUM', value: v }); i++; continue; }
    if ('+-*/()'.includes(c)) { tokens.push({ kind: c }); i++; continue; }
    if (/[0-9.]/.test(c)) {
      let s = '';
      while (i < expr.length && /[0-9.eE\-+]/.test(expr[i])) { s += expr[i++]; if (expr[i - 1] === 'e' || expr[i - 1] === 'E') continue; if ((expr[i] === '+' || expr[i] === '-') && (expr[i - 1] !== 'e' && expr[i - 1] !== 'E')) break; }
      tokens.push({ kind: 'NUM', value: Number(s) });
      continue;
    }
    i++;
  }
  let p = 0;
  function parseExpr() {
    let left = parseTerm();
    while (p < tokens.length && (tokens[p].kind === '+' || tokens[p].kind === '-')) {
      const op = tokens[p++].kind;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function parseTerm() {
    let left = parseFactor();
    while (p < tokens.length && (tokens[p].kind === '*' || tokens[p].kind === '/')) {
      const op = tokens[p++].kind;
      const right = parseFactor();
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }
  function parseFactor() {
    const t = tokens[p];
    if (!t) return 0;
    if (t.kind === '(') { p++; const v = parseExpr(); if (tokens[p]?.kind === ')') p++; return v; }
    if (t.kind === '-') { p++; return -parseFactor(); }
    if (t.kind === 'NUM') { p++; return t.value; }
    p++; return 0;
  }
  return parseExpr();
}
function _readProp(o, prop) {
  if (!o || !prop) return 0;
  const path = prop.split('.');
  let cur = o;
  for (const p of path) cur = cur?.[p];
  return typeof cur === 'number' ? cur : 0;
}
function _writeProp(o, prop, val) {
  if (!o || !prop) return;
  const path = prop.split('.');
  let cur = o;
  for (let i = 0; i < path.length - 1; i++) cur = cur?.[path[i]];
  if (cur) cur[path[path.length - 1]] = val;
}
function _tick() {
  const scene = window.__archdiscScene;
  if (!scene) return;
  for (const d of _drivers) {
    const src = scene.getObjectByProperty('uuid', d.sourceUuid);
    const tgt = scene.getObjectByProperty('uuid', d.targetUuid);
    if (!src || !tgt) continue;
    const v = _readProp(src, d.sourceProp);
    const out = _evalExpr(d.expression, v);
    _writeProp(tgt, d.targetProp, out);
  }
}
export function installDrivers() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioDriverAdd: ({ sourceUuid, sourceProp, targetUuid, targetProp, expression } = {}) => {
      const id = `drv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      _drivers.push({ id, sourceUuid, sourceProp, targetUuid, targetProp, expression: String(expression || 'v') });
      return { ok: true, id };
    },
    __studioDriverRemove: ({ id } = {}) => {
      const idx = _drivers.findIndex((d) => d.id === id);
      if (idx >= 0) _drivers.splice(idx, 1);
      return { ok: true };
    },
    __studioDriverList: () => ({ ok: true, drivers: _drivers.slice() }),
    __studioDriverTick: () => { _tick(); return { ok: true, count: _drivers.length }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'anim', 'Driver expression system');
  return { ok: true };
}
export default installDrivers;
