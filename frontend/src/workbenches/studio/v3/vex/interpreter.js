// ArchDisc Studio V3 — ASL AST interpreter.
//
// Pure-JS tree walk. No `eval`, no `new Function`, no string concat
// into code. Each call to `evalBlock(ast, env)` mutates `env.pos` if
// the script assigns to `pos` (the only sanctioned output). Returns the
// final `env.pos` so the runner can write back without copying the
// scope itself.
//
// `env` shape (caller-allocated, reused per vertex for speed):
//   {
//     pos:   { x, y, z },         // per-vertex position (in & out)
//     nor:   { x, y, z },         // per-vertex normal (read-only)
//     idx:   <number>,            // vertex index
//     count: <number>,            // total vertex count
//     vars:  Object               // per-execution scratch (locals)
//   }
//
// Built-in functions are white-listed below. Adding a new one is a
// one-line append to BUILTINS — and they MUST be pure-numeric. No
// random sources (so scripts are deterministic + screenshot-diffable
// across runs). For a noise-style displacement we instead expose a
// hashed-position helper `noise(x, y, z)` that runs a 3-axis
// integer-hash sin mix — deterministic for the same vertex.

// ── White-listed scalar built-ins ────────────────────────────────────
const HASH_SEED = 0x9e3779b1; // golden-ratio fractional; chosen for spread.

function hash3(x, y, z) {
  // Cheap deterministic 32-bit-ish hash → [0, 1). No Math.random; the
  // same (x, y, z) always returns the same value, which keeps the
  // "noise-displace" example reproducible across runs / cameras.
  let h = HASH_SEED;
  h = Math.imul(h ^ Math.imul(Math.floor(x * 1000.001), 0x85ebca6b), 0xc2b2ae35) | 0;
  h = Math.imul(h ^ Math.imul(Math.floor(y * 1000.001), 0xc2b2ae35), 0x85ebca6b) | 0;
  h = Math.imul(h ^ Math.imul(Math.floor(z * 1000.001), 0x27d4eb2f), 0x165667b1) | 0;
  h ^= h >>> 16;
  return ((h >>> 0) % 1000003) / 1000003;
}

const BUILTINS = Object.freeze({
  sin:   (a) => Math.sin(a),
  cos:   (a) => Math.cos(a),
  tan:   (a) => Math.tan(a),
  abs:   (a) => Math.abs(a),
  sqrt:  (a) => Math.sqrt(a),
  pow:   (a, b) => Math.pow(a, b),
  floor: (a) => Math.floor(a),
  ceil:  (a) => Math.ceil(a),
  round: (a) => Math.round(a),
  min:   (a, b) => Math.min(a, b),
  max:   (a, b) => Math.max(a, b),
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  // Deterministic, position-driven pseudo-noise. Not a Perlin/Simplex —
  // a one-octave integer hash. Sufficient for the noise-displace demo.
  noise: (x, y, z) => hash3(x, y, z),
});

const BUILTIN_ARITY = Object.freeze({
  sin: 1, cos: 1, tan: 1, abs: 1, sqrt: 1,
  pow: 2, floor: 1, ceil: 1, round: 1,
  min: 2, max: 2, clamp: 3, noise: 3,
});

class RuntimeError extends Error {
  constructor(msg, line, col) {
    super(msg);
    this.name = 'RuntimeError';
    this.line = line || 1;
    this.col = col || 1;
  }
}

// ── Expression evaluation ────────────────────────────────────────────

function evalExpr(node, env) {
  switch (node.type) {
    case 'Number':   return node.value;

    case 'Variable':
      return readVar(node.name, env, node.line, node.col);

    case 'MemberAccess':
      return readMember(node.name, node.member, env, node.line, node.col);

    case 'UnaryOp': {
      const v = evalExpr(node.arg, env);
      if (node.op === '-') {
        if (Array.isArray(v)) return [-v[0], -v[1], -v[2]];
        return -v;
      }
      if (node.op === '+') return v;
      throw new RuntimeError(`unknown unary op ${node.op}`, node.line, node.col);
    }

    case 'BinaryOp': {
      const a = evalExpr(node.lhs, env);
      const b = evalExpr(node.rhs, env);
      return applyBinOp(node.op, a, b, node.line, node.col);
    }

    case 'Call': {
      const fn = BUILTINS[node.name];
      if (!fn) throw new RuntimeError(`unknown function "${node.name}"`, node.line, node.col);
      const wantArity = BUILTIN_ARITY[node.name];
      if (node.args.length !== wantArity) {
        throw new RuntimeError(
          `function "${node.name}" expects ${wantArity} arg(s), got ${node.args.length}`,
          node.line, node.col,
        );
      }
      const argVals = node.args.map((a) => evalExpr(a, env));
      // Any vec args must be reduced to scalars — we don't auto-broadcast.
      for (let k = 0; k < argVals.length; k++) {
        if (Array.isArray(argVals[k])) {
          throw new RuntimeError(
            `function "${node.name}" arg ${k + 1} must be a scalar`,
            node.line, node.col,
          );
        }
      }
      return fn(...argVals);
    }

    case 'Vec3': {
      const x = evalExpr(node.x, env);
      const y = evalExpr(node.y, env);
      const z = evalExpr(node.z, env);
      if (Array.isArray(x) || Array.isArray(y) || Array.isArray(z)) {
        throw new RuntimeError('vec3 component must be scalar', node.line, node.col);
      }
      return [x, y, z];
    }

    default:
      throw new RuntimeError(`unknown expression node ${node.type}`, node.line, node.col);
  }
}

