// Slice 736 — automatic UV seam-cutting + multi-chart LSCM unwrap.
//
// LSCM (slice 734) flattens a single disk-topology chart with near-zero
// angle distortion, but a CLOSED mesh (a sphere, a character, a hard-
// surface prop) has no boundary — flattening it whole either folds or
// distorts massively. Real unwrappers first CUT the mesh into charts
// along SEAMS, flatten each chart, then pack them. This module adds that
// missing front half (Blender "Smart UV Project" / Maya "Automatic" /
// ZBrush UV Master's auto-seam):
//
//   1. SEAM DETECTION — mark every edge whose dihedral angle between its
//      two adjacent faces exceeds a threshold (default 40°) as a seam.
//      Sharp creases are exactly where artists cut, and they bound the
//      developable (low-curvature) regions that flatten cleanly. Boundary
//      edges (1 adjacent face) are seams by definition.
//   2. CHART SEGMENTATION — flood-fill triangles across NON-seam shared
//      edges into connected charts. Each chart is bounded by seams.
//   3. PER-CHART CUT — rebuild each chart as its own indexed mesh with
//      its OWN vertex copies (so charts don't share verts across seams —
//      the cut is real), then LSCM-flatten it.
//   4. LAYOUT — translate each chart's UVs into its own column of the
//      unit square (the slice-719 packer can re-pack tightly afterwards).
//
// Pure JS; eval-free; deterministic. Returns per-vertex UVs aligned to
// the ORIGINAL index buffer (charts write back to their source vertices;
// a vertex shared by multiple charts takes its last chart's UV — fine for
// preview, and the per-chart cut means seams are visually correct).

import { lscmUnwrap } from './lscm.js';

const _edgeKey = (a, b) => (a < b ? a + ':' + b : b + ':' + a);

// Face normal of triangle (i0,i1,i2).
function _faceNormal(pos, i0, i1, i2) {
  const ax = pos[i0 * 3], ay = pos[i0 * 3 + 1], az = pos[i0 * 3 + 2];
  const bx = pos[i1 * 3], by = pos[i1 * 3 + 1], bz = pos[i1 * 3 + 2];
  const cx = pos[i2 * 3], cy = pos[i2 * 3 + 1], cz = pos[i2 * 3 + 2];
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// Detect seam edges + segment triangles into charts.
// Returns { charts: number[][] (triangle indices per chart), seamCount }.
// Slice 960 — `userSeams` (parity ledger #6, Blender Ctrl+E "Mark Seam"):
// an iterable of undirected vertex-pair keys ('a:b' or the editauxops
// 'a,b' form). Painted seams merge with angle detection; pass
// `seamAngleDeg: null` to cut along painted seams ONLY (boundary edges
// stay seams by definition — a chart must be bounded).
export function segmentCharts(positions, indices, seamAngleDeg = 40, userSeams = null) {
  const triCount = indices.length / 3;
  const angleDetect = seamAngleDeg != null;
  const cosThresh = angleDetect ? Math.cos(seamAngleDeg * Math.PI / 180) : -2;
  const painted = new Set();
  if (userSeams) {
    for (const k of userSeams) {
      const m = String(k).split(/[,:]/);
      if (m.length === 2) {
        const a = +m[0], b = +m[1];
        if (Number.isFinite(a) && Number.isFinite(b)) painted.add(_edgeKey(a, b));
      }
    }
  }

  // Map each undirected edge → list of triangle indices touching it.
  const edgeTris = new Map();
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const k = _edgeKey(a, b);
      let arr = edgeTris.get(k);
      if (!arr) { arr = []; edgeTris.set(k, arr); }
      arr.push(t);
    }
  }

  // Precompute face normals.
  const normals = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    normals[t] = _faceNormal(positions, indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]);
  }

  // An edge is a seam if it's a boundary (1 face) OR the dihedral angle
  // between its two faces is sharper than the threshold.
  const isSeam = new Set();
  let seamCount = 0;
  let paintedUsed = 0;
  for (const [k, tris] of edgeTris) {
    if (tris.length !== 2) { isSeam.add(k); seamCount++; continue; }
    if (painted.has(k)) { isSeam.add(k); seamCount++; paintedUsed++; continue; }
    if (!angleDetect) continue;
    const n0 = normals[tris[0]], n1 = normals[tris[1]];
    const dot = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];
    if (dot < cosThresh) { isSeam.add(k); seamCount++; }
  }

  // Build triangle adjacency across NON-seam shared edges.
  const adj = Array.from({ length: triCount }, () => []);
  for (const [k, tris] of edgeTris) {
    if (tris.length === 2 && !isSeam.has(k)) {
      adj[tris[0]].push(tris[1]);
      adj[tris[1]].push(tris[0]);
    }
  }

  // Flood-fill connected charts.
  const chartOf = new Int32Array(triCount).fill(-1);
  const charts = [];
  for (let t = 0; t < triCount; t++) {
    if (chartOf[t] !== -1) continue;
    const id = charts.length;
    const stack = [t];
    chartOf[t] = id;
    const tris = [];
    while (stack.length) {
      const cur = stack.pop();
      tris.push(cur);
      for (const nb of adj[cur]) if (chartOf[nb] === -1) { chartOf[nb] = id; stack.push(nb); }
    }
    charts.push(tris);
  }
  return { charts, seamCount, isSeam, paintedUsed };
}

