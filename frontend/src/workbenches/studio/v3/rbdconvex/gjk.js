// Slice 778 — Houdini-tier convex RBD: Gilbert-Johnson-Keerthi (GJK)
// boolean convex collision query.
//
// GJK works on the *Minkowski difference* of two convex sets A ⊖ B:
//
//   A ⊖ B = { a − b | a ∈ A, b ∈ B }
//
// A and B intersect ⟺ the origin lies inside A ⊖ B. GJK never builds
// the Minkowski difference explicitly; it walks toward the origin
// through *support points*:
//
//   support(A, B, d)  =  supportA(d) − supportB(−d)
//
// where supportX(d) is the farthest point of X in direction d. Each
// iteration adds one support point to a "simplex" (1..4 vertices),
// reduces the simplex to the feature closest to the origin, and picks
// a new search direction toward the origin. If the new support fails to
// pass the origin in the search direction, the sets are disjoint.
//
// We give each convex "hull" a `vertices` array of `{x,y,z}` and a
// `supportFn(direction) → {x,y,z}` (precomputed in convexHull.js). The
// loop is capped at 32 iterations — production GJK typically converges
// in 4-8 even for awkward hulls.
//
// On a hit we return the final tetrahedron simplex so EPA can refine the
// penetration normal/depth without re-walking GJK.

// Floating-point epsilon for "is the origin on the simplex face?".
const EPS = 1e-9;

// ─── Public API ─────────────────────────────────────────────────────────

// Build a CSO (Configuration-Space-Obstacle) support point.
//
//   p  = support(hullA, dir)        — farthest point of A in dir
//   q  = support(hullB, -dir)       — farthest point of B in -dir
//   w  = p − q                       — Minkowski-difference support
//
// We keep `p` + `q` alongside `w` so EPA can later reconstruct a contact
// point pair if a downstream step needs it (we don't currently — but it
// costs nothing to store).
export function supportCSO(hullA, hullB, dir) {
  const ndir = { x: -dir.x, y: -dir.y, z: -dir.z };
  const p = hullA.supportFn ? hullA.supportFn(dir)  : supportNaive(hullA, dir);
  const q = hullB.supportFn ? hullB.supportFn(ndir) : supportNaive(hullB, ndir);
  return {
    p: { x: p.x, y: p.y, z: p.z },
    q: { x: q.x, y: q.y, z: q.z },
    w: { x: p.x - q.x, y: p.y - q.y, z: p.z - q.z },
  };
}

// Brute-force support: O(n) over vertex list. Used when a hull's prebuilt
// supportFn isn't available (e.g. the caller passed raw vertices for a
// one-off query).
export function supportNaive(hull, dir) {
  const verts = hull.vertices || [];
  if (verts.length === 0) return { x: 0, y: 0, z: 0 };
  let bestI = 0;
  let bestDot = verts[0].x * dir.x + verts[0].y * dir.y + verts[0].z * dir.z;
  for (let i = 1; i < verts.length; i++) {
    const v = verts[i];
    const d = v.x * dir.x + v.y * dir.y + v.z * dir.z;
    if (d > bestDot) { bestDot = d; bestI = i; }
  }
  return verts[bestI];
}

