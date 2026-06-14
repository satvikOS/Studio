// Sculpt/paint stroke spacing (parity #55, ZBrush/Blender continuous
// strokes vs single-shot dabs) — pure, DOM-free, node-testable. Given the
// raw pointer path and a brush, resample it into evenly arc-length-spaced
// dab centers so dragging lays a continuous stroke instead of one dab.
// dyntopo/anchored modes are a larger follow-up; this is the spacing core.
//
// Built adversarially: guards empty/1-point paths, zero/negative radius
// or spacing, NaN points, coincident points — never throws or loops.

// path: flat [x,y,z,...] (or [x,y,...] — any stride>=2, set `stride`).
// radius: brush radius (world units). spacing: fraction of radius between
// dabs (Blender default 0.1, ZBrush ~0.25). Returns dab centers as an
// array of points (each a length-`stride` array) including the first.
export function spaceStroke(path, opts = {}) {
  const { radius = 1, spacing = 0.1, stride = 3, maxDabs = 4096 } = opts;
  const pts = path && path.length != null ? path : [];
  const s = Math.max(2, Math.floor(stride));
  const n = Math.floor(pts.length / s);
  if (n === 0) return [];
  const at = (i) => { const o = i * s; const p = []; for (let k = 0; k < s; k++) p.push(Number(pts[o + k]) || 0); return p; };
  const first = at(0);
  if (n === 1) return [first];
  const r = Number(radius);
  const frac = Number(spacing);
  // step = world distance between dabs; fall back to a single dab if the
  // brush/spacing is degenerate.
  const step = (Number.isFinite(r) && r > 0 && Number.isFinite(frac) && frac > 0)
    ? r * frac : 0;
  if (step <= 0) return [first];

  const dist = (a, b) => { let d = 0; for (let k = 0; k < s; k++) { const x = a[k] - b[k]; d += x * x; } return Math.sqrt(d); };
  const lerp = (a, b, t) => { const p = []; for (let k = 0; k < s; k++) p.push(a[k] + (b[k] - a[k]) * t); return p; };

  const out = [first];
  let carry = 0; // arc length accumulated since the last dab
  let prev = first;
  for (let i = 1; i < n && out.length < maxDabs; i++) {
    const cur = at(i);
    let segLen = dist(prev, cur);
    if (!(segLen > 1e-12)) { prev = cur; continue; } // coincident → skip
    let segPos = 0;
    while (carry + (segLen - segPos) >= step && out.length < maxDabs) {
      const advance = step - carry;
      segPos += advance;
      const t = segPos / segLen;
      out.push(lerp(prev, cur, t));
      carry = 0;
    }
    carry += segLen - segPos;
    prev = cur;
  }
  return out;
}