// Full auto seam-cut + per-chart LSCM unwrap. Returns
// { ok, uv:Float32Array(2*N), charts, seamCount } where uv is aligned to
// the original index buffer's vertices.
export function autoSeamUnwrap(positions, indices, opts = {}) {
  const N = positions.length / 3;
  if (N < 3 || !indices || indices.length < 3) return { ok: false, reason: 'no geometry' };
  const seamAngle = opts.seamAngleDeg === null ? null : (Number(opts.seamAngleDeg) || 40);
  const { charts, seamCount, paintedUsed } = segmentCharts(positions, indices, seamAngle, opts.userSeams || null);
  if (!charts.length) return { ok: false, reason: 'no charts' };

  // Build an EXPANDED (non-indexed-style but indexed with per-chart vertex
  // copies) result so charts never share vertices — a corner shared by 3
  // box faces becomes 3 separate UV verts, one per chart. This is required
  // for a real seam cut (otherwise a shared vertex would get one chart's
  // UV and tear the others).
  const outPos = [];
  const outUV = [];
  const outIdx = [];
  const cols = Math.ceil(Math.sqrt(charts.length));
  const cell = 1 / cols;
  let placed = 0;
  let okCharts = 0;

  for (let c = 0; c < charts.length; c++) {
    const tris = charts[c];
    const remap = new Map();          // origVert → localVert
    const localPos = [];
    const localIdx = [];
    const localToOrig = [];
    for (const t of tris) {
      const tri = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
      for (const ov of tri) {
        if (!remap.has(ov)) {
          remap.set(ov, localToOrig.length);
          localToOrig.push(ov);
          localPos.push(positions[ov * 3], positions[ov * 3 + 1], positions[ov * 3 + 2]);
        }
      }
      localIdx.push(remap.get(tri[0]), remap.get(tri[1]), remap.get(tri[2]));
    }
    const lp = Float32Array.from(localPos);
    const li = Uint32Array.from(localIdx);
    let chartUV = null;
    const r = lscmUnwrap(lp, li);
    if (r.ok) { chartUV = r.uv; okCharts++; }
    else { chartUV = _planarFallback(lp); }
    // Normalise this chart's UVs and place into its grid cell (uniform
    // scale → angle-preserving).
    let mnU = Infinity, mxU = -Infinity, mnV = Infinity, mxV = -Infinity;
    for (let i = 0; i < chartUV.length / 2; i++) {
      const u = chartUV[i * 2], v = chartUV[i * 2 + 1];
      if (u < mnU) mnU = u; if (u > mxU) mxU = u;
      if (v < mnV) mnV = v; if (v > mxV) mxV = v;
    }
    const du = (mxU - mnU) || 1, dv = (mxV - mnV) || 1;
    const sc = (0.92 / Math.max(du, dv)) * cell; // single uniform factor
    const col = placed % cols, row = Math.floor(placed / cols);
    const ox = col * cell, oy = row * cell;
    const base = outPos.length / 3;
    for (let i = 0; i < localToOrig.length; i++) {
      outPos.push(lp[i * 3], lp[i * 3 + 1], lp[i * 3 + 2]);
      outUV.push(ox + (chartUV[i * 2] - mnU) * sc, oy + (chartUV[i * 2 + 1] - mnV) * sc);
    }
    for (let i = 0; i < li.length; i++) outIdx.push(base + li[i]);
    placed++;
  }

  return {
    ok: true,
    positions: Float32Array.from(outPos),
    uv: Float32Array.from(outUV),
    indices: Uint32Array.from(outIdx),
    charts: charts.length, seamCount, paintedUsed, flattenedCharts: okCharts,
  };
}

// Planar fallback for a degenerate chart: project onto the 2 axes of
// greatest spread.
function _planarFallback(pos) {
  const n = pos.length / 3;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) {
    const v = pos[i * 3 + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v;
  }
  const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  // pick the two largest-extent axes
  const order = [0, 1, 2].sort((a, b) => ext[b] - ext[a]);
  const ax = order[0], ay = order[1];
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { uv[i * 2] = pos[i * 3 + ax]; uv[i * 2 + 1] = pos[i * 3 + ay]; }
  return uv;
}
