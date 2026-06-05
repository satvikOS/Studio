// Slice 697 — Analytic SDF primitives + combinators. All ops take a
// world-space point p (3-tuple) and return signed distance.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lenV = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
const absV = (v) => [Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])];
const maxV = (v, s) => [Math.max(v[0], s), Math.max(v[1], s), Math.max(v[2], s)];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const mix = (a, b, t) => a * (1 - t) + b * t;

export function sdSphere(p, c, r) {
  return lenV(sub(p, c)) - r;
}

export function sdBox(p, c, b) {
  const d = sub(absV(sub(p, c)), b);
  const outside = lenV(maxV(d, 0));
  const inside = Math.min(Math.max(d[0], Math.max(d[1], d[2])), 0);
  return outside + inside;
}

export function sdCapsule(p, a, b, r) {
  const pa = sub(p, a);
  const ba = sub(b, a);
  const h = clamp((pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2]), 0, 1);
  return lenV([pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h]) - r;
}

export function sdTorus(p, c, R, r) {
  const q = sub(p, c);
  const xz = Math.sqrt(q[0] * q[0] + q[2] * q[2]) - R;
  return Math.sqrt(xz * xz + q[1] * q[1]) - r;
}

export function sdCylinder(p, c, h, r) {
  const q = sub(p, c);
  const d = [Math.sqrt(q[0] * q[0] + q[2] * q[2]) - r, Math.abs(q[1]) - h];
  const outside = Math.sqrt(Math.max(d[0], 0) ** 2 + Math.max(d[1], 0) ** 2);
  const inside = Math.min(Math.max(d[0], d[1]), 0);
  return outside + inside;
}

export function sdPlane(p, n, offset) {
  return p[0] * n[0] + p[1] * n[1] + p[2] * n[2] - offset;
}

export function smin(a, b, k) {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return mix(b, a, h) - k * h * (1 - h);
}

export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

export function opUnion(a, b) { return Math.min(a, b); }
export function opSubtract(a, b) { return Math.max(-a, b); }
export function opIntersect(a, b) { return Math.max(a, b); }
