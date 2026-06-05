// ArchDisc Studio V3 — vector / SVG path operators.
//
// Pure-functional 2D path helpers operating on arrays of [x, y] points.
// No three.js dependency — these are the building blocks consumed by
// logoExtrude.js, svgImport.js and any future parametric flat-curve
// workflow (Illustrator-style "Offset Path" / "Chamfer Corners" /
// "Close Path"). Every helper returns a brand-new array; inputs are
// never mutated.
//
// Contracts:
//   points: Array<[x, y]>            — open polyline by convention
//   dist:   number                   — positive = expand right of travel
//   size:   number                   — chamfer leg length, world units
//
// Algorithmic notes
// ─────────────────
// offsetPath: For each vertex we compute the unit normal of the
//   incoming and outgoing edge (rotated 90° CCW), average them,
//   re-normalise, then translate the vertex by dist along that
//   averaged normal. The average-normal trick (Foley & van Dam 1990,
//   §13.7) keeps mitre joins sharp without resorting to per-edge
//   intersection of offset lines. Endpoints of an open path use only
//   the single adjacent edge normal.
//
// chamferPath: Replace every interior vertex with two vertices
//   inset by `size` along the incoming and outgoing edges. The size
//   is clamped to half the shorter adjacent edge so we never run past
//   the next vertex. Endpoints are kept verbatim (open-path semantics).
//
// closePath: If the first and last point already coincide within a
//   tiny epsilon, return the input verbatim. Otherwise append a copy
//   of the first point so the polyline forms a closed ring.

const EPS = 1e-9;

function toXY(p) {
  if (!p) return [0, 0];
  if (Array.isArray(p)) return [Number(p[0]) || 0, Number(p[1]) || 0];
  if (typeof p === 'object') return [Number(p.x) || 0, Number(p.y) || 0];
  return [0, 0];
}

function normalizePoints(input) {
  if (!Array.isArray(input)) return [];
  const out = new Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = toXY(input[i]);
  return out;
}

// 90° CCW rotation of a 2D vector → outward normal of the edge a→b
// when the polygon is wound CCW.
function edgeNormal(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < EPS) return [0, 0];
  // Rotate (dx, dy) by +90°: (-dy, dx). That's the LEFT-of-travel
  // normal; with SVG's y-down convention this points "outward" for
  // a clockwise outline, which matches how SVGLoader emits paths.
  return [-dy / len, dx / len];
}

// ─── offsetPath ─────────────────────────────────────────────────────────
export function offsetPath(points, dist) {
  const P = normalizePoints(points);
  const N = P.length;
  const d = Number(dist) || 0;
  if (N < 2 || d === 0) return { ok: true, points: P.slice() };

  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const prev = i > 0 ? P[i - 1] : null;
    const next = i < N - 1 ? P[i + 1] : null;
    let nx = 0, ny = 0;
    if (prev && next) {
      const n1 = edgeNormal(prev, P[i]);
      const n2 = edgeNormal(P[i], next);
      nx = n1[0] + n2[0];
      ny = n1[1] + n2[1];
      const L = Math.hypot(nx, ny);
      if (L < EPS) {
        // Anti-parallel edges (180° reversal). Fall back to the
        // single perpendicular of the incoming edge — the only
        // continuous extrapolation.
        nx = n1[0]; ny = n1[1];
      } else {
        // Mitre length compensation: |a| = 1 / cos(θ/2) where θ is
        // the interior angle. The sum of two unit vectors equals
        // 2·cos(θ/2) in length, so dividing by L (which is that
        // length) already gives us the correct mitre extension.
        nx = (nx / L) * (2 / L);
        ny = (ny / L) * (2 / L);
      }
    } else if (next) {
      const n2 = edgeNormal(P[i], next);
      nx = n2[0]; ny = n2[1];
    } else if (prev) {
      const n1 = edgeNormal(prev, P[i]);
      nx = n1[0]; ny = n1[1];
    }
    out[i] = [P[i][0] + nx * d, P[i][1] + ny * d];
  }
  return { ok: true, points: out };
}

// ─── chamferPath ────────────────────────────────────────────────────────
export function chamferPath(points, size) {
  const P = normalizePoints(points);
  const N = P.length;
  const s = Math.max(0, Number(size) || 0);
  if (N < 3 || s === 0) return { ok: true, points: P.slice() };

  const out = [];
  // First vertex unchanged (open-path semantics).
  out.push(P[0].slice());

  for (let i = 1; i < N - 1; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1];
    const ux = a[0] - b[0], uy = a[1] - b[1];
    const vx = c[0] - b[0], vy = c[1] - b[1];
    const lu = Math.hypot(ux, uy);
    const lv = Math.hypot(vx, vy);
    if (lu < EPS || lv < EPS) { out.push(b.slice()); continue; }
    // Clamp the leg length to half the shortest adjacent edge to
    // guarantee we never cross over the previous chamfer on the
    // same edge.
    const legA = Math.min(s, lu * 0.5);
    const legB = Math.min(s, lv * 0.5);
    out.push([b[0] + (ux / lu) * legA, b[1] + (uy / lu) * legA]);
    out.push([b[0] + (vx / lv) * legB, b[1] + (vy / lv) * legB]);
  }

  // Last vertex unchanged.
  out.push(P[N - 1].slice());
  return { ok: true, points: out };
}

// ─── closePath ──────────────────────────────────────────────────────────
export function closePath(points) {
  const P = normalizePoints(points);
  const N = P.length;
  if (N < 2) return { ok: true, points: P.slice(), closed: false };
  const first = P[0], last = P[N - 1];
  const already = Math.hypot(first[0] - last[0], first[1] - last[1]) < EPS;
  if (already) return { ok: true, points: P.slice(), closed: true };
  const out = P.slice();
  out.push([first[0], first[1]]);
  return { ok: true, points: out, closed: true };
}

// Internal helper exported for the index installer so we can register
// a no-arg shape sanity-check op without re-implementing.
export function polylineLength(points) {
  const P = normalizePoints(points);
  let total = 0;
  for (let i = 1; i < P.length; i++) {
    total += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  }
  return total;
}
