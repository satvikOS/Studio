// ArchDisc Studio V3 — REAL Wavefront .obj parser (slice 890).
//
// Photogrammetry-flavoured: handles per-vertex colours after the x/y/z
// triplet (Meshroom / Agisoft / Reality Capture / openMVS dump style:
// `v 1.0 2.0 3.0 0.8 0.2 0.1` where the last three floats are RGB in
// [0,1]). Triangulates quad faces. Tracks `mtllib` reference (parsed
// but materials themselves are not resolved this slice — Studio's
// material library covers the surface).
//
// The full Wavefront grammar is huge; we cover the subset required to
// round-trip a photogrammetry export:
//
//   v   x y z [r g b]
//   vn  nx ny nz
//   vt  u v [w]                 (w ignored)
//   f   v[/vt[/vn]] v/vt/vn ...
//   g   name                    (group → recorded but not used)
//   o   name                    (object → recorded but not used)
//   mtllib path
//   usemtl name
//   s    smoothing group flag    (ignored)
//   #    comment                 (skipped)
//
// Face indices are 1-based and may be negative (relative to the
// current vertex list); both modes are handled. We also handle a face
// referencing a vt without a vn (`v/vt`) and `v//vn` (no vt).
//
// Output mirrors plyParser's contract: a `{ positions, normals,
// colors, indices, vertexCount, faceCount, hasNormals, hasColors,
// mtllib, groups }` blob the index.js wrapper hoists into a
// THREE.BufferGeometry.

function _parseFaceVert(token, totalV, totalVT, totalVN) {
  // Wavefront face vertex spec: `v`, `v/vt`, `v/vt/vn`, or `v//vn`.
  const parts = token.split('/');
  function _resolve(idx, total) {
    if (idx === undefined || idx === '') return -1;
    let n = parseInt(idx, 10);
    if (Number.isNaN(n)) return -1;
    if (n < 0) n = total + n + 1; // -1 means last
    return n - 1; // → 0-based
  }
  return {
    v: _resolve(parts[0], totalV),
    vt: _resolve(parts[1], totalVT),
    vn: _resolve(parts[2], totalVN),
  };
}

