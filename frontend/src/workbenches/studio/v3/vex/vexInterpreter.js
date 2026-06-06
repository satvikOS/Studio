// ArchDisc Studio V3 — real Houdini VEX-flavour interpreter (slice 745).
//
// AST walker. Runs the program once per point against an env shape:
//   env = {
//     P:  [x,y,z],   // mutable read/write
//     N:  [x,y,z],   // read (write allowed but typically not used)
//     Cd: [r,g,b],   // mutable colour
//     id: int,
//     pt: int,       // point index
//     npt: int,      // total point count
//     locals: { name: { type, value } }
//   }
// Writes go back through env on completion.
//
// Built-ins curated for the Houdini POINT WRANGLE common subset:
//   sin cos tan asin acos atan2 sqrt pow exp log abs sign floor ceil round
//   min max clamp mix length normalize dot cross fit fit01 noise
//
// `noise(x [, y, z])` is a deterministic 1-3D value noise (no Perlin
// dep, no external table) — enough for parity claim.

import { VexParseError } from './vexLexer.js';

// ── vec3 helpers (no allocation in hot path: we mutate the result) ──

function v3clone(v) { return [v[0], v[1], v[2]]; }
function isVec(x) { return Array.isArray(x) && x.length === 3; }

function vadd(a, b) {
  if (isVec(a) && isVec(b)) return [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
  if (isVec(a)) return [a[0]+b, a[1]+b, a[2]+b];
  if (isVec(b)) return [a+b[0], a+b[1], a+b[2]];
  return a + b;
}
function vsub(a, b) {
  if (isVec(a) && isVec(b)) return [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  if (isVec(a)) return [a[0]-b, a[1]-b, a[2]-b];
  if (isVec(b)) return [a-b[0], a-b[1], a-b[2]];
  return a - b;
}
function vmul(a, b) {
  if (isVec(a) && isVec(b)) return [a[0]*b[0], a[1]*b[1], a[2]*b[2]];
  if (isVec(a)) return [a[0]*b, a[1]*b, a[2]*b];
  if (isVec(b)) return [a*b[0], a*b[1], a*b[2]];
  return a * b;
}
function vdiv(a, b) {
  if (isVec(a) && isVec(b)) return [a[0]/b[0], a[1]/b[1], a[2]/b[2]];
  if (isVec(a)) return [a[0]/b, a[1]/b, a[2]/b];
  if (isVec(b)) return [a/b[0], a/b[1], a/b[2]];
  return a / b;
}

// 1D hash → [0,1)
function hash1(n) {
  let h = Math.sin(n) * 43758.5453123;
  return h - Math.floor(h);
}
function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}
function noise3(x, y, z) {
  // 8-corner trilinear value noise — deterministic, no Math.random.
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf*xf*(3-2*xf), v = yf*yf*(3-2*yf), w = zf*zf*(3-2*zf);
  function H(a, b, c) { return hash1(a * 374761.39 + b * 668265.21 + c * 1442695.04); }
  const c000 = H(xi,yi,zi),     c100 = H(xi+1,yi,zi),
        c010 = H(xi,yi+1,zi),   c110 = H(xi+1,yi+1,zi),
        c001 = H(xi,yi,zi+1),   c101 = H(xi+1,yi,zi+1),
        c011 = H(xi,yi+1,zi+1), c111 = H(xi+1,yi+1,zi+1);
  const x00 = c000*(1-u) + c100*u;
  const x10 = c010*(1-u) + c110*u;
  const x01 = c001*(1-u) + c101*u;
  const x11 = c011*(1-u) + c111*u;
  const y0 = x00*(1-v) + x10*v;
  const y1 = x01*(1-v) + x11*v;
  return y0*(1-w) + y1*w;
}

const BUILTINS = {
  sin:   (x) => Math.sin(x),
  cos:   (x) => Math.cos(x),
  tan:   (x) => Math.tan(x),
  asin:  (x) => Math.asin(x),
  acos:  (x) => Math.acos(x),
  atan2: (y, x) => Math.atan2(y, x),
  sqrt:  (x) => Math.sqrt(x),
  pow:   (x, y) => Math.pow(x, y),
  exp:   (x) => Math.exp(x),
  log:   (x) => Math.log(x),
  abs:   (x) => isVec(x) ? [Math.abs(x[0]), Math.abs(x[1]), Math.abs(x[2])] : Math.abs(x),
  sign:  (x) => Math.sign(x),
  floor: (x) => Math.floor(x),
  ceil:  (x) => Math.ceil(x),
  round: (x) => Math.round(x),
  min:   (a, b) => isVec(a) || isVec(b) ? [Math.min(isVec(a)?a[0]:a, isVec(b)?b[0]:b), Math.min(isVec(a)?a[1]:a, isVec(b)?b[1]:b), Math.min(isVec(a)?a[2]:a, isVec(b)?b[2]:b)] : Math.min(a, b),
  max:   (a, b) => isVec(a) || isVec(b) ? [Math.max(isVec(a)?a[0]:a, isVec(b)?b[0]:b), Math.max(isVec(a)?a[1]:a, isVec(b)?b[1]:b), Math.max(isVec(a)?a[2]:a, isVec(b)?b[2]:b)] : Math.max(a, b),
  clamp: (x, lo, hi) => isVec(x)
    ? [Math.min(Math.max(x[0], lo), hi), Math.min(Math.max(x[1], lo), hi), Math.min(Math.max(x[2], lo), hi)]
    : Math.min(Math.max(x, lo), hi),
  mix:   (a, b, t) => {
    if (isVec(a) && isVec(b)) return [a[0]*(1-t)+b[0]*t, a[1]*(1-t)+b[1]*t, a[2]*(1-t)+b[2]*t];
    return a * (1 - t) + b * t;
  },
  length: (v) => isVec(v) ? Math.hypot(v[0], v[1], v[2]) : Math.abs(v),
  normalize: (v) => {
    if (!isVec(v)) return Math.sign(v);
    const L = Math.hypot(v[0], v[1], v[2]);
    if (L < 1e-20) return [0, 0, 0];
    return [v[0]/L, v[1]/L, v[2]/L];
  },
  dot:   (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2],
  cross: (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]],
  fit:   (x, omin, omax, nmin, nmax) => {
    if (omax === omin) return nmin;
    const t = (x - omin) / (omax - omin);
    return nmin + (nmax - nmin) * Math.min(Math.max(t, 0), 1);
  },
  fit01: (x, nmin, nmax) => {
    const t = Math.min(Math.max(x, 0), 1);
    return nmin + (nmax - nmin) * t;
  },
  noise: (...args) => {
    if (args.length === 1) {
      const a = args[0];
      if (isVec(a)) return noise3(a[0], a[1], a[2]);
      return noise1(a);
    }
    if (args.length === 3) return noise3(args[0], args[1], args[2]);
    return 0;
  },
};

