// Proportional editing / soft-select (parity #55, Blender 'O' / Maya
// soft-select) — pure functions on plain position arrays, DOM/THREE-free
// so they node-test in isolation. The viewport op wires these in later.
//
// Moving one vertex drags nearby vertices by a distance-weighted falloff
// (computed against each vertex's ORIGINAL position, so the influence
// region doesn't drift mid-drag). Falloff curves mirror Blender's set.
//
// Built adversarially from the start (the 2026-06-13 core-bugs lesson):
// guards null/empty positions, radius<=0, NaN delta, out-of-range index,
// unknown curve — never throws, returns a safe no-op copy instead.

const FALLOFFS = {
  // t in [0,1] is normalized distance (0 at the moved vert, 1 at radius).
  // each returns the influence weight (1 at center → 0 at edge).
  smooth: (t) => { const x = 1 - t; return x * x * (3 - 2 * x); }, // smoothstep
  sphere: (t) => Math.sqrt(Math.max(0, 1 - t * t)),
  root: (t) => Math.sqrt(Math.max(0, 1 - t)),
  linear: (t) => 1 - t,
  sharp: (t) => (1 - t) * (1 - t),
  constant: () => 1,
};

export function falloffWeight(distance, radius, curve = 'smooth') {
  const r = Number(radius);
  if (!Number.isFinite(r) || r <= 0) return 0;
  const d = Number(distance);
  if (!Number.isFinite(d) || d < 0) return 0;
  if (d >= r) return 0;
  const fn = FALLOFFS[curve] || FALLOFFS.smooth;
  const w = fn(d / r);
  return Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 0;
}

// positions: Float32Array|number[] (xyz triples). movedIdx: vertex index.
// delta: [dx,dy,dz]. Returns a NEW array (input untouched) +
// {affected} count. The moved vertex always gets the full delta (w=1).
export function proportionalMove(positions, movedIdx, delta, radius, curve = 'smooth') {
  const src = positions && (positions.length != null) ? positions : [];
  const out = src.slice ? src.slice() : Array.from(src);
  const n = Math.floor(out.length / 3);
  const i = Math.floor(movedIdx);
  if (n === 0 || !(i >= 0 && i < n)) return { positions: out, affected: 0 };
  const d = Array.isArray(delta) ? delta : [delta && delta[0], delta && delta[1], delta && delta[2]];
  const dx = Number(d[0]) || 0, dy = Number(d[1]) || 0, dz = Number(d[2]) || 0;
  if (dx === 0 && dy === 0 && dz === 0) return { positions: out, affected: 0 };
  const r = Number(radius);
  const ox = out[i * 3], oy = out[i * 3 + 1], oz = out[i * 3 + 2];
  let affected = 0;
  for (let v = 0; v < n; v++) {
    let w;
    if (v === i) {
      w = 1;
    } else if (!Number.isFinite(r) || r <= 0) {
      continue; // no radius → rigid single-vertex move
    } else {
      const ax = out[v * 3] - ox, ay = out[v * 3 + 1] - oy, az = out[v * 3 + 2] - oz;
      const dist = Math.sqrt(ax * ax + ay * ay + az * az);
      w = falloffWeight(dist, r, curve);
      if (w <= 0) continue;
    }
    out[v * 3] += dx * w;
    out[v * 3 + 1] += dy * w;
    out[v * 3 + 2] += dz * w;
    affected++;
  }
  return { positions: out, affected };
}

export const FALLOFF_NAMES = Object.keys(FALLOFFS);