// Run GJK between two convex hulls.
//
//   hullA / hullB :  { vertices:[{x,y,z}], supportFn:(dir)→{x,y,z} }
//
// Returns:
//   { intersects: true,  simplex: [{p,q,w}×4] }    on hit (tetrahedron)
//   { intersects: false, simplex: [...] }          on miss
//
// The miss simplex is informational; EPA only needs the hit-tetrahedron.
export function gjk(hullA, hullB) {
  // Pick an initial direction. The vector between any pair of points
  // from each set works (the difference of centroids is the textbook
  // pick because it usually points the right way already).
  let dir = initialDirection(hullA, hullB);
  if (lenSq(dir) < EPS) dir = { x: 1, y: 0, z: 0 };

  let simplex = [supportCSO(hullA, hullB, dir)];

  // Walk away from the first support — toward the origin.
  dir = { x: -simplex[0].w.x, y: -simplex[0].w.y, z: -simplex[0].w.z };

  for (let iter = 0; iter < 32; iter++) {
    if (lenSq(dir) < EPS) {
      // Origin is on the simplex's current feature — degenerate
      // contact. Treat as touching.
      return { intersects: true, simplex };
    }
    const a = supportCSO(hullA, hullB, dir);
    // If the new point doesn't pass the origin in the search direction,
    // the origin is outside the Minkowski difference → no overlap.
    if (dot(a.w, dir) < 0) {
      return { intersects: false, simplex };
    }
    simplex.push(a);
    const r = doSimplex(simplex, dir);
    simplex = r.simplex;
    dir = r.dir;
    if (r.containsOrigin) {
      return { intersects: true, simplex };
    }
  }

  // Out of iterations — be conservative and report no-hit so the broad
  // phase moves on rather than locking on a bad pair. With 32 iterations
  // and reasonable hulls this branch is unreachable in practice.
  return { intersects: false, simplex };
}

// ─── Simplex reduction ─────────────────────────────────────────────────
//
// `doSimplex` shrinks the current simplex to the feature (vertex / edge /
// triangle / tetrahedron) closest to the origin and picks the next
// search direction *away from that feature toward the origin*. Returns
// {simplex, dir, containsOrigin}.

function doSimplex(simplex, dir) {
  if (simplex.length === 2) return doLine(simplex);
  if (simplex.length === 3) return doTriangle(simplex);
  if (simplex.length === 4) return doTetrahedron(simplex);
  // Single point — point toward origin from this vertex.
  const a = simplex[0].w;
  return {
    simplex,
    dir: { x: -a.x, y: -a.y, z: -a.z },
    containsOrigin: false,
  };
}

// Line case: simplex = [b, a] where `a` was just added. Decide whether
// origin is past `a` (vertex region) or along the segment.
function doLine(simplex) {
  const a = simplex[1].w;
  const b = simplex[0].w;
  const ab = sub(b, a);
  const ao = neg(a);
  if (dot(ab, ao) > 0) {
    // Origin's projection lies along edge ab — search perpendicular to
    // ab toward the origin.
    const dir = triple(ab, ao, ab);
    return { simplex, dir, containsOrigin: false };
  }
  // Origin is past a — drop b, search from a toward origin.
  return { simplex: [simplex[1]], dir: ao, containsOrigin: false };
}

// Triangle case: simplex = [c, b, a] where `a` was just added.
function doTriangle(simplex) {
  const a = simplex[2].w;
  const b = simplex[1].w;
  const c = simplex[0].w;
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ao = neg(a);
  const abc = cross(ab, ac);

  if (dot(cross(abc, ac), ao) > 0) {
    if (dot(ac, ao) > 0) {
      // Origin in edge ac region.
      return {
        simplex: [simplex[0], simplex[2]],
        dir: triple(ac, ao, ac),
        containsOrigin: false,
      };
    }
    // Fall back to the AB / vertex-A check.
    return doLine([simplex[1], simplex[2]]);
  }
  if (dot(cross(ab, abc), ao) > 0) {
    // Origin in edge ab region.
    return doLine([simplex[1], simplex[2]]);
  }
  // Origin is inside the triangle prism — pick the face normal toward
  // origin and search there.
  if (dot(abc, ao) > 0) {
    return { simplex, dir: abc, containsOrigin: false };
  }
  // Below the triangle — swap winding & search downward.
  return {
    simplex: [simplex[1], simplex[0], simplex[2]],
    dir: neg(abc),
    containsOrigin: false,
  };
}