// Public — parse OBJ text. Auto-detects per-vertex colors when a `v`
// line has 6 floats. Triangulates quads + n-gons via fan
// triangulation. No deps.
export function parseOBJ(text) {
  const positions = [];          // Float[] - flat xyz
  const colorsSrc = [];          // Float[] - flat rgb aligned with positions/3
  const normalsSrc = [];         // Float[]
  const uvsSrc = [];             // Float[]
  const faceTris = [];           // Indices [v0, v1, v2] per tri
  const faceNormals = [];        // Optional per-corner normal indices (-1 if none)
  let hasColors = false;
  let hasVN = false;
  let hasVT = false;
  let mtllib = null;
  const usemtlTracks = [];       // [{ name, startTriIdx }]
  const groups = [];             // [{ kind: 'g'|'o', name, startTriIdx }]

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw) continue;
    // Strip trailing comment.
    const hash = raw.indexOf('#');
    const line = (hash >= 0 ? raw.substring(0, hash) : raw).trim();
    if (!line) continue;
    const sp = line.indexOf(' ');
    if (sp < 0) continue;
    const kw = line.substring(0, sp);
    const rest = line.substring(sp + 1).trim();

    if (kw === 'v') {
      const toks = rest.split(/\s+/);
      if (toks.length < 3) continue;
      positions.push(parseFloat(toks[0]), parseFloat(toks[1]), parseFloat(toks[2]));
      if (toks.length >= 6) {
        // Per-vertex color extension. Values are usually in [0,1] for
        // photogrammetry outputs; if any is >1 we assume [0,255] and
        // normalise.
        let r = parseFloat(toks[3]);
        let g = parseFloat(toks[4]);
        let b = parseFloat(toks[5]);
        if (r > 1 || g > 1 || b > 1) { r /= 255; g /= 255; b /= 255; }
        colorsSrc.push(r, g, b);
        hasColors = true;
      } else if (hasColors) {
        // Pad missing color entries with white so the buffer stays
        // aligned with positions.
        colorsSrc.push(1, 1, 1);
      }
      continue;
    }
    if (kw === 'vn') {
      const toks = rest.split(/\s+/);
      normalsSrc.push(parseFloat(toks[0]), parseFloat(toks[1]), parseFloat(toks[2]));
      hasVN = true;
      continue;
    }
    if (kw === 'vt') {
      const toks = rest.split(/\s+/);
      uvsSrc.push(parseFloat(toks[0]), parseFloat(toks[1]));
      hasVT = true;
      continue;
    }
    if (kw === 'f') {
      const toks = rest.split(/\s+/);
      if (toks.length < 3) continue;
      const totalV = positions.length / 3;
      const totalVT = uvsSrc.length / 2;
      const totalVN = normalsSrc.length / 3;
      const parsed = toks.map((t) => _parseFaceVert(t, totalV, totalVT, totalVN));
      // Fan-triangulate.
      for (let k = 1; k < parsed.length - 1; k++) {
        const a = parsed[0];
        const b = parsed[k];
        const c = parsed[k + 1];
        if (a.v < 0 || b.v < 0 || c.v < 0) continue;
        faceTris.push(a.v, b.v, c.v);
        faceNormals.push(a.vn, b.vn, c.vn);
      }
      continue;
    }
    if (kw === 'mtllib') {
      mtllib = rest;
      continue;
    }
    if (kw === 'usemtl') {
      usemtlTracks.push({ name: rest, startTriIdx: faceTris.length / 3 });
      continue;
    }
    if (kw === 'g' || kw === 'o') {
      groups.push({ kind: kw, name: rest, startTriIdx: faceTris.length / 3 });
      continue;
    }
    // s / vp / curv / etc are ignored.
  }

  const vertexCount = positions.length / 3;
  const positionsArr = new Float32Array(positions);
  const colorsArr = hasColors ? new Float32Array(colorsSrc) : null;
  // Normalise normals: build a per-position normals buffer by
  // averaging the supplied per-corner normals. If the OBJ has no `vn`
  // lines we leave normals null and the consumer can compute them.
  let normalsArr = null;
  if (hasVN) {
    normalsArr = new Float32Array(vertexCount * 3);
    const counts = new Uint32Array(vertexCount);
    for (let f = 0; f < faceTris.length; f++) {
      const v = faceTris[f];
      const n = faceNormals[f];
      if (n < 0) continue;
      normalsArr[v * 3 + 0] += normalsSrc[n * 3 + 0];
      normalsArr[v * 3 + 1] += normalsSrc[n * 3 + 1];
      normalsArr[v * 3 + 2] += normalsSrc[n * 3 + 2];
      counts[v]++;
    }
    for (let v = 0; v < vertexCount; v++) {
      if (counts[v] === 0) continue;
      let x = normalsArr[v * 3 + 0] / counts[v];
      let y = normalsArr[v * 3 + 1] / counts[v];
      let z = normalsArr[v * 3 + 2] / counts[v];
      const L = Math.hypot(x, y, z);
      if (L > 1e-9) { x /= L; y /= L; z /= L; }
      normalsArr[v * 3 + 0] = x;
      normalsArr[v * 3 + 1] = y;
      normalsArr[v * 3 + 2] = z;
    }
  }

  return {
    positions: positionsArr,
    normals: normalsArr,
    colors: colorsArr,
    indices: faceTris.length ? new Uint32Array(faceTris) : null,
    vertexCount,
    faceCount: faceTris.length / 3,
    hasNormals: !!normalsArr,
    hasColors,
    hasUV: hasVT,
    mtllib,
    materialRanges: usemtlTracks,
    groups,
  };
}

export default parseOBJ;