function applyBinOp(op, a, b, line, col) {
  // Scalar–scalar (the common path).
  if (!Array.isArray(a) && !Array.isArray(b)) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b === 0 ? NaN : a / b;
      case '<': return a <  b ? 1 : 0;
      case '<=':return a <= b ? 1 : 0;
      case '>': return a >  b ? 1 : 0;
      case '>=':return a >= b ? 1 : 0;
      case '==':return a === b ? 1 : 0;
      case '!=':return a !== b ? 1 : 0;
      default: throw new RuntimeError(`unknown binary op ${op}`, line, col);
    }
  }

  // Vec ⊕ scalar / vec ⊕ vec — only + − * / are supported.
  const av = Array.isArray(a) ? a : [a, a, a];
  const bv = Array.isArray(b) ? b : [b, b, b];
  switch (op) {
    case '+': return [av[0] + bv[0], av[1] + bv[1], av[2] + bv[2]];
    case '-': return [av[0] - bv[0], av[1] - bv[1], av[2] - bv[2]];
    case '*': return [av[0] * bv[0], av[1] * bv[1], av[2] * bv[2]];
    case '/': return [
      bv[0] === 0 ? NaN : av[0] / bv[0],
      bv[1] === 0 ? NaN : av[1] / bv[1],
      bv[2] === 0 ? NaN : av[2] / bv[2],
    ];
    default:
      throw new RuntimeError(`binary op ${op} not defined on vec3`, line, col);
  }
}

function readVar(name, env, line, col) {
  if (name === 'pos')   return [env.pos.x, env.pos.y, env.pos.z];
  if (name === 'nor')   return [env.nor.x, env.nor.y, env.nor.z];
  if (name === 'idx')   return env.idx;
  if (name === 'count') return env.count;
  if (Object.prototype.hasOwnProperty.call(env.vars, name)) return env.vars[name];
  throw new RuntimeError(`undefined variable "${name}"`, line, col);
}

function readMember(name, member, env, line, col) {
  if (name === 'pos') return env.pos[member];
  if (name === 'nor') return env.nor[member];
  const v = env.vars[name];
  if (v === undefined) throw new RuntimeError(`undefined variable "${name}"`, line, col);
  if (Array.isArray(v) && v.length === 3) {
    if (member === 'x') return v[0];
    if (member === 'y') return v[1];
    if (member === 'z') return v[2];
  }
  if (v && typeof v === 'object' && member in v) return v[member];
  throw new RuntimeError(`cannot read .${member} from "${name}"`, line, col);
}

// ── Statement evaluation ─────────────────────────────────────────────

function execStmt(stmt, env) {
  switch (stmt.type) {
    case 'Assign': {
      const v = evalExpr(stmt.value, env);
      assignTarget(stmt.target, v, env, stmt.line, stmt.col);
      return;
    }
    case 'If': {
      const c = evalExpr(stmt.cond, env);
      const truthy = Array.isArray(c) ? (c[0] !== 0 || c[1] !== 0 || c[2] !== 0) : !!c;
      if (truthy) execStmt(stmt.then, env);
      return;
    }
    case 'ExprStmt':
      // Evaluate purely for its side-effects (none in ASL today —
      // every interesting effect is via an Assign — but kept so the
      // grammar feels natural in the editor).
      evalExpr(stmt.expr, env);
      return;
    case 'Block':
      for (let k = 0; k < stmt.body.length; k++) execStmt(stmt.body[k], env);
      return;
    default:
      throw new RuntimeError(`unknown statement ${stmt.type}`, stmt.line, stmt.col);
  }
}

function assignTarget(target, value, env, line, col) {
  if (target.kind === 'name') {
    if (target.name === 'pos') {
      // Whole-vector assignment.
      if (!Array.isArray(value) || value.length !== 3) {
        throw new RuntimeError('pos = ... requires a vec3', line, col);
      }
      env.pos.x = value[0]; env.pos.y = value[1]; env.pos.z = value[2];
      return;
    }
    if (target.name === 'nor' || target.name === 'idx' || target.name === 'count') {
      throw new RuntimeError(`cannot assign to read-only "${target.name}"`, line, col);
    }
    // Local — either scalar or vec3.
    env.vars[target.name] = value;
    return;
  }
  if (target.kind === 'member') {
    if (target.name === 'pos') {
      if (Array.isArray(value)) {
        throw new RuntimeError(`pos.${target.member} = ... requires a scalar`, line, col);
      }
      env.pos[target.member] = value;
      return;
    }
    if (target.name === 'nor') {
      throw new RuntimeError(`cannot assign to read-only "nor.${target.member}"`, line, col);
    }
    // Local vec.member assignment — only if the local is a vec3.
    const v = env.vars[target.name];
    if (!Array.isArray(v) || v.length !== 3) {
      throw new RuntimeError(`"${target.name}" is not a vec3`, line, col);
    }
    if (target.member === 'x') v[0] = value;
    else if (target.member === 'y') v[1] = value;
    else if (target.member === 'z') v[2] = value;
    return;
  }
  throw new RuntimeError(`unknown assignment target`, line, col);
}

// ── Public surface ───────────────────────────────────────────────────

/**
 * Create a reusable per-vertex environment object.
 */
export function makeEnv() {
  return {
    pos: { x: 0, y: 0, z: 0 },
    nor: { x: 0, y: 0, z: 0 },
    idx: 0,
    count: 0,
    vars: Object.create(null),
  };
}

/**
 * Execute a parsed AST block against a per-vertex env.
 * Mutates env.pos in place. Returns the env unchanged (for chaining).
 * Throws RuntimeError on user-script errors so the caller can attach
 * line/col context.
 */
export function evalBlock(ast, env) {
  // Reset locals between vertices so cross-vertex bleed can't happen.
  env.vars = Object.create(null);
  execStmt(ast, env);
  return env;
}

export { BUILTINS, RuntimeError };
