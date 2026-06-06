// ArchDisc Studio V3 — real Catmull-Clark subdivision with Hoppe-94
// semi-sharp creases (slice 749).
//
// The existing v3/rhinosubd/catmull.js was triangle-based and its
// crease support was a stub. This module is a true quad CC subdivider
// that keeps its own quad cage on userData.archdiscStudioCCQuads, so
// repeated runs are exact, and the final BufferGeometry is rebuilt
// with triangulated indices.
//
// Rules (Catmull-Clark + Hoppe '94):
//   Face point  Fp = centroid of the quad's 4 corner verts.
//   Edge point  smoothEp = (P1+P2+Fa+Fb)/4   (interior, 2 incident faces)
//               sharpEp  = (P1+P2)/2          (boundary OR sharpness >=1)
//               semi     = lerp(smoothEp, sharpEp, sharpness)
//   Vertex pt  smooth interior = (F + 2R + (n-3)P) / n
//                where F = avg facePt of incident faces
//                      R = avg midpoint of incident edges
//                      n = valence
//              boundary smooth = (P_prev + 6P + P_next) / 8
//              valence-2 corner on boundary = held in place
//              3+ incident sharp edges = held in place (corner)
//              2 sharp = crease vertex = (V_other_e1 + 6P + V_other_e2)/8
//   Crease decay (Hoppe '94): on each step, new edge sharpness =
//   max(0, oldSharpness - 1). The new edge inherits its parent edge's
//   sharpness via newCreases map.

const _EPS_COS = 0.99996;

function _edgeKey(a, b) { return a < b ? `${a}_${b}` : `${b}_${a}`; }

