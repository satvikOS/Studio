// ArchDisc Studio V3 — Bridge Edges (slice 756).
//
// Maya / 3ds Max / Modo "Bridge edges" + "Bridge faces": given two parallel
// border edge loops of N verts each, stitch N quads connecting them so the
// two loops become the rims of a tube/strip. Each pair (loopA[i], loopB[i])
// forms one quad with (loopA[i+1], loopB[i+1]).
//
// Real algorithm — pure JS, takes (geometry, loopA, loopB) and returns a
// rebuilt indexed THREE.BufferGeometry with the new quads appended (each
// quad emitted as two CCW triangles). Quad windings are auto-flipped if
// the user's loop pair faces the wrong way (detected by checking whether
// the centroid-to-centroid vector aligns with the quad normal at i=0).
//
// Closed loops (loopA[0] same vert as a wrap target) are handled by the
// `closeLoop` flag: when true the strip wraps back to i=0 producing N
// quads; when false N-1 quads. The default closes if loopA[0] != loopA[N-1]
// AND both loops have the same length AND N >= 3.

import * as THREE from 'three';

// Copy attribute data into a flat Float32Array.
function _vertsCopy(posAttr) {
  const out = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    out[i * 3] = posAttr.getX(i);
    out[i * 3 + 1] = posAttr.getY(i);
    out[i * 3 + 2] = posAttr.getZ(i);
  }
  return out;
}

function _idxCopy(geom, posCount) {
  if (geom.index) {
    const idx = geom.index;
    const out = new Array(idx.count);
    for (let i = 0; i < idx.count; i++) out[i] = idx.getX(i);
    return out;
  }
  // Non-indexed: synthesize trivial index.
  const out = new Array(posCount);
  for (let i = 0; i < posCount; i++) out[i] = i;
  return out;
}

function _centroid(verts, loop) {
  let cx = 0, cy = 0, cz = 0;
  for (const i of loop) {
    cx += verts[i * 3]; cy += verts[i * 3 + 1]; cz += verts[i * 3 + 2];
  }
  const n = loop.length || 1;
  return [cx / n, cy / n, cz / n];
}

// Build a single quad as two CCW triangles given 4 vert indices in order
// (A0 → A1 → B1 → B0). If `flip` is true emit the opposite winding.
function _emitQuad(outIdx, a0, a1, b1, b0, flip) {
  if (flip) {
    outIdx.push(a0, b0, b1);
    outIdx.push(a0, b1, a1);
  } else {
    outIdx.push(a0, a1, b1);
    outIdx.push(a0, b1, b0);
  }
}

// Sample the quad normal at pair i=0 to decide winding. We compare it to
// the centroid-to-centroid vector (loopA centroid → loopB centroid). If
// they point opposite ways the quad faces inward → flip.
function _detectFlip(verts, a0, a1, b0, b1, cToC) {
  const ax = verts[a0 * 3],     ay = verts[a0 * 3 + 1], az = verts[a0 * 3 + 2];
  const bx = verts[a1 * 3],     by = verts[a1 * 3 + 1], bz = verts[a1 * 3 + 2];
  const cx = verts[b1 * 3],     cy = verts[b1 * 3 + 1], cz = verts[b1 * 3 + 2];
  // CCW normal of (a0, a1, b1).
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  // Side test against centroid-to-centroid.
  const dot = nx * cToC[0] + ny * cToC[1] + nz * cToC[2];
  return dot < 0;  // normal opposes bridging direction → flip.
}

// Real bridge-edges algorithm. Returns:
//   { ok, geometry, addedFaces }     on success
//   { ok: false, error }             on bad input
//
// geometry — the input THREE.BufferGeometry to read positions+indices off.
// loopA, loopB — arrays of vertex indices (must be same length, >= 2).
//
// Notes:
//   • Output is a brand-new indexed BufferGeometry (caller decides whether
//     to swap mesh.geometry).
//   • The original verts are copied verbatim — no welding, no remap.
//   • Winding is auto-detected to face outward (away from the bridge axis).
//   • If `closeLoop` is true the last quad wraps N-1 → 0; default infers it
//     from input length (>=3 with distinct endpoints).
export function bridgeEdges(geometry, loopA, loopB, opts) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) {
    return { ok: false, error: 'no geometry' };
  }
  if (!Array.isArray(loopA) || !Array.isArray(loopB)) {
    return { ok: false, error: 'loops must be arrays' };
  }
  if (loopA.length !== loopB.length) {
    return { ok: false, error: 'loop lengths differ' };
  }
  if (loopA.length < 2) {
    return { ok: false, error: 'loops need at least 2 verts' };
  }
  const opt = opts || {};
  const posAttr = geometry.attributes.position;
  const vertCount = posAttr.count;
  for (let i = 0; i < loopA.length; i++) {
    if (!Number.isInteger(loopA[i]) || !Number.isInteger(loopB[i])) {
      return { ok: false, error: 'loop verts must be integer indices' };
    }
    if (loopA[i] < 0 || loopA[i] >= vertCount || loopB[i] < 0 || loopB[i] >= vertCount) {
      return { ok: false, error: 'loop index out of range' };
    }
  }

  const verts = _vertsCopy(posAttr);
  const outIdx = _idxCopy(geometry, vertCount);

  // Decide whether to close the loop (last → first wrap).
  const closeLoop = (opt.closeLoop != null)
    ? !!opt.closeLoop
    : (loopA.length >= 3 && loopA[0] !== loopA[loopA.length - 1]);

  // Compute centroid-to-centroid bridging axis for winding detection.
  const ca = _centroid(verts, loopA);
  const cb = _centroid(verts, loopB);
  const cToC = [cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]];

  const flip = _detectFlip(verts, loopA[0], loopA[1], loopB[0], loopB[1], cToC);

  const N = loopA.length;
  const quadCount = closeLoop ? N : N - 1;

  for (let i = 0; i < quadCount; i++) {
    const j = (i + 1) % N;
    _emitQuad(outIdx, loopA[i], loopA[j], loopB[j], loopB[i], flip);
  }

  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const IdxCtor = outIdx.length > 65535
    ? THREE.Uint32BufferAttribute
    : THREE.Uint16BufferAttribute;
  newGeom.setIndex(new IdxCtor(outIdx, 1));
  newGeom.computeVertexNormals();
  newGeom.computeBoundingBox();
  newGeom.computeBoundingSphere();

  return {
    ok: true,
    geometry: newGeom,
    addedFaces: quadCount * 2,    // each quad = 2 tris
    addedQuads: quadCount,
    closed: closeLoop,
    flipped: flip,
  };
}

export default bridgeEdges;
