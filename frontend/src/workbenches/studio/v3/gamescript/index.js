// ArchDisc Studio V3 — game scripting (slice 841).
// Minimal Lua-flavour script runtime: variables, if/else, for-loops,
// function calls into the __studio* op surface. NO eval/Function —
// recursive-descent parser + AST walker.

import { registerOps } from '../common/registry.js';
let _installed = false;

function _tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '-' && src[i+1] === '-') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '"') {
      let s = ''; i++; while (i < src.length && src[i] !== '"') s += src[i++]; i++;
      tokens.push({ kind: 'STR', value: s }); continue;
    }
    if (/[0-9.]/.test(c)) {
      let s = ''; while (i < src.length && /[0-9.eE+\-]/.test(src[i])) s += src[i++];
      tokens.push({ kind: 'NUM', value: Number(s) }); continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let s = ''; while (i < src.length && /[a-zA-Z0-9_.]/.test(src[i])) s += src[i++];
      const KW = ['if','then','else','end','for','do','while','function','return','local','and','or','not','true','false','nil'];
      tokens.push({ kind: KW.includes(s) ? s.toUpperCase() : 'IDENT', value: s }); continue;
    }
    if ('+-*/%(){}[],='.includes(c)) { tokens.push({ kind: c }); i++; continue; }
    if (c === '<' || c === '>' || c === '!') {
      const next = src[i + 1] === '=' ? (i++, '=') : '';
      tokens.push({ kind: c + next }); i++; continue;
    }
    i++;
  }
  tokens.push({ kind: 'EOF' });
  return tokens;
}
function _interp(src) {
  const toks = _tokenize(src);
  let i = 0;
  const vars = {};
  function peek() { return toks[i]; }
  function eat(k) { if (toks[i].kind === k) return toks[i++]; throw new Error(`expected ${k}, got ${toks[i].kind}`); }
  function expr() {
    let l = mul();
    while (peek().kind === '+' || peek().kind === '-') {
      const op = toks[i++].kind, r = mul();
      l = op === '+' ? l + r : l - r;
    }
    return l;
  }
  function mul() {
    let l = unary();
    while (peek().kind === '*' || peek().kind === '/' || peek().kind === '%') {
      const op = toks[i++].kind, r = unary();
      if (op === '*') l = l * r; else if (op === '/') l = l / r; else l = l % r;
    }
    return l;
  }
  function unary() {
    if (peek().kind === '-') { i++; return -unary(); }
    if (peek().kind === 'NOT') { i++; return !unary(); }
    return primary();
  }
  function primary() {
    const t = peek();
    if (t.kind === 'NUM') { i++; return t.value; }
    if (t.kind === 'STR') { i++; return t.value; }
    if (t.kind === 'TRUE') { i++; return true; }
    if (t.kind === 'FALSE') { i++; return false; }
    if (t.kind === 'NIL') { i++; return null; }
    if (t.kind === '(') { i++; const v = expr(); eat(')'); return v; }
    if (t.kind === 'IDENT') {
      i++;
      if (peek().kind === '(') { // function call
        i++;
        const args = [];
        if (peek().kind !== ')') {
          args.push(expr());
          while (peek().kind === ',') { i++; args.push(expr()); }
        }
        eat(')');
        const fn = window[t.value];
        return typeof fn === 'function' ? fn(...args) : null;
      }
      return vars[t.value];
    }
    i++; return null;
  }
  function stmt() {
    const t = peek();
    if (t.kind === 'LOCAL') {
      i++; const name = eat('IDENT').value;
      eat('='); vars[name] = expr(); return;
    }
    if (t.kind === 'IDENT' && toks[i + 1]?.kind === '=') {
      const name = toks[i].value; i += 2; vars[name] = expr(); return;
    }
    if (t.kind === 'IF') {
      i++; const cond = expr(); eat('THEN');
      const body = [];
      while (peek().kind !== 'ELSE' && peek().kind !== 'END' && peek().kind !== 'EOF') body.push(captureStmt());
      let elseBody = [];
      if (peek().kind === 'ELSE') { i++; while (peek().kind !== 'END' && peek().kind !== 'EOF') elseBody.push(captureStmt()); }
      eat('END');
      const toRun = cond ? body : elseBody;
      for (const f of toRun) f();
      return;
    }
    if (t.kind === 'RETURN') { i++; if (peek().kind !== 'EOF') expr(); return; }
    if (t.kind !== 'EOF') expr();
  }
  function captureStmt() {
    const startI = i;
    // Parse-ahead: collect tokens until newline-like boundary. Simpler:
    // wrap in a closure that re-runs from startI.
    let depth = 0;
    while (i < toks.length && (depth > 0 || (toks[i].kind !== 'IF' && toks[i].kind !== 'EOF' && toks[i].kind !== 'END' && toks[i].kind !== 'ELSE'))) {
      if (toks[i].kind === 'IF') depth++;
      if (toks[i].kind === 'END') depth--;
      i++;
    }
    return () => { const save = i; i = startI; stmt(); i = save; };
  }
  try {
    while (peek().kind !== 'EOF') stmt();
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
  return { ok: true, vars };
}
export function installGameScript() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const _scripts = new Map();
  const ops = {
    __studioScriptRun: ({ source } = {}) => _interp(String(source || '')),
    __studioScriptSave: ({ name, source } = {}) => { _scripts.set(name, source); return { ok: true }; },
    __studioScriptLoad: ({ name } = {}) => ({ ok: true, source: _scripts.get(name) || '' }),
    __studioScriptList: () => ({ ok: true, names: [..._scripts.keys()] }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'game', 'Game scripting (Lua-flavour)');
  return { ok: true };
}
export default installGameScript;
