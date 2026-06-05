// ArchDisc Studio V3 — shared seeded RNG utilities.
//
// Before this dedup pass, mulberry32 was implemented separately inside
//   - geomdeep/morenodes.js
//   - geomnodes/nodes.js
//   - geomtotal/nodes.js
//   - mograph/effector.js
//   - mograph/field.js
//   - rt/pathtracer.js (as _mulberry)
//
// Every copy is bit-identical apart from minor stylistic choices. The
// canonical version lives here; importers re-export under whatever local
// name they previously used so call-sites stay unchanged.

// Classic Tommy Ettinger / Mulberry32 PRNG.
// Returns a thunk producing [0, 1) floats. Deterministic for the same
// seed, fast, no allocations after the closure. Seed coerced to u32.
export function mulberry32(seed) {
  let s = (seed >>> 0) || 1;
  return function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

// One-shot deterministic [0, 1) value derived from a (seed, index) pair
// without building a closure. Used by Field-style "evaluate at integer
// key" lookups where the cost of constructing+discarding a mulberry32
// closure per call adds up.
export function seededRandom01(seed, idx) {
  let s = ((seed >>> 0) ^ (idx >>> 0)) >>> 0;
  s = (s + 0x6D2B79F5) >>> 0;
  s = Math.imul(s ^ (s >>> 15), s | 1);
  s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
  return (((s ^ (s >>> 14)) >>> 0) / 4294967296);
}

// Fowler-Noll-Vo 1a 32-bit hash on an ASCII string. Reused by mograph
// effectors that derive a seed from an Object3D's uuid string.
export function fnv1a32(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