export const BUILTIN_NAMES = Object.keys(BUILTINS);

class RuntimeError extends Error {
  constructor(msg) { super(msg); this.name = 'VexRuntimeError'; }
}

// Evaluate an l-value reference to a writeback closure.
function refOf(node, env) {
  if (node.type === 'AttrRef') {
    // Whole vec / scalar write
    const name = node.name;
    return {
      get: () => readAttr(env, name),
      set: (v) => writeAttr(env, name, v),
    };
  }
  if (node.type === 'Ident') {
    const name = node.name;
    return {
      get: () => {
        const slot = env.locals[name];
        if (!slot) throw new RuntimeError(`Undefined local '${name}'`);
        return slot.value;
      },
      set: (v) => {
        const slot = env.locals[name];
        if (!slot) throw new RuntimeError(`Undefined local '${name}'`);
        slot.value = v;
      },
    };
  }
  if (node.type === 'Member') {
    const inner = refOf(node.object, env);
    const idx = compIndex(node.comp);
    return {
      get: () => {
        const v = inner.get();
        if (!isVec(v)) throw new RuntimeError(`Cannot read .${node.comp} of scalar`);
        return v[idx];
      },
      set: (val) => {
        const v = inner.get();
        if (!isVec(v)) throw new RuntimeError(`Cannot write .${node.comp} of scalar`);
        const nv = [v[0], v[1], v[2]];
        nv[idx] = val;
        inner.set(nv);
      },
    };
  }
  throw new RuntimeError(`Not an l-value: ${node.type}`);
}

function compIndex(c) {
  switch (c) {
    case 'x': case 'r': return 0;
    case 'y': case 'g': return 1;
    case 'z': case 'b': return 2;
    default: return -1;
  }
}

function readAttr(env, name) {
  if (name === 'P')   return v3clone(env.P);
  if (name === 'N')   return v3clone(env.N);
  if (name === 'Cd')  return v3clone(env.Cd);
  if (name === 'id')  return env.id;
  if (name === 'pt')  return env.pt;
  if (name === 'npt') return env.npt;
  throw new RuntimeError(`Unknown attr @${name}`);
}
function writeAttr(env, name, v) {
  if (name === 'P')  { if (!isVec(v)) throw new RuntimeError('@P must be vec3'); env.P = v3clone(v); env._touchedP = true; return; }
  if (name === 'N')  { if (!isVec(v)) throw new RuntimeError('@N must be vec3'); env.N = v3clone(v); env._touchedN = true; return; }
  if (name === 'Cd') { if (!isVec(v)) throw new RuntimeError('@Cd must be vec3'); env.Cd = v3clone(v); env._touchedCd = true; return; }
  if (name === 'id') { env.id = v|0; env._touchedId = true; return; }
  throw new RuntimeError(`Cannot write @${name}`);
}

