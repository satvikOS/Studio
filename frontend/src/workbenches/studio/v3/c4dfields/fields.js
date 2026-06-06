// Slice 709 — Cinema 4D Field system. Fields are scalar-falloff
// volumes that modulate effector strength. Implemented kinds:
// linear / spherical / box / cylinder / random / cone / torus /
// formula. Each returns a sampler(x,y,z) → [0..1]. Plugs into the
// slice-692 mograph effectors via the optional `field` argument.

const _fields = new Map();
let _seq = 1;
function _uid() { return `f-${_seq++}-${Date.now().toString(36)}`; }

function _linearFn(c, dir, length) {
  const dx = dir[0], dy = dir[1], dz = dir[2];
  const ln = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const ux = dx / ln, uy = dy / ln, uz = dz / ln;
  return (x, y, z) => {
    const lx = x - c[0], ly = y - c[1], lz = z - c[2];
    const t = lx * ux + ly * uy + lz * uz;
    return Math.max(0, Math.min(1, t / length));
  };
}

function _sphericalFn(c, radius) {
  return (x, y, z) => {
    const dx = x - c[0], dy = y - c[1], dz = z - c[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return Math.max(0, 1 - d / radius);
  };
}

function _boxFn(c, half) {
  return (x, y, z) => {
    const dx = Math.abs(x - c[0]) / half[0];
    const dy = Math.abs(y - c[1]) / half[1];
    const dz = Math.abs(z - c[2]) / half[2];
    const m = Math.max(dx, dy, dz);
    return Math.max(0, 1 - m);
  };
}

function _cylinderFn(c, axis, radius, height) {
  return (x, y, z) => {
    const lx = x - c[0], ly = y - c[1], lz = z - c[2];
    const t = lx * axis[0] + ly * axis[1] + lz * axis[2];
    const px = lx - t * axis[0], py = ly - t * axis[1], pz = lz - t * axis[2];
    const r = Math.sqrt(px * px + py * py + pz * pz);
    const rFall = Math.max(0, 1 - r / radius);
    const hFall = Math.max(0, 1 - Math.abs(t) / (height / 2));
    return rFall * hFall;
  };
}

function _randomFn(seed, scale) {
  let s = seed | 0;
  return (x, y, z) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const cellX = Math.floor(x / scale);
    const cellY = Math.floor(y / scale);
    const cellZ = Math.floor(z / scale);
    const h = (cellX * 374761393 + cellY * 668265263 + cellZ * 1274126177 + s) >>> 0;
    return (h % 10000) / 10000;
  };
}

function _coneFn(c, axis, halfAngle, length) {
  const ax = axis[0], ay = axis[1], az = axis[2];
  const cosA = Math.cos(halfAngle);
  return (x, y, z) => {
    const dx = x - c[0], dy = y - c[1], dz = z - c[2];
    const t = dx * ax + dy * ay + dz * az;
    if (t < 0 || t > length) return 0;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len === 0) return 1;
    const cos = t / len;
    if (cos < cosA) return 0;
    const fadeAngle = 1 - (cosA - cos) / (1 - cosA);
    const fadeT = 1 - t / length;
    return Math.max(0, fadeAngle * fadeT);
  };
}

function _torusFn(c, axis, R, r) {
  return (x, y, z) => {
    const dx = x - c[0], dy = y - c[1], dz = z - c[2];
    const t = dx * axis[0] + dy * axis[1] + dz * axis[2];
    const px = dx - t * axis[0], py = dy - t * axis[1], pz = dz - t * axis[2];
    const distAxial = Math.sqrt(px * px + py * py + pz * pz);
    const dToRing = Math.sqrt((distAxial - R) ** 2 + t * t);
    return Math.max(0, 1 - dToRing / r);
  };
}

function _formulaFn(expr) {
  // eslint-disable-next-line no-new-func
  return new Function('x', 'y', 'z', `
    const sin = Math.sin, cos = Math.cos, sqrt = Math.sqrt, abs = Math.abs;
    return Math.max(0, Math.min(1, ${expr}));
  `);
}

export function createField(kind, params) {
  const id = _uid();
  let sampler;
  switch (kind) {
    case 'linear':     sampler = _linearFn(params.center || [0, 0, 0], params.direction || [0, 1, 0], params.length || 1); break;
    case 'spherical':  sampler = _sphericalFn(params.center || [0, 0, 0], params.radius || 1); break;
    case 'box':        sampler = _boxFn(params.center || [0, 0, 0], params.half || [1, 1, 1]); break;
    case 'cylinder':   sampler = _cylinderFn(params.center || [0, 0, 0], params.axis || [0, 1, 0], params.radius || 1, params.height || 2); break;
    case 'random':     sampler = _randomFn(params.seed ?? 42, params.scale || 1); break;
    case 'cone':       sampler = _coneFn(params.center || [0, 0, 0], params.axis || [0, 1, 0], params.halfAngle || 0.4, params.length || 2); break;
    case 'torus':      sampler = _torusFn(params.center || [0, 0, 0], params.axis || [0, 1, 0], params.majorR || 1, params.minorR || 0.3); break;
    case 'formula':    sampler = _formulaFn(params.expr || '1'); break;
    default: return { ok: false, error: 'unknown kind: ' + kind };
  }
  _fields.set(id, { id, kind, params, sampler });
  return { ok: true, id };
}

export function sample(fieldId, x, y, z) {
  const f = _fields.get(fieldId);
  if (!f) return 0;
  return f.sampler(x, y, z);
}

export function listFields() {
  return {
    ok: true,
    fields: Array.from(_fields.values()).map((f) => ({ id: f.id, kind: f.kind, params: f.params })),
  };
}

export function deleteField(id) {
  return { ok: _fields.delete(id) };
}

// Apply a field as a multiplier on a clone array (used by mograph).
export function applyToClones(fieldId, clones, channel) {
  const f = _fields.get(fieldId);
  if (!f) return { ok: false };
  channel = channel || 'sy';   // default: modulate Y-scale
  for (let i = 0; i < clones.length; i++) {
    const m = f.sampler(clones[i].x, clones[i].y, clones[i].z);
    if (channel === 'all') {
      clones[i].sx = (clones[i].sx || 1) * m;
      clones[i].sy = (clones[i].sy || 1) * m;
      clones[i].sz = (clones[i].sz || 1) * m;
    } else {
      clones[i][channel] = (clones[i][channel] || 0) * m;
    }
  }
  return { ok: true };
}
