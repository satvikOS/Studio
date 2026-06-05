// ArchDisc Studio V3 — Blender-style Drivers.
//
// A "driver" forces one mesh property (the *target*) to follow an
// arbitrary expression of another mesh property (the *source*). Every
// frame, the driver tick reads the source value, evaluates the
// expression with the source value bound to the variable `a`, and
// writes the result into the target property.
//
// Examples (using Blender's mental model):
//     target = a * 2                 — scaled copy of source
//     target = sin(a)                — oscillator slaved to source
//     target = clamp(a, 0, 1)        — limit range
//     target = if a > 0.5 1 0        — boolean-style switch
//
// SAFETY: the expression is parsed by a tiny recursive-descent parser
// (no `eval`, no `new Function`, no `Function.constructor` — every
// dynamic-code path is forbidden by the slice brief). The whitelist is:
//   • operators: + - * /
//   • comparisons (only inside `if`): > < >= <= == !=
//   • functions: sin cos clamp min max
//   • keyword: if (ternary-style `if a > b then else`)
//   • identifiers: lowercase variable names bound by the host
//   • numeric literals (decimals + exponents)
//   • grouping: ( )  and argument separator ,
//
// All numeric output, never strings. Bad input throws a parse error
// that bubbles up to the registering op, which surfaces it to the user.
//
// Hooking pattern matches the rest of V3 — we chain into
// window.__archdiscViewport.__studioAnimTick under a unique guard
// (`__animAdvDrivers`) so audit code can see the pipeline.