function evalExpr(node, env) {
  switch (node.type) {
    case 'Num': return node.value;
    case 'Vec3Lit': return [evalExpr(node.x, env), evalExpr(node.y, env), evalExpr(node.z, env)];
    case 'AttrRef': return readAttr(env, node.name);
    case 'Ident': {
      const slot = env.locals[node.name];
      if (!slot) throw new RuntimeError(`Undefined identifier '${node.name}'`);
      return slot.value;
    }
    case 'Member': {
      const v = evalExpr(node.object, env);
      if (!isVec(v)) throw new RuntimeError(`Cannot read .${node.comp} of scalar`);
      return v[compIndex(node.comp)];
    }
    case 'BinOp': {
      const l = evalExpr(node.l, env);
      const r = evalExpr(node.r, env);
      switch (node.op) {
        case '+': return vadd(l, r);
        case '-': return vsub(l, r);
        case '*': return vmul(l, r);
        case '/': return vdiv(l, r);
        case '==': return l === r ? 1 : 0;
        case '!=': return l !== r ? 1 : 0;
        case '<':  return l <  r ? 1 : 0;
        case '<=': return l <= r ? 1 : 0;
        case '>':  return l >  r ? 1 : 0;
        case '>=': return l >= r ? 1 : 0;
        case '&&': return (l && r) ? 1 : 0;
        case '||': return (l || r) ? 1 : 0;
        default: throw new RuntimeError(`Bad binop ${node.op}`);
      }
    }
    case 'UnaryOp': {
      const x = evalExpr(node.x, env);
      if (node.op === '-') return isVec(x) ? [-x[0],-x[1],-x[2]] : -x;
      if (node.op === '+') return x;
      if (node.op === '!') return x ? 0 : 1;
      throw new RuntimeError(`Bad unary ${node.op}`);
    }
    case 'Call': {
      const fn = BUILTINS[node.name];
      if (!fn) throw new RuntimeError(`Unknown function '${node.name}'`);
      const args = node.args.map((a) => evalExpr(a, env));
      return fn(...args);
    }
    default: throw new RuntimeError(`Bad expr ${node.type}`);
  }
}

const RETURN_SENTINEL = Symbol('vex.return');

function execStmt(stmt, env) {
  switch (stmt.type) {
    case 'Block': {
      for (const s of stmt.stmts) {
        const r = execStmt(s, env);
        if (r === RETURN_SENTINEL) return RETURN_SENTINEL;
      }
      return null;
    }
    case 'VarDecl': {
      let v;
      if (stmt.init) v = evalExpr(stmt.init, env);
      else if (stmt.varType === 'vec3') v = [0, 0, 0];
      else v = 0;
      // Coerce if needed
      if (stmt.varType === 'int') v = Math.trunc(v);
      env.locals[stmt.name] = { type: stmt.varType, value: v };
      return null;
    }
    case 'Assign': {
      const ref = refOf(stmt.target, env);
      const rhs = evalExpr(stmt.expr, env);
      if (stmt.op === '=') {
        ref.set(rhs);
      } else {
        const cur = ref.get();
        switch (stmt.op) {
          case '+=': ref.set(vadd(cur, rhs)); break;
          case '-=': ref.set(vsub(cur, rhs)); break;
          case '*=': ref.set(vmul(cur, rhs)); break;
          case '/=': ref.set(vdiv(cur, rhs)); break;
          default: throw new RuntimeError(`Bad assign op ${stmt.op}`);
        }
      }
      return null;
    }
    case 'If': {
      const c = evalExpr(stmt.cond, env);
      if (c) return execStmt(stmt.then, env);
      if (stmt.else) return execStmt(stmt.else, env);
      return null;
    }
    case 'Return':
      env._returned = stmt.expr ? evalExpr(stmt.expr, env) : null;
      return RETURN_SENTINEL;
    case 'ExprStmt':
      evalExpr(stmt.expr, env);
      return null;
    default: throw new RuntimeError(`Bad stmt ${stmt.type}`);
  }
}

export function runProgram(ast, env) {
  execStmt(ast, env);
  return env;
}