// Tetrahedron case: simplex = [d, c, b, a] where `a` was just added.
// Check whether origin is in front of any of the three faces touching
// a (abc / acd / adb). If so, drop the opposite vertex and recurse on
// the triangle. Otherwise the origin is inside the tetrahedron → HIT.
function doTetrahedron(simplex) {
  const a = simplex[3].w;
  const b = simplex[2].w;
  const c = simplex[1].w;
  const d = simplex[0].w;
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ad = sub(d, a);
  const ao = neg(a);
  const abc = cross(ab, ac);
  const acd = cross(ac, ad);
  const adb = cross(ad, ab);

  if (dot(abc, ao) > 0) {
    // In front of face abc → drop d, recurse on triangle [c, b, a].
    return doTriangle([simplex[1], simplex[2], simplex[3]]);
  }
  if (dot(acd, ao) > 0) {
    // In front of face acd → drop b, recurse on triangle [d, c, a].
    return doTriangle([simplex[0], simplex[1], simplex[3]]);
  }
  if (dot(adb, ao) > 0) {
    // In front of face adb → drop c, recurse on triangle [b, d, a].
    return doTriangle([simplex[2], simplex[0], simplex[3]]);
  }
  // Origin is inside the tetrahedron — collision confirmed.
  return { simplex, dir: { x: 0, y: 0, z: 0 }, containsOrigin: true };
}

// ─── Vector helpers ────────────────────────────────────────────────────

export function dot(a, b)   { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function lenSq(a)    { return a.x * a.x + a.y * a.y + a.z * a.z; }
export function sub(a, b)   { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function add(a, b)   { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function neg(a)      { return { x: -a.x, y: -a.y, z: -a.z }; }
export function scale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
export function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

// Triple product (a×b)×c — used for "perpendicular toward origin in the
// plane of a&b" search direction.
export function triple(a, b, c) {
  return cross(cross(a, b), c);
}

// Pick an initial GJK direction. Centroid-to-centroid is the canonical
// pick. We never use the zero vector — the GJK loop guards that anyway.
function initialDirection(hullA, hullB) {
  const ca = centroid(hullA);
  const cb = centroid(hullB);
  return { x: cb.x - ca.x, y: cb.y - ca.y, z: cb.z - ca.z };
}

function centroid(hull) {
  const v = hull.vertices || [];
  if (v.length === 0) return { x: 0, y: 0, z: 0 };
  let sx = 0, sy = 0, sz = 0;
  for (const p of v) { sx += p.x; sy += p.y; sz += p.z; }
  return { x: sx / v.length, y: sy / v.length, z: sz / v.length };
}

// Build a "world-space hull" from a base hull + a transform
// {position:{x,y,z}, quaternion?:{x,y,z,w}}. We pre-rotate the vertex
// array so the support function is a plain dot-product loop. Used by
// the solver to feed translated bodies into GJK without rebuilding
// supportFn closures every frame.
export function transformHull(hull, transform) {
  const out = { vertices: new Array(hull.vertices.length) };
  const tp = transform.position || { x: 0, y: 0, z: 0 };
  const q  = transform.quaternion;
  for (let i = 0; i < hull.vertices.length; i++) {
    const v = hull.vertices[i];
    let rx = v.x, ry = v.y, rz = v.z;
    if (q) {
      const r = applyQuat(v, q);
      rx = r.x; ry = r.y; rz = r.z;
    }
    out.vertices[i] = { x: rx + tp.x, y: ry + tp.y, z: rz + tp.z };
  }
  // Build a tight support closure over the transformed vertex list.
  out.supportFn = function supportFn(d) {
    let bestI = 0;
    let bestDot = out.vertices[0].x * d.x
                + out.vertices[0].y * d.y
                + out.vertices[0].z * d.z;
    for (let i = 1; i < out.vertices.length; i++) {
      const vv = out.vertices[i];
      const dd = vv.x * d.x + vv.y * d.y + vv.z * d.z;
      if (dd > bestDot) { bestDot = dd; bestI = i; }
    }
    return out.vertices[bestI];
  };
  return out;
}

// Quaternion · vector application. q = {x,y,z,w}. Standard formula
// v' = q ⊗ v ⊗ q⁻¹ expanded — avoids importing THREE here so the file
// stays a pure math kernel.
function applyQuat(v, q) {
  const ix =  q.w * v.x + q.y * v.z - q.z * v.y;
  const iy =  q.w * v.y + q.z * v.x - q.x * v.z;
  const iz =  q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}