// ─── State ───────────────────────────────────────────────────────────
const _drivers = new Map();  // uuid → driver
let _seq = 1;
function _uuid() {
  _seq += 1;
  return `animadv-drv-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

const _CHAN = { x: 0, y: 1, z: 2 };
const _CHAN_NAMES = ['x', 'y', 'z'];

// ─── Lexer ───────────────────────────────────────────────────────────
//
// Returns a flat array of { kind, value, pos } tokens. kind ∈
//   'num' | 'id' | 'op' | 'lp' | 'rp' | 'comma' | 'cmp'
//
// Anything outside the whitelist (`%`, `&`, `^`, string literals,
// semicolons, etc.) throws a SyntaxError with the column index so the
// editor can highlight the offending character.

const _WORD_FUNCS = new Set(['sin', 'cos', 'clamp', 'min', 'max']);
const _WORD_KEYWORDS = new Set(['if']);

function _tokenize(src) {
  const s = String(src || '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i += 1; continue; }
    if (c >= '0' && c <= '9' || (c === '.' && s[i + 1] >= '0' && s[i + 1] <= '9')) {
      // Numeric literal — optional decimal + optional exponent.
      let j = i;
      while (j < s.length && (s[j] >= '0' && s[j] <= '9' || s[j] === '.')) j += 1;
      if (s[j] === 'e' || s[j] === 'E') {
        j += 1;
        if (s[j] === '+' || s[j] === '-') j += 1;
        while (j < s.length && s[j] >= '0' && s[j] <= '9') j += 1;
      }
      const num = Number(s.slice(i, j));
      if (!Number.isFinite(num)) throw new SyntaxError(`bad number at ${i}`);
      out.push({ kind: 'num', value: num, pos: i });
      i = j;
      continue;
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i;
      while (j < s.length && (
        (s[j] >= 'a' && s[j] <= 'z') ||
        (s[j] >= 'A' && s[j] <= 'Z') ||
        (s[j] >= '0' && s[j] <= '9') ||
        s[j] === '_'
      )) j += 1;
      out.push({ kind: 'id', value: s.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      out.push({ kind: 'op', value: c, pos: i });
      i += 1;
      continue;
    }
    if (c === '(') { out.push({ kind: 'lp', value: '(', pos: i }); i += 1; continue; }
    if (c === ')') { out.push({ kind: 'rp', value: ')', pos: i }); i += 1; continue; }
    if (c === ',') { out.push({ kind: 'comma', value: ',', pos: i }); i += 1; continue; }
    if (c === '>' || c === '<' || c === '=' || c === '!') {
      const next = s[i + 1];
      if (next === '=') {
        out.push({ kind: 'cmp', value: c + '=', pos: i });
        i += 2;
        continue;
      }
      if (c === '>' || c === '<') {
        out.push({ kind: 'cmp', value: c, pos: i });
        i += 1;
        continue;
      }
      if (c === '=' && next === '=') {
        out.push({ kind: 'cmp', value: '==', pos: i });
        i += 2;
        continue;
      }
      throw new SyntaxError(`unexpected '${c}' at ${i}`);
    }
    throw new SyntaxError(`illegal char '${c}' at ${i}`);
  }
  return out;
}

// ─── Parser ──────────────────────────────────────────────────────────
//
// Grammar (recursive descent, all whitelisted):
//
//   expr   = ifExpr
//   ifExpr = 'if' addExpr cmp addExpr addExpr addExpr     // ternary
//          | addExpr
//   addExpr = mulExpr (('+' | '-') mulExpr)*
//   mulExpr = unary    (('*' | '/') unary)*
//   unary  = '-' unary | atom
//   atom   = number | id | id '(' args ')' | '(' expr ')'
//   args   = expr (',' expr)*
//
// Output: an AST node ({ kind, ... }). Eval walks the tree against a
// `vars` object the host supplies. No closures, no `this`, no strings.

function _parse(tokens) {
  let pos = 0;
  function peek() { return tokens[pos]; }
  function consume() { return tokens[pos++]; }
  function expect(kind, value) {
    const t = tokens[pos];
    if (!t || t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new SyntaxError(`expected ${kind}${value !== undefined ? `('${value}')` : ''} at ${t ? t.pos : 'EOF'}`);
    }
    pos += 1;
    return t;
  }

  function parseExpr() { return parseIf(); }

  function parseIf() {
    const t = peek();
    if (t && t.kind === 'id' && t.value === 'if' && _WORD_KEYWORDS.has(t.value)) {
      consume();
      const left = parseAdd();
      const cmpTok = peek();
      if (!cmpTok || cmpTok.kind !== 'cmp') {
        throw new SyntaxError(`'if' needs a comparison at ${cmpTok ? cmpTok.pos : 'EOF'}`);
      }
      consume();
      const right = parseAdd();
      const thenE = parseAdd();
      const elseE = parseAdd();
      return { kind: 'if', op: cmpTok.value, a: left, b: right, then: thenE, else: elseE };
    }
    return parseAdd();
  }

  function parseAdd() {
    let left = parseMul();
    while (true) {
      const t = peek();
      if (!t || t.kind !== 'op' || (t.value !== '+' && t.value !== '-')) break;
      consume();
      const right = parseMul();
      left = { kind: 'bin', op: t.value, a: left, b: right };
    }
    return left;
  }

  function parseMul() {
    let left = parseUnary();
    while (true) {
      const t = peek();
      if (!t || t.kind !== 'op' || (t.value !== '*' && t.value !== '/')) break;
      consume();
      const right = parseUnary();
      left = { kind: 'bin', op: t.value, a: left, b: right };
    }
    return left;
  }

  function parseUnary() {
    const t = peek();
    if (t && t.kind === 'op' && t.value === '-') {
      consume();
      return { kind: 'neg', a: parseUnary() };
    }
    if (t && t.kind === 'op' && t.value === '+') {
      consume();
      return parseUnary();
    }
    return parseAtom();
  }

  function parseAtom() {
    const t = peek();
    if (!t) throw new SyntaxError('unexpected EOF');
    if (t.kind === 'num') { consume(); return { kind: 'num', value: t.value }; }
    if (t.kind === 'lp') {
      consume();
      const e = parseExpr();
      expect('rp');
      return e;
    }
    if (t.kind === 'id') {
      consume();
      const after = peek();
      if (after && after.kind === 'lp') {
        // function call.
        if (!_WORD_FUNCS.has(t.value)) {
          throw new SyntaxError(`unknown function '${t.value}' at ${t.pos}`);
        }
        consume();
        const args = [];
        if (peek() && peek().kind !== 'rp') {
          args.push(parseExpr());
          while (peek() && peek().kind === 'comma') {
            consume();
            args.push(parseExpr());
          }
        }
        expect('rp');
        return { kind: 'call', name: t.value, args };
      }
      // identifier reference.
      if (_WORD_KEYWORDS.has(t.value)) {
        throw new SyntaxError(`keyword '${t.value}' used as variable at ${t.pos}`);
      }
      return { kind: 'var', name: t.value };
    }
    throw new SyntaxError(`unexpected ${t.kind} at ${t.pos}`);
  }

  const ast = parseExpr();
  if (pos !== tokens.length) {
    const t = tokens[pos];
    throw new SyntaxError(`trailing tokens at ${t.pos}`);
  }
  return ast;
}

// ─── Evaluator ───────────────────────────────────────────────────────
function _eval(node, vars) {
  if (!node) return 0;
  switch (node.kind) {
    case 'num': return node.value;
    case 'var': {
      const v = vars[node.name];
      return Number.isFinite(v) ? v : 0;
    }
    case 'neg': return -_eval(node.a, vars);
    case 'bin': {
      const a = _eval(node.a, vars);
      const b = _eval(node.b, vars);
      if (node.op === '+') return a + b;
      if (node.op === '-') return a - b;
      if (node.op === '*') return a * b;
      if (node.op === '/') {
        if (b === 0) return 0;  // safe divide — Blender returns 0 too
        return a / b;
      }
      return 0;
    }
    case 'call': {
      const args = node.args.map((a) => _eval(a, vars));
      switch (node.name) {
        case 'sin': return Math.sin(args[0] || 0);
        case 'cos': return Math.cos(args[0] || 0);
        case 'min': return args.length ? Math.min.apply(null, args) : 0;
        case 'max': return args.length ? Math.max.apply(null, args) : 0;
        case 'clamp': {
          const v = args[0] || 0;
          const lo = args[1] || 0;
          const hi = args[2] || 0;
          return Math.max(lo, Math.min(hi, v));
        }
        default: return 0;
      }
    }
    case 'if': {
      const a = _eval(node.a, vars);
      const b = _eval(node.b, vars);
      let cond = false;
      switch (node.op) {
        case '>':  cond = a >  b; break;
        case '<':  cond = a <  b; break;
        case '>=': cond = a >= b; break;
        case '<=': cond = a <= b; break;
        case '==': cond = a === b; break;
        case '!=': cond = a !== b; break;
        default: cond = false;
      }
      return cond ? _eval(node.then, vars) : _eval(node.else, vars);
    }
    default: return 0;
  }
}

/**
 * Compile an expression into a callable `(vars) → number`. Throws on
 * syntax errors. Pure — no globals, no side effects.
 */
export function compileExpression(src) {
  const tokens = _tokenize(src);
  if (!tokens.length) throw new SyntaxError('empty expression');
  const ast = _parse(tokens);
  return (vars) => {
    const out = _eval(ast, vars || {});
    return Number.isFinite(out) ? out : 0;
  };
}

// ─── Mesh + property helpers ─────────────────────────────────────────
function _resolveMesh(uuid) {
  if (typeof window === 'undefined') return null;
  const scene = window.__archdiscScene;
  if (scene && typeof scene.getObjectByProperty === 'function') {
    const m = scene.getObjectByProperty('uuid', uuid);
    if (m) return m;
  }
  const vp = window.__archdiscViewport;
  if (vp && vp.scene && typeof vp.scene.getObjectByProperty === 'function') {
    const m = vp.scene.getObjectByProperty('uuid', uuid);
    if (m) return m;
  }
  return null;
}

/**
 * Parse "position.y" / "scale.x" / "rotation.z" into a (prop, channel)
 * pair. Returns null on malformed input.
 */
export function parsePropertyPath(path) {
  if (!path || typeof path !== 'string') return null;
  const dot = path.indexOf('.');
  if (dot < 0) return null;
  const prop = path.slice(0, dot);
  const chRaw = path.slice(dot + 1);
  if (prop !== 'position' && prop !== 'rotation' && prop !== 'scale') return null;
  const ch = _CHAN[chRaw];
  if (ch === undefined) return null;
  return { property: prop, channel: ch };
}

function _readMesh(mesh, prop, channel) {
  if (!mesh) return 0;
  const ch = _CHAN_NAMES[channel] || 'x';
  if (prop === 'position' && mesh.position) return mesh.position[ch];
  if (prop === 'scale' && mesh.scale) return mesh.scale[ch];
  if (prop === 'rotation' && mesh.rotation) return mesh.rotation[ch];
  return 0;
}

function _writeMesh(mesh, prop, channel, value) {
  if (!mesh) return false;
  const ch = _CHAN_NAMES[channel] || 'x';
  if (prop === 'position' && mesh.position) { mesh.position[ch] = value; return true; }
  if (prop === 'scale' && mesh.scale) { mesh.scale[ch] = value; return true; }
  if (prop === 'rotation' && mesh.rotation) { mesh.rotation[ch] = value; return true; }
  return false;
}

// ─── Registry ────────────────────────────────────────────────────────
/**
 * Register a new driver.
 *
 *   target = expr(a, t)
 *
 * @param {object} cfg
 *   targetMeshUuid : mesh whose property is *written*
 *   targetProperty : 'position.y' / 'rotation.z' / etc.
 *   sourceMeshUuid : mesh whose property is *read* (bound to `a`)
 *   sourceProperty : 'position.x' / etc.
 *   expression     : whitelisted expression string
 */
export function addDriver(cfg) {
  const targetPath = parsePropertyPath(cfg.targetProperty);
  const sourcePath = parsePropertyPath(cfg.sourceProperty);
  if (!targetPath) return { ok: false, error: 'bad targetProperty' };
  if (!sourcePath) return { ok: false, error: 'bad sourceProperty' };
  let fn;
  try {
    fn = compileExpression(cfg.expression);
  } catch (e) {
    return { ok: false, error: `parse: ${e.message}` };
  }
  const d = {
    uuid: _uuid(),
    targetMeshUuid: String(cfg.targetMeshUuid || ''),
    targetProperty: cfg.targetProperty,
    targetProp: targetPath.property,
    targetChannel: targetPath.channel,
    sourceMeshUuid: String(cfg.sourceMeshUuid || cfg.targetMeshUuid || ''),
    sourceProperty: cfg.sourceProperty,
    sourceProp: sourcePath.property,
    sourceChannel: sourcePath.channel,
    expression: String(cfg.expression),
    enabled: true,
    fn,
  };
  _drivers.set(d.uuid, d);
  return { ok: true, uuid: d.uuid };
}

export function deleteDriver(uuid) {
  return { ok: _drivers.delete(uuid) };
}

export function enableDriver(uuid, on) {
  const d = _drivers.get(uuid);
  if (!d) return { ok: false, error: 'unknown driver' };
  d.enabled = !!on;
  return { ok: true, enabled: d.enabled };
}

export function listDrivers() {
  const out = [];
  _drivers.forEach((d) => out.push({
    uuid: d.uuid,
    targetMeshUuid: d.targetMeshUuid,
    targetProperty: d.targetProperty,
    sourceMeshUuid: d.sourceMeshUuid,
    sourceProperty: d.sourceProperty,
    expression: d.expression,
    enabled: d.enabled,
  }));
  return out;
}

export function getDriver(uuid) {
  return _drivers.get(uuid) || null;
}

export function clearDrivers() {
  _drivers.clear();
}

export function driverCount() { return _drivers.size; }

/**
 * Sweep every enabled driver: read source, evaluate, write target.
 * Returns the number of writes that actually happened (target mesh
 * exists + property is settable).
 *
 * `time` is forwarded into the expression as `t` so users can write
 *     `sin(t) * 0.2`
 * driven motion that doesn't depend on a source.
 */
export function applyAllDrivers(time) {
  let n = 0;
  const t = Number.isFinite(time) ? time : 0;
  _drivers.forEach((d) => {
    if (!d.enabled) return;
    const src = _resolveMesh(d.sourceMeshUuid);
    const tgt = _resolveMesh(d.targetMeshUuid);
    if (!tgt) return;
    const a = src ? _readMesh(src, d.sourceProp, d.sourceChannel) : 0;
    let v;
    try {
      v = d.fn({ a, t });
    } catch (_) {
      v = 0;
    }
    if (!Number.isFinite(v)) v = 0;
    if (_writeMesh(tgt, d.targetProp, d.targetChannel, v)) n += 1;
  });
  return n;
}

// ─── Tick install ────────────────────────────────────────────────────
let _tickInstalled = false;

/**
 * Hook applyAllDrivers into the viewport's per-frame chain. Idempotent.
 */
export function installDriverTick() {
  if (typeof window === 'undefined') return false;
  const v = window.__archdiscViewport;
  if (!v) return false;
  if (v.__studioAnimTick && v.__studioAnimTick.__animAdvDrivers) {
    _tickInstalled = true;
    return true;
  }
  const prev = v.__studioAnimTick;
  const fn = (now) => {
    const tSec = (typeof now === 'number' ? now : 0) / 1000;
    try { applyAllDrivers(tSec); } catch (_) { /* swallow */ }
    if (prev) {
      try { prev(now); } catch (_) { /* swallow */ }
    }
  };
  fn.__animAdvDrivers = true;
  fn.__prev = prev;
  v.__studioAnimTick = fn;
  _tickInstalled = true;
  return true;
}

export function uninstallDriverTick() {
  if (typeof window === 'undefined') return false;
  const v = window.__archdiscViewport;
  if (!v) return false;
  // Walk the chain and splice out our node.
  if (v.__studioAnimTick && v.__studioAnimTick.__animAdvDrivers) {
    v.__studioAnimTick = v.__studioAnimTick.__prev || null;
    _tickInstalled = false;
    return true;
  }
  // Nested removal — splice from the middle.
  let head = v.__studioAnimTick;
  while (head && head.__prev) {
    if (head.__prev.__animAdvDrivers) {
      head.__prev = head.__prev.__prev || null;
      _tickInstalled = false;
      return true;
    }
    head = head.__prev;
  }
  return false;
}

export function isDriverTickInstalled() { return _tickInstalled; }
