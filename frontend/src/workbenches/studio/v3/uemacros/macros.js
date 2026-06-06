// Slice 719 — Unreal Blueprint macros (named functions). A macro is
// a reusable subroutine: takes named parameters, runs a small JS
// expression on them, returns a named output. Callable from slice-
// 713 xpresso or slice-700 ghgraph or directly via window.__studio*
// op. Mirrors Unreal Blueprint Functions / Macros.

const _macros = new Map();

export function define(name, opts) {
  if (!name) return { ok: false };
  const params = opts?.params || [];
  const returns = opts?.returns || ['result'];
  const body = opts?.body;
  if (!body) return { ok: false, error: 'body required' };
  let fn;
  if (typeof body === 'function') fn = body;
  else if (typeof body === 'string') {
    // eslint-disable-next-line no-new-func
    fn = new Function(...params, `
      const sin = Math.sin, cos = Math.cos, sqrt = Math.sqrt;
      ${body.startsWith('return ') ? body : 'return ' + body};
    `);
  } else return { ok: false };
  _macros.set(name, { name, params, returns, fn });
  return { ok: true };
}

export function invoke(name, args) {
  const m = _macros.get(name);
  if (!m) return { ok: false, error: 'unknown macro: ' + name };
  try {
    // args is an object {paramName: value, ...} or an array.
    const positional = Array.isArray(args)
      ? args
      : m.params.map((p) => args[p]);
    const out = m.fn(...positional);
    if (m.returns.length === 1) {
      return { ok: true, [m.returns[0]]: out };
    }
    return { ok: true, ...(typeof out === 'object' ? out : { result: out }) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function listMacros() {
  return {
    ok: true,
    macros: Array.from(_macros.values()).map((m) => ({
      name: m.name, params: m.params, returns: m.returns,
    })),
  };
}

export function remove(name) {
  return { ok: _macros.delete(name) };
}

// Library helpers — preload common geometry/math macros.
export function preloadLibrary() {
  define('Vec3.distance', { params: ['a', 'b'], returns: ['d'],
    body: 'Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2])' });
  define('Vec3.lerp', { params: ['a', 'b', 't'], returns: ['v'],
    body: 'return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]' });
  define('Vec3.dot', { params: ['a', 'b'], returns: ['d'],
    body: 'a[0]*b[0]+a[1]*b[1]+a[2]*b[2]' });
  define('Math.smoothstep', { params: ['x', 'e0', 'e1'], returns: ['v'],
    body: 'const t = Math.max(0, Math.min(1, (x-e0)/(e1-e0))); return t*t*(3-2*t);' });
  define('Color.hsv2rgb', { params: ['h', 's', 'v'], returns: ['rgb'],
    body: `
      const c = v * s;
      const x = c * (1 - Math.abs(((h*6) % 2) - 1));
      const m = v - c;
      let r=0,g=0,b=0;
      if (h<1/6) { r=c; g=x; }
      else if (h<2/6) { r=x; g=c; }
      else if (h<3/6) { g=c; b=x; }
      else if (h<4/6) { g=x; b=c; }
      else if (h<5/6) { r=x; b=c; }
      else { r=c; b=x; }
      return [r+m, g+m, b+m];
    `,
  });
  return { ok: true, loaded: 5 };
}