// One Catmull-Clark step on a quad mesh.
//   verts:  Float32Array | Array of length 3N (xyz triples)
//   quads:  Uint32Array  | Array of length 4M (quad CCW corner indices)
//   creases:Map<edgeKey, sharpness>
// Returns { verts, quads, creases }.
function ccStep(verts, quads, creases) {
  const vertCount = (verts.length / 3) | 0;
  const quadCount = (quads.length / 4) | 0;

  // Per-quad face points + per-edge metadata.
  const facePoints = new Float32Array(quadCount * 3);
  for (let q = 0; q < quadCount; q++) {
    const a = quads[q * 4],     b = quads[q * 4 + 1];
    const c = quads[q * 4 + 2], d = quads[q * 4 + 3];
    facePoints[q * 3]     = (verts[a*3]   + verts[b*3]   + verts[c*3]   + verts[d*3])   / 4;
    facePoints[q * 3 + 1] = (verts[a*3+1] + verts[b*3+1] + verts[c*3+1] + verts[d*3+1]) / 4;
    facePoints[q * 3 + 2] = (verts[a*3+2] + verts[b*3+2] + verts[c*3+2] + verts[d*3+2]) / 4;
  }

  // Edge map.
  const edges = new Map(); // key → { v0, v1, faces:[], sharpness }
  function _addEdge(u, v, q) {
    const k = _edgeKey(u, v);
    let e = edges.get(k);
    if (!e) {
      e = { v0: Math.min(u, v), v1: Math.max(u, v), faces: [], sharpness: creases.get(k) || 0 };
      edges.set(k, e);
    }
    e.faces.push(q);
  }
  for (let q = 0; q < quadCount; q++) {
    const a = quads[q*4], b = quads[q*4+1], c = quads[q*4+2], d = quads[q*4+3];
    _addEdge(a, b, q); _addEdge(b, c, q); _addEdge(c, d, q); _addEdge(d, a, q);
  }

  // Edge points + assign output indices for them. Edge points live at
  // vertCount + quadCount + edgeIndex (face points first to keep indices
  // stable across iterations).
  const edgeArr = Array.from(edges.values());
  const edgeIndexByKey = new Map();
  for (let i = 0; i < edgeArr.length; i++) {
    const k = _edgeKey(edgeArr[i].v0, edgeArr[i].v1);
    edgeIndexByKey.set(k, i);
  }
  const newEdgePoints = new Float32Array(edgeArr.length * 3);
  for (let i = 0; i < edgeArr.length; i++) {
    const e = edgeArr[i];
    const p1 = e.v0, p2 = e.v1;
    const mx = (verts[p1*3]   + verts[p2*3])   / 2;
    const my = (verts[p1*3+1] + verts[p2*3+1]) / 2;
    const mz = (verts[p1*3+2] + verts[p2*3+2]) / 2;
    const boundary = e.faces.length === 1;
    const fullySharp = e.sharpness >= 1;
    if (boundary || fullySharp) {
      newEdgePoints[i*3]     = mx;
      newEdgePoints[i*3 + 1] = my;
      newEdgePoints[i*3 + 2] = mz;
    } else if (e.sharpness > 0) {
      // Semi-sharp: blend smooth with sharp midpoint.
      let smoothX = mx, smoothY = my, smoothZ = mz;
      for (const f of e.faces) {
        smoothX += facePoints[f*3];
        smoothY += facePoints[f*3 + 1];
        smoothZ += facePoints[f*3 + 2];
      }
      // (mx,my,mz) was the average of P1+P2 / 2; we want
      // (P1+P2+Fa+Fb)/4 = (2*mx + Fa + Fb)/4. So:
      smoothX = (2 * mx + facePoints[e.faces[0]*3]     + facePoints[e.faces[1]*3])     / 4;
      smoothY = (2 * my + facePoints[e.faces[0]*3 + 1] + facePoints[e.faces[1]*3 + 1]) / 4;
      smoothZ = (2 * mz + facePoints[e.faces[0]*3 + 2] + facePoints[e.faces[1]*3 + 2]) / 4;
      const t = Math.min(1, e.sharpness);
      newEdgePoints[i*3]     = smoothX * (1 - t) + mx * t;
      newEdgePoints[i*3 + 1] = smoothY * (1 - t) + my * t;
      newEdgePoints[i*3 + 2] = smoothZ * (1 - t) + mz * t;
    } else {
      // Smooth interior.
      newEdgePoints[i*3]     = (2 * mx + facePoints[e.faces[0]*3]     + facePoints[e.faces[1]*3])     / 4;
      newEdgePoints[i*3 + 1] = (2 * my + facePoints[e.faces[0]*3 + 1] + facePoints[e.faces[1]*3 + 1]) / 4;
      newEdgePoints[i*3 + 2] = (2 * mz + facePoints[e.faces[0]*3 + 2] + facePoints[e.faces[1]*3 + 2]) / 4;
    }
  }

  // Per-vertex adjacency.
  const vertFaces = Array.from({ length: vertCount }, () => []);
  const vertEdges = Array.from({ length: vertCount }, () => []);
  for (let q = 0; q < quadCount; q++) {
    for (let k = 0; k < 4; k++) {
      vertFaces[quads[q*4 + k]].push(q);
    }
  }
  for (let i = 0; i < edgeArr.length; i++) {
    const e = edgeArr[i];
    vertEdges[e.v0].push(i);
    vertEdges[e.v1].push(i);
  }
  // Boundary neighbour ring (for the smooth-boundary rule).
  const boundaryNeighbours = new Map(); // vert → [prev, next]
  for (let v = 0; v < vertCount; v++) {
    const incidentBoundaryEdges = vertEdges[v].filter((ei) => edgeArr[ei].faces.length === 1);
    if (incidentBoundaryEdges.length === 2) {
      const a = edgeArr[incidentBoundaryEdges[0]];
      const b = edgeArr[incidentBoundaryEdges[1]];
      const other0 = (a.v0 === v ? a.v1 : a.v0);
      const other1 = (b.v0 === v ? b.v1 : b.v0);
      boundaryNeighbours.set(v, [other0, other1]);
    }
  }

  // New vertex positions for the existing verts.
  const newVerts = new Float32Array(verts.length);
  for (let v = 0; v < vertCount; v++) {
    const incFaces = vertFaces[v];
    const incEdges = vertEdges[v];
    const sharpEdges = incEdges.filter((ei) => edgeArr[ei].sharpness >= 1);
    const onBoundary = boundaryNeighbours.has(v);
    const px = verts[v*3], py = verts[v*3+1], pz = verts[v*3+2];

    if (onBoundary && incEdges.length === 2) {
      // Valence-2 boundary corner — held in place.
      newVerts[v*3] = px; newVerts[v*3+1] = py; newVerts[v*3+2] = pz;
    } else if (onBoundary) {
      const [a, b] = boundaryNeighbours.get(v);
      newVerts[v*3]     = (verts[a*3]     + 6 * px + verts[b*3])     / 8;
      newVerts[v*3 + 1] = (verts[a*3 + 1] + 6 * py + verts[b*3 + 1]) / 8;
      newVerts[v*3 + 2] = (verts[a*3 + 2] + 6 * pz + verts[b*3 + 2]) / 8;
    } else if (sharpEdges.length >= 3) {
      // Corner — held in place.
      newVerts[v*3] = px; newVerts[v*3+1] = py; newVerts[v*3+2] = pz;
    } else if (sharpEdges.length === 2) {
      // Crease vertex.
      const e1 = edgeArr[sharpEdges[0]];
      const e2 = edgeArr[sharpEdges[1]];
      const o1 = e1.v0 === v ? e1.v1 : e1.v0;
      const o2 = e2.v0 === v ? e2.v1 : e2.v0;
      newVerts[v*3]     = (verts[o1*3]     + 6 * px + verts[o2*3])     / 8;
      newVerts[v*3 + 1] = (verts[o1*3 + 1] + 6 * py + verts[o2*3 + 1]) / 8;
      newVerts[v*3 + 2] = (verts[o1*3 + 2] + 6 * pz + verts[o2*3 + 2]) / 8;
    } else {
      // Smooth interior — (F + 2R + (n-3)P) / n  with R = avg edge midpoint.
      const n = incFaces.length;
      if (n === 0) {
        newVerts[v*3] = px; newVerts[v*3+1] = py; newVerts[v*3+2] = pz;
        continue;
      }
      let Fx = 0, Fy = 0, Fz = 0;
      for (const f of incFaces) {
        Fx += facePoints[f*3]; Fy += facePoints[f*3 + 1]; Fz += facePoints[f*3 + 2];
      }
      Fx /= n; Fy /= n; Fz /= n;
      let Rx = 0, Ry = 0, Rz = 0;
      for (const ei of incEdges) {
        const e = edgeArr[ei];
        Rx += (verts[e.v0*3]     + verts[e.v1*3])     / 2;
        Ry += (verts[e.v0*3 + 1] + verts[e.v1*3 + 1]) / 2;
        Rz += (verts[e.v0*3 + 2] + verts[e.v1*3 + 2]) / 2;
      }
      Rx /= incEdges.length; Ry /= incEdges.length; Rz /= incEdges.length;
      newVerts[v*3]     = (Fx + 2 * Rx + (n - 3) * px) / n;
      newVerts[v*3 + 1] = (Fy + 2 * Ry + (n - 3) * py) / n;
      newVerts[v*3 + 2] = (Fz + 2 * Rz + (n - 3) * pz) / n;
    }
  }

  // Assemble final vertex buffer: existing verts, then edge points,
  // then face points.
  const outVerts = new Float32Array((vertCount + edgeArr.length + quadCount) * 3);
  outVerts.set(newVerts, 0);
  outVerts.set(newEdgePoints, vertCount * 3);
  outVerts.set(facePoints, (vertCount + edgeArr.length) * 3);

  const epOffset = vertCount;
  const fpOffset = vertCount + edgeArr.length;

  // Build new quads — each face becomes 4 quads.
  const outQuads = new Uint32Array(quadCount * 4 * 4);
  for (let q = 0; q < quadCount; q++) {
    const corners = [quads[q*4], quads[q*4+1], quads[q*4+2], quads[q*4+3]];
    const fp = fpOffset + q;
    // Edge points around the face (e01, e12, e23, e30).
    const e01 = epOffset + edgeIndexByKey.get(_edgeKey(corners[0], corners[1]));
    const e12 = epOffset + edgeIndexByKey.get(_edgeKey(corners[1], corners[2]));
    const e23 = epOffset + edgeIndexByKey.get(_edgeKey(corners[2], corners[3]));
    const e30 = epOffset + edgeIndexByKey.get(_edgeKey(corners[3], corners[0]));
    // Child quads.
    outQuads[q*16 +  0] = corners[0]; outQuads[q*16 +  1] = e01; outQuads[q*16 +  2] = fp;  outQuads[q*16 +  3] = e30;
    outQuads[q*16 +  4] = corners[1]; outQuads[q*16 +  5] = e12; outQuads[q*16 +  6] = fp;  outQuads[q*16 +  7] = e01;
    outQuads[q*16 +  8] = corners[2]; outQuads[q*16 +  9] = e23; outQuads[q*16 + 10] = fp;  outQuads[q*16 + 11] = e12;
    outQuads[q*16 + 12] = corners[3]; outQuads[q*16 + 13] = e30; outQuads[q*16 + 14] = fp;  outQuads[q*16 + 15] = e23;
  }

  // New crease map: each old edge with sharpness > 0 splits into two
  // sub-edges, each carrying max(0, s-1).
  const newCreases = new Map();
  for (let i = 0; i < edgeArr.length; i++) {
    const e = edgeArr[i];
    if (e.sharpness <= 0) continue;
    const s2 = Math.max(0, e.sharpness - 1);
    if (s2 <= 0) continue;
    const epIdx = epOffset + i;
    newCreases.set(_edgeKey(e.v0, epIdx), s2);
    newCreases.set(_edgeKey(epIdx, e.v1), s2);
  }

  return { verts: outVerts, quads: outQuads, creases: newCreases };
}

// Public API.
export function subdivideQuads(verts, quads, levels, creases) {
  let v = verts, q = quads, c = creases || new Map();
  for (let l = 0; l < levels; l++) {
    const r = ccStep(v, q, c);
    v = r.verts; q = r.quads; c = r.creases;
  }
  return { verts: v, quads: q, creases: c };
}

export { _edgeKey as edgeKey };
